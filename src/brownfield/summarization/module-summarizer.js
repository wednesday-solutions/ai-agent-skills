/**
 * 2C-1 — Module summarizer
 * ~70 token prompts. Cached by file hash. Free tier → Haiku.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { callLLM } = require('../core/llm-client');

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
 * Call Haiku for a summary — uses OpenRouter or Anthropic API automatically.
 */
async function callHaiku(prompt) {
  return callLLM({ model: 'haiku', messages: [{ role: 'user', content: prompt }], maxTokens: 80 });
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
async function summarizeAll(nodes, _rootDir, cacheDir, _apiKey) {
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
    const { hasApiKey } = require('../core/llm-client');
    if (hasApiKey()) {
      try {
        summary = await callHaiku(prompt);
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
