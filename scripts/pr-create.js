#!/usr/bin/env node

/**
 * PR Create — headless terminal fallback for wednesday-skills pr
 *
 * Implements the same flow as the pr-create SKILL.md:
 * 1. Validate branch name
 * 2. Run pre-push checklist
 * 3. Extract ticket ID + generate title from commits
 * 4. Detect stacked branch
 * 5. Build GIT-OS PR body
 * 6. git push + gh pr create
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Load .env from cwd, then ~/.wednesday/.env
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

// ─── Colours ─────────────────────────────────────────────────────────────────

const c = {
  red:    s => `\x1b[31m${s}\x1b[0m`,
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  dim:    s => `\x1b[90m${s}\x1b[0m`,
};

function step(msg)  { console.log(`\n  ${c.cyan('→')} ${msg}`); }
function ok(msg)    { console.log(`  ${c.green('✓')} ${msg}`); }
function fail(msg)  { console.log(`  ${c.red('✗')} ${msg}`); }
function info(msg)  { console.log(`  ${c.dim(msg)}`); }

// ─── Git helpers ──────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: opts.capture ? 'pipe' : 'inherit' }).trim();
}

function tryRun(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim(); }
  catch { return null; }
}

function currentBranch() {
  return run('git branch --show-current', { capture: true });
}

function mainBase() {
  return tryRun('git merge-base HEAD origin/main')
      || tryRun('git merge-base HEAD main')
      || '';
}

// Returns the feature branch this is stacked on, or 'main'
function detectBase(branch) {
  const base = mainBase();
  if (!base) return 'main';

  const remotes = tryRun('git branch -r --format="%(refname:short) %(objectname)"') || '';
  for (const line of remotes.split('\n')) {
    const parts = line.trim().split(' ');
    if (parts.length < 2) continue;
    const [ref, sha] = parts;
    const name = ref.replace('origin/', '');
    if (name === 'main' || name === 'HEAD' || name === branch) continue;
    if (sha.startsWith(base.slice(0, 7)) || base.startsWith(sha)) return name;
  }
  return 'main';
}

function branchCommits(base) {
  const mergeBase = mainBase() || `origin/${base}`;
  const out = tryRun(`git log --reverse --format="%s" ${mergeBase}..HEAD`) || '';
  return out.split('\n').filter(Boolean);
}

// ─── Step 1: Validate branch name ────────────────────────────────────────────

function validateBranch(branch) {
  const valid = /^(feat|fix|chore|test|hotfix)\/.+/.test(branch);
  if (!valid) {
    fail(`Branch "${branch}" does not follow GIT-OS naming.`);
    console.log(`
  Branch must match: ${c.cyan('feat|fix|chore|test|hotfix/<name>')}

  Examples:
    feat/user-auth
    fix/WED-142-token-crash
    chore/update-deps

  Rename with:
    ${c.dim(`git branch -m ${branch} feat/<description>`)}`);
    process.exit(1);
  }
  ok(`Branch name valid: ${c.cyan(branch)}`);
}

// ─── Step 2: Pre-push checklist ───────────────────────────────────────────────

function runChecklist() {
  const scripts = ['lint', 'format:check', 'test', 'build'];
  let pkg = {};
  try { pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')); }
  catch { info('No package.json found — skipping checklist'); return; }

  const available = scripts.filter(s => pkg.scripts?.[s]);
  const skipped   = scripts.filter(s => !pkg.scripts?.[s]);

  if (skipped.length) info(`Skipping (not in package.json): ${skipped.join(', ')}`);

  for (const script of available) {
    try {
      execSync(`npm run ${script}`, { stdio: 'pipe' });
      ok(`npm run ${script}`);
    } catch (e) {
      fail(`npm run ${script} failed`);
      console.log(`\n${c.red(e.stdout?.toString() || e.message)}`);
      process.exit(1);
    }
  }
}

// ─── Step 3: Ticket ID ────────────────────────────────────────────────────────

function extractTicket(branch) {
  const match = branch.match(/([A-Z]+-\d+)/);
  return match ? match[1] : null;
}

// ─── Step 4: PR title from commits ───────────────────────────────────────────

function buildTitle(branch, commits) {
  if (commits.length > 0) return commits[0];
  // Fallback: derive from branch name
  const name = branch.replace(/^(feat|fix|chore|test|hotfix)\//, '').replace(/-/g, ' ');
  const type = branch.split('/')[0];
  return `${type}: ${name}`;
}

// ─── Step 5–6: PR body ────────────────────────────────────────────────────────

function buildBody(commits, ticket, base, isStacked) {
  const linearBase = 'https://linear.app/wednesday-solutions/issue';
  const ticketLine = ticket ? `${linearBase}/${ticket}` : '<!-- Add ticket link -->';

  const description = commits.length > 1
    ? commits.map(c => `- ${c}`).join('\n')
    : commits[0] || '<!-- Describe the changes -->';

  const stackNote = isStacked
    ? `\n> **Stacked PR** — base branch is \`${base}\`. Merge \`${base}\` first, then merge this.\n`
    : '';

  return `### Ticket Link
${ticketLine}

---

### Description
${description}
${stackNote}
---

### Steps to Test
<!-- Fill in before requesting review -->

---

### GIFs
<!-- Add screen recordings if UI changes -->`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n  ${c.cyan('Wednesday Skills')} — PR Create\n`);

  step('Validating branch name...');
  const branch = currentBranch();
  validateBranch(branch);

  step('Running pre-push checklist...');
  runChecklist();

  step('Preparing PR details...');
  const ticket    = extractTicket(branch);
  const base      = detectBase(branch);
  const isStacked = base !== 'main';
  const commits   = branchCommits(base);
  const title     = buildTitle(branch, commits);
  const body      = buildBody(commits, ticket, base, isStacked);

  if (ticket) ok(`Ticket: ${c.cyan(ticket)}`);
  ok(`Base branch: ${c.cyan(base)}${isStacked ? c.yellow(' (stacked)') : ''}`);
  ok(`PR title: ${c.cyan(title)}`);
  info(`${commits.length} commit(s) on branch`);

  step(`Pushing ${c.cyan(branch)} to origin...`);
  try {
    run(`git push origin ${branch}`);
    ok('Pushed');
  } catch (e) {
    fail('Push failed. Try: git pull --rebase origin ' + base);
    process.exit(1);
  }

  step('Creating PR...');
  const bodyEscaped = body.replace(/'/g, `'\\''`);
  try {
    const prUrl = run(`gh pr create --title '${title}' --base ${base} --body '${bodyEscaped}'`, { capture: true });
    ok(c.green(`PR created: ${prUrl}`));
    console.log('');
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('already exists')) {
      fail('A PR for this branch already exists.');
      const existing = tryRun(`gh pr view --json url -q .url`);
      if (existing) info(`Existing PR: ${existing}`);
    } else if (msg.includes('gh: command not found') || msg.includes('not found')) {
      fail('GitHub CLI not installed. Install with: brew install gh');
    } else {
      fail('gh pr create failed:');
      console.log(c.red(msg));
    }
    process.exit(1);
  }
}

main().catch(e => {
  console.error(c.red(`\nFatal: ${e.message}`));
  process.exit(1);
});
