'use strict';

/**
 * Model Cost Router — CLI only.
 *
 * Applies only to CLI commands that make their own API calls.
 * Does NOT apply inside IDE sessions — the IDE controls the model there.
 *
 * Tiers:
 *   free    — free OpenRouter models, tried first
 *   cheap   — Claude Haiku, for tasks needing reliable structured output
 *   capable — Claude Sonnet, for planning, synthesis, test generation
 */

const TIERS = {
  free:    ['google/gemma-3-27b-it:free', 'qwen/qwen-2.5-72b-instruct:free'],
  cheap:   'anthropic/claude-haiku-4-5',
  capable: 'anthropic/claude-sonnet-4-6',
};

const TASK_MAP = {
  'classify':        TIERS.free,
  'summarize-short': TIERS.free,
  'extract':         TIERS.free,
  'summarize-long':  TIERS.cheap,
  'generate-skill':  TIERS.cheap,
  'explain':         TIERS.cheap,
  'plan-refactor':   TIERS.capable,
  'synthesise':      TIERS.capable,
  'test-generate':   TIERS.capable,
};

/**
 * Returns the model ID (or array for free tier with fallback) for a task type.
 */
function route(taskType) {
  return TASK_MAP[taskType] || TIERS.free;
}

/**
 * Call OpenRouter with automatic escalation if confidence is low.
 * Reads OPENROUTER_API_KEY from env. Falls back to ANTHROPIC_API_KEY on Anthropic models.
 */
async function callWithEscalation(prompt, taskType, opts = {}) {
  const model = route(taskType);
  const primaryModel = Array.isArray(model) ? model[0] : model;

  let result = await callOpenRouter(prompt, primaryModel, opts);

  // Escalate free-tier calls with low confidence to cheap tier
  if (
    Array.isArray(model) &&
    result.confidence !== undefined &&
    result.confidence < getEscalateThreshold()
  ) {
    result = await callOpenRouter(prompt, TIERS.cheap, opts);
    result._escalated = true;
  }

  return result;
}

/**
 * Raw OpenRouter API call.
 */
async function callOpenRouter(prompt, model, opts = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('No API key found. Set OPENROUTER_API_KEY or ANTHROPIC_API_KEY in your environment.');
  }

  const isAnthropic = !process.env.OPENROUTER_API_KEY && process.env.ANTHROPIC_API_KEY;
  const baseUrl = isAnthropic
    ? 'https://api.anthropic.com/v1'
    : 'https://openrouter.ai/api/v1';

  const headers = isAnthropic
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
    : { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://github.com/wednesday-solutions/ai-agent-skills' };

  const body = JSON.stringify({
    model,
    max_tokens: opts.maxTokens || 2048,
    messages: [{ role: 'user', content: prompt }],
    ...(opts.system ? { system: opts.system } : {}),
  });

  const https = require('https');
  const url = new URL(`${baseUrl}/messages`);

  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: url.hostname, path: url.pathname, method: 'POST', headers },
      res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) { reject(new Error(json.error.message || JSON.stringify(json.error))); return; }
            const text = json.content?.[0]?.text || json.choices?.[0]?.message?.content || '';
            resolve({ text, model, confidence: undefined });
          } catch (e) {
            reject(new Error(`Failed to parse response: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function getEscalateThreshold() {
  try {
    const configPath = require('path').join(process.cwd(), '.wednesday', 'config.json');
    const cfg = JSON.parse(require('fs').readFileSync(configPath, 'utf8'));
    return cfg.models?.escalate_threshold ?? 0.80;
  } catch (_) {
    return 0.80;
  }
}

module.exports = { route, callWithEscalation, callOpenRouter, TIERS };
