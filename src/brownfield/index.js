/**
 * Brownfield intelligence — main entry point
 * Orchestrates analyze, fill-gaps, blast, score, dead, legacy, plan-refactor, plan-migration
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { buildGraph, collectFiles, writeGraph } = require('./engine/graph');
const { diffFiles, saveCache, loadCachedNodes, saveCachedNodes } = require('./engine/cache');
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
    depGraph:     path.join(wednesdayDir, 'codebase', 'dep-graph.json'),
    summaries:    path.join(wednesdayDir, 'codebase', 'summaries.json'),
    masterMd:     path.join(wednesdayDir, 'codebase', 'MASTER.md'),
  };
}

/**
 * Load existing graph from disk
 */
function loadGraph(rootDir) {
  const p = paths(rootDir);
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
 * 2A-7 analyze command
 * @param {string} rootDir
 * @param {Object} opts - { incremental, full, watch, silent, refreshAnalysis }
 */
async function analyze(rootDir, opts = {}) {
  const p = paths(rootDir);
  const silent = opts.silent || false;
  const log = silent ? () => {} : console.log;
  const start = Date.now();

  log('Collecting files...');
  const allFiles = collectFiles(rootDir);

  // ── Incremental mode ──────────────────────────────────────────────────────
  let filesToParse = allFiles;
  let cachedNodes = {};

  if (opts.incremental && !opts.full) {
    const { changed, unchanged, hashes } = diffFiles(allFiles, p.cacheDir);
    log(`Changed: ${changed.length} / ${allFiles.length} files`);

    if (changed.length === 0 && !opts.refreshAnalysis) {
      log('No changes detected. Graph is up to date.');
      return { graph: loadGraph(rootDir), changed: 0, elapsed: Date.now() - start };
    }

    cachedNodes = loadCachedNodes(unchanged, p.cacheDir, rootDir);
    filesToParse = changed;
    saveCache(p.cacheDir, hashes);
  } else {
    // Full scan — save all hashes
    const { hashes } = diffFiles(allFiles, p.cacheDir);
    saveCache(p.cacheDir, hashes);
  }

  log(`Parsing ${filesToParse.length} files...`);

  // Build graph (only changed files if incremental)
  const apiKey = process.env.OPENROUTER_API_KEY || null;
  const graph = buildGraph(rootDir, {
    files: filesToParse,
    withGitHistory: !opts.silent,  // skip git history in silent/post-commit mode
  });

  // Merge cached nodes
  Object.assign(graph.nodes, cachedNodes);

  // Recompute importedBy after merge
  for (const node of Object.values(graph.nodes)) {
    node.importedBy = [];
  }
  for (const [file, node] of Object.entries(graph.nodes)) {
    for (const imp of node.imports) {
      if (graph.nodes[imp]) {
        graph.nodes[imp].importedBy.push(file);
      }
    }
  }

  // Recompute risk scores
  for (const node of Object.values(graph.nodes)) {
    const { computeRiskScore } = require('./engine/graph');
    node.riskScore = computeRiskScore(node);
  }

  // Save node cache for changed files
  const newNodes = {};
  for (const file of filesToParse) {
    const rel = path.relative(rootDir, file);
    if (graph.nodes[rel]) newNodes[rel] = graph.nodes[rel];
  }
  saveCachedNodes(newNodes, p.cacheDir, rootDir);

  // Write graph
  writeGraph(graph, p.codebaseDir);

  // Write analysis files if full scan or refresh
  if (!opts.incremental || opts.refreshAnalysis) {
    const legacy = buildLegacyReport(graph.nodes);
    const scoreMap = scoreAll(graph.nodes);
    const apiMap = buildApiSurface(graph.nodes);
    const { deadFiles, unusedExports } = findDeadCode(graph.nodes);

    // blast-radius.json — top 50 files by dependent count
    const blastMap = Object.entries(graph.nodes)
      .map(([file]) => ({ file, ...blastRadius(file, graph.nodes) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50)
      .reduce((acc, { file, count, files: deps, crossLang }) => {
        acc[file] = { count, dependents: deps, crossLang };
        return acc;
      }, {});

    fs.mkdirSync(p.analysisDir, { recursive: true });
    fs.writeFileSync(path.join(p.analysisDir, 'blast-radius.json'),  JSON.stringify(blastMap, null, 2));
    fs.writeFileSync(path.join(p.analysisDir, 'safety-scores.json'), JSON.stringify(scoreMap, null, 2));
    fs.writeFileSync(path.join(p.analysisDir, 'api-surface.json'),   JSON.stringify(apiMap, null, 2));
    fs.writeFileSync(path.join(p.analysisDir, 'dead-code.json'),     JSON.stringify({ deadFiles, unusedExports, circularDeps: legacy.circularDeps }, null, 2));

    // Conflict detection
    await analyzeAndWriteConflicts(rootDir, p.analysisDir, apiKey);
  }

  const elapsed = Date.now() - start;
  log(`Done. ${Object.keys(graph.nodes).length} files in ${elapsed}ms`);

  return { graph, changed: filesToParse.length, elapsed };
}

/**
 * 2A-8 fill-gaps command
 */
async function fillGaps(rootDir, opts = {}) {
  const p = paths(rootDir);
  const graph = loadGraph(rootDir);
  if (!graph) throw new Error('No dep-graph.json found. Run analyze first.');

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set. Gap filling requires Haiku API access.');

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
  const p = paths(rootDir);
  const graph = loadGraph(rootDir);
  if (!graph) throw new Error('No dep-graph.json found. Run analyze first.');

  const apiKey = opts.apiKey || process.env.OPENROUTER_API_KEY || null;
  const { summaries, apiCalls } = await summarizeAll(graph.nodes, rootDir, p.cacheDir, apiKey);

  fs.mkdirSync(p.codebaseDir, { recursive: true });
  fs.writeFileSync(p.summaries, JSON.stringify(summaries, null, 2));

  const legacy = buildLegacyReport(graph.nodes);
  const masterPath = await generateMasterMd(graph, summaries, legacy, p.codebaseDir, apiKey);

  // QA the MASTER.md
  const qaReport = await qaMasterMd(masterPath, summaries, apiKey);
  if (qaReport.flagged.length > 0) {
    console.log(`\nQA: ${qaReport.flagged.length} generic summaries flagged (score: ${qaReport.score}/100)`);
  }

  console.log(`Summaries: ${Object.keys(summaries).length} files | API calls: ${apiCalls} | MASTER.md: ${masterPath}`);
  return { summaries, masterPath, qaReport };
}

/**
 * Generate MAP_REPORT.md — full summary of the mapping run
 * Stored at .wednesday/codebase/MAP_REPORT.md
 */
function generateMapReport(rootDir, graph, summaries, legacyReport, gapsFilled, elapsed) {
  const p = paths(rootDir);
  const nodes = graph.nodes;
  const all = Object.values(nodes);

  const scoreMap = scoreAll(nodes);
  const { deadFiles } = findDeadCode(nodes);

  // Coverage by language
  const byLang = graph.stats.byLang || {};
  const langRows = Object.entries(byLang)
    .sort((a, b) => b[1] - a[1])
    .map(([lang, count]) => `| ${lang} | ${count} |`)
    .join('\n');

  // Top high-risk files
  const highRisk = all
    .filter(n => n.riskScore > 60)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 10);

  const highRiskRows = highRisk
    .map(n => `| ${n.file} | ${n.riskScore} | ${n.importedBy.length} | ${scoreMap[n.file]?.band || '?'} |`)
    .join('\n');

  // Gap summary
  const totalGaps = all.reduce((s, n) => s + n.gaps.length, 0);
  const gapsByType = all.flatMap(n => n.gaps).reduce((acc, g) => {
    acc[g.type] = (acc[g.type] || 0) + 1;
    return acc;
  }, {});
  const gapRows = Object.entries(gapsByType)
    .map(([type, count]) => `| ${type} | ${count} |`)
    .join('\n');

  // Danger zones
  const dangerRows = (legacyReport.dangerZones || []).slice(0, 10)
    .map(d => `| ${d.file} | ${d.reason} | ${d.contact} |`)
    .join('\n');

  const lines = [
    `# Codebase Map Report`,
    `> Generated: ${new Date().toISOString()}`,
    `> Project: ${rootDir}`,
    `> Total time: ${elapsed}ms`,
    '',
    '## Summary',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Files mapped | ${all.length} |`,
    `| Total edges | ${graph.stats.totalEdges} |`,
    `| Summaries generated | ${Object.keys(summaries).length} |`,
    `| High-risk files (score > 60) | ${graph.stats.highRiskFiles} |`,
    `| Dead files | ${deadFiles.length} |`,
    `| Circular dependencies | ${legacyReport.circularDeps?.length || 0} |`,
    `| God files | ${legacyReport.godFiles?.length || 0} |`,
    `| Coverage gaps | ${totalGaps} |`,
    `| Gaps resolved (subagents) | ${gapsFilled} |`,
    `| Danger zones | ${legacyReport.dangerZones?.length || 0} |`,
    '',
    '## Files by language',
    '',
    '| Language | Files |',
    '|----------|-------|',
    langRows,
    '',
    '## High-risk files',
    '',
    '> Files with risk score > 60. Read before modifying.',
    '',
    '| File | Score | Dependents | Band |',
    '|------|-------|------------|------|',
    highRiskRows || '| *none* | — | — | — |',
    '',
    '## Coverage gaps',
    '',
    totalGaps > 0 ? [
      '| Gap type | Count |',
      '|----------|-------|',
      gapRows,
      '',
      `> Run \`wednesday-skills fill-gaps --min-risk 50\` to resolve gaps (requires OPENROUTER_API_KEY)`,
    ].join('\n') : '> No gaps detected. Graph coverage is complete.',
    '',
    '## Danger zones',
    '',
    legacyReport.dangerZones?.length > 0 ? [
      '| File | Reason | Contact |',
      '|------|--------|---------|',
      dangerRows,
    ].join('\n') : '> No danger zones detected.',
    '',
    '## Output files',
    '',
    '| File | Description |',
    '|------|-------------|',
    '| `.wednesday/codebase/dep-graph.json` | Full dependency graph |',
    '| `.wednesday/codebase/summaries.json` | Module summaries |',
    '| `.wednesday/codebase/MASTER.md` | Architecture overview |',
    '| `.wednesday/codebase/analysis/blast-radius.json` | Top 50 files by blast radius |',
    '| `.wednesday/codebase/analysis/safety-scores.json` | Risk scores (0–100) per file |',
    '| `.wednesday/codebase/analysis/dead-code.json` | Dead files + circular deps |',
    '| `.wednesday/codebase/analysis/api-surface.json` | Public contracts per file |',
    '| `.wednesday/codebase/analysis/conflicts.json` | Dependency conflicts |',
    '',
    '---',
    '*Generated by wednesday-skills map — graph analysis only, no raw source read*',
  ];

  const content = lines.join('\n');
  const outPath = path.join(p.codebaseDir, 'MAP_REPORT.md');
  fs.mkdirSync(p.codebaseDir, { recursive: true });
  fs.writeFileSync(outPath, content);
  return outPath;
}

// ── Export all commands for CLI use ──────────────────────────────────────────
module.exports = {
  analyze,
  fillGaps,
  summarize,
  loadGraph,
  loadSummaries,
  paths,

  // Analysis commands (used directly by CLI)
  blast: (file, rootDir) => {
    const graph = loadGraph(rootDir);
    if (!graph) throw new Error('Run analyze first.');
    const rel = path.relative(rootDir, path.resolve(rootDir, file));
    return blastRadius(rel, graph.nodes);
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
    return generateOnboarding(answers, graph || { nodes: {} }, summaries, apiKey);
  },

  generateMapReport,

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
