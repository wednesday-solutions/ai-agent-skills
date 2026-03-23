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

module.exports = { blastRadius };
