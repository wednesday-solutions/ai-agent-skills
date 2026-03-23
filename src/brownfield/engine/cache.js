/**
 * 2A-5 — Incremental cache
 * File hash keyed. Only changed files re-parsed.
 * Target: < 1 second on 5-file PR.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Compute SHA1 hash of a file's contents
 */
function hashFile(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha1').update(buf).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Load the hash cache from .wednesday/cache/hashes.json
 */
function loadCache(cacheDir) {
  const cachePath = path.join(cacheDir, 'hashes.json');
  if (!fs.existsSync(cachePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Save updated hashes back to disk
 */
function saveCache(cacheDir, hashes) {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'hashes.json'), JSON.stringify(hashes, null, 2));
}

/**
 * Determine which files have changed since last run
 * @returns {{ changed: string[], unchanged: string[], hashes: Object }}
 */
function diffFiles(files, cacheDir) {
  const stored = loadCache(cacheDir);
  const current = {};
  const changed = [];
  const unchanged = [];

  for (const file of files) {
    const hash = hashFile(file);
    if (!hash) continue;
    current[file] = hash;
    if (stored[file] === hash) {
      unchanged.push(file);
    } else {
      changed.push(file);
    }
  }

  return { changed, unchanged, hashes: current };
}

/**
 * Load cached node data for unchanged files
 * @param {string[]} files - unchanged files
 * @param {string} cacheDir
 * @param {string} rootDir
 * @returns {Object} nodes keyed by relative path
 */
function loadCachedNodes(files, cacheDir, rootDir) {
  const summariesDir = path.join(cacheDir, 'summaries');
  const nodes = {};

  for (const file of files) {
    const rel = path.relative(rootDir, file);
    const cachePath = path.join(summariesDir, rel.replace(/\//g, '__') + '.json');
    if (fs.existsSync(cachePath)) {
      try {
        nodes[rel] = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      } catch {}
    }
  }

  return nodes;
}

/**
 * Save parsed node data to cache
 */
function saveCachedNodes(nodes, cacheDir, rootDir) {
  const summariesDir = path.join(cacheDir, 'summaries');
  fs.mkdirSync(summariesDir, { recursive: true });

  for (const [rel, node] of Object.entries(nodes)) {
    const cachePath = path.join(summariesDir, rel.replace(/\//g, '__') + '.json');
    try {
      fs.writeFileSync(cachePath, JSON.stringify(node, null, 2));
    } catch {}
  }
}

module.exports = {
  hashFile,
  loadCache,
  saveCache,
  diffFiles,
  loadCachedNodes,
  saveCachedNodes,
};
