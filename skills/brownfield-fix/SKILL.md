---
name: brownfield-fix
description: Use before editing any file in a brownfield project. Runs risk check and blast radius before making any change.
permissions:
  allow:
    - Bash(wednesday-skills query *)
    - Read(.wednesday/codebase/MASTER.md)
---

## When to use
- About to edit, refactor, rename, or delete any file
- About to change a function signature or exported value
- Dev asks "is it safe to change X"

## What to do
1. **Assessment**: Run `Bash(wednesday-skills query getFileSummary <file_path>)`
   - Review the `riskScore` (0–100)
   - Review the `blastRadius.transitive` count
2. **Guidelines based on Score**:
   - Score 0–30: proceed
   - Score 31–60: tell dev the score, proceed with care
   - Score 61–80: tell dev, list direct dependents, ask confirmation
   - Score 81–100: stop, tell dev, require explicit approval
3. **Context**: Read `Danger Zones` in `.wednesday/codebase/MASTER.md`
   - If the file is mentioned there, follow the specific warnings.
4. **Make the change**
5. **Update**: After committing, the graph will update automatically.

## Never
- Skip the risk check — even for "small" changes.
- Modify a file with risk score > 80 without explicit dev confirmation.
- Bundle fixes to multiple high-risk files in one commit.

## Tools
Use Bash tool for:
- `wednesday-skills query getFileSummary <file>` — get risk, blast, and dependencies in one call.
Use Read tool for:
- `.wednesday/codebase/MASTER.md` — check Danger Zones.
