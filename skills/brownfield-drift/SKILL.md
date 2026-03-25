---
name: brownfield-drift
description: Enforces architecture boundaries defined in PLAN.md. Use when a PR crosses module/service boundaries, when the dev asks "are we following the architecture?", or as a scheduled architecture health check. Not for querying what a module does — use brownfield-chat for that.
permissions:
  allow:
    - Bash(wednesday-skills drift *)
    - Bash(git log *)
---

## When to use
- Dev asks "are we following the architecture?" or "is this a valid change?"
- PR touches files near module boundaries or service interfaces
- Weekly architecture health check
- Any cross-service import was just added

## When NOT to use
- "What does module X do?" → use **brownfield-chat**
- "What breaks if I change X?" → use **brownfield-chat**
- Graph coverage is low on a file → use **brownfield-fix (it fills gaps before editing)**
- No PLAN.md exists — drift requires machine-readable boundaries in PLAN.md

## What to do
1. Run `wednesday-skills drift` via Bash tool
2. Report violations with:
   - The specific edge that violates the rule
   - The commit that introduced it (when available)
   - The suggested fix per PLAN.md intent
3. For PR reviews: run `wednesday-skills drift --since <base-commit>` to only report new violations
4. For a single rule: `wednesday-skills drift --rule <rule-name>`

## Adding constraints to PLAN.md
If the project has no constraints block, add one to PLAN.md:

```json
{
  "boundaries": [
    {
      "rule": "frontend-never-imports-db",
      "description": "Frontend components must never import DB layer directly",
      "from": "src/app/**",
      "to": "src/lib/db/**",
      "type": "forbidden"
    },
    {
      "rule": "no-circular-deps",
      "description": "No circular dependencies anywhere",
      "scope": "**",
      "type": "no-cycle"
    }
  ]
}
```

## Violation types
| Type | What it catches |
|------|----------------|
| `forbidden` | Import from A → B that should never exist |
| `ownership` | Logic pattern appearing outside its designated owner |
| `no-direct-import` | Direct import between services that should use API |
| `no-cycle` | Circular dependency between modules |

## Never
- Auto-fix boundary violations — always ask the dev first
- Flag existing violations on a PR that did not introduce them (use `--since`)
- Run on projects without machine-readable PLAN.md constraints
- Report the same violation twice in one review session

## CLI reference
```bash
wednesday-skills drift                              # full check
wednesday-skills drift --rule frontend-never-imports-db  # single rule
wednesday-skills drift --since abc1234              # new drift only (for PR review)
```
