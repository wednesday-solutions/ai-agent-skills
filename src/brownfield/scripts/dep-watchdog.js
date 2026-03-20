/**
 * dep-watchdog.js — Stale dependency watchdog
 * Runs weekly via GitHub Action. Zero LLM.
 * Writes report to .wednesday/codebase/analysis/stale-deps.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { buildStaleDepsReport } = require('../analysis/stale-deps');

const rootDir = process.argv[2] || process.cwd();
const analysisDir = path.join(rootDir, '.wednesday', 'codebase', 'analysis');

console.log(`Checking stale dependencies in: ${rootDir}`);

const report = buildStaleDepsReport(rootDir);

fs.mkdirSync(analysisDir, { recursive: true });
const outPath = path.join(analysisDir, 'stale-deps.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

const total = report.npm.length + report.go.length + report.cocoapods.length;
const highSeverity = [
  ...report.npm.filter(d => d.severity === 'high'),
  ...report.go.filter(d => d.severity === 'high'),
].length;

console.log(`Done. ${total} outdated packages (${highSeverity} high severity)`);
console.log(`Report: ${outPath}`);

if (highSeverity > 0) {
  process.exit(1); // Non-zero for GitHub Action to flag
}
