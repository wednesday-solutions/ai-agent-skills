'use strict';

/**
 * Role Classifier — Phase 3
 *
 * Automatically classify files into semantic roles:
 * - Util: Pure functions, helpers, no side effects
 * - Logic: Core business logic, algorithms
 * - Infra: System/framework glue, config, connections
 * - Adapter: External service boundaries (DB, API, cache)
 * - Test: Test files, fixtures, mocks
 * - Config: Config files, constants, enums
 * - Entry: Entry points, CLI, servers, main
 */

const path = require('path');

/**
 * Classify a single file's role
 * @param {string} file
 * @param {Object} node
 * @param {Object} nodes — all nodes (for context)
 * @returns {Object} — { primaryRole, confidence, reason }
 */
function classifyRole(file, node, nodes = {}) {
  let role = 'Util';
  let confidence = 50;
  const reasons = [];

  // Test detection
  if (node.meta?.isTest || /\.test\.|\.spec\.|__tests__|\/tests?\/|Test\./.test(file)) {
    return { primaryRole: 'Test', confidence: 95, reason: 'Test file pattern' };
  }

  // Entry point detection
  const basename = path.basename(file);
  if (['index.js', 'index.ts', 'main.js', 'cli.js', 'server.js', 'app.js'].includes(basename) || file.startsWith('bin/')) {
    role = 'Entry';
    confidence = 85;
    reasons.push('Entry point naming');
  }

  // Config detection
  if (/\.config\.|setup\.|constant|enum|types\.d\.ts/i.test(file) || /^\/?config\//.test(file)) {
    role = 'Config';
    confidence = 90;
    reasons.push('Config file pattern');
  }

  // Adapter detection (external services)
  const hasAdapter = (node.meta?.adapters?.length || 0) > 0;
  const isFromAdapterDir = /^\/?(?:adapter|client|service|db|repository|integration)\//.test(file);
  if (hasAdapter || isFromAdapterDir) {
    role = 'Adapter';
    confidence = hasAdapter ? 90 : 60;
    reasons.push(hasAdapter ? 'Uses external adapters' : 'Adapter directory');
  }

  // Infra detection (framework glue, utilities)
  const isFromInfraDir = /^\/?(?:infra|middleware|router|coordinator|handler|interceptor|plugin)\//.test(file);
  const isMiddleware = /middleware|interceptor|plugin|handler|coordinator/i.test(basename);
  if (isFromInfraDir || isMiddleware) {
    role = 'Infra';
    confidence = isFromInfraDir ? 75 : 65;
    reasons.push('Infrastructure/framework file');
  }

  // Logic detection (core business logic)
  const hasDomainTerms = /business|domain|core|logic|processor|calculator|engine|solver|analyzer|generator|transformer|builder|factory|manager|controller|handler|service|use.?case/i.test(file);
  const hasHighImportedBy = (node.importedBy?.length || 0) > 5;
  const hasComplexExports = (node.exports?.length || 0) > 3;
  if (hasDomainTerms || (hasHighImportedBy && hasComplexExports)) {
    role = 'Logic';
    confidence = hasDomainTerms ? 80 : 65;
    reasons.push(hasDomainTerms ? 'Domain logic naming' : 'Heavily imported with exports');
  }

  // Util detection (pure functions, helpers)
  const isFromUtilDir = /^\/?(?:util|helper|lib|common|shared)\//.test(file);
  const isPure = (node.imports?.length || 0) < 3 && (node.importedBy?.length || 0) < 10 && !hasAdapter;
  if (isFromUtilDir && isPure) {
    role = 'Util';
    confidence = 75;
    reasons.push('Utility/helper file');
  }

  return {
    primaryRole: role,
    confidence,
    reason: reasons.join('; ') || 'Default classification',
  };
}

/**
 * Classify all files in a codebase
 * @param {Object} nodes
 * @returns {Array} — [{filePath, primaryRole, confidence, reason}]
 */
function classifyAllRoles(nodes) {
  const classifications = [];

  for (const [file, node] of Object.entries(nodes)) {
    if (node.isTest) continue; // Skip test files in main classification

    const result = classifyRole(file, node, nodes);
    classifications.push({
      filePath: file,
      ...result,
    });
  }

  return classifications;
}

module.exports = { classifyRole, classifyAllRoles };
