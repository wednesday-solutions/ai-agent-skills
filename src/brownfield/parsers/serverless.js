/**
 * 2A-3 — Serverless framework parser
 * Reads serverless.yml / serverless.ts to extract function → trigger mappings
 * These become edges with strength: "config"
 */

'use strict';

const fs = require('fs');
const path = require('path');

function parse(rootDir) {
  const result = { functions: [], edges: [] };

  // Try both yaml and ts variants
  const candidates = ['serverless.yml', 'serverless.yaml', 'serverless.ts', 'serverless.js'];
  let src = null;
  let foundFile = null;

  for (const name of candidates) {
    const file = path.join(rootDir, name);
    if (fs.existsSync(file)) {
      try {
        src = fs.readFileSync(file, 'utf8');
        foundFile = file;
        break;
      } catch {}
    }
  }

  if (!src) return result;

  // ── Extract function handlers ─────────────────────────────────────────────
  // handler: src/functions/myFunc.handler
  const handlerRe = /handler\s*:\s*([\w./]+)/g;
  let m;
  while ((m = handlerRe.exec(src)) !== null) {
    result.functions.push(m[1]);
  }

  // ── Extract HTTP events ───────────────────────────────────────────────────
  // events: - http: { path: x, method: y }
  const httpRe = /path\s*:\s*([\w/{}]+)/g;
  const methods = [];
  while ((m = httpRe.exec(src)) !== null) {
    methods.push(m[1]);
  }

  // ── Build edges: handler → trigger ────────────────────────────────────────
  // Simple approach: find function name blocks and their events
  const fnBlockRe = /^\s{2}(\w+):\s*\n([\s\S]*?)(?=^\s{2}\w+:|\s*$)/gm;
  while ((m = fnBlockRe.exec(src)) !== null) {
    const fnName = m[1];
    const block = m[2];

    // Extract handler
    const handlerMatch = block.match(/handler\s*:\s*([\w./]+)/);
    if (!handlerMatch) continue;

    const handlerFile = handlerMatch[1].replace(/\.[^.]+$/, ''); // strip method

    // Extract event types
    const eventMatches = [...block.matchAll(/- (http|sns|sqs|s3|schedule|dynamodb|kinesis|eventBridge):/g)];
    for (const ev of eventMatches) {
      result.edges.push({
        from: handlerFile,
        to: `serverless:${ev[1]}:${fnName}`,
        type: 'trigger',
        strength: 'config',
      });
    }
  }

  return result;
}

module.exports = { parse };
