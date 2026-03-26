/**
 * 2B — Legacy health report
 * God files, circular deps, tech debt map, unannotated dynamic patterns
 */

'use strict';

const { findDeadCode, findCircularDeps } = require('./dead-code');
const { isDangerZone } = require('../parsers/git-history');

const GOD_FILE_EXPORT_THRESHOLD = 15;

/**
 * Build a full legacy health report
 */
function buildLegacyReport(nodes, testCoverageMap = {}) {
  const report = {
    godFiles: [],
    circularDeps: [],
    unannotatedDynamic: [],
    techDebt: [],
    dangerZones: [],
  };

  // ── God files ─────────────────────────────────────────────────────────────
  for (const [file, node] of Object.entries(nodes)) {
    if (node.exports.length > GOD_FILE_EXPORT_THRESHOLD) {
      const concerns = inferConcerns(node.exports);
      report.godFiles.push({
        file,
        exports: node.exports.length,
        lines: node.meta?.lines || '?',
        concerns: concerns.join(', '),
      });
    }
  }

  // ── Circular dependencies ─────────────────────────────────────────────────
  report.circularDeps = findCircularDeps(nodes);

  // ── Unannotated dynamic patterns ──────────────────────────────────────────
  for (const [file, node] of Object.entries(nodes)) {
    for (const gap of node.gaps) {
      if (['dynamic-require', 'dynamic-import', 'event-emit', 'global-inject'].includes(gap.type)) {
        report.unannotatedDynamic.push({
          file,
          line: gap.line,
          pattern: gap.type,
          action: annotationAdvice(gap.type),
        });
      }
    }
  }

  // ── Tech debt map (ranked by priority) ───────────────────────────────────
  for (const [file, node] of Object.entries(nodes)) {
    const coverage = testCoverageMap[file] ?? null;
    const gitData = node.meta?.gitHistory;
    const riskScore = node.riskScore;

    if (gitData && (gitData.bugFixCommits >= 2 || gitData.hackCommits >= 1 || riskScore >= 50)) {
      const priority = computeDebtPriority(gitData, riskScore, coverage);
      report.techDebt.push({
        file,
        bugFixes: gitData.bugFixCommits,
        age: gitData.ageInDays ? `${Math.round(gitData.ageInDays / 365 * 10) / 10}yr` : '?',
        coverage: coverage !== null ? `${coverage}%` : '?',
        priority,
      });
    }

    // Danger zones: tighter threshold (must have risk >60 OR high bug count)
    const reason = dangerReason(gitData, riskScore, coverage);
    if (reason && isDangerZone(gitData, riskScore, coverage ?? 0)) {
      report.dangerZones.push({
        file,
        reason,
        contact: gitData?.authors?.[0]?.email || 'unknown',
      });
    }
  }

  // Sort tech debt by priority
  const priorityOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  report.techDebt.sort((a, b) => (priorityOrder[a.priority] || 99) - (priorityOrder[b.priority] || 99));

  return report;
}

function inferConcerns(exports) {
  const concerns = new Set();
  const patterns = {
    auth: /auth|token|session|password|login|logout/i,
    db: /query|db|database|find|save|delete|update|insert/i,
    email: /email|mail|send|notify|notification/i,
    format: /format|parse|serialize|transform|convert/i,
    hash: /hash|encrypt|decrypt|crypto/i,
    cache: /cache|redis|memcached/i,
  };

  for (const exp of exports) {
    for (const [concern, re] of Object.entries(patterns)) {
      if (re.test(exp)) concerns.add(concern);
    }
  }

  if (concerns.size === 0) concerns.add('mixed');
  return [...concerns];
}

function annotationAdvice(gapType) {
  const advice = {
    'dynamic-require': 'Add // @wednesday-skills:connects-to route → ./file',
    'dynamic-import': 'Add // @wednesday-skills:connects-to route → ./file',
    'event-emit': 'Add // @wednesday-skills:connects-to event → listener.js',
    'global-inject': 'Add // @wednesday-skills:global name → ./file',
  };
  return advice[gapType] || 'Add annotation';
}

function computeDebtPriority(gitData, riskScore, coverage) {
  if ((gitData?.bugFixCommits >= 5 || riskScore >= 80) && (coverage === 0 || coverage === null)) return 'Critical';
  if (gitData?.bugFixCommits >= 3 || riskScore >= 60) return 'High';
  if (gitData?.bugFixCommits >= 1 || riskScore >= 40) return 'Medium';
  return 'Low';
}

function dangerReason(gitData, riskScore, coverage) {
  const reasons = [];
  if (gitData?.bugFixCommits >= 4) reasons.push(`${gitData.bugFixCommits} bug fixes`);
  if (gitData?.hackCommits >= 1) reasons.push(`${gitData.hackCommits} known workarounds`);
  if (riskScore >= 75) reasons.push(`high risk score [${riskScore}]`);
  if (coverage === 0 && gitData?.ageInDays > 365 && riskScore > 50) reasons.push('old + untested');
  return reasons.join(', ');
}

module.exports = { buildLegacyReport };
