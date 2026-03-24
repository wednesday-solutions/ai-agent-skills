/**
 * Ruby language adapter
 * Handles: require/require_relative/load, def/class/module exports,
 * attr_* declarations, dynamic require gaps, Rails framework detection.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { safeRead } = require('../core/parser');

function parse(filePath, rootDir) {
  const src = safeRead(filePath);
  if (src === null) {
    return { file: filePath, lang: 'ruby', imports: [], exports: [], gaps: [], meta: {}, error: true };
  }

  const imports = new Set();
  const exports = new Set();
  const gaps = [];
  const meta = {};

  // Strip single-line comments
  const stripped = src.replace(/#[^\n]*/g, '');

  // ── Imports ───────────────────────────────────────────────────────────────

  // require_relative 'path' — always relative to current file
  const requireRelRe = /require_relative\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = requireRelRe.exec(stripped)) !== null) {
    const resolved = resolveRubyRelative(filePath, m[1], rootDir);
    imports.add(resolved);
  }

  // require 'path' — could be gem or internal
  const requireRe = /\brequire\s+['"]([^'"]+)['"]/g;
  while ((m = requireRe.exec(stripped)) !== null) {
    const raw = m[1];
    // If path-like (contains slash or starts with .) try to resolve
    if (raw.startsWith('./') || raw.startsWith('../') || raw.includes('/')) {
      const resolved = resolveRubyRelative(filePath, raw, rootDir);
      imports.add(resolved);
    } else {
      imports.add(raw); // gem name
    }
  }

  // load 'path'
  const loadRe = /\bload\s+['"]([^'"]+)['"]/g;
  while ((m = loadRe.exec(stripped)) !== null) {
    const resolved = resolveRubyRelative(filePath, m[1], rootDir);
    imports.add(resolved);
  }

  // ── Dynamic import gaps ───────────────────────────────────────────────────

  // require with variable: require(var) or require var_name
  const dynRequireRe = /\brequire\s*\(\s*[A-Za-z_$]|\brequire\s+[A-Za-z_$]/g;
  while ((m = dynRequireRe.exec(stripped)) !== null) {
    // Make sure it's not caught by the string literal patterns above
    if (!/'|"/.test(m[0])) {
      gaps.push({ type: 'dynamic-require', line: lineAt(src, m.index), pattern: m[0].trim() });
    }
  }

  // send(:method, ...) — metaprogramming
  const sendRe = /\.send\s*\(|method\s*\(/g;
  while ((m = sendRe.exec(stripped)) !== null) {
    gaps.push({ type: 'metaprogramming', line: lineAt(src, m.index), pattern: m[0] });
  }

  // ── Exports ───────────────────────────────────────────────────────────────

  // module Foo / class Foo / class Foo < Bar
  const moduleClassRe = /^(?:module|class)\s+([A-Z]\w*)/gm;
  while ((m = moduleClassRe.exec(stripped)) !== null) {
    exports.add(m[1]);
  }

  // def method_name / def self.class_method
  const defRe = /^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!]?)/gm;
  while ((m = defRe.exec(stripped)) !== null) {
    exports.add(m[1]);
  }

  // attr_reader/writer/accessor :name, :other
  const attrRe = /\battr_(?:reader|writer|accessor)\s+((?::\w+\s*,?\s*)+)/g;
  while ((m = attrRe.exec(stripped)) !== null) {
    const attrs = m[1].match(/:(\w+)/g) || [];
    for (const a of attrs) exports.add(a.slice(1));
  }

  // ── Meta: framework detection ─────────────────────────────────────────────

  const basename = path.basename(filePath);

  if (/ApplicationController|ApplicationRecord|ActiveRecord::Base|ActionController|ActionMailer/.test(src)) {
    meta.framework = 'rails';
  } else if (/Sinatra::Base|require\s+['"]sinatra['"]/.test(src)) {
    meta.framework = 'sinatra';
  } else if (/require\s+['"]hanami|Hanami::/.test(src)) {
    meta.framework = 'hanami';
  }

  // Entry points
  const entryNames = new Set(['config.ru', 'Rakefile', 'Gemfile', 'app.rb', 'server.rb', 'main.rb', 'bin/rails', 'bin/rake', 'bin/rspec']);
  if (entryNames.has(basename) || entryNames.has(path.relative(rootDir, filePath)) || /^#!/.test(src)) {
    meta.isEntryPoint = true;
  }

  // ── Annotations ───────────────────────────────────────────────────────────

  const annotationRe = /#\s*@wednesday-skills:(\S+)\s+(.*)/g;
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
    lang: 'ruby',
    imports: [...imports],
    exports: [...exports],
    gaps,
    meta,
    error: false,
  };
}

function resolveRubyRelative(fromFile, rawPath, rootDir) {
  const fromDir = path.dirname(fromFile);
  // Strip .rb extension from import path if present; we'll try both
  const base = rawPath.replace(/\.rb$/, '');
  const candidates = [
    path.resolve(fromDir, rawPath),
    path.resolve(fromDir, base + '.rb'),
    path.resolve(fromDir, base),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return path.relative(rootDir, c);
  }

  return rawPath; // unresolvable — keep raw
}

function lineAt(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

module.exports = { parse };
