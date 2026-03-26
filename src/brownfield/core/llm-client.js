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
    haiku:  process.env.OPENROUTER_MODEL_HAIKU || 'stepfun/step-3.5-flash:free',
    sonnet: process.env.OPENROUTER_MODEL_SONNET || 'anthropic/claude-sonnet-4-6',
  };
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
    if (operation === 'validate-connection') return { text: null, error: e.message || 'Unknown error' };
    return null;
  }
}

// ── OpenRouter ────────────────────────────────────────────────────────────────

function callOpenRouter({ model, messages, system, maxTokens, temperature, key }) {
  const resolvedModel = getOpenRouterModels()[model] || model;

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
      const text = json.choices?.[0]?.message?.content?.trim() || null;

      if (text === null) {
        throw new Error(`Text was null but no error field! Keys: ${Object.keys(json).join(', ')} | Raw: ${trimmed.slice(0, 200)}`);
      }

      // Fallback to estimation if provider doesn't return usage (common on some OpenRouter models)
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

function makeRequest({ hostname, path, headers, body, extractResult, timeoutMs = 60000 }) {
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

  try {
    const model = (provider === 'anthropic') ? getAnthropicModels().haiku : getOpenRouterModels().haiku;
    const body = JSON.stringify(provider === 'anthropic' ? {
      model,
      messages: [{ role: 'user', content: 'respond with only "OK"' }],
      max_tokens: 5,
    } : {
      model,
      messages: [{ role: 'user', content: 'respond with only "OK"' }],
      max_tokens: 5,
    });

    const result = await (provider === 'anthropic' ? callAnthropic : callOpenRouter)({
      model: 'haiku',
      messages: [{ role: 'user', content: 'respond with only "OK"' }],
      maxTokens: 5,
      key
    });

    if (result && result.text && result.text.toUpperCase().includes('OK')) {
      return { success: true, provider };
    }
    
    if (result && result.error) return { success: false, error: result.error };
    return { success: false, error: `Handshake failed. Provider returned: ${JSON.stringify(result)}` };
  } catch (e) {
    return { success: false, error: `Handshake crashed: ${e.message}` };
  }
}

module.exports = { callLLM, hasApiKey, getApiKey, detectProvider, validateConnection, tokenLogger };
