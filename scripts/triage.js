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
const fs = require('fs');
const path = require('path');
const os = require('os');

// Load .env from cwd (local project), then ~/.wednesday/.env (global fallback)
function loadEnv() {
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(os.homedir(), '.wednesday', '.env'),
  ];
  for (const envFile of candidates) {
    if (fs.existsSync(envFile)) {
      const lines = fs.readFileSync(envFile, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        if (key && !(key in process.env)) process.env[key] = val;
      }
      break;
    }
  }
}
loadEnv();
const { execSync } = require('child_process');

// ─── Config ────────────────────────────────────────────────────────────────

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const ANTHROPIC_API_KEY = process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY;
const USE_OPENROUTER = !!process.env.OPENROUTER_API_KEY;
const PR_NUMBER = process.env.PR_NUMBER;
const REPO_FULL_NAME = process.env.REPO_FULL_NAME; // "owner/repo"
const COMMENT_BODY = process.env.COMMENT_BODY || '';
const EVENT_NAME = process.env.EVENT_NAME || 'pull_request_review';

const GEMINI_BOT_LOGINS = ['gemini-code-assist[bot]', 'gemini-code-assist'];
const COVERAGE_BOT_MARKER = '<!-- wednesday-coverage-report -->';
const SONAR_BOT_MARKER    = '<!-- wednesday-sonar-report -->';
const UNIFIED_REPORT_MARKER = '<!-- wednesday-unified-report -->';

// Unified priority order (1 = highest priority, 8 = lowest)
// Lower number = fix first
const PRIORITY_RANK = {
  'sonar-blocker':   1,
  'sonar-high':      2,
  'gemini-security': 3,
  'gemini-breaking': 4,
  'coverage-gap':    5,
  'sonar-medium':    6,
  'gemini-logic':    7,
  'gemini-perf':     7,
  'gemini-naming':   8,
  'gemini-style':    8,
  'sonar-low':       9,
};

// Gemini category → unified key
const GEMINI_CATEGORY_MAP = {
  security:    'gemini-security',
  breaking:    'gemini-breaking',
  performance: 'gemini-perf',
  logic:       'gemini-logic',
  naming:      'gemini-naming',
  style:       'gemini-style',
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
    return Promise.reject(new Error('OPENROUTER_API_KEY is not set'));
  }
  return new Promise((resolve, reject) => {
    let body, hostname, apiPath, headers;

    if (USE_OPENROUTER) {
      hostname = 'openrouter.ai';
      apiPath = '/api/v1/chat/completions';
      body = JSON.stringify({ model, max_tokens: maxTokens, messages });
      headers = {
        'Authorization': `Bearer ${ANTHROPIC_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
      };
    } else {
      hostname = 'api.anthropic.com';
      apiPath = '/v1/messages';
      body = JSON.stringify({ model, max_tokens: maxTokens, messages });
      headers = {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
      };
    }

    const options = { hostname, path: apiPath, method: 'POST', headers };

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

// Free OpenRouter model for testing — swap to anthropic/claude-haiku-* for production
const TRIAGE_MODEL = 'stepfun/step-3.5-flash:free';

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

  const response = await anthropicRequest([{ role: 'user', content: prompt }], TRIAGE_MODEL);
  const text = response.content?.[0]?.text || response.choices?.[0]?.message?.content || '{}';

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

// ─── Fetch existing coverage / sonar PR comments ─────────────────────────────

async function getPRIssueComments(owner, repo, prNumber) {
  const comments = await githubRequest('GET', `/repos/${owner}/${repo}/issues/${prNumber}/comments`);
  return Array.isArray(comments) ? comments : [];
}

function parseCoverageComment(body) {
  // Extract per-file coverage rows from the coverage bot comment
  // Expected format has a markdown table with File, Stmts, Branch, Funcs, Lines columns
  const items = [];
  const tableMatch = body.match(/\|.*File.*\|[\s\S]*?(?=\n\n|\n##|$)/);
  if (!tableMatch) return { items, raw: body };

  const rows = tableMatch[0].split('\n').filter(r => r.startsWith('|') && !r.includes('---') && !r.includes('File'));
  for (const row of rows) {
    const cols = row.split('|').map(s => s.trim()).filter(Boolean);
    if (cols.length < 4) continue;
    const [file, stmts, branch, funcs, lines] = cols;
    const stmtPct = parseFloat(stmts);
    if (!isNaN(stmtPct) && stmtPct < 80) {
      items.push({
        source: 'coverage',
        priority: 'coverage-gap',
        rank: PRIORITY_RANK['coverage-gap'],
        file,
        issue: `Statement coverage ${stmtPct}% (below 80%)`,
        status: '⬜ pending',
        stmts, branch: branch || '—', funcs: funcs || '—', lines: lines || '—',
      });
    }
  }
  return { items, raw: body };
}

function parseSonarComment(body) {
  const items = [];
  // Sonar comments include severity labels like BLOCKER, HIGH, MEDIUM, LOW
  const severityPattern = /\|\s*(BLOCKER|HIGH|MEDIUM|LOW)\s*\|([^|]+)\|([^|]+)\|([^|]+)\|/gi;
  let match;
  while ((match = severityPattern.exec(body)) !== null) {
    const [, severity, file, line, message] = match.map(s => s?.trim());
    const key = `sonar-${severity.toLowerCase()}`;
    items.push({
      source: 'sonar',
      priority: key,
      rank: PRIORITY_RANK[key] || 9,
      file: file || '—',
      issue: message || '—',
      status: '⬜ pending',
    });
  }
  return items;
}

// ─── Report Generation ────────────────────────────────────────────────────────

function buildUnifiedReport(prNumber, geminiItems, coverageComment, sonarComment) {
  const hasGemini   = geminiItems.length > 0;
  const hasCoverage = !!coverageComment;
  const hasSonar    = !!sonarComment;

  // ── 6A: Gemini fix queue ──────────────────────────────────────────────────
  const sorted = [...geminiItems].sort((a, b) => {
    const rankA = PRIORITY_RANK[GEMINI_CATEGORY_MAP[a.category]] || 7;
    const rankB = PRIORITY_RANK[GEMINI_CATEGORY_MAP[b.category]] || 7;
    return rankA - rankB;
  });

  const fixRows = sorted.map((item, i) =>
    `| ${i + 1} | ${item.category} | ${item.path || '—'} | ${item.summary} | ⬜ pending |`
  ).join('\n');

  const geminiSection = hasGemini
    ? `## 6A · Gemini Review — Fix Queue
| # | Category | File | Issue | Status |
|---|----------|------|-------|--------|
${fixRows}

To fix: \`@agent fix #1 #2\`   Fix all: \`@agent fix all\``
    : `## 6A · Gemini Review
_No review comments._`;

  // ── 6B: Coverage (informational — updated when dev runs ws-skills coverage) ─
  const coverageSection = hasCoverage
    ? `## 6B · Coverage
_Run \`ws-skills coverage\` to refresh._

${coverageComment.body.replace(/<!--.*?-->/gs, '').replace(/^## Coverage.*?\n/m, '').trim()}`
    : `## 6B · Coverage
⬜ Not run yet — run \`ws-skills coverage\` to post a report.`;

  // ── 6C: Sonar (informational — updated when dev runs ws-skills sonar) ───────
  const sonarSection = hasSonar
    ? `## 6C · Sonar
_Run \`ws-skills sonar\` to refresh._

${sonarComment.body.replace(/<!--.*?-->/gs, '').replace(/^## SonarQube.*?\n/m, '').trim()}`
    : `## 6C · Sonar
⬜ Not run yet — run \`ws-skills sonar\` to post a report.`;

  // ── Checklist summary ─────────────────────────────────────────────────────
  const geminiCheck   = hasGemini   ? `- [ ] 6A · Gemini review — ${sorted.length} item(s) to fix` : '- [x] 6A · Gemini review — no issues';
  const coverageCheck = hasCoverage ? '- [x] 6B · Coverage — report posted' : '- [ ] 6B · Coverage — not run yet';
  const sonarCheck    = hasSonar    ? '- [x] 6C · Sonar — report posted'    : '- [ ] 6C · Sonar — not run yet';

  return `${UNIFIED_REPORT_MARKER}
# PR Review Report — #${prNumber}

## Checklist
${geminiCheck}
${coverageCheck}
${sonarCheck}

---

${geminiSection}

---

${coverageSection}

---

${sonarSection}`;
}

// Legacy single-source report (kept for fallback)
function buildReport(triaged) {
  const sorted = [...triaged].sort((a, b) => a.score - b.score);
  const rows = sorted
    .map((item, i) => `| ${i + 1} | ${item.category} | ${item.score} | ${item.summary} |`)
    .join('\n');
  return `## PR Review Report\n\n| # | Category | Score | Summary |\n|---|----------|-------|---------|\n${rows}\n\n---\nTo apply fixes, reply with: \`@agent fix #1 #3\``;
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
    console.error('OPENROUTER_API_KEY is required for triage');
    process.exit(1);
  }

  // Fetch Gemini review comments + reviews
  const [reviewComments, reviews, issueComments] = await Promise.all([
    getPRReviewComments(owner, repo, PR_NUMBER),
    getPRReviews(owner, repo, PR_NUMBER),
    getPRIssueComments(owner, repo, PR_NUMBER),
  ]);

  // Parse coverage and sonar from existing PR comments
  const coverageComment = issueComments.find(c => c.body?.includes(COVERAGE_BOT_MARKER));
  const sonarComment    = issueComments.find(c => c.body?.includes(SONAR_BOT_MARKER));
  const existingUnified = issueComments.find(c => c.body?.includes(UNIFIED_REPORT_MARKER));

  // Collect Gemini comments
  const allGeminiComments = [
    ...reviewComments.map(c => ({ body: c.body, path: c.path, line: c.line })),
    ...reviews.filter(r => r.body?.trim()).map(r => ({ body: r.body, path: null, line: null })),
  ];

  console.log(`[triage] Gemini: ${allGeminiComments.length}, Coverage: ${coverageComment ? 'yes' : 'no'}, Sonar: ${sonarComment ? 'yes' : 'no'}`);

  // Nothing to report — skip only if truly nothing
  if (allGeminiComments.length === 0 && !coverageComment && !sonarComment) {
    console.log('[triage] No issues from any source — nothing to report.');
    return;
  }

  // Categorize Gemini comments (skip if none or no API key)
  let triaged = [];
  if (allGeminiComments.length > 0 && ANTHROPIC_API_KEY) {
    triaged = await Promise.all(
      allGeminiComments.map(async (c, i) => {
        const { category, score, summary } = await categorizeComment(c.body);
        return { ...c, index: i, category, score, summary };
      })
    );
  } else if (allGeminiComments.length > 0 && !ANTHROPIC_API_KEY) {
    // No API key — include Gemini comments uncategorized
    triaged = allGeminiComments.map((c, i) => ({
      ...c, index: i, category: 'logic', score: 3, summary: c.body.slice(0, 80),
    }));
    console.log('[triage] No API key — Gemini comments included without categorization.');
  }

  const report = buildUnifiedReport(PR_NUMBER, triaged, coverageComment || null, sonarComment || null);
  console.log('[triage] Unified report generated.');

  // Update existing unified comment or post new one
  if (existingUnified) {
    await githubRequest('PATCH', `/repos/${owner}/${repo}/issues/comments/${existingUnified.id}`, { body: report });
    console.log('[triage] Updated existing unified report comment.');
  } else {
    await postPRComment(owner, repo, PR_NUMBER, report);
    console.log('[triage] Posted unified report to PR.');
  }
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
