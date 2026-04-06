'use strict';

/**
 * Entry Point Detector — Phase 3
 *
 * Detects entry points with confidence scoring.
 * Signals:
 * - @main comment: +30
 * - package.json main: +25
 * - Executable script: +20
 * - Naming convention (index.js, main.js, cli.js): +10
 * - High fan-in: +10
 * - Legacy/multi-lang codebase: -20
 * - Graph coverage < 70%: -25
 */

const path = require('path');

/**
 * Score entry point confidence (0-100)
 * @param {string} file
 * @param {Object} node
 * @param {Object} pkg — package.json parsed
 * @param {number} coverage — graph coverage %
 * @returns {Object} — { confidence, signalScore, signals[], reason }
 */
function scoreEntryPoint(file, node, pkg = {}, coverage = 100) {
  let score = 0;
  const signals = [];

  // Check for @main comment
  const meta = node.meta || {};
  if (meta.hasMainComment) {
    score += 30;
    signals.push('@main comment');
  }

  // Check package.json main field
  const pkgMain = pkg.main ? path.normalize(pkg.main).replace(/\\/g, '/') : null;
  const normalizedFile = file.replace(/\\/g, '/');
  if (pkgMain && normalizedFile.endsWith(pkgMain)) {
    score += 25;
    signals.push('package.json main');
  }

  // Check if executable script (bin/, scripts/)
  if (/^\/?(?:bin|scripts?)\//.test(file)) {
    score += 20;
    signals.push('executable script');
  }

  // Naming convention
  const basename = path.basename(file);
  if (['index.js', 'index.ts', 'index.tsx', 'main.js', 'main.ts', 'cli.js', 'cli.ts', 'server.js', 'server.ts', 'app.js', 'app.ts'].includes(basename)) {
    score += 10;
    signals.push('naming convention');
  }

  // High fan-in (imports from many files)
  if (node.importedBy && node.importedBy.length > 10) {
    score += 10;
    signals.push('high fan-in');
  }

  // Negative signals
  // Legacy codebase detection (multi-language or PHP/Python majority)
  const isMultiLang = false; // Would need stats
  const isLegacy = isMultiLang;
  if (isLegacy) {
    score -= 20;
    signals.push('-20 (legacy pattern)');
  }

  // Low graph coverage
  if (coverage < 70) {
    score -= 25;
    signals.push(`-25 (coverage ${coverage}%)`);
  }

  // Clamp to 0-100
  const confidence = Math.max(0, Math.min(100, score));

  return {
    confidence,
    signalScore: score,
    signals,
    reason: signals.length > 0 ? signals.join(', ') : 'No entry point signals detected',
  };
}

/**
 * Detect all entry points in a codebase
 * @param {Object} nodes
 * @param {Object} pkg — package.json
 * @param {number} coverage — graph coverage %
 * @returns {Array} — [{filePath, detectionMethod, confidence, reason}]
 */
function detectEntryPoints(nodes, pkg = {}, coverage = 100) {
  const entries = [];
  const scored = [];

  // Score all files
  for (const [file, node] of Object.entries(nodes)) {
    if (node.isTest) continue; // Skip test files

    const result = scoreEntryPoint(file, node, pkg, coverage);
    if (result.confidence > 0) {
      scored.push({
        filePath: file,
        ...result,
      });
    }
  }

  // Determine detection method based on confidence
  for (const entry of scored) {
    let detectionMethod = 'heuristic';
    if (entry.signals.includes('@main comment')) detectionMethod = '@main';
    else if (entry.signals.includes('package.json main')) detectionMethod = 'package.json';
    else if (entry.signals.includes('executable script')) detectionMethod = 'executable';

    entries.push({
      filePath: entry.filePath,
      detectionMethod,
      confidence: entry.confidence,
      signalScore: entry.signalScore,
      reason: entry.reason,
    });
  }

  // Sort by confidence
  return entries.sort((a, b) => b.confidence - a.confidence);
}

module.exports = { detectEntryPoints, scoreEntryPoint };
