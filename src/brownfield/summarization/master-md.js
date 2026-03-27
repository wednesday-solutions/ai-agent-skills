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
const { findDeadCode, findCircularDeps } = require('../analysis/dead-code');
const { blastRadius } = require('../analysis/blast-radius');
const { extractIosMetadata } = require('../analysis/ios-metadata');

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
  { domain: 'Home / Dashboard',   patterns: /home|dashboard|feed|landing|main|root|sqwid|post|details|list|tabbar|tab|scene|screen|controller|ar|arkit|camera/i },
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
function buildTechStack(allNodes, pkgJson, stats, frameworks, graphPackages) {
  const stack = { languages: [], frameworks: [], libraries: [], platform: null };

  const KEY_LIBS = [
    'react', 'react-native', 'next', 'express', 'fastify', 'koa', 'nestjs',
    'graphql', 'apollo', 'prisma', 'typeorm', 'sequelize', 'mongoose',
    'redux', 'zustand', 'mobx', 'recoil', 'jotai',
    'axios', 'swr', 'react-query', '@tanstack/query',
    'jest', 'vitest', 'mocha', 'cypress', 'playwright',
    'tailwindcss', 'styled-components', '@emotion',
    'stripe', 'twilio', 'sendgrid', 'firebase', 'supabase',
    'aws-sdk', '@aws-sdk', 'socket.io', 'ws',
    'lottie', 'kingfisher', 'cloudinary', 'iqkeyboardmanagerswift',
    'googlesignin', 'facebooksdk', 'cluster', 'mapkit', 'arkit', 'siren', 'alamofire', 'stepfun',
    'coredata', 'linkpresentation', 'firebaseanalytics', 'firebasecrashlytics', 'firebasemessaging',
    'corelocation', 'arkit', 'mapkit', 'swiftui', 'uikit', 'appkit', 'combine'
  ];

  // Languages...
  const langs = Object.entries(stats.byLang || {}).sort((a, b) => b[1] - a[1]);
  for (const [l] of langs) stack.languages.push(l.charAt(0).toUpperCase() + l.slice(1));

  // Platform...
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

  // Aggregate frameworks from meta
  for (const f of frameworks) stack.frameworks.push(f);

  // Deep scan imports for key libraries if not in pkgJson
  const allDeps = pkgJson ? { ...pkgJson.dependencies, ...pkgJson.devDependencies } : {};
  if (graphPackages?.ios) {
    if (graphPackages.ios.cocoapods?.pods) graphPackages.ios.cocoapods.pods.forEach(p => allDeps[p.toLowerCase()] = 'latest');
    if (graphPackages.ios.spm?.packages) graphPackages.ios.spm.packages.forEach(p => allDeps[p.name.toLowerCase()] = 'latest');
  }

  // Scan every node's imports for key frameworks
  const importedFrameworks = new Set();
  for (const [, n] of allNodes) {
    if (!n.imports) continue;
    for (const imp of n.imports) {
      const lower = imp.toLowerCase();
      // Check if import starts with a key lib name (common in Node and iOS)
      const found = KEY_LIBS.find(lib => lower === lib || lower.startsWith(`${lib}/`));
      if (found) importedFrameworks.add(found);
    }
  }

  for (const lib of KEY_LIBS) {
    if (allDeps[lib] || importedFrameworks.has(lib)) {
      const display = lib.charAt(0).toUpperCase() + lib.slice(1);
      if (!stack.libraries.includes(display)) stack.libraries.push(display);
    }
  }

  stack.languages = [...new Set(stack.languages)].sort();
  stack.frameworks = [...new Set(stack.frameworks)].sort();
  stack.libraries = [...new Set(stack.libraries)].sort();

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
async function generateMasterMd(graph, summaries, legacyReport, codebaseDir, apiKey, commentIntel = null, gapsFilled = 0, elapsed = 0, insights = {}, store = null, daemonData = null, adapterData = null) {
  const nodes = graph.nodes;
  const allNodes = Object.entries(nodes).filter(([, n]) => !n.error);

  // Pre-compute derived data used by multiple sections
  const scoreMap = scoreAll(nodes, buildTestCoverageMap(nodes), commentIntel);
  const { deadFiles, unusedExports, riskByFile } = findDeadCode(nodes, commentIntel);
  const rootDir    = graph.rootDir || '';
  const features   = inferFeatures(allNodes);
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
  lines.push(`> Generated: ${new Date().toISOString()} · Root: \`${graph.rootDir}\``);
  lines.push('');

  // ── Product orientation (AI-generated from features/signatures) ────────────
  if (apiKey) {
    const productOrientation = await callHaikuProductOrientation(features, sampleRepresentativeNodes(nodes, 30));
    if (productOrientation) {
      lines.push('## Product orientation');
      lines.push('');
      lines.push(`${productOrientation}`);
      lines.push('');
    }
  }

  // ── Codebase health (AI narrative) ────────────────────────────────────────
  if (insights.healthNarrative) {
    lines.push('## Codebase health');
    lines.push('');
    lines.push(`> ${insights.healthNarrative}`);
    lines.push('');
  }

  // ── Health snapshot ────────────────────────────────────────────────────────
  const logicCycles = (legacyReport?.circularDeps || []).filter(c => c.type === 'Logic').length;
  const structuralCycles = (legacyReport?.circularDeps || []).filter(c => c.type === 'Structural').length;

  // Risk band distribution
  const bands = { critical: 0, risky: 0, moderate: 0, safe: 0 };
  for (const s of Object.values(scoreMap)) {
    const b = s.band?.toLowerCase();
    if (b && bands[b] !== undefined) bands[b]++;
  }
  const bandStr = [
    bands.critical ? `🔴 ${bands.critical} critical` : '',
    bands.risky    ? `🟠 ${bands.risky} risky`       : '',
    bands.moderate ? `🟡 ${bands.moderate} moderate`  : '',
    bands.safe     ? `🟢 ${bands.safe} safe`          : '',
  ].filter(Boolean).join('  ');

  const unusedExportCount = Object.keys(unusedExports || {}).length;

  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Files | ${allNodes.length} mapped · ${graph.stats.totalEdges} edges |`);
  lines.push(`| Risk bands | ${bandStr || `${graph.stats.highRiskFiles} high-risk`} |`);
  lines.push(`| Dead | ${deadFiles.length} files · ${unusedExportCount} unused exports |`);
  lines.push(`| Circular deps | ${logicCycles} logic · ${structuralCycles} structural |`);
  lines.push(`| God files | ${legacyReport?.godFiles?.length || 0} |`);
  if (daemonData)  lines.push(`| Daemons | ${daemonData.total} patterns · ${Object.keys(daemonData.byKind || {}).length} kinds |`);
  if (adapterData) lines.push(`| Adapters | ${adapterData.total} · ${Object.keys(adapterData.byKind || {}).length} categories |`);
  if (totalGaps > 0) lines.push(`| Coverage gaps | ${totalGaps}${gapsFilled ? ` · ${gapsFilled} filled` : ''} |`);
  lines.push('');

  // ── Table of contents ─────────────────────────────────────────────────────
  lines.push('## Table of contents');
  lines.push('');
  const tocItems = [
    { title: 'Primary application flows', id: 'primary-application-flows' },
    { title: 'Architecture overview',     id: 'architecture-overview' },
    { title: 'Entry points',              id: 'entry-points' },
    { title: 'Watch zones',               id: 'watch-zones' },
    { title: 'Daemons & adapters',        id: 'daemons--adapters' },
    { title: 'Dead code',                 id: 'dead-code' },
    { title: 'Module map',                id: 'module-map' },
    { title: 'Tech stack',                id: 'tech-stack' },
  ];
  if (Object.keys(features).length > 0) tocItems.push({ title: 'Feature inventory', id: 'feature-inventory' });
  if (commentIntel?.modules?.some(m => m.purpose || m.techDebt)) tocItems.push({ title: 'Comment intelligence', id: 'comment-intelligence' });

  tocItems.forEach((item, i) => lines.push(`${i + 1}. [${item.title}](#${item.id})`));
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

  // ── User Journeys ──────────────────────────────────────────────────────────
  const journeysPath = path.join(graph.rootDir, '.wednesday', 'journeys.json');
  if (fs.existsSync(journeysPath)) {
    try {
      const { journeys } = JSON.parse(fs.readFileSync(journeysPath, 'utf8'));
      if (journeys && journeys.length > 0) {
        lines.push('## User journeys');
        lines.push('');
        lines.push('> High-level business flows across the application.');
        lines.push('');
        for (const j of journeys) {
          lines.push(`### 📽️ ${j.name}`);
          lines.push(`${j.description}`);
          lines.push('');
          lines.push(`\`\`\`mermaid
graph LR
  ${j.steps.map((s, i) => `s${i}["${s}"]`).join(' --> ')}
\`\`\``);
          lines.push('');
        }
      }
    } catch { /* ignore invalid journeys.json */ }
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

  const { detectArchitecturePattern } = require('../analysis/architecture');
  const detectedArch = detectArchitecturePattern(nodes);
  
  const representativeNodes = sampleRepresentativeNodes(nodes, 10);
  if (apiKey && representativeNodes.length > 0) {
    const arch = await callHaikuArchitecture(representativeNodes, graph.stats);
    let archText = arch || generateStructuralArchOverview(graph.stats, representativeNodes);
    lines.push(archText);
  }
  lines.push('');

  // ── Scene Inventory (Clean Swift / VIP specific) ──────────────────────────
  if (detectedArch === 'Clean Swift (VIP)') {
    lines.push('### Scene inventory');
    lines.push('');
    lines.push('> Mapping of visual scenes to their Clean Swift components.');
    lines.push('');
    lines.push('| Scene | ViewController | Interactor | Presenter | Router |');
    lines.push('|-------|----------------|------------|-----------|--------|');

    const scenes = {};
    for (const [file] of allNodes) {
      const match = path.basename(file).match(/^(.+)(ViewController|Interactor|Presenter|Router|Worker)\.swift$/);
      if (match) {
        const name = match[1];
        const type = match[2];
        scenes[name] = scenes[name] || {};
        scenes[name][type] = file;
      }
    }

    for (const [name, files] of Object.entries(scenes).sort()) {
      if (Object.keys(files).length >= 3) { // Only show scenes with most components
        const vc = files.ViewController ? `[\`${path.basename(files.ViewController)}\`](#${files.ViewController.replace(/\//g, '').replace(/\./g, '').toLowerCase()})` : '—';
        const interactor = files.Interactor ? `\`${path.basename(files.Interactor)}\`` : '—';
        const presenter = files.Presenter ? `\`${path.basename(files.Presenter)}\`` : '—';
        const router = files.Router ? `\`${path.basename(files.Router)}\`` : '—';
        lines.push(`| **${name}** | ${vc} | ${interactor} | ${presenter} | ${router} |`);
      }
    }
    lines.push('');
  }

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

  // ── Watch zones — high-risk + danger zones merged ─────────────────────────
  lines.push('## Watch zones');
  lines.push('');
  lines.push('> Files to read before modifying. Sorted by risk score.');
  lines.push('');
  {
    const highRiskFiles = Object.values(nodes)
      .filter(n => n.riskScore > 60)
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 12);
    const dangerSet = new Set((legacyReport?.dangerZones || []).map(d => d.file));
    const dangerMap = Object.fromEntries((legacyReport?.dangerZones || []).map(d => [d.file, d]));

    if (highRiskFiles.length > 0) {
      lines.push('| File | Score | Dependents | Flags |');
      lines.push('|------|-------|------------|-------|');
      for (const n of highRiskFiles) {
        const br  = blastRadius(n.file, nodes);
        const dep = br.transitive > br.direct ? `${br.direct}+${br.transitive - br.direct}t` : `${br.direct}`;
        const dz  = dangerSet.has(n.file) ? ' ⚠️ danger' : '';
        const band = scoreMap[n.file]?.band || '?';
        lines.push(`| \`${n.file}\` | ${n.riskScore} | ${dep} | ${band}${dz} |`);
      }
      // Show any danger zones not already in the high-risk list
      for (const dz of (legacyReport?.dangerZones || [])) {
        if (!highRiskFiles.find(n => n.file === dz.file)) {
          lines.push(`| \`${dz.file}\` | — | — | ⚠️ ${dz.reason} |`);
        }
      }
    } else {
      lines.push('*No high-risk files detected.*');
    }
  }
  lines.push('');

  // ── Daemons & Adapters ─────────────────────────────────────────────────────
  const hasDaemons  = daemonData  && daemonData.total  > 0;
  const hasAdapters = adapterData && adapterData.total > 0;
  if (hasDaemons || hasAdapters) {
    lines.push('## Daemons & adapters');
    lines.push('');
    if (hasDaemons) {
      lines.push('**Background processes** — async patterns invisible to import analysis');
      lines.push('');
      lines.push('| Kind | Count | Examples |');
      lines.push('|------|-------|---------|');
      for (const [kind, entries] of Object.entries(daemonData.byKind)) {
        const examples = entries.slice(0, 2).map(e => {
          const rel = rootDir ? path.relative(rootDir, e.file) : e.file;
          return e.event ? `\`${e.event}\`` : `\`${path.basename(rel)}:${e.line}\``;
        }).join(', ');
        lines.push(`| ${kind} | ${entries.length} | ${examples} |`);
      }
      lines.push('');
    }
    if (hasAdapters) {
      lines.push('**External adapters** — mocking points for tests');
      lines.push('');
      lines.push('| Category | Libraries | Files |');
      lines.push('|----------|-----------|-------|');
      for (const [kind, libraries] of Object.entries(adapterData.byKind)) {
        const libs      = Object.keys(libraries).join(', ');
        const fileCount = Object.values(libraries).reduce((s, arr) => s + arr.length, 0);
        lines.push(`| ${kind} | ${libs} | ${fileCount} |`);
      }
      lines.push('');
    }
  }

  // ── Dead code ──────────────────────────────────────────────────────────────
  lines.push('## Dead code');
  lines.push('');
  if (deadFiles.length > 0 || unusedExportCount > 0) {
    if (deadFiles.length > 0) {
      lines.push(`**${deadFiles.length} unreferenced files** — no importers detected`);
      lines.push('');
      lines.push('| File | Lang | Risk |');
      lines.push('|------|------|------|');
      for (const f of deadFiles.slice(0, 15)) {
        const n    = nodes[f] || {};
        const risk = riskByFile[f] === 'high' ? '🔴' : riskByFile[f] === 'low' ? '🟢' : '⚪';
        lines.push(`| \`${f}\` | ${n.lang || '?'} | ${risk} ${riskByFile[f] || '?'} |`);
      }
      if (deadFiles.length > 15) lines.push(`| _…+${deadFiles.length - 15} more_ | | |`);
      lines.push('');
    }
    if (unusedExportCount > 0) {
      const topUnused = Object.entries(unusedExports || {}).slice(0, 8);
      lines.push(`**${unusedExportCount} unused exports** — exported but never imported`);
      lines.push('');
      lines.push('| File | Exports |');
      lines.push('|------|---------|');
      for (const [file, exports] of topUnused) {
        lines.push(`| \`${file}\` | ${(exports || []).slice(0, 4).join(', ')} |`);
      }
      if (unusedExportCount > 8) lines.push(`| _…+${unusedExportCount - 8} more files_ | |`);
      lines.push('');
    }
  } else {
    lines.push('> No dead code detected — every file is imported and every export is used.');
    lines.push('');
  }

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
    let debt         = intel?.techDebt && intel.techDebt !== 'none' ? `**${intel.techDebt.toUpperCase()}**` : '—';
    let type         = intel?.isBizFeature === true ? '`biz`' : intel?.isBizFeature === false ? '`infra`' : '—';
    
    // Heuristics for empty columns
    if (type === '—') {
      const roles = dirNodes.map(([, n]) => classifyRole(n.file, n));
      if (roles.some(r => r === 'ios-viewcontroller' || r === 'ui-component' || r === 'react-hook')) {
        type = '`biz`';
      } else if (roles.every(r => r === 'utility' || r === 'data-model' || r === 'config')) {
        type = '`infra`';
      }
    }

    // Fallback purpose: structural summary if no semantic purpose
    let purpose = intel?.purpose ? intel.purpose.split('.')[0] : null;
    if (!purpose) {
      const roles = dirNodes.reduce((acc, [, n]) => {
        const r = classifyRole(n.file, n);
        acc[r] = (acc[r] || 0) + 1;
        return acc;
      }, {});
      const roleStr = Object.entries(roles).map(([r, c]) => `${c} ${r}${c > 1 ? 's' : ''}`).join(', ');
      purpose = `Contains ${roleStr}`;
    }

    lines.push(`| \`${dir}\` | ${dirNodes.length} | ${riskIcon} ${avgRisk} | ${debt} | ${type} | ${purpose} |`);
  }
  lines.push('');

  // ── Tech stack ─────────────────────────────────────────────────────────────
  const pkgJson = readPackageJson(graph.rootDir);
  const frameworks = new Set(allNodes.map(([, n]) => n.meta?.framework).filter(Boolean));
  const stack = buildTechStack(allNodes, pkgJson, graph.stats, frameworks, graph.packages);

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

  // ── Tech debt (top 5 only, compact) ──────────────────────────────────────
  if (legacyReport?.techDebt?.length > 0) {
    lines.push('## Tech debt');
    lines.push('');
    lines.push('| File | Bug fixes | Age | Priority |');
    lines.push('|------|-----------|-----|----------|');
    for (const td of legacyReport.techDebt.slice(0, 8)) {
      lines.push(`| \`${td.file}\` | ${td.bugFixes} | ${td.age} | **${td.priority}** |`);
    }
    if (legacyReport.techDebt.length > 8) lines.push(`| _…+${legacyReport.techDebt.length - 8} more_ | | | |`);
    lines.push('');
  }

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

function sampleRepresentativeNodes(nodes, maxCount = 10) {
  const allNodes = Object.values(nodes);
  const layerPatterns = [
    { name: 'Interactor', re: /Interactor/ },
    { name: 'Presenter', re: /Presenter/ },
    { name: 'Router', re: /Router/ },
    { name: 'ViewController', re: /ViewController/ },
    { name: 'Service', re: /Service/ },
    { name: 'Repository', re: /Repository/ },
    { name: 'Controller', re: /\.controller\./ },
    { name: 'Middleware', re: /middleware/i },
    { name: 'AR', re: /ar|arkit/i },
    { name: 'Social', re: /sqwid|post|feed/i },
  ];

  const samples = [];
  for (const pattern of layerPatterns) {
    const layerFiles = allNodes.filter(n => pattern.re.test(n.file) && !n.isBarrel);
    if (layerFiles.length > 0) {
      // Pick the most "typical" one (median risk score)
      layerFiles.sort((a, b) => a.riskScore - b.riskScore);
      samples.push(layerFiles[Math.floor(layerFiles.length / 2)]);
    }
  }

  // Fill remaining slots with high-risk files
  if (samples.length < maxCount) {
    const highRisk = allNodes
      .filter(n => !samples.includes(n))
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, maxCount - samples.length);
    samples.push(...highRisk);
  }

  return samples.slice(0, maxCount);
}

async function callHaikuArchitecture(sampleNodes, stats) {
  const fileContexts = sampleNodes.map(n => {
    const sigs = n.meta?.signatures ? `\nSignatures:\n${n.meta.signatures.slice(0, 500)}` : '';
    return `File: ${n.file}\nRole: ${classifyRole(n.file, n)}\nExports: ${n.exports.slice(0, 10).join(', ')}${sigs}`;
  }).join('\n\n---\n\n');

  const prompt = `Project Stats: ${stats.totalFiles} files, ${stats.totalLines} lines.
Primary Frameworks: ${stats.techStack}

Analyze these representative files and describe the overall software architecture pattern (e.g., Clean Swift/VIP, MVC, MVVM, Hexagonal). 
Explain how data flows between these components.

REPRESENTATIVE SAMPLES:
${fileContexts}

Write 3 concise paragraphs. Focus on structural boundaries and data flow.`;

  return callLLM({ model: 'haiku', messages: [{ role: 'user', content: prompt }], maxTokens: 400, operation: 'arch-overview' });
}

async function callHaikuProductOrientation(features, sampleNodes) {
  const domainList = Object.keys(features).join(', ');
  const fileContexts = sampleNodes.map(n => {
    const sigs = n.meta?.signatures ? `\nSignatures:\n${n.meta.signatures.slice(0, 300)}` : '';
    return `File: ${n.file}\nExports: ${n.exports.slice(0, 5).join(', ')}${sigs}`;
  }).join('\n\n---\n\n');

  const prompt = `Based on the feature domains (${domainList}) and these representative code signatures, write a 2-paragraph "Product Orientation" for a new developer. 
Identify what this app actually DOES (e.g., social app, fintech, marketplace, AR tool). 
Describe the core user value and the main business entities (e.g. Users, Orders, Assets).
Keep it professional but descriptive. No code-speak in the first paragraph.

SAMPLES:
${fileContexts}

Format: 2 paragraphs of plain text.`;

  return callLLM({ model: 'haiku', messages: [{ role: 'user', content: prompt }], maxTokens: 400, operation: 'product-orientation' });
}

function classifyRole(file, node) {
  if (node.isEntryPoint) return 'Entry Point';
  if (node.isBarrel) return 'Barrel / Index';
  if (file.includes('Service')) return 'Service / API';
  if (file.includes('Repository')) return 'Data / Persistence';
  if (file.includes('View')) return 'UI Component';
  if (file.includes('Model')) return 'Data Model';
  if (file.includes('Interactor')) return 'Business Logic (VIP)';
  if (file.includes('Presenter')) return 'Presentation Logic (VIP)';
  if (file.includes('Router')) return 'Navigation (VIP)';
  return 'Utility / Logic';
}

module.exports = { generateMasterMd, isHighValue, callHaikuProductOrientation, callHaikuArchitecture };
