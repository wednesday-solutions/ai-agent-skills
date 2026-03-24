/**
 * PHP language adapter
 * Handles: require/include/use statements, class/interface/trait/function exports,
 * dynamic include gaps, Laravel/Symfony framework detection.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { safeRead } = require('../core/parser');

function parse(filePath, rootDir) {
  const src = safeRead(filePath);
  if (src === null) {
    return { file: filePath, lang: 'php', imports: [], exports: [], gaps: [], meta: {}, error: true };
  }

  const imports = new Set();
  const exports = new Set();
  const gaps = [];
  const meta = {};

  // Strip block and line comments
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '')
    .replace(/#[^\n]*/g, '');

  // ── Require / Include (path-based) ───────────────────────────────────────

  // require/include with string literal paths
  const pathIncludeRe = /(?:require|require_once|include|include_once)\s*\(?['"]([^'"]+)['"]\)?/g;
  let m;
  while ((m = pathIncludeRe.exec(stripped)) !== null) {
    const resolved = resolvePHPPath(filePath, m[1], rootDir);
    imports.add(resolved);
  }

  // __DIR__ . '/path' patterns
  const dirConcatRe = /(?:require|require_once|include|include_once)\s*\(?__DIR__\s*\.\s*['"]([^'"]+)['"]\)?/g;
  while ((m = dirConcatRe.exec(stripped)) !== null) {
    const resolved = resolvePHPPath(filePath, m[1], rootDir, true);
    imports.add(resolved);
  }

  // ── use Namespace\Class (PSR-4 autoload) ─────────────────────────────────

  const useRe = /^use\s+([\w\\]+(?:\s*,\s*[\w\\]+)*)\s*;/gm;
  while ((m = useRe.exec(stripped)) !== null) {
    const parts = m[1].split(',');
    for (const part of parts) {
      const ns = part.trim().split(/\s+as\s+/)[0].trim();
      // Try to resolve namespace to file
      const resolved = resolveNamespace(ns, rootDir);
      imports.add(resolved);
    }
  }

  // ── Dynamic include gaps ─────────────────────────────────────────────────

  // require/include with variable
  const dynIncludeRe = /(?:require|require_once|include|include_once)\s*\(?\s*\$/g;
  while ((m = dynIncludeRe.exec(stripped)) !== null) {
    gaps.push({ type: 'dynamic-require', line: lineAt(src, m.index), pattern: 'dynamic include/require' });
  }

  // new $className — variable class instantiation
  const dynNewRe = /new\s+\$[A-Za-z_]/g;
  while ((m = dynNewRe.exec(stripped)) !== null) {
    gaps.push({ type: 'dynamic-instantiation', line: lineAt(src, m.index), pattern: m[0] });
  }

  // call_user_func / call_user_func_array
  const callUserRe = /call_user_func(?:_array)?\s*\(/g;
  while ((m = callUserRe.exec(stripped)) !== null) {
    gaps.push({ type: 'dynamic-call', line: lineAt(src, m.index), pattern: m[0] });
  }

  // ── Exports ───────────────────────────────────────────────────────────────

  // class Foo / abstract class Foo / final class Foo
  const classRe = /(?:abstract\s+|final\s+)?class\s+([A-Za-z_]\w*)/g;
  while ((m = classRe.exec(stripped)) !== null) {
    exports.add(m[1]);
  }

  // interface / trait / enum
  const typeRe = /\b(?:interface|trait|enum)\s+([A-Za-z_]\w*)/g;
  while ((m = typeRe.exec(stripped)) !== null) {
    exports.add(m[1]);
  }

  // Top-level function declarations
  const funcRe = /^function\s+([A-Za-z_]\w*)\s*\(/gm;
  while ((m = funcRe.exec(stripped)) !== null) {
    exports.add(m[1]);
  }

  // const / define()
  const constRe = /\bconst\s+([A-Z_][A-Z0-9_]*)\s*=/g;
  while ((m = constRe.exec(stripped)) !== null) {
    exports.add(m[1]);
  }

  // ── Meta: framework detection ─────────────────────────────────────────────

  if (/Illuminate\\|extends\s+Controller|extends\s+Model|use\s+Laravel/.test(src)) {
    meta.framework = 'laravel';
  } else if (/Symfony\\|extends\s+AbstractController|extends\s+Controller/.test(src) && /Symfony/.test(src)) {
    meta.framework = 'symfony';
  } else if (/WordPress|wp_|get_post|add_action|add_filter/.test(src)) {
    meta.framework = 'wordpress';
  } else if (/Magento\\|extends\s+AbstractModel|extends\s+Action/.test(src)) {
    meta.framework = 'magento';
  } else if (/Zend\\|extends\s+Zend/.test(src)) {
    meta.framework = 'zend';
  } else if (/CodeIgniter\\|extends\s+CI_Controller/.test(src)) {
    meta.framework = 'codeigniter';
  }

  // Entry points
  const basename = path.basename(filePath);
  const entryNames = new Set(['index.php', 'app.php', 'bootstrap.php', 'server.php', 'artisan', 'public/index.php', 'web/app.php']);
  if (entryNames.has(basename) || entryNames.has(path.relative(rootDir, filePath))) {
    meta.isEntryPoint = true;
  }

  // ── Annotations ───────────────────────────────────────────────────────────

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
    lang: 'php',
    imports: [...imports],
    exports: [...exports],
    gaps,
    meta,
    error: false,
  };
}

function resolvePHPPath(fromFile, rawPath, rootDir, fromDir = false) {
  const base = fromDir ? path.dirname(fromFile) : path.dirname(fromFile);
  // Remove leading slash from __DIR__ . '/path' patterns
  const cleaned = rawPath.replace(/^\//, '');
  const candidate = path.resolve(base, cleaned);

  if (fs.existsSync(candidate)) return path.relative(rootDir, candidate);

  // Also try from rootDir (common for Laravel)
  const fromRoot = path.resolve(rootDir, cleaned);
  if (fs.existsSync(fromRoot)) return path.relative(rootDir, fromRoot);

  return rawPath;
}

/**
 * Attempt to resolve a PSR-4 namespace to a file.
 * e.g. App\Http\Controllers\UserController → app/Http/Controllers/UserController.php
 */
function resolveNamespace(ns, rootDir) {
  // Common PSR-4 root mappings
  const nsParts = ns.replace(/\\/g, '/');
  const candidates = [
    nsParts + '.php',
    'app/' + nsParts.replace(/^App\//, '') + '.php',
    'src/' + nsParts + '.php',
    'lib/' + nsParts + '.php',
  ];

  for (const rel of candidates) {
    if (fs.existsSync(path.join(rootDir, rel))) return rel;
    // Case-insensitive attempt — lowercase first segment
    const lower = rel.charAt(0).toLowerCase() + rel.slice(1);
    if (fs.existsSync(path.join(rootDir, lower))) return lower;
  }

  return ns; // external/unresolvable — return as namespace string
}

function lineAt(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

module.exports = { parse };
