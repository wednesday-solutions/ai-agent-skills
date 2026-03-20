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
  if (!node) return { count: 0, files: [], crossLang: [] };

  const sourceLang = node.lang;
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
        // Flag cross-language dependents
        if (nodes[dependent] && nodes[dependent].lang !== sourceLang) {
          crossLang.push(dependent);
        }
      }
    }
  }

  // Remove the source file itself
  visited.delete(file);

  return {
    count: visited.size,
    files: [...visited],
    crossLang: [...new Set(crossLang)],
  };
}

module.exports = { blastRadius };
