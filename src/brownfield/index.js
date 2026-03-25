/**
 * Brownfield intelligence — main entry point
 * Orchestrates analyze, fill-gaps, blast, score, dead, legacy, plan-refactor, plan-migration
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const { buildGraph, collectFiles, writeGraph, computeRiskScore } = require('./engine/graph');
const { GraphStore } = require('./engine/store');
const { blastRadius } = require('./analysis/blast-radius');
const { apiSurface, buildApiSurface } = require('./analysis/api-surface');
const { findDeadCode, findCircularDeps } = require('./analysis/dead-code');
const { score, scoreAll } = require('./analysis/safety-scorer');
const { trace } = require('./analysis/call-graph');
const { buildLegacyReport } = require('./analysis/legacy-health');
const { fillGapsForNode } = require('./subagents/gap-filler');
const { summarizeAll } = require('./summarization/module-summarizer');
const { generateMasterMd } = require('./summarization/master-md');
const { analyzeAndWriteConflicts } = require('./summarization/conflict-explainer');
const { generateOnboarding, ONBOARDING_QUESTIONS } = require('./summarization/onboarding');
const { planRefactor } = require('./reasoning/refactor-planner');
const { planMigration } = require('./reasoning/migration-strategy');
const { qaMasterMd } = require('./reasoning/master-qa');
const { answerQuestion } = require('./query/chat-engine');
const { detectDrift, loadConstraints, formatDriftReport } = require('./analysis/drift');
const { genTests, selectTargets } = require('./reasoning/test-generator');
const { hasApiKey, getApiKey, tokenLogger } = require('./core/llm-client');
const { analyseComments } = require('./analysis/comment-intel');
const { detectFeatureModules } = require('./analysis/feature-modules');

/**
 * Compute SHA-1 hashes for a list of absolute file paths.
 * Returns { relPath: hash } — used for incremental change detection.
 */
function computeHashes(files, rootDir) {
  const result = {};
  for (const fp of files) {
    const rel = path.relative(rootDir, fp);
    try {
      result[rel] = crypto.createHash('sha1').update(fs.readFileSync(fp)).digest('hex');
    } catch {
      result[rel] = null;
    }
  }
  return result;
}

/**
 * Build a test coverage map from the graph.
 * Strategy: find all test files, mark every source file they import as covered (100).
 * All other source files get 0. Binary signal — has test / no test.
 */
function buildTestCoverageMap(nodes) {
  const coverageMap = {};
  const TEST_RE = /\.test\.[jt]sx?$|\.spec\.[jt]sx?$|__tests__/;

  for (const file of Object.keys(nodes)) {
    if (!TEST_RE.test(file)) coverageMap[file] = 0;
  }

  for (const [file, node] of Object.entries(nodes)) {
    if (!TEST_RE.test(file)) continue;
    for (const imp of node.imports) {
      if (Object.prototype.hasOwnProperty.call(coverageMap, imp)) {
        coverageMap[imp] = 100;
      }
    }
  }

  return coverageMap;
}

/**
 * Resolve standard paths for a project
 */
function paths(rootDir) {
  const wednesdayDir = path.join(rootDir, '.wednesday');
  return {
    wednesdayDir,
    codebaseDir:  path.join(wednesdayDir, 'codebase'),
    cacheDir:     path.join(wednesdayDir, 'cache'),
    analysisDir:  path.join(wednesdayDir, 'codebase', 'analysis'),
    refactorDir:  path.join(wednesdayDir, 'codebase', 'refactor'),
    hooksDir:     path.join(wednesdayDir, 'hooks'),
    dbPath:       path.join(wednesdayDir, 'graph.db'),
    depGraph:     path.join(wednesdayDir, 'codebase', 'dep-graph.json'),
    summaries:    path.join(wednesdayDir, 'codebase', 'summaries.json'),
    masterMd:     path.join(wednesdayDir, 'codebase', 'MASTER.md'),
  };
}

/**
 * Load existing graph — prefers SQLite store, falls back to dep-graph.json.
 * Returns the same object shape as dep-graph.json for full backward compat.
 */
function loadGraph(rootDir) {
  const p = paths(rootDir);

  // Try SQLite store first (Phase A — single indexed file, no full-read penalty)
  if (fs.existsSync(p.dbPath)) {
    try {
      const store = GraphStore.open(p.dbPath);
      if (!store.isEmpty()) {
        const graph = store.toGraphObject(rootDir);
        store.close();
        return graph;
      }
      store.close();
    } catch { /* fall through to JSON */ }
  }

  // Fallback: dep-graph.json (projects not yet migrated to Phase A)
  if (!fs.existsSync(p.depGraph)) return null;
  try {
    return JSON.parse(fs.readFileSync(p.depGraph, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Load summaries from disk
 */
function loadSummaries(rootDir) {
  const p = paths(rootDir);
  if (!fs.existsSync(p.summaries)) return {};
  try {
    return JSON.parse(fs.readFileSync(p.summaries, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Load comment intelligence from disk.
 * Merges base comments.json with comments-enriched.json overlay (if present).
 * The enrichment overlay is written by the AI agent — no Bash needed.
 */
function loadCommentIntel(p) {
  const commentPath = path.join(p.analysisDir, 'comments.json');
  if (!fs.existsSync(commentPath)) return null;
  let base;
  try { base = JSON.parse(fs.readFileSync(commentPath, 'utf8')); } catch { return null; }

  // Merge enrichment overlay (comments-enriched.json) if present
  const enrichPath = path.join(p.analysisDir, 'comments-enriched.json');
  if (fs.existsSync(enrichPath)) {
    try {
      const enriched = JSON.parse(fs.readFileSync(enrichPath, 'utf8'));
      if (enriched.enrichedAt) base.enrichedAt = enriched.enrichedAt;
      if (enriched.reversePrd) base.reversePrd = enriched.reversePrd;
      if (enriched.modules && typeof enriched.modules === 'object') {
        for (const mod of (base.modules || [])) {
          const overlay = enriched.modules[mod.dir];
          if (overlay) {
            if (overlay.purpose    !== undefined) mod.purpose    = overlay.purpose;
            if (overlay.techDebt   !== undefined) mod.techDebt   = overlay.techDebt;
            if (overlay.isBizFeature !== undefined) mod.isBizFeature = overlay.isBizFeature;
            if (overlay.ideas      !== undefined) mod.ideas      = overlay.ideas;
          }
        }
      }
    } catch { /* enrichment overlay is optional — ignore parse errors */ }
  }

  return base;
}

/**
 * 2A-7 analyze command
 * @param {string} rootDir
 * @param {Object} opts - { incremental, full, watch, silent, refreshAnalysis }
 */
async function analyze(rootDir, opts = {}) {
  const p = paths(rootDir);
  const silent = opts.silent || false;
  const log = silent ? () => {} : console.log;
  const start = Date.now();
  tokenLogger.setCommand('analyze');

  log('Collecting files...');
  const allFiles = collectFiles(rootDir, { ignore: opts.ignore });

  // Open store (creates .wednesday/graph.db on first run)
  const store = GraphStore.open(p.dbPath);

  // ── Hash all files for change detection ───────────────────────────────────
  const allHashes = computeHashes(allFiles, rootDir);

  // ── Determine which files need (re)parsing ────────────────────────────────
  let filesToParse = allFiles;

  if (opts.incremental && !opts.full) {
    filesToParse = allFiles.filter(fp => {
      const rel = path.relative(rootDir, fp);
      return allHashes[rel] !== store.getFileHash(rel);
    });

    log(`Changed: ${filesToParse.length} / ${allFiles.length} files`);

    if (filesToParse.length === 0 && !opts.refreshAnalysis) {
      log('No changes detected. Graph is up to date.');
      store.close();
      return { graph: loadGraph(rootDir), changed: 0, elapsed: Date.now() - start };
    }
  }

  log(`Parsing ${filesToParse.length} files...`);

  // Build graph (only changed files in incremental mode)
  const apiKey = process.env.OPENROUTER_API_KEY || null;
  const partialGraph = buildGraph(rootDir, {
    files: filesToParse,
    withGitHistory: !opts.silent,
  });

  // ── Merge with existing store nodes (incremental) or use full graph ───────
  let mergedNodes;
  if (opts.incremental && !opts.full && !store.isEmpty()) {
    const storeGraph = store.toGraphObject(rootDir);
    mergedNodes = { ...storeGraph.nodes, ...partialGraph.nodes };
  } else {
    mergedNodes = partialGraph.nodes;
  }

  // ── Recompute importedBy + risk scores on merged graph ────────────────────
  for (const node of Object.values(mergedNodes)) {
    node.importedBy = [];
  }
  for (const [file, node] of Object.entries(mergedNodes)) {
    for (const imp of node.imports) {
      if (mergedNodes[imp]) {
        mergedNodes[imp].importedBy.push(file);
      }
    }
  }
  for (const node of Object.values(mergedNodes)) {
    node.riskScore = computeRiskScore(node);
  }

  // ── Persist all nodes to store with hashes ────────────────────────────────
  store.writeAll(mergedNodes, allHashes);
  store.setMeta('last_analyzed', new Date().toISOString());
  store.setMeta('root_dir', rootDir);
  store.close();

  // ── Export dep-graph.json (from merged nodes + supplementary data) ────────
  const all = Object.values(mergedNodes);
  const graph = {
    version: 2,
    generatedAt: new Date().toISOString(),
    rootDir,
    nodes: mergedNodes,
    packages:   partialGraph.packages   || {},
    serverless: partialGraph.serverless || {},
    stats: {
      totalFiles:    all.length,
      errorFiles:    all.filter(n => n.error).length,
      totalEdges:    all.reduce((s, n) => s + n.imports.length, 0),
      byLang:        all.reduce((acc, n) => { acc[n.lang] = (acc[n.lang] || 0) + 1; return acc; }, {}),
      gapCount:      all.reduce((s, n) => s + n.gaps.length, 0),
      highRiskFiles: all.filter(n => n.riskScore > 60).length,
    },
  };
  writeGraph(graph, p.codebaseDir);

  // Write analysis files if full scan or refresh
  if (!opts.incremental || opts.refreshAnalysis) {
    const legacy = buildLegacyReport(graph.nodes);
    const testCoverageMap = buildTestCoverageMap(graph.nodes);
    const scoreMap = scoreAll(graph.nodes, testCoverageMap);
    const apiMap = buildApiSurface(graph.nodes);
    const { deadFiles, unusedExports } = findDeadCode(graph.nodes);

    // blast-radius.json — top 50 files by dependent count
    const blastMap = Object.entries(graph.nodes)
      .map(([file]) => ({ file, ...blastRadius(file, graph.nodes) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50)
      .reduce((acc, { file, direct, transitive, files: deps, crossLang }) => {
        acc[file] = { direct, transitive, dependents: deps, crossLang };
        return acc;
      }, {});

    fs.mkdirSync(p.analysisDir, { recursive: true });
    fs.writeFileSync(path.join(p.analysisDir, 'blast-radius.json'),  JSON.stringify(blastMap, null, 2));
    fs.writeFileSync(path.join(p.analysisDir, 'safety-scores.json'), JSON.stringify(scoreMap, null, 2));
    fs.writeFileSync(path.join(p.analysisDir, 'api-surface.json'),   JSON.stringify(apiMap, null, 2));
    fs.writeFileSync(path.join(p.analysisDir, 'dead-code.json'),     JSON.stringify({ deadFiles, unusedExports, circularDeps: legacy.circularDeps }, null, 2));

    // Conflict detection
    await analyzeAndWriteConflicts(rootDir, p.analysisDir, apiKey);

    // Comment intelligence
    await analyseComments(graph.nodes, rootDir, p.analysisDir, apiKey);
  }

  const elapsed = Date.now() - start;
  log(`Done. ${Object.keys(graph.nodes).length} files in ${elapsed}ms`);

  if (!silent) {
    const report = tokenLogger.flush(rootDir);
    tokenLogger.printReport(report);
  }

  return { graph, changed: filesToParse.length, elapsed };
}

/**
 * 2A-8 fill-gaps command
 */
async function fillGaps(rootDir, opts = {}) {
  const p = paths(rootDir);
  const graph = loadGraph(rootDir);
  if (!graph) throw new Error('No dep-graph.json found. Run analyze first.');

  const apiKey = process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('No API key set. Gap filling requires OPENROUTER_API_KEY or ANTHROPIC_API_KEY.');

  const nodes = graph.nodes;
  const targetFile = opts.file ? path.relative(rootDir, path.resolve(rootDir, opts.file)) : null;
  const minRisk = opts.minRisk || 50;

  const targets = Object.entries(nodes)
    .filter(([file, node]) => {
      if (targetFile && file !== targetFile) return false;
      if (node.riskScore < minRisk) return false;
      return node.gaps.length > 0;
    })
    .map(([, node]) => node);

  console.log(`Processing ${targets.length} files with gaps (min-risk: ${minRisk})...`);

  let totalResolved = 0;
  for (const node of targets) {
    const dir = path.dirname(node.file);
    const nearby = Object.keys(nodes)
      .filter(f => path.dirname(f) === dir && f !== node.file)
      .slice(0, 10);

    const { resolvedEdges } = await fillGapsForNode(node, nearby, apiKey);

    // Add resolved edges to graph
    for (const edge of resolvedEdges) {
      if (!node.imports.includes(edge.to)) {
        node.imports.push(edge.to);
        if (nodes[edge.to]) {
          nodes[edge.to].importedBy.push(node.file);
        }
      }
      totalResolved++;
    }
  }

  // Re-save updated graph
  writeGraph(graph, p.codebaseDir);
  console.log(`Resolved ${totalResolved} gap edges.`);
  return totalResolved;
}

/**
 * summarize command — generate summaries.json + MASTER.md
 */
async function summarize(rootDir, opts = {}) {
  tokenLogger.setCommand('summarize');
  const p = paths(rootDir);
  const graph = loadGraph(rootDir);
  if (!graph) throw new Error('No dep-graph.json found. Run analyze first.');

  const apiKey = opts.apiKey || process.env.OPENROUTER_API_KEY || null;
  // Load commentIntel first — if enrichment has already run, module purposes
  // skip LLM calls entirely and produce better summaries (developer intent > inference)
  const commentIntel = loadCommentIntel(p);
  const { summaries, apiCalls } = await summarizeAll(graph.nodes, rootDir, p.cacheDir, apiKey, commentIntel);

  fs.mkdirSync(p.codebaseDir, { recursive: true });
  fs.writeFileSync(p.summaries, JSON.stringify(summaries, null, 2));

  const legacy = buildLegacyReport(graph.nodes);
  const store = GraphStore.open(p.dbPath);
  const masterPath = await generateMasterMd(graph, summaries, legacy, p.codebaseDir, apiKey, commentIntel, 0, 0, {}, store);
  store.close();

  // QA the MASTER.md
  const qaReport = await qaMasterMd(masterPath, summaries, apiKey);
  if (qaReport.flagged.length > 0) {
    console.log(`\nQA: ${qaReport.flagged.length} generic summaries flagged (score: ${qaReport.score}/100)`);
  }

  console.log(`Summaries: ${Object.keys(summaries).length} files | API calls: ${apiCalls} | MASTER.md: ${masterPath}`);

  const report = tokenLogger.flush(rootDir);
  tokenLogger.printReport(report);

  return { summaries, masterPath, qaReport };
}

// ── Export all commands for CLI use ──────────────────────────────────────────
module.exports = {
  analyze,
  fillGaps,
  summarize,
  loadGraph,
  loadSummaries,
  loadCommentIntel: (rootDir) => loadCommentIntel(paths(rootDir)),
  paths,

  // Analysis commands (used directly by CLI)
  blast: (file, rootDir) => {
    const graph = loadGraph(rootDir);
    if (!graph) throw new Error('Run analyze first.');
    const rel = path.relative(rootDir, path.resolve(rootDir, file));
    return blastRadius(rel, graph.nodes);
  },

  symbolBlast: (qualifiedName, rootDir) => {
    const store = GraphStore.open(paths(rootDir).dbPath);
    const { symbolBlastRadius } = require('./analysis/blast-radius');
    const result = symbolBlastRadius(qualifiedName, store);
    store.close();
    return result;
  },

  scoreFile: (file, rootDir) => {
    const graph = loadGraph(rootDir);
    if (!graph) throw new Error('Run analyze first.');
    const rel = path.relative(rootDir, path.resolve(rootDir, file));
    return score(rel, graph.nodes);
  },

  dead: (rootDir) => {
    const graph = loadGraph(rootDir);
    if (!graph) throw new Error('Run analyze first.');
    return findDeadCode(graph.nodes);
  },

  legacy: (rootDir) => {
    const graph = loadGraph(rootDir);
    if (!graph) throw new Error('Run analyze first.');
    return buildLegacyReport(graph.nodes);
  },

  callTrace: (file, fn, rootDir) => {
    const graph = loadGraph(rootDir);
    if (!graph) throw new Error('Run analyze first.');
    const rel = path.relative(rootDir, path.resolve(rootDir, file));
    return trace(rel, fn, graph.nodes);
  },

  planRefactor: async (goal, rootDir) => {
    const graph = loadGraph(rootDir);
    const summaries = loadSummaries(rootDir);
    const legacy = buildLegacyReport(graph?.nodes || {});
    const p = paths(rootDir);
    const apiKey = process.env.OPENROUTER_API_KEY || null;
    return planRefactor(goal, graph || { nodes: {}, stats: {} }, summaries, legacy, p.refactorDir, apiKey);
  },

  planMigration: async (goal, rootDir) => {
    const graph = loadGraph(rootDir);
    const summaries = loadSummaries(rootDir);
    const p = paths(rootDir);
    const apiKey = process.env.OPENROUTER_API_KEY || null;
    return planMigration(goal, graph || { nodes: {}, stats: {} }, summaries, p.refactorDir, apiKey);
  },

  onboard: async (answers, rootDir) => {
    const graph = loadGraph(rootDir);
    const summaries = loadSummaries(rootDir);
    const apiKey = process.env.OPENROUTER_API_KEY || null;
    const p = paths(rootDir);
    const store = GraphStore.open(p.dbPath);
    const result = await generateOnboarding(answers, graph || { nodes: {} }, summaries, apiKey, null, store);
    store.close();
    return result;
  },

  chat: async (question, rootDir) => {
    const graph = loadGraph(rootDir);
    if (!graph) throw new Error('Run wednesday-skills analyze first.');
    const summaries = loadSummaries(rootDir);
    const store = GraphStore.open(paths(rootDir).dbPath);
    const result = await answerQuestion(question, rootDir, graph, summaries, store);
    store.close();
    return result;
  },

  drift: (rootDir, opts = {}) => {
    const graph = loadGraph(rootDir);
    if (!graph) throw new Error('Run wednesday-skills analyze first.');
    const constraints = loadConstraints(rootDir);
    if (!constraints) return { violations: [], noConstraints: true };
    const violations = detectDrift(constraints, graph, rootDir, opts);
    return { violations, report: formatDriftReport(violations, opts) };
  },

  genTests: async (rootDir, opts = {}) => {
    const graph = loadGraph(rootDir);
    if (!graph) throw new Error('Run wednesday-skills analyze first.');
    const summaries = loadSummaries(rootDir);
    return genTests(rootDir, graph, summaries, null, opts);
  },

  genTestsTargets: (rootDir, opts = {}) => {
    const graph = loadGraph(rootDir);
    if (!graph) throw new Error('Run wednesday-skills analyze first.');
    return selectTargets(graph.nodes, opts);
  },

  detectFeatureModules: (rootDir) => {
    const graph = loadGraph(rootDir);
    if (!graph) throw new Error('Run wednesday-skills analyze first.');
    return detectFeatureModules(graph.nodes);
  },

  installHooks: (rootDir) => {
    const hooksDir = path.join(rootDir, '.git', 'hooks');
    if (!fs.existsSync(hooksDir)) return false;

    const packageHooks = path.join(__dirname, '..', '..', 'assets', 'hooks');
    for (const hook of ['post-commit', 'post-merge']) {
      const src = path.join(packageHooks, hook);
      const dest = path.join(hooksDir, hook);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        fs.chmodSync(dest, 0o755);
      }
    }
    return true;
  },
};
