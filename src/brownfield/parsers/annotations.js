/**
 * 2A-3 — @wednesday-skills annotation parser
 * Reads developer-placed annotations for patterns tree-sitter cannot capture:
 * connects-to, global, uses-global, side-effect, calls-next
 */

'use strict';

const { safeRead } = require('../core/parser');

const ANNOTATION_RE = /\/\/\s*@wednesday-skills:(\S+)\s+(.*)/g;

/**
 * Extract all annotations from a file
 * @returns {{ type: string, value: string, line: number }[]}
 */
function parseAnnotations(filePath) {
  const src = safeRead(filePath);
  if (!src) return [];

  const results = [];
  let m;
  ANNOTATION_RE.lastIndex = 0;

  while ((m = ANNOTATION_RE.exec(src)) !== null) {
    results.push({
      type: m[1],
      value: m[2].trim(),
      line: src.slice(0, m.index).split('\n').length,
    });
  }

  return results;
}

module.exports = { parseAnnotations };
