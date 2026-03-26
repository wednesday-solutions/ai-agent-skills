/**
 * 2C-1 — Module summarizer
 *
 * Improvements over original:
 *   1. Cache key uses file+exports only — not importedBy (which changes on every new
 *      importer even though the file's content/purpose hasn't changed)
 *   2. Skip LLM when commentIntel has a purpose for the module dir — zero tokens,
 *      better output (developer-written intent beats structural inference)
 *   3. Prompt uses role + tagged comments instead of importedBy paths — same token
 *      budget, far more signal about what the file *does*
 *   4. Structural fallback uses purposeSentence() from guide.js — much better than
 *      "js module exporting [x]. Used by N modules."
 *   5. Parallel batch processing — Promise.all in groups of 20, not sequential await
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { callLLM, hasApiKey, tokenLogger } = require('../core/llm-client');
const { classifyRole, purposeSentence } = require('./role-classifier');

// Infrastructure roles where the structural fallback is already accurate —
// these files don't benefit from an LLM call regardless of import count.
const INFRA_ROLES = new Set(['utility', 'config', 'test file']);

// Directory-name patterns that are definitively infrastructure.
// Mirrors feature-modules.js INFRA_PATTERNS so both systems agree.
const INFRA_DIR_RE = /(?:^|[/\\])(utils?|helpers?|lib|config|common|shared|constants?|types?|hooks?|styles?|assets|public|static|vendor|generated|migrations?|seeds?|fixtures?|mocks?|stubs?|i18n|locale|theme)(?:[/\\]|$)/i;
const BIZ_DIR_RE   = /(?:^|[/\\])(auth|payments?|billing|orders?|users?|accounts?|checkout|notifications?|subscriptions?|cart|products?|inventory|dashboard|reports?|analytics|messaging|chat|booking|scheduling|transactions?|invoices?|onboarding|sessions?|roles?|permissions?)(?:[/\\]|$)/i;

const BATCH_SIZE = 20;

// ── Cache ─────────────────────────────────────────────────────────────────────

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
 * Cache key: file path + exports list only.
 * importedBy is intentionally excluded — a new file importing this one doesn't
 * change what this file *does*, so the cached summary is still valid.
 */
function cacheKey(file, node) {
  return crypto.createHash('sha1')
    .update(JSON.stringify({ file, exports: node.exports }))
    .digest('hex');
}

// ── Comment intel helpers ─────────────────────────────────────────────────────

/**
 * Build dir→moduleIntel map from commentIntel for O(1) lookups.
 */
function buildCommentByDir(commentIntel) {
  const map = new Map();
  if (!commentIntel || !commentIntel.modules) return map;
  for (const mod of commentIntel.modules) {
    map.set(mod.dir, mod);
  }
  return map;
}

/**
 * Pull top 2 tagged comment texts for a file's dir from commentIntel.items.
 * Returns an array of strings like ["FIXME: token refresh fails silently", "TODO: extract retry"]
 */
function topTaggedComments(file, commentIntel) {
  if (!commentIntel || !commentIntel.items) return [];
  const dir = path.dirname(file);
  return commentIntel.items
    .filter(item => item.file && path.dirname(item.file) === dir && item.tag)
    .slice(0, 2)
    .map(item => `${item.tag}: ${item.text}`);
}

// ── Prompt builder ─────────────────────────────────────────────────────────────

/**
 * Build a ~70 token prompt.
 * Uses role + tagged comments instead of importedBy paths — same budget, better signal.
 */
function buildPrompt(file, node, lastCommitMsg, taggedComments) {
  const role      = classifyRole(file, node);
  const exportStr = node.exports.slice(0, 8).join(', ') || 'none';
  const commentStr = taggedComments.length > 0
    ? `\nDev notes: ${taggedComments.join(' | ')}`
    : '';
  
  const signatureStr = node.meta?.signatures 
    ? `\nSignatures:\n${node.meta.signatures.slice(0, 1000)}` 
    : '';

  return `File: ${file}
Role: ${role}
Exports: ${exportStr}${signatureStr}${commentStr}
Last change: ${lastCommitMsg || 'unknown'}

Write 2 sentences. Start with what it DOES. Name at least one specific function, type, or export. Do not use generic phrases like "this module contains" or "this file handles".`;
}

// ── LLM call ─────────────────────────────────────────────────────────────────

async function callHaiku(prompt) {
  return callLLM({ model: 'haiku', messages: [{ role: 'user', content: prompt }], maxTokens: 80, operation: 'summarize' });
}

// ── Zero-cost structural fallback ─────────────────────────────────────────────

/**
 * Fallback when LLM unavailable. Uses guide.js role classifier + purpose sentence
 * instead of the original weak "js module exporting [x]. Used by N modules."
 */
function generateStructuralSummary(file, node) {
  if (node.isBarrel)    return `Re-exports from ${node.imports.length} module${node.imports.length !== 1 ? 's' : ''} in the ${path.basename(path.dirname(file))} directory.`;
  if (node.isEntryPoint) return 'Entry point that initialises the application.';
  return purposeSentence(file, node);
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Summarize all nodes, using cache where possible.
 *
 * @param {Object}      nodes        - dep-graph nodes
 * @param {string}      _rootDir     - project root (unused, kept for API compat)
 * @param {string}      cacheDir     - .wednesday/cache
 * @param {string|null} _apiKey      - unused (reads from env via hasApiKey())
 * @param {Object|null} commentIntel - output of analyseComments (optional)
 * @returns {{ summaries: Object, apiCalls: number }}
 */
async function summarizeAll(nodes, _rootDir, cacheDir, _apiKey, commentIntel = null) {
  const cache        = loadSummaryCache(cacheDir);
  const commentByDir = buildCommentByDir(commentIntel);
  const summaries    = {};
  let apiCalls       = 0;

  // ── Pass 1: serve from cache or comment intel (zero API calls) ────────────
  const needsLlm = []; // { file, node } pairs still needing summarization

  for (const [file, node] of Object.entries(nodes)) {
    if (node.error) continue;

    const key = cacheKey(file, node);

    // Cache hit — 0 tokens spent, baseline still saved
    if (cache[key]) {
      summaries[file] = cache[key];
      tokenLogger.recordCacheHit('summarize');
      continue;
    }

    // Comment intel has a developer-written purpose for this module dir — use it
    // directly and skip the LLM call entirely. Better quality, zero tokens.
    const dir   = path.dirname(file);
    const intel = commentByDir.get(dir);
    if (intel && intel.purpose) {
      const summary = intel.purpose;
      summaries[file] = summary;
      cache[key]      = summary;
      tokenLogger.recordCacheHit('summarize');
      continue;
    }

    // Tier gate: only high-value files get LLM calls.
    // A file is high-value if it meets ANY of:
    //   1. High risk score — many dependents or public contract
    //   2. Entry point or barrel — structural importance
    //   3. Lives in a biz-feature directory (auth, payments, orders…)
    //   4. Heavily imported AND not an infra role — reach matters only for non-utilities
    //
    // Utilities, configs, and test files always get structural fallback regardless of
    // import count — a date formatter imported by 30 files is still just a date formatter.
    const role         = classifyRole(file, node);
    const isInfraRole  = INFRA_ROLES.has(role);
    const dirPath      = path.dirname(file);
    const dirIsBiz     = BIZ_DIR_RE.test(dirPath)
      || (commentByDir.get(dirPath)?.isBizFeature === true);
    const dirIsInfra   = !dirIsBiz && (INFRA_DIR_RE.test(dirPath)
      || commentByDir.get(dirPath)?.isBizFeature === false);

    const isHighValue = node.riskScore > 50
      || node.isEntryPoint
      || node.isBarrel
      || dirIsBiz
      || (node.importedBy.length > 8 && !isInfraRole && !dirIsInfra);

    if (!isHighValue) {
      const summary   = generateStructuralSummary(file, node);
      summaries[file] = summary;
      cache[key]      = summary;
      continue;
    }

    needsLlm.push({ file, node, key });
  }

  // ── Pass 2: LLM for high-value files — parallel batches of BATCH_SIZE ─────
  if (needsLlm.length > 0 && hasApiKey()) {
    for (let i = 0; i < needsLlm.length; i += BATCH_SIZE) {
      const batch = needsLlm.slice(i, i + BATCH_SIZE);

      const results = await Promise.all(batch.map(async ({ file, node, key }) => {
        const lastCommit   = node.meta?.gitHistory?.lastCommit;
        const taggedComments = topTaggedComments(file, commentIntel);
        const prompt       = buildPrompt(file, node, lastCommit, taggedComments);

        let summary = null;
        try {
          summary = await callHaiku(prompt);
          apiCalls++;
        } catch {
          summary = null;
        }

        return { file, key, summary };
      }));

      for (const { file, key, summary } of results) {
        const final = summary || generateStructuralSummary(file, nodes[file]);
        summaries[file] = final;
        cache[key]      = final;
      }
    }
  }

  // ── Pass 3: structural fallback for anything still missing ────────────────
  for (const { file, node, key } of needsLlm) {
    if (!summaries[file]) {
      const summary   = generateStructuralSummary(file, node);
      summaries[file] = summary;
      cache[key]      = summary;
    }
  }

  saveSummaryCache(cacheDir, cache);
  return { summaries, apiCalls };
}

module.exports = { summarizeAll, generateStructuralSummary };
