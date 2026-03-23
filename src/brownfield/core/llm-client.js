/**
 * Shared LLM client — tries OpenRouter first, falls back to Anthropic API.
 * Priority:
 *   1. OPENROUTER_API_KEY  → openrouter.ai  (cheaper, more models)
 *   2. ANTHROPIC_API_KEY   → api.anthropic.com (works natively in Claude Code)
 *
 * Model aliases:
 *   'haiku'  → claude-haiku-4-5
 *   'sonnet' → claude-sonnet-4-6
 */

'use strict';

const https = require('https');

const OPENROUTER_MODELS = {
  haiku:  'anthropic/claude-haiku-4-5',
  sonnet: 'anthropic/claude-sonnet-4-6',
};

const ANTHROPIC_MODELS = {
  haiku:  'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
};

/**
 * Detect which API key is available.
 * Returns { provider: 'openrouter'|'anthropic'|null, key: string|null }
 */
function detectProvider() {
  if (process.env.OPENROUTER_API_KEY) {
    return { provider: 'openrouter', key: process.env.OPENROUTER_API_KEY };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: 'anthropic', key: process.env.ANTHROPIC_API_KEY };
  }
  return { provider: null, key: null };
}

/**
 * Call the LLM.
 *
 * @param {Object} opts
 * @param {string} opts.model       - 'haiku' | 'sonnet' | full model ID
 * @param {Array}  opts.messages    - [{role, content}] array
 * @param {string} [opts.system]    - system prompt (optional)
 * @param {number} [opts.maxTokens] - default 300
 * @param {number} [opts.temperature] - default 0
 * @param {string} [opts.apiKey]    - override auto-detected key
 * @param {string} [opts.provider]  - override auto-detected provider
 * @returns {Promise<string|null>} response text, or null on failure
 */
function callLLM(opts) {
  const { model = 'haiku', messages, system, maxTokens = 300, temperature = 0 } = opts;

  let { provider, key } = opts.apiKey
    ? { provider: opts.provider || 'openrouter', key: opts.apiKey }
    : detectProvider();

  if (!key) return Promise.resolve(null);

  if (provider === 'anthropic') {
    return callAnthropic({ model, messages, system, maxTokens, temperature, key });
  }
  return callOpenRouter({ model, messages, system, maxTokens, temperature, key });
}

// ── OpenRouter ────────────────────────────────────────────────────────────────

function callOpenRouter({ model, messages, system, maxTokens, temperature, key }) {
  const resolvedModel = OPENROUTER_MODELS[model] || model;

  const allMessages = system
    ? [{ role: 'system', content: system }, ...messages]
    : messages;

  const body = JSON.stringify({
    model: resolvedModel,
    messages: allMessages,
    max_tokens: maxTokens,
    temperature,
  });

  return makeRequest({
    hostname: 'openrouter.ai',
    path: '/api/v1/chat/completions',
    headers: {
      'Authorization': `Bearer ${key}`,
      'HTTP-Referer': 'https://github.com/wednesday-solutions/ai-agent-skills',
      'X-Title': 'Wednesday Skills',
    },
    body,
    parseResponse: (data) => {
      const json = JSON.parse(data);
      return json.choices?.[0]?.message?.content?.trim() || null;
    },
  });
}

// ── Anthropic API ─────────────────────────────────────────────────────────────

function callAnthropic({ model, messages, system, maxTokens, temperature, key }) {
  const resolvedModel = ANTHROPIC_MODELS[model] || model;

  const bodyObj = {
    model: resolvedModel,
    messages,
    max_tokens: maxTokens,
    temperature,
  };
  if (system) bodyObj.system = system;

  const body = JSON.stringify(bodyObj);

  return makeRequest({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body,
    parseResponse: (data) => {
      const json = JSON.parse(data);
      return json.content?.[0]?.text?.trim() || null;
    },
  });
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

function makeRequest({ hostname, path, headers, body, parseResponse, timeoutMs = 60000 }) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(parseResponse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('LLM timeout')); });
    req.write(body);
    req.end();
  });
}

/**
 * Check if any LLM API key is available.
 */
function hasApiKey() {
  return !!(process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY);
}

/**
 * Return the active API key (OpenRouter preferred, Anthropic fallback).
 */
function getApiKey() {
  return process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY || null;
}

module.exports = { callLLM, hasApiKey, getApiKey, detectProvider };
