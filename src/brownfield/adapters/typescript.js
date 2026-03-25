/**
 * 2A-2 — TS/JS language adapter
 * Handles: ES modules, CommonJS, barrel files, path aliases,
 * legacy patterns (module.exports, prototype, IIFE), React/Next.js
 */

'use strict';

const path = require('path');
const { safeRead, resolveImport, resolveAlias, lineAt } = require('../core/parser');

/**
 * Parse a JS/TS/JSX/TSX file and extract dependency information.
 */
function parse(filePath, rootDir, aliases) {
  const raw = safeRead(filePath);
  if (raw === null) {
    return { file: filePath, lang: 'typescript', imports: [], exports: [], gaps: [], meta: {}, error: true };
  }
  // Strip comments before parsing to avoid false edges from commented-out imports.
  // Preserve newlines so line numbers in gaps remain correct.
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');

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

  // Static dynamic imports: await import('./foo') — resolve as real edges, not gaps.
  // Only truly dynamic expressions (no string literal) remain as gaps.
  const staticDynImportRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = staticDynImportRe.exec(src)) !== null) {
    addImport(imports, m[1], filePath, rootDir, aliases);
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

  // export { X, Y as Z }  and  export type { X, Y as Z }
  const esExportBraceRe = /export\s+(?:type\s+)?\{([^}]+)\}/g;
  while ((m = esExportBraceRe.exec(src)) !== null) {
    for (const name of m[1].split(',')) {
      const part = name.trim().split(/\s+as\s+/).pop().trim();
      if (part) exports.add(part);
    }
  }

  // TypeScript-specific: export interface Foo / export type Foo / export enum Foo
  // export abstract class Foo / export declare ...
  const tsExportTypeRe = /export\s+(?:abstract\s+)?(?:interface|type|enum|declare\s+(?:class|function|const|interface|type|enum))\s+(\w+)/g;
  while ((m = tsExportTypeRe.exec(src)) !== null) {
    exports.add(m[1]);
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
    symbols: extractSymbols(src),
    error: false,
  };
}

/**
 * Extract top-level functions, classes, and arrow-function constants with line numbers.
 * Uses the comment-stripped source so line numbers stay correct.
 */
function extractSymbols(src) {
  const symbols = [];
  let m;

  // function declarations: function foo(  /  async function foo(  /  function* foo(
  const fnRe = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*\(/gm;
  while ((m = fnRe.exec(src)) !== null) {
    symbols.push({
      name:      m[1],
      kind:      'function',
      lineStart: lineAt(src, m.index),
      signature: src.slice(m.index, m.index + 80).split('\n')[0].trim(),
    });
  }

  // class declarations: class Foo  /  abstract class Foo
  const classRe = /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/gm;
  while ((m = classRe.exec(src)) !== null) {
    symbols.push({
      name:      m[1],
      kind:      'class',
      lineStart: lineAt(src, m.index),
      signature: src.slice(m.index, m.index + 80).split('\n')[0].trim(),
    });
  }

  // Top-level const arrow functions: const foo = (...) =>  /  const foo = async (...) =>
  // Must start at column 0 (no leading spaces — not a method inside a class/object)
  const arrowRe = /^(?:export\s+)?const\s+(\w+)\s*(?::[^=\n]+)?=\s*(?:async\s+)?\(/gm;
  while ((m = arrowRe.exec(src)) !== null) {
    // Confirm it's actually an arrow function (not an IIFE or plain assignment)
    const ahead = src.slice(m.index + m[0].length, m.index + m[0].length + 120);
    if (/=>\s*[\w{([]/.test(ahead) || /\)\s*(?::\s*\w[^=\n]*)?\s*=>/.test(ahead)) {
      symbols.push({
        name:      m[1],
        kind:      'function',
        lineStart: lineAt(src, m.index),
        signature: src.slice(m.index, m.index + 80).split('\n')[0].trim(),
      });
    }
  }

  // Deduplicate by name+line (arrow check may re-capture some declarations)
  const seen = new Set();
  return symbols.filter(s => {
    const key = `${s.name}:${s.lineStart}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function addImport(set, rawPath, fromFile, rootDir, aliases) {
  if (aliases) {
    const aliased = resolveAlias(rawPath, aliases);
    if (aliased) {
      // aliased is either absolute (from baseUrl) or rootDir-relative (from paths alias).
      // In both cases, convert to absolute first, then relativise from fromFile's directory
      // so that resolveImport treats it as a relative path correctly.
      const abs = path.isAbsolute(aliased) ? aliased : path.resolve(rootDir, aliased);
      rawPath = path.relative(path.dirname(fromFile), abs);
      if (!rawPath.startsWith('.')) rawPath = './' + rawPath;
    }
  }
  const resolved = resolveImport(fromFile, rawPath, rootDir);
  set.add(resolved);
}

module.exports = { parse };
