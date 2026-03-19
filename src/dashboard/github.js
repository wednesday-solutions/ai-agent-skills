'use strict';

const https = require('https');

function githubGet(path) {
  return new Promise((resolve, reject) => {
    const token = process.env.GITHUB_TOKEN;
    const options = {
      hostname: 'api.github.com',
      path,
      method: 'GET',
      headers: {
        'Authorization': token ? `Bearer ${token}` : '',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'wednesday-skills-dashboard',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve([]); }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * Fetch open PRs for the repo detected from git remote.
 * Falls back to empty array if no token or no remote.
 */
async function fetchOpenPRs(prFilter) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not set');

  // Detect repo from git remote
  let repoPath;
  try {
    const { execSync } = require('child_process');
    const remote = execSync('git remote get-url origin 2>/dev/null', { encoding: 'utf8' }).trim();
    const match = remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    if (match) repoPath = match[1];
  } catch {}

  if (!repoPath) throw new Error('No GitHub remote detected');

  const prs = await githubGet(`/repos/${repoPath}/pulls?state=open&per_page=20`);
  if (!Array.isArray(prs)) throw new Error(prs.message || 'GitHub API error');

  const filtered = prFilter ? prs.filter(p => p.number === Number(prFilter)) : prs;

  return filtered.map(pr => ({
    number: pr.number,
    title: pr.title,
    fixes: 0, // populated from triage cache
    branch: pr.head.ref,
  }));
}

module.exports = { fetchOpenPRs };
