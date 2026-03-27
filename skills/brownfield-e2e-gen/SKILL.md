---
name: brownfield-e2e-gen
description: Interactive E2E test generation with auto-verification. Queries the brownfield graph for code structure, ideates test flows, asks targeted questions, generates tests in confidence tiers, auto-tests and fixes failures, then produces a verified report ready to attach to a PR.
permissions:
  allow:
    - Read(.wednesday/codebase/dep-graph.json)
    - Read(.wednesday/codebase/summaries.json)
    - Read(.wednesday/codebase/MASTER.md)
    - Bash(git diff *)
    - Bash(npm test *)
    - Bash(npm run test *)
    - Bash(npx jest *)
    - Bash(npx vitest *)
    - Bash(node --test *)
    - Write(test/e2e/*)
    - Write(.wednesday/e2e-reports/*)
---

# brownfield-e2e-gen — Agentic E2E Test Generator

## Trigger

Load this skill when:
- `pr-create` asks "Generate E2E tests?"
- Dev runs: `wednesday-skills e2e-gen`
- Dev says: "Generate tests for this feature"

---

## Flow Overview

```
1. Ask what we're testing
2. Query brownfield DB (NOT raw source files)
3. Ideate: identify flows, categorize by confidence
4. Ask user: which tiers to generate?
5. Generate → Auto-test → Auto-fix loop (per tier)
6. Generate report
7. Store report to .wednesday/e2e-reports/
8. Show user summary → get approval
9. Return { approved, testFiles, reportPath }
```

---

## Step 1 — Ask What We're Testing

Ask the user ONE question:

> "What feature or flow should I generate E2E tests for?
> (A brief description helps — e.g. 'OAuth login with email verification')"

Store their answer as `featureDescription`.

---

## Step 2 — Query Brownfield DB (Token-Efficient)

**Do NOT read raw source files.**
Use brownfield graph only.

```bash
# Get list of changed files since main
git diff origin/main...HEAD --name-only
```

For each changed file, read ONLY its node from `dep-graph.json`:
- `exports` — what it exposes
- `imports` — what it depends on
- `importedBy` — what uses it
- `riskScore` — criticality
- `symbols` — functions/classes

Also read `MASTER.md` → entry points and primary flows section only.

**Token budget: keep context under 800 tokens total.**

---

## Step 3 — Ideate: Identify Flows & Categorize

Using the graph data + feature description, identify test flows and assign confidence tiers:

### Tier 1 — High Confidence (≥80%)
Characteristics:
- Clear input → output (pure functions, HTTP endpoints)
- Entry point visible in graph
- No external services OR services are well-known (HTTP, DB)
- Existing test patterns in project to follow
- Deterministic, no timing dependencies

### Tier 2 — Medium Confidence (60–79%)
Characteristics:
- Async flows that need mocking
- External service integrations
- Multi-step flows with state
- Can be generated but may need 1–2 fixes

### Tier 3 — Low Confidence (<60%)
Characteristics:
- Business logic that requires domain knowledge
- Security constraints (auth, encryption, rate limits)
- Performance requirements
- Anything needing non-obvious test data

**For Tier 3: generate hints only — no runnable test code.**

Show the tier breakdown to the user before continuing.

---

## Step 4 — Ask User: Which Tiers to Generate?

Present each tier clearly:

```
Tier 1 (High confidence - 85%+ accuracy):
  • [list flows]
  Generate these? [YES/NO]

Tier 2 (Medium confidence - 70% accuracy, may need tweaks):
  • [list flows]
  Generate these? [YES/NO]

Tier 3 (Low confidence - hints only, no runnable tests):
  • [list areas]
  Include hints? [YES/NO]
```

Also ask **targeted questions only for Tier 2 doubts**. For example:
- "Should token expiry be tested? (Y/N)"
- "Do you want error path tests for invalid inputs? (Y/N)"

Keep questions minimal — 3 max. Don't ask about things the graph already answers.

---

## Step 5 — Generate → Auto-Test → Auto-Fix Loop

### Test File Naming
```
test/e2e/<feature-slug>-tier1.spec.ts   # Tier 1 tests
test/e2e/<feature-slug>-tier2.spec.ts   # Tier 2 tests
test/e2e/<feature-slug>-hints.md        # Tier 3 hints
```

### Detect Test Runner
Check `package.json` scripts and devDependencies:
- `jest` → `npx jest <file>`
- `vitest` → `npx vitest run <file>`
- `node:test` → `node --test <file>`
- Fallback → `npm test`

### For Each Tier (1 and 2):

1. Generate test code based on:
   - Graph structure (imports, exports, symbols)
   - User's feature description
   - User's answers to targeted questions
   - Existing test files as style patterns (read 1 existing test file max)

2. Write test file

3. Run tests:
```bash
npx jest test/e2e/<feature-slug>-tier1.spec.ts --no-coverage 2>&1
```

4. If PASS → mark as verified, continue to next tier

5. If FAIL → enter auto-fix loop:
   - Read error output
   - Identify root cause (missing mock, wrong import path, wrong assertion)
   - Fix the test code
   - Re-run
   - Max **3 attempts** per tier
   - If still failing after 3 → downgrade to Tier 3 (add to hints, don't include test)

### For Tier 3:
Generate a markdown hints file only — no runnable code:
```markdown
# Test Hints — <feature>

## Security Tests (manual review needed)
- [ ] CSRF protection on <endpoint>
- [ ] Rate limiting: <description>

## Business Logic Tests (domain knowledge needed)
- [ ] <specific scenario>
```

---

## Step 6 — Generate Report

Create a comprehensive report at:
`.wednesday/e2e-reports/<feature-slug>-<YYYY-MM-DD>.md`

### Report Format

```markdown
# E2E Test Report — <Feature Name>
Generated: <timestamp>
Status: ✅ Ready / ⚠️ Partial

---

## Summary
| Tier | Tests | Status |
|------|-------|--------|
| Tier 1 (High Confidence) | N | ✅ All passing |
| Tier 2 (Medium Confidence) | N | ✅ All passing / ⚠️ N downgraded |
| Tier 3 (Hints Only) | N items | ⚠️ Manual review needed |

---

## Tier 1: Verified Tests

### <Test Name>
- **Status:** ✅ PASSING
- **Confidence:** 90%
- **File:** test/e2e/<feature>-tier1.spec.ts
- **Covers:** <what this tests>

---

## Tier 2: Auto-Fixed Tests

### <Test Name>
- **Status:** ✅ PASSING (auto-fixed: <what was fixed>)
- **Confidence:** 75%
- **File:** test/e2e/<feature>-tier2.spec.ts
- **Covers:** <what this tests>
- **Fix applied:** <description of what was fixed>

---

## Tier 3: Manual Review Items

### Security
- [ ] <item> — <reason it needs manual implementation>

### Business Logic
- [ ] <item> — <reason>

---

## Test Files Created
- `test/e2e/<feature>-tier1.spec.ts` — <N> tests, all passing
- `test/e2e/<feature>-tier2.spec.ts` — <N> tests, all passing
- `test/e2e/<feature>-hints.md` — <N> manual items

## Token Usage
- Graph queries: ~<N> tokens
- LLM ideation: ~<N> tokens
- Test generation: ~<N> tokens
- Auto-fix iterations: <N> (tokens: ~<N>)
- **Total: ~<N> tokens**

## Time Saved
Manual estimate: ~<N> hours
Actual generation: ~<N> minutes
```

---

## Step 7 — Show Summary & Get Approval

Show the user a concise summary:

```
✅ E2E Test Generation Complete

  Tier 1: 2 tests — all passing
  Tier 2: 1 test — passing (1 auto-fix applied)
  Tier 3: 3 manual review items

  Files:
    test/e2e/oauth-tier1.spec.ts
    test/e2e/oauth-tier2.spec.ts
    test/e2e/oauth-hints.md
    .wednesday/e2e-reports/oauth-2026-03-27.md

Include these in the PR? [YES/NO]
```

**Wait for explicit user approval before returning.**

---

## Step 8 — Return to Caller (pr-create)

If approved, return:

```json
{
  "approved": true,
  "featureSlug": "oauth-login",
  "testFiles": [
    "test/e2e/oauth-tier1.spec.ts",
    "test/e2e/oauth-tier2.spec.ts"
  ],
  "hintsFile": "test/e2e/oauth-hints.md",
  "reportPath": ".wednesday/e2e-reports/oauth-2026-03-27.md",
  "summary": "3 tests generated & verified, 3 manual items",
  "tier1Count": 2,
  "tier2Count": 1,
  "tier3Count": 3
}
```

If declined → return `{ "approved": false }` — pr-create continues without tests.

---

## Token Budget Rules

| Step | Max Tokens | Notes |
|------|-----------|-------|
| Graph data | 800 | Structured JSON, no raw source |
| Feature description | 100 | User input |
| Ideation | 400 | LLM identifies flows |
| Per-test generation | 500 | One test at a time |
| Per auto-fix | 300 | Error + fix only |
| **Total budget** | **3500** | Abort if exceeded — report what was generated |

If approaching token limit mid-generation:
- Complete current test
- Stop generating new ones
- Note in report: "Token limit reached — remaining flows skipped"

---

## Never

- Read raw `.ts`, `.js`, `.go` source files to understand structure — use dep-graph.json
- Generate Tier 3 as runnable tests — hints only
- Skip the auto-test loop — all generated tests must be run
- Include failing tests in the output — only passing or hints
- Ask more than 3 clarifying questions — keep it focused
- Exceed the token budget per step

---

## Tools

| Action | Tool |
|--------|------|
| Read graph data | `Read(.wednesday/codebase/dep-graph.json)` |
| Read architecture | `Read(.wednesday/codebase/MASTER.md)` |
| Get changed files | `Bash(git diff origin/main...HEAD --name-only)` |
| Read one existing test for style | `Read(test/...)` |
| Run tests | `Bash(npx jest ... / npx vitest ... / node --test ...)` |
| Write test files | `Write(test/e2e/...)` |
| Write report | `Write(.wednesday/e2e-reports/...)` |
