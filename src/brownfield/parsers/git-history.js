/**
 * 2A-3 — Git history miner
 * Zero LLM. Pure git commands.
 * Captures: commit count, bug fixes, hacks, file age, authors
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');

/**
 * Mine git history for a single file
 * @param {string} filePath - absolute path to file
 * @param {string} rootDir  - git root
 * @returns {Object} gitHistory data
 */
function mineFile(filePath, rootDir) {
  const rel = path.relative(rootDir, filePath);

  try {
    const log = execSync(
      `git log --follow --format="%H|%s|%ae|%ad" --date=short -- "${rel}"`,
      { cwd: rootDir, timeout: 10000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim();

    if (!log) return null;

    const lines = log.split('\n').filter(Boolean);
    const commits = lines.map(l => {
      const [hash, subject, email, date] = l.split('|');
      return { hash, subject: subject || '', email: email || '', date: date || '' };
    });

    const bugFixCommits = commits.filter(c =>
      /^fix(\(|!|:)/.test(c.subject) || /\bfix(es|ed)?\b/i.test(c.subject)
    ).length;

    const hackCommits = commits.filter(c =>
      /\b(hack|workaround|temporary|HACK|FIXME)\b/i.test(c.subject)
    ).length;

    const todoCount = commits.filter(c =>
      /\b(TODO|FIXME|HACK)\b/.test(c.subject)
    ).length;

    const dates = commits.map(c => c.date).filter(Boolean).sort();
    const firstCommit = dates[0] || null;
    const lastCommit = dates[dates.length - 1] || null;
    const ageInDays = firstCommit
      ? Math.floor((Date.now() - new Date(firstCommit).getTime()) / 86400000)
      : 0;

    // Unique authors sorted by commit count
    const authorMap = {};
    commits.forEach(c => {
      if (c.email) authorMap[c.email] = (authorMap[c.email] || 0) + 1;
    });
    const authors = Object.entries(authorMap)
      .filter(([email]) => {
        const lower = email.toLowerCase();
        return !lower.includes('.local') && 
               !lower.includes('apple@') && 
               !lower.includes('admin@') && 
               !lower.includes('macbook');
      })
      .sort((a, b) => b[1] - a[1])
      .map(([email, count]) => ({ email, commits: count }));

    return {
      totalCommits: commits.length,
      bugFixCommits,
      hackCommits,
      todoCount,
      firstCommit,
      lastCommit,
      ageInDays,
      authors,
    };
  } catch {
    return null;
  }
}

/**
 * Determine if a file should be in the danger zone based on git history
 */
function isDangerZone(gitHistory, riskScore, testCoverage) {
  if (!gitHistory) return false;
  return (
    gitHistory.bugFixCommits >= 3 ||
    gitHistory.hackCommits >= 1 ||
    riskScore >= 70 ||
    (testCoverage === 0 && gitHistory.ageInDays > 365)
  );
}

module.exports = { mineFile, isDangerZone };
