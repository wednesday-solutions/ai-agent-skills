'use strict';

const fg = require('fast-glob');
const path = require('path');
const fs = require('fs');
const { GraphStore } = require('./store');
const { buildSymbolIndex } = require('./symbol-index');
const { extractCallEdges } = require('./calls-extractor');
const tsAdapter = require('../adapters/typescript');
const goAdapter = require('../adapters/go');
const pyAdapter = require('../adapters/python');

function loadAliases(rootDir) {
  const tsPath = path.join(rootDir, 'tsconfig.json');
  const jsPath = path.join(rootDir, 'jsconfig.json');
  let config = null;
  if (fs.existsSync(tsPath)) {
    try { config = JSON.parse(fs.readFileSync(tsPath, 'utf8')); } catch {}
  } else if (fs.existsSync(jsPath)) {
    try { config = JSON.parse(fs.readFileSync(jsPath, 'utf8')); } catch {}
  }

  if (config && config.compilerOptions && config.compilerOptions.paths) {
    const aliases = {};
    for (const [alias, targets] of Object.entries(config.compilerOptions.paths)) {
      const cleanAlias = alias.replace('/*', '');
      const cleanTarget = targets[0].replace('/*', '');
      aliases[cleanAlias] = path.resolve(rootDir, cleanTarget);
    }
    return aliases;
  }
  return null;
}

function parseFile(filePath, rootDir, aliases, goModulePath) {
  const ext = path.extname(filePath);
  if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
    return tsAdapter.parse(filePath, rootDir, aliases);
  }
  if (ext === '.go') {
    return goAdapter.parse(filePath, rootDir, goModulePath);
  }
  if (ext === '.py') {
    return pyAdapter.parse(filePath, rootDir);
  }
  return null;
}

function collectFiles(rootDir, opts = {}) {
  const patterns = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.go', '**/*.py'];
  const ignore = opts.ignore || ['**/node_modules/**', '**/vendor/**', '**/dist/**', '**/build/**', '**/.git/**'];
  return fg.sync(patterns, { cwd: rootDir, ignore, absolute: true });
}

function buildGraph(rootDir, opts = {}) {
  const files = opts.files || collectFiles(rootDir, opts);
  const aliases = loadAliases(rootDir);
  const goModulePath = goAdapter.loadModulePath ? goAdapter.loadModulePath(rootDir) : null;

  const nodes = {};

  // 1. First Pass: Parse
  for (const filePath of files) {
    const rel = path.relative(rootDir, filePath);
    let result;
    try {
      result = parseFile(filePath, rootDir, aliases, goModulePath);
    } catch (e) {
      console.warn(`[analysis] Error parsing ${rel}:`, e.message);
      result = { error: true, lang: 'typescript', imports: [], exports: [], gaps: [], symbols: [], meta: {} };
    }

    if (!result) continue;

    nodes[rel] = {
      file: rel,
      lang: result.lang || 'typescript',
      symbols: result.symbols || [],
      imports: result.imports || [],
      exports: result.exports || [],
      gaps: result.gaps || [],
      meta: result.meta || {},
      error: !!result.error
    };
  }

  // Build index from all nodes
  const symbolIndex = buildSymbolIndex(nodes);

  // 2. Second Pass: Edges
  for (const rel of Object.keys(nodes)) {
    const node = nodes[rel];
    if (node.error) continue;

    const filePath = path.isAbsolute(rel) ? rel : path.join(rootDir, rel);
    if (!fs.existsSync(filePath)) continue;
    const src = fs.readFileSync(filePath, 'utf8');

    const fileCalls = extractCallEdges(rel, src, node, symbolIndex);
    node.imports = node.imports || [];
    // node.symbolCalls is assigned inside extractCallEdges
  }

  return { nodes };
}

function computeRiskScore(node, testCoverage = 0) {
  const dependents = (node.importedBy || []).length;
  const isPublicContract = (node.exports || []).length > 0 && dependents > 0;

  const raw = Math.round(
    (Math.min(dependents, 50) * 1.2) +
    (isPublicContract ? 25 : 0) +
    ((100 - testCoverage) * 0.15)
  );

  return Math.min(100, raw);
}

function writeGraph(graph, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'dep-graph.json'), JSON.stringify(graph, null, 2));
}

module.exports = {
  collectFiles,
  buildGraph,
  computeRiskScore,
  writeGraph
};
