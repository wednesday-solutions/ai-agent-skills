/**
 * 2A-2 — Go language adapter
 * Handles: import statements, exported identifiers (capitalised),
 * interface implementations (best-effort), go.mod module path
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { safeRead } = require('../core/parser');

/**
 * Load the module path from go.mod in rootDir
 */
function loadModulePath(rootDir) {
  const gomod = path.join(rootDir, 'go.mod');
  if (!fs.existsSync(gomod)) return null;
  try {
    const src = fs.readFileSync(gomod, 'utf8');
    const m = src.match(/^module\s+(\S+)/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function parse(filePath, rootDir, _aliases, modulePathCache) {
  const src = safeRead(filePath);
  if (src === null) {
    return { file: filePath, lang: 'go', imports: [], exports: [], gaps: [], meta: {}, error: true };
  }

  const imports = new Set();
  const exports = new Set();
  const gaps = [];
  const meta = {};

  const modulePath = modulePathCache || loadModulePath(rootDir);

  // ── import block ──────────────────────────────────────────────────────────
  // import "pkg"  or  import ( "pkg" \n "pkg" )
  const singleImport = /import\s+"([^"]+)"/g;
  let m;
  while ((m = singleImport.exec(src)) !== null) {
    imports.add(resolveGoImport(m[1], rootDir, modulePath));
  }

  // Import block: import ( ... )
  const blockMatch = src.match(/import\s*\(([\s\S]*?)\)/);
  if (blockMatch) {
    const block = blockMatch[1];
    const lineRe = /(?:\w+\s+)?"([^"]+)"/g;
    while ((m = lineRe.exec(block)) !== null) {
      imports.add(resolveGoImport(m[1], rootDir, modulePath));
    }
  }

  // ── Exported identifiers (capitalised first letter) ───────────────────────
  // func FuncName / type TypeName / var VarName / const ConstName
  const exportedRe = /^(?:func|type|var|const)\s+([A-Z]\w*)/gm;
  while ((m = exportedRe.exec(src)) !== null) {
    exports.add(m[1]);
  }

  // ── Event annotations ─────────────────────────────────────────────────────
  const annotationRe = /\/\/\s*@wednesday-skills:(\S+)\s+(.*)/g;
  const annotations = [];
  while ((m = annotationRe.exec(src)) !== null) {
    annotations.push({ type: m[1], value: m[2].trim() });
    if (m[1] === 'connects-to') {
      const parts = m[2].split('→').map(s => s.trim());
      if (parts.length === 2) imports.add(parts[1]);
    }
  }
  if (annotations.length) meta.annotations = annotations;

  return {
    file: filePath,
    lang: 'go',
    imports: [...imports],
    exports: [...exports],
    gaps,
    meta: { ...meta, modulePath },
    error: false,
  };
}

function resolveGoImport(importPath, rootDir, modulePath) {
  // Internal package — convert module path to relative file path
  if (modulePath && importPath.startsWith(modulePath)) {
    const rel = importPath.slice(modulePath.length).replace(/^\//, '');
    return rel || '.';
  }
  // External — return as-is
  return importPath;
}

module.exports = { parse, loadModulePath };
