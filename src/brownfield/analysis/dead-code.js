/**
 * 2B — Dead code detection
 * Unused files + unused exports (files not imported by anyone non-entry)
 */

'use strict';

/**
 * Files that are definitely not dead even if nothing imports them:
 * - Standalone scripts (bin/, scripts/, tools/, tasks/, cli/)
 * - Config files (*.config.ts/js, vite.config, webpack.config, etc.)
 * - Test setup files (setup.ts, jest.setup.js, setupTests.js)
 * - Files with dynamic import gaps (they may be loaded at runtime)
 * - Test files — they import everything but nothing imports them
 */
function isSafelyUnimported(file, node) {
  const f = file.toLowerCase();
  const base = require('path').basename(f);

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

  return false;
}

/**
 * Find dead files.
 * A file is dead when nothing imports it AND it's not an entry point,
 * barrel, config, script, test, or dynamically loaded file.
 * @returns {{ deadFiles: string[] }}
 */
function findDeadCode(nodes) {
  const deadFiles = [];

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
      deadFiles.push(file);
    }
  }

  // unusedExports removed — the previous logic (flag all exports from 0-importer files)
  // was identical to dead files and created false positives. True per-export unused
  // detection requires named import tracking which is a separate feature.
  return { deadFiles, unusedExports: {} };
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
          cycles.push({ files: cycle, risk: cycle.length > 3 ? 'High' : 'Medium' });
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

  return cycles;
}

module.exports = { findDeadCode, findCircularDeps };
