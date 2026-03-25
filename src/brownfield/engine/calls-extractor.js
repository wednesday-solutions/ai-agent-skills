function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extracts call sites for symbols imported from other files.
 * 
 * @param {string} file - The current file path
 * @param {string} src - The stripped source code of the file
 * @param {Object} node - The graph node for the file
 * @param {Map} symbolIndex - The global symbol index
 * @returns {string[]} Array of qualified names called
 */
function extractCallEdges(file, src, node, symbolIndex) {
  const calls = new Set();

  if (!node.imports || node.imports.length === 0) return [];

  // Only look for symbols imported by this file (narrows scope drastically)
  for (const importedFile of node.imports) {
    // Find all symbols exported by the imported file that are in the index
    for (const [name, entry] of symbolIndex) {
      if (entry.file !== importedFile) continue;

      // Check if the symbol is actually called in this file
      // \b ensures we don't match "signTokenHelper" when looking for "signToken"
      const callRe = new RegExp(`\\b${escapeRegex(name)}\\s*[\\(\\.]`, 'g');
      if (callRe.test(src)) {
        calls.add(entry.qualifiedName);
      }
    }
  }

  return [...calls];
}

module.exports = { extractCallEdges };
