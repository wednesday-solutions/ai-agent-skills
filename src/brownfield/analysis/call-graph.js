/**
 * 2B — Call graph tracer
 * Traces function call chains through import relationships.
 * BFS from a starting file/function through the import graph.
 */

'use strict';

/**
 * Trace call chain from a file/function
 * @param {string} file       - starting file (relative path)
 * @param {string} fnName     - function name to trace (optional)
 * @param {Object} nodes      - graph nodes
 * @param {number} maxDepth   - max traversal depth (default 5)
 * @returns {{ chain: Object[], depth: number }}
 */
function trace(file, fnName, nodes, maxDepth = 5) {
  const chain = [];
  const visited = new Set();
  const queue = [{ file, depth: 0, via: null }];

  while (queue.length > 0) {
    const { file: current, depth, via } = queue.shift();
    if (visited.has(current) || depth > maxDepth) continue;
    visited.add(current);

    const node = nodes[current];
    if (!node) continue;

    chain.push({
      file: current,
      depth,
      exports: node.exports,
      importedBy: node.importedBy.length,
      via,
    });

    // Follow imports (outbound)
    for (const imp of node.imports) {
      if (nodes[imp] && !visited.has(imp)) {
        queue.push({ file: imp, depth: depth + 1, via: current });
      }
    }
  }

  return { chain, depth: chain.length > 0 ? Math.max(...chain.map(c => c.depth)) : 0 };
}

module.exports = { trace };
