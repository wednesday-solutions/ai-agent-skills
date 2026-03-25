/**
 * Feature module detection.
 *
 * A feature module is a directory (1–2 levels below the source root) that:
 *   - Contains 2+ files
 *   - Has at least 1 external importer (a file outside the directory that imports into it)
 *
 * Ranked by: isBizFeature first, then external importer count.
 * isBizFeature is sourced from comment intel (post-enrichment) or inferred from
 * directory name heuristics (pre-enrichment, zero LLM tokens).
 *
 * Pre-enrichment tiebreaker: taggedCount — directories with more TODO/FIXME/HACK tags
 * signal active business logic (devs rarely tag utility files).
 */

'use strict';

const path = require('path');

// Directories that are almost certainly business features regardless of import count
const BIZ_PATTERNS = /(?:^|[/\\])(auth|payments?|billing|orders?|users?|accounts?|checkout|notifications?|subscriptions?|cart|products?|inventory|dashboard|reports?|analytics|messaging|chat|booking|scheduling|transactions?|invoices?|onboarding|sessions?|roles?|permissions?)(?:[/\\]|$)/i;

// Directories that are almost certainly infrastructure (suppress false biz-feature ranking)
const INFRA_PATTERNS = /(?:^|[/\\])(utils?|helpers?|lib|config|common|shared|constants?|types?|hooks?|styles?|assets|public|static|vendor|generated|migrations?|seeds?|fixtures?|mocks?|stubs?|i18n|locale|theme)(?:[/\\]|$)/i;

/**
 * Infer isBizFeature from directory name when comment intel hasn't run yet.
 * Returns true/false/null — null means "unknown, use importer count only".
 */
function inferBizFeature(dir) {
  if (BIZ_PATTERNS.test(dir)) return true;
  if (INFRA_PATTERNS.test(dir)) return false;
  return null;
}

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
    .filter(d => {
      if (d.files.length < 2) return false;
      if (d.externalImporters.size === 0) return false;

      const intel = commentByDir.get(d.dir);

      // Hard-exclude directories that are definitively infra:
      //   - LLM/enrichment explicitly marked isBizFeature: false
      //   - Name matches INFRA_PATTERNS AND no enrichment override says otherwise
      if (intel?.isBizFeature === false) return false;
      if (intel?.isBizFeature !== true && INFRA_PATTERNS.test(d.dir)) return false;

      return true;
    })
    .map(d => {
      const intel = commentByDir.get(d.dir) || {};
      // isBizFeature: prefer LLM-enriched value, fall back to name heuristic
      const isBizFeature = intel.isBizFeature ?? inferBizFeature(d.dir);
      return {
        dir: d.dir,
        fileCount: d.files.length,
        externalImporters: d.externalImporters.size,
        internalImporters: d.internalImporters.size,
        files: d.files,
        purpose: intel.purpose || null,
        techDebt: intel.techDebt || null,
        isBizFeature,
        ideas: intel.ideas || [],
        taggedCount: intel.taggedCount || 0,
        untaggedCount: intel.untaggedCount || 0,
      };
    })
    .sort((a, b) => {
      // 1st: tagged comments — more TODO/FIXME = more active business logic
      if (b.taggedCount !== a.taggedCount) return b.taggedCount - a.taggedCount;
      // 2nd: external importer count
      return b.externalImporters - a.externalImporters;
    });
}

module.exports = { detectFeatureModules };
