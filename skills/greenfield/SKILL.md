---
name: greenfield
description: Parallel persona planning for new projects. Research agent runs first to build domain context, then Architect, PM, and Security agents run in parallel. Synthesis agent combines all perspectives into a detailed GSD-style PLAN.md with Tensions section.
license: MIT
metadata:
  author: wednesday-solutions
  version: "2.0"
---

# Greenfield Planning Skill

## Trigger

Run once per project: `ws-skills plan`

Reads `BRIEF.md` from the project root (or prompts for one). Asks 5 clarifying questions before planning.

## Flow

```
Brief + Q&A
    ↓
Research agent (sequential)   ← domain landscape, ecosystem, hidden complexity
    ↓
┌─────────────────────────────────────┐
│ Architect │ PM │ Security (parallel)│  ← spawn 3 subagents simultaneously
└─────────────────────────────────────┘
    ↓
Synthesis             ← combines all into PLAN.md
```

## Agents

### 1. Research (sequential — runs first)

Builds domain context that all other agents receive. Covers:
- Existing solutions and their weaknesses
- Standard and emerging tech stacks for this domain
- Technologies to avoid and why
- Non-obvious domain challenges
- Integration landscape (auth, payments, comms, etc.)
- Regulatory and compliance context
- Realistic timeline based on similar projects
- Hidden complexity — things that take 3x longer than expected
- Success patterns from the best products in this space

Output: `research.md`

### 2–4. Architect, PM, Security (parallel subagents)

Spawn all three simultaneously using the Agent tool. Each receives the full brief, Q&A, and research output as context.

```
Agent 1 — Architect
Agent 2 — PM           ← launch all three in a single message, do not wait
Agent 3 — Security
```

Wait for all three to complete before running Synthesis.

**Architect** output: `architect.md`
- System design overview
- Tech stack with rationale per layer
- Module boundaries and interfaces
- Infrastructure and CI/CD
- Scaling strategy
- Technical risks

**PM** output: `pm.md`
- Phases with tasks and acceptance criteria
- Success metrics
- Out of scope items
- Assumptions

**Security** output: `security.md`
- Threat model (likelihood + impact)
- Data classification
- Auth strategy recommendation
- Compliance flags
- Concrete security tasks
- Urgent flags

### 5. Synthesis

Combines research + all three persona outputs into a single PLAN.md covering:
- Overview
- Clarifications table
- Tech stack
- Architecture
- Phases with tasks and acceptance criteria
- Security plan
- Success metrics
- Risks
- Tensions (unresolved disagreements between personas)
- Assumptions
- Out of scope
- Branch naming (GIT-OS format)

Output: `PLAN.md`

## Output Location

All files written to `.wednesday/plans/` in the target directory:

```
.wednesday/plans/
├── research.md    ← domain context
├── architect.md   ← technical design
├── pm.md          ← phases and metrics
├── security.md    ← threat model
└── PLAN.md        ← combined PRD (primary output)
```

## Failure Handling

Each agent fails independently. If one fails, the others continue and synthesis runs with whatever data is available. Failed agents show `[partial fallback]` in the progress display.

## Rules

- Branch naming in PLAN.md must follow GIT-OS format
- Never generate `CODEBASE.md` for greenfield projects — it doesn't exist yet
- Cost target: under $0.20 per run
