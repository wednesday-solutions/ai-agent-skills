/**
 * 2A-1 — Tree-sitter core abstraction
 * Defines the adapter contract all language parsers must implement.
 * Uses regex-based AST extraction — fast, zero native compilation.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * ParseResult — what every adapter must return
 * @typedef {Object} ParseResult
 * @property {string}   file        - absolute path
 * @property {string}   lang        - detected language
 * @property {string[]} imports     - files/modules this file imports
 * @property {string[]} exports     - names exported
 * @property {Object[]} gaps        - dynamic patterns that need subagent resolution
 * @property {Object}   meta        - extra data (framework hints, etc.)
 * @property {boolean}  error       - true if file was skipped/malformed
 */

/**
 * Map file extensions to language names
 */
const EXT_MAP = {
  '.js':   'javascript',
  '.jsx':  'javascript',
  '.ts':   'typescript',
  '.tsx':  'typescript',
  '.mjs':  'javascript',
  '.cjs':  'javascript',
  '.go':   'go',
  '.graphql': 'graphql',
  '.gql':  'graphql',
  '.kt':   'kotlin',
  '.kts':  'kotlin',
};

/**
 * Detect language from file path
 */
function detectLang(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_MAP[ext] || 'unknown';
}

/**
 * Safe file read — returns null on any error (malformed, binary, permissions)
 */
function safeRead(filePath) {
  try {
    const stat = fs.statSync(filePath);
    // Skip files > 2MB — too large to parse usefully
    if (stat.size > 2 * 1024 * 1024) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Resolve a relative import path to an absolute path, trying common extensions
 */
function resolveImport(fromFile, importPath, rootDir) {
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    // External package — return as-is
    return importPath;
  }

  const fromDir = path.dirname(fromFile);
  const resolved = path.resolve(fromDir, importPath);

  // Try exact path first
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    return path.relative(rootDir, resolved);
  }

  // Try with extensions
  const exts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
  for (const ext of exts) {
    const candidate = resolved + ext;
    if (fs.existsSync(candidate)) {
      return path.relative(rootDir, candidate);
    }
  }

  // Try as directory with index file
  for (const ext of exts) {
    const candidate = path.join(resolved, 'index' + ext);
    if (fs.existsSync(candidate)) {
      return path.relative(rootDir, candidate);
    }
  }

  // Return raw relative path (may be external or unresolvable)
  return importPath;
}

/**
 * Resolve path alias from tsconfig/jsconfig paths
 * e.g. @/components/Foo → src/components/Foo
 */
function resolveAlias(importPath, aliases) {
  if (!aliases) return null;
  for (const [alias, targets] of Object.entries(aliases)) {
    const prefix = alias.replace(/\*$/, '');
    if (importPath.startsWith(prefix)) {
      const suffix = importPath.slice(prefix.length);
      const target = (Array.isArray(targets) ? targets[0] : targets).replace(/\*$/, '');
      return target + suffix;
    }
  }
  return null;
}

/**
 * Load path aliases from tsconfig.json / jsconfig.json in rootDir
 */
function loadAliases(rootDir) {
  const candidates = ['tsconfig.json', 'jsconfig.json'];
  for (const name of candidates) {
    const file = path.join(rootDir, name);
    if (!fs.existsSync(file)) continue;
    try {
      const raw = fs.readFileSync(file, 'utf8');
      // Strip comments before JSON.parse
      const stripped = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const config = JSON.parse(stripped);
      const paths = config?.compilerOptions?.paths;
      if (paths) return paths;
    } catch {
      // Ignore parse errors
    }
  }
  return null;
}

module.exports = {
  detectLang,
  safeRead,
  resolveImport,
  resolveAlias,
  loadAliases,
  EXT_MAP,
};
