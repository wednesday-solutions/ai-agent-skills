'use strict';

/**
 * Query Layer — High-level API for custom commands
 *
 * Wraps graph.db queries and provides semantic results.
 * All custom commands should use this layer, not raw DB queries.
 *
 * Usage:
 *   const queries = require('./queries');
 *   const dbPath = '.wednesday/graph.db';
 *   const fileSummary = queries.getFileSummary(dbPath, 'src/graph.js');
 */

const { GraphStore } = require('../engine/store');

/**
 * Open DB connection (cached per path to avoid multiple connections).
 * @param {string} dbPath
 * @returns {GraphStore}
 */
function openDb(dbPath) {
  if (!module.exports._dbCache) {
    module.exports._dbCache = {};
  }
  if (!module.exports._dbCache[dbPath]) {
    module.exports._dbCache[dbPath] = GraphStore.open(dbPath);
  }
  return module.exports._dbCache[dbPath];
}

/**
 * Get comprehensive file info for /brownfield-fix and /brownfield-chat.
 * @param {string} dbPath
 * @param {string} filePath
 * @returns {Object|null} — complete file context
 */
function getFileSummary(dbPath, filePath) {
  const db = openDb(dbPath);
  return db.getFileSummary(filePath);
}

/**
 * Get blast radius for /brownfield-blast.
 * @param {string} dbPath
 * @param {string} filePath
 * @returns {Object|null}
 */
function getBlastRadius(dbPath, filePath) {
  const db = openDb(dbPath);
  return db.getBlastRadius(filePath);
}

/**
 * Get all dead code for /brownfield-dead.
 * @param {string} dbPath
 * @returns {Array} — dead files and unused exports
 */
function getAllDeadCode(dbPath) {
  const db = openDb(dbPath);
  return db.getDeadCode();
}

/**
 * Get entry points with confidence scores.
 * @param {string} dbPath
 * @returns {Array}
 */
function getEntryPoints(dbPath) {
  const db = openDb(dbPath);
  return db.getEntryPoints();
}

/**
 * Get high-confidence entry points (confidence >= threshold).
 * @param {string} dbPath
 * @param {number} threshold — default 70
 * @returns {Array} — file paths
 */
function getHighConfidenceEntryPoints(dbPath, threshold = 70) {
  const db = openDb(dbPath);
  return db.getHighConfidenceEntryPoints(threshold);
}

/**
 * Get reading order (top N files by importance).
 * @param {string} dbPath
 * @param {number} limit — default 25
 * @returns {Array}
 */
function getReadingOrder(dbPath, limit = 25) {
  const db = openDb(dbPath);
  return db.getReadingOrder(limit);
}

/**
 * Get files grouped by role for /onboard module guide.
 * @param {string} dbPath
 * @returns {Object} — { role: [{filePath, confidence}] }
 */
function getFilesByRole(dbPath) {
  const db = openDb(dbPath);
  const roles = ['Util', 'Logic', 'Infra', 'Adapter', 'Test', 'Config', 'Entry'];
  const result = {};
  for (const role of roles) {
    const files = db.getModulesByRole(role);
    if (files.length > 0) result[role] = files;
  }
  return result;
}

/**
 * Get all high-risk files for /brownfield-fix and /onboard.
 * @param {string} dbPath
 * @param {number} minRisk — default 60
 * @returns {Array} — [{filePath, riskScore, dangerReason}]
 */
function getHighRiskFiles(dbPath, minRisk = 60) {
  const db = openDb(dbPath);
  return db._db.prepare(`
    SELECT file_path, risk_score, danger_reason, summary, imported_by_count
    FROM nodes
    WHERE risk_score >= ? AND is_test = 0
    ORDER BY risk_score DESC
    LIMIT 20
  `).all(minRisk).map(r => ({
    filePath: r.file_path,
    riskScore: r.risk_score,
    dangerReason: r.danger_reason,
    summary: r.summary,
    importedByCount: r.imported_by_count,
  }));
}

/**
 * Get circular dependencies.
 * @param {string} dbPath
 * @returns {Array} — cycles with files
 */
function getCircularDependencies(dbPath) {
  const db = openDb(dbPath);
  return db.getCircularDependencies();
}

/**
 * Get coverage gaps summary.
 * @param {string} dbPath
 * @returns {Object} — { totalGaps, byType: {type: count} }
 */
function getCoverageGapsSummary(dbPath) {
  const db = openDb(dbPath);
  const gaps = db.getAllCoverageGaps();
  const byType = {};
  for (const gap of gaps) {
    byType[gap.gapType] = (byType[gap.gapType] || 0) + gap.count;
  }
  return {
    totalGaps: gaps.reduce((sum, g) => sum + g.count, 0),
    byType,
    fileCount: gaps.length,
  };
}

/**
 * Search files by summary text.
 * @param {string} dbPath
 * @param {string} query
 * @returns {Array} — matching files
 */
function searchFiles(dbPath, query) {
  const db = openDb(dbPath);
  return db.searchByTopic(query);
}

/**
 * Get files by risk band.
 * @param {string} dbPath
 * @param {string} band — 'critical', 'risky', 'moderate', 'safe'
 * @returns {Array}
 */
function getFilesByBand(dbPath, band) {
  const db = openDb(dbPath);
  return db.getByBand(band);
}

/**
 * Get overall codebase statistics.
 * @param {string} dbPath
 * @returns {Object}
 */
function getCodebaseStats(dbPath) {
  const db = openDb(dbPath);
  const stats = db._db.prepare(`
    SELECT
      COUNT(*) as totalFiles,
      SUM(CASE WHEN is_test = 0 THEN 1 ELSE 0 END) as sourceFiles,
      SUM(CASE WHEN risk_score >= 80 THEN 1 ELSE 0 END) as criticalFiles,
      SUM(CASE WHEN risk_score >= 60 AND risk_score < 80 THEN 1 ELSE 0 END) as riskyFiles,
      SUM(CASE WHEN is_dead_file = 1 THEN 1 ELSE 0 END) as deadFiles,
      SUM(CASE WHEN is_circular_dep = 1 THEN 1 ELSE 0 END) as circularFiles,
      COUNT(DISTINCT lang) as languages,
      AVG(risk_score) as avgRiskScore,
      MAX(risk_score) as maxRiskScore,
      MIN(risk_score) as minRiskScore
    FROM nodes
  `).get();
  return stats;
}

/**
 * Get entry point confidence score (0-100).
 * Lower scores = more ambiguous, user should pick entry point.
 * @param {string} dbPath
 * @returns {number}
 */
function getOverallEntryPointConfidence(dbPath) {
  const db = openDb(dbPath);
  const eps = db.getEntryPoints();
  if (eps.length === 0) return 0;
  const avgConfidence = eps.reduce((sum, ep) => sum + ep.confidence, 0) / eps.length;
  return Math.round(avgConfidence);
}

module.exports = {
  // DB management
  openDb,

  // File lookups
  getFileSummary,
  getBlastRadius,
  searchFiles,

  // Reading order & entry points
  getReadingOrder,
  getEntryPoints,
  getHighConfidenceEntryPoints,
  getOverallEntryPointConfidence,

  // Risk & analysis
  getHighRiskFiles,
  getFilesByBand,
  getFilesByRole,

  // Dead code
  getAllDeadCode,

  // Structure & relationships
  getCircularDependencies,
  getCoverageGapsSummary,

  // Stats
  getCodebaseStats,
};
