/**
 * 3B3 — Graph-aware test generator
 * Generates test files for high-risk uncovered modules.
 * Context is built entirely from the graph — zero raw source reads.
 * Uses Sonnet via OpenRouter (~$0.08 per file).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { callLLM, hasApiKey } = require('../core/llm-client');

const TEST_RE = /\.test\.[jt]sx?$|\.spec\.[jt]sx?$|__tests__/;

// ── Target selection ──────────────────────────────────────────────────────────

/**
 * Build test coverage map: files imported by test files → 100, else 0.
 */
function buildCoverageMap(nodes) {
  const map = {};
  for (const file of Object.keys(nodes)) {
    if (!TEST_RE.test(file)) map[file] = 0;
  }
  for (const [file, node] of Object.entries(nodes)) {
    if (!TEST_RE.test(file)) continue;
    for (const imp of node.imports) {
      if (map[imp] !== undefined) map[imp] = 100;
    }
  }
  return map;
}

/**
 * Select target files for test generation.
 * Criteria: riskScore > minRisk AND testCoverage < 30
 * Ranked by: riskScore × (100 - testCoverage)
 */
function selectTargets(nodes, opts = {}) {
  const minRisk = opts.minRisk ?? 50;
  const targetFile = opts.file || null;
  const coverageMap = buildCoverageMap(nodes);

  return Object.entries(nodes)
    .filter(([file, node]) => {
      if (TEST_RE.test(file)) return false;
      if (targetFile && !file.includes(targetFile)) return false;
      const cov = coverageMap[file] ?? 0;
      return node.riskScore > minRisk && cov < 30;
    })
    .map(([file, node]) => {
      const cov = coverageMap[file] ?? 0;
      return { file, node, coverage: cov, priority: node.riskScore * (100 - cov) };
    })
    .sort((a, b) => b.priority - a.priority);
}

// ── Test framework detection ──────────────────────────────────────────────────

function detectTestFramework(rootDir, nodes) {
  // Check package.json
  const pkgPath = path.join(rootDir, 'package.json');
  let framework = 'jest';
  let assertions = '@testing-library/react';

  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps.vitest) framework = 'vitest';
      else if (allDeps.jest) framework = 'jest';
      else if (allDeps.mocha) framework = 'mocha';
      if (allDeps['@testing-library/react']) assertions = '@testing-library/react';
      else if (allDeps['@testing-library/react-native']) assertions = '@testing-library/react-native';
      else assertions = null;
    } catch {}
  }

  // Detect test pattern from existing test files
  let pattern = 'describe/it, arrange-act-assert';
  const existingTest = Object.keys(nodes).find(f => TEST_RE.test(f));
  if (existingTest) {
    // Pattern is likely consistent across the project
    pattern = 'describe/it blocks, arrange-act-assert (from existing tests)';
  }

  return { framework, assertions, pattern };
}

// ── Git history: find bug-fix commits for a file ──────────────────────────────

function getBugFixHistory(file, rootDir) {
  try {
    const log = execSync(
      `git log --follow --format="%ad — %s" --date=short -- "${file}"`,
      { cwd: rootDir, encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim();

    if (!log) return [];

    return log.split('\n')
      .filter(l => /^fix(\(|!|:)|\bfix(es|ed)?\b/i.test(l))
      .slice(0, 5);
  } catch {
    return [];
  }
}

// ── Context builder ───────────────────────────────────────────────────────────

/**
 * Build a max-300-token context for a single file from graph data.
 * Never reads raw source code.
 */
function buildContext(fileEntry, nodes, summaries, rootDir) {
  const { file, node, coverage } = fileEntry;
  const { framework, assertions, pattern } = detectTestFramework(rootDir, nodes);
  const bugFixes = getBugFixHistory(file, rootDir);
  const summary = summaries[file] || '';

  // Find real callers from the graph
  const callers = node.importedBy.slice(0, 5).map(callerFile => {
    const callerNode = nodes[callerFile];
    return {
      file: callerFile,
      usesExports: (callerNode?.exports || []).slice(0, 3),
    };
  });

  // External imports to mock (non-relative)
  const externalImports = node.imports
    .filter(imp => !imp.startsWith('src/') && !imp.startsWith('./') && !imp.startsWith('../'))
    .slice(0, 6);

  // Internal imports to mock (relative)
  const internalImports = node.imports
    .filter(imp => imp.startsWith('src/') || imp.startsWith('./') || imp.startsWith('../'))
    .slice(0, 4);

  const lines = [
    `File: ${file}`,
    `Language: ${node.lang}`,
    `Risk score: ${node.riskScore}/100`,
    `Test coverage: ${coverage}%`,
    `Test framework: ${framework}${assertions ? ` + ${assertions}` : ''}`,
    `Test pattern: ${pattern}`,
    '',
    summary ? `Module purpose: ${summary}` : '',
    '',
    `Exports to test:`,
    ...node.exports.slice(0, 10).map(e => `  ${e}`),
    '',
    `Real callers (from call graph):`,
    ...(callers.length > 0
      ? callers.map(c => `  ${c.file} imports this module`)
      : ['  none — this may be an entry point']),
    '',
    `Actual imports to mock (from dep-graph.json):`,
    ...externalImports.map(i => `  ${i}  [external — mock this]`),
    ...internalImports.map(i => `  ${i}  [internal — mock this]`),
  ].filter(l => l !== undefined);

  if (bugFixes.length > 0) {
    lines.push('', 'Historical failures (from git history):');
    bugFixes.forEach(bf => lines.push(`  ${bf}`));
  }

  lines.push('');

  if (bugFixes.length > 0) {
    lines.push('Generate a complete test file. Include coverage for the historical failure cases above.');
  } else {
    lines.push('Generate a complete test file covering the main exports, edge cases, and error handling.');
  }

  lines.push('Use exact mock targets listed above. Follow the test pattern described.');
  lines.push('Add a comment header with file path, generation source, and risk context.');

  return {
    prompt: lines.filter(Boolean).join('\n'),
    framework,
    file,
    bugFixes,
  };
}

// ── Sonnet API call ───────────────────────────────────────────────────────────

async function callSonnet(prompt) {
  return callLLM({ model: 'sonnet', messages: [{ role: 'user', content: prompt }], maxTokens: 1200 });
}

// ── Output path resolver ──────────────────────────────────────────────────────

/**
 * Determine where to write the generated test file.
 * Mirrors source path: src/auth/tokenService.ts → src/auth/__tests__/tokenService.test.ts
 */
function resolveTestPath(sourceFile, rootDir) {
  const ext = path.extname(sourceFile);
  const basename = path.basename(sourceFile, ext);
  const dir = path.dirname(sourceFile);

  // Determine test extension based on source extension
  const testExt = ext.replace(/x?$/, '');  // .tsx → .ts, .jsx → .js, .ts → .ts
  const testFile = `${basename}.test${testExt}`;
  const testDir = path.join(dir, '__tests__');

  return path.join(rootDir, testDir, testFile);
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Generate tests for targeted files.
 * @param {string} rootDir
 * @param {Object} graph - dep-graph.json
 * @param {Object} summaries - summaries.json
 * @param {string} apiKey - OpenRouter key
 * @param {Object} opts - { file?, minRisk?, dryRun? }
 * @returns {Promise<Array>} generated test records
 */
async function genTests(rootDir, graph, summaries, _apiKey, opts = {}) {
  const nodes = graph.nodes;
  const targets = selectTargets(nodes, opts);

  if (opts.dryRun) {
    return targets.map(t => ({
      file: t.file,
      risk: t.node.riskScore,
      coverage: t.coverage,
      priority: t.priority,
      dryRun: true,
    }));
  }

  if (!hasApiKey()) {
    throw new Error('OPENROUTER_API_KEY or ANTHROPIC_API_KEY is required for test generation');
  }

  const results = [];

  for (const target of targets) {
    const ctx = buildContext(target, nodes, summaries, rootDir);
    console.log(`  Generating tests for ${target.file} (risk: ${target.node.riskScore}, coverage: ${target.coverage}%)...`);

    let testCode = null;
    try {
      testCode = await callSonnet(ctx.prompt);
    } catch (e) {
      console.error(`  ✗ Error: ${e.message}`);
      results.push({ file: target.file, error: e.message });
      continue;
    }

    if (!testCode) {
      results.push({ file: target.file, error: 'No response from API' });
      continue;
    }

    // Strip markdown code fences if present
    testCode = testCode.replace(/^```(?:typescript|javascript|ts|js)?\n?/m, '').replace(/\n?```$/m, '');

    const testPath = resolveTestPath(target.file, rootDir);
    fs.mkdirSync(path.dirname(testPath), { recursive: true });
    fs.writeFileSync(testPath, testCode);

    results.push({
      file: target.file,
      testPath: path.relative(rootDir, testPath),
      risk: target.node.riskScore,
      coverage: target.coverage,
      bugFixes: ctx.bugFixes.length,
    });

    console.log(`  ✓ Written: ${path.relative(rootDir, testPath)}`);
  }

  return results;
}

module.exports = { genTests, selectTargets, buildContext };
