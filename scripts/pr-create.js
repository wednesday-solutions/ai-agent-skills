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

const { execSync, spawnSync } = require('child_process');
const https = require('https');
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

  // Only consider branches that follow GIT-OS feature branch naming as potential stack bases
  const featureBranchPattern = /^(feat|fix|chore|test|hotfix)\/.+/;

  const remotes = tryRun('git branch -r --format=%(refname:short) %(objectname)') || '';
  for (const line of remotes.split('\n')) {
    const spaceIdx = line.trim().indexOf(' ');
    if (spaceIdx === -1) continue;
    const ref = line.trim().slice(0, spaceIdx);
    const sha = line.trim().slice(spaceIdx + 1);
    const name = ref.replace(/^origin\//, '');
    if (!featureBranchPattern.test(name)) continue;
    if (name === branch) continue;
    if (sha === base) return name;
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
    console.log(`  ${c.yellow('⚠')} Branch "${c.yellow(branch)}" does not follow GIT-OS naming.`);
    console.log(`  ${c.dim('Recommended: feat|fix|chore|test|hotfix/<name> — continuing anyway.')}`);
  } else {
    ok(`Branch name valid: ${c.cyan(branch)}`);
  }
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

// ─── AI description generation ───────────────────────────────────────────────

function branchDiff() {
  const mergeBase = mainBase();
  if (!mergeBase) return '';
  const stat = tryRun(`git diff --stat ${mergeBase}..HEAD`) || '';
  const diff = tryRun(`git diff ${mergeBase}..HEAD`) || '';
  // Cap diff at 4000 chars to stay within token budget
  return `${stat}\n\n${diff}`.slice(0, 4000);
}

async function generateDescription(commits, diff) {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !diff.trim()) return null;

  const commitList = commits.map((c, i) => `${i + 1}. ${c}`).join('\n');
  const prompt = `You are writing the Description section of a GitHub Pull Request.

Commits on this branch:
${commitList}

Git diff summary:
${diff}

Write a concise PR description (2–4 sentences). Explain what changed and why — not how.
Do not repeat commit messages verbatim. Do not include headings, bullet points, or markdown.
Output only the description text, nothing else.`;

  return new Promise(resolve => {
    const body = JSON.stringify({
      model: 'stepfun/step-3.5-flash:free',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const req = https.request({
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const text = json.choices?.[0]?.message?.content?.trim();
          resolve(text || null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

// ─── Step 5–6: PR body ────────────────────────────────────────────────────────

function buildBody(commits, aiDescription, ticket, base, isStacked) {
  const linearBase = 'https://linear.app/wednesday-solutions/issue';
  const ticketLine = ticket
    ? `${linearBase}/${ticket}`
    : '_No ticket — add link if applicable_';

  // AI description takes priority; fall back to commit bullet list
  const description = aiDescription
    || (commits.length > 1 ? commits.map(c => `- ${c}`).join('\n') : commits[0])
    || '<!-- Describe the changes -->';

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

// ─── Config ───────────────────────────────────────────────────────────────────

function loadWednesdayConfig() {
  const configPath = path.join(process.cwd(), '.wednesday', 'config.json');
  if (!fs.existsSync(configPath)) return {};
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); }
  catch { return {}; }
}

function runPRScript(scriptName, base) {
  // Look in project's .wednesday/scripts/ first (installed copy), then package assets/
  const projectScript = path.join(process.cwd(), '.wednesday', 'scripts', `pr-${scriptName}.sh`);
  const packageScript = path.join(__dirname, '..', 'assets', 'scripts', `pr-${scriptName}.sh`);
  const scriptPath = fs.existsSync(projectScript) ? projectScript : packageScript;
  if (!fs.existsSync(scriptPath)) {
    fail(`${scriptName} script not found — skipping`);
    return;
  }
  step(`Running ${scriptName} report...`);
  const result = spawnSync('bash', [scriptPath, '--post', base], { stdio: 'inherit' });
  if (result.status !== 0) {
    fail(`${scriptName} report failed (exit ${result.status}) — skipping`);
  } else {
    ok(`${scriptName} report posted to PR`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`\n  ${c.cyan('Wednesday Skills')} — PR Create${dryRun ? c.yellow(' [dry run]') : ''}\n`);

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

  if (ticket) ok(`Ticket: ${c.cyan(ticket)}`);
  ok(`Base branch: ${c.cyan(base)}${isStacked ? c.yellow(' (stacked)') : ''}`);
  ok(`PR title: ${c.cyan(title)}`);
  info(`${commits.length} commit(s) on branch`);

  step('Generating description...');
  const hasApiKey = !!(process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY);
  let aiDescription = null;
  if (hasApiKey) {
    const diff = branchDiff();
    aiDescription = await generateDescription(commits, diff);
    if (aiDescription) ok('Description generated by AI');
    else info('AI description failed — using commit messages');
  } else {
    info('No API key — using commit messages for description');
  }

  const body = buildBody(commits, aiDescription, ticket, base, isStacked);

  // Show preview
  console.log(`\n${'─'.repeat(60)}`);
  console.log(c.cyan('  PR Preview'));
  console.log('─'.repeat(60));
  console.log(`  ${c.dim('Title:')}  ${title}`);
  console.log(`  ${c.dim('Base:')}   ${base}${isStacked ? c.yellow(' (stacked)') : ''}`);
  console.log(`  ${c.dim('Branch:')} ${branch}`);
  console.log(`\n${body.split('\n').map(l => `  ${l}`).join('\n')}`);
  console.log('─'.repeat(60));

  if (dryRun) {
    console.log(c.yellow('\n  Dry run — no push or PR created.\n'));
    return;
  }

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
  let prUrl = null;
  try {
    prUrl = run(`gh pr create --title '${title}' --base ${base} --body '${bodyEscaped}'`, { capture: true });
    ok(c.green(`PR created: ${prUrl}`));
    console.log('');
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('already exists')) {
      fail('A PR for this branch already exists.');
      const existing = tryRun(`gh pr view --json url -q .url`);
      if (existing) {
        info(`Existing PR: ${existing}`);
        prUrl = existing;
      }
    } else if (msg.includes('gh: command not found') || msg.includes('not found')) {
      fail('GitHub CLI not installed. Install with: brew install gh');
      process.exit(1);
    } else {
      fail('gh pr create failed:');
      console.log(c.red(msg));
      process.exit(1);
    }
  }

  // Auto-run PR scripts configured during ws-skills install
  const config = loadWednesdayConfig();
  const prScripts = config.pr_scripts || {};

  if (prScripts.coverage || prScripts.sonar) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(c.cyan('  PR Reports'));
    console.log('─'.repeat(60));
    info('Running scripts enabled during ws-skills install...');

    if (prScripts.coverage) runPRScript('coverage', base);
    if (prScripts.sonar)    runPRScript('sonar', base);

    console.log('─'.repeat(60));
    console.log('');
  }
}

main().catch(e => {
  console.error(c.red(`\nFatal: ${e.message}`));
  process.exit(1);
});
