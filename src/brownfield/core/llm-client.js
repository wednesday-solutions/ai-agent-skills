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

const https       = require('https');
const tokenLogger = require('./token-logger');

function getOpenRouterModels() {
  return {
    haiku:  process.env.OPENROUTER_MODEL_HAIKU || 'google/gemini-2.5-flash-lite',
    sonnet: process.env.OPENROUTER_MODEL_SONNET || 'google/gemini-2.5-flash',
  };
}

// Ordered fallback chain — tried left to right on 429 or empty content.
// User's OPENROUTER_MODEL_HAIKU is always tried first (injected at runtime).
function getFreeModelChain() {
  const primary = process.env.OPENROUTER_MODEL_HAIKU || 'google/gemini-2.5-flash-lite';
  const defaults = [
    'google/gemini-2.5-flash-lite',           // cheap paid, reliable
    'google/gemma-3-27b-it:free',             // free, 27B
    'meta-llama/llama-3.3-70b-instruct:free',      // free, 70B
    'nousresearch/hermes-3-llama-3.1-405b:free',   // free, 405B
    'minimax/minimax-m2.5',                   // reliable fallback (not always free)
    'stepfun/step-3.5-flash:free',            // free, last resort
  ];
  return [primary, ...defaults.filter(m => m !== primary)];
}

function getAnthropicModels() {
  return {
    haiku:  process.env.ANTHROPIC_MODEL_HAIKU || 'claude-haiku-4-5-20251001',
    sonnet: process.env.ANTHROPIC_MODEL_SONNET || 'claude-sonnet-4-6',
  };
}

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
 * @param {string} opts.model         - 'haiku' | 'sonnet' | full model ID
 * @param {Array}  opts.messages      - [{role, content}] array
 * @param {string} [opts.system]      - system prompt (optional)
 * @param {number} [opts.maxTokens]   - default 300
 * @param {number} [opts.temperature] - default 0
 * @param {string} [opts.apiKey]      - override auto-detected key
 * @param {string} [opts.provider]    - override auto-detected provider
 * @param {string} [opts.operation]   - label for token logger (e.g. 'summarize')
 * @returns {Promise<string|null>} response text, or null on failure
 */
async function callLLM(opts) {
  const { model = 'haiku', messages, system, maxTokens = 300, temperature = 0, operation = 'default', baselineTokens } = opts;

  let { provider, key } = opts.apiKey
    ? { provider: opts.provider || 'openrouter', key: opts.apiKey }
    : detectProvider();

  const maxRetries = 2;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const result = await (provider === 'anthropic' ? callAnthropic : callOpenRouter)({
        model, messages, system, maxTokens, temperature, key
      });

      if (!result || typeof result !== 'object') {
        throw new Error(`Provider (${provider}) returned invalid response type: ${typeof result}`);
      }

      if (result.error && operation === 'validate-connection') {
        return result;
      }

      if (result.text) {
        const modelMap = provider === 'anthropic' ? getAnthropicModels() : getOpenRouterModels();
        tokenLogger.record({
          operation,
          model: modelMap[model] || model,
          inputTokens:  result.usage?.input || 0,
          outputTokens: result.usage?.output || 0,
          baselineTokens,
        });
      }

      return result.text || null;
    } catch (e) {
      const isRetryable = e.message.includes('429') || e.message.includes('timeout') || e.message.includes('rate');
      if (isRetryable && attempt <= maxRetries) {
        const delay = attempt * 1000;
        console.warn(`[llm-client] ${operation} failed (attempt ${attempt}): ${e.message}. Retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }

      if (operation === 'validate-connection') return { text: null, error: e.message || 'Unknown error' };
      console.error(`[llm-client] ${operation} failed permanently after ${attempt} attempts: ${e.message}`);
      return null;
    }
  }
}

// ── OpenRouter ────────────────────────────────────────────────────────────────

function callOpenRouter({ model, resolvedModelId, messages, system, maxTokens, temperature, key }) {
  // resolvedModelId lets caller bypass the alias map (used in fallback chain)
  const resolvedModel = resolvedModelId || getOpenRouterModels()[model] || model;

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
    extractResult: (data) => {
      const trimmed = data.trim();
      const json = JSON.parse(trimmed);
      if (json.error) {
        throw new Error(json.error.message || JSON.stringify(json.error));
      }
      const usage = json.usage || {};
      // Some models + providers return content in different fields
      const text = json.choices?.[0]?.message?.content?.trim()
        || json.choices?.[0]?.text?.trim()
        || null;

      // Fallback token estimation
      const estimatedInput = Math.ceil(body.length / 4);
      const estimatedOutput = text ? Math.ceil(text.length / 4) : 0;

      return {
        text,
        usage: { 
          input:  usage.prompt_tokens     || usage.input_tokens  || estimatedInput, 
          output: usage.completion_tokens || usage.output_tokens || estimatedOutput 
        },
      };
    },
  });
}

// ── Anthropic API ─────────────────────────────────────────────────────────────

function callAnthropic({ model, messages, system, maxTokens, temperature, key }) {
  const resolvedModel = getAnthropicModels()[model] || model;

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
    extractResult: (data) => {
      const json = JSON.parse(data);
      if (json.error) {
        throw new Error(json.error.message || JSON.stringify(json.error));
      }
      const text = json.content?.[0]?.text?.trim() || null;
      const usage = json.usage || {};
      
      const estimatedInput = Math.ceil(body.length / 4);
      const estimatedOutput = text ? Math.ceil(text.length / 4) : 0;

      return {
        text,
        usage: { 
          input:  usage.input_tokens  || estimatedInput, 
          output: usage.output_tokens || estimatedOutput 
        },
      };
    },
  });
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

function makeRequest({ hostname, path, headers, body, extractResult, timeoutMs = 120000 }) {
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
        try { resolve(extractResult(data)); }
        catch (e) {
          // If not JSON or extract fails, provide snippet for debugging
          const snippet = typeof data === 'string' ? data.slice(0, 100) : 'binary/unknown';
          resolve({ text: null, error: `Parse error: ${e.message} | Raw: ${snippet}`, usage: { input: 0, output: 0 } });
        }
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

/**
 * Test the connection to the LLM provider.
 * Returns { success: boolean, error?: string }
 */
async function validateConnection() {
  const { key, provider } = detectProvider();
  if (!key) return { success: false, error: 'No API key found. Set OPENROUTER_API_KEY or ANTHROPIC_API_KEY.' };

  // Anthropic: single model, no free chain needed
  if (provider === 'anthropic') {
    try {
      const result = await callAnthropic({
        model: 'haiku',
        messages: [{ role: 'user', content: 'respond with only "OK"' }],
        maxTokens: 5,
        key,
      });
      if (result?.text) return { success: true, provider, model: getAnthropicModels().haiku };
      return { success: false, error: 'Anthropic returned empty content.' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // OpenRouter: try each model in the fallback chain
  const chain = getFreeModelChain();
  const lastErrors = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  for (const modelId of chain) {
    try {
      const result = await callOpenRouter({
        model: 'haiku',
        resolvedModelId: modelId,
        messages: [{ role: 'user', content: 'respond with only "OK"' }],
        maxTokens: 5,
        key,
      });

      if (result?.text?.toUpperCase().includes('OK')) {
        // Pin working model for this session
        process.env.OPENROUTER_MODEL_HAIKU = modelId;
        return { success: true, provider, model: modelId };
      }

      if (result?.error) {
        const errMsg = result.error;
        if (errMsg.includes('429'))                                lastErrors.push(`${modelId}: rate-limited`);
        else if (errMsg.includes('guardrail') || errMsg.includes('No endpoints')) lastErrors.push(`${modelId}: blocked by account guardrails`);
        else                                                       lastErrors.push(`${modelId}: ${errMsg.slice(0, 80)}`);
        await sleep(300);
        continue;
      }

      // Non-"OK" response — try next
      lastErrors.push(`${modelId}: empty response`);
      await sleep(300);
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('429') || msg.includes('rate'))             lastErrors.push(`${modelId}: rate-limited`);
      else if (msg.includes('guardrail') || msg.includes('No endpoints')) lastErrors.push(`${modelId}: blocked by account guardrails`);
      else                                                         lastErrors.push(`${modelId}: ${msg.slice(0, 80)}`);
      await sleep(300);
    }
  }

  return { success: false, error: `All models exhausted.\n  ${lastErrors.join('\n  ')}` };
}

module.exports = { callLLM, hasApiKey, getApiKey, detectProvider, validateConnection, tokenLogger };
