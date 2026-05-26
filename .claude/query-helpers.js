/**
 * Query Helpers — For Claude Custom Commands
 *
 * Provides thin wrapper around query layer for custom command execution.
 * Usage in .claude/commands/*.md:
 *
 *   const { getFileSummary, getBlastRadius, ... } = require('./.claude/query-helpers.js');
 *   const summary = getFileSummary('src/graph.js');
 */

'use strict';

const path = require('path');
const { GraphStore } = require('../src/brownfield/engine/store');

// Lazy-load query layer on first use
let _queries = null;
function loadQueries() {
  if (!_queries) {
    try {
      _queries = require('../src/brownfield/db/queries');
    } catch (e) {
      throw new Error('Query layer not available. Run `wednesday-skills map --full` first.');
    }
  }
  return _queries;
}

/**
 * Find project root and DB path
 */
function findDbPath(from = process.cwd()) {
  let current = from;
  while (current !== path.dirname(current)) {
    const dbPath = path.join(current, '.wednesday', 'graph.db');
    try {
      require('fs').accessSync(dbPath);
      return dbPath;
    } catch {
      current = path.dirname(current);
    }
  }
  return path.join(process.cwd(), '.wednesday', 'graph.db');
}

const dbPath = findDbPath();

// Wrapper functions that use the query layer
module.exports = {
  // File lookups
  getFileSummary(filePath) {
    const queries = loadQueries();
    return queries.getFileSummary(dbPath, filePath);
  },

  getBlastRadius(filePath) {
    const queries = loadQueries();
    return queries.getBlastRadius(dbPath, filePath);
  },

  searchFiles(query) {
    const queries = loadQueries();
    return queries.searchFiles(dbPath, query);
  },

  // Reading order & entry points
  getReadingOrder(limit = 25) {
    const queries = loadQueries();
    return queries.getReadingOrder(dbPath, limit);
  },

  getEntryPoints() {
    const queries = loadQueries();
    return queries.getEntryPoints(dbPath);
  },

  getHighConfidenceEntryPoints(threshold = 70) {
    const queries = loadQueries();
    return queries.getHighConfidenceEntryPoints(dbPath, threshold);
  },

  getOverallEntryPointConfidence() {
    const queries = loadQueries();
    return queries.getOverallEntryPointConfidence(dbPath);
  },

  // Risk & analysis
  getHighRiskFiles(minRisk = 60) {
    const queries = loadQueries();
    return queries.getHighRiskFiles(dbPath, minRisk);
  },

  getFilesByBand(band) {
    const queries = loadQueries();
    return queries.getFilesByBand(dbPath, band);
  },

  getFilesByRole() {
    const queries = loadQueries();
    return queries.getFilesByRole(dbPath);
  },

  // Dead code
  getAllDeadCode() {
    const queries = loadQueries();
    return queries.getAllDeadCode(dbPath);
  },

  // Structure
  getCircularDependencies() {
    const queries = loadQueries();
    return queries.getCircularDependencies(dbPath);
  },

  getCoverageGapsSummary() {
    const queries = loadQueries();
    return queries.getCoverageGapsSummary(dbPath);
  },

  // Stats
  getCodebaseStats() {
    const queries = loadQueries();
    return queries.getCodebaseStats(dbPath);
  },

  // DB path for advanced queries
  getDbPath() {
    return dbPath;
  },

  // Direct store access for advanced operations
  getStore() {
    return GraphStore.open(dbPath);
  },
};
