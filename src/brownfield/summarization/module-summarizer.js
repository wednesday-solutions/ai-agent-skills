/**
 * 2C-1 — Module summarizer
 * ~70 token prompts. Cached by file hash. Free tier → Haiku.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

/**
 * Build the minimal summarization prompt (~70 tokens max)
 */
function buildPrompt(node, lastCommitMsg) {
  const exportStr = node.exports.slice(0, 8).join(', ') || 'none';
  const importersStr = node.importedBy.slice(0, 5).join(', ') || 'none';
  return `File: ${node.file}
Lang: ${node.lang}
Exports: ${exportStr}
Used by: ${importersStr}
Last change: ${lastCommitMsg || 'unknown'}
Write 2 sentences. Start with what it DOES. Name at least one specific function, type, or export. Do not use phrases like "this module contains", "this file handles", or "this module provides".`;
}

/**
 * Call Haiku for a summary
 */
async function callHaiku(prompt, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'anthropic/claude-haiku-4-5',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 80,
      temperature: 0,
    });

    const options = {
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/wednesday-solutions/ai-agent-skills',
        'X-Title': 'Wednesday Skills Summarizer',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.choices?.[0]?.message?.content?.trim() || null);
        } catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

/**
 * Load summary cache
 */
function loadSummaryCache(cacheDir) {
  const f = path.join(cacheDir, 'summary-cache.json');
  if (!fs.existsSync(f)) return {};
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; }
}

function saveSummaryCache(cacheDir, cache) {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'summary-cache.json'), JSON.stringify(cache, null, 2));
}

/**
 * Summarize all nodes, using cache where possible
 * @param {Object} nodes      - graph nodes
 * @param {string} rootDir    - project root
 * @param {string} cacheDir   - .wednesday/cache
 * @param {string} apiKey     - OpenRouter API key (null = skip LLM)
 * @returns {Object} summaries keyed by file
 */
async function summarizeAll(nodes, _rootDir, cacheDir, apiKey) {
  const cache = loadSummaryCache(cacheDir);
  const summaries = {};
  let apiCalls = 0;

  for (const [file, node] of Object.entries(nodes)) {
    if (node.error) continue;

    // Cache key: hash of exports + importedBy (changes when graph changes)
    const cacheKey = crypto.createHash('sha1')
      .update(JSON.stringify({ exports: node.exports, importedBy: node.importedBy }))
      .digest('hex');

    if (cache[cacheKey]) {
      summaries[file] = cache[cacheKey];
      continue;
    }

    // Need to generate
    const lastCommit = node.meta?.gitHistory?.lastCommit;
    const prompt = buildPrompt(node, lastCommit);

    let summary = null;
    if (apiKey) {
      try {
        summary = await callHaiku(prompt, apiKey);
        apiCalls++;
      } catch {
        summary = null;
      }
    }

    // Fallback: generate structural summary without LLM
    if (!summary) {
      summary = generateStructuralSummary(node);
    }

    summaries[file] = summary;
    cache[cacheKey] = summary;
  }

  saveSummaryCache(cacheDir, cache);

  return { summaries, apiCalls };
}

/**
 * Zero-cost structural summary when LLM unavailable
 */
function generateStructuralSummary(node) {
  const exportStr = node.exports.slice(0, 3).join(', ');
  const importerCount = node.importedBy.length;

  if (node.isBarrel) return `Barrel file that re-exports from ${node.imports.length} modules.`;
  if (node.isEntryPoint) return `Entry point that initialises the application.`;
  if (importerCount === 0 && node.exports.length === 0) return `Utility or script with no public interface.`;

  return `${node.lang} module exporting [${exportStr || 'nothing'}]. Used by ${importerCount} other module${importerCount !== 1 ? 's' : ''}.`;
}

module.exports = { summarizeAll, generateStructuralSummary };
