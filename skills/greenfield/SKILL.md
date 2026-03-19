---
name: greenfield
description: Parallel persona planning skill for new projects. Three Haiku agents (Architect, PM, Security) analyze BRIEF.md in parallel, Sonnet synthesizes into PLAN.md with a Tensions section.
license: MIT
metadata:
  author: wednesday-solutions
  version: "1.0"
---

# Greenfield Planning Skill

## Trigger

Run once per project: `wednesday-skills plan`

Reads `BRIEF.md` from the project root. If it doesn't exist, the CLI prompts for a project description and creates it.

## Three Parallel Personas

### Architect (Haiku)

```json
{
  "systemDesign": "...",
  "techStack": [...],
  "moduleBoundaries": [...],
  "concerns": [...]
}
```

### PM (Haiku)

```json
{
  "requirements": [...],
  "priorities": [...],
  "outOfScope": [...],
  "milestones": [...]
}
```

### Security (Haiku)

```json
{
  "threatSurface": [...],
  "dataRisks": [...],
  "authRecommendations": [...],
  "flags": [...]
}
```

## Synthesis (Sonnet)

Takes three JSON objects above. Outputs `PLAN.md`:

```markdown
# Project Plan — [name]

## Overview
## Architecture
## Requirements
## Security Considerations
## Milestones
## Tensions
  - Architect: microservices vs PM: ship monolith first → decision needed
## Branch Naming (GIT-OS)
  - feat/<name> from main
  - fix/<name> from main
```

## Rules

- `CODEBASE.md` seeded from Architect output after PLAN.md is generated
- Branch naming in PLAN.md must follow GIT-OS format
- Cost target: under $0.15 per run
- Each persona JSON output is token-limited to keep Sonnet synthesis cost predictable

## Cost Budget

| Call | Model | Est. cost |
|------|-------|-----------|
| Architect | Haiku | ~$0.02 |
| PM | Haiku | ~$0.02 |
| Security | Haiku | ~$0.02 |
| Synthesis | Sonnet | ~$0.08 |
| **Total** | | **~$0.14** |
