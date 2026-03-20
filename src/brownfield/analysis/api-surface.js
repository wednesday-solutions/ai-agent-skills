/**
 * 2B — API surface analysis
 * Distinguishes public contracts (imported by others) from internal exports.
 */

'use strict';

/**
 * Compute API surface for a file
 * @returns {{ publicContracts: string[], internalExports: string[], importedByCount: number }}
 */
function apiSurface(file, nodes) {
  const node = nodes[file];
  if (!node) return { publicContracts: [], internalExports: [], importedByCount: 0 };

  const importedByCount = node.importedBy.length;

  // An export is "public" if it's exported AND the file is imported by others
  // We can't know which specific exports are used without full call-graph analysis,
  // so we mark all exports as public if the file has importers
  const publicContracts = importedByCount > 0 ? node.exports : [];
  const internalExports = importedByCount === 0 ? node.exports : [];

  return { publicContracts, internalExports, importedByCount };
}

/**
 * Build full API surface map for the entire graph
 */
function buildApiSurface(nodes) {
  const surface = {};
  for (const file of Object.keys(nodes)) {
    surface[file] = apiSurface(file, nodes);
  }
  return surface;
}

module.exports = { apiSurface, buildApiSurface };
