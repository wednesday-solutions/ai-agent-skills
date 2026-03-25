---
name: brownfield-enrich
description: "Schema reference for comment enrichment. The enrichment workflow is printed by `wednesday-skills map` in the `[ENRICH]` block — follow those instructions."
permissions:
  allow:
    - Write(.wednesday/codebase/analysis/comments-enriched.json)
---

## When to use
This skill is a schema reference. The full enrichment workflow is printed by `wednesday-skills map`
in the `[ENRICH]` block when no API key is set — follow those steps directly.

Load this skill only when you need the `comments-enriched.json` format spec or the enrichment rules.

## What to do

1. Read `.wednesday/codebase/analysis/comments-raw.md`
   - Each `## \`dir/\`` section is one module
   - **Tagged** table: severity, tag, file, line, comment text
   - **Substantive untagged** list: developer explanations and architecture notes

2. The `[ENRICH]` block in the terminal output already printed a pre-populated template for
   `comments-enriched.json`. Use it — fill in the `null` fields for each module.

3. For each module that has tagged or untagged comments, determine:
   - `purpose`: 1 sentence — what does this module do, inferred from the comments
   - `techDebt`: `"high"` | `"medium"` | `"low"` | `"none"`
     - high = multiple FIXME/BUG/XXX or systemic HACK/KLUDGE
     - medium = several TODO/HACK
     - low = minor TODOs only
     - none = no debt signals
   - `isBizFeature`: `true` if this is a business feature (auth, payments, users, orders, notifications...)
                     `false` if infrastructure (utils, helpers, config, logging, db, cache...)
   - `ideas`: array of up to 3 concrete improvement suggestions drawn from the comments, or `[]`
   - Leave `purpose: null` for modules with zero comments — do not invent

4. Write `.wednesday/codebase/analysis/comments-enriched.json` using the **Write tool**
   (not Bash, not Python — just Write tool directly).

5. Report to dev:
   - How many modules were enriched
   - How many are biz features vs infrastructure
   - Top 3 modules by tech debt

## comments-enriched.json schema

This is a **flat overlay** — only enrichment fields. The CLI merges it with `comments.json` on load.
Do NOT copy the full comments.json structure. Write only this shape:

```json
{
  "enrichedAt": "2026-03-24T12:00:00.000Z",
  "reversePrd": "2–3 paragraphs: what the project does, who uses it, main flows, biggest debt areas",
  "modules": {
    "src/auth": {
      "purpose": "Handles JWT-based authentication and session management",
      "techDebt": "medium",
      "isBizFeature": true,
      "ideas": ["Extract token refresh into a dedicated service", "Add rate limiting to login"]
    },
    "src/utils": {
      "purpose": "Shared string/date utilities",
      "techDebt": "none",
      "isBizFeature": false,
      "ideas": []
    }
  }
}
```

## Never
- Read raw source files — only read `comments-raw.md`
- Write Python or Bash scripts to manipulate JSON — use the Write tool directly
- Run `wednesday-skills map` (full re-parse) — not needed; the CLI picks up enrichment automatically
- Write to `comments.json` directly — write to `comments-enriched.json` (the overlay)
