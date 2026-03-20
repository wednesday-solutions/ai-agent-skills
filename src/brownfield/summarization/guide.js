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
async function generateGuide(graph, summaries, codebaseDir) {
  const nodes    = graph.nodes;
  const allNodes = Object.entries(nodes).filter(([, n]) => !n.error);

  const lines = [];

  lines.push('# Codebase Guide');
  lines.push('');
  lines.push('> What every module does — explained in plain English.');
  lines.push('> Read this if you\'re new to the project or need a quick refresher.');
  lines.push(`> Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('**How to use this file:**');
  lines.push('- Non-technical readers: read the paragraph under each module name.');
  lines.push('- Engineers: the **Functions** section lists what each export does.');
  lines.push('- Ask your AI assistant "explain `<filename>`" for deeper context — it reads this file.');
  lines.push('');
  lines.push('---');
  lines.push('');

  // Group by directory
  const byDir = {};
  for (const [file, node] of allNodes) {
    const dir = path.dirname(file) === '.' ? '(root)' : path.dirname(file);
    byDir[dir] = byDir[dir] || [];
    byDir[dir].push([file, node]);
  }

  for (const [dir, dirNodes] of Object.entries(byDir).sort()) {
    lines.push(`## 📁 \`${dir}/\``);
    lines.push('');

    // Sort by most-imported first so important files appear at the top
    for (const [file, node] of dirNodes.sort((a, b) => b[1].importedBy.length - a[1].importedBy.length)) {
      const name = path.basename(file);
      const role = classifyRole(file, node);

      lines.push(`### ${name}`);
      lines.push(`\`${file}\` · *${role}*`);
      lines.push('');

      // Plain-English paragraph (2 sentences — purpose + usage)
      const purpose = summaries[file] && summaries[file].length > 20 && !summaries[file].startsWith('*')
        ? summaries[file]
        : purposeSentence(file, node);
      lines.push(purpose);
      lines.push(usageSentence(node));
      lines.push('');

      // Functions section
      if (node.exports.length > 0) {
        lines.push('**Functions:**');
        for (const exp of node.exports) {
          lines.push(`- \`${exp}\` — ${functionLine(exp)}`);
        }
        lines.push('');
      }

      // Flags engineers should know about
      const flags = [];
      if (node.riskScore > 60) flags.push(`⚠️ High-risk file (score ${node.riskScore}/100) — get a review before changing this`);
      if (node.meta?.gitHistory?.bugFixCommits > 2) flags.push(`🐛 ${node.meta.gitHistory.bugFixCommits} historical bug fixes — handle with care`);
      if (node.gaps.length > 0) flags.push(`🔍 ${node.gaps.length} dynamic pattern${node.gaps.length !== 1 ? 's' : ''} not fully tracked in the graph`);
      for (const flag of flags) {
        lines.push(`> ${flag}`);
      }
      if (flags.length > 0) lines.push('');

      lines.push('---');
      lines.push('');
    }
  }

  const content  = lines.join('\n');
  const outPath  = path.join(codebaseDir, 'GUIDE.md');
  fs.mkdirSync(codebaseDir, { recursive: true });
  fs.writeFileSync(outPath, content);
  return { outPath };
}

module.exports = { generateGuide };
