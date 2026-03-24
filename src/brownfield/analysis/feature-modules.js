/**
 * Feature module detection.
 *
 * A feature module is a directory (1–2 levels below the source root) that:
 *   - Contains 2+ files
 *   - Has at least 1 external importer (a file outside the directory that imports into it)
 *
 * Ranked by external importer count — directories that other features depend on
 * are more "core" to the architecture than ones that only depend inward.
 *
 * This is different from "most-imported files" (utility detection). Feature modules
 * surface the logical units of the codebase — auth/, payments/, users/ — not helpers.
 */

'use strict';

const path = require('path');

/**
 * @param {Object} nodes - dep-graph nodes
 * @param {Object|null} commentIntel - output of analyseComments, optional
 * @returns {Array<{ dir, fileCount, externalImporters, internalImporters, files, purpose, techDebt, isBizFeature, ideas }>}
 */
function detectFeatureModules(nodes, commentIntel = null) {
  // Build a lookup of comment intel per dir for O(1) access
  const commentByDir = new Map();
  if (commentIntel && commentIntel.modules) {
    for (const mod of commentIntel.modules) {
      commentByDir.set(mod.dir, mod);
    }
  }
  const dirMap = {};

  // Group nodes by immediate parent directory
  for (const [file, node] of Object.entries(nodes)) {
    if (node.error || node.lang === 'shell' || node.lang === 'config') continue;
    // Skip test and generated files
    if (/\.test\.|\.spec\.|__tests__|node_modules/.test(file)) continue;

    const dir = path.dirname(file);
    if (dir === '.') continue; // root-level files are entry points, not features

    if (!dirMap[dir]) dirMap[dir] = { dir, files: [], externalImporters: new Set(), internalImporters: new Set() };
    dirMap[dir].files.push(file);
  }

  // Count external importers: files from outside the directory that import into it
  for (const [file, node] of Object.entries(nodes)) {
    const fileDir = path.dirname(file);
    for (const imp of node.imports) {
      const impDir = path.dirname(imp);
      // This file (in fileDir) imports something in impDir
      if (impDir !== fileDir && dirMap[impDir]) {
        dirMap[impDir].externalImporters.add(file);
      }
      if (impDir === fileDir && fileDir !== '.' && dirMap[fileDir]) {
        dirMap[fileDir].internalImporters.add(file);
      }
    }
  }

  return Object.values(dirMap)
    .filter(d => d.files.length >= 2 && d.externalImporters.size > 0)
    .map(d => {
      const intel = commentByDir.get(d.dir) || {};
      return {
        dir: d.dir,
        fileCount: d.files.length,
        externalImporters: d.externalImporters.size,
        internalImporters: d.internalImporters.size,
        files: d.files,
        // Comment intel enrichment
        purpose: intel.purpose || null,
        techDebt: intel.techDebt || null,
        isBizFeature: intel.isBizFeature ?? null,
        ideas: intel.ideas || [],
        taggedCount: intel.taggedCount || 0,
        untaggedCount: intel.untaggedCount || 0,
      };
    })
    .sort((a, b) => {
      // isBizFeature modules rank above infrastructure regardless of importer count
      const bizA = a.isBizFeature === true ? 1 : 0;
      const bizB = b.isBizFeature === true ? 1 : 0;
      if (bizB !== bizA) return bizB - bizA;
      return b.externalImporters - a.externalImporters;
    });
}

module.exports = { detectFeatureModules };
