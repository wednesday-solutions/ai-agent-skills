/**
 * 2B / 3A — Safety scorer
 * 0–100 risk score per file
 * score = min(100,
 *   (min(dependents,50)*1.2) +
 *   (isPublicContract?25:0) +
 *   ((100-testCoverage)*0.15) +
 *   min(bugFixCommits*3, 15)   // 3A: git bug-fix history signal (max 15pts)
 * )
 */

'use strict';

const BANDS = [
  { max: 30,  label: 'Low',      action: 'Proceed' },
  { max: 60,  label: 'Medium',   action: 'Review' },
  { max: 80,  label: 'High',     action: 'Senior review' },
  { max: 100, label: 'Critical', action: 'Explicit plan required' },
];

/**
 * Compute risk score for a single file
 */
function score(file, nodes, testCoverageMap = {}) {
  const node = nodes[file];
  if (!node) return { score: 0, band: 'Low', action: 'Proceed', details: {} };

  const dependents = node.importedBy.length;
  const testCoverage = testCoverageMap[file] ?? 50; // default 50% if unknown
  const isPublicContract = node.exports.length > 0 && dependents > 0;

  // 3A: git bug-fix history — files with more past bugs are higher risk
  const bugFixCommits = node.meta?.gitHistory?.bugFixCommits ?? 0;
  const bugFixSignal = Math.min(bugFixCommits * 3, 15);

  const raw = Math.min(100, Math.round(
    (Math.min(dependents, 50) * 1.2) +
    (isPublicContract ? 25 : 0) +
    ((100 - testCoverage) * 0.15) +
    bugFixSignal
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
    },
  };
}

/**
 * Score all files in the graph
 */
function scoreAll(nodes, testCoverageMap = {}) {
  const scores = {};
  for (const file of Object.keys(nodes)) {
    scores[file] = score(file, nodes, testCoverageMap);
  }
  return scores;
}

module.exports = { score, scoreAll, BANDS };
