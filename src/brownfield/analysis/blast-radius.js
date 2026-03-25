/**
 * 2B — Blast radius
 * BFS reverse traversal from a file through importedBy edges.
 * Cross-language dependents flagged separately.
 */

'use strict';

/**
 * Compute blast radius for a file
 * @param {string} file - relative path
 * @param {Object} nodes - graph nodes
 * @returns {{ count: number, files: string[], crossLang: string[] }}
 */
function blastRadius(file, nodes) {
  const node = nodes[file];
  if (!node) return { count: 0, direct: 0, transitive: 0, files: [], crossLang: [] };

  const sourceLang = node.lang;
  const direct = node.importedBy.length;

  const visited = new Set();
  const queue = [file];
  const crossLang = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    const currentNode = nodes[current];
    if (!currentNode) continue;

    for (const dependent of currentNode.importedBy) {
      if (!visited.has(dependent)) {
        queue.push(dependent);
        if (nodes[dependent] && nodes[dependent].lang !== sourceLang) {
          crossLang.push(dependent);
        }
      }
    }
  }

  visited.delete(file);
  const transitive = visited.size;

  return {
    count: transitive,   // kept for backward compat
    direct,
    transitive,
    files: [...visited],
    crossLang: [...new Set(crossLang)],
  };
}

/**
 * Find all files that transitively call a given symbol.
 * Uses CALLS edges from the SQLite store — much more precise than import-level BFS.
 *
 * @param {string} qualifiedName — 'src/auth/token.js::signToken'
 * @param {GraphStore} store
 * @returns {{ direct: string[], transitive: string[], count: number }}
 */
function symbolBlastRadius(qualifiedName, store) {
  const direct = store.getCallers(qualifiedName);
  const visited = new Set(direct);
  const queue = [...direct];

  // BFS: expand callers of callers (file-level import BFS beyond direct callers)
  // For the transitive layer, fall back to import edges (callers of callers don't have
  // CALLS-edge resolution yet — file level is fine for transitive hops)
  while (queue.length > 0) {
    const current = queue.shift();
    const importers = store.getImporters(current);
    for (const imp of importers) {
      if (!visited.has(imp)) {
        visited.add(imp);
        queue.push(imp);
      }
    }
  }

  return {
    direct,
    transitive: [...visited].filter(f => !direct.includes(f)),
    count: visited.size,
  };
}

module.exports = { blastRadius, symbolBlastRadius };
