/**
 * Builds a reverse lookup index of all exported symbols in the graph.
 * 
 * @param {Object} nodes - The graph nodes map
 * @returns {Map<string, Object>} Map of symbolName -> { file, qualifiedName, kind, lineStart }
 */
function buildSymbolIndex(nodes) {
  const index = new Map();
  for (const [file, node] of Object.entries(nodes)) {
    for (const sym of (node.symbols || [])) {
      // Only index exported symbols — reduces false positives in call detection
      if (node.exports && node.exports.includes(sym.name)) {
        index.set(sym.name, {
          file,
          qualifiedName: `${file}::${sym.name}`,
          kind: sym.kind,
          lineStart: sym.lineStart,
        });
      }
    }
  }
  return index;
}

module.exports = { buildSymbolIndex };
