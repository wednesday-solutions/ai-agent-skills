---
name: brownfield-fix
description: Use before editing any file in a brownfield project. Runs risk check and blast radius before making any change.
permissions:
  allow:
    - Bash(wednesday-skills score *)
    - Bash(wednesday-skills blast *)
---

## When to use
- About to edit, refactor, rename, or delete any file
- About to change a function signature or exported value
- Dev asks "is it safe to change X"

## What to do
1. Run: wednesday-skills score <file>
   - Score 0–30: proceed
   - Score 31–60: tell dev the score, proceed with care
   - Score 61–80: tell dev, list direct dependents, ask confirmation
   - Score 81–100: stop, tell dev, require explicit approval
2. Run: wednesday-skills blast <file>
   - Include dependent count in your response
   - Cross-language dependents flagged separately
3. Check .wednesday/codebase/MASTER.md danger zones section
   - If file listed there: read the warning before proceeding
4. Make the change
5. Read git-os skill before writing commit message
6. After committing: post-commit hook updates graph automatically

## Never
- Skip the score check — even for "small" changes
- Modify a file with risk score > 80 without explicit dev confirmation
- Bundle fixes to multiple high-risk files in one commit
- Ignore danger zones section warnings

## Tools
Use Bash tool to run:
- `wednesday-skills score <file>` — get risk score
- `wednesday-skills blast <file>` — get blast radius
Use Read tool for:
- `.wednesday/codebase/MASTER.md` — check danger zones section

## Do NOT use
Do not skip score check for any file edit.
Do not read raw source to assess risk — use the graph only.
