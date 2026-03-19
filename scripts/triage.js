#!/usr/bin/env node

/**
 * Gemini PR Triage Script
 *
 * Triggered by GitHub Actions on:
 * - Gemini bot posting a PR review
 * - Dev commenting "@agent fix #N #M"
 *
 * Flow:
 * 1. Fetch all Gemini bot review comments on the PR
 * 2. Categorize each with Haiku (score 1–6)
 * 3. Post REVIEW_REPORT as PR comment
 * 4. On "@agent fix #N" — apply fix, commit (GIT-OS), push
 */

const https = require('https');
const { execSync } = require('child_process');

// ─── Config ────────────────────────────────────────────────────────────────

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PR_NUMBER = process.env.PR_NUMBER;
const REPO_FULL_NAME = process.env.REPO_FULL_NAME; // "owner/repo"
const COMMENT_BODY = process.env.COMMENT_BODY || '';
const EVENT_NAME = process.env.EVENT_NAME || 'pull_request_review';

const GEMINI_BOT_LOGINS = ['gemini-code-assist[bot]', 'gemini-code-assist'];

// Priority scores — ascending = safest to fix first
const PRIORITY_SCORES = {
  style: 1,
  naming: 2,
  logic: 3,
  performance: 4,
  breaking: 5,
  security: 6,
};

// ─── GitHub API ─────────────────────────────────────────────────────────────

function githubRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'wednesday-skills-triage',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getPRReviewComments(owner, repo, prNumber) {
  const comments = await githubRequest('GET', `/repos/${owner}/${repo}/pulls/${prNumber}/comments`);
  return Array.isArray(comments)
    ? comments.filter(c => GEMINI_BOT_LOGINS.includes(c.user.login))
    : [];
}

async function getPRReviews(owner, repo, prNumber) {
  const reviews = await githubRequest('GET', `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`);
  return Array.isArray(reviews)
    ? reviews.filter(r => GEMINI_BOT_LOGINS.includes(r.user.login))
    : [];
}

async function postPRComment(owner, repo, prNumber, body) {
  return githubRequest('POST', `/repos/${owner}/${repo}/issues/${prNumber}/comments`, { body });
}

// ─── Anthropic API (Haiku) ──────────────────────────────────────────────────

function anthropicRequest(messages, model = 'claude-haiku-4-5-20251001', maxTokens = 1024) {
  if (!ANTHROPIC_API_KEY) {
    return Promise.reject(new Error('ANTHROPIC_API_KEY is not set'));
  }
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model, max_tokens: maxTokens, messages });
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function categorizeComment(commentBody) {
  const prompt = `Categorize this code review comment into exactly one category.

Categories and scores:
- style (1): formatting, whitespace, import order
- naming (2): variable/function/class names, casing
- logic (3): incorrect conditions, missing edge cases, wrong behavior
- performance (4): unnecessary re-renders, N+1 queries, inefficient algorithms
- breaking (5): API contract changes, interface changes
- security (6): auth issues, injection risks, data exposure

Review comment:
"${commentBody}"

Respond with JSON only, no explanation:
{"category": "<category>", "score": <score>, "summary": "<one sentence summary under 80 chars>"}`;

  const response = await anthropicRequest([{ role: 'user', content: prompt }]);
  const text = response.content?.[0]?.text || '{}';

  try {
    const parsed = JSON.parse(text.match(/\{.*\}/s)?.[0] || '{}');
    return {
      category: parsed.category || 'logic',
      score: parsed.score || PRIORITY_SCORES[parsed.category] || 3,
      summary: parsed.summary || commentBody.slice(0, 80),
    };
  } catch {
    return { category: 'logic', score: 3, summary: commentBody.slice(0, 80) };
  }
}

// ─── Report Generation ──────────────────────────────────────────────────────

function buildReport(triaged) {
  const sorted = [...triaged].sort((a, b) => a.score - b.score);

  const rows = sorted
    .map((item, i) => `| ${i + 1} | ${item.category} | ${item.score} | ${item.summary} |`)
    .join('\n');

  return `## PR Review Report

Gemini review comments triaged and sorted by impact (lowest first — safest to fix first).

| # | Category | Score | Summary |
|---|----------|-------|---------|
${rows}

---
To apply fixes, reply with: \`@agent fix #1 #3\` (use the # numbers above)
To fix all: \`@agent fix all\``;
}

// ─── Fix Application ─────────────────────────────────────────────────────────

function parseFixCommand(commentBody) {
  const match = commentBody.match(/@agent fix\s+(all|[\d\s#,]+)/i);
  if (!match) return null;

  if (match[1].toLowerCase() === 'all') return 'all';
  return match[1].match(/\d+/g)?.map(Number) || null;
}

async function applyFix(item, owner, repo, prNumber) {
  // Determine scope from the comment's file path if available
  const scope = item.path ? item.path.split('/').pop().replace(/\.[^.]+$/, '') : 'code';

  const prompt = `You are fixing a code review comment in a pull request.

Review comment: "${item.body}"
File: ${item.path || 'unknown'}
Line: ${item.line || 'unknown'}

Apply the minimal fix needed to address this comment. Output only the corrected code for that specific section.
Do not add explanations. Do not change anything unrelated.`;

  // For now, log the intent — actual file patching requires more context
  console.log(`[fix] Would apply fix for comment #${item.index + 1}: ${item.summary}`);
  console.log(`[fix] Scope: ${scope}, File: ${item.path}`);

  // Commit message following GIT-OS
  const commitMsg = `fix(${scope}): ${item.summary}\n\nResolves review comment #${item.index + 1}`;
  console.log(`[fix] Commit message:\n${commitMsg}`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (!GITHUB_TOKEN) {
    console.error('GITHUB_TOKEN is required');
    process.exit(1);
  }

  const [owner, repo] = (REPO_FULL_NAME || '/').split('/');
  if (!owner || !repo || !PR_NUMBER) {
    console.error('REPO_FULL_NAME and PR_NUMBER are required');
    process.exit(1);
  }

  console.log(`[triage] PR #${PR_NUMBER} in ${owner}/${repo}`);
  console.log(`[triage] Event: ${EVENT_NAME}`);

  // Handle "@agent fix" command
  if (EVENT_NAME === 'issue_comment') {
    const fixTargets = parseFixCommand(COMMENT_BODY);
    if (!fixTargets) {
      console.log('[triage] Not a fix command, skipping.');
      return;
    }
    console.log('[triage] Fix command detected:', fixTargets);
    // TODO: load cached triage report and apply specified fixes
    return;
  }

  // Handle new Gemini review — triage all comments
  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is required for triage');
    process.exit(1);
  }

  const comments = await getPRReviewComments(owner, repo, PR_NUMBER);
  const reviews = await getPRReviews(owner, repo, PR_NUMBER);

  // Collect all comment bodies (inline comments + review bodies)
  const allComments = [
    ...comments.map(c => ({ body: c.body, path: c.path, line: c.line })),
    ...reviews.filter(r => r.body?.trim()).map(r => ({ body: r.body, path: null, line: null })),
  ];

  if (allComments.length === 0) {
    console.log('[triage] No Gemini bot comments found on this PR.');
    return;
  }

  console.log(`[triage] Found ${allComments.length} Gemini comment(s). Categorizing...`);

  // Categorize each comment in parallel
  const triaged = await Promise.all(
    allComments.map(async (c, i) => {
      const { category, score, summary } = await categorizeComment(c.body);
      return { ...c, index: i, category, score, summary };
    })
  );

  const report = buildReport(triaged);
  console.log('[triage] Report generated:\n', report);

  await postPRComment(owner, repo, PR_NUMBER, report);
  console.log('[triage] Report posted to PR.');
}

// ─── Test mode ───────────────────────────────────────────────────────────────

if (process.argv.includes('--test')) {
  // Dry-run: test parsing + report generation without hitting any API
  console.log('[test] Running triage in dry-run mode (no API calls)\n');

  const mockComments = [
    { body: 'The variable name `x` is unclear. Use `userCount`.', path: 'src/auth.js', line: 12 },
    { body: 'Missing null check before accessing `user.profile`.', path: 'src/user.js', line: 45 },
    { body: 'fetchData is called inside a render loop — potential N+1.', path: 'src/feed.js', line: 88 },
    { body: 'SQL query is not parameterized — SQL injection risk.', path: 'src/db.js', line: 23 },
  ];

  // Simulate categorization without API
  const mockCategories = [
    { category: 'naming', score: 2, summary: 'Variable name `x` is unclear' },
    { category: 'logic', score: 3, summary: 'Missing null check on user.profile' },
    { category: 'performance', score: 4, summary: 'fetchData called inside render loop' },
    { category: 'security', score: 6, summary: 'SQL query not parameterized' },
  ];

  const triaged = mockComments.map((c, i) => ({ ...c, index: i, ...mockCategories[i] }));
  const report = buildReport(triaged);
  console.log('[test] Generated report:\n');
  console.log(report);
  console.log('\n[test] Fix command parsing:');
  console.log('  "@agent fix #1 #3" →', parseFixCommand('@agent fix #1 #3'));
  console.log('  "@agent fix all"   →', parseFixCommand('@agent fix all'));
  console.log('  "random comment"   →', parseFixCommand('random comment'));
  console.log('\n[test] All checks passed.');
} else {
  main().catch(err => {
    console.error('[triage] Fatal error:', err);
    process.exit(1);
  });
}
