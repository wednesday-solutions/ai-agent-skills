/**
 * Optional intelligence layer — minimal-token LLM calls that interpret
 * already-computed structural data. Every function here returns null when
 * no API key is set and never reads raw source files.
 *
 * All calls use Haiku. Token budgets are tight by design.
 */

'use strict';

const { callLLM, hasApiKey } = require('../core/llm-client');

// ── Health narrative ──────────────────────────────────────────────────────────

/**
 * One Small call → 3-sentence codebase health paragraph.
 * Input: pre-computed stats from the pipeline. No source files read.
 *
 * @param {Object} commentIntel - enriched comments.json
 * @param {Object} stats        - { totalFiles, deadCount, highRiskCount, circularCount, violationCount }
 * @returns {Promise<string|null>}
 */
async function generateHealthNarrative(commentIntel, stats) {
  if (!hasApiKey() || !commentIntel) return null;

  const modules    = commentIntel.modules || [];
  const highDebt   = modules.filter(m => m.techDebt === 'high').map(m => m.dir);
  const bizModules = modules.filter(m => m.isBizFeature === true).map(m => m.dir);
  const totalTagged = commentIntel.summary?.taggedTotal || 0;

  const prompt = `Codebase health summary (for a senior engineer):
- ${stats.totalFiles} files mapped
- Biz-feature modules: ${bizModules.slice(0, 5).join(', ') || 'none identified'}
- High-debt modules (FIXME/BUG tags): ${highDebt.slice(0, 4).join(', ') || 'none'}
- Dead files: ${stats.deadCount} (${stats.deadHighRisk || 0} in biz-feature modules)
- Circular dependencies: ${stats.circularCount}
- High-risk files (score > 60): ${stats.highRiskCount}
- Total tagged comments: ${totalTagged}
- Architecture violations: ${stats.violationCount || 0}

Write exactly 3 sentences. Be specific. Name modules. No filler phrases.`;

  const result = await callLLM({
    model: 'haiku',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 120,
    operation: 'insights',
  });

  return result;
}

// ── Dead code classification ──────────────────────────────────────────────────

/**
 * One batch call → classify each dead file as unused/renamed/feature-flagged.
 * Only runs when dead files exist. Returns {} when no API key.
 *
 * @param {string[]} deadFiles
 * @param {Object}   riskByFile   - { file: 'high'|'low'|'unknown' }
 * @param {Object}   commentIntel
 * @returns {Promise<Object>} { file: 'unused'|'renamed'|'feature-flagged' }
 */
async function classifyDeadCode(deadFiles, riskByFile, commentIntel) {
  if (!hasApiKey() || !deadFiles.length) return {};

  // Only classify high-risk dead files — low/unknown get the default 'unused' label
  const toClassify = deadFiles.filter(f => riskByFile[f] === 'high').slice(0, 20);
  if (!toClassify.length) return {};

  const modulesByDir = new Map();
  (commentIntel?.modules || []).forEach(m => modulesByDir.set(m.dir, m));

  const fileLines = toClassify.map(f => {
    const dir = require('path').dirname(f);
    const intel = modulesByDir.get(dir);
    const ctx = intel?.purpose ? ` (module: ${intel.purpose})` : '';
    return `${f}${ctx}`;
  }).join('\n');

  const prompt = `These files have no importers in a ${(commentIntel?.modules || []).length}-module codebase.
For each, reply with one word: "unused", "renamed", or "feature-flagged".
Format: FILE_PATH: label
${fileLines}`;

  const result = await callLLM({
    model: 'haiku',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: toClassify.length * 8 + 30,
    operation: 'insights',
  });

  if (!result) return {};

  const classification = {};
  for (const line of result.split('\n')) {
    const match = line.match(/^(.+?):\s*(unused|renamed|feature-flagged)/i);
    if (match) {
      classification[match[1].trim()] = match[2].toLowerCase();
    }
  }
  return classification;
}

// ── Circular dependency break-point ──────────────────────────────────────────

/**
 * One Micro call per cycle involving a biz-feature module.
 * Returns suggestions keyed by cycle signature.
 *
 * @param {Array}  cycles       - from findCircularDeps
 * @param {Object} commentIntel
 * @returns {Promise<Object>} { cycleKey: 'suggestion string' }
 */
async function suggestCycleBreakPoints(cycles, commentIntel) {
  if (!hasApiKey() || !cycles.length || !commentIntel) return {};

  const modulesByDir = new Map();
  (commentIntel?.modules || []).forEach(m => modulesByDir.set(m.dir, m));

  // Only biz-feature cycles — infra cycles are usually benign
  const bizCycles = cycles.filter(cycle =>
    cycle.files.some(f => {
      const dir = require('path').dirname(f);
      return modulesByDir.get(dir)?.isBizFeature === true;
    })
  ).slice(0, 3);

  if (!bizCycles.length) return {};

  const suggestions = {};
  await Promise.all(bizCycles.map(async cycle => {
    const key = cycle.files.slice().sort().join('|');
    const moduleCtx = cycle.files.map(f => {
      const dir = require('path').dirname(f);
      const intel = modulesByDir.get(dir);
      return intel?.purpose ? `${f} (${intel.purpose})` : f;
    }).join(' → ');

    const result = await callLLM({
      model: 'haiku',
      messages: [{
        role: 'user',
        content: `Circular dependency: ${moduleCtx}
Which single import should be removed? What should be extracted?
Answer in 2 sentences. Be specific about file names.`,
      }],
      maxTokens: 80,
      operation: 'insights',
    });

    if (result) suggestions[key] = result;
  }));

  return suggestions;
}

// ── Drift violation explanation ───────────────────────────────────────────────

/**
 * One Micro call per high-severity drift violation, up to 3.
 * Replaces the generic fix template with a module-aware explanation.
 *
 * @param {Array}  violations   - from detectDrift
 * @param {Object} commentIntel
 * @returns {Promise<Object>} { violationEdge: 'explanation string' }
 */
async function explainDriftViolations(violations, commentIntel) {
  if (!hasApiKey() || !violations.length || !commentIntel) return {};

  const modulesByDir = new Map();
  (commentIntel?.modules || []).forEach(m => modulesByDir.set(m.dir, m));

  const highViolations = violations.filter(v => v.severity === 'high').slice(0, 3);
  if (!highViolations.length) return {};

  const explanations = {};
  await Promise.all(highViolations.map(async v => {
    const fromDir = v.from ? require('path').dirname(v.from) : null;
    const toDir   = v.to   ? require('path').dirname(v.to)   : null;
    const fromPurpose = fromDir && modulesByDir.get(fromDir)?.purpose;
    const toPurpose   = toDir   && modulesByDir.get(toDir)?.purpose;

    const ctx = [
      `Violation: ${v.edge}`,
      fromPurpose ? `From module: ${fromPurpose}` : null,
      toPurpose   ? `To module: ${toPurpose}`   : null,
      `Rule: ${v.description}`,
    ].filter(Boolean).join('\n');

    const result = await callLLM({
      model: 'haiku',
      messages: [{
        role: 'user',
        content: `${ctx}
Why is this a problem and what is the concrete fix? 1 sentence only.`,
      }],
      maxTokens: 60,
      operation: 'insights',
    });

    if (result) explanations[v.edge] = result;
  }));

  return explanations;
}

// ── Collect all insights in one pass ─────────────────────────────────────────

/**
 * Run all insight functions concurrently. Returns an insights object
 * that can be passed directly to generateMapReport.
 *
 * @param {Object} opts
 * @returns {Promise<Object>} insights
 */
async function generateInsights({ commentIntel, deadFiles, riskByFile, circularDeps, driftViolations, stats }) {
  if (!hasApiKey()) return {};

  const [healthNarrative, deadClassification, cycleBreakPoints, driftExplanations] = await Promise.all([
    generateHealthNarrative(commentIntel, stats),
    classifyDeadCode(deadFiles, riskByFile, commentIntel),
    suggestCycleBreakPoints(circularDeps || [], commentIntel),
    explainDriftViolations(driftViolations || [], commentIntel),
  ]);

  return { healthNarrative, deadClassification, cycleBreakPoints, driftExplanations };
}

module.exports = {
  generateInsights,
  generateHealthNarrative,
  classifyDeadCode,
  suggestCycleBreakPoints,
  explainDriftViolations,
};
