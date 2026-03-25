/**
 * 2C-5 — GUIDE.md + SUMMARY.md generator
 * GUIDE.md: structural, no LLM required.
 * SUMMARY.md: LLM-powered narrative (Haiku via OpenRouter) — falls back to
 *             structural templates when OPENROUTER_API_KEY is not set.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { callLLM, hasApiKey } = require('../core/llm-client');

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
async function generateGuide(graph, summaries, codebaseDir, commentIntel = null) {
  const nodes    = graph.nodes;
  const allNodes = Object.entries(nodes).filter(([, n]) => !n.error);
  const byDir    = groupByDir(allNodes);

  // Build a lookup of comment intel per dir
  const commentByDir = new Map();
  if (commentIntel && commentIntel.modules) {
    for (const mod of commentIntel.modules) commentByDir.set(mod.dir, mod);
  }

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

    // Inject comment-intel module context if available
    const intel = commentByDir.get(dir);
    if (intel) {
      if (intel.purpose) {
        const debtBadge = intel.techDebt && intel.techDebt !== 'none' ? ` · **${intel.techDebt.toUpperCase()} TECH DEBT**` : '';
        const typeBadge = intel.isBizFeature === true ? ' · *business feature*' : intel.isBizFeature === false ? ' · *infrastructure*' : '';
        lines.push(`> ${intel.purpose}${debtBadge}${typeBadge}`);
        lines.push('');
      }
      if (intel.ideas && intel.ideas.length > 0) {
        lines.push('**Improvement ideas from comments:**');
        intel.ideas.forEach(idea => lines.push(`- ${idea}`));
        lines.push('');
      }
    }

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
// ── LLM narrative generator ───────────────────────────────────────────────────
async function callHaikuNarrative(context) {
  const system =
    'You write reverse PRD documents — detailed product and architecture documents that describe ' +
    'an existing codebase as if writing it up for a product team. Your writing is specific, clear, ' +
    'and professional. Never use generic phrases like "robust solution" or "leverages cutting-edge". ' +
    'Name actual things. Write in present tense.';

  const user =
    'Based on the codebase analysis below, write narrative sections for a reverse PRD.\n\n' +
    'Return a JSON object with exactly these keys:\n' +
    '- "product_overview": 3 paragraphs. Para 1: what this product is and what problem it solves. ' +
    'Para 2: who uses it and what they can do with it (name actual features from the list). ' +
    'Para 3: what makes this codebase notable (scale, architecture choice, platform).\n' +
    '- "architecture_narrative": 2 paragraphs describing the architecture. Para 1: the overall pattern ' +
    'and why it suits this product. Para 2: how the layers interact, what the key boundaries are.\n' +
    '- "feature_descriptions": an object where each key is a feature name from the features list, ' +
    'and the value is 2-3 sentences describing what it does for the user and how it is implemented.\n' +
    '- "data_flow": 1 paragraph describing how a typical user action flows from UI through services ' +
    'to data storage and back.\n' +
    '- "tech_choices": 1 paragraph explaining why the detected tech stack makes sense for this product.\n\n' +
    'Return ONLY valid JSON. No markdown fences.\n\n' +
    'CODEBASE ANALYSIS:\n' + JSON.stringify(context);

  const text = await callLLM({
    model: 'haiku',
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 2000,
    temperature: 0.3,
  }).catch(() => null);

  if (!text) return {};
  try {
    const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    return JSON.parse(clean);
  } catch { return {}; }
}

async function generateSummary(graph, summaries, legacyReport, codebaseDir, _apiKey, commentIntel = null) {
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
  const hookFiles   = allNodes.filter(([f, n]) => classifyRole(f, n) === 'React hook');
  const dataModels  = allNodes.filter(([f, n]) => classifyRole(f, n) === 'data model');
  const utilFiles   = allNodes.filter(([f, n]) => classifyRole(f, n) === 'utility');
  const configFiles = allNodes.filter(([f, n]) => classifyRole(f, n) === 'config');
  const routerFiles = allNodes.filter(([f, n]) => ['router','controller'].includes(classifyRole(f, n)));
  const testFiles   = allNodes.filter(([f, n]) => classifyRole(f, n) === 'test file');
  const deadFiles   = allNodes.filter(([, n]) => n.importedBy.length === 0 && !n.isEntryPoint && !n.isBarrel);
  const coreModules = [...allNodes]
    .filter(([, n]) => n.importedBy.length >= 2 && !n.isBarrel)
    .sort((a, b) => b[1].importedBy.length - a[1].importedBy.length);

  const techStack  = buildTechStack(allNodes, pkgJson, podfile, pkgSwift, frameworks, stats);
  const features   = inferFeatures(allNodes);
  const archLayers = describeArchitecture(allNodes, frameworks, stats);

  // Project name: package.json > Package.swift > root dir name
  const projectName = pkgJson?.name || pkgSwift?.name || path.basename(rootDir);
  const projectDesc = pkgJson?.description || '';

  // ── Helpers ────────────────────────────────────────────────────────────────

  // Return the best available description for a file
  function descFor(file, node) {
    const s = summaries[file];
    return (s && s.length > 20 && !s.startsWith('*')) ? s : purposeSentence(file, node);
  }

  // Collect all external package imports across all nodes, deduplicated
  function collectExternalPackages() {
    const pkgs = new Set();
    for (const [, node] of allNodes) {
      for (const imp of (node.imports || [])) {
        if (!imp.startsWith('.') && !nodes[imp]) {
          // Strip sub-paths: @scope/pkg/sub → @scope/pkg, pkg/sub → pkg
          const pkg = imp.startsWith('@')
            ? imp.split('/').slice(0, 2).join('/')
            : imp.split('/')[0];
          pkgs.add(pkg);
        }
      }
    }
    return [...pkgs].sort();
  }

  // Match a list of package names against a pattern and return matching ones
  function matchPkgs(pkgList, patterns) {
    return pkgList.filter(p => patterns.some(pat => p.toLowerCase().includes(pat)));
  }

  // Detect state management from imports and file names
  function detectStateManagement(pkgList, allFiles) {
    if (pkgList.includes('redux') || pkgList.includes('@reduxjs/toolkit') || allFiles.some(f => /slice|redux/.test(f))) return 'Redux';
    if (pkgList.includes('zustand')) return 'Zustand';
    if (pkgList.includes('mobx') || pkgList.includes('mobx-react')) return 'MobX';
    if (pkgList.includes('recoil')) return 'Recoil';
    if (pkgList.includes('jotai')) return 'Jotai';
    if (allFiles.some(f => /context/.test(f))) return 'React Context';
    return null;
  }

  // Detect data/ORM layer
  function detectDataLayer(pkgList) {
    if (pkgList.includes('prisma') || pkgList.includes('@prisma/client')) return 'Prisma';
    if (pkgList.includes('typeorm')) return 'TypeORM';
    if (pkgList.includes('mongoose')) return 'Mongoose (MongoDB)';
    if (pkgList.includes('sequelize')) return 'Sequelize';
    if (pkgList.some(p => p.includes('realm'))) return 'Realm';
    if (allNodes.some(([f]) => /coredata/i.test(f))) return 'Core Data';
    return null;
  }

  // Detect networking layer
  function detectNetworking(pkgList) {
    const found = [];
    if (pkgList.includes('axios')) found.push('axios');
    if (pkgList.some(p => /apollo/.test(p))) found.push('Apollo');
    if (pkgList.includes('swr')) found.push('SWR');
    if (pkgList.some(p => /react-query|tanstack/.test(p))) found.push('React Query');
    return found.length ? found.join(', ') : 'fetch';
  }

  // Detect test framework
  function detectTestFramework(pkgList) {
    const found = [];
    if (pkgList.includes('jest')) found.push('Jest');
    if (pkgList.includes('vitest')) found.push('Vitest');
    if (pkgList.includes('mocha')) found.push('Mocha');
    if (pkgList.includes('cypress')) found.push('Cypress');
    if (pkgList.includes('playwright') || pkgList.some(p => p.includes('playwright'))) found.push('Playwright');
    return found.length ? found.join(', ') : null;
  }

  // Detect auth libraries — ranked by how many files actually import each provider,
  // not just by presence in package.json. This avoids labelling a lightly-used
  // secondary package (e.g. Clerk for billing UI) as the primary auth provider.
  function detectAuth(pkgList) {
    const AUTH_PROVIDERS = [
      { label: 'Supabase Auth',  pattern: /@supabase\/supabase-js|supabase.*auth/i },
      { label: 'Auth0',          pattern: /auth0/i },
      { label: 'Clerk',          pattern: /@clerk\//i },
      { label: 'Firebase Auth',  pattern: /firebase.*auth|@firebase\/auth/i },
      { label: 'Cognito',        pattern: /cognito|amazon-cognito/i },
      { label: 'NextAuth',       pattern: /next-auth/i },
      { label: 'Passport',       pattern: /^passport$/i },
    ];

    // Count graph nodes that import each provider
    const scores = AUTH_PROVIDERS.map(provider => {
      const usageCount = allNodes.filter(([, n]) =>
        (n.imports || []).some(imp => provider.pattern.test(imp))
      ).length;
      const installed = pkgList.some(p => provider.pattern.test(p));
      return { label: provider.label, usageCount, installed };
    }).filter(e => e.installed || e.usageCount > 0);

    if (scores.length === 0) return null;

    // Sort: primary provider = highest usage count, break ties by installed flag
    scores.sort((a, b) => b.usageCount - a.usageCount || (b.installed ? 1 : 0));
    return scores.map(s => s.label).join(', ');
  }

  // Detect architecture pattern
  function detectArchPattern() {
    const allFiles = allNodes.map(([f]) => f.toLowerCase());
    const nestEdges = allNodes.some(([, n]) => n.meta?.isProvider || n.meta?.isController);
    if (nestEdges) return 'Dependency Injection (NestJS)';
    if (allFiles.some(f => /slice|\.store\./.test(f))) return 'Redux / flux (feature slices)';
    if (allNodes.some(([, n]) => n.meta?.isObservableObject)) return 'MVVM (ObservableObject)';
    if (allFiles.some(f => /viewmodel/i.test(f))) return 'MVVM';
    if (allFiles.some(f => /context/.test(f)) && frameworks.has('React')) return 'Context API / component-driven';
    if (allFiles.some(f => /controller/.test(f)) && allFiles.some(f => /model/.test(f))) return 'MVC';
    if (allFiles.some(f => /service/.test(f))) return 'Layered / service-oriented';
    return 'Modular';
  }

  const allFileNames  = allNodes.map(([f]) => f.toLowerCase());
  const externalPkgs  = collectExternalPackages();
  const stateMgmt     = detectStateManagement(externalPkgs, allFileNames);
  const dataLayer     = detectDataLayer(externalPkgs);
  const networking    = detectNetworking(externalPkgs);
  const authDetected  = detectAuth(externalPkgs);
  const testFramework = detectTestFramework(externalPkgs);
  const archPattern   = detectArchPattern();

  // Third-party integration buckets
  const integrations = {
    'Payment':       matchPkgs(externalPkgs, ['stripe', 'razorpay', 'braintree', 'paypal']),
    'Analytics':     matchPkgs(externalPkgs, ['segment', 'mixpanel', 'amplitude', 'firebase', 'posthog', 'gtag']),
    'Messaging/Push':matchPkgs(externalPkgs, ['twilio', 'sendgrid', 'mailgun', 'onesignal', 'apns', 'fcm', 'firebase-messaging']),
    'Storage':       matchPkgs(externalPkgs, ['s3', 'cloudinary', 'uploadcare', 'supabase-storage']),
    'Auth':          matchPkgs(externalPkgs, ['auth0', 'clerk', 'firebase-auth', 'cognito', 'passport']),
    'Maps':          matchPkgs(externalPkgs, ['google-maps', 'mapbox', 'mapkit']),
    'Monitoring':    matchPkgs(externalPkgs, ['sentry', 'datadog', 'bugsnag', 'crashlytics']),
    'Real-time':     matchPkgs(externalPkgs, ['socket.io', 'ws', 'pusher', 'ably']),
    'CMS/Backend':   matchPkgs(externalPkgs, ['supabase', 'firebase', 'appwrite', 'hasura']),
  };

  // Files WITH test coverage: files that have a corresponding .test./.spec. file
  const testedFiles = allNodes
    .filter(([f]) => {
      const base = path.basename(f, path.extname(f)).replace(/\.(test|spec)$/, '');
      return testFiles.some(([tf]) => path.basename(tf, path.extname(tf)).replace(/\.(test|spec)$/, '') === base && tf !== f);
    })
    .map(([f]) => f);

  // High-risk files (score > 60)
  const highRiskNodes = allNodes
    .filter(([, n]) => (n.riskScore || 0) > 60)
    .sort((a, b) => b[1].riskScore - a[1].riskScore);

  // ── LLM narrative (single Haiku call) ────────────────────────────────────
  let llm = {};
  if (hasApiKey()) {
    const llmContext = {
      project:      projectName,
      description:  projectDesc,
      platform:     techStack.platform,
      languages:    techStack.languages,
      frameworks:   techStack.frameworks,
      libraries:    techStack.libraries.slice(0, 20),
      features:     Object.keys(features),
      archPattern,
      archLayers,
      coreModules:  coreModules.slice(0, 8).map(([f, n]) => ({ file: path.basename(f), consumers: n.importedBy.length })),
      screenCount:  uiFiles.length,
      serviceCount: serviceFiles.length,
      modelCount:   dataModels.length,
      totalFiles:   stats.totalFiles,
      stateManagement: stateMgmt,
      dataLayer,
      networking,
    };
    llm = await callHaikuNarrative(llmContext);
  }

  const lines = [];

  // ── 1. Title ──────────────────────────────────────────────────────────────
  lines.push(`# ${projectName} — Product & Architecture Document`);
  lines.push('');
  if (projectDesc) {
    lines.push(`> ${projectDesc}`);
    lines.push('');
  }
  lines.push(`> Auto-generated reverse PRD from static analysis. Generated: ${new Date().toISOString()}`);
  lines.push('');

  // ── Section 1: Product Overview ───────────────────────────────────────────
  lines.push('## 1. Product Overview');
  lines.push('');

  // Prefer comment-intel reverse PRD (built from actual developer comments) over LLM code analysis
  const narrative = commentIntel?.reversePrd
    || llm.product_overview
    || buildNarrative(projectName, techStack, features, stats, frameworks);
  lines.push(narrative);
  lines.push('');

  // Platform and audience
  const platform = techStack.platform || 'software project';
  let audience = 'end users';
  if (/backend|api|nestjs|go/i.test(platform)) audience = 'backend consumers and API clients';
  else if (/cli/i.test(platform)) audience = 'developers using the command line';
  else if (/ios/i.test(platform)) audience = 'iOS users';
  else if (/android/i.test(platform)) audience = 'Android users';
  else if (/react native/i.test(platform)) audience = 'iOS and Android users';
  else if (/web/i.test(platform)) audience = 'web users';
  lines.push(`**Platform:** ${platform}`);
  lines.push(`**Audience:** ${audience}`);
  if (pkgJson?.version) lines.push(`**Version:** ${pkgJson.version}`);
  lines.push(`**Repo:** ${path.basename(rootDir)}`);
  lines.push('');

  // ── Section 2: Tech Stack ─────────────────────────────────────────────────
  lines.push('## 2. Tech Stack');
  lines.push('');
  lines.push('| Dimension | Details |');
  lines.push('|-----------|---------|');
  if (techStack.platform)       lines.push(`| Platform | ${techStack.platform} |`);
  if (techStack.languages.length) lines.push(`| Languages | ${techStack.languages.join(', ')} |`);
  if (techStack.frameworks.length) lines.push(`| UI Framework | ${techStack.frameworks.join(', ')} |`);
  if (stateMgmt)                lines.push(`| State Management | ${stateMgmt} |`);
  if (dataLayer)                lines.push(`| Data Layer | ${dataLayer} |`);
  if (networking)               lines.push(`| Networking | ${networking} |`);
  if (authDetected)             lines.push(`| Auth | ${authDetected} |`);
  if (testFramework)            lines.push(`| Testing | ${testFramework} |`);
  if (pkgJson?.version)         lines.push(`| Version | ${pkgJson.version} |`);
  lines.push('');

  // CI/CD hints
  const ciFiles = allNodes
    .filter(([f]) => /\.github\/workflows|\.circleci|\.gitlab-ci|jenkinsfile|bitrise/i.test(f))
    .map(([f]) => path.basename(f));
  if (ciFiles.length > 0) {
    lines.push(`**CI/CD:** Workflow files detected: ${ciFiles.map(f => `\`${f}\``).join(', ')}`);
    lines.push('');
  }

  // Third-party integrations
  lines.push('### Third-Party Integrations');
  lines.push('');
  let hasAnyIntegration = false;
  const integrationDescriptions = {
    'Payment':       'payment processing',
    'Analytics':     'analytics and event tracking',
    'Messaging/Push':'messaging and push notifications',
    'Storage':       'file and media storage',
    'Auth':          'authentication and identity',
    'Maps':          'maps and location services',
    'Monitoring':    'error monitoring and observability',
    'Real-time':     'real-time communication',
    'CMS/Backend':   'backend-as-a-service / CMS',
  };
  for (const [category, pkgs] of Object.entries(integrations)) {
    if (pkgs.length > 0) {
      hasAnyIntegration = true;
      lines.push(`- **${category}** (${integrationDescriptions[category]}): ${pkgs.join(', ')}`);
    }
  }
  if (!hasAnyIntegration) {
    lines.push('No well-known third-party integrations detected from import analysis.');
  }
  lines.push('');

  // Tech choices narrative
  if (llm.tech_choices) {
    lines.push('### Why This Stack');
    lines.push('');
    lines.push(llm.tech_choices);
    lines.push('');
  }

  // ── Section 3: Architecture ───────────────────────────────────────────────
  lines.push('## 3. Architecture');
  lines.push('');
  lines.push(`**Pattern:** ${archPattern}`);
  lines.push('');
  if (llm.architecture_narrative) {
    lines.push(llm.architecture_narrative);
  } else {
    lines.push(
      `This codebase comprises **${stats.totalFiles} files** connected by **${stats.totalEdges} dependency edges**. ` +
      `The overall architecture follows a ${archPattern} approach. ` +
      (archLayers.length > 0
        ? `The codebase is structured in ${archLayers.length} identifiable layer${archLayers.length !== 1 ? 's' : ''}.`
        : 'No strong layer separation was detected.')
    );
  }
  lines.push('');

  if (archLayers.length > 0) {
    lines.push('**Architecture layers:**');
    lines.push('');
    for (const layer of archLayers) lines.push(`- ${layer}`);
    lines.push('');
  }

  // Key design patterns
  const patterns = [];
  if (allNodes.some(([, n]) => n.meta?.isProvider)) patterns.push('Dependency Injection — NestJS providers with constructor injection');
  if (allNodes.some(([f]) => /event.*emitter|eventemitter/i.test(f))) patterns.push('Observer — EventEmitter pattern for decoupled messaging');
  if (allNodes.some(([f]) => /factory/i.test(f))) patterns.push('Factory — factory files detected');
  if (serviceFiles.filter(([, n]) => n.importedBy.length === 0 && !n.isEntryPoint).length > 0) patterns.push('Singleton — service files with no importers (likely singletons loaded at startup)');
  if (patterns.length > 0) {
    lines.push('**Key design patterns detected:**');
    lines.push('');
    for (const p of patterns) lines.push(`- ${p}`);
    lines.push('');
  }

  // Directory structure overview
  lines.push('**Directory structure:**');
  lines.push('');
  const byDir = groupByDir(allNodes);
  for (const [dir, dirNodes] of Object.entries(byDir).sort()) {
    const roles = dirNodes.map(([f, n]) => classifyRole(f, n));
    const roleCount = {};
    for (const r of roles) roleCount[r] = (roleCount[r] || 0) + 1;
    const dominant = Object.entries(roleCount).sort((a, b) => b[1] - a[1]).map(([r]) => r);
    const desc = dominant.slice(0, 3).join(', ');
    lines.push(`- \`${dir}/\` — ${dirNodes.length} file${dirNodes.length !== 1 ? 's' : ''}: ${desc}`);
  }
  lines.push('');

  // ── Section 4: Feature Inventory ─────────────────────────────────────────
  lines.push('## 4. Feature Inventory');
  lines.push('');

  const featureEntries = Object.entries(features);
  if (featureEntries.length > 0) {
    for (const [domain] of featureEntries) {
      lines.push(`### ${domain}`);
      lines.push('');

      // Domain description — LLM first, structural fallback
      const domainLower = domain.toLowerCase();
      let domainDesc = llm.feature_descriptions?.[domain];
      if (!domainDesc) {
        if (/auth/i.test(domainLower))               domainDesc = `Manages user identity: sign-in, sign-up, token handling, and session lifecycle. All authentication flows and credential verification live here.`;
        else if (/user|profile/i.test(domainLower))  domainDesc = `Handles user accounts, profile data, settings, and preferences. This domain owns anything that represents a specific user's identity and configuration.`;
        else if (/payment|billing/i.test(domainLower)) domainDesc = `Manages payment flows, billing cycles, and purchase transactions. Integrates with payment processors and tracks order/invoice state.`;
        else if (/notif/i.test(domainLower))         domainDesc = `Delivers push notifications, in-app alerts, and badge management. Coordinates with APNS, FCM, or similar services.`;
        else if (/onboard/i.test(domainLower))       domainDesc = `Guides new users through the initial setup experience: splash screens, walkthroughs, and first-run flows.`;
        else if (/search/i.test(domainLower))        domainDesc = `Provides search, filtering, and sort capabilities across content. Handles query input, results rendering, and filter state.`;
        else if (/chat|message/i.test(domainLower))  domainDesc = `Powers real-time and async messaging: threads, conversations, and inboxes. Manages message state and delivery status.`;
        else if (/media|camera/i.test(domainLower))  domainDesc = `Handles media capture, playback, gallery browsing, and uploads. Manages permissions and processing pipelines for photos and video.`;
        else if (/map|location/i.test(domainLower))  domainDesc = `Integrates maps, geolocation, and proximity features. Manages coordinate data and map rendering.`;
        else if (/analytics/i.test(domainLower))     domainDesc = `Tracks user events, screen views, and behavioural signals. Forwards data to analytics platforms.`;
        else if (/api|network/i.test(domainLower))   domainDesc = `Owns all HTTP/API communication: request building, response parsing, error handling, and retry logic.`;
        else if (/storage|database/i.test(domainLower)) domainDesc = `Manages local and remote data persistence: caching, database reads/writes, and data lifecycle.`;
        else if (/admin/i.test(domainLower))         domainDesc = `Provides back-office tools for content management, user administration, and operational configuration.`;
        else if (/home|dashboard/i.test(domainLower)) domainDesc = `The landing experience after login: aggregates content and surfaces key actions for the user's primary workflow.`;
        else domainDesc = `The ${domain} domain handles all functionality related to ${domainLower} in the application.`;
      }
      lines.push(domainDesc);
      lines.push('');

      // Files in this domain (match against allNodes by base name)
      const domainPattern = DOMAIN_PATTERNS.find(dp => dp.domain === domain)?.patterns;
      const domainFiles = domainPattern
        ? allNodes.filter(([f]) => domainPattern.test(path.basename(f, path.extname(f)).toLowerCase()) || domainPattern.test(f))
        : [];

      if (domainFiles.length > 0) {
        lines.push('**Files in this domain:**');
        lines.push('');
        for (const [f, n] of domainFiles) {
          const role = classifyRole(f, n);
          const desc2 = descFor(f, n);
          lines.push(`- \`${f}\` *(${role})* — ${desc2}`);
        }
        lines.push('');

        // Key exports
        const allExports = domainFiles.flatMap(([, n]) => n.exports || []);
        if (allExports.length > 0) {
          lines.push('**Key exports:**');
          lines.push('');
          for (const exp of [...new Set(allExports)]) lines.push(`- \`${exp}\``);
          lines.push('');
        }

        // Dependencies between these files
        const domainFileSet = new Set(domainFiles.map(([f]) => f));
        const intraDeps = [];
        for (const [f, n] of domainFiles) {
          const internal = (n.imports || []).filter(imp => domainFileSet.has(imp));
          if (internal.length > 0) {
            intraDeps.push(`- \`${path.basename(f)}\` imports ${internal.map(i => `\`${path.basename(i)}\``).join(', ')}`);
          }
        }
        if (intraDeps.length > 0) {
          lines.push('**Intra-domain dependencies:**');
          lines.push('');
          for (const d of intraDeps) lines.push(d);
          lines.push('');
        }
      }
    }
  } else {
    // Fallback grouping when no domains detected
    lines.push('No feature domains were detected from file names. Files grouped by role below.');
    lines.push('');

    const fallbackGroups = [
      { label: 'Screens / Views', files: uiFiles },
      { label: 'Services', files: serviceFiles },
      { label: 'Custom Hooks', files: hookFiles },
      { label: 'Models', files: dataModels },
      { label: 'Utils', files: utilFiles },
      { label: 'Config', files: configFiles },
    ];
    for (const { label, files: groupFiles } of fallbackGroups) {
      if (groupFiles.length === 0) continue;
      lines.push(`### ${label}`);
      lines.push('');
      for (const [f, n] of groupFiles) {
        lines.push(`- \`${f}\` — ${descFor(f, n)}`);
      }
      lines.push('');
    }
  }

  // ── Section 5: Module Inventory ───────────────────────────────────────────
  lines.push('## 5. Module Inventory');
  lines.push('');

  // Screens / Views / Components
  if (uiFiles.length > 0) {
    lines.push('### Screens / Views / Components');
    lines.push('');
    for (const [f, n] of uiFiles) {
      const role = classifyRole(f, n);
      const desc2 = descFor(f, n);
      const exps = (n.exports || []).join(', ') || '—';
      lines.push(`- \`${path.basename(f)}\` *(${role})* — ${desc2} — exports: ${exps} — imported by ${n.importedBy.length} file${n.importedBy.length !== 1 ? 's' : ''}`);
    }
    lines.push('');
  }

  // Services & Business Logic
  if (serviceFiles.length > 0) {
    lines.push('### Services & Business Logic');
    lines.push('');
    for (const [f, n] of serviceFiles) {
      const desc2 = descFor(f, n);
      const exps = (n.exports || []).join(', ') || '—';
      lines.push(`- \`${path.basename(f)}\` — ${desc2} — exports: ${exps} — used by ${n.importedBy.length} file${n.importedBy.length !== 1 ? 's' : ''}`);
    }
    lines.push('');
  }

  // Custom Hooks (React)
  if (hookFiles.length > 0) {
    lines.push('### Custom Hooks (React)');
    lines.push('');
    for (const [f, n] of hookFiles) {
      const desc2 = descFor(f, n);
      lines.push(`- \`${path.basename(f)}\` — ${desc2}`);
    }
    lines.push('');
  }

  // Data Models & Schemas
  if (dataModels.length > 0) {
    lines.push('### Data Models & Schemas');
    lines.push('');
    for (const [f, n] of dataModels) {
      const exps = (n.exports || []).join(', ') || '—';
      lines.push(`- \`${path.basename(f)}\` — exports: ${exps}`);
    }
    lines.push('');
  }

  // Utility Libraries
  if (utilFiles.length > 0) {
    lines.push('### Utility Libraries');
    lines.push('');
    for (const [f, n] of utilFiles) {
      const desc2 = descFor(f, n);
      lines.push(`- \`${path.basename(f)}\` — ${desc2}`);
    }
    lines.push('');
  }

  // Configuration
  if (configFiles.length > 0) {
    lines.push('### Configuration');
    lines.push('');
    for (const [f, n] of configFiles) {
      const desc2 = descFor(f, n);
      lines.push(`- \`${path.basename(f)}\` — ${desc2}`);
    }
    lines.push('');
  }

  // API / Routes / Controllers
  if (routerFiles.length > 0) {
    lines.push('### API / Routes / Controllers');
    lines.push('');
    for (const [f, n] of routerFiles) {
      const desc2 = descFor(f, n);
      const exps = (n.exports || []).join(', ') || '—';
      lines.push(`- \`${path.basename(f)}\` — ${desc2} — handlers/routes: ${exps}`);
    }
    lines.push('');
  }

  // ── Section 6: Data Flow ──────────────────────────────────────────────────
  lines.push('## 6. Data Flow');
  lines.push('');

  if (llm.data_flow) {
    lines.push(llm.data_flow);
    lines.push('');
  }

  if (coreModules.length > 0) {
    const [topFile, topNode] = coreModules[0];
    lines.push(`The most widely consumed module is \`${path.basename(topFile)}\` (imported by ${topNode.importedBy.length} files). ` +
      `It acts as the central hub from which dependent modules draw their core functionality.`);
    lines.push('');

    if ((topNode.imports || []).length > 0) {
      lines.push(`\`${path.basename(topFile)}\` itself depends on: ${topNode.imports.map(i => `\`${path.basename(i)}\``).join(', ')}.`);
      lines.push('');
    }

    if (topNode.importedBy.length > 0) {
      lines.push(`Modules that consume \`${path.basename(topFile)}\`:`);
      for (const imp of topNode.importedBy) lines.push(`- \`${path.basename(imp)}\``);
      lines.push('');
    }
  } else {
    lines.push('No highly-shared core modules detected. The graph may be shallow or mostly linear.');
    lines.push('');
  }

  if (entryPoints.length > 0) {
    lines.push(`**Entry → execution path:** The application starts at ${entryPoints.map(([f]) => `\`${path.basename(f)}\``).join(', ')}. ` +
      `From there, initialisation flows into the core modules listed above.`);
    lines.push('');
  }

  if (stateMgmt) {
    lines.push(`**State management:** The application uses ${stateMgmt}. State flows from stores/slices down into components via selectors or hooks.`);
    lines.push('');
  }

  if (dataLayer) {
    lines.push(`**Database access:** ${dataLayer} is used for data persistence. Models and schema definitions translate between application objects and the database.`);
    lines.push('');
  }

  if (networking !== 'fetch') {
    lines.push(`**API calls:** Networking is handled via ${networking}. API calls originate from service files and results flow up to state or directly into components.`);
    lines.push('');
  }

  // ── Section 7: Testing Coverage ───────────────────────────────────────────
  lines.push('## 7. Testing Coverage');
  lines.push('');
  lines.push(`**Total test files:** ${testFiles.length}`);
  lines.push(`**Test framework detected:** ${testFramework || 'none detected'}`);
  lines.push('');

  if (testedFiles.length > 0) {
    lines.push('**Files WITH test coverage:**');
    lines.push('');
    for (const f of testedFiles) lines.push(`- \`${f}\``);
    lines.push('');
  }

  const highRiskUntested = highRiskNodes.filter(([f]) => !testedFiles.includes(f));
  if (highRiskUntested.length > 0) {
    lines.push('**High-risk files WITHOUT test coverage:**');
    lines.push('');
    for (const [f, n] of highRiskUntested) {
      lines.push(`- \`${f}\` — risk score ${n.riskScore}/100`);
    }
    lines.push('');
  }

  // ── Section 8: Code Health & Technical Debt ───────────────────────────────
  lines.push('## 8. Code Health & Technical Debt');
  lines.push('');

  // Danger zones
  lines.push('### Danger Zones');
  lines.push('');
  const dangerZones = legacyReport?.dangerZones || [];
  if (dangerZones.length > 0) {
    for (const dz of dangerZones) {
      lines.push(`#### \`${dz.file}\``);
      lines.push(`- **Reason:** ${dz.reason}`);
      if (dz.authors) lines.push(`- **Authors:** ${Array.isArray(dz.authors) ? dz.authors.join(', ') : dz.authors}`);
      if (dz.age) lines.push(`- **Age:** ${dz.age}`);
      lines.push(`- **Recommendation:** Approach with caution. Ensure test coverage exists before modifying.`);
      lines.push('');
    }
  } else {
    lines.push('No danger zones detected.');
    lines.push('');
  }

  // God files
  lines.push('### God Files');
  lines.push('');
  const godFiles = legacyReport?.godFiles || [];
  if (godFiles.length > 0) {
    for (const gf of godFiles) {
      const exportCount = typeof gf === 'object' ? (gf.exportCount || gf.exports || '?') : '?';
      const fileName = typeof gf === 'object' ? gf.file : gf;
      lines.push(`#### \`${fileName}\``);
      lines.push(`- **Export count:** ${exportCount}`);
      lines.push(`- **What it does:** ${descFor(fileName, nodes[fileName] || { exports: [], importedBy: [] })}`);
      lines.push(`- **Recommendation:** Split into smaller, focused modules by domain or responsibility.`);
      lines.push('');
    }
  } else {
    lines.push('No god files detected.');
    lines.push('');
  }

  // Circular dependencies
  lines.push('### Circular Dependencies');
  lines.push('');
  const circularDeps = legacyReport?.circularDeps || [];
  if (circularDeps.length > 0) {
    for (const cycle of circularDeps) {
      const chain = Array.isArray(cycle) ? cycle.join(' → ') : (cycle.chain || JSON.stringify(cycle));
      const domains = Array.isArray(cycle)
        ? [...new Set(cycle.flatMap(f => featureEntries.filter(([, files]) => files.includes(path.basename(f, path.extname(f)).toLowerCase())).map(([d]) => d)))].join(', ')
        : '';
      lines.push(`- **Cycle:** ${chain}`);
      if (domains) lines.push(`  - **Entangled domains:** ${domains}`);
      lines.push(`  - **Risk:** High — circular imports can cause initialisation failures and make refactoring difficult.`);
    }
    lines.push('');
  } else {
    lines.push('No circular dependencies detected.');
    lines.push('');
  }

  // High-risk files table
  lines.push('### High-Risk Files (score > 60)');
  lines.push('');
  if (highRiskNodes.length > 0) {
    lines.push('| File | Risk Score | Dependents | Last Author | Recommendation |');
    lines.push('|------|-----------|------------|-------------|----------------|');
    for (const [f, n] of highRiskNodes) {
      const lastAuthor = n.meta?.gitHistory?.lastAuthor || '—';
      lines.push(`| \`${path.basename(f)}\` | ${n.riskScore}/100 | ${n.importedBy.length} | ${lastAuthor} | Review and add tests before modifying |`);
    }
    lines.push('');
  } else {
    lines.push('No files with risk score above 60.');
    lines.push('');
  }

  // Dead code candidates
  lines.push('### Dead Code Candidates');
  lines.push('');
  if (deadFiles.length > 0) {
    for (const [f, n] of deadFiles) {
      const reason = n.gaps && n.gaps.length > 0
        ? `0 static importers; has ${n.gaps.length} dynamic pattern(s) that may reference it`
        : '0 static importers and is not an entry point or barrel';
      lines.push(`- \`${f}\` — ${reason}`);
    }
    lines.push('');
  } else {
    lines.push('No dead code candidates detected.');
    lines.push('');
  }

  // Coverage gaps (dynamic patterns)
  lines.push('### Coverage Gaps (Dynamic Patterns)');
  lines.push('');
  const gapFiles = allNodes.filter(([, n]) => n.gaps && n.gaps.length > 0);
  if (gapFiles.length > 0) {
    for (const [f, n] of gapFiles) {
      lines.push(`- \`${f}\` — ${n.gaps.length} dynamic pattern${n.gaps.length !== 1 ? 's' : ''}: ${n.gaps.join(', ')}`);
    }
    lines.push('');
  } else {
    lines.push('No dynamic import patterns detected that could not be statically resolved.');
    lines.push('');
  }

  // ── Section 9: Onboarding Guide ───────────────────────────────────────────
  lines.push('## 9. Onboarding Guide (New Developer Path)');
  lines.push('');

  lines.push('**Step 1 — Read the entry points first:**');
  lines.push('');
  if (entryPoints.length > 0) {
    for (const [f] of entryPoints) lines.push(`- \`${f}\``);
  } else {
    lines.push('- No explicit entry points detected. Start with the file that has the most dependents.');
  }
  lines.push('');

  lines.push('**Step 2 — Understand the core modules (most imported):**');
  lines.push('');
  if (coreModules.length > 0) {
    for (const [f, n] of coreModules.slice(0, 5)) {
      lines.push(`- \`${f}\` (${n.importedBy.length} consumers) — ${descFor(f, n)}`);
    }
  } else {
    lines.push('- No highly-shared core modules detected.');
  }
  lines.push('');

  lines.push('**Step 3 — Learn the data models:**');
  lines.push('');
  if (dataModels.length > 0) {
    for (const [f] of dataModels) lines.push(`- \`${f}\``);
  } else {
    lines.push('- No data model files detected. Look in service or config files for type definitions.');
  }
  lines.push('');

  lines.push('**Step 4 — The most important service to understand:**');
  lines.push('');
  const topService = serviceFiles.sort((a, b) => b[1].importedBy.length - a[1].importedBy.length)[0];
  if (topService) {
    lines.push(`- \`${topService[0]}\` — ${descFor(topService[0], topService[1])}`);
  } else {
    lines.push('- No service files detected.');
  }
  lines.push('');

  lines.push('**Step 5 — Avoid these until you are familiar:**');
  lines.push('');
  if (dangerZones.length > 0) {
    for (const dz of dangerZones) lines.push(`- \`${dz.file}\` — ${dz.reason}`);
  } else if (highRiskNodes.length > 0) {
    for (const [f, n] of highRiskNodes.slice(0, 3)) lines.push(`- \`${f}\` — risk score ${n.riskScore}/100`);
  } else {
    lines.push('- No specific files flagged. Apply standard caution to service and data layer files.');
  }
  lines.push('');

  // ── Section 10: Quick Reference ───────────────────────────────────────────
  lines.push('## 10. Quick Reference');
  lines.push('');
  lines.push('| Command | Purpose |');
  lines.push('|---------|---------|');

  if (pkgJson?.scripts) {
    for (const [scriptName, scriptCmd] of Object.entries(pkgJson.scripts).slice(0, 20)) {
      lines.push(`| \`npm run ${scriptName}\` | ${scriptCmd} |`);
    }
  } else {
    lines.push('| — | No package.json scripts detected |');
  }
  lines.push('');

  lines.push('---');
  lines.push('*Read `GUIDE.md` for per-file explanations. Read `MASTER.md` for full technical detail.*');

  const outPath = path.join(codebaseDir, 'SUMMARY.md');
  fs.mkdirSync(codebaseDir, { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n'));
  return { outPath };
}

function buildNarrative(name, techStack, features, stats, frameworks) {
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

  if (frameworks.has('SwiftUI') || frameworks.has('UIKit')) {
    who += ` The app has ${stats.totalFiles} source files.`;
  }

  return who;
}

module.exports = { generateGuide, generateSummary };
