/**
 * 2A-2 — Kotlin language adapter (basic)
 * Handles: import statements, class/function exports, Android basics
 * Full DI (Hilt/Koin) is Phase 3
 */

'use strict';

const path = require('path');
const { safeRead } = require('../core/parser');

function parse(filePath, rootDir) {
  const src = safeRead(filePath);
  if (src === null) {
    return { file: filePath, lang: 'kotlin', imports: [], exports: [], gaps: [], meta: {}, error: true };
  }

  const imports = new Set();
  const exports = new Set();
  const gaps = [];
  const meta = {};

  // ── import statements ─────────────────────────────────────────────────────
  const importRe = /^import\s+([\w.]+)/gm;
  let m;
  while ((m = importRe.exec(src)) !== null) {
    // Convert package.Class to package/Class for consistency
    imports.add(m[1]);
  }

  // ── Package declaration ───────────────────────────────────────────────────
  const pkgMatch = src.match(/^package\s+([\w.]+)/m);
  if (pkgMatch) meta.package = pkgMatch[1];

  // ── Public classes/objects/functions ─────────────────────────────────────
  const exportRe = /^(?:public\s+)?(?:data\s+|sealed\s+|abstract\s+|open\s+)?(?:class|object|fun|interface)\s+(\w+)/gm;
  while ((m = exportRe.exec(src)) !== null) {
    exports.add(m[1]);
  }

  // ── Android Activity/Fragment detection ───────────────────────────────────
  if (src.includes('AppCompatActivity') || src.includes('FragmentActivity')) {
    meta.androidComponent = 'activity';
  } else if (src.includes(': Fragment()') || src.includes('extends Fragment')) {
    meta.androidComponent = 'fragment';
  }

  // ── Annotations for DI (basic detection for Phase 2 — full in Phase 3) ───
  if (src.includes('@Inject') || src.includes('@Module') || src.includes('@Component')) {
    meta.hasDI = true;
    gaps.push({ type: 'kotlin-di', pattern: 'DI annotations found — full resolution in Phase 3' });
  }

  return {
    file: filePath,
    lang: 'kotlin',
    imports: [...imports],
    exports: [...exports],
    gaps,
    meta,
    error: false,
  };
}

module.exports = { parse };
