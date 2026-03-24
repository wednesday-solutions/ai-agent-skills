/**
 * C / C++ language adapter
 * Handles: #include directives, function/struct/class/enum exports,
 * function pointer and dlopen gaps, entry point detection.
 * One adapter covers both C (.c, .h) and C++ (.cpp, .cc, .cxx, .hpp).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { safeRead } = require('../core/parser');

function parse(filePath, rootDir) {
  const src = safeRead(filePath);
  if (src === null) {
    return { file: filePath, lang: detectLang(filePath), imports: [], exports: [], gaps: [], meta: {}, error: true };
  }

  const lang = detectLang(filePath);
  const imports = new Set();
  const exports = new Set();
  const gaps = [];
  const meta = {};

  // Strip block comments, preserve newlines for line tracking
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');

  // ── #include directives ───────────────────────────────────────────────────

  // Local includes: #include "path/to/file.h"
  const localIncludeRe = /#include\s+"([^"]+)"/g;
  let m;
  while ((m = localIncludeRe.exec(stripped)) !== null) {
    const resolved = resolveInclude(filePath, m[1], rootDir);
    imports.add(resolved);
  }

  // System/external includes: #include <file.h>
  const sysIncludeRe = /#include\s+<([^>]+)>/g;
  while ((m = sysIncludeRe.exec(stripped)) !== null) {
    imports.add(`<${m[1]}>`); // mark as external system header
  }

  // ── Exports ───────────────────────────────────────────────────────────────

  // Function definitions: return_type func_name(  (not inside structs, best-effort)
  // Matches: void foo(, int bar(, static char* baz(, etc.
  const funcRe = /^(?:(?:static|extern|inline|__attribute__\s*\(\([^)]*\)\))\s+)*(?:const\s+)?(?:unsigned\s+|signed\s+)?(?:[\w*:]+\s+)+([A-Za-z_]\w*)\s*\(/gm;
  while ((m = funcRe.exec(stripped)) !== null) {
    const name = m[1];
    // Filter out C++ keywords and common false positives
    if (!KEYWORDS.has(name)) {
      exports.add(name);
    }
  }

  // struct / union / enum / class (C++) definitions
  const typeRe = /\b(?:struct|union|enum|class)\s+([A-Za-z_]\w*)\s*[{;]/g;
  while ((m = typeRe.exec(stripped)) !== null) {
    exports.add(m[1]);
  }

  // #define macros (public API surface in C)
  const defineRe = /^#define\s+([A-Z_][A-Z0-9_]{2,})\s/gm;
  while ((m = defineRe.exec(src)) !== null) {
    exports.add(m[1]);
  }

  // C++ namespace exports
  if (lang === 'cpp') {
    const nsRe = /\bnamespace\s+([A-Za-z_]\w*)\s*\{/g;
    while ((m = nsRe.exec(stripped)) !== null) {
      if (m[1] !== 'std') exports.add(`ns:${m[1]}`);
    }
  }

  // ── Gaps ──────────────────────────────────────────────────────────────────

  // Function pointers (dynamic dispatch)
  const fnPtrRe = /\(\s*\*\s*\w+\s*\)\s*\(/g;
  while ((m = fnPtrRe.exec(stripped)) !== null) {
    gaps.push({ type: 'function-pointer', line: lineAt(src, m.index), pattern: m[0].slice(0, 40) });
  }

  // dlopen / dlsym — dynamic library loading
  const dlRe = /\bdlopen\s*\(|\bdlsym\s*\(|\bLoadLibrary\s*\(|\bGetProcAddress\s*\(/g;
  while ((m = dlRe.exec(stripped)) !== null) {
    gaps.push({ type: 'dynamic-load', line: lineAt(src, m.index), pattern: m[0].trim() });
  }

  // C++ virtual dispatch (best-effort — flag files with vtables)
  if (lang === 'cpp' && /\bvirtual\b/.test(stripped)) {
    meta.hasVirtualDispatch = true;
    gaps.push({ type: 'virtual-dispatch', line: 0, pattern: 'class with virtual methods' });
  }

  // C++ templates (may instantiate external types)
  if (lang === 'cpp') {
    const templateRe = /\btemplate\s*</g;
    if (templateRe.test(stripped)) {
      meta.hasTemplates = true;
    }
  }

  // ── Meta: framework / platform detection ─────────────────────────────────

  if (/avr\/|Arduino\.h|PROGMEM|F\(["']/.test(src)) {
    meta.framework = 'arduino';
  } else if (/Q_OBJECT|#include\s*<Q[A-Z]|QApplication|QWidget/.test(src)) {
    meta.framework = 'qt';
  } else if (/Windows\.h|WinMain|HWND|HINSTANCE/.test(src)) {
    meta.framework = 'win32';
  } else if (/OpenGL|GL\.h|GLFW|glad\.h/.test(src)) {
    meta.framework = 'opengl';
  } else if (/boost\/|std::/.test(src)) {
    meta.framework = 'cpp-stdlib';
  }

  // Header file — usually a public interface, not an entry point
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.h' || ext === '.hpp' || ext === '.hh') {
    meta.isHeader = true;
  }

  // Entry point: int main(
  if (/\bint\s+main\s*\(/.test(stripped) || /\bWinMain\s*\(/.test(stripped)) {
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
    lang,
    imports: [...imports],
    exports: [...exports],
    gaps,
    meta,
    error: false,
  };
}

function detectLang(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (ext === '.c' || ext === '.h') ? 'c' : 'cpp';
}

function resolveInclude(fromFile, rawPath, rootDir) {
  const fromDir = path.dirname(fromFile);
  const candidate = path.resolve(fromDir, rawPath);

  if (fs.existsSync(candidate)) return path.relative(rootDir, candidate);

  // Try from rootDir (common for project-wide headers)
  const fromRoot = path.resolve(rootDir, rawPath);
  if (fs.existsSync(fromRoot)) return path.relative(rootDir, fromRoot);

  // Common include dirs: include/, src/, lib/
  for (const base of ['include', 'src', 'lib', 'Inc', 'Include']) {
    const c2 = path.resolve(rootDir, base, rawPath);
    if (fs.existsSync(c2)) return path.relative(rootDir, c2);
  }

  return rawPath;
}

function lineAt(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

// C/C++ keywords to exclude from exports
const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'return', 'break', 'continue',
  'sizeof', 'typeof', 'alignof', 'new', 'delete', 'operator', 'template', 'typename',
  'namespace', 'using', 'class', 'struct', 'union', 'enum', 'public', 'private',
  'protected', 'virtual', 'override', 'final', 'explicit', 'friend', 'inline',
  'static', 'extern', 'const', 'constexpr', 'volatile', 'auto', 'register',
  'unsigned', 'signed', 'long', 'short', 'int', 'char', 'float', 'double', 'void',
  'bool', 'nullptr', 'true', 'false', 'NULL', 'main',
]);

module.exports = { parse };
