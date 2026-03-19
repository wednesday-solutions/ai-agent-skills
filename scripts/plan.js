#!/usr/bin/env node

/**
 * Greenfield Planning Script
 *
 * Reads BRIEF.md (or prompts for input), runs 3 Haiku agents in parallel
 * (Architect, PM, Security), then synthesizes with Sonnet into PLAN.md.
 *
 * Usage:
 *   wednesday-skills plan
 *   wednesday-skills plan --brief "Build a todo app with auth"
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ─── Config ────────────────────────────────────────────────────────────────

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY;
const USE_OPENROUTER = !process.env.ANTHROPIC_API_KEY && !!process.env.OPENROUTER_API_KEY;

const HAIKU_MODEL = 'stepfun/step-3.5-flash:free';
const SONNET_MODEL = 'stepfun/step-3.5-flash:free';

// ─── API Client ─────────────────────────────────────────────────────────────

function callAnthropic(messages, model, maxTokens = 2048) {
  return new Promise((resolve, reject) => {
    let body, hostname, apiPath, headers;

    if (USE_OPENROUTER) {
      // OpenRouter — OpenAI-compatible endpoint
      hostname = 'openrouter.ai';
      apiPath = '/api/v1/chat/completions';
      body = JSON.stringify({ model, max_tokens: maxTokens, messages });
      headers = {
        'Authorization': `Bearer ${ANTHROPIC_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
      };
    } else {
      // Anthropic direct
      hostname = 'api.anthropic.com';
      apiPath = '/v1/messages';
      body = JSON.stringify({ model, max_tokens: maxTokens, messages });
      headers = {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
      };
    }

    const options = { hostname, path: apiPath, method: 'POST', headers };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function extractText(response) {
  // Anthropic format
  if (response.content?.[0]?.text) return response.content[0].text;
  // OpenAI/OpenRouter format
  const msg = response.choices?.[0]?.message;
  if (msg?.content) return msg.content;
  // Reasoning models (o1, DeepSeek R1, Step) put output in reasoning field
  if (msg?.reasoning) return msg.reasoning;
  console.error('Unexpected response shape:', JSON.stringify(response).slice(0, 500));
  return '';
}

function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON found in response:\n---\n${text.slice(0, 1000)}\n---`);
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    throw new Error(`JSON parse failed: ${e.message}\nRaw: ${match[0].slice(0, 300)}`);
  }
}

// ─── Persona Prompts ─────────────────────────────────────────────────────────

const PERSONA_MAX_TOKENS = USE_OPENROUTER ? 4096 : 1024;
const SYNTHESIS_MAX_TOKENS = USE_OPENROUTER ? 8192 : 4096;

async function runArchitect(brief) {
  const prompt = `You are a senior software architect. Analyze this project brief and output ONLY valid JSON.

Brief:
${brief}

Output this exact JSON shape (no extra text, no markdown):
{
  "systemDesign": "one paragraph describing the overall system architecture",
  "techStack": ["technology1", "technology2"],
  "moduleBoundaries": ["module1: description", "module2: description"],
  "concerns": ["concern1", "concern2"]
}`;

  const res = await callAnthropic([{ role: 'user', content: prompt }], HAIKU_MODEL, PERSONA_MAX_TOKENS);
  return extractJSON(extractText(res));
}

async function runPM(brief) {
  const prompt = `You are a product manager. Analyze this project brief and output ONLY valid JSON.

Brief:
${brief}

Output this exact JSON shape (no extra text, no markdown):
{
  "requirements": ["requirement1", "requirement2"],
  "priorities": ["P0: item", "P1: item"],
  "outOfScope": ["out1", "out2"],
  "milestones": ["M1: description", "M2: description"]
}`;

  const res = await callAnthropic([{ role: 'user', content: prompt }], HAIKU_MODEL, PERSONA_MAX_TOKENS);
  return extractJSON(extractText(res));
}

async function runSecurity(brief) {
  const prompt = `You are a security engineer. Analyze this project brief and output ONLY valid JSON.

Brief:
${brief}

Output this exact JSON shape (no extra text, no markdown):
{
  "threatSurface": ["threat1", "threat2"],
  "dataRisks": ["risk1", "risk2"],
  "authRecommendations": ["rec1", "rec2"],
  "flags": ["flag1", "flag2"]
}`;

  const res = await callAnthropic([{ role: 'user', content: prompt }], HAIKU_MODEL, PERSONA_MAX_TOKENS);
  return extractJSON(extractText(res));
}

async function runSynthesis(brief, architect, pm, security) {
  const prompt = `You are a technical lead synthesizing input from three advisors into a project plan.

Project brief:
${brief}

Architect analysis:
${JSON.stringify(architect, null, 2)}

PM analysis:
${JSON.stringify(pm, null, 2)}

Security analysis:
${JSON.stringify(security, null, 2)}

Write a complete PLAN.md in markdown. Include these exact sections:
# Project Plan — [extract project name from brief]

## Overview
[2–3 sentence summary]

## Architecture
[From architect input — system design, tech stack, module boundaries]

## Requirements
[From PM input — prioritized list]

## Out of Scope
[From PM input]

## Security Considerations
[From security input — threats, data risks, auth recommendations]

## Milestones
[From PM input]

## Tensions
[List any disagreements or tradeoffs between the three advisors. If architect says microservices but PM says ship simple, flag it. If none, write "None identified."]

## Branch Naming (GIT-OS)
- feat/<name> from main
- fix/<name> from main
- chore/<name> from main`;

  const res = await callAnthropic([{ role: 'user', content: prompt }], SONNET_MODEL, SYNTHESIS_MAX_TOKENS);
  return extractText(res);
}

// ─── Cost Tracking ───────────────────────────────────────────────────────────

function logUsage(targetDir) {
  const cacheDir = path.join(targetDir, '.wednesday', 'cache');
  const usageFile = path.join(cacheDir, 'usage.json');

  fs.mkdirSync(cacheDir, { recursive: true });

  let usage = { runs: [] };
  if (fs.existsSync(usageFile)) {
    try { usage = JSON.parse(fs.readFileSync(usageFile, 'utf8')); } catch {}
  }

  usage.runs.push({
    type: 'greenfield-plan',
    timestamp: new Date().toISOString(),
    estimatedCost: 0.14,
    models: { haiku: 3, sonnet: 1 },
  });

  fs.writeFileSync(usageFile, JSON.stringify(usage, null, 2));
}

// ─── CODEBASE.md Seed ────────────────────────────────────────────────────────

function buildCodebaseDoc(architect) {
  const modules = (architect.moduleBoundaries || [])
    .map(m => `- ${m}`)
    .join('\n');

  const stack = (architect.techStack || [])
    .map(t => `- ${t}`)
    .join('\n');

  return `# Codebase Structure

> Auto-generated from greenfield planning. Update as the project evolves.

## Tech Stack
${stack}

## Module Boundaries
${modules}

## Notes

- Update this file as new modules are added
- Reference PLAN.md for architecture decisions
`;
}

// ─── Prompt for brief ────────────────────────────────────────────────────────

async function promptForBrief() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Describe your project (or create BRIEF.md and re-run): ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY or OPENROUTER_API_KEY is required.');
    console.error('Set it in your environment: export ANTHROPIC_API_KEY=sk-...');
    process.exit(1);
  }

  const targetDir = process.argv[2] || process.cwd();
  const briefFile = path.join(targetDir, 'BRIEF.md');
  const planFile = path.join(targetDir, 'PLAN.md');
  const codebaseFile = path.join(targetDir, 'CODEBASE.md');

  // Load or prompt for brief
  let brief;
  const briefArg = process.argv.indexOf('--brief');
  if (briefArg !== -1 && process.argv[briefArg + 1]) {
    brief = process.argv[briefArg + 1];
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(briefFile, brief);
  } else if (fs.existsSync(briefFile)) {
    brief = fs.readFileSync(briefFile, 'utf8').trim();
    console.log(`Loaded BRIEF.md (${brief.length} chars)`);
  } else {
    console.log('No BRIEF.md found.');
    brief = await promptForBrief();
    if (!brief) { console.error('No brief provided.'); process.exit(1); }
    fs.writeFileSync(briefFile, brief);
    console.log('BRIEF.md created.');
  }

  console.log('\nRunning 3 persona agents in parallel...');
  const start = Date.now();

  // Run all three Haiku agents in parallel
  const [architect, pm, security] = await Promise.all([
    runArchitect(brief).then(r => { console.log('  Architect done'); return r; }),
    runPM(brief).then(r => { console.log('  PM done'); return r; }),
    runSecurity(brief).then(r => { console.log('  Security done'); return r; }),
  ]);

  console.log('\nSynthesizing with Sonnet...');
  const plan = await runSynthesis(brief, architect, pm, security);

  // Write outputs
  fs.writeFileSync(planFile, plan);
  fs.writeFileSync(codebaseFile, buildCodebaseDoc(architect));
  logUsage(targetDir);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);
  console.log(`  PLAN.md     → ${planFile}`);
  console.log(`  CODEBASE.md → ${codebaseFile}`);
  console.log(`  Usage logged → .wednesday/cache/usage.json`);
  console.log('\nEstimated cost: ~$0.14');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
