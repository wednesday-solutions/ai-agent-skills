/**
 * 2A-2 — Go language adapter
 * Handles: import statements, exported identifiers (capitalised),
 * interface implementations (best-effort), go.mod module path
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { safeRead, lineAt } = require('../core/parser');

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
    symbols: extractSymbols(src),
    error: false,
  };
}

/**
 * Extract top-level functions, methods, and struct/interface types with line numbers.
 */
function extractSymbols(src) {
  const symbols = [];
  let m;

  // func declarations: func FuncName(  /  func (receiver) MethodName(
  // Capture both free functions and methods — use the function/method name (last ident before '(')
  const fnRe = /^func(?:\s*\([^)]*\))?\s+(\w+)\s*\[?/gm;
  while ((m = fnRe.exec(src)) !== null) {
    symbols.push({
      name:      m[1],
      kind:      'function',
      lineStart: lineAt(src, m.index),
      signature: src.slice(m.index, m.index + 80).split('\n')[0].trim(),
    });
  }

  // type declarations: type Foo struct / type Bar interface
  const typeRe = /^type\s+(\w+)\s+(?:struct|interface)/gm;
  while ((m = typeRe.exec(src)) !== null) {
    symbols.push({
      name:      m[1],
      kind:      'class',
      lineStart: lineAt(src, m.index),
      signature: src.slice(m.index, m.index + 80).split('\n')[0].trim(),
    });
  }

  return symbols;
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
