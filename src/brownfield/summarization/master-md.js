/**
 * 2C-2 — MASTER.md generator
 * Comprehensive per-file documentation. Every file gets full detail.
 * Writes .wednesday/codebase/MASTER.md
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { callLLM } = require('../core/llm-client');
const { detectFeatureModules } = require('../analysis/feature-modules');
const { scoreAll } = require('../analysis/safety-scorer');
const { findDeadCode } = require('../analysis/dead-code');
const { blastRadius } = require('../analysis/blast-radius');

// ── Shared grouping helper ─────────────────────────────────────────────────
function groupByDir(allNodes) {
  const byDir = {};
  for (const [file, node] of allNodes) {
    const dir = path.dirname(file) === '.' ? '(root)' : path.dirname(file);
    byDir[dir] = byDir[dir] || [];
    byDir[dir].push([file, node]);
  }
  return byDir;
}

// ── Package manifest readers ──────────────────────────────────────────────────
function readPackageJson(rootDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  } catch { return null; }
}

// ── Feature domain inference from file names ──────────────────────────────────
const DOMAIN_PATTERNS = [
  { domain: 'Authentication',     patterns: /auth|login|logout|signin|signup|register|password|token|otp|biometric/i },
  { domain: 'User / Profile',     patterns: /user|profile|account|avatar|settings|preference/i },
  { domain: 'Home / Dashboard',   patterns: /home|dashboard|feed|landing|main|root/i },
  { domain: 'Payments / Billing', patterns: /payment|billing|checkout|cart|order|invoice|subscription|stripe|razorpay|purchase/i },
  { domain: 'Notifications',      patterns: /notif|alert|push|apns|fcm|badge/i },
  { domain: 'Onboarding',         patterns: /onboard|walkthrough|splash|intro|tutorial/i },
  { domain: 'Search',             patterns: /search|filter|sort|discover/i },
  { domain: 'Messaging / Chat',   patterns: /chat|message|inbox|conversation|thread/i },
  { domain: 'Media',              patterns: /camera|photo|video|image|gallery|media|upload/i },
  { domain: 'Map / Location',     patterns: /map|location|geo|coordinates|nearby/i },
  { domain: 'Analytics',          patterns: /analytics|tracking|event|segment|mixpanel|amplitude/i },
  { domain: 'API / Networking',   patterns: /api|network|http|request|response|endpoint|graphql/i },
  { domain: 'Storage / Database', patterns: /storage|database|db|cache|persist|realm|coredata|sqlite/i },
  { domain: 'Admin',              patterns: /admin|cms|backoffice|manage/i },
];

function inferFeatures(allNodes) {
  const domains = {};
  for (const [file] of allNodes) {
    const base = path.basename(file, path.extname(file)).toLowerCase();
    for (const { domain, patterns } of DOMAIN_PATTERNS) {
      if (patterns.test(base) || patterns.test(file)) {
        domains[domain] = domains[domain] || [];
        if (!domains[domain].includes(base)) domains[domain].push(base);
      }
    }
  }
  return domains;
}

// ── Tech stack builder ────────────────────────────────────────────────────────
function buildTechStack(allNodes, pkgJson, stats, frameworks) {
  const stack = { languages: [], frameworks: [], libraries: [], platform: null };

  // Languages
  const langs = Object.entries(stats.byLang || {}).sort((a, b) => b[1] - a[1]);
  for (const [l] of langs) stack.languages.push(l.charAt(0).toUpperCase() + l.slice(1));

  // Platform
  if (frameworks.has('SwiftUI') || frameworks.has('UIKit')) {
    stack.platform = 'iOS';
  } else if (stats.byLang?.kotlin) {
    stack.platform = 'Android';
  } else if (frameworks.has('React Native')) {
    stack.platform = 'React Native (iOS + Android)';
  } else if (frameworks.has('Next.js')) {
    stack.platform = 'Web (Next.js)';
  } else if (frameworks.has('React')) {
    stack.platform = 'Web (React)';
  } else if (stats.byLang?.go) {
    stack.platform = 'Backend (Go)';
  } else if (frameworks.has('NestJS')) {
    stack.platform = 'Backend (NestJS)';
  }

  // Frameworks from meta
  for (const f of frameworks) stack.frameworks.push(f);

  // Key libraries from package.json dependencies
  if (pkgJson) {
    const KEY_LIBS = [
      'react', 'react-native', 'next', 'express', 'fastify', 'koa', 'nestjs',
      'graphql', 'apollo', 'prisma', 'typeorm', 'sequelize', 'mongoose',
      'redux', 'zustand', 'mobx', 'recoil', 'jotai',
      'axios', 'swr', 'react-query', '@tanstack/query',
      'jest', 'vitest', 'mocha', 'cypress', 'playwright',
      'tailwindcss', 'styled-components', '@emotion',
      'stripe', 'twilio', 'sendgrid', 'firebase', 'supabase',
      'aws-sdk', '@aws-sdk', 'socket.io', 'ws',
    ];
    const allDeps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
    for (const lib of KEY_LIBS) {
      if (Object.keys(allDeps).some(d => d === lib || d.startsWith(`${lib}/`) || d.startsWith(`@${lib}`))) {
        const display = lib.startsWith('@') ? lib : lib.replace(/^@[^/]+\//, '');
        if (!stack.libraries.includes(display)) stack.libraries.push(display);
      }
    }
  }

  return stack;
}

function buildTestCoverageMap(nodes) {
  const coverageMap = {};
  const TEST_RE = /\.test\.[jt]sx?$|\.spec\.[jt]sx?$|__tests__/;
  for (const file of Object.keys(nodes)) {
    if (!TEST_RE.test(file)) coverageMap[file] = 0;
  }
  for (const [file, node] of Object.entries(nodes)) {
    if (!TEST_RE.test(file)) continue;
    for (const imp of node.imports) {
      if (Object.prototype.hasOwnProperty.call(coverageMap, imp)) coverageMap[imp] = 100;
    }
  }
  return coverageMap;
}

function isHighValue(node) {
  return node.isEntryPoint || node.importedBy.length > 10 || node.riskScore > 70;
}

/**
 * Generate full MASTER.md — every file documented in detail
 */
async function generateMasterMd(graph, summaries, legacyReport, codebaseDir, apiKey, commentIntel = null, gapsFilled = 0, elapsed = 0, insights = {}, store = null) {
  const nodes = graph.nodes;
  const allNodes = Object.entries(nodes).filter(([, n]) => !n.error);

  // Pre-compute derived data used by multiple sections
  const scoreMap = scoreAll(nodes, buildTestCoverageMap(nodes), commentIntel);
  const { deadFiles, riskByFile } = findDeadCode(nodes, commentIntel);
  const deadClassification = insights.deadClassification || {};
  const cycleBreakPoints   = insights.cycleBreakPoints   || {};
  const totalGaps = allNodes.reduce((s, [, n]) => s + n.gaps.length, 0);
  const gapsByType = allNodes.flatMap(([, n]) => n.gaps).reduce((acc, g) => {
    acc[g.type] = (acc[g.type] || 0) + 1;
    return acc;
  }, {});

  // Build comment intel lookup by dir
  const commentByDir = new Map();
  if (commentIntel && commentIntel.modules) {
    for (const mod of commentIntel.modules) commentByDir.set(mod.dir, mod);
  }

  const lines = [];

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push(`# Codebase Intelligence — MASTER.md`);
  lines.push(`> Generated: ${new Date().toISOString()}`);
  lines.push(`> Project root: ${graph.rootDir}`);
  lines.push(`> Files: ${graph.stats.totalFiles} | Edges: ${graph.stats.totalEdges} | High-risk: ${graph.stats.highRiskFiles} | Dead: ${deadFiles.length} | Gaps filled: ${gapsFilled}${elapsed ? ` | Time: ${elapsed}ms` : ''}`);
  lines.push('');

  // ── Codebase health (AI narrative) ────────────────────────────────────────
  if (insights.healthNarrative) {
    lines.push('## Codebase health');
    lines.push('');
    lines.push(`> ${insights.healthNarrative}`);
    lines.push('');
  }

  // ── Quick stats ────────────────────────────────────────────────────────────
  lines.push('## Quick stats');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Files mapped | ${allNodes.length} |`);
  lines.push(`| Total edges | ${graph.stats.totalEdges} |`);
  lines.push(`| Summaries | ${Object.keys(summaries).length} |`);
  lines.push(`| High-risk files (>60) | ${graph.stats.highRiskFiles} |`);
  lines.push(`| Dead files | ${deadFiles.length} |`);
  lines.push(`| Circular dependencies | ${legacyReport?.circularDeps?.length || 0} |`);
  lines.push(`| God files | ${legacyReport?.godFiles?.length || 0} |`);
  lines.push(`| Coverage gaps | ${totalGaps} |`);
  lines.push(`| Gaps filled (subagents) | ${gapsFilled} |`);
  lines.push(`| Danger zones | ${legacyReport?.dangerZones?.length || 0} |`);
  lines.push('');

  // ── Table of contents ─────────────────────────────────────────────────────
  lines.push('## Table of contents');
  lines.push('');
  lines.push('1. [Primary application flows](#primary-application-flows)');
  lines.push('2. [Architecture overview](#architecture-overview)');
  lines.push('3. [Entry points](#entry-points)');
  lines.push('4. [Danger zones](#danger-zones)');
  lines.push('5. [High-risk files](#high-risk-files)');
  lines.push('6. [Dead code candidates](#dead-code-candidates)');
  lines.push('7. [Coverage gaps](#coverage-gaps)');
  lines.push('8. [Module map](#module-map)');
  lines.push('9. [Tech stack](#tech-stack)');
  lines.push('10. [Feature inventory](#feature-inventory)');
  if (commentIntel?.modules?.some(m => m.purpose || m.techDebt)) {
    lines.push('11. [Comment intelligence](#comment-intelligence)');
  }
  lines.push('12. [Legacy health report](#legacy-health-report)');
  lines.push('13. [Output files](#output-files)');
  lines.push('');

  // ── Primary application flows ──────────────────────────────────────────────
  lines.push('## Primary application flows');
  lines.push('');
  lines.push('> Traced functional paths from entry points to core logic. Read these to understand the execution lifecycle.');
  lines.push('');

  const { discoverPrimaryFlows } = require('../analysis/flow-discovery');
  const flows = store ? discoverPrimaryFlows(store, 5, 4) : [];

  if (flows.length > 0) {
    for (const flow of flows) {
      lines.push(`### 🏁 ${flow.entry}`);
      lines.push(`${flow.description}`);
      lines.push('');
      const steps = flow.path.split(' -> ');
      lines.push(`\`\`\`mermaid
graph LR
  ${steps.map((step, i) => `step${i}["${path.basename(step)}"]`).join(' --> ')}
\`\`\``);
      lines.push('');
    }
  } else {
    lines.push('*No complex functional flows detected. This may be a simple utility or standalone script.*');
    lines.push('');
  }

  // ── Architecture overview ─────────────────────────────────────────────────
  lines.push('## Architecture overview');
  lines.push('');

  // Reverse PRD from comment intelligence — what the project actually does, in dev's own words
  if (commentIntel?.reversePrd) {
    lines.push('### What this project does');
    lines.push('');
    lines.push('> *Derived from developer comments across the codebase — not inferred from code structure.*');
    lines.push('');
    lines.push(commentIntel.reversePrd);
    lines.push('');
  }

  const highValue = Object.values(nodes).filter(isHighValue);
  if (apiKey && highValue.length > 0) {
    const arch = await callHaikuArchitecture(highValue, graph.stats);
    lines.push(arch || generateStructuralArchOverview(graph.stats, highValue));
  } else {
    lines.push(generateStructuralArchOverview(graph.stats, highValue));
  }
  lines.push('');

  // Language breakdown
  lines.push('### Language breakdown');
  lines.push('');
  lines.push('| Language | Files | % |');
  lines.push('|----------|-------|---|');
  const total = graph.stats.totalFiles;
  for (const [lang, count] of Object.entries(graph.stats.byLang || {}).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${lang} | ${count} | ${Math.round(count / total * 100)}% |`);
  }
  lines.push('');

  // ── Entry points ──────────────────────────────────────────────────────────
  lines.push('## Entry points');
  lines.push('');
  const entries = allNodes.filter(([, n]) => n.isEntryPoint);
  if (entries.length === 0) {
    lines.push('*No entry points detected*');
  } else {
    for (const [file, node] of entries) {
      lines.push(`- **\`${file}\`** — ${summaries[file] || 'application entry point'}`);
      if (node.imports.length > 0) {
        lines.push(`  - Imports: ${node.imports.slice(0, 6).join(', ')}`);
      }
    }
  }
  lines.push('');

  // ── Danger zones ──────────────────────────────────────────────────────────
  lines.push('## Danger zones');
  lines.push('');
  if (legacyReport?.dangerZones?.length > 0) {
    lines.push('> ⚠️ These files have high bug history or known workarounds. Always check with the contact before modifying.');
    lines.push('');
    for (const dz of legacyReport.dangerZones) {
      lines.push(`### ⚠️ \`${dz.file}\``);
      lines.push(`**Reason:** ${dz.reason}`);
      lines.push(`**Contact:** ${dz.contact}`);
      lines.push('');
    }
  } else {
    lines.push('*No danger zones detected.*');
    lines.push('');
  }

  // ── High-risk files ────────────────────────────────────────────────────────
  lines.push('## High-risk files');
  lines.push('');
  lines.push('> Files with risk score > 60. Read before modifying.');
  lines.push('');
  const highRiskFiles = Object.values(nodes)
    .filter(n => n.riskScore > 60)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 10);
  if (highRiskFiles.length > 0) {
    lines.push('| File | Score | Dependents | Band |');
    lines.push('|------|-------|------------|------|');
    for (const n of highRiskFiles) {
      const br = blastRadius(n.file, nodes);
      const depStr = br.transitive > br.direct
        ? `${br.direct} (+${br.transitive - br.direct} transitive)`
        : `${br.direct}`;
      lines.push(`| \`${n.file}\` | ${n.riskScore} | ${depStr} | ${scoreMap[n.file]?.band || '?'} |`);
    }
  } else {
    lines.push('*No high-risk files detected.*');
  }
  lines.push('');

  // ── Dead code candidates ───────────────────────────────────────────────────
  lines.push('## Dead code candidates');
  lines.push('');
  if (deadFiles.length > 0) {
    lines.push(`> ${deadFiles.length} files have no importers. They may be unused, entry points, or dynamically loaded.`);
    lines.push('');
    lines.push('| File | Language | Module risk | Classification |');
    lines.push('|------|----------|-------------|----------------|');
    for (const f of deadFiles.slice(0, 20)) {
      const n = nodes[f] || {};
      const risk = riskByFile[f] || 'unknown';
      const riskIcon = risk === 'high' ? '🔴 high — investigate before deleting'
        : risk === 'low' ? '🟢 low — safe to remove'
        : '⚪ unknown';
      const label = deadClassification[f] || '—';
      lines.push(`| \`${f}\` | ${n.lang || '?'} | ${riskIcon} | ${label} |`);
    }
    if (deadFiles.length > 20) {
      lines.push('');
      lines.push(`> ...and ${deadFiles.length - 20} more. Run \`wednesday-skills dead\` for full list.`);
    }
  } else {
    lines.push('> No dead code detected — every file is imported by at least one other.');
  }
  lines.push('');

  // ── Coverage gaps ──────────────────────────────────────────────────────────
  lines.push('## Coverage gaps');
  lines.push('');
  if (totalGaps > 0) {
    lines.push('| Gap type | Count |');
    lines.push('|----------|-------|');
    for (const [type, count] of Object.entries(gapsByType)) {
      lines.push(`| ${type} | ${count} |`);
    }
    lines.push('');
    lines.push('> Run `wednesday-skills fill-gaps --min-risk 50` to resolve gaps.');
  } else {
    lines.push('> No gaps detected. Graph coverage is complete.');
  }
  lines.push('');

  // ── Module map — directory level ─────────────────────────────────────────
  lines.push('## Module map');
  lines.push('');
  lines.push('> One row per directory. For per-file detail: `wednesday-skills blast <file>` or `wednesday-skills chat "what does X do"`.');
  lines.push('');
  lines.push('| Directory | Files | Avg risk | Debt | Type | Purpose |');
  lines.push('|-----------|-------|----------|------|------|---------|');

  const byDir = groupByDir(allNodes);
  for (const [dir, dirNodes] of Object.entries(byDir).sort()) {
    const intel        = commentByDir.get(dir);
    const avgRisk      = Math.round(dirNodes.reduce((s, [, n]) => s + n.riskScore, 0) / dirNodes.length);
    const riskIcon     = avgRisk >= 61 ? '🔴' : avgRisk >= 31 ? '🟡' : '🟢';
    const debt         = intel?.techDebt && intel.techDebt !== 'none' ? `**${intel.techDebt.toUpperCase()}**` : '—';
    const type         = intel?.isBizFeature === true ? '`biz`' : intel?.isBizFeature === false ? '`infra`' : '—';
    const purpose      = intel?.purpose ? intel.purpose.split('.')[0] : '—';
    lines.push(`| \`${dir}\` | ${dirNodes.length} | ${riskIcon} ${avgRisk} | ${debt} | ${type} | ${purpose} |`);
  }
  lines.push('');

  // ── Tech stack ─────────────────────────────────────────────────────────────
  const pkgJson = readPackageJson(graph.rootDir);
  const frameworks = new Set(allNodes.map(([, n]) => n.meta?.framework).filter(Boolean));
  const stack = buildTechStack(allNodes, pkgJson, graph.stats, frameworks);

  lines.push('## Tech stack');
  lines.push('');
  lines.push('| Dimension | Details |');
  lines.push('|-----------|---------|');
  if (stack.platform)           lines.push(`| Platform | ${stack.platform} |`);
  if (stack.languages.length)   lines.push(`| Languages | ${stack.languages.join(', ')} |`);
  if (stack.frameworks.length)  lines.push(`| Frameworks | ${stack.frameworks.join(', ')} |`);
  if (stack.libraries.length)   lines.push(`| Key Libraries | ${stack.libraries.slice(0, 15).join(', ')} |`);
  lines.push('');

  // ── Feature inventory ──────────────────────────────────────────────────────
  const features = inferFeatures(allNodes);
  if (Object.keys(features).length > 0) {
    lines.push('## Feature inventory');
    lines.push('');
    lines.push('> Inferred business domains from codebase structure.');
    lines.push('');
    for (const [domain, files] of Object.entries(features)) {
      lines.push(`- **${domain}:** ${files.slice(0, 10).map(f => `\`${f}\``).join(', ')}`);
    }
    lines.push('');
  }

  // ── Comment intelligence ──────────────────────────────────────────────────
  if (commentIntel?.modules?.some(m => m.purpose || m.techDebt)) {
    lines.push('## Comment intelligence');
    lines.push('');
    lines.push('> Enriched from developer comments — TODOs, FIXMEs, HACKs, and explanations.');
    lines.push('');
    appendCommentIntelSection(lines, commentIntel);
  }

  // ── Legacy health report ──────────────────────────────────────────────────
  lines.push('## Legacy health report');
  lines.push('');
  appendLegacySection(lines, legacyReport);

  // ── Annotation coverage ───────────────────────────────────────────────────
  lines.push('## Annotation coverage');
  lines.push('');
  appendAnnotationCoverage(lines, allNodes);

  // ── Output files ──────────────────────────────────────────────────────────
  lines.push('## Output files');
  lines.push('');
  lines.push('| File | Description |');
  lines.push('|------|-------------|');
  lines.push('| `.wednesday/codebase/dep-graph.json` | Full dependency graph |');
  lines.push('| `.wednesday/codebase/summaries.json` | Module summaries |');
  lines.push('| `.wednesday/codebase/MASTER.md` | This file — architecture overview + module map |');
  lines.push('| `.wednesday/codebase/analysis/blast-radius.json` | Top 50 files by blast radius |');
  lines.push('| `.wednesday/codebase/analysis/safety-scores.json` | Risk scores (0–100) per file |');
  lines.push('| `.wednesday/codebase/analysis/dead-code.json` | Dead files + circular deps |');
  lines.push('| `.wednesday/codebase/analysis/api-surface.json` | Public contracts per file |');
  lines.push('| `.wednesday/codebase/analysis/conflicts.json` | Dependency conflicts |');
  lines.push('| `.wednesday/codebase/analysis/comments.json` | Comment intelligence — TODOs, ideas, tech debt |');
  lines.push('| `.wednesday/codebase/analysis/comments-raw.md` | Pre-LLM comment collection |');
  lines.push('');
  lines.push('---');
  lines.push('*Generated by wednesday-skills map — graph analysis only, no raw source read*');

  const content = lines.join('\n');
  const outPath = path.join(codebaseDir, 'MASTER.md');
  fs.mkdirSync(codebaseDir, { recursive: true });
  fs.writeFileSync(outPath, content);
  return outPath;
}

/**
 * Classify a file path into a role hint for onboarding notes
 */
function classifyRole(file, node) {
  const f = file.toLowerCase();
  const name = path.basename(f, path.extname(f));
  if (node.meta?.isController) return 'controller';
  if (node.meta?.isProvider) return 'di-provider';
  if (node.isEntryPoint) return 'entry-point';
  if (node.isBarrel) return 'barrel-export';
  if (/\.test\.|\.spec\./.test(f)) return 'test';
  if (/\/(hooks?|use[A-Z])/.test(file) || /^use[A-Z]/.test(name)) return 'react-hook';
  if (/\/(components?|views?|screens?|pages?)\//.test(f) || /component|view|screen|page/i.test(name)) return 'ui-component';
  if (/\/service[s]?\//.test(f) || /service/i.test(name)) return 'service';
  if (/\/util[s]?\/|\/helper[s]?\/|\/lib\//.test(f) || /util|helper/i.test(name)) return 'utility';
  if (/\/model[s]?\/|\/entit[y|ies]\/|\/schema[s]?\//.test(f)) return 'data-model';
  if (/\/config[s]?\/|\/constant[s]?\/|\/settings?\//.test(f) || /config|constant/i.test(name)) return 'config';
  if (/\/routes?\/|\/router\//.test(f) || /route|router/i.test(name)) return 'router';
  if (/\/middleware\//.test(f) || /middleware/i.test(name)) return 'middleware';
  if (/\/store[s]?\/|\/redux\/|\/context\//.test(f)) return 'state-management';
  if (/\.graphql$|\.gql$/.test(f)) return 'graphql-schema';
  if (node.lang === 'go')     return 'go-module';
  if (node.lang === 'kotlin') return 'android-module';
  if (node.lang === 'swift') {
    if (node.meta?.isViewController) return 'ios-viewcontroller';
    if (node.meta?.isView)           return 'swiftui-view';
    if (node.meta?.isObservableObject) return 'ios-viewmodel';
    return 'ios-module';
  }
  return 'module';
}

const ROLE_ONBOARDING = {
  'controller':       'Handles HTTP requests for this domain. Start here to understand the API surface.',
  'di-provider':      'Injectable service — look at what it provides and who injects it.',
  'entry-point':      'Application entry. Read this first to understand bootstrapping.',
  'barrel-export':    'Re-exports from this directory. Use the exports list to see what\'s public.',
  'test':             'Test file — read alongside the module it tests.',
  'react-hook':       'Custom React hook. Check "Imported by" to see which components depend on it.',
  'ui-component':     'UI component — renders directly to screen. Check its props via exports and which pages include it.',
  'service':          'Business logic service. The most likely place to add features for this domain.',
  'utility':          'Shared utility — pure functions with no side effects (ideally). Safe to read without context.',
  'data-model':       'Data shape definition. Changes here affect everything in "Imported by".',
  'config':           'Configuration constants. Changes affect the whole application.',
  'router':           'Route definitions — shows what URLs/endpoints this area owns.',
  'middleware':       'Request/response pipeline step. Runs on every matched request.',
  'state-management': 'Global state store/context. Changes here cascade to all consumers.',
  'graphql-schema':   'GraphQL type definitions. Changes require coordinated client + server updates.',
  'go-module':        'Go package — exported symbols are capitalised identifiers.',
  'android-module':   'Kotlin/Android module — check Activity/Fragment lifecycle usage.',
  'module':           'Internal module. Check exports and "Imported by" to understand its role.',
};

/**
 * Full file section — every detail
 */


function appendCommentIntelSection(lines, intel) {
  const enriched = intel.modules.filter(m => m.purpose || m.techDebt);
  if (enriched.length === 0) return;

  // Biz features vs infra split
  const biz   = enriched.filter(m => m.isBizFeature === true);
  const infra  = enriched.filter(m => m.isBizFeature === false);
  const unknown = enriched.filter(m => m.isBizFeature === null);

  if (biz.length > 0) {
    lines.push('### Business features');
    lines.push('');
    lines.push('| Module | Purpose | Tech debt |');
    lines.push('|--------|---------|-----------|');
    for (const m of biz) {
      const debt = m.techDebt && m.techDebt !== 'none'
        ? `**${m.techDebt.toUpperCase()}**` : m.techDebt || '—';
      lines.push(`| \`${m.dir}/\` | ${m.purpose || '—'} | ${debt} |`);
    }
    lines.push('');
  }

  if (infra.length > 0) {
    lines.push('### Infrastructure modules');
    lines.push('');
    lines.push('| Module | Purpose | Tech debt |');
    lines.push('|--------|---------|-----------|');
    for (const m of infra) {
      const debt = m.techDebt && m.techDebt !== 'none'
        ? `**${m.techDebt.toUpperCase()}**` : m.techDebt || '—';
      lines.push(`| \`${m.dir}/\` | ${m.purpose || '—'} | ${debt} |`);
    }
    lines.push('');
  }

  if (unknown.length > 0) {
    lines.push('### Other modules');
    lines.push('');
    lines.push('| Module | Purpose | Tech debt |');
    lines.push('|--------|---------|-----------|');
    for (const m of unknown) {
      const debt = m.techDebt && m.techDebt !== 'none'
        ? `**${m.techDebt.toUpperCase()}**` : m.techDebt || '—';
      lines.push(`| \`${m.dir}/\` | ${m.purpose || '—'} | ${debt} |`);
    }
    lines.push('');
  }

  // Improvement ideas — all modules that have them
  const withIdeas = enriched.filter(m => m.ideas?.length > 0);
  if (withIdeas.length > 0) {
    lines.push('### Improvement ideas from comments');
    lines.push('');
    for (const m of withIdeas) {
      lines.push(`**\`${m.dir}/\`**`);
      for (const idea of m.ideas) lines.push(`- ${idea}`);
      lines.push('');
    }
  }

  // Global tag stats
  if (intel.summary?.byType && Object.keys(intel.summary.byType).length > 0) {
    lines.push('### Tag breakdown');
    lines.push('');
    lines.push('| Tag | Count |');
    lines.push('|-----|-------|');
    for (const [tag, count] of Object.entries(intel.summary.byType).sort((a, b) => b[1] - a[1])) {
      lines.push(`| \`${tag}\` | ${count} |`);
    }
    lines.push('');
  }
}

function appendLegacySection(lines, report) {
  if (!report) { lines.push('*No legacy analysis available.*\n'); return; }

  if (report.godFiles?.length > 0) {
    lines.push('### God files');
    lines.push('');
    lines.push('> Files doing too many things. Candidates for decomposition.');
    lines.push('');
    lines.push('| File | Exports | Concerns |');
    lines.push('|------|---------|----------|');
    for (const gf of report.godFiles.slice(0, 20)) {
      lines.push(`| \`${gf.file}\` | ${gf.exports} | ${gf.concerns} |`);
    }
    if (report.godFiles.length > 20) {
      lines.push(`| ... and ${report.godFiles.length - 20} more | | |`);
    }
    lines.push('');
  } else {
    lines.push('### God files\n*None detected.*\n');
  }

  if (report.circularDeps?.length > 0) {
    lines.push('### Circular dependencies');
    lines.push('');
    for (const c of report.circularDeps.slice(0, 20)) {
      lines.push(`- **${c.risk}:** \`${c.files.join('\` → \`')}\``);
    }
    if (report.circularDeps.length > 20) {
      lines.push(`- ... and ${report.circularDeps.length - 20} more`);
    }
    lines.push('');
  } else {
    lines.push('### Circular dependencies\n*None detected.*\n');
  }

  if (report.techDebt?.length > 0) {
    lines.push('### Tech debt (ranked)');
    lines.push('');
    lines.push('| File | Bug fixes | Age | Coverage | Priority |');
    lines.push('|------|-----------|-----|----------|----------|');
    for (const td of report.techDebt.slice(0, 20)) {
      lines.push(`| \`${td.file}\` | ${td.bugFixes} | ${td.age} | ${td.coverage} | **${td.priority}** |`);
    }
    if (report.techDebt.length > 20) {
      lines.push(`| ... and ${report.techDebt.length - 20} more | | | | |`);
    }
    lines.push('');
  }

  if (report.unannotatedDynamic?.length > 0) {
    lines.push('### Unannotated dynamic patterns');
    lines.push('');
    lines.push('> Add these annotations to improve graph coverage.');
    lines.push('');
    lines.push('| File | Line | Pattern | Suggested annotation |');
    lines.push('|------|------|---------|----------------------|');
    for (const p of report.unannotatedDynamic.slice(0, 20)) {
      lines.push(`| \`${p.file}\` | ${p.line} | \`${p.pattern}\` | \`${p.action}\` |`);
    }
    if (report.unannotatedDynamic.length > 20) {
      lines.push(`| ... and ${report.unannotatedDynamic.length - 20} more | | | |`);
    }
    lines.push('');
  }
}

function appendAnnotationCoverage(lines, allNodes) {
  let dynamicRequires = 0, annotatedDynamic = 0;
  let globals = 0, annotatedGlobals = 0;
  let emitters = 0, annotatedEmitters = 0;

  for (const [, node] of allNodes) {
    for (const gap of node.gaps) {
      if (gap.type === 'dynamic-require' || gap.type === 'dynamic-import') dynamicRequires++;
      if (gap.type === 'event-emit') emitters++;
      if (gap.type === 'global-inject') globals++;
    }
    if (node.meta?.annotations) {
      for (const ann of node.meta.annotations) {
        if (ann.type === 'connects-to') annotatedDynamic++;
        if (ann.type === 'global') annotatedGlobals++;
      }
    }
  }

  lines.push('| Category | Found | Annotated | Coverage |');
  lines.push('|----------|-------|-----------|---------|');
  lines.push(`| Dynamic requires | ${dynamicRequires} | ${annotatedDynamic} | ${pct(annotatedDynamic, dynamicRequires)}% |`);
  lines.push(`| Global injections | ${globals} | ${annotatedGlobals} | ${pct(annotatedGlobals, globals)}% |`);
  lines.push(`| Event emitters | ${emitters} | 0 | 0% |`);
  lines.push('');
  lines.push('> Boy scout rule: whoever touches a file adds annotations for that file.');
  lines.push('');
}

function pct(a, b) { return b === 0 ? 100 : Math.round(a / b * 100); }

function riskLabel(score) {
  if (score >= 81) return 'Critical';
  if (score >= 61) return 'High';
  if (score >= 31) return 'Medium';
  return 'Low';
}

function generateStructuralArchOverview(stats, highValue) {
  const langs = Object.entries(stats.byLang || {})
    .sort((a, b) => b[1] - a[1])
    .map(([l, c]) => `${l} (${c} files)`)
    .join(', ');

  return `${stats.totalFiles} files across ${langs}. ${stats.totalEdges} dependency edges tracked. ${highValue.length} high-value modules (entry points or widely imported). ${stats.highRiskFiles} files with risk score above 60.`;
}

async function callHaikuArchitecture(highValue, stats) {
  const topFiles = highValue.slice(0, 8).map(n =>
    `${n.file}: exports [${n.exports.slice(0, 3).join(',')}] — imported by ${n.importedBy.length} files`
  ).join('\n');

  const prompt = `Codebase: ${stats.totalFiles} files, languages: ${JSON.stringify(stats.byLang)}
Top modules:\n${topFiles}
Write 3 specific sentences describing the architecture. Name actual patterns and frameworks used.`;

  return callLLM({ model: 'haiku', messages: [{ role: 'user', content: prompt }], maxTokens: 200, operation: 'arch-overview' });
}

module.exports = { generateMasterMd, isHighValue };
