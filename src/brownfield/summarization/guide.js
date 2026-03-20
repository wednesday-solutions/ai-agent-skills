/**
 * 2C-5 — GUIDE.md generator
 * Plain-English explanations of every module + its exports.
 * Batches 8 files per Haiku call — cheap (~$0.002 for 40 files, ~$0.025 for 500).
 * Cached by exports+importedBy hash — only re-calls LLM when interface changes.
 * Writes .wednesday/codebase/GUIDE.md
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const BATCH_SIZE = 8;
const CACHE_VERSION = 1;

// ── Role classifier (same logic as master-md, inlined to keep files independent) ─
function classifyRole(file, node) {
  const f = file.toLowerCase();
  const name = path.basename(f, path.extname(f));
  if (node.meta?.isController) return 'controller';
  if (node.meta?.isProvider)   return 'service';
  if (node.isEntryPoint)       return 'entry point';
  if (node.isBarrel)           return 'module index';
  if (/\.test\.|\.spec\./.test(f)) return 'test file';
  if (/\/(hooks?)\//i.test(f) || /^use[A-Z]/.test(name)) return 'React hook';
  if (/\/(components?|views?|screens?|pages?)\//i.test(f) || /component|view|screen|page/i.test(name)) return 'UI component';
  if (/service/i.test(name))   return 'service';
  if (/util|helper/i.test(name)) return 'utility';
  if (/\/model[s]?\/|\/schema/i.test(f)) return 'data model';
  if (/config|constant/i.test(name)) return 'config';
  if (/route|router/i.test(name)) return 'router';
  if (/middleware/i.test(name)) return 'middleware';
  if (/store|redux|context/i.test(f)) return 'state store';
  if (node.lang === 'graphql') return 'GraphQL schema';
  if (node.lang === 'go')     return 'Go package';
  if (node.lang === 'kotlin') return 'Android module';
  return 'module';
}

// ── Cache helpers ─────────────────────────────────────────────────────────────
function guideHash(node) {
  const key = JSON.stringify({ e: node.exports.slice().sort(), u: node.importedBy.slice().sort(), v: CACHE_VERSION });
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 12);
}

function loadGuideCache(cacheDir) {
  const p = path.join(cacheDir, 'guide-cache.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

function saveGuideCache(cacheDir, cache) {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'guide-cache.json'), JSON.stringify(cache, null, 2));
}

// ── Haiku batch call ──────────────────────────────────────────────────────────
function callHaikuBatch(batchData, apiKey) {
  const systemPrompt =
    'You write codebase guides for mixed audiences (engineers + non-technical stakeholders). ' +
    'Be specific to the actual module — never use generic phrases like "handles logic" or "manages operations". ' +
    'Name the actual thing the module does.';

  const userPrompt =
    'For each module in the JSON array below, return a JSON array where each item has:\n' +
    '- "file": same string as input\n' +
    '- "plain": 2 sentences in plain English with NO code terms, NO jargon. ' +
    'Explain what it does and why the app needs it. Write for a product manager.\n' +
    '- "functions": object mapping each export name to one plain-English sentence ' +
    '(max 15 words) saying what it does. No parameter names, no types.\n\n' +
    'Return ONLY valid JSON array. No markdown fences, no explanation.\n\n' +
    JSON.stringify(batchData);

  const body = JSON.stringify({
    model: 'anthropic/claude-haiku-4-5-20251001',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 1200,
    temperature: 0,
  });

  return new Promise(resolve => {
    const options = {
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const text = JSON.parse(data).choices?.[0]?.message?.content?.trim() || '[]';
          // Strip markdown fences if model wraps anyway
          const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
          resolve(JSON.parse(clean));
        } catch {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(45000, () => { req.destroy(); resolve([]); });
    req.write(body);
    req.end();
  });
}

// ── Structural fallback (no API key) ─────────────────────────────────────────
function structuralPlain(file, node, summary) {
  const role = classifyRole(file, node);
  const usedBy = node.importedBy.length;
  const exportCount = node.exports.length;
  const name = path.basename(file, path.extname(file));

  if (summary && summary.length > 20 && !summary.startsWith('*')) return summary;

  const usageNote = usedBy > 0
    ? `It is used by ${usedBy} other part${usedBy !== 1 ? 's' : ''} of the app.`
    : `It appears to be a standalone ${role}.`;

  return `This is a ${role} called \`${name}\` with ${exportCount} exported function${exportCount !== 1 ? 's' : ''}. ${usageNote}`;
}

function structuralFunctions(node) {
  const result = {};
  for (const exp of node.exports) {
    const lower = exp.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
    result[exp] = `Handles ${lower} operations.`;
  }
  return result;
}

// ── Main generator ────────────────────────────────────────────────────────────
async function generateGuide(graph, summaries, codebaseDir, cacheDir, apiKey) {
  const nodes = graph.nodes;
  const allNodes = Object.entries(nodes).filter(([, n]) => !n.error);

  const cache = loadGuideCache(cacheDir);
  const guideData = {}; // file -> { plain, functions }
  const toFetch = [];   // nodes that need LLM

  // Check cache
  for (const [file, node] of allNodes) {
    const hash = guideHash(node);
    if (cache[file] && cache[file].hash === hash) {
      guideData[file] = cache[file].data;
    } else {
      toFetch.push([file, node, hash]);
    }
  }

  // Batch LLM calls for uncached files
  if (apiKey && toFetch.length > 0) {
    for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
      const batch = toFetch.slice(i, i + BATCH_SIZE);
      const batchInput = batch.map(([file, node]) => ({
        file,
        role: classifyRole(file, node),
        exports: node.exports.slice(0, 12),
        usedBy: node.importedBy.slice(0, 5),
        dependsOn: node.imports.filter(imp => nodes[imp]).slice(0, 5).map(f => path.basename(f)),
        bugFixes: node.meta?.gitHistory?.bugFixCommits || 0,
        lang: node.lang,
      }));

      const results = await callHaikuBatch(batchInput, apiKey);

      for (const item of results) {
        if (!item?.file) continue;
        const entry = batch.find(([f]) => f === item.file);
        if (!entry) continue;
        const [file, , hash] = entry;
        const data = { plain: item.plain || structuralPlain(file, nodes[file], summaries[file]), functions: item.functions || {} };
        guideData[file] = data;
        cache[file] = { hash, data };
      }
    }
  }

  // Structural fallback for any still missing
  for (const [file, node, hash] of toFetch) {
    if (!guideData[file]) {
      const data = { plain: structuralPlain(file, node, summaries[file]), functions: structuralFunctions(node) };
      guideData[file] = data;
      if (!apiKey) cache[file] = { hash, data }; // only cache structural if no key (LLM may not have run)
    }
  }

  saveGuideCache(cacheDir, cache);

  // ── Write GUIDE.md ──────────────────────────────────────────────────────────
  const lines = [];
  lines.push('# Codebase Guide');
  lines.push('');
  lines.push('> Plain-English explanations of every module and what each function does.');
  lines.push('> Written for engineers and non-technical readers alike.');
  lines.push(`> Generated: ${new Date().toISOString()}`);
  if (!apiKey) {
    lines.push('> ⚠️ Structural summaries only — set OPENROUTER_API_KEY for plain-English LLM explanations.');
  }
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

    for (const [file, node] of dirNodes.sort((a, b) => b[1].importedBy.length - a[1].importedBy.length)) {
      const name = path.basename(file);
      const data = guideData[file] || {};
      const role = classifyRole(file, node);

      lines.push(`### ${name}`);
      lines.push(`\`${file}\` · ${role} · used by ${node.importedBy.length} file${node.importedBy.length !== 1 ? 's' : ''}`);
      lines.push('');

      // Plain-English paragraph — for everyone
      lines.push(data.plain || structuralPlain(file, node, summaries[file]));
      lines.push('');

      // Function-level — for engineers
      const fns = data.functions && Object.keys(data.functions).length > 0
        ? data.functions
        : structuralFunctions(node);

      if (Object.keys(fns).length > 0) {
        lines.push('**Functions:**');
        for (const [fn, desc] of Object.entries(fns)) {
          lines.push(`- \`${fn}\` — ${desc}`);
        }
        lines.push('');
      }

      // Quick stats line for engineers
      const statParts = [];
      if (node.riskScore > 30) statParts.push(`⚠️ risk ${node.riskScore}/100`);
      if (node.meta?.gitHistory?.bugFixCommits > 2) statParts.push(`${node.meta.gitHistory.bugFixCommits} bug fixes`);
      if (node.gaps.length > 0) statParts.push(`${node.gaps.length} coverage gap${node.gaps.length !== 1 ? 's' : ''}`);
      if (statParts.length > 0) {
        lines.push(`> ${statParts.join(' · ')}`);
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }
  }

  const content = lines.join('\n');
  const outPath = path.join(codebaseDir, 'GUIDE.md');
  fs.mkdirSync(codebaseDir, { recursive: true });
  fs.writeFileSync(outPath, content);
  return { outPath, llmCalls: Math.ceil(toFetch.length / BATCH_SIZE), cached: allNodes.length - toFetch.length };
}

module.exports = { generateGuide };
