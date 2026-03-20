/**
 * 2D-3 — MASTER.md QA
 * Auto-run after MASTER.md generation.
 * Verifies summaries are specific not generic.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const GENERIC_PHRASES = [
  'utility functions',
  'helper functions',
  'contains various',
  'contains utility',
  'various functions',
  'this file contains',
  'this module contains',
  'handles various',
];

/**
 * Check summaries for generic/unhelpful language
 */
function flagGenericSummaries(summaries) {
  const flagged = [];
  for (const [file, summary] of Object.entries(summaries)) {
    const lower = (summary || '').toLowerCase();
    const isGeneric = GENERIC_PHRASES.some(p => lower.includes(p));
    if (isGeneric) {
      flagged.push({ file, summary, reason: 'generic language detected' });
    }
    // Also flag very short summaries (< 20 chars)
    if (summary && summary.length < 20) {
      flagged.push({ file, summary, reason: 'too short' });
    }
  }
  return flagged;
}

/**
 * QA the MASTER.md — check for completeness and specificity
 */
async function qaMasterMd(masterMdPath, summaries, apiKey) {
  const report = { flagged: [], masterMdIssues: [], score: 100 };

  // Check summaries
  report.flagged = flagGenericSummaries(summaries);
  if (report.flagged.length > 0) {
    report.score -= Math.min(30, report.flagged.length * 3);
  }

  // Check MASTER.md exists and has content
  if (!fs.existsSync(masterMdPath)) {
    report.masterMdIssues.push('MASTER.md does not exist');
    report.score -= 50;
    return report;
  }

  const content = fs.readFileSync(masterMdPath, 'utf8');

  if (!content.includes('## Architecture overview')) {
    report.masterMdIssues.push('Missing architecture overview section');
    report.score -= 10;
  }
  if (!content.includes('## Entry points')) {
    report.masterMdIssues.push('Missing entry points section');
    report.score -= 5;
  }
  if (!content.includes('## Module map')) {
    report.masterMdIssues.push('Missing module map section');
    report.score -= 10;
  }

  // Quick LLM check for readability (optional)
  if (apiKey && content.length > 500) {
    const sample = content.slice(0, 1500);
    const prompt = `Review this MASTER.md excerpt for a codebase documentation file:

${sample}

Is this useful for a developer who has never seen this codebase? Answer: yes/no + one sentence reason.`;

    const review = await callHaiku(prompt, apiKey);
    if (review && review.toLowerCase().startsWith('no')) {
      report.masterMdIssues.push(`LLM readability check: ${review}`);
      report.score -= 15;
    }
  }

  return report;
}

async function callHaiku(prompt, apiKey) {
  return new Promise(resolve => {
    const body = JSON.stringify({
      model: 'anthropic/claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100,
      temperature: 0,
    });

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
        try { resolve(JSON.parse(data).choices?.[0]?.message?.content?.trim() || null); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(20000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

module.exports = { qaMasterMd, flagGenericSummaries };
