#!/usr/bin/env node

/**
 * Greenfield Planning Script
 *
 * Flow:
 * 1. Load or prompt for BRIEF.md
 * 2. Model generates 5 clarifying questions based on the brief
 * 3. User answers each question interactively
 * 4. 3 Haiku-equivalent agents run in parallel (Architect, PM, Security)
 * 5. Sonnet-equivalent synthesizes all input into a detailed GSD-style PLAN.md
 *
 * Usage:
 *   wednesday-skills plan
 *   wednesday-skills plan --brief "Build a todo app with auth"
 *   wednesday-skills plan --skip-questions   (skip Q&A, go straight to planning)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ─── Config ─────────────────────────────────────────────────────────────────

const ANTHROPIC_API_KEY = process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY;
const USE_OPENROUTER = !!process.env.OPENROUTER_API_KEY;

const FAST_MODEL = 'stepfun/step-3.5-flash:free';
const SMART_MODEL = 'stepfun/step-3.5-flash:free';

const PERSONA_MAX_TOKENS = 4096;
const SYNTHESIS_MAX_TOKENS = 8192;

// ─── API Client ──────────────────────────────────────────────────────────────

function callModel(messages, model, maxTokens) {
  return new Promise((resolve, reject) => {
    let body, hostname, apiPath, headers;

    if (USE_OPENROUTER) {
      hostname = 'openrouter.ai';
      apiPath = '/api/v1/chat/completions';
      body = JSON.stringify({ model, max_tokens: maxTokens, messages });
      headers = {
        'Authorization': `Bearer ${ANTHROPIC_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
      };
    } else {
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

    const req = https.request({ hostname, path: apiPath, method: 'POST', headers }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { reject(new Error(`Failed to parse response: ${d.slice(0, 200)}`)); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function extractText(response) {
  if (response.content?.[0]?.text) return response.content[0].text;
  const msg = response.choices?.[0]?.message;
  if (msg?.content) return msg.content;
  if (msg?.reasoning) return msg.reasoning;
  console.error('Unexpected response shape:', JSON.stringify(response).slice(0, 300));
  return '';
}

function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) throw new Error(`No JSON found:\n${text.slice(0, 500)}`);
  try { return JSON.parse(match[0]); }
  catch {
    // Try to fix JS-style objects: unquoted keys, single quotes, trailing commas
    try {
      const fixed = match[0]
        .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3') // quote unquoted keys
        .replace(/'/g, '"')                                                  // single → double quotes
        .replace(/,(\s*[}\]])/g, '$1');                                      // trailing commas
      return JSON.parse(fixed);
    } catch (e2) {
      throw new Error(`JSON parse failed: ${e2.message}\n${match[0].slice(0, 300)}`);
    }
  }
}

// ─── Step 1: Generate clarifying questions ───────────────────────────────────

async function generateQuestions(brief) {
  const prompt = `You are a technical project planner. A developer has given you this project brief:

"${brief}"

Generate exactly 5 clarifying questions that would most improve the quality of a technical plan.
Focus on: scale, tech constraints, existing infrastructure, timeline, and non-obvious requirements.

Respond with a JSON array of 5 strings. No explanation, just the array:
["question 1", "question 2", "question 3", "question 4", "question 5"]`;

  const res = await callModel([{ role: 'user', content: prompt }], FAST_MODEL, 1024);
  const text = extractText(res);
  try {
    const questions = extractJSON(text);
    if (Array.isArray(questions) && questions.length >= 5) return questions.slice(0, 5);
  } catch {}

  // Fallback questions if model output is malformed
  return [
    'What is the expected number of users at launch and at scale?',
    'Are there any preferred technologies or existing infrastructure we must work with?',
    'What is the target timeline for the MVP?',
    'Who are the primary end users and what is their technical level?',
    'Are there any hard constraints — budget, compliance, integrations, or non-negotiables?',
  ];
}

// ─── Step 2: Interactive Q&A ─────────────────────────────────────────────────

function askQuestion(rl, index, question) {
  return new Promise(resolve => {
    rl.question(`\nQ${index + 1}. ${question}\n> `, answer => {
      resolve(answer.trim() || '(no answer)');
    });
  });
}

async function runQandA(brief) {
  console.log('\nGenerating clarifying questions...');
  const questions = await generateQuestions(brief);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answers = [];

  console.log('\n─────────────────────────────────────────────');
  console.log('Answer these 5 questions to improve your plan');
  console.log('─────────────────────────────────────────────');

  for (let i = 0; i < questions.length; i++) {
    const answer = await askQuestion(rl, i, questions[i]);
    answers.push({ question: questions[i], answer });
  }

  rl.close();
  return answers;
}

// ─── Step 3: Persona agents ──────────────────────────────────────────────────

function buildContext(brief, qna) {
  const answersText = qna.length
    ? '\n\nClarifications from the developer:\n' +
      qna.map((qa, i) => `Q${i + 1}: ${qa.question}\nA: ${qa.answer}`).join('\n\n')
    : '';
  return brief + answersText;
}

async function runArchitect(context) {
  const prompt = `You are a senior software architect. Analyze this project brief and clarifications.

${context}

Output ONLY this JSON (no markdown, no explanation):
{
  "systemDesign": "2-3 sentence architecture description",
  "techStack": [{ "layer": "frontend", "choice": "React", "reason": "..." }, ...],
  "modules": [{ "name": "AuthModule", "responsibility": "...", "interfaces": ["..."] }, ...],
  "infrastructure": "describe hosting, CI/CD, environments",
  "scalingStrategy": "how the system scales",
  "technicalRisks": ["risk 1", "risk 2"]
}`;

  const res = await callModel([{ role: 'user', content: prompt }], FAST_MODEL, PERSONA_MAX_TOKENS);
  return extractJSON(extractText(res));
}

async function runPM(context) {
  const prompt = `You are a product manager. Analyze this project brief and clarifications.

${context}

Output ONLY this JSON (no markdown, no explanation):
{
  "phases": [
    {
      "number": 1,
      "name": "Foundation",
      "goal": "...",
      "tasks": ["task 1", "task 2"],
      "acceptanceCriteria": ["criterion 1", "criterion 2"],
      "estimatedWeeks": 2
    }
  ],
  "outOfScope": ["item 1"],
  "successMetrics": [{ "metric": "...", "target": "...", "measuredBy": "..." }],
  "assumptions": ["assumption 1"]
}`;

  const res = await callModel([{ role: 'user', content: prompt }], FAST_MODEL, PERSONA_MAX_TOKENS);
  return extractJSON(extractText(res));
}

async function runSecurity(context) {
  const prompt = `You are a security engineer. Analyze this project brief and clarifications.

${context}

Output ONLY this JSON (no markdown, no explanation):
{
  "threatModel": [{ "threat": "...", "likelihood": "high|medium|low", "impact": "high|medium|low" }],
  "dataClassification": ["what PII or sensitive data is involved"],
  "authStrategy": "recommended auth approach with reasoning",
  "complianceFlags": ["GDPR", "SOC2", etc. if applicable],
  "securityTasks": ["concrete task to add to the plan"],
  "flags": ["urgent security concern 1"]
}`;

  const res = await callModel([{ role: 'user', content: prompt }], FAST_MODEL, PERSONA_MAX_TOKENS);
  return extractJSON(extractText(res));
}

// ─── Step 4: GSD-style synthesis ─────────────────────────────────────────────

async function runSynthesis(brief, qna, architect, pm, security) {
  const qnaSection = qna.length
    ? qna.map((qa, i) => `Q${i + 1}: ${qa.question}\nA: ${qa.answer}`).join('\n')
    : 'None';

  const prompt = `You are a technical lead producing a detailed project plan for a development team.

## Project Brief
${brief}

## Developer Clarifications
${qnaSection}

## Architect Analysis
${JSON.stringify(architect, null, 2)}

## PM Analysis
${JSON.stringify(pm, null, 2)}

## Security Analysis
${JSON.stringify(security, null, 2)}

Produce a complete, detailed PLAN.md. Use this exact structure:

---

# Project Plan — [extract project name from brief]

## Overview
[2-3 sentences. What is being built, for whom, and why.]

## Clarifications
[Table of the developer's Q&A answers]
| Question | Answer |
|----------|--------|
| ... | ... |

## Tech Stack
| Layer | Choice | Reason |
|-------|--------|--------|
| ... | ... | ... |

## Architecture
[Describe the system design in detail — components, data flow, module boundaries, infrastructure]

## Phases

### Phase 1 — [Name]
**Goal:** [one sentence]
**Timeline:** [X weeks]

**Tasks:**
- [ ] [concrete task with file path or component name where relevant]
- [ ] ...

**Acceptance Criteria:**
- [ ] [verifiable outcome]
- [ ] ...

### Phase 2 — [Name]
[same structure]

[continue for all phases]

## Security Plan
| Threat | Likelihood | Impact | Mitigation |
|--------|-----------|--------|-----------|
| ... | ... | ... | ... |

**Auth strategy:** [recommendation]
**Compliance flags:** [list or "None"]
**Security tasks added to phases:** [list]

## Success Metrics
| Metric | Target | Measured By |
|--------|--------|------------|
| ... | ... | ... |

## Risks
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| ... | ... | ... | ... |

## Tensions
[List genuine disagreements between personas — e.g. architect wants microservices but PM says ship monolith first. If none, write "None identified."]

## Assumptions
[Bulleted list of assumptions the plan depends on]

## Out of Scope
[Bulleted list]

## Branch Naming (GIT-OS)
- \`feat/<name>\` from main
- \`fix/<name>\` from main
- \`chore/<name>\` from main

---`;

  const res = await callModel([{ role: 'user', content: prompt }], SMART_MODEL, SYNTHESIS_MAX_TOKENS);
  return extractText(res);
}

// ─── Cost tracking ────────────────────────────────────────────────────────────

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
    estimatedCost: 0.00,
    model: FAST_MODEL,
  });

  fs.writeFileSync(usageFile, JSON.stringify(usage, null, 2));
}

// ─── CODEBASE.md seed ─────────────────────────────────────────────────────────

function buildCodebaseDoc(architect) {
  const modules = (architect.modules || [])
    .map(m => `- **${m.name}**: ${m.responsibility}`)
    .join('\n');

  const stack = (architect.techStack || [])
    .map(t => `- **${t.layer}**: ${t.choice} — ${t.reason}`)
    .join('\n');

  return `# Codebase Structure

> Auto-generated from greenfield planning. Update as the project evolves.

## Tech Stack
${stack || '(see PLAN.md)'}

## Module Boundaries
${modules || '(see PLAN.md)'}

## Infrastructure
${architect.infrastructure || '(see PLAN.md)'}

## Notes
- Update this file as new modules are added
- Reference PLAN.md for architecture decisions and phase breakdown
`;
}

// ─── Prompt for brief ─────────────────────────────────────────────────────────

async function promptForBrief() {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\nDescribe your project: ', answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!ANTHROPIC_API_KEY) {
    console.error('Error: OPENROUTER_API_KEY or ANTHROPIC_API_KEY is required.');
    console.error('Add it to .env: OPENROUTER_API_KEY=sk-or-...');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const targetDir = (args[0] && !args[0].startsWith('--')) ? args[0] : process.cwd();
  const skipQuestions = args.includes('--skip-questions');
  const briefArgIdx = args.indexOf('--brief');

  const briefFile = path.join(targetDir, 'BRIEF.md');
  const planFile = path.join(targetDir, 'PLAN.md');
  const codebaseFile = path.join(targetDir, 'CODEBASE.md');

  // Load or create brief
  let brief;
  if (briefArgIdx !== -1 && args[briefArgIdx + 1]) {
    brief = args[briefArgIdx + 1];
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(briefFile, brief);
    console.log('BRIEF.md created.');
  } else if (fs.existsSync(briefFile)) {
    brief = fs.readFileSync(briefFile, 'utf8').trim();
    console.log(`Loaded BRIEF.md (${brief.length} chars)`);
  } else {
    console.log('No BRIEF.md found.');
    brief = await promptForBrief();
    if (!brief) { console.error('No brief provided.'); process.exit(1); }
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(briefFile, brief);
    console.log('BRIEF.md created.');
  }

  // Q&A phase
  let qna = [];
  if (!skipQuestions) {
    qna = await runQandA(brief);
    console.log('\n─────────────────────────────────────────────');
    console.log('Thanks! Running persona agents...');
    console.log('─────────────────────────────────────────────');
  }

  const context = buildContext(brief, qna);
  const start = Date.now();

  console.log('\nRunning 3 persona agents in parallel...');
  const [architect, pm, security] = await Promise.all([
    runArchitect(context).then(r => { console.log('  Architect done'); return r; }),
    runPM(context).then(r => { console.log('  PM done'); return r; }),
    runSecurity(context).then(r => { console.log('  Security done'); return r; }),
  ]);

  console.log('\nSynthesizing plan...');
  const plan = await runSynthesis(brief, qna, architect, pm, security);

  fs.writeFileSync(planFile, plan);
  fs.writeFileSync(codebaseFile, buildCodebaseDoc(architect));
  logUsage(targetDir);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);
  console.log(`  PLAN.md     → ${planFile}`);
  console.log(`  CODEBASE.md → ${codebaseFile}`);
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
