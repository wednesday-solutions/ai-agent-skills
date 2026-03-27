/**
 * 2B — Dead code detection
 * Unused files + unused exports (files not imported by anyone non-entry)
 */

'use strict';

const path = require('path');

/**
 * Files that are definitely not dead even if nothing imports them:
 * - Standalone scripts (bin/, scripts/, tools/, tasks/, cli/)
 * - Config files (*.config.ts/js, vite.config, webpack.config, etc.)
 * - Test setup files (setup.ts, jest.setup.js, setupTests.js)
 * - Files with dynamic import gaps (they may be loaded at runtime)
 * - Test files — they import everything but nothing imports them
 * - Third-party / Vendor / Library code (they are out of scope for dead code)
 */
function isThirdParty(file) {
  const f = file.toLowerCase();
  const thirdPartyDirs = [
    'thirdparty/', 'vendor/', 'pods/', 'carthage/', 'node_modules/', 
    'bower_components/', 'external/', 'generated/', 'demo/', 'example/'
  ];
  return thirdPartyDirs.some(dir => f.includes(dir)) || f.includes('/demo/') || f.includes('/example/');
}

function isSafelyUnimported(file, node) {
  const f = file.toLowerCase();
  const base = path.basename(f);

  // Standalone script directories
  if (/^\/?(?:bin|scripts?|tools?|tasks?|cli|hack|seed|fixture|migration)\//.test(f)) return true;

  // Hook scripts (git hooks, claude hooks) and cron/scheduled scripts
  if (/^\/?(?:assets\/hooks?|hooks?|crons?|scheduled?)\//.test(f)) return true;

  // Supabase / Deno edge function shared utilities — imported via Deno URL imports
  // which the static parser can't trace, so they appear orphaned
  if (/^\/?(?:supabase\/functions\/_shared|_shared)\//.test(f)) return true;

  // Config / setup files by name pattern
  if (/\.(config|setup|test|spec)\.[jt]sx?$/.test(f)) return true;
  if (/jest\.setup|setupTests|vitest\.setup|babel\.config|webpack\.config|vite\.config|next\.config|tailwind\.config|postcss\.config|rollup\.config|esbuild\.config/.test(base)) return true;

  // Test files (JS/TS, Python, Ruby, Java, PHP, C#)
  if (/\.test\.[jt]sx?$|\.spec\.[jt]sx?$|__tests__/.test(f)) return true;
  if (/test_\w+\.py$|_test\.py$/.test(base)) return true;                         // Python
  if (/_spec\.rb$|_test\.rb$/.test(base) || /^\/?spec\//.test(f)) return true;   // Ruby
  if (/Test\.java$|Tests\.java$|IT\.java$/.test(base)) return true;               // Java
  if (/Test\.php$|Tests\.php$/.test(base) || /^\/?tests?\//.test(f)) return true; // PHP
  if (/Tests\.cs$|Test\.cs$|Fixture\.cs$/.test(base)) return true;                // C#

  // Files with unresolved dynamic import gaps — may be loaded at runtime
  if (node.gaps.some(g => g.type === 'dynamic-require' || g.type === 'dynamic-import')) return true;

  // Third-party / Vendor code
  if (isThirdParty(file)) return true;

  return false;
}

/**
 * Find dead files.
 * A file is dead when nothing imports it AND it's not an entry point,
 * barrel, config, script, test, or dynamically loaded file.
 *
 * When commentIntel is provided (zero extra LLM tokens), each dead file is annotated:
 *   risk: 'high'    — in a biz-feature module (never auto-delete)
 *   risk: 'low'     — in an infra/utility module (safe to remove)
 *   risk: 'unknown' — module not yet enriched
 *
 * @param {Object} nodes
 * @param {Object|null} commentIntel - output of analyseComments (optional)
 * @returns {{ deadFiles: Array<{file, risk}>, unusedExports: {}, riskByFile: Object }}
 */
function findDeadCode(nodes, commentIntel = null) {
  // Build dir → isBizFeature lookup from enriched comments
  const bizByDir = new Map();
  if (commentIntel && commentIntel.modules) {
    for (const mod of commentIntel.modules) {
      bizByDir.set(mod.dir, mod.isBizFeature);
    }
  }

  const deadFiles = [];
  const riskByFile = {};

  for (const [file, node] of Object.entries(nodes)) {
    if (node.isEntryPoint)          continue;
    // Only skip barrels that are true directory index files (index.ts/tsx/js or __init__.py).
    // A non-index file that happens to re-export something (e.g. CreatePostModal.tsx)
    // is still dead if nothing imports it.
    if (node.isBarrel && /(?:^|[/\\])index\.[jt]sx?$/.test(file)) continue;
    if (node.isBarrel && /(?:^|[/\\])__init__\.py$/.test(file)) continue;
    if (node.lang === 'config')     continue;
    if (node.lang === 'shell')      continue;
    if (isSafelyUnimported(file, node)) continue;

    if (node.importedBy.length === 0) {
      const dir = path.dirname(file);
      const isBiz = bizByDir.has(dir) ? bizByDir.get(dir) : null;
      const risk = isBiz === true ? 'high' : isBiz === false ? 'low' : 'unknown';
      deadFiles.push(file);
      riskByFile[file] = risk;
    }
  }

  // unusedExports removed — the previous logic (flag all exports from 0-importer files)
  // was identical to dead files and created false positives. True per-export unused
  // detection requires named import tracking which is a separate feature.
  return { deadFiles, unusedExports: {}, riskByFile };
}

/**
 * Find circular dependencies via DFS
 */
function findCircularDeps(nodes) {
  const cycles = [];
  const visited = new Set();
  const inStack = new Set();

  function dfs(file, stack) {
    if (inStack.has(file)) {
      // Found a cycle — extract the cycle path
      const cycleStart = stack.indexOf(file);
      if (cycleStart !== -1) {
        const cycle = stack.slice(cycleStart);
        // Deduplicate by normalising cycle (start from smallest)
        const sorted = [...cycle].sort();
        const key = sorted.join('|');
        if (!cycles.find(c => c.files.join('|') === key)) {
          // Categorization: Business Logic vs Structural (Extensions, Constants)
          const isStructural = cycle.some(f => 
            /Extensions?\.swift$|Constants?\.swift$|Resource\.swift$|Generated\/|Mock\.swift$|Tests?\.swift$/.test(f)
          );
          let risk = cycle.length > 5 ? 'High' : 'Medium';
          let type = isStructural ? 'Structural' : 'Logic';
          
          if (isStructural) risk = 'Low'; // De-panic structural cycles

          cycles.push({ files: cycle, risk, type });
        }
      }
      return;
    }
    if (visited.has(file)) return;

    visited.add(file);
    inStack.add(file);
    stack.push(file);

    const node = nodes[file];
    if (node) {
      for (const imp of node.imports) {
        if (nodes[imp]) {
          dfs(imp, [...stack]);
        }
      }
    }

    inStack.delete(file);
  }

  for (const file of Object.keys(nodes)) {
    if (!visited.has(file)) {
      dfs(file, []);
    }
  }

  // Sort: High risk logic first, then structural last
  return cycles.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'Logic' ? -1 : 1;
    const riskMap = { High: 0, Medium: 1, Low: 2 };
    return riskMap[a.risk] - riskMap[b.risk];
  });
}

module.exports = { findDeadCode, findCircularDeps };
