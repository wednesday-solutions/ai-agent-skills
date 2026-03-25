/**
 * 2B / 3A — Safety scorer
 * 0–100 risk score per file
 * score = min(100,
 *   (min(dependents,50)*1.2) +
 *   (isPublicContract?25:0) +
 *   ((100-testCoverage)*0.15) +
 *   min(bugFixCommits*3, 15)   // 3A: git bug-fix history signal (max 15pts)
 *   techDebtSignal             // 0/7/15 from comment intel
 *   bizFeatureSignal           // 0/10 from comment intel
 * )
 * techDebt and isBizFeature come from enriched comments.json — zero extra LLM tokens.
 */

'use strict';

const path = require('path');

const BANDS = [
  { max: 30,  label: 'Low',      action: 'Proceed' },
  { max: 60,  label: 'Medium',   action: 'Review' },
  { max: 80,  label: 'High',     action: 'Senior review' },
  { max: 100, label: 'Critical', action: 'Explicit plan required' },
];

/**
 * Build a dir→moduleIntel lookup from commentIntel.modules array.
 * O(n) once, then O(1) per file lookup.
 */
function buildModuleIntelMap(commentIntel) {
  const map = new Map();
  if (!commentIntel || !commentIntel.modules) return map;
  for (const mod of commentIntel.modules) {
    map.set(mod.dir, mod);
  }
  return map;
}

const TECH_DEBT_SIGNAL = { high: 15, medium: 7, low: 2, none: 0 };

/**
 * Compute risk score for a single file.
 * @param {string} file
 * @param {Object} nodes
 * @param {Object} testCoverageMap
 * @param {Map|null} moduleIntelMap - dir→commentIntel module, from buildModuleIntelMap()
 */
function score(file, nodes, testCoverageMap = {}, moduleIntelMap = null) {
  const node = nodes[file];
  if (!node) return { score: 0, band: 'Low', action: 'Proceed', details: {} };

  const dependents = node.importedBy.length;
  const testCoverage = testCoverageMap[file] ?? 50; // default 50% if unknown
  const isPublicContract = node.exports.length > 0 && dependents > 0;

  // 3A: git bug-fix history — files with more past bugs are higher risk
  const bugFixCommits = node.meta?.gitHistory?.bugFixCommits ?? 0;
  const bugFixSignal = Math.min(bugFixCommits * 3, 15);

  // Comment intel signals — zero LLM tokens (uses already-enriched comments.json)
  let techDebtSignal = 0;
  let bizFeatureSignal = 0;
  let techDebt = null;
  let isBizFeature = null;
  if (moduleIntelMap) {
    const dir = path.dirname(file);
    const intel = moduleIntelMap.get(dir);
    if (intel) {
      techDebt = intel.techDebt ?? null;
      isBizFeature = intel.isBizFeature ?? null;
      techDebtSignal = TECH_DEBT_SIGNAL[techDebt] ?? 0;
      bizFeatureSignal = isBizFeature === true ? 10 : 0;
    }
  }

  const raw = Math.min(100, Math.round(
    (Math.min(dependents, 50) * 1.2) +
    (isPublicContract ? 25 : 0) +
    ((100 - testCoverage) * 0.15) +
    bugFixSignal +
    techDebtSignal +
    bizFeatureSignal
  ));

  const band = BANDS.find(b => raw <= b.max) || BANDS[BANDS.length - 1];

  return {
    score: raw,
    band: band.label,
    action: band.action,
    details: {
      dependents,
      isPublicContract,
      testCoverage,
      bugFixCommits,
      techDebt,
      isBizFeature,
    },
  };
}

/**
 * Score all files in the graph.
 * @param {Object} nodes
 * @param {Object} testCoverageMap
 * @param {Object|null} commentIntel - output of analyseComments (optional, zero extra tokens)
 */
function scoreAll(nodes, testCoverageMap = {}, commentIntel = null) {
  const moduleIntelMap = buildModuleIntelMap(commentIntel);
  const scores = {};
  for (const file of Object.keys(nodes)) {
    scores[file] = score(file, nodes, testCoverageMap, moduleIntelMap);
  }
  return scores;
}

module.exports = { score, scoreAll, BANDS };
