/**
 * Python language adapter
 * Handles: import/from-import statements, def/class exports,
 * relative imports, dynamic import gaps, framework detection.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { safeRead } = require('../core/parser');

function parse(filePath, rootDir) {
  const src = safeRead(filePath);
  if (src === null) {
    return { file: filePath, lang: 'python', imports: [], exports: [], gaps: [], meta: {}, error: true };
  }

  const imports = new Set();
  const exports = new Set();
  const gaps = [];
  const meta = {};

  // Strip single-line comments (preserve newlines for line tracking)
  const stripped = src.replace(/#[^\n]*/g, '');

  // ── Imports ───────────────────────────────────────────────────────────────

  // import foo, import foo.bar, import foo as f, import foo, bar
  const importRe = /^import\s+([\w.,\s*]+)/gm;
  let m;
  while ((m = importRe.exec(stripped)) !== null) {
    const parts = m[1].split(',');
    for (const part of parts) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) imports.add(name);
    }
  }

  // from foo import bar / from .foo import bar / from ..foo import bar
  const fromRe = /^from\s+(\.{0,3}[\w.]*)\s+import\s+/gm;
  while ((m = fromRe.exec(stripped)) !== null) {
    const raw = m[1];
    const resolved = resolvePythonImport(filePath, raw, rootDir);
    imports.add(resolved);
  }

  // ── Dynamic import gaps ───────────────────────────────────────────────────

  const dynamicImportRe = /__import__\s*\(|importlib\.import_module\s*\(|importlib\.util\.spec_from_file_location\s*\(/g;
  while ((m = dynamicImportRe.exec(stripped)) !== null) {
    gaps.push({ type: 'dynamic-import', line: lineAt(src, m.index), pattern: m[0] });
  }

  const execEvalRe = /\bexec\s*\(|\beval\s*\(/g;
  while ((m = execEvalRe.exec(stripped)) !== null) {
    gaps.push({ type: 'dynamic-eval', line: lineAt(src, m.index), pattern: m[0] });
  }

  // ── Exports (top-level definitions) ──────────────────────────────────────

  // def function_name (top-level = not indented)
  const defRe = /^def\s+([A-Za-z_]\w*)/gm;
  while ((m = defRe.exec(stripped)) !== null) {
    exports.add(m[1]);
  }

  // class ClassName
  const classRe = /^class\s+([A-Za-z_]\w*)/gm;
  while ((m = classRe.exec(stripped)) !== null) {
    exports.add(m[1]);
  }

  // Top-level UPPER_CASE constants
  const constRe = /^([A-Z][A-Z0-9_]{2,})\s*=/gm;
  while ((m = constRe.exec(stripped)) !== null) {
    exports.add(m[1]);
  }

  // ── Meta: framework detection ─────────────────────────────────────────────

  const basename = path.basename(filePath);

  if (/\bDjango\b|\bdjango\b/.test(src) || basename === 'settings.py' || basename === 'urls.py' || basename === 'views.py' || basename === 'models.py') {
    meta.framework = 'django';
  } else if (/Flask\s*\(|from\s+flask/.test(src)) {
    meta.framework = 'flask';
  } else if (/FastAPI\s*\(|from\s+fastapi/.test(src)) {
    meta.framework = 'fastapi';
  }

  // __init__.py is a barrel (re-export aggregator)
  if (basename === '__init__.py') meta.isBarrel = true;

  // Entry point: has __main__ block, or is a known entry filename
  const entryNames = new Set(['manage.py', 'wsgi.py', 'asgi.py', 'app.py', 'main.py', 'run.py', 'server.py', 'cli.py', 'worker.py']);
  if (src.includes("if __name__ == '__main__':") || src.includes('if __name__ == "__main__":') || entryNames.has(basename)) {
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
    lang: 'python',
    imports: [...imports],
    exports: [...exports],
    gaps,
    meta,
    error: false,
  };
}

/**
 * Resolve a Python import path to a relative file path or external package name.
 * Handles relative imports (., .., ...) and absolute package paths.
 */
function resolvePythonImport(fromFile, rawImport, rootDir) {
  // Relative import — count leading dots
  const relMatch = rawImport.match(/^(\.+)([\w.]*)?$/);
  if (relMatch) {
    const dots = relMatch[1].length;
    const rest = relMatch[2] || '';
    let dir = path.dirname(fromFile);
    for (let i = 1; i < dots; i++) dir = path.dirname(dir);

    if (!rest) return path.relative(rootDir, dir);

    const subPath = rest.replace(/\./g, path.sep);
    const candidate = path.join(dir, subPath);

    // Try as file or package
    if (fs.existsSync(candidate + '.py')) return path.relative(rootDir, candidate + '.py');
    if (fs.existsSync(path.join(candidate, '__init__.py'))) return path.relative(rootDir, path.join(candidate, '__init__.py'));
    return path.relative(rootDir, candidate);
  }

  // Absolute import — try to resolve from rootDir
  const subPath = rawImport.replace(/\./g, path.sep);
  const candidate = path.join(rootDir, subPath);
  if (fs.existsSync(candidate + '.py')) return path.relative(rootDir, candidate + '.py');
  if (fs.existsSync(path.join(candidate, '__init__.py'))) return path.relative(rootDir, path.join(candidate, '__init__.py'));

  // External package
  return rawImport;
}

function lineAt(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

module.exports = { parse };
