/**
 * 2A-8 — Coverage gap subagents
 * Triggered by fill-gaps command ONLY — never by hooks.
 * Uses Haiku via OpenRouter. Max 400 tokens input per call.
 * Confidence gate: < 0.70 → edge not added, flagged as unknown.
 */

'use strict';

const path = require('path');
const { callLLM } = require('../core/llm-client');

// 3A: Raised from 0.70 → 0.80 to reduce false-positive agent-resolved edges
const CONFIDENCE_GATE = 0.80;

/**
 * Gap types and their risk gates
 */
const GAP_CONFIG = {
  'dynamic-require': { minRisk: 50, batchSize: 5 },
  'dynamic-import':  { minRisk: 50, batchSize: 5 },
  'event-emit':      { minRisk: 40, batchSize: 5 },
  'global-inject':   { minRisk: 60, batchSize: 5 },
  'god-file':        { minRisk: 0,  batchSize: 1 },  // exports > 15 + coverage < 30%
};

/**
 * Build a minimal prompt for a gap (max ~400 tokens)
 */
function buildPrompt(gap, node, nearbyFiles) {
  const nearby = nearbyFiles.slice(0, 5).join(', ');

  if (gap.type === 'dynamic-require' || gap.type === 'dynamic-import') {
    return `File: ${node.file}
Gap: ${gap.type}: ${gap.pattern}
Exports: ${JSON.stringify(node.exports.slice(0, 10))}
Nearby files: ${nearby}
Task: Which nearby files are likely loaded by this dynamic pattern? Return JSON: {"edges": [{"to": "<file>", "confidence": 0.0-1.0}]}`;
  }

  if (gap.type === 'event-emit') {
    return `File: ${node.file}
Gap: event emit: "${gap.event}"
Exports: ${JSON.stringify(node.exports.slice(0, 5))}
Candidate listeners: ${nearby}
Task: Which candidates likely listen to "${gap.event}"? Return JSON: {"edges": [{"to": "<file>", "confidence": 0.0-1.0}]}`;
  }

  if (gap.type === 'global-inject') {
    return `File: ${node.file}
Gap: global injection: "${gap.name}"
Nearby files: ${nearby}
Task: Which nearby files likely use global.${gap.name}? Return JSON: {"edges": [{"to": "<file>", "confidence": 0.0-1.0}]}`;
  }

  if (gap.type === 'god-file') {
    return `File: ${node.file}
Exports: ${JSON.stringify(node.exports.slice(0, 20))}
Importers: ${JSON.stringify(Object.entries(node.importersByExport || {}).slice(0, 10))}
Task: Group these exports into logical concerns (2-4 groups). Return JSON: {"groups": [{"name": "<concern>", "exports": [...]}]}`;
  }

  return null;
}

/**
 * Call Haiku — uses OpenRouter or Anthropic API automatically.
 */
async function callHaiku(prompt) {
  const text = await callLLM({ model: 'haiku', messages: [{ role: 'user', content: prompt }], maxTokens: 300 });
  if (!text) return null;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch { return null; }
  }
  return null;
}

/**
 * Process gaps for a node and return resolved edges
 * @param {Object} node - graph node
 * @param {string[]} nearbyFiles - files in same directory
 * @param {string} apiKey - OpenRouter API key
 * @returns {Object[]} resolved edges
 */
async function fillGapsForNode(node, nearbyFiles, apiKey) {
  const resolvedEdges = [];
  const unknownGaps = [];

  // Filter gaps by type and risk gate
  const eligibleGaps = node.gaps.filter(gap => {
    const config = GAP_CONFIG[gap.type];
    if (!config) return false;
    return node.riskScore >= config.minRisk;
  });

  // Batch similar gap types together
  const byType = {};
  for (const gap of eligibleGaps) {
    byType[gap.type] = byType[gap.type] || [];
    byType[gap.type].push(gap);
  }

  for (const [type, gaps] of Object.entries(byType)) {
    const config = GAP_CONFIG[type];
    const batches = [];
    for (let i = 0; i < gaps.length; i += config.batchSize) {
      batches.push(gaps.slice(i, i + config.batchSize));
    }

    for (const batch of batches) {
      // For batch > 1, combine into single prompt
      const prompt = batch.length === 1
        ? buildPrompt(batch[0], node, nearbyFiles)
        : buildBatchPrompt(batch, node, nearbyFiles, type);

      if (!prompt) continue;

      let result = null;
      try {
        result = await callHaiku(prompt);
      } catch {
        // API error — skip this batch
        continue;
      }

      if (!result) continue;

      // Process edges
      const edges = result.edges || [];
      for (const edge of edges) {
        if (edge.confidence >= CONFIDENCE_GATE) {
          resolvedEdges.push({
            from: node.file,
            to: edge.to,
            type: 'import',
            strength: 'agent',
            confidence: edge.confidence,
            resolvedBy: `${type}-subagent`,
          });
        } else {
          unknownGaps.push({ ...edge, gap: batch[0], reason: 'confidence-below-gate' });
        }
      }

      // Process god-file groups
      if (result.groups) {
        node.meta.godFileGroups = result.groups;
      }
    }
  }

  return { resolvedEdges, unknownGaps };
}

function buildBatchPrompt(gaps, node, nearbyFiles, type) {
  const nearby = nearbyFiles.slice(0, 5).join(', ');
  return `File: ${node.file}
Type: ${type} batch (${gaps.length} gaps)
Gaps: ${JSON.stringify(gaps.map(g => g.pattern || g.event || g.name).slice(0, 5))}
Nearby files: ${nearby}
Task: For each gap, which nearby files are likely connected? Return JSON: {"edges": [{"to": "<file>", "confidence": 0.0-1.0, "gap": "<pattern>"}]}`;
}

module.exports = { fillGapsForNode, GAP_CONFIG, CONFIDENCE_GATE };
