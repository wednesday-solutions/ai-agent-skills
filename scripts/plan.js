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
const os = require('os');

// Load .env from cwd (local project), then ~/.wednesday/.env (global fallback)
function loadEnv() {
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(os.homedir(), '.wednesday', '.env'),
  ];
  for (const envFile of candidates) {
    if (fs.existsSync(envFile)) {
      const lines = fs.readFileSync(envFile, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        if (key && !(key in process.env)) process.env[key] = val;
      }
      break; // stop at first found
    }
  }
}
loadEnv();

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
  // Extract the first balanced { } or [ ] block — avoids trailing content issues
  function extractBalanced(str, open, close) {
    const start = str.indexOf(open);
    if (start === -1) return null;
    let depth = 0, inStr = false, escape = false;
    for (let i = start; i < str.length; i++) {
      const c = str[i];
      if (escape) { escape = false; continue; }
      if (c === '\\' && inStr) { escape = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) return str.slice(start, i + 1); }
    }
    return null;
  }

  const raw = extractBalanced(text, '{', '}') || extractBalanced(text, '[', ']');
  if (!raw) throw new Error(`No JSON found:\n${text.slice(0, 500)}`);

  try { return JSON.parse(raw); }
  catch {
    try {
      const fixed = raw
        .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3')
        .replace(/'/g, '"')
        .replace(/,(\s*[}\]])/g, '$1');
      return JSON.parse(fixed);
    } catch (e2) {
      throw new Error(`JSON parse failed: ${e2.message}\n${raw.slice(0, 300)}`);
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

// ─── Step 3: Research agent (runs before personas) ───────────────────────────

async function runResearch(brief, qna) {
  const qnaSection = qna.length
    ? '\n\nDeveloper clarifications:\n' + qna.map((qa, i) => `Q${i+1}: ${qa.question}\nA: ${qa.answer}`).join('\n\n')
    : '';

  const prompt = `You are a domain research analyst. A developer is about to build this project:

${brief}${qnaSection}

Research this project space deeply before any technical planning begins. Output ONLY this JSON:
{
  "domain": "one sentence — what industry/space this operates in",
  "existingSolutions": [{ "name": "...", "approach": "...", "weakness": "..." }],
  "techEcosystem": {
    "standardStacks": ["what most teams in this space use and why"],
    "emergingOptions": ["newer alternatives worth considering"],
    "avoidList": ["technologies that seem obvious but cause problems in this domain"]
  },
  "domainChallenges": ["non-obvious hard problems specific to this type of product"],
  "integrationLandscape": ["third-party services typically required (auth, payments, comms, etc.)"],
  "regulatoryContext": ["relevant compliance, data laws, or industry standards"],
  "typicalTimeline": "realistic MVP timeline for a team of 3-5 based on similar projects",
  "hiddenComplexity": ["things that seem simple but take 3x longer than expected"],
  "successPatterns": ["what the best products in this space got right"]
}`;

  const res = await callModel([{ role: 'user', content: prompt }], FAST_MODEL, PERSONA_MAX_TOKENS);
  return extractJSON(extractText(res));
}

function buildResearchDoc(research) {
  const existing = (research.existingSolutions || [])
    .map(s => `| ${s.name} | ${s.approach} | ${s.weakness} |`).join('\n');
  const stacks = (research.techEcosystem?.standardStacks || []).map(s => `- ${s}`).join('\n');
  const emerging = (research.techEcosystem?.emergingOptions || []).map(s => `- ${s}`).join('\n');
  const avoid = (research.techEcosystem?.avoidList || []).map(s => `- ${s}`).join('\n');
  const challenges = (research.domainChallenges || []).map(s => `- ${s}`).join('\n');
  const integrations = (research.integrationLandscape || []).map(s => `- ${s}`).join('\n');
  const regulatory = (research.regulatoryContext || []).map(s => `- ${s}`).join('\n');
  const hidden = (research.hiddenComplexity || []).map(s => `- ⚠ ${s}`).join('\n');
  const success = (research.successPatterns || []).map(s => `- ${s}`).join('\n');

  return `# Domain Research

## Domain
${research.domain || '—'}

## Existing Solutions
| Name | Approach | Weakness |
|------|----------|----------|
${existing || '| — | — | — |'}

## Tech Ecosystem
**Standard stacks:**
${stacks || '—'}

**Emerging options:**
${emerging || '—'}

**Avoid:**
${avoid || '—'}

## Domain Challenges
${challenges || '—'}

## Integration Landscape
${integrations || '—'}

## Regulatory Context
${regulatory || 'None identified'}

## Typical Timeline
${research.typicalTimeline || '—'}

## Hidden Complexity
${hidden || '—'}

## Success Patterns
${success || '—'}
`;
}

// ─── Step 4: Persona agents ───────────────────────────────────────────────────

function buildContext(brief, qna, research) {
  const answersText = qna.length
    ? '\n\nClarifications from the developer:\n' +
      qna.map((qa, i) => `Q${i + 1}: ${qa.question}\nA: ${qa.answer}`).join('\n\n')
    : '';
  const researchText = research && Object.keys(research).length
    ? '\n\n## Domain Research (use this to inform your analysis)\n' + JSON.stringify(research, null, 2)
    : '';
  return brief + answersText + researchText;
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

async function runSynthesis(brief, qna, research, architect, pm, security) {
  const qnaSection = qna.length
    ? qna.map((qa, i) => `Q${i + 1}: ${qa.question}\nA: ${qa.answer}`).join('\n')
    : 'None';

  const prompt = `You are a technical lead producing a detailed project plan for a development team.

## Project Brief
${brief}

## Developer Clarifications
${qnaSection}

## Domain Research
${JSON.stringify(research, null, 2)}

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

// ─── Individual agent markdown files ─────────────────────────────────────────

function buildArchitectDoc(architect) {
  const stack = (architect.techStack || [])
    .map(t => `| ${t.layer} | ${t.choice} | ${t.reason} |`)
    .join('\n');

  const modules = (architect.modules || [])
    .map(m => `### ${m.name}\n- **Responsibility:** ${m.responsibility}\n- **Interfaces:** ${(m.interfaces || []).join(', ')}`)
    .join('\n\n');

  const risks = (architect.technicalRisks || []).map(r => `- ${r}`).join('\n');

  return `# Architect Analysis

## System Design
${architect.systemDesign || '—'}

## Tech Stack
| Layer | Choice | Reason |
|-------|--------|--------|
${stack || '| — | — | — |'}

## Module Boundaries
${modules || '—'}

## Infrastructure
${architect.infrastructure || '—'}

## Scaling Strategy
${architect.scalingStrategy || '—'}

## Technical Risks
${risks || '—'}
`;
}

function buildPMDoc(pm) {
  const phases = (pm.phases || []).map(p =>
    `### Phase ${p.number} — ${p.name}\n**Goal:** ${p.goal}\n**Estimated weeks:** ${p.estimatedWeeks}\n\n**Tasks:**\n${(p.tasks || []).map(t => `- [ ] ${t}`).join('\n')}\n\n**Acceptance Criteria:**\n${(p.acceptanceCriteria || []).map(c => `- [ ] ${c}`).join('\n')}`
  ).join('\n\n');

  const metrics = (pm.successMetrics || [])
    .map(m => `| ${m.metric} | ${m.target} | ${m.measuredBy} |`)
    .join('\n');

  const outOfScope = (pm.outOfScope || []).map(i => `- ${i}`).join('\n');
  const assumptions = (pm.assumptions || []).map(i => `- ${i}`).join('\n');

  return `# PM Analysis

## Phases
${phases || '—'}

## Success Metrics
| Metric | Target | Measured By |
|--------|--------|------------|
${metrics || '| — | — | — |'}

## Out of Scope
${outOfScope || '—'}

## Assumptions
${assumptions || '—'}
`;
}

function buildSecurityDoc(security) {
  const threats = (security.threatModel || [])
    .map(t => `| ${t.threat} | ${t.likelihood} | ${t.impact} |`)
    .join('\n');

  const tasks = (security.securityTasks || []).map(t => `- [ ] ${t}`).join('\n');
  const flags = (security.flags || []).map(f => `- ⚠ ${f}`).join('\n');
  const data = (security.dataClassification || []).map(d => `- ${d}`).join('\n');
  const compliance = (security.complianceFlags || []).join(', ') || 'None';

  return `# Security Analysis

## Threat Model
| Threat | Likelihood | Impact |
|--------|-----------|--------|
${threats || '| — | — | — |'}

## Data Classification
${data || '—'}

## Auth Strategy
${security.authStrategy || '—'}

## Compliance Flags
${compliance}

## Security Tasks
${tasks || '—'}

## Flags (Urgent)
${flags || '—'}
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
  const plansDir = path.join(targetDir, '.wednesday', 'plans');

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

  const start = Date.now();

  // ── Live progress display ──────────────────────────────────────────────────
  const SPIN = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

  const stages = {
    research:  { name: 'Research',  desc: 'domain landscape, ecosystem, hidden complexity', state: 'running', elapsed: 0, startedAt: Date.now() },
    architect: { name: 'Architect', desc: 'system design, tech stack, module boundaries',   state: 'waiting', elapsed: 0, startedAt: 0 },
    pm:        { name: 'PM',        desc: 'phases, acceptance criteria, success metrics',    state: 'waiting', elapsed: 0, startedAt: 0 },
    security:  { name: 'Security',  desc: 'threat model, auth strategy, compliance flags',  state: 'waiting', elapsed: 0, startedAt: 0 },
    synthesis: { name: 'Synthesis', desc: 'combining all perspectives into PLAN.md',        state: 'waiting', elapsed: 0, startedAt: 0 },
  };
  let spinIdx = 0;

  function stageIcon(s) {
    if (s.state === 'running') return `\x1b[36m${SPIN[spinIdx]}\x1b[0m`;
    if (s.state === 'done')    return '\x1b[32m✓\x1b[0m';
    if (s.state === 'failed')  return '\x1b[31m✗\x1b[0m';
    return '\x1b[90m·\x1b[0m';
  }
  function stageLabel(s) {
    if (s.state === 'running') return `\x1b[36m${s.name}\x1b[0m`;
    if (s.state === 'done')    return `\x1b[32m${s.name}\x1b[0m`;
    if (s.state === 'failed')  return `\x1b[31m${s.name}\x1b[0m`;
    return `\x1b[90m${s.name}\x1b[0m`;
  }

  function renderProgress() {
    const lines = ['\n'];
    const keys = Object.keys(stages);
    for (let i = 0; i < keys.length; i++) {
      const s = stages[keys[i]];
      const elapsed = s.state === 'running' ? ` \x1b[90m(${s.elapsed}s)\x1b[0m` : '';
      const fallback = s.state === 'failed' ? ` \x1b[31m[partial fallback]\x1b[0m` : '';
      const sep = i === 0 ? '' : i === 1 ? `\n  \x1b[90m── parallel ────────────────────────────────────\x1b[0m\n` : '';
      lines.push(`${sep}  ${stageIcon(s)} ${stageLabel(s).padEnd(26)} \x1b[90m${s.desc}\x1b[0m${elapsed}${fallback}`);
    }
    lines.push('');
    return lines.join('\n');
  }

  let lastLineCount = 0;
  function redraw() {
    if (lastLineCount > 0) process.stdout.write(`\x1b[${lastLineCount}A\x1b[J`);
    const output = renderProgress();
    lastLineCount = output.split('\n').length;
    process.stdout.write(output);
    spinIdx = (spinIdx + 1) % SPIN.length;
  }

  const ticker = setInterval(() => {
    for (const s of Object.values(stages)) {
      if (s.state === 'running') s.elapsed = ((Date.now() - s.startedAt) / 1000).toFixed(1);
    }
    redraw();
  }, 120);

  redraw();

  // ── Phase 1: Research ──────────────────────────────────────────────────────
  const research = await runResearch(brief, qna)
    .then(r  => { stages.research.state = 'done'; return r; })
    .catch(e => { stages.research.state = 'failed'; stages.research.desc = e.message.slice(0, 55); return {}; });

  // ── Phase 2: Parallel personas (enriched with research) ───────────────────
  for (const key of ['architect', 'pm', 'security']) {
    stages[key].state = 'running';
    stages[key].startedAt = Date.now();
  }
  redraw();

  const context = buildContext(brief, qna, research);

  const [architect, pm, security] = await Promise.all([
    runArchitect(context)
      .then(r => { stages.architect.state = 'done'; return r; })
      .catch(e => { stages.architect.state = 'failed'; stages.architect.desc = e.message.slice(0, 55); return {}; }),
    runPM(context)
      .then(r => { stages.pm.state = 'done'; return r; })
      .catch(e => { stages.pm.state = 'failed'; stages.pm.desc = e.message.slice(0, 55); return {}; }),
    runSecurity(context)
      .then(r => { stages.security.state = 'done'; return r; })
      .catch(e => { stages.security.state = 'failed'; stages.security.desc = e.message.slice(0, 55); return {}; }),
  ]);

  // ── Phase 3: Synthesis ────────────────────────────────────────────────────
  stages.synthesis.state = 'running';
  stages.synthesis.startedAt = Date.now();
  redraw();

  const plan = await runSynthesis(brief, qna, research, architect, pm, security);

  stages.synthesis.state = 'done';
  clearInterval(ticker);
  redraw();

  // ── Write outputs ──────────────────────────────────────────────────────────
  fs.mkdirSync(plansDir, { recursive: true });
  fs.writeFileSync(path.join(plansDir, 'research.md'),  buildResearchDoc(research));
  fs.writeFileSync(path.join(plansDir, 'architect.md'), buildArchitectDoc(architect));
  fs.writeFileSync(path.join(plansDir, 'pm.md'),        buildPMDoc(pm));
  fs.writeFileSync(path.join(plansDir, 'security.md'),  buildSecurityDoc(security));
  fs.writeFileSync(path.join(plansDir, 'PLAN.md'),      plan);
  logUsage(targetDir);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\x1b[32m  Done in ${elapsed}s\x1b[0m`);
  console.log(`\n  \x1b[90m.wednesday/plans/research.md\x1b[0m`);
  console.log(`  \x1b[90m.wednesday/plans/architect.md\x1b[0m`);
  console.log(`  \x1b[90m.wednesday/plans/pm.md\x1b[0m`);
  console.log(`  \x1b[90m.wednesday/plans/security.md\x1b[0m`);
  console.log(`  \x1b[32m.wednesday/plans/PLAN.md\x1b[0m  ← your project plan\n`);
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
