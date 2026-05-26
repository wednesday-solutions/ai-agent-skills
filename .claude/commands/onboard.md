# /onboard — Developer Onboarding Brief

## Purpose
Generate a personalized onboarding brief for a new developer joining the project.

## Trigger
- "Generate an onboarding guide"
- "I'm new to this project, where do I start?"
- "Create a developer onboarding brief"

Type: `/onboard`

---

## Steps

### 1. Load codebase statistics from DB
```javascript
const queries = require('./.claude/query-helpers.js');
const stats = queries.getCodebaseStats();
```

Returns:
- totalFiles, totalEdges, totalLines
- languages (array with counts)
- averageRiskScore, medianRiskScore
- graphCoverage (%)
- testedFiles (count)

### 2. Load MASTER.md
Read `.wednesday/codebase/MASTER.md` to extract:
- Product orientation (what the project does)
- Architecture overview
- Tech stack (languages + key libraries)
- Reading order (if available)

If MASTER.md doesn't exist, suggest running `/brownfield-map` first.

### 3. Identify risk files to avoid
```javascript
const highRiskFiles = queries.getHighRiskFiles(minRisk = 60);
```

Returns files with risk score > 60, sorted by risk. These are the danger zones.

### 4. Find entry points with confidence
```javascript
const entryPoints = queries.getHighConfidenceEntryPoints(threshold = 70);
```

Returns entry points sorted by confidence score. High confidence (>70%) are primary entry points.

### 5. Identify files by role
```javascript
const filesByRole = queries.getFilesByRole();
```

Groups files by their classification:
- Adapters (for external dependencies)
- Logic (core business logic)
- Infra (framework/middleware)
- Entry (entry points)
- Util (utilities)

### 6. Identify background processes
Background processes are included in MASTER.md and marked via role classification.
Adapters from step 5 show external integrations (DB, APIs, payment processors, etc.)

### 7. Build the onboarding brief

**Format:**

```markdown
# Onboarding Guide — <Project Name>

Welcome! This guide will help you ramp up on this codebase.

---

## What This Project Does

[From MASTER.md — 1-2 sentences]

Example: "This is an intelligent code analysis platform that helps developers understand complex codebases through dependency graphs, risk scoring, and AI-powered summaries. Used by 50+ companies to accelerate onboarding and reduce technical debt."

---

## Tech Stack

**Languages:** <list>  
**Frameworks:** <list>  
**Databases:** <list>  
**Key libraries:** <list>  

---

## Architecture

[From MASTER.md — 2-3 sentences]

Example: "The architecture follows a layered pattern: parsers read source code, the graph engine builds dependency relationships, analyzers compute risk and impacts, and LLM enrichment adds human-readable summaries. Data flows: parse → graph → analyze → summarize → output."

---

## Where to Start Reading

Read these files in order. Each builds context for the next:

1. **<entry-file-1>** — <what it does & why it's first>
2. **<core-file-1>** — <role in architecture>
3. **<core-file-2>** — <role>
...

[8-12 ordered files from the reading order or computed via fan-in]

> **Tip:** Each file has a summary in `.wednesday/codebase/summaries.json` if you get stuck.

---

## External Dependencies

This project talks to:

**Databases:**
- PostgreSQL (user data, cache layer)
- SQLite (local graph DB)

**APIs:**
- OpenRouter (LLM enrichment)
- GitHub API (PR comments, issue triage)

**Services:**
- SonarQube (code quality analysis)

⚠️ Most require API keys. Check `.env.example` for setup.

---

## Background Processes

- **Cron jobs:** <N> scheduled tasks
  - Daily: stale dependency check
  - Weekly: skill registry update
- **Event listeners:** PR webhooks, GitHub Actions triggers
- **Async workers:** LLM summarization (can take 30s per module)

---

## Files to Never Touch Without Asking

These are high-risk. Changes here cascade widely:

- **<risk-file-1>** (risk: 78/100)
  - <Why it's risky>
  - <Who to ask before touching>
  
- **<risk-file-2>** (risk: 72/100)
  - <Why>
  - <Owner>

[Top 3-5 danger zones]

---

## First Task Recommendation

To build confidence, start here:

1. Read the entry file and understand the command flow
2. Pick a low-risk utility file and trace its usage
3. Read the architecture summary in MASTER.md
4. Run `/brownfield-map` to generate fresh analysis
5. Use `/brownfield-chat` to ask questions as you go

Once comfortable:
- Pick a small bug from issues (marked "good first issue")
- Use `/brownfield-fix` before editing
- Use `/brownfield-blast` to see your change impact
- Open a PR — we'll review and guide you

---

## Useful Commands

```bash
# Understand any file
/brownfield-chat "what does <filename> do?"

# Check risk before editing
/brownfield-fix <filename>

# See change impact
/brownfield-blast <filename>

# Update codebase intelligence
/brownfield-map

# Score a specific file
/brownfield-score <filename>

# Find dead code
/brownfield-dead
```

---

## Questions?

If you're stuck:
- **Architecture:** Read MASTER.md, then ask in Slack
- **File purpose:** Use `/brownfield-chat <filename>`
- **Change impact:** Use `/brownfield-blast <filename>`
- **Onboarding:** Ask your mentor (assigned during intake)

Welcome to the team! 🚀
```

### 8. Save the output

Generate this as plain markdown, optionally save to `.claude/onboarding.md` or display directly.

---

## Fallback (if graph.db missing)

If the graph.db doesn't exist or is incomplete:
```bash
wednesday-skills map --full
```

This will:
1. Parse all source files and build the dependency graph
2. Compute risk scores, entry points, and roles
3. Detect daemons and adapters
4. Generate MASTER.md
5. Populate graph.db with all enrichment tables

After mapping completes, run `/onboard` again to generate the personalized brief.

---

## Error Handling

| Situation | Action |
|-----------|--------|
| Codebase not mapped | Suggest: `Run /brownfield-map first` |
| No entry points detected | Use heuristics: `index.js`, `main.js`, `cli.js` |
| Risk files > 50% of codebase | "⚠ This codebase has widespread risk. Recommend pair programming for first edits." |
| External deps very numerous | "This project has many integrations. Focus on core first, then expand." |

---

## Success Criteria

- [ ] Brief is readable by a senior dev in 10 minutes
- [ ] Reading order is accurate (can verify by tracing imports)
- [ ] Risk files are truly dangerous
- [ ] External deps are accurate
- [ ] First task is appropriate for day-1 developer
- [ ] All links point to real files
