/**
 * 2A-2 — GraphQL language adapter
 * Handles: type definitions, schema stitching, #import directives,
 * extend type, interface implementations
 */

'use strict';

const path = require('path');
const { safeRead, resolveImport } = require('../core/parser');

function parse(filePath, rootDir) {
  const src = safeRead(filePath);
  if (src === null) {
    return { file: filePath, lang: 'graphql', imports: [], exports: [], gaps: [], meta: {}, error: true };
  }

  const imports = new Set();
  const exports = new Set();
  const gaps = [];
  const meta = {};

  // ── #import directives (graphql-import / schema stitching) ────────────────
  const importRe = /#import\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(src)) !== null) {
    const resolved = resolveImport(filePath, m[1], rootDir);
    imports.add(resolved);
  }

  // ── Type definitions ──────────────────────────────────────────────────────
  const typeRe = /^\s*(?:type|interface|enum|input|union|scalar)\s+(\w+)/gm;
  while ((m = typeRe.exec(src)) !== null) {
    exports.add(m[1]);
  }

  // ── extend type — marks a stitching point ─────────────────────────────────
  const extendRe = /^\s*extend\s+type\s+(\w+)/gm;
  while ((m = extendRe.exec(src)) !== null) {
    meta.extends = meta.extends || [];
    meta.extends.push(m[1]);
  }

  // ── Detect schema file ────────────────────────────────────────────────────
  if (src.includes('type Query') || src.includes('type Mutation') || src.includes('schema {')) {
    meta.isSchema = true;
  }

  return {
    file: filePath,
    lang: 'graphql',
    imports: [...imports],
    exports: [...exports],
    gaps,
    meta,
    error: false,
  };
}

module.exports = { parse };
