/**
 * Wednesday Agent Skills — Manual Test Suite
 *
 * Run:  node test/index.test.js
 * Run a single section:  node test/index.test.js triage
 *                        node test/index.test.js plan
 *                        node test/index.test.js adapters
 *                        node test/index.test.js install
 *
 * Requires OPENROUTER_API_KEY in .env for the "plan" and "triage" sections.
 */

require('dotenv').config(); // npm install dotenv  OR  load .env manually before running

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

// ─── Tiny test runner ────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n── ${name} ${'─'.repeat(50 - name.length)}`);
}

function summary() {
  console.log(`\n${'─'.repeat(52)}`);
  console.log(`  ${passed} passed  ${failed > 0 ? failed + ' failed' : ''}`);
  process.exit(failed > 0 ? 1 : 0);
}

const filter = process.argv[2] || null;
const ROOT = path.join(__dirname, '..');
const TMP = path.join(require('os').tmpdir(), 'ws-test-' + Date.now());

// ─── 1. Install ───────────────────────────────────────────────────────────────

if (!filter || filter === 'install') {
  section('install');

  // Run install into a temp dir
  const result = spawnSync(process.execPath, ['bin/cli.js', 'install', TMP, '--skip-config'], {
    cwd: ROOT, encoding: 'utf8',
  });

  assert('install exits 0', result.status === 0, result.stderr);
  assert('skills dir created', fs.existsSync(path.join(TMP, '.wednesday', 'skills')));
  assert('git-os skill installed', fs.existsSync(path.join(TMP, '.wednesday', 'skills', 'git-os', 'SKILL.md')));
  assert('pr-review skill installed', fs.existsSync(path.join(TMP, '.wednesday', 'skills', 'pr-review', 'SKILL.md')));
  assert('greenfield skill installed', fs.existsSync(path.join(TMP, '.wednesday', 'skills', 'greenfield', 'SKILL.md')));
  assert('sprint skill installed', fs.existsSync(path.join(TMP, '.wednesday', 'skills', 'sprint', 'SKILL.md')));
  assert('deploy-checklist skill installed', fs.existsSync(path.join(TMP, '.wednesday', 'skills', 'deploy-checklist', 'SKILL.md')));
  assert('commitlint config copied', fs.existsSync(path.join(TMP, '.commitlintrc.json')));
  assert('commit-lint workflow copied', fs.existsSync(path.join(TMP, '.github', 'workflows', 'commit-lint.yml')));
  assert('triage workflow copied', fs.existsSync(path.join(TMP, '.github', 'workflows', 'triage.yml')));
  assert('tools.json created', fs.existsSync(path.join(TMP, '.wednesday', 'tools.json')));
}

// ─── 2. Configure ─────────────────────────────────────────────────────────────

if (!filter || filter === 'configure') {
  section('configure');

  // Configure all agents for the temp dir (run install first if needed)
  if (!fs.existsSync(path.join(TMP, '.wednesday', 'skills'))) {
    spawnSync(process.execPath, ['bin/cli.js', 'install', TMP, '--skip-config'], { cwd: ROOT });
  }

  const result = spawnSync(process.execPath, ['bin/cli.js', 'configure', TMP, 'all'], {
    cwd: ROOT, encoding: 'utf8',
  });

  assert('configure exits 0', result.status === 0, result.stderr);

  const claude = fs.readFileSync(path.join(TMP, 'CLAUDE.md'), 'utf8');
  assert('CLAUDE.md contains available_skills block', claude.includes('<available_skills>'));
  assert('CLAUDE.md contains git-os', claude.includes('git-os'));

  const gemini = fs.readFileSync(path.join(TMP, 'GEMINI.md'), 'utf8');
  assert('GEMINI.md created', fs.existsSync(path.join(TMP, 'GEMINI.md')));
  assert('GEMINI.md contains available_skills block', gemini.includes('<available_skills>'));

  assert('.cursorrules created', fs.existsSync(path.join(TMP, '.cursorrules')));
  assert('copilot-instructions.md created', fs.existsSync(path.join(TMP, '.github', 'copilot-instructions.md')));
}

// ─── 3. Adapters (sync) ───────────────────────────────────────────────────────

if (!filter || filter === 'adapters') {
  section('adapters');

  if (!fs.existsSync(path.join(TMP, '.wednesday', 'skills'))) {
    spawnSync(process.execPath, ['bin/cli.js', 'install', TMP, '--skip-config'], { cwd: ROOT });
  }

  const result = spawnSync(process.execPath, ['bin/cli.js', 'sync', TMP, '--tool', 'claude-code'], {
    cwd: ROOT, encoding: 'utf8',
  });
  assert('sync --tool claude-code exits 0', result.status === 0, result.stderr);

  const badTool = spawnSync(process.execPath, ['bin/cli.js', 'sync', TMP, '--tool', 'nonexistent'], {
    cwd: ROOT, encoding: 'utf8',
  });
  assert('sync with unknown tool shows error', badTool.stdout.includes('Unknown tool') || badTool.stderr.includes('Unknown tool'));

  // Verify tools.json shape
  const toolsJson = JSON.parse(fs.readFileSync(path.join(TMP, '.wednesday', 'tools.json'), 'utf8'));
  assert('tools.json has tools array', Array.isArray(toolsJson.tools));
  assert('tools.json includes claude-code', toolsJson.tools.some(t => t.name === 'claude-code'));
  assert('tools.json includes antigravity', toolsJson.tools.some(t => t.name === 'antigravity'));
  assert('tools.json includes gemini-cli', toolsJson.tools.some(t => t.name === 'gemini-cli'));
}

// ─── 4. Triage (dry-run, no API key needed) ───────────────────────────────────

if (!filter || filter === 'triage') {
  section('triage (dry-run)');

  const result = spawnSync(process.execPath, ['scripts/triage.js', '--test'], {
    cwd: ROOT, encoding: 'utf8',
  });

  assert('triage --test exits 0', result.status === 0, result.stderr);
  assert('report table generated', result.stdout.includes('| # | Category | Score |'));
  assert('comments sorted ascending', (() => {
    const scores = [...result.stdout.matchAll(/\|\s*\d+\s*\|\s*\w+\s*\|\s*(\d+)\s*\|/g)]
      .map(m => parseInt(m[1]));
    return scores.every((s, i) => i === 0 || s >= scores[i - 1]);
  })(), 'scores not in ascending order');
  assert('@agent fix #1 #3 parsed correctly', result.stdout.includes('[ 1, 3 ]'));
  assert('@agent fix all parsed correctly', result.stdout.includes("'all'") || result.stdout.includes('"all"') || result.stdout.includes('all'));
  assert('random comment returns null', result.stdout.includes('null'));
}

// ─── 5. Plan (requires OPENROUTER_API_KEY) ────────────────────────────────────

if (!filter || filter === 'plan') {
  section('plan (requires OPENROUTER_API_KEY)');

  if (!process.env.OPENROUTER_API_KEY) {
    console.log('  ⚠ OPENROUTER_API_KEY not set — skipping live API tests');
    console.log('  Set it in .env and re-run: node test/index.test.js plan');
  } else {
    const planDir = path.join(require('os').tmpdir(), 'ws-plan-test-' + Date.now());
    const result = spawnSync(
      process.execPath,
      ['scripts/plan.js', planDir, '--brief', 'Build a simple todo app with user auth'],
      { cwd: ROOT, encoding: 'utf8', timeout: 120_000 }
    );

    assert('plan exits 0', result.status === 0, result.stderr?.slice(0, 200));
    assert('PLAN.md created', fs.existsSync(path.join(planDir, 'PLAN.md')));
    assert('CODEBASE.md created', fs.existsSync(path.join(planDir, 'CODEBASE.md')));
    assert('BRIEF.md created', fs.existsSync(path.join(planDir, 'BRIEF.md')));

    if (fs.existsSync(path.join(planDir, 'PLAN.md'))) {
      const plan = fs.readFileSync(path.join(planDir, 'PLAN.md'), 'utf8');
      assert('PLAN.md has Overview section', plan.includes('## Overview'));
      assert('PLAN.md has Architecture section', plan.includes('## Architecture'));
      assert('PLAN.md has Requirements section', plan.includes('## Requirements'));
      assert('PLAN.md has Tensions section', plan.includes('## Tensions'));
      assert('PLAN.md has Branch Naming section', plan.includes('## Branch Naming'));
    }

    const usageFile = path.join(planDir, '.wednesday', 'cache', 'usage.json');
    assert('usage.json written', fs.existsSync(usageFile));
    if (fs.existsSync(usageFile)) {
      const usage = JSON.parse(fs.readFileSync(usageFile, 'utf8'));
      assert('usage.json has runs array', Array.isArray(usage.runs));
      assert('usage logged a run', usage.runs.length > 0);
    }
  }
}

// ─── Done ─────────────────────────────────────────────────────────────────────

summary();
