/**
 * Builds a reverse lookup index of all exported symbols in the graph.
 *
 * Returns a Map keyed by `qualifiedName` (file::name) — unique per definition.
 * Attaches a `byName` Map (name → entry[]) for callers that need to search by
 * short name only. Using byName avoids the last-wins collision that occurred
 * when two different files export a symbol with the same short name.
 *
 * @param {Object} nodes - The graph nodes map
 * @returns {Map<string, Object>} Map of qualifiedName -> { file, name, qualifiedName, kind, lineStart }
 *          with an extra `.byName` Map<string, Object[]> property attached.
 */
function buildSymbolIndex(nodes) {
  const index  = new Map();  // qualifiedName → entry
  const byName = new Map();  // shortName     → entry[]

  for (const [file, node] of Object.entries(nodes)) {
    for (const sym of (node.symbols || [])) {
      // Only index exported symbols — reduces false positives in call detection
      if (!node.exports || !node.exports.includes(sym.name)) continue;

      const qualifiedName = `${file}::${sym.name}`;
      const entry = {
        file,
        name: sym.name,
        qualifiedName,
        kind:      sym.kind,
        lineStart: sym.lineStart,
      };

      index.set(qualifiedName, entry);

      const existing = byName.get(sym.name);
      if (existing) {
        existing.push(entry);
      } else {
        byName.set(sym.name, [entry]);
      }
    }
  }

  // Attach byName as a non-enumerable property so callers can use it
  // without changing the Map interface used elsewhere.
  Object.defineProperty(index, 'byName', { value: byName, enumerable: false });

  return index;
}

module.exports = { buildSymbolIndex };
