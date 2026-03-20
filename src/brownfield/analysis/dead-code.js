/**
 * 2B — Dead code detection
 * Unused files + unused exports (files not imported by anyone non-entry)
 */

'use strict';

/**
 * Find dead files and exports
 * @returns {{ deadFiles: string[], unusedExports: Object }}
 */
function findDeadCode(nodes) {
  const deadFiles = [];
  const unusedExports = {};

  for (const [file, node] of Object.entries(nodes)) {
    // Skip entry points and config files
    if (node.isEntryPoint) continue;
    if (node.lang === 'config') continue;

    // Dead file: not imported by anyone
    if (node.importedBy.length === 0 && !node.isBarrel) {
      deadFiles.push(file);
    }

    // Unused exports: file is imported by nobody, yet has exports
    if (node.importedBy.length === 0 && node.exports.length > 0) {
      unusedExports[file] = node.exports;
    }
  }

  return { deadFiles, unusedExports };
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
