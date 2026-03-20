/**
 * 2A-2 — TS/JS language adapter
 * Handles: ES modules, CommonJS, barrel files, path aliases,
 * legacy patterns (module.exports, prototype, IIFE), React/Next.js
 */

'use strict';

const path = require('path');
const { safeRead, resolveImport, resolveAlias } = require('../core/parser');

/**
 * Parse a JS/TS/JSX/TSX file and extract dependency information.
 */
function parse(filePath, rootDir, aliases) {
  const src = safeRead(filePath);
  if (src === null) {
    return { file: filePath, lang: 'typescript', imports: [], exports: [], gaps: [], meta: {}, error: true };
  }

  const imports = new Set();
  const exports = new Set();
  const gaps = [];
  const meta = {};

  // ── ES module static imports ──────────────────────────────────────────────
  // import X from 'path'
  // import { X, Y } from 'path'
  // import * as X from 'path'
  // import 'path' (side-effect)
  const esImportRe = /import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = esImportRe.exec(src)) !== null) {
    addImport(imports, m[1], filePath, rootDir, aliases);
  }

  // export ... from 'path'  (re-exports / barrels)
  const reExportRe = /export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = reExportRe.exec(src)) !== null) {
    addImport(imports, m[1], filePath, rootDir, aliases);
    meta.isBarrel = true;
  }

  // ── CommonJS require ──────────────────────────────────────────────────────
  // const x = require('path')  /  require('path')
  const staticRequireRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = staticRequireRe.exec(src)) !== null) {
    addImport(imports, m[1], filePath, rootDir, aliases);
  }

  // ── Dynamic require / import — gaps ──────────────────────────────────────
  // require('./' + variable)  /  require(`${dir}/file`)  /  import(expr)
  const dynRequireRe = /require\s*\(\s*(?!['"])[^)]+\)/g;
  while ((m = dynRequireRe.exec(src)) !== null) {
    gaps.push({ type: 'dynamic-require', line: lineAt(src, m.index), pattern: m[0].slice(0, 80) });
  }

  const dynImportRe = /import\s*\(\s*(?!['"])[^)]+\)/g;
  while ((m = dynImportRe.exec(src)) !== null) {
    gaps.push({ type: 'dynamic-import', line: lineAt(src, m.index), pattern: m[0].slice(0, 80) });
  }

  // ── ES exports ────────────────────────────────────────────────────────────
  // export default / export function / export class / export const ...
  const esExportNamedRe = /export\s+(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*|class\s+|const\s+|let\s+|var\s+)(\w+)/g;
  while ((m = esExportNamedRe.exec(src)) !== null) {
    exports.add(m[1]);
  }

  // export { X, Y as Z }
  const esExportBraceRe = /export\s+\{([^}]+)\}/g;
  while ((m = esExportBraceRe.exec(src)) !== null) {
    for (const name of m[1].split(',')) {
      const part = name.trim().split(/\s+as\s+/).pop().trim();
      if (part) exports.add(part);
    }
  }

  // module.exports = { X, Y }
  const cjsExportObjRe = /module\.exports\s*=\s*\{([^}]*)\}/g;
  while ((m = cjsExportObjRe.exec(src)) !== null) {
    for (const name of m[1].split(',')) {
      const id = name.trim().split(/:/)[0].trim();
      if (/^\w+$/.test(id)) exports.add(id);
    }
  }

  // module.exports = SomeIdentifier
  const cjsExportIdRe = /module\.exports\s*=\s*(\w+)\s*;/g;
  while ((m = cjsExportIdRe.exec(src)) !== null) {
    exports.add(m[1]);
  }

  // exports.X = ...
  const cjsExportPropRe = /exports\.(\w+)\s*=/g;
  while ((m = cjsExportPropRe.exec(src)) !== null) {
    exports.add(m[1]);
  }

  // Prototype methods  Foo.prototype.method = function
  const protoRe = /(\w+)\.prototype\.(\w+)\s*=/g;
  while ((m = protoRe.exec(src)) !== null) {
    exports.add(`${m[1]}.prototype.${m[2]}`);
  }

  // ── Global injections ─────────────────────────────────────────────────────
  const globalSetRe = /global\.(\w+)\s*=/g;
  while ((m = globalSetRe.exec(src)) !== null) {
    gaps.push({ type: 'global-inject', line: lineAt(src, m.index), name: m[1] });
  }

  // ── Event emitters ────────────────────────────────────────────────────────
  const emitRe = /\.emit\s*\(\s*['"]([^'"]+)['"]/g;
  while ((m = emitRe.exec(src)) !== null) {
    gaps.push({ type: 'event-emit', line: lineAt(src, m.index), event: m[1] });
  }

  // ── @wednesday-skills annotations ────────────────────────────────────────
  const annotationRe = /\/\/\s*@wednesday-skills:(\S+)\s+(.*)/g;
  const annotations = [];
  while ((m = annotationRe.exec(src)) !== null) {
    annotations.push({ type: m[1], value: m[2].trim() });
    // If connects-to annotation, treat as a resolved import
    if (m[1] === 'connects-to') {
      const parts = m[2].split('→').map(s => s.trim());
      if (parts.length === 2) {
        addImport(imports, parts[1], filePath, rootDir, aliases);
      }
    }
  }
  if (annotations.length) meta.annotations = annotations;

  // ── Framework detection ───────────────────────────────────────────────────
  if (/from\s+['"]next\//.test(src) || /from\s+['"]next['"]/.test(src)) meta.framework = 'nextjs';
  if (/from\s+['"]react['"]/.test(src)) meta.framework = meta.framework || 'react';
  if (src.includes('@nestjs/')) meta.framework = 'nestjs';
  if (src.includes('getStaticProps') || src.includes('getServerSideProps')) meta.isNextPage = true;

  return {
    file: filePath,
    lang: 'typescript',
    imports: [...imports],
    exports: [...exports],
    gaps,
    meta,
    error: false,
  };
}

function addImport(set, rawPath, fromFile, rootDir, aliases) {
  if (aliases) {
    const aliased = resolveAlias(rawPath, aliases);
    if (aliased) {
      // aliased may be absolute (from baseUrl) — relativise before passing to resolveImport
      rawPath = path.isAbsolute(aliased)
        ? path.relative(path.dirname(fromFile), aliased)
        : aliased;
      if (!rawPath.startsWith('.')) rawPath = './' + rawPath;
    }
  }
  const resolved = resolveImport(fromFile, rawPath, rootDir);
  set.add(resolved);
}

function lineAt(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

module.exports = { parse };
