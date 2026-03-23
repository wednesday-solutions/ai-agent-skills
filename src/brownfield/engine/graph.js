/**
 * 2A-4 — Dependency graph engine
 * Merges all adapter outputs into a unified dep-graph.json
 * Computes: importedBy, riskScore, isEntryPoint, isBarrel per node
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { detectLang, loadAliases } = require('../core/parser');
const tsAdapter     = require('../adapters/typescript');
const goAdapter     = require('../adapters/go');
const gqlAdapter    = require('../adapters/graphql');
const kotlinAdapter = require('../adapters/kotlin');
const swiftAdapter  = require('../adapters/swift');  // also exports resolveIntraModuleEdges
const nestjsParser = require('../parsers/nestjs');
const gitHistory = require('../parsers/git-history');
const cocoapodsParser = require('../parsers/cocoapods');
const spmParser = require('../parsers/spm');
const serverlessParser = require('../parsers/serverless');

const SUPPORTED_LANGS = new Set(['javascript', 'typescript', 'go', 'graphql', 'kotlin', 'swift']);

/**
 * Collect all analysable files under rootDir
 */
function collectFiles(rootDir, opts = {}) {
  const ignore = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', 'coverage',
    '.wednesday', 'vendor', '__pycache__', '.gradle',
    'Pods', 'DerivedData', '.build', 'xcuserdata',   // iOS/Swift
    'Carthage', 'fastlane',
    ...(opts.ignore || []),
  ]);

  const files = [];
  const exts = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.go', '.graphql', '.gql', '.kt', '.kts', '.swift']);

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (ignore.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && exts.has(path.extname(entry.name))) {
        files.push(full);
      }
    }
  }

  walk(rootDir);
  return files;
}

/**
 * Parse a single file using the appropriate adapter
 */
function parseFile(filePath, rootDir, aliases, goModulePath) {
  const lang = detectLang(filePath);

  switch (lang) {
    case 'javascript':
    case 'typescript':
      return tsAdapter.parse(filePath, rootDir, aliases);
    case 'go':
      return goAdapter.parse(filePath, rootDir, aliases, goModulePath);
    case 'graphql':
      return gqlAdapter.parse(filePath, rootDir);
    case 'kotlin':
      return kotlinAdapter.parse(filePath, rootDir);
    case 'swift':
      return swiftAdapter.parse(filePath, rootDir);
    default:
      return null;
  }
}

/**
 * Build the full dependency graph
 * @param {string} rootDir
 * @param {Object} opts - { files?: string[], withGitHistory?: boolean, cache?: Object }
 * @returns {Object} graph
 */
function buildGraph(rootDir, opts = {}) {
  const aliases = loadAliases(rootDir);
  const goModulePath = goAdapter.loadModulePath(rootDir);

  const files = opts.files || collectFiles(rootDir);
  const cache = opts.cache || {};

  // ── Parse all files ───────────────────────────────────────────────────────
  const nodes = {};

  for (const filePath of files) {
    const rel = path.relative(rootDir, filePath);
    const result = parseFile(filePath, rootDir, aliases, goModulePath);
    if (!result) continue;

    // NestJS DI enrichment
    const nestInfo = result.lang === 'typescript' ? nestjsParser.parse(filePath) : { edges: [], meta: {} };

    // Git history
    const gitData = opts.withGitHistory ? gitHistory.mineFile(filePath, rootDir) : null;

    nodes[rel] = {
      file: rel,
      lang: result.lang,
      imports: result.imports,
      exports: result.exports,
      gaps: result.gaps,
      importedBy: [],             // computed below
      riskScore: 0,               // computed below
      isEntryPoint: false,        // computed below
      isBarrel: result.meta?.isBarrel || false,
      nestEdges: nestInfo.edges,
      meta: { ...result.meta, ...nestInfo.meta, ...(gitData ? { gitHistory: gitData } : {}) },
      error: result.error,
    };
  }

  // ── Swift: resolve intra-module type-reference edges ─────────────────────
  // Swift apps compile as a single module — files reference each other by
  // type name, not by import statements. This second pass scans every Swift
  // file for usages of types exported by other Swift files in the project,
  // turning type references into real dependency edges.
  const hasSwift = Object.values(nodes).some(n => n.lang === 'swift');
  if (hasSwift) {
    swiftAdapter.resolveIntraModuleEdges(nodes, rootDir);
  }

  // ── Build importedBy (reverse edges) ─────────────────────────────────────
  for (const [file, node] of Object.entries(nodes)) {
    for (const imp of node.imports) {
      if (nodes[imp]) {
        nodes[imp].importedBy.push(file);
      }
    }
  }

  // ── Detect entry points ───────────────────────────────────────────────────
  // Entry points: files that are not imported by anyone, AND not barrel files
  for (const node of Object.values(nodes)) {
    if (node.importedBy.length === 0 && !node.isBarrel) {
      // Heuristic: check filename patterns
      const basename = path.basename(node.file, path.extname(node.file));
      if (['index', 'main', 'app', 'server', 'handler', 'bootstrap'].includes(basename.toLowerCase())) {
        node.isEntryPoint = true;
      }
    }
  }

  // ── Compute risk scores ───────────────────────────────────────────────────
  for (const node of Object.values(nodes)) {
    node.riskScore = computeRiskScore(node);
  }

  // ── Supplementary: CocoaPods + SPM ───────────────────────────────────────
  const ios = {
    cocoapods: cocoapodsParser.parse(rootDir),
    spm: spmParser.parse(rootDir),
  };

  // ── Supplementary: Serverless ─────────────────────────────────────────────
  const serverless = serverlessParser.parse(rootDir);
  // Add serverless edges to graph
  for (const edge of serverless.edges) {
    if (nodes[edge.from]) {
      nodes[edge.from].imports.push(edge.to);
      // Add synthetic "trigger" node
      if (!nodes[edge.to]) {
        nodes[edge.to] = {
          file: edge.to,
          lang: 'config',
          imports: [],
          exports: [],
          gaps: [],
          importedBy: [edge.from],
          riskScore: 0,
          isEntryPoint: true,
          isBarrel: false,
          nestEdges: [],
          meta: { isServerlessTrigger: true, strength: 'config' },
          error: false,
        };
      }
    }
  }

  const graph = {
    version: 2,
    generatedAt: new Date().toISOString(),
    rootDir,
    nodes,
    packages: { ios },
    serverless,
    stats: computeStats(nodes),
  };

  return graph;
}

/**
 * Risk score: 0–100
 * score = min(100, (min(dependents,50)*1.2) + (isPublicContract?25:0) + ((100-testCoverage)*0.15))
 */
function computeRiskScore(node, testCoverage = 50) {
  const dependents = node.importedBy.length;
  const isPublicContract = node.exports.length > 0 && dependents > 0;
  return Math.min(100, Math.round(
    (Math.min(dependents, 50) * 1.2) +
    (isPublicContract ? 25 : 0) +
    ((100 - testCoverage) * 0.15)
  ));
}

function computeStats(nodes) {
  const all = Object.values(nodes);
  return {
    totalFiles: all.length,
    errorFiles: all.filter(n => n.error).length,
    totalEdges: all.reduce((s, n) => s + n.imports.length, 0),
    byLang: all.reduce((acc, n) => { acc[n.lang] = (acc[n.lang] || 0) + 1; return acc; }, {}),
    gapCount: all.reduce((s, n) => s + n.gaps.length, 0),
    highRiskFiles: all.filter(n => n.riskScore > 60).length,
  };
}

/**
 * Write graph to .wednesday/codebase/dep-graph.json
 */
function writeGraph(graph, codebaseDir) {
  fs.mkdirSync(codebaseDir, { recursive: true });
  const outPath = path.join(codebaseDir, 'dep-graph.json');
  fs.writeFileSync(outPath, JSON.stringify(graph, null, 2));
  return outPath;
}

module.exports = { buildGraph, collectFiles, writeGraph, computeRiskScore };
