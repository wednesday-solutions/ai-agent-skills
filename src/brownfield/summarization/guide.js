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

// ── Package manifest readers ──────────────────────────────────────────────────
function readPackageJson(rootDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  } catch { return null; }
}

function readPackageSwift(rootDir) {
  try {
    const src = fs.readFileSync(path.join(rootDir, 'Package.swift'), 'utf8');
    const nameMatch = src.match(/name:\s*"([^"]+)"/);
    const deps = [...src.matchAll(/\.package\([^)]*url:\s*"[^"]*\/([^/"]+?)(?:\.git)?"\s*,/g)].map(m => m[1]);
    return { name: nameMatch?.[1], dependencies: deps };
  } catch { return null; }
}

function readPodfile(rootDir) {
  try {
    const src = fs.readFileSync(path.join(rootDir, 'Podfile'), 'utf8');
    const pods = [...src.matchAll(/pod\s+'([^']+)'/g)].map(m => m[1]);
    return { pods };
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
function buildTechStack(allNodes, pkgJson, podfile, pkgSwift, frameworks, stats) {
  const stack = { languages: [], frameworks: [], libraries: [], platform: null };

  // Languages
  const langs = Object.entries(stats.byLang || {}).sort((a, b) => b[1] - a[1]);
  for (const [l] of langs) stack.languages.push(l.charAt(0).toUpperCase() + l.slice(1));

  // Platform
  if (frameworks.has('SwiftUI') || frameworks.has('UIKit') || pkgSwift || podfile) {
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

  // CocoaPods / Swift packages for iOS
  if (podfile?.pods?.length) {
    stack.libraries.push(...podfile.pods.slice(0, 8));
  }
  if (pkgSwift?.dependencies?.length) {
    stack.libraries.push(...pkgSwift.dependencies.slice(0, 8));
  }

  return stack;
}

// ── Architecture layer description ────────────────────────────────────────────
function describeArchitecture(allNodes, frameworks, stats) {
  const layers = [];
  const files  = allNodes.map(([f]) => f.toLowerCase());

  const hasScreens  = files.some(f => /\/(screen|view|page|component)/.test(f));
  const hasServices = files.some(f => /service/.test(f));
  const hasModels   = files.some(f => /\/(model|schema|entit)/.test(f));
  const hasRoutes   = files.some(f => /route|router|controller/.test(f));
  const hasTests    = files.some(f => /\.test\.|\.spec\./.test(f));
  const hasHooks    = files.some(f => /\/hook|use[a-z]/.test(f));
  const hasGraphQL  = stats.byLang?.graphql > 0;
  const hasStore    = files.some(f => /store|redux|context/.test(f));

  if (frameworks.has('SwiftUI')) {
    layers.push('**UI layer** — SwiftUI Views with declarative layouts');
    if (allNodes.some(([, n]) => n.meta?.isObservableObject)) layers.push('**State layer** — ObservableObject ViewModels (MVVM pattern)');
    if (hasModels) layers.push('**Data layer** — Codable models for API responses');
    if (hasServices) layers.push('**Service layer** — networking and business logic services');
  } else if (frameworks.has('UIKit')) {
    layers.push('**UI layer** — UIKit ViewControllers');
    if (hasServices) layers.push('**Service layer** — business logic and networking');
    if (hasModels) layers.push('**Model layer** — data structures');
  } else {
    if (hasScreens)  layers.push('**UI layer** — ' + (hasHooks ? 'React components and custom hooks' : 'UI components and pages'));
    if (hasStore)    layers.push('**State layer** — shared application state management');
    if (hasServices) layers.push('**Service layer** — business logic, isolated from UI');
    if (hasRoutes)   layers.push('**API layer** — route handlers and controllers');
    if (hasGraphQL)  layers.push('**GraphQL layer** — schema definitions and resolvers');
    if (hasModels)   layers.push('**Data layer** — models and database schemas');
  }
  if (hasTests) layers.push('**Test layer** — automated tests');

  return layers;
}

// ── SUMMARY.md — PRD-style project overview ────────────────────────────────────
function generateSummary(graph, summaries, legacyReport, codebaseDir) {
  const rootDir  = graph.rootDir;
  const nodes    = graph.nodes;
  const allNodes = Object.entries(nodes).filter(([, n]) => !n.error);
  const stats    = graph.stats;

  // Read manifests
  const pkgJson  = readPackageJson(rootDir);
  const pkgSwift = readPackageSwift(rootDir);
  const podfile  = readPodfile(rootDir);

  // Core classifications
  const frameworks  = new Set(allNodes.map(([, n]) => n.meta?.framework).filter(Boolean));
  const entryPoints = allNodes.filter(([, n]) => n.isEntryPoint);
  const uiFiles     = allNodes.filter(([f, n]) => ['SwiftUI View','iOS ViewController','UI component','React hook','iOS ViewModel'].includes(classifyRole(f, n)));
  const serviceFiles= allNodes.filter(([f, n]) => ['service','controller'].includes(classifyRole(f, n)));
  const dataModels  = allNodes.filter(([f, n]) => classifyRole(f, n) === 'data model');
  const testFiles   = allNodes.filter(([f, n]) => classifyRole(f, n) === 'test file');
  const deadFiles   = allNodes.filter(([, n]) => n.importedBy.length === 0 && !n.isEntryPoint && !n.isBarrel);
  const coreModules = [...allNodes]
    .filter(([, n]) => n.importedBy.length >= 2 && !n.isBarrel)
    .sort((a, b) => b[1].importedBy.length - a[1].importedBy.length)
    .slice(0, 8);

  const techStack = buildTechStack(allNodes, pkgJson, podfile, pkgSwift, frameworks, stats);
  const features  = inferFeatures(allNodes);
  const archLayers= describeArchitecture(allNodes, frameworks, stats);

  // Project name: package.json > Package.swift > root dir name
  const projectName = pkgJson?.name || pkgSwift?.name || path.basename(rootDir);
  const projectDesc = pkgJson?.description || '';

  const lines = [];

  // ── Title ──────────────────────────────────────────────────────────────────
  lines.push(`# ${projectName} — Project Summary`);
  lines.push('');
  lines.push('> Auto-generated from codebase analysis. Read this to understand what this project is and how it works.');
  lines.push(`> Generated: ${new Date().toISOString()}`);
  lines.push('> For full module detail see `GUIDE.md`. For technical depth see `MASTER.md`.');
  lines.push('');

  // ── What this project is ───────────────────────────────────────────────────
  lines.push('## What this project is');
  lines.push('');
  if (projectDesc) {
    lines.push(projectDesc);
    lines.push('');
  }

  // Infer a narrative description from available signals
  const narrative = buildNarrative(projectName, allNodes, techStack, features, stats, frameworks);
  lines.push(narrative);
  lines.push('');

  // ── Tech stack ─────────────────────────────────────────────────────────────
  lines.push('## Tech stack');
  lines.push('');
  lines.push('| | |');
  lines.push('|---|---|');
  if (techStack.platform) lines.push(`| Platform | ${techStack.platform} |`);
  if (techStack.languages.length) lines.push(`| Languages | ${techStack.languages.join(', ')} |`);
  if (techStack.frameworks.length) lines.push(`| Frameworks | ${techStack.frameworks.join(', ')} |`);
  if (techStack.libraries.length) lines.push(`| Key libraries | ${techStack.libraries.join(', ')} |`);
  if (pkgJson?.version) lines.push(`| Version | ${pkgJson.version} |`);
  lines.push('');

  // ── Architecture ──────────────────────────────────────────────────────────
  if (archLayers.length > 0) {
    lines.push('## Architecture');
    lines.push('');
    lines.push('The codebase is structured in these layers:');
    lines.push('');
    for (const layer of archLayers) lines.push(`- ${layer}`);
    lines.push('');
    lines.push(`**Codebase size:** ${stats.totalFiles} files, ${stats.totalEdges} dependency edges`);
    lines.push('');
  }

  // ── Features / Domains ────────────────────────────────────────────────────
  const featureEntries = Object.entries(features);
  if (featureEntries.length > 0) {
    lines.push('## Features and functional areas');
    lines.push('');
    lines.push('The following feature domains were detected from file names:');
    lines.push('');
    for (const [domain, files] of featureEntries) {
      lines.push(`**${domain}**`);
      lines.push(`Files: ${files.slice(0, 6).map(f => `\`${f}\``).join(', ')}${files.length > 6 ? ` +${files.length - 6} more` : ''}`);
      lines.push('');
    }
  } else {
    // Fallback: list screens and services as features
    if (uiFiles.length > 0 || serviceFiles.length > 0) {
      lines.push('## Key modules by area');
      lines.push('');
      if (uiFiles.length > 0) {
        lines.push(`**Screens / UI (${uiFiles.length} files):**`);
        for (const [f, n] of uiFiles.slice(0, 12)) {
          lines.push(`- \`${path.basename(f)}\` *(${classifyRole(f, n)})*`);
        }
        if (uiFiles.length > 12) lines.push(`- ...and ${uiFiles.length - 12} more`);
        lines.push('');
      }
      if (serviceFiles.length > 0) {
        lines.push(`**Services / Logic (${serviceFiles.length} files):**`);
        for (const [f] of serviceFiles.slice(0, 12)) {
          const sum = summaries[f];
          lines.push(`- \`${path.basename(f)}\`${sum && !sum.startsWith('*') ? ` — ${sum}` : ''}`);
        }
        if (serviceFiles.length > 12) lines.push(`- ...and ${serviceFiles.length - 12} more`);
        lines.push('');
      }
    }
  }

  // ── Code health ───────────────────────────────────────────────────────────
  lines.push('## Code health');
  lines.push('');
  lines.push('| Metric | Value | Status |');
  lines.push('|--------|-------|--------|');
  lines.push(`| Test files | ${testFiles.length} | ${testFiles.length > 0 ? '✅' : '⚠️ no tests found'} |`);
  lines.push(`| High-risk files | ${stats.highRiskFiles} | ${stats.highRiskFiles === 0 ? '✅ none' : '⚠️ review before changing'} |`);
  lines.push(`| Circular deps | ${legacyReport?.circularDeps?.length || 0} | ${(legacyReport?.circularDeps?.length || 0) === 0 ? '✅ none' : '⚠️ see MASTER.md'} |`);
  lines.push(`| God files | ${legacyReport?.godFiles?.length || 0} | ${(legacyReport?.godFiles?.length || 0) === 0 ? '✅ none' : '⚠️ refactor candidates'} |`);
  lines.push(`| Danger zones | ${legacyReport?.dangerZones?.length || 0} | ${(legacyReport?.dangerZones?.length || 0) === 0 ? '✅ none' : '⚠️ see MASTER.md'} |`);
  lines.push(`| Potential dead code | ${deadFiles.length} files | ${deadFiles.length === 0 ? '✅ none' : 'ℹ️ run `wednesday-skills dead`'} |`);
  lines.push('');

  // ── Where to start (for new devs) ─────────────────────────────────────────
  lines.push('## Where to start (for new developers)');
  lines.push('');
  if (entryPoints.length > 0) {
    lines.push('**1. Entry points — the app starts here:**');
    for (const [f] of entryPoints.slice(0, 4)) lines.push(`   - \`${f}\``);
    lines.push('');
  }
  if (coreModules.length > 0) {
    lines.push('**2. Core modules — everything depends on these:**');
    for (const [f, n] of coreModules.slice(0, 6)) {
      const sum = summaries[f];
      lines.push(`   - \`${path.basename(f)}\` (${n.importedBy.length} consumers)${sum && !sum.startsWith('*') ? ` — ${sum}` : ''}`);
    }
    lines.push('');
  }
  if (legacyReport?.dangerZones?.length > 0) {
    lines.push('**3. Avoid these without context:**');
    for (const dz of legacyReport.dangerZones.slice(0, 3)) {
      lines.push(`   - \`${dz.file}\` — ${dz.reason}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('*Read `GUIDE.md` for per-file explanations. Read `MASTER.md` for full technical detail.*');

  const outPath = path.join(codebaseDir, 'SUMMARY.md');
  fs.mkdirSync(codebaseDir, { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n'));
  return { outPath };
}

function buildNarrative(name, allNodes, techStack, features, stats, frameworks) {
  const featureNames = Object.keys(features);
  const platform = techStack.platform || 'software project';
  const langStr  = techStack.languages.slice(0, 2).join(' and ') || 'unknown';

  let who = `**${name}** is a ${platform} built in ${langStr}`;

  if (featureNames.length >= 3) {
    const last = featureNames[featureNames.length - 1];
    const rest = featureNames.slice(0, -1).join(', ');
    who += `. It covers ${rest}, and ${last}.`;
  } else if (featureNames.length > 0) {
    who += `. It covers ${featureNames.join(' and ')}.`;
  } else {
    who += '.';
  }

  const uiCount = allNodes.filter(([, n]) => n.meta?.isView || n.meta?.isViewController ||
    /component|page|screen/i.test(allNodes.find(([f]) => f === n.file)?.[0] || '')).length;

  if (frameworks.has('SwiftUI') || frameworks.has('UIKit')) {
    who += ` The app has ${stats.totalFiles} source files.`;
  }

  return who;
}

module.exports = { generateGuide, generateSummary };
