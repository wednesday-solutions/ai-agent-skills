/**
 * 2C-2 — MASTER.md generator
 * Comprehensive per-file documentation. Every file gets full detail.
 * Writes .wednesday/codebase/MASTER.md
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

function isHighValue(node) {
  return node.isEntryPoint || node.importedBy.length > 10 || node.riskScore > 70;
}

/**
 * Generate full MASTER.md — every file documented in detail
 */
async function generateMasterMd(graph, summaries, legacyReport, codebaseDir, apiKey) {
  const nodes = graph.nodes;
  const allNodes = Object.entries(nodes).filter(([, n]) => !n.error);

  const lines = [];

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push(`# Codebase Intelligence — MASTER.md`);
  lines.push(`> Generated: ${new Date().toISOString()}`);
  lines.push(`> Project root: ${graph.rootDir}`);
  lines.push(`> Files: ${graph.stats.totalFiles} | Edges: ${graph.stats.totalEdges} | High-risk: ${graph.stats.highRiskFiles}`);
  lines.push('');

  // ── Table of contents ─────────────────────────────────────────────────────
  lines.push('## Table of contents');
  lines.push('');
  lines.push('1. [New dev quick-start](#new-dev-quick-start)');
  lines.push('2. [Architecture overview](#architecture-overview)');
  lines.push('3. [Entry points](#entry-points)');
  lines.push('4. [Danger zones](#danger-zones)');
  lines.push('5. [Module map — every file](#module-map)');
  lines.push('6. [Legacy health report](#legacy-health-report)');
  lines.push('7. [Annotation coverage](#annotation-coverage)');
  lines.push('');

  // ── New dev quick-start ────────────────────────────────────────────────────
  lines.push('## New dev quick-start');
  lines.push('');
  lines.push('> Read these files in order to get up to speed. They cover the most critical paths.');
  lines.push('');

  // Entry points first
  const entryFiles = allNodes.filter(([, n]) => n.isEntryPoint).map(([f]) => f);
  if (entryFiles.length > 0) {
    lines.push('**1. Entry points — start here:**');
    for (const f of entryFiles.slice(0, 5)) {
      lines.push(`   - \`${f}\``);
    }
    lines.push('');
  }

  // Top services (most imported internal modules that are services/providers)
  const topServices = allNodes
    .filter(([f, n]) => n.importedBy.length >= 3 && !n.isBarrel && !n.isEntryPoint && !f.includes('.test.') && !f.includes('.spec.'))
    .sort((a, b) => b[1].importedBy.length - a[1].importedBy.length)
    .slice(0, 5);
  if (topServices.length > 0) {
    lines.push('**2. Core modules (most depended on):**');
    for (const [f, n] of topServices) {
      lines.push(`   - \`${f}\` — used by ${n.importedBy.length} files`);
    }
    lines.push('');
  }

  // Danger zones to avoid without context
  if (legacyReport?.dangerZones?.length > 0) {
    lines.push('**3. Danger zones — do NOT touch without reading the section below:**');
    for (const dz of legacyReport.dangerZones.slice(0, 3)) {
      lines.push(`   - \`${dz.file}\` — ${dz.reason}`);
    }
    lines.push('');
  }

  // Dead code to ignore
  const deadCount = allNodes.filter(([, n]) => n.importedBy.length === 0 && !n.isEntryPoint && !n.isBarrel).length;
  if (deadCount > 0) {
    lines.push(`**4.** There are **${deadCount}** files with no importers (potential dead code). Run \`wednesday-skills dead\` to list them before modifying.`);
    lines.push('');
  }

  // ── Architecture overview ─────────────────────────────────────────────────
  lines.push('## Architecture overview');
  lines.push('');
  const highValue = Object.values(nodes).filter(isHighValue);
  if (apiKey && highValue.length > 0) {
    const arch = await callHaikuArchitecture(highValue, graph.stats, apiKey);
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

  // ── Module map — every file ───────────────────────────────────────────────
  lines.push('## Module map');
  lines.push('');
  lines.push('> Every file in the codebase. High-value files get full sections. All files listed with key stats.');
  lines.push('');

  // Group by directory
  const byDir = {};
  for (const [file, node] of allNodes) {
    const dir = path.dirname(file) === '.' ? '(root)' : path.dirname(file);
    byDir[dir] = byDir[dir] || [];
    byDir[dir].push([file, node]);
  }

  for (const [dir, dirNodes] of Object.entries(byDir).sort()) {
    lines.push(`### 📁 ${dir}`);
    lines.push('');

    for (const [file, node] of dirNodes.sort((a, b) => b[1].riskScore - a[1].riskScore)) {
      lines.push(...formatFileSection(file, node, summaries[file], nodes, legacyReport));
    }
  }

  // ── Legacy health report ──────────────────────────────────────────────────
  lines.push('## Legacy health report');
  lines.push('');
  appendLegacySection(lines, legacyReport);

  // ── Annotation coverage ───────────────────────────────────────────────────
  lines.push('## Annotation coverage');
  lines.push('');
  appendAnnotationCoverage(lines, allNodes);

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
  if (node.lang === 'go') return 'go-module';
  if (node.lang === 'kotlin') return 'android-module';
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
function formatFileSection(file, node, summary, nodes, legacyReport) {
  const lines = [];
  const riskBand = riskLabel(node.riskScore);
  const isDanger = legacyReport?.dangerZones?.some(d => d.file === file);
  const isGod = legacyReport?.godFiles?.some(g => g.file === file);
  const role = classifyRole(file, node);

  // File heading with risk indicator
  const riskIcon = node.riskScore >= 81 ? '🔴' : node.riskScore >= 61 ? '🟠' : node.riskScore >= 31 ? '🟡' : '🟢';
  lines.push(`#### ${riskIcon} \`${file}\``);
  lines.push('');

  // Onboarding note — role-based quick primer for new devs
  lines.push(`> **Onboarding note (${role}):** ${ROLE_ONBOARDING[role]}`);
  lines.push('');

  // Summary
  lines.push(summary || `*${node.lang} module*`);
  lines.push('');

  // Key stats inline
  const flags = [];
  if (node.isEntryPoint) flags.push('entry-point');
  if (node.isBarrel) flags.push('barrel');
  if (isGod) flags.push('⚠️ god-file');
  if (isDanger) flags.push('⚠️ danger-zone');
  if (node.meta?.framework) flags.push(node.meta.framework);
  if (node.meta?.isProvider) flags.push('di-provider');
  if (node.meta?.isController) flags.push(`controller:${node.meta.controllerPath || ''}`);

  lines.push(`| Property | Value |`);
  lines.push(`|----------|-------|`);
  lines.push(`| Language | ${node.lang} |`);
  lines.push(`| Risk score | **${node.riskScore}/100** — ${riskBand} |`);
  lines.push(`| Blast radius | ${node.importedBy.length} direct dependent${node.importedBy.length !== 1 ? 's' : ''} |`);
  lines.push(`| Exports | ${node.exports.length} |`);
  lines.push(`| Imports | ${node.imports.length} |`);
  if (flags.length > 0) lines.push(`| Flags | ${flags.join(', ')} |`);
  lines.push('');

  // Exports — all of them
  if (node.exports.length > 0) {
    lines.push(`**Exports:** \`${node.exports.join('`, `')}\``);
    lines.push('');
  }

  // Frontend use — which UI files import this module
  const frontendConsumers = node.importedBy.filter(f => {
    const lf = f.toLowerCase();
    return /\/(component[s]?|page[s]?|screen[s]?|view[s]?|hook[s]?)\//.test(lf)
      || /component|page|screen|view/i.test(path.basename(lf, path.extname(lf)))
      || /use[A-Z]/.test(path.basename(lf, path.extname(lf)));
  });
  if (frontendConsumers.length > 0) {
    lines.push(`**Frontend use:** Used by ${frontendConsumers.length} UI file${frontendConsumers.length !== 1 ? 's' : ''}: ${frontendConsumers.map(f => `\`${f}\``).join(', ')}`);
    lines.push('');
  } else if (role === 'ui-component' || role === 'react-hook') {
    lines.push(`**Frontend use:** This IS a frontend module.`);
    lines.push('');
  }

  // Imports — split internal vs external
  const internalImports = node.imports.filter(i => nodes[i]);
  const externalImports = node.imports.filter(i => !nodes[i] && !i.startsWith('serverless:'));
  const configImports = node.imports.filter(i => i.startsWith('serverless:'));

  if (internalImports.length > 0) {
    lines.push(`**Internal imports:** ${internalImports.map(i => `\`${i}\``).join(', ')}`);
    lines.push('');
  }
  if (externalImports.length > 0) {
    lines.push(`**External packages:** ${externalImports.map(i => `\`${i}\``).join(', ')}`);
    lines.push('');
  }
  if (configImports.length > 0) {
    lines.push(`**Serverless triggers:** ${configImports.map(i => `\`${i}\``).join(', ')}`);
    lines.push('');
  }

  // Imported by
  if (node.importedBy.length > 0) {
    lines.push(`**Imported by:** ${node.importedBy.map(i => `\`${i}\``).join(', ')}`);
    lines.push('');
  } else if (!node.isEntryPoint && !node.isBarrel) {
    lines.push(`**Imported by:** *nobody — potential dead code*`);
    lines.push('');
  }

  // NestJS DI edges
  if (node.nestEdges?.length > 0) {
    const diEdges = node.nestEdges.map(e => `\`${e.to}\` (${e.type})`).join(', ');
    lines.push(`**DI dependencies:** ${diEdges}`);
    lines.push('');
  }

  // Git history
  if (node.meta?.gitHistory) {
    const g = node.meta.gitHistory;
    lines.push(`**Git history:**`);
    lines.push(`- Created: ${g.firstCommit || 'unknown'} (${Math.round((g.ageInDays || 0) / 365 * 10) / 10}yr old)`);
    lines.push(`- Last modified: ${g.lastCommit || 'unknown'}`);
    lines.push(`- Total commits: ${g.totalCommits}`);
    if (g.bugFixCommits > 0) lines.push(`- Bug fixes: **${g.bugFixCommits}** (${g.bugFixCommits >= 3 ? '⚠️ high' : 'normal'})`);
    if (g.hackCommits > 0) lines.push(`- Known workarounds: **${g.hackCommits}** ⚠️`);
    if (g.todoCount > 0) lines.push(`- TODO/FIXME/HACK commits: ${g.todoCount}`);
    if (g.authors?.length > 0) {
      lines.push(`- Authors: ${g.authors.slice(0, 3).map(a => `${a.email} (${a.commits})`).join(', ')}`);
    }
    lines.push('');
  }

  // Annotations
  if (node.meta?.annotations?.length > 0) {
    lines.push(`**Annotations:** ${node.meta.annotations.map(a => `\`@wednesday-skills:${a.type} ${a.value}\``).join(', ')}`);
    lines.push('');
  }

  // Gaps
  if (node.gaps.length > 0) {
    lines.push(`**Coverage gaps (${node.gaps.length}):**`);
    for (const gap of node.gaps) {
      lines.push(`- \`${gap.type}\` at line ${gap.line}: \`${gap.pattern || gap.event || gap.name || ''}\``);
    }
    lines.push('');
  }

  // Danger zone warning inline
  if (isDanger) {
    const dz = legacyReport.dangerZones.find(d => d.file === file);
    lines.push(`> ⚠️ **Danger zone:** ${dz.reason} — Contact: ${dz.contact}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  return lines;
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
    for (const gf of report.godFiles) {
      lines.push(`| \`${gf.file}\` | ${gf.exports} | ${gf.concerns} |`);
    }
    lines.push('');
  } else {
    lines.push('### God files\n*None detected.*\n');
  }

  if (report.circularDeps?.length > 0) {
    lines.push('### Circular dependencies');
    lines.push('');
    for (const c of report.circularDeps) {
      lines.push(`- **${c.risk}:** \`${c.files.join('\` → \`')}\``);
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
    for (const td of report.techDebt) {
      lines.push(`| \`${td.file}\` | ${td.bugFixes} | ${td.age} | ${td.coverage} | **${td.priority}** |`);
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
    for (const p of report.unannotatedDynamic) {
      lines.push(`| \`${p.file}\` | ${p.line} | \`${p.pattern}\` | \`${p.action}\` |`);
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

async function callHaikuArchitecture(highValue, stats, apiKey) {
  const topFiles = highValue.slice(0, 8).map(n =>
    `${n.file}: exports [${n.exports.slice(0, 3).join(',')}] — imported by ${n.importedBy.length} files`
  ).join('\n');

  const prompt = `Codebase: ${stats.totalFiles} files, languages: ${JSON.stringify(stats.byLang)}
Top modules:\n${topFiles}
Write 3 specific sentences describing the architecture. Name actual patterns and frameworks used.`;

  return new Promise(resolve => {
    const body = JSON.stringify({
      model: 'anthropic/claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0,
    });
    const options = {
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data).choices?.[0]?.message?.content?.trim() || null); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(30000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

module.exports = { generateMasterMd, isHighValue };
