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
  const result = spawnSync(process.execPath, ['bin/cli.js', 'install', TMP, '--all', '--skip-config'], {
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
    spawnSync(process.execPath, ['bin/cli.js', 'install', TMP, '--all', '--skip-config'], { cwd: ROOT });
  }

  const result = spawnSync(process.execPath, ['bin/cli.js', 'configure', TMP, 'all'], {
    cwd: ROOT, encoding: 'utf8',
  });

  assert('configure exits 0', result.status === 0, result.stderr);

  if (result.status !== 0) { summary(); }

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
    spawnSync(process.execPath, ['bin/cli.js', 'install', TMP, '--all', '--skip-config'], { cwd: ROOT });
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
      ['scripts/plan.js', planDir, '--brief', 'Build a simple todo app with user auth', '--skip-questions'],
      { cwd: ROOT, encoding: 'utf8', timeout: 180_000 }
    );

    const planMd = path.join(planDir, '.wednesday', 'plans', 'PLAN.md');
    assert('plan exits 0', result.status === 0, result.stderr?.slice(0, 200));
    assert('PLAN.md created', fs.existsSync(planMd));
    assert('BRIEF.md created', fs.existsSync(path.join(planDir, 'BRIEF.md')));

    if (fs.existsSync(planMd)) {
      const plan = fs.readFileSync(planMd, 'utf8');
      assert('PLAN.md has Overview section', plan.includes('## Overview'));
      assert('PLAN.md has Architecture section', plan.includes('## Architecture'));
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

// ─── 7. Phase 4 — Trimmed CLI ─────────────────────────────────────────────────

if (!filter || filter === 'phase4' || filter === 'cli') {
  section('phase4 — trimmed CLI');

  // IDE-redirected commands
  for (const cmd of ['blast', 'score', 'chat', 'gen-tests', 'plan-refactor', 'onboard']) {
    const r = spawnSync(process.execPath, ['bin/cli.js', cmd, 'dummy'], { cwd: ROOT, encoding: 'utf8' });
    assert(`${cmd} redirects to Claude`, r.stdout.includes('Claude Code') || r.stdout.includes('Ask Claude'));
  }

  // Registry commands present in help
  const help = spawnSync(process.execPath, ['bin/cli.js', 'help'], { cwd: ROOT, encoding: 'utf8' });
  assert('help exits 0', help.status === 0);
  for (const cmd of ['search', 'add', 'remove', 'update', 'check', 'build-skill', 'submit', 'stats']) {
    assert(`help lists ${cmd}`, help.stdout.includes(cmd));
  }

  // check command
  const check = spawnSync(process.execPath, ['bin/cli.js', 'check'], { cwd: ROOT, encoding: 'utf8' });
  assert('check exits 0', check.status === 0);
  assert('check shows installed skills', check.stdout.includes('Installed skills'));

  // search command
  const search = spawnSync(process.execPath, ['bin/cli.js', 'search', 'git'], { cwd: ROOT, encoding: 'utf8' });
  assert('search exits 0', search.status === 0);
  assert('search finds git-os', search.stdout.includes('git-os'));

  // stats command
  const stats = spawnSync(process.execPath, ['bin/cli.js', 'stats'], { cwd: ROOT, encoding: 'utf8' });
  assert('stats exits 0', stats.status === 0);
  assert('stats shows usage header', stats.stdout.includes('Skill usage'));

  // stats --stale
  const stale = spawnSync(process.execPath, ['bin/cli.js', 'stats', '--stale'], { cwd: ROOT, encoding: 'utf8' });
  assert('stats --stale exits 0', stale.status === 0);

  // stats --cost
  const cost = spawnSync(process.execPath, ['bin/cli.js', 'stats', '--cost'], { cwd: ROOT, encoding: 'utf8' });
  assert('stats --cost exits 0', cost.status === 0);
}

// ─── 8. Phase 4 — Model Cost Router ──────────────────────────────────────────

if (!filter || filter === 'phase4' || filter === 'router') {
  section('phase4 — model cost router');

  const { route, TIERS } = require(path.join(ROOT, 'lib', 'router'));

  assert('route() returns array for free tasks',    Array.isArray(route('classify')));
  assert('route() returns string for cheap tasks',  typeof route('summarize-long') === 'string');
  assert('route() returns string for capable tasks',typeof route('synthesise') === 'string');
  assert('classify uses free tier',     route('classify')[0] === TIERS.free[0]);
  assert('summarize-long uses cheap',   route('summarize-long') === TIERS.cheap);
  assert('synthesise uses capable',     route('synthesise') === TIERS.capable);
  assert('test-generate uses capable',  route('test-generate') === TIERS.capable);
  assert('generate-skill uses cheap',   route('generate-skill') === TIERS.cheap);
  assert('unknown task falls back to free', Array.isArray(route('unknown-xyz')));
  assert('free tier has 2 models',      TIERS.free.length === 2);
  assert('cheap tier is haiku',         TIERS.cheap.includes('haiku'));
  assert('capable tier is sonnet',      TIERS.capable.includes('sonnet'));
}

// ─── 9. Phase 4 — Composer ────────────────────────────────────────────────────

if (!filter || filter === 'phase4' || filter === 'composer') {
  section('phase4 — agentic composer');

  const { parseAgentYml, loadAgentDef, runWorkflow, runSequential, runParallel } = require(path.join(ROOT, 'lib', 'composer'));

  // parseAgentYml
  const yml = `name: test-agent\nstages:\n  - type: sequential\n    steps: [step-a, step-b]\n  - type: parallel\n    steps: [step-c, step-d]\n`;
  const def = parseAgentYml(yml);
  assert('parseAgentYml parses name',              def.name === 'test-agent');
  assert('parseAgentYml parses 2 stages',          def.stages.length === 2);
  assert('stage 1 is sequential',                  def.stages[0].type === 'sequential');
  assert('stage 1 has 2 steps',                    def.stages[0].steps.length === 2);
  assert('stage 2 is parallel',                    def.stages[1].type === 'parallel');

  // loadAgentDef for all 3 agents
  for (const name of ['pr-review-agent', 'module-audit', 'onboard-dev']) {
    const d = loadAgentDef(name, ROOT);
    assert(`loadAgentDef: ${name} has stages`,     d.stages.length > 0);
  }

  // runSequential — each step receives previous output
  let log = [];
  runSequential(['a', 'b', 'c'], { start: true }, async (step, ctx) => {
    log.push({ step, keys: Object.keys(ctx) });
    return { [step]: true };
  }).then(ctx => {
    assert('sequential: a receives start context',  log[0].keys.includes('start'));
    assert('sequential: b receives a output',       log[1].keys.includes('a'));
    assert('sequential: c receives a+b output',     log[2].keys.includes('a') && log[2].keys.includes('b'));
    assert('sequential: final context has all keys',Object.keys(ctx).includes('a') && Object.keys(ctx).includes('c'));
  });

  // runParallel — all steps receive same input
  let parallelLog = [];
  runParallel(['x', 'y'], { shared: true }, async (step, ctx) => {
    parallelLog.push({ step, keys: Object.keys(ctx) });
    return { [step]: true };
  }).then(ctx => {
    assert('parallel: both steps receive shared context', parallelLog.every(l => l.keys.includes('shared')));
    assert('parallel: both results merged',               Object.keys(ctx).includes('x') && Object.keys(ctx).includes('y'));
  });

  // runWorkflow end-to-end
  const agentDef = loadAgentDef('pr-review-agent', ROOT);
  const stepsRun = [];
  runWorkflow(agentDef, { pr: 99 }, async (step, ctx) => {
    stepsRun.push(step);
    return { [step + '_done']: true };
  }).then(() => {
    assert('workflow ran triage-read first',                 stepsRun[0] === 'triage-read');
    assert('workflow ran brownfield-fix + drift in parallel',stepsRun.includes('brownfield-fix') && stepsRun.includes('brownfield-drift'));
    assert('workflow ran triage-fix last',                   stepsRun[stepsRun.length - 1] === 'triage-fix');
  });
}

// ─── 10. Phase 4 — Skill Builder validation ───────────────────────────────────

if (!filter || filter === 'phase4' || filter === 'builder') {
  section('phase4 — skill builder');

  const { validate } = require(path.join(ROOT, 'lib', 'builder'));

  const validSkill = [
    '---',
    'name: test-skill',
    'description: Checks that things work correctly.',
    '---',
    '# Test Skill',
    '## When to use',
    '- When running tests',
    '- "Test this skill"',
    '## What to do',
    '1. Run the tests',
    '2. Check results',
    '## Never',
    '- Skip validation',
    '- Ignore failures',
  ].join('\n');

  const r1 = validate(validSkill);
  assert('valid skill passes',         r1.valid);
  assert('valid skill has 0 missing',  r1.missingSections.length === 0);

  const missingName = validSkill.replace('name: test-skill', '');
  const r2 = validate(missingName);
  assert('missing name: fails',        !r2.valid);
  assert('missing name: reported',     r2.missingSections.includes('name:'));

  const missingNever = validSkill.replace('## Never', '## Something Else');
  const r3 = validate(missingNever);
  assert('missing Never: fails',       !r3.valid);
  assert('missing Never: reported',    r3.missingSections.includes('## Never'));

  // Word count limit
  const bloated = validSkill + ('\nword '.repeat(500));
  const r4 = validate(bloated);
  assert('over 500 words fails',       !r4.valid);
  assert('word count correct',         r4.wordCount > 500);

  // Word count is accurate
  const r5 = validate(validSkill);
  assert('word count > 0',             r5.wordCount > 0);
}

// ─── 11. Phase 4 — Registry ───────────────────────────────────────────────────

if (!filter || filter === 'phase4' || filter === 'registry') {
  section('phase4 — skill registry');

  const registryFile = path.join(ROOT, 'registry', 'index.json');
  assert('registry/index.json exists', fs.existsSync(registryFile));

  if (fs.existsSync(registryFile)) {
    const reg = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    assert('registry has version field',   reg.version === '1.0');
    assert('registry has updatedAt field', !!reg.updatedAt);
    assert('registry has skills array',    Array.isArray(reg.skills));
    assert('registry has 10+ skills',      reg.skills.length >= 10);
    assert('pr-review-agent in registry',  reg.skills.some(s => s.name === 'pr-review-agent'));
    assert('all skills have name',         reg.skills.every(s => !!s.name));
    assert('all skills have description',  reg.skills.every(s => !!s.description));
    assert('all skills have version',      reg.skills.every(s => !!s.version));

    // Re-run the generator and verify output is deterministic
    const { execSync } = require('child_process');
    execSync('node scripts/generate-registry.js', { cwd: ROOT, stdio: 'pipe' });
    const reg2 = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    assert('registry count stable after re-run', reg2.count === reg.count);
  }

  // GitHub Action exists
  assert('registry.yml workflow exists', fs.existsSync(path.join(ROOT, '.github', 'workflows', 'registry.yml')));
  assert('community PR template exists', fs.existsSync(path.join(ROOT, '.github', 'PULL_REQUEST_TEMPLATE', 'skill_submission.md')));

  // PR template has required checklist items
  const tmpl = fs.readFileSync(path.join(ROOT, '.github', 'PULL_REQUEST_TEMPLATE', 'skill_submission.md'), 'utf8');
  assert('PR template: 500 words check',          tmpl.includes('500 words'));
  assert('PR template: required sections check',  tmpl.includes('required sections'));
  assert('PR template: no hardcoded models check',tmpl.includes('hardcoded model'));
}

// ─── 12. Phase 4 — Analytics ─────────────────────────────────────────────────

if (!filter || filter === 'phase4' || filter === 'analytics') {
  section('phase4 — analytics');

  const { record, stats, loadUsage, saveUsage } = require(path.join(ROOT, 'lib', 'analytics'));
  const TMP_ANALYTICS = path.join(require('os').tmpdir(), 'ws-analytics-' + Date.now());
  fs.mkdirSync(path.join(TMP_ANALYTICS, '.wednesday', 'skills', 'git-os'), { recursive: true });
  fs.mkdirSync(path.join(TMP_ANALYTICS, '.wednesday', 'skills', 'brownfield-query'), { recursive: true });

  // record()
  record(TMP_ANALYTICS, 'git-os',          { model: 'free',  cost: 0 });
  record(TMP_ANALYTICS, 'git-os',          { model: 'free',  cost: 0 });
  record(TMP_ANALYTICS, 'brownfield-query',{ model: 'cheap', cost: 0.001 });

  const usage = loadUsage(TMP_ANALYTICS);
  assert('record: usage.json created',       fs.existsSync(path.join(TMP_ANALYTICS, '.wednesday', 'cache', 'usage.json')));
  assert('record: 3 calls logged',           usage.calls.length === 3);
  assert('record: git-os appears twice',     usage.calls.filter(c => c.skill === 'git-os').length === 2);
  assert('record: cost stored correctly',    usage.calls[2].cost === 0.001);
  assert('record: model stored correctly',   usage.calls[0].model === 'free');
  assert('record: timestamp stored',         !!usage.calls[0].ts);

  // stats() — capture stdout
  let out = '';
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { out += s; return true; };

  stats(TMP_ANALYTICS, {});
  assert('stats: shows call count',  out.includes('3 calls'));
  assert('stats: shows top skill',   out.includes('git-os'));
  assert('stats: shows cost',        out.includes('$0.00'));

  out = '';
  stats(TMP_ANALYTICS, { cost: true });
  assert('stats --cost: shows model breakdown', out.includes('free') && out.includes('cheap'));

  out = '';
  stats(TMP_ANALYTICS, { stale: true });
  // brownfield-query was just recorded so it should NOT be stale
  assert('stats --stale: recently used skill not flagged', !out.includes('brownfield-query — not triggered'));

  out = '';
  stats(TMP_ANALYTICS, { skill: 'git-os' });
  assert('stats --skill: shows total calls', out.includes('2'));
  assert('stats --skill: shows last used',   out.includes('Last used'));

  process.stdout.write = origWrite;

  // saveUsage / loadUsage round-trip
  const data = { version: '1.0', calls: [{ skill: 'test', model: 'free', cost: 0, ts: new Date().toISOString() }] };
  saveUsage(TMP_ANALYTICS, data);
  const loaded = loadUsage(TMP_ANALYTICS);
  assert('saveUsage/loadUsage round-trip',    loaded.calls[0].skill === 'test');
  assert('saveUsage adds updatedAt',          !!loaded.updatedAt);
}

// ─── Done ─────────────────────────────────────────────────────────────────────

summary();
