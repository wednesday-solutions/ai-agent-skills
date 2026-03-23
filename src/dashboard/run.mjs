#!/usr/bin/env node
/**
 * Dashboard entry point — ESM, spawned by bin/cli.js
 * Uses React.createElement (no JSX, no build step needed)
 */

import { render, Box, Text, useInput, useApp } from 'ink';
import React, { useState, useEffect } from 'react';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { createElement: h } = React;

const REFRESH_MS = 30_000;
const projectDir = process.argv[2] || process.cwd();
const prFilter = process.argv[3] || null;

// ─── Cache helpers ───────────────────────────────────────────────────────────

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function loadTriageCache() {
  return loadJSON(path.join(projectDir, '.wednesday', 'cache', 'triage.json'), {});
}

function loadUsageData() {
  return loadJSON(path.join(projectDir, '.wednesday', 'cache', 'usage.json'), { runs: [] });
}

function loadInstalledSkills() {
  const skillsDir = path.join(projectDir, '.wednesday', 'skills');
  if (!fs.existsSync(skillsDir)) return [];
  return fs.readdirSync(skillsDir)
    .filter(e => fs.existsSync(path.join(skillsDir, e, 'SKILL.md')))
    .map(e => {
      const content = fs.readFileSync(path.join(skillsDir, e, 'SKILL.md'), 'utf8');
      const m = content.match(/version:\s*["']?(\S+?)["']?$/m);
      return { name: e, version: m ? `v${m[1]}` : 'v1.0' };
    });
}

// ─── GitHub API ──────────────────────────────────────────────────────────────

function githubGet(apiPath) {
  return new Promise((resolve, reject) => {
    const token = process.env.GITHUB_TOKEN;
    const req = https.request({
      hostname: 'api.github.com',
      path: apiPath,
      method: 'GET',
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'wednesday-skills-dashboard',
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve([]); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchPRs() {
  if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN not set');
  let remote;
  try { remote = execSync('git remote get-url origin 2>/dev/null', { encoding: 'utf8', cwd: projectDir }).trim(); }
  catch { throw new Error('No git remote'); }
  const m = remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (!m) throw new Error('Not a GitHub repo');
  const prs = await githubGet(`/repos/${m[1]}/pulls?state=open&per_page=20`);
  if (!Array.isArray(prs)) throw new Error(prs.message || 'GitHub API error');
  const filtered = prFilter ? prs.filter(p => p.number === Number(prFilter)) : prs;
  return filtered.map(p => ({ number: p.number, title: p.title }));
}

// ─── Panel components ────────────────────────────────────────────────────────

function Panel({ title, children }) {
  return h(Box, { flexDirection: 'column', borderStyle: 'single', borderColor: 'blue', padding: 1, flexGrow: 1, minHeight: 8 },
    h(Text, { bold: true, color: 'blue' }, ` ${title}`),
    h(Box, { marginTop: 1, flexDirection: 'column' }, children)
  );
}

function PRPanel({ tick }) {
  const [prs, setPRs] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    fetchPRs()
      .then(data => { setPRs(data); setErr(null); })
      .catch(e => setErr(e.message));
  }, [tick]);

  const rows = err
    ? [h(Text, { key: 'e', color: 'yellow' }, `⚠ ${err}`)]
    : prs === null
      ? [h(Text, { key: 'l', dimColor: true }, 'Loading...')]
      : prs.length === 0
        ? [h(Text, { key: 'n', dimColor: true }, 'No open PRs')]
        : prs.map(pr =>
            h(Box, { key: pr.number, justifyContent: 'space-between' },
              h(Text, null,
                h(Text, { color: 'cyan' }, `#${pr.number}`),
                ' ',
                pr.title.length > 34 ? pr.title.slice(0, 34) + '…' : pr.title
              )
            )
          );

  return h(Panel, { title: 'Active PRs' }, ...rows);
}

function TriagePanel({ tick }) {
  const queue = loadTriageCache();
  const entries = Object.entries(queue)
    .filter(([n]) => !prFilter || String(prFilter) === n);

  const rows = entries.length === 0
    ? [h(Text, { key: 'n', dimColor: true }, 'No triage data')]
    : entries.map(([num, c]) =>
        h(Box, { key: num, justifyContent: 'space-between' },
          h(Text, { color: 'cyan' }, `#${num}`),
          h(Text, null,
            c.style > 0 && h(Text, { color: 'green' }, ` style(${c.style})`),
            c.logic > 0 && h(Text, { color: 'yellow' }, ` logic(${c.logic})`),
            c.security > 0 && h(Text, { color: 'red' }, ` security(${c.security})`),
            !c.style && !c.logic && !c.security && h(Text, { dimColor: true }, ' clear')
          )
        )
      );

  return h(Panel, { title: 'Triage Queue' }, ...rows);
}

function SkillsPanel({ tick }) {
  const skills = loadInstalledSkills();
  const rows = skills.length === 0
    ? [h(Text, { key: 'n', dimColor: true }, 'No skills installed')]
    : skills.map(s =>
        h(Box, { key: s.name, justifyContent: 'space-between' },
          h(Text, null, s.name.padEnd(22)),
          h(Text, { dimColor: true }, s.version.padEnd(6)),
          h(Text, { color: 'green' }, 'active')
        )
      );

  return h(Panel, { title: 'Skills Installed' }, ...rows);
}

function CostPanel({ tick }) {
  if (!process.env.OPENROUTER_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return h(Panel, { title: 'Usage' },
      h(Text, { dimColor: true }, 'No API key configured')
    );
  }

  const usage = loadUsageData();
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000);

  const todayRuns = (usage.runs || []).filter(r => r.timestamp?.startsWith(today));
  const weekRuns = (usage.runs || []).filter(r => new Date(r.timestamp) >= weekAgo);

  const sum = (runs, field) => runs.reduce((s, r) => s + (r[field] || 0), 0);
  const calls = runs => runs.reduce((s, r) => s + (r.models?.haiku || 0) + (r.models?.sonnet || 0), 0);

  return h(Panel, { title: 'Usage' },
    h(Box, { justifyContent: 'space-between' },
      h(Text, null, 'Today    '),
      h(Text, { color: 'cyan' }, `$${sum(todayRuns, 'estimatedCost').toFixed(2)}`),
      h(Text, { dimColor: true }, `  ${calls(todayRuns)} calls`)
    ),
    h(Box, { justifyContent: 'space-between' },
      h(Text, null, 'This week'),
      h(Text, { color: 'cyan' }, `$${sum(weekRuns, 'estimatedCost').toFixed(2)}`),
      h(Text, { dimColor: true }, `  ${calls(weekRuns)} calls`)
    ),
    h(Box, { marginTop: 1 },
      h(Text, { dimColor: true }, process.env.OPENROUTER_API_KEY ? 'OpenRouter' : 'Anthropic')
    )
  );
}

// ─── Root App ────────────────────────────────────────────────────────────────

function App() {
  const { exit } = useApp();
  const [tick, setTick] = useState(0);
  const [refreshed, setRefreshed] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => {
      setTick(t => t + 1);
      setRefreshed(new Date());
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  useInput(input => {
    if (input === 'q' || input === 'Q') exit();
    if (input === 'r' || input === 'R') { setTick(t => t + 1); setRefreshed(new Date()); }
  });

  return h(Box, { flexDirection: 'column', padding: 1 },
    h(Box, { marginBottom: 1, justifyContent: 'space-between' },
      h(Text, { bold: true, color: 'blue' }, 'Wednesday Skills Dashboard'),
      h(Text, { dimColor: true }, `Last refresh: ${refreshed.toLocaleTimeString()}  [r] refresh  [q] quit`)
    ),
    h(Box, { flexDirection: 'row', gap: 2, marginBottom: 1 },
      h(PRPanel, { tick }),
      h(TriagePanel, { tick })
    ),
    h(Box, { flexDirection: 'row', gap: 2 },
      h(SkillsPanel, { tick }),
      h(CostPanel, { tick })
    )
  );
}

render(h(App, null));
