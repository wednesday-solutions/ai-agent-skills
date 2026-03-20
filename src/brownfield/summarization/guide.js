/**
 * 2C-5 — GUIDE.md generator
 * Structural plain-English guide — no LLM, no API key required.
 * Claude (or any agent) reads this file to answer questions about the codebase.
 * Writes .wednesday/codebase/GUIDE.md
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Role classifier ───────────────────────────────────────────────────────────
function classifyRole(file, node) {
  const f    = file.toLowerCase();
  const name = path.basename(f, path.extname(f));
  if (node.meta?.isController)                              return 'controller';
  if (node.meta?.isProvider)                               return 'service';
  if (node.isEntryPoint)                                   return 'entry point';
  if (node.isBarrel)                                       return 'module index';
  if (/\.test\.|\.spec\./.test(f))                         return 'test file';
  if (/\/(hooks?)\//i.test(f) || /^use[A-Z]/.test(name))  return 'React hook';
  if (/\/(components?|views?|screens?|pages?)\//i.test(f) || /component|view|screen|page/i.test(name)) return 'UI component';
  if (/service/i.test(name))                               return 'service';
  if (/util|helper/i.test(name))                           return 'utility';
  if (/\/model[s]?\/|\/schema/i.test(f))                   return 'data model';
  if (/config|constant/i.test(name))                       return 'config';
  if (/route|router/i.test(name))                          return 'router';
  if (/middleware/i.test(name))                            return 'middleware';
  if (/store|redux|context/i.test(f))                      return 'state store';
  if (node.lang === 'graphql')                             return 'GraphQL schema';
  if (node.lang === 'go')                                  return 'Go package';
  if (node.lang === 'kotlin')                              return 'Android module';
  if (node.lang === 'swift') {
    if (node.meta?.isViewController) return 'iOS ViewController';
    if (node.meta?.isView)           return 'SwiftUI View';
    if (node.meta?.isObservableObject) return 'iOS ViewModel';
    return 'iOS module';
  }
  return 'module';
}

// Role → plain-English sentence template
const ROLE_PURPOSE = {
  'controller':     (name) => `Handles incoming requests for the ${name} area and decides what the app does with them.`,
  'service':        (name) => `Contains the core logic for ${name} — the rules and operations that make this feature work.`,
  'entry point':    (name) => `The starting point of the application. Everything else is kicked off from here.`,
  'module index':   (name) => `Re-exports everything from the ${name} directory so other parts of the app have one place to import from.`,
  'test file':      (name) => `Automated tests that verify ${name} works correctly.`,
  'React hook':     (name) => `A reusable React hook that manages ${name.replace(/^use/, '').replace(/([A-Z])/g, ' $1').trim().toLowerCase()} behaviour across components.`,
  'UI component':   (name) => `A visual building block that renders the ${name} part of the user interface.`,
  'utility':        (name) => `A collection of helper functions for ${name} used across the codebase.`,
  'data model':     (name) => `Defines the shape of ${name} data — what fields it has and what types they are.`,
  'config':         (name) => `Stores configuration values for ${name} that control how the app behaves.`,
  'router':         (name) => `Maps URLs or commands to the right handlers for the ${name} area.`,
  'middleware':     (name) => `Runs in the middle of every request for ${name} — checks, transforms, or blocks traffic.`,
  'state store':    (name) => `Holds shared application state for ${name} so multiple components can read and update it.`,
  'GraphQL schema': (name) => `Defines the ${name} types and operations available in the GraphQL API.`,
  'Go package':          (name) => `A Go package providing ${name} functionality. Exported symbols start with a capital letter.`,
  'Android module':      (name) => `An Android/Kotlin module for ${name}. May include Activities, Fragments, or ViewModels.`,
  'iOS ViewController':  (name) => `An iOS screen controller for ${name}. Manages what the user sees and responds to their taps.`,
  'SwiftUI View':        (name) => `A SwiftUI screen or component that draws the ${name} part of the app UI.`,
  'iOS ViewModel':       (name) => `An observable data holder for ${name} — keeps the UI in sync with the app state.`,
  'iOS module':          (name) => `A Swift module providing ${name} functionality to the iOS app.`,
  'module':              (name) => `Provides ${name} functionality to other parts of the app.`,
};

function purposeSentence(file, node) {
  const role = classifyRole(file, node);
  const name = path.basename(file, path.extname(file))
    .replace(/([A-Z])/g, ' $1').replace(/[-_]/g, ' ').trim().toLowerCase();
  return ROLE_PURPOSE[role]?.(name) || `Provides ${name} functionality.`;
}

function usageSentence(node) {
  const count = node.importedBy.length;
  if (node.isEntryPoint) return 'This is a top-level entry point — nothing imports it, it starts the process.';
  if (count === 0)       return 'Nothing currently imports this file — it may be unused or loaded dynamically.';
  if (count === 1)       return `One other module depends on it: \`${node.importedBy[0]}\`.`;
  if (count <= 4)        return `Used by ${count} modules: ${node.importedBy.map(f => `\`${path.basename(f)}\``).join(', ')}.`;
  return `Widely used — ${count} modules depend on it, including \`${path.basename(node.importedBy[0])}\` and \`${path.basename(node.importedBy[1])}\`.`;
}

function functionLine(exportName) {
  // Convert camelCase/PascalCase to words for a readable one-liner
  const words = exportName
    .replace(/([A-Z])/g, ' $1')
    .replace(/[-_]/g, ' ')
    .trim()
    .toLowerCase();
  return `Does the "${words}" operation for this module.`;
}

// ── Main generator ────────────────────────────────────────────────────────────
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

// ── GUIDE.md ──────────────────────────────────────────────────────────────────
async function generateGuide(graph, summaries, codebaseDir) {
  const nodes    = graph.nodes;
  const allNodes = Object.entries(nodes).filter(([, n]) => !n.error);
  const byDir    = groupByDir(allNodes);

  const lines = [];

  // Header
  lines.push('# Codebase Guide');
  lines.push('');
  lines.push('> What every module does — explained in plain English.');
  lines.push('> Read this if you\'re new to the project or need a quick refresher.');
  lines.push(`> Generated: ${new Date().toISOString()}`);
  lines.push('> **Tip:** For a 1-2 page overview read `SUMMARY.md` first.');
  lines.push('');

  // ── Directory index (jump links) ───────────────────────────────────────────
  lines.push('## Directory index');
  lines.push('');
  lines.push('Jump to any folder:');
  lines.push('');
  for (const [dir, dirNodes] of Object.entries(byDir).sort()) {
    // GitHub-style anchor: lowercase, spaces→hyphens, strip backticks/slashes
    const anchor = dir.replace(/[`/]/g, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/gi, '').toLowerCase();
    const topFile = [...dirNodes].sort((a, b) => b[1].importedBy.length - a[1].importedBy.length)[0];
    const topName = topFile ? path.basename(topFile[0]) : '';
    lines.push(`- [📁 ${dir}/](#${anchor}) — ${dirNodes.length} file${dirNodes.length !== 1 ? 's' : ''}${topName ? `, most-used: \`${topName}\`` : ''}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('**How to use this file:**');
  lines.push('- **Non-technical:** Read the paragraph under each module name — skip the rest.');
  lines.push('- **Engineers:** The **Functions** list below each module shows what every export does.');
  lines.push('- **AI assistant:** Ask "explain `<filename>`" — it reads this file to answer.');
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── Per-directory sections ────────────────────────────────────────────────
  for (const [dir, dirNodes] of Object.entries(byDir).sort()) {
    lines.push(`## 📁 \`${dir}/\``);
    lines.push('');

    for (const [file, node] of dirNodes.sort((a, b) => b[1].importedBy.length - a[1].importedBy.length)) {
      const name = path.basename(file);
      const role = classifyRole(file, node);

      lines.push(`### ${name}`);
      lines.push(`\`${file}\` · *${role}*`);
      lines.push('');

      const purpose = summaries[file] && summaries[file].length > 20 && !summaries[file].startsWith('*')
        ? summaries[file]
        : purposeSentence(file, node);
      lines.push(purpose);
      lines.push(usageSentence(node));
      lines.push('');

      if (node.exports.length > 0) {
        lines.push('**Functions:**');
        for (const exp of node.exports) {
          lines.push(`- \`${exp}\` — ${functionLine(exp)}`);
        }
        lines.push('');
      }

      const flags = [];
      if (node.riskScore > 60) flags.push(`⚠️ High-risk (score ${node.riskScore}/100) — get a review before changing`);
      if (node.meta?.gitHistory?.bugFixCommits > 2) flags.push(`🐛 ${node.meta.gitHistory.bugFixCommits} historical bug fixes — handle with care`);
      if (node.gaps.length > 0) flags.push(`🔍 ${node.gaps.length} dynamic pattern${node.gaps.length !== 1 ? 's' : ''} not fully tracked in the graph`);
      for (const flag of flags) lines.push(`> ${flag}`);
      if (flags.length > 0) lines.push('');

      lines.push('---');
      lines.push('');
    }
  }

  const outPath = path.join(codebaseDir, 'GUIDE.md');
  fs.mkdirSync(codebaseDir, { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n'));
  return { outPath };
}

// ── SUMMARY.md — 1-2 page quick overview ─────────────────────────────────────
function generateSummary(graph, summaries, legacyReport, codebaseDir) {
  const nodes    = graph.nodes;
  const allNodes = Object.entries(nodes).filter(([, n]) => !n.error);
  const stats    = graph.stats;

  // Categorise every file by role
  const entryPoints   = allNodes.filter(([, n]) => n.isEntryPoint);
  const uiFiles       = allNodes.filter(([f, n]) => ['SwiftUI View','iOS ViewController','UI component','React hook'].includes(classifyRole(f, n)));
  const serviceFiles  = allNodes.filter(([f, n]) => ['service','controller'].includes(classifyRole(f, n)));
  const dataModels    = allNodes.filter(([f, n]) => classifyRole(f, n) === 'data model');
  const configFiles   = allNodes.filter(([f, n]) => classifyRole(f, n) === 'config');
  const testFiles     = allNodes.filter(([f, n]) => classifyRole(f, n) === 'test file');
  const deadFiles     = allNodes.filter(([, n]) => n.importedBy.length === 0 && !n.isEntryPoint && !n.isBarrel);

  // Top 10 modules by import count (the core layer)
  const coreModules = [...allNodes]
    .filter(([, n]) => n.importedBy.length >= 2 && !n.isBarrel)
    .sort((a, b) => b[1].importedBy.length - a[1].importedBy.length)
    .slice(0, 10);

  // Language distribution sentence
  const langLine = Object.entries(stats.byLang || {})
    .sort((a, b) => b[1] - a[1])
    .map(([l, c]) => `${c} ${l}`)
    .join(', ');

  // Detect dominant framework/platform
  const frameworks = new Set(allNodes.map(([, n]) => n.meta?.framework).filter(Boolean));
  const platformNote = frameworks.size > 0
    ? `Built with ${[...frameworks].join(', ')}.`
    : '';

  const lines = [];

  // ── Header ─────────────────────────────────────────────────────────────────
  lines.push('# Codebase Summary');
  lines.push('');
  lines.push('> 1-2 page overview of the entire codebase. Read this first.');
  lines.push(`> Generated: ${new Date().toISOString()}`);
  lines.push('> For full detail per file see `GUIDE.md`. For technical depth see `MASTER.md`.');
  lines.push('');

  // ── At a glance ────────────────────────────────────────────────────────────
  lines.push('## At a glance');
  lines.push('');
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| Total files | **${stats.totalFiles}** |`);
  lines.push(`| Languages | ${langLine} |`);
  lines.push(`| Dependencies tracked | ${stats.totalEdges} import edges |`);
  lines.push(`| Screens / UI components | ${uiFiles.length} |`);
  lines.push(`| Services / controllers | ${serviceFiles.length} |`);
  lines.push(`| Data models | ${dataModels.length} |`);
  lines.push(`| Test files | ${testFiles.length} |`);
  lines.push(`| High-risk files | ${stats.highRiskFiles} |`);
  lines.push(`| Potential dead code | ${deadFiles.length} files |`);
  lines.push('');

  // ── What this codebase does ────────────────────────────────────────────────
  lines.push('## What this codebase does');
  lines.push('');
  const archSentence = inferArchitecture(allNodes, stats, frameworks);
  lines.push(archSentence);
  if (platformNote) lines.push(platformNote);
  lines.push('');

  // ── Where to start ─────────────────────────────────────────────────────────
  lines.push('## Where to start');
  lines.push('');
  if (entryPoints.length > 0) {
    lines.push('**Entry points — the app starts here:**');
    for (const [f] of entryPoints.slice(0, 5)) {
      const sum = summaries[f];
      lines.push(`- \`${f}\`${sum && !sum.startsWith('*') ? ` — ${sum}` : ''}`);
    }
    lines.push('');
  }

  if (coreModules.length > 0) {
    lines.push('**Core modules — used everywhere:**');
    for (const [f, n] of coreModules) {
      const sum = summaries[f];
      lines.push(`- \`${path.basename(f)}\` (${n.importedBy.length} consumers)${sum && !sum.startsWith('*') ? ` — ${sum}` : ''}`);
    }
    lines.push('');
  }

  // ── UI / Screens ───────────────────────────────────────────────────────────
  if (uiFiles.length > 0) {
    lines.push('## Screens and UI components');
    lines.push('');
    lines.push(`The app has **${uiFiles.length}** UI files:`);
    lines.push('');
    for (const [f, n] of uiFiles.slice(0, 20)) {
      const role = classifyRole(f, n);
      lines.push(`- \`${path.basename(f)}\` *(${role})*`);
    }
    if (uiFiles.length > 20) lines.push(`- ...and ${uiFiles.length - 20} more. See GUIDE.md for the full list.`);
    lines.push('');
  }

  // ── Services ───────────────────────────────────────────────────────────────
  if (serviceFiles.length > 0) {
    lines.push('## Services and business logic');
    lines.push('');
    lines.push(`The app has **${serviceFiles.length}** service/controller files:`);
    lines.push('');
    for (const [f, n] of serviceFiles.slice(0, 20)) {
      const role = classifyRole(f, n);
      const sum = summaries[f];
      lines.push(`- \`${path.basename(f)}\` *(${role})*${sum && !sum.startsWith('*') ? ` — ${sum}` : ''}`);
    }
    if (serviceFiles.length > 20) lines.push(`- ...and ${serviceFiles.length - 20} more.`);
    lines.push('');
  }

  // ── Data models ────────────────────────────────────────────────────────────
  if (dataModels.length > 0) {
    lines.push('## Data models');
    lines.push('');
    for (const [f] of dataModels.slice(0, 15)) {
      lines.push(`- \`${path.basename(f)}\``);
    }
    if (dataModels.length > 15) lines.push(`- ...and ${dataModels.length - 15} more.`);
    lines.push('');
  }

  // ── Things to know ────────────────────────────────────────────────────────
  const warnings = [];
  if (legacyReport?.dangerZones?.length > 0) {
    warnings.push(`**${legacyReport.dangerZones.length} danger zone${legacyReport.dangerZones.length !== 1 ? 's' : ''}** — files with high bug history. Don't touch without checking \`MASTER.md\` first: ${legacyReport.dangerZones.slice(0, 3).map(d => `\`${path.basename(d.file)}\``).join(', ')}.`);
  }
  if (legacyReport?.circularDeps?.length > 0) {
    warnings.push(`**${legacyReport.circularDeps.length} circular dependency chain${legacyReport.circularDeps.length !== 1 ? 's' : ''}** detected. See \`MASTER.md → Legacy health report\` for details.`);
  }
  if (legacyReport?.godFiles?.length > 0) {
    warnings.push(`**${legacyReport.godFiles.length} god file${legacyReport.godFiles.length !== 1 ? 's' : ''}** (doing too many things): ${legacyReport.godFiles.slice(0, 3).map(g => `\`${path.basename(g.file)}\``).join(', ')}.`);
  }
  if (deadFiles.length > 0) {
    warnings.push(`**${deadFiles.length} potentially unused file${deadFiles.length !== 1 ? 's' : ''}**. Run \`wednesday-skills dead\` to list them.`);
  }

  if (warnings.length > 0) {
    lines.push('## Things to know before making changes');
    lines.push('');
    for (const w of warnings) lines.push(`- ${w}`);
    lines.push('');
  }

  // ── Quick reference ────────────────────────────────────────────────────────
  lines.push('## Quick reference');
  lines.push('');
  lines.push('| Command | What it does |');
  lines.push('|---------|-------------|');
  lines.push('| `wednesday-skills blast <file>` | What breaks if you change this file |');
  lines.push('| `wednesday-skills score <file>` | Risk score before you edit |');
  lines.push('| `wednesday-skills dead` | List unused files |');
  lines.push('| `wednesday-skills trace <file>` | Call chain from this file |');
  lines.push('| `wednesday-skills map` | Re-run full analysis |');
  lines.push('');
  lines.push('---');
  lines.push('*Read `GUIDE.md` for per-file detail. Read `MASTER.md` for technical depth.*');

  const outPath = path.join(codebaseDir, 'SUMMARY.md');
  fs.mkdirSync(codebaseDir, { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n'));
  return { outPath };
}

function inferArchitecture(allNodes, stats, frameworks) {
  const total   = stats.totalFiles;
  const langs   = Object.entries(stats.byLang || {}).sort((a, b) => b[1] - a[1]);
  const topLang = langs[0]?.[0] || 'unknown';

  if (frameworks.has('SwiftUI') || frameworks.has('UIKit')) {
    const screenCount = allNodes.filter(([, n]) => n.meta?.isView || n.meta?.isViewController).length;
    return `This is an iOS app with ${total} Swift files and ${screenCount} screen${screenCount !== 1 ? 's' : ''}. It uses ${frameworks.has('SwiftUI') ? 'SwiftUI for the UI layer' : 'UIKit for the UI layer'}${frameworks.has('Combine') ? ' and Combine for reactive data flow' : ''}.`;
  }
  if (frameworks.has('React') || frameworks.has('Next.js')) {
    return `This is a ${frameworks.has('Next.js') ? 'Next.js' : 'React'} frontend with ${total} files. It is written in ${topLang}.`;
  }
  if (topLang === 'go') {
    return `This is a Go codebase with ${total} files. It likely implements a backend service or CLI tool.`;
  }
  if (frameworks.has('NestJS')) {
    return `This is a NestJS backend with ${total} files. It uses a modular controller/service/provider architecture.`;
  }

  const hasUI      = allNodes.some(([f]) => /component|page|screen|view/i.test(f));
  const hasService = allNodes.some(([f]) => /service|controller/i.test(f));
  if (hasUI && hasService) {
    return `This is a full-stack ${topLang} codebase with ${total} files, containing both UI components and backend services.`;
  }
  return `This codebase has ${total} ${topLang} files across ${Object.keys(stats.byLang || {}).length} language${Object.keys(stats.byLang || {}).length !== 1 ? 's' : ''}.`;
}

module.exports = { generateGuide, generateSummary };
