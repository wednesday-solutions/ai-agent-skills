function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strip string literals from source so symbol names that appear only inside
 * strings (e.g. console.log("signToken failed")) don't create false call edges.
 * Preserves line structure so lineAt() offsets stay valid.
 */
function stripStrings(src) {
  return src
    // Template literals — replace content but keep backtick markers
    .replace(/`(?:[^`\\]|\\.)*`/g,   m => '`' + ' '.repeat(Math.max(0, m.length - 2)) + '`')
    // Double-quoted strings
    .replace(/"(?:[^"\\]|\\.)*"/g,   m => '"' + ' '.repeat(Math.max(0, m.length - 2)) + '"')
    // Single-quoted strings
    .replace(/'(?:[^'\\]|\\.)*'/g,   m => "'" + ' '.repeat(Math.max(0, m.length - 2)) + "'");
}

/**
 * Extracts call sites for symbols imported from other files.
 *
 * Uses the byName multi-map on symbolIndex to handle multiple files exporting
 * the same short name — previously only the last-indexed definition was checked.
 *
 * @param {string} file         - The current file path
 * @param {string} src          - Comment-stripped source (comments removed in graph.js)
 * @param {Object} node         - The graph node for the file
 * @param {Map}    symbolIndex  - The global symbol index (with .byName Map attached)
 * @returns {string[]} Array of qualified names called (file::symbol)
 */
function extractCallEdges(file, src, node, symbolIndex) {
  const calls = new Set();

  if (!node.imports || node.imports.length === 0) return [];

  // Build a set of imported files for O(1) lookup
  const importedSet = new Set(node.imports);

  // Strip string literals so name appearances inside strings are ignored
  const clean = stripStrings(src);

  // Use byName multi-map if available (new index shape), fall back to iterating
  // the full index (old shape) so this stays backwards-compatible.
  const byName = symbolIndex.byName;

  if (byName) {
    for (const [name, entries] of byName) {
      // Skip immediately if no entry belongs to an imported file
      const relevant = entries.filter(e => importedSet.has(e.file));
      if (relevant.length === 0) continue;

      const callRe = new RegExp(`\\b${escapeRegex(name)}\\s*[\\(\\.]`, 'g');
      if (callRe.test(clean)) {
        for (const entry of relevant) {
          calls.add(entry.qualifiedName);
        }
      }
    }
  } else {
    // Fallback: old index shape (qualifiedName → entry)
    for (const importedFile of node.imports) {
      for (const [, entry] of symbolIndex) {
        if (entry.file !== importedFile) continue;
        const callRe = new RegExp(`\\b${escapeRegex(entry.name)}\\s*[\\(\\.]`, 'g');
        if (callRe.test(clean)) {
          calls.add(entry.qualifiedName);
        }
      }
    }
  }

  return [...calls];
}

module.exports = { extractCallEdges };
