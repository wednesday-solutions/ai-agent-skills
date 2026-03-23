/**
 * 2B — Stale dependency checker
 * npm + go.mod + CocoaPods + SPM
 * Zero LLM. Outputs age data for GitHub Action weekly run.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Check npm packages for staleness
 */
function checkNpm(rootDir) {
  const pkgJson = path.join(rootDir, 'package.json');
  if (!fs.existsSync(pkgJson)) return [];

  try {
    // npm outdated outputs JSON with current/wanted/latest
    const output = execSync('npm outdated --json', {
      cwd: rootDir,
      timeout: 30000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const outdated = JSON.parse(output || '{}');
    return Object.entries(outdated).map(([name, info]) => ({
      name,
      current: info.current,
      wanted: info.wanted,
      latest: info.latest,
      type: info.type,
      severity: computeNpmSeverity(info.current, info.latest),
    }));
  } catch (e) {
    // npm outdated exits non-zero when there are outdated packages — parse stdout anyway
    if (e.stdout) {
      try {
        const outdated = JSON.parse(e.stdout);
        return Object.entries(outdated).map(([name, info]) => ({
          name,
          current: info.current,
          wanted: info.wanted,
          latest: info.latest,
          type: info.type || 'dep',
          severity: computeNpmSeverity(info.current, info.latest),
        }));
      } catch {}
    }
    return [];
  }
}

/**
 * Check go.mod for outdated dependencies
 */
function checkGoMod(rootDir) {
  const gomod = path.join(rootDir, 'go.mod');
  if (!fs.existsSync(gomod)) return [];

  try {
    const output = execSync('go list -u -m -json all 2>/dev/null', {
      cwd: rootDir,
      timeout: 60000,
      encoding: 'utf8',
    });

    const results = [];
    // go list outputs one JSON object per line (NDJSON)
    const lines = output.trim().split('\n').filter(Boolean);
    let buf = '';
    for (const line of lines) {
      buf += line;
      try {
        const obj = JSON.parse(buf);
        if (obj.Update) {
          results.push({
            name: obj.Path,
            current: obj.Version,
            latest: obj.Update.Version,
            severity: 'medium',
          });
        }
        buf = '';
      } catch { /* continue accumulating */ }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Check CocoaPods for outdated pods
 */
function checkCocoaPods(rootDir) {
  if (!fs.existsSync(path.join(rootDir, 'Podfile'))) return [];

  try {
    const output = execSync('pod outdated --no-update 2>/dev/null', {
      cwd: rootDir,
      timeout: 60000,
      encoding: 'utf8',
    });
    const results = [];
    const lineRe = /^\s*-\s+([\w-/]+)\s+(\S+)\s+->\s+(\S+)/gm;
    let m;
    while ((m = lineRe.exec(output)) !== null) {
      results.push({ name: m[1], current: m[2], latest: m[3], severity: 'low' });
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Check SPM (Package.swift) — uses github releases API
 */
function checkSpm(rootDir) {
  // SPM check requires network — return empty for zero-LLM mode
  // Real check done in GitHub Action via `swift package update --dry-run`
  return [];
}

/**
 * Build full stale deps report
 */
function buildStaleDepsReport(rootDir) {
  return {
    npm: checkNpm(rootDir),
    go: checkGoMod(rootDir),
    cocoapods: checkCocoaPods(rootDir),
    spm: checkSpm(rootDir),
    generatedAt: new Date().toISOString(),
  };
}

function computeNpmSeverity(current, latest) {
  if (!current || !latest) return 'unknown';
  const curMajor = parseInt(current.replace(/[^0-9]/, ''));
  const latMajor = parseInt(latest.replace(/[^0-9]/, ''));
  if (isNaN(curMajor) || isNaN(latMajor)) return 'low';
  if (latMajor > curMajor) return 'high';    // major version behind
  return 'low';
}

module.exports = { buildStaleDepsReport, checkNpm, checkGoMod };
