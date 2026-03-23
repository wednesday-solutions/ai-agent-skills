'use strict';

/**
 * Skill Usage Analytics
 *
 * Local only — no data sent externally.
 * Stored in .wednesday/cache/usage.json within the project.
 *
 * usage.json schema:
 * {
 *   "version": "1.0",
 *   "updatedAt": "<ISO>",
 *   "calls": [
 *     { "skill": "git-os-lite", "model": "free", "tokens": 0, "cost": 0, "ts": "<ISO>" }
 *   ]
 * }
 */

const fs   = require('fs');
const path = require('path');

const STALE_DAYS = 30;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUsagePath(targetDir) {
  return path.join(targetDir, '.wednesday', 'cache', 'usage.json');
}

function loadUsage(targetDir) {
  const usagePath = getUsagePath(targetDir);
  if (!fs.existsSync(usagePath)) return { version: '1.0', calls: [] };
  try { return JSON.parse(fs.readFileSync(usagePath, 'utf8')); } catch (_) { return { version: '1.0', calls: [] }; }
}

function saveUsage(targetDir, data) {
  const usagePath = getUsagePath(targetDir);
  fs.mkdirSync(path.dirname(usagePath), { recursive: true });
  fs.writeFileSync(usagePath, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2));
}

// ─── Record a skill call ──────────────────────────────────────────────────────

function record(targetDir, skillName, opts = {}) {
  const data = loadUsage(targetDir);
  data.calls = data.calls || [];
  data.calls.push({
    skill:  skillName,
    model:  opts.model  || 'unknown',
    tokens: opts.tokens || 0,
    cost:   opts.cost   || 0,
    ts:     new Date().toISOString(),
  });
  saveUsage(targetDir, data);
}

// ─── Stats display ────────────────────────────────────────────────────────────

function stats(targetDir, opts = {}) {
  const data = loadUsage(targetDir);
  const calls = data.calls || [];

  // Filter to current month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMon = calls.filter(c => new Date(c.ts) >= monthStart);

  if (!opts.cost && !opts.stale && !opts.skill) {
    // Default: summary
    const total = thisMon.length;
    const bySkill = {};
    for (const c of thisMon) bySkill[c.skill] = (bySkill[c.skill] || 0) + 1;
    const top = Object.entries(bySkill).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const totalCost = thisMon.reduce((s, c) => s + (c.cost || 0), 0);
    const freeCalls = thisMon.filter(c => c.model === 'free' || !c.model || c.model === 'unknown').length;
    const freePct   = total ? Math.round(freeCalls / total * 100) : 0;

    console.log('');
    console.log(`\x1b[36mSkill usage this month:\x1b[0m ${total} calls`);
    if (top.length) {
      console.log(`Top: ${top.map(([k, v]) => `${k} (${v})`).join(', ')}`);
    }
    console.log(`LLM cost: $${totalCost.toFixed(2)} (${freePct}% free tier)`);
    console.log('');
  }

  if (opts.cost) {
    const byModel = {};
    for (const c of thisMon) {
      const m = c.model || 'unknown';
      if (!byModel[m]) byModel[m] = { calls: 0, cost: 0 };
      byModel[m].calls += 1;
      byModel[m].cost  += c.cost || 0;
    }
    console.log('');
    console.log('\x1b[36mModel breakdown (this month):\x1b[0m');
    for (const [model, info] of Object.entries(byModel)) {
      console.log(`  ${model.padEnd(40)} ${String(info.calls).padStart(4)} calls   $${info.cost.toFixed(2)}`);
    }
    console.log('');
  }

  if (opts.stale) {
    // Find installed skills not triggered in STALE_DAYS days
    const skillsDir = path.join(targetDir, '.wednesday', 'skills');
    if (!fs.existsSync(skillsDir)) { console.log('No skills installed.'); return; }
    const installed = fs.readdirSync(skillsDir);
    const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
    const recentSkills = new Set(calls.filter(c => new Date(c.ts) >= cutoff).map(c => c.skill));
    const staleSkills = installed.filter(s => !recentSkills.has(s));

    console.log('');
    if (staleSkills.length) {
      console.log(`\x1b[33mStale skills (not triggered in ${STALE_DAYS} days):\x1b[0m`);
      staleSkills.forEach(s => console.log(`  ${s} — not triggered in ${STALE_DAYS}+ days`));
      console.log('Consider: remove with wednesday-skills remove <skill> or update the description.');
    } else {
      console.log(`\x1b[32mAll installed skills triggered in the last ${STALE_DAYS} days.\x1b[0m`);
    }
    console.log('');
  }

  if (opts.skill) {
    const skillCalls = calls.filter(c => c.skill === opts.skill);
    const thisMonth  = skillCalls.filter(c => new Date(c.ts) >= monthStart);
    const totalCost  = skillCalls.reduce((s, c) => s + (c.cost || 0), 0);
    const last = skillCalls.at(-1);
    console.log('');
    console.log(`\x1b[36m${opts.skill}\x1b[0m`);
    console.log(`  Total calls:   ${skillCalls.length}`);
    console.log(`  This month:    ${thisMonth.length}`);
    console.log(`  Total cost:    $${totalCost.toFixed(4)}`);
    console.log(`  Last used:     ${last ? new Date(last.ts).toLocaleDateString() : 'never'}`);
    console.log('');
  }
}

module.exports = { record, stats, loadUsage, saveUsage };
