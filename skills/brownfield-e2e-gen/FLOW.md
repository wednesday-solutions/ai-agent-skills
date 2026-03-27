# brownfield-e2e-gen — Complete Agentic Flow

## Overview

```
┌─────────────────────────────────────────────────────────┐
│ USER TRIGGERS: pr-create → "Generate E2E tests?"       │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ STEP 1: UNDERSTAND THE FEATURE                          │
│ Skill asks: "What are we testing?"                      │
│ User: "OAuth login with email verification"             │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ STEP 2: QUERY BROWNFIELD (Fast, Token-Efficient)        │
│ Skill queries graph for:                                │
│  - Entry points (APIs, functions)                       │
│  - Module structure & dependencies                      │
│  - Risk scores (what's critical)                        │
│  - Existing test patterns in project                    │
│ Returns: ~500 tokens (lightweight JSON)                 │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ STEP 3: IDEATE & CATEGORIZE                             │
│ LLM analyzes graph → plans test tiers                   │
│  Tier 1: OAuth redirect         (90% confidence)        │
│  Tier 2: Email verification     (72% confidence)        │
│  Tier 3: Security validations   (45% confidence)        │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ STEP 4: ASK USER (Narrow Scope)                         │
│ "Generate Tier 1 (high confidence)? [YES/NO]"           │
│ "Generate Tier 2 (medium, may need tweaks)? [YES/NO]"   │
│ "Include Tier 3 hints (low confidence)? [YES/NO]"       │
│                                                         │
│ Also ask up to 3 targeted questions for Tier 2 doubts:  │
│  "Should token expiry be tested? (Y/N)"                 │
│  "Test error paths for invalid inputs? (Y/N)"           │
└─────────────────────────────────────────────────────────┘
                          ↓
        ┌─────────────────┬──────────────────┬────────────┐
        ↓                 ↓                  ↓
   TIER 1             TIER 2            TIER 3
(if selected)      (if selected)      (if selected)
        ↓                 ↓                  ↓
┌────────────────────────────────────────────────────────┐
│ STEP 5A: GENERATE TIER 1 TESTS (High Confidence)       │
│                                                        │
│ Generate test code using:                              │
│  - Graph structure (imports, exports, symbols)         │
│  - User feature description                            │
│  - 1 existing test file as style pattern               │
│                                                        │
│ Write to: test/e2e/<feature>-tier1.spec.ts             │
└────────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────────┐
│ STEP 5B: AUTO-TEST TIER 1                              │
│                                                        │
│ Run: npx jest test/e2e/<feature>-tier1.spec.ts         │
│                                                        │
│ ✅ PASS → Mark "Verified & Ready", continue to Tier 2  │
│ ❌ FAIL → Enter auto-fix loop (max 3 attempts):        │
│    1. Read error output                                │
│    2. Identify root cause                              │
│    3. Fix test code                                    │
│    4. Re-run                                           │
│    Still failing after 3? → Downgrade to Tier 3 hints  │
└────────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────────┐
│ STEP 6A: GENERATE TIER 2 TESTS (Medium Confidence)     │
│                                                        │
│ Generate using same inputs + user answers from Step 4  │
│ Write to: test/e2e/<feature>-tier2.spec.ts             │
└────────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────────┐
│ STEP 6B: AUTO-TEST TIER 2                              │
│                                                        │
│ Run: npx jest test/e2e/<feature>-tier2.spec.ts         │
│                                                        │
│ ✅ PASS → Mark "Verified & Ready"                       │
│ ❌ FAIL → Auto-fix loop (max 3 attempts)               │
│    Fixed? → Mark "Auto-Fixed & Verified"               │
│    Still failing? → Downgrade to Tier 3 hints          │
└────────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────────┐
│ STEP 7: GENERATE TIER 3 HINTS (No Runnable Tests)      │
│                                                        │
│ Includes:                                              │
│  - Flows downgraded from Tier 1/2 (auto-fix failed)   │
│  - Original Tier 3 areas (security, performance, etc.) │
│                                                        │
│ Write to: test/e2e/<feature>-hints.md                  │
│                                                        │
│ Format:                                                │
│  ## Security Tests (manual review needed)              │
│  - [ ] CSRF protection on <endpoint>                   │
│  - [ ] Rate limiting: <description>                    │
└────────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────────┐
│ STEP 8: GENERATE REPORT                                │
│                                                        │
│ Stored at:                                             │
│ .wednesday/e2e-reports/<feature>-<YYYY-MM-DD>.md       │
│                                                        │
│ Contains:                                              │
│  - Summary table (tier / tests / status)               │
│  - Per-test details (confidence, file, what it covers) │
│  - Auto-fix notes (what was broken, what was fixed)    │
│  - Tier 3 manual review items                          │
│  - Test files created                                  │
│  - Token usage breakdown                               │
│  - Time saved estimate                                 │
└────────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────────┐
│ STEP 9: USER REVIEWS REPORT                            │
│                                                        │
│ Skill shows concise summary:                           │
│  "✅ Tier 1: 2 tests — passing"                         │
│  "✅ Tier 2: 1 test — passing (1 auto-fix applied)"     │
│  "⚠️  Tier 3: 3 manual items"                           │
│                                                        │
│ "Include these in the PR? [YES/NO]"                    │
│                                                        │
│ Wait for explicit approval — never auto-proceed.       │
└────────────────────────────────────────────────────────┘
                          ↓
                  [YES] ← User confirms
                          ↓
┌────────────────────────────────────────────────────────┐
│ STEP 10: RETURN TO pr-create                           │
│                                                        │
│ git add test/e2e/<feature>-*.spec.ts                   │
│                                                        │
│ Returns:                                               │
│  {                                                     │
│    approved: true,                                     │
│    testFiles: ['test/e2e/...'],                        │
│    hintsFile: 'test/e2e/...-hints.md',                 │
│    reportPath: '.wednesday/e2e-reports/....md',        │
│    summary: '3 tests verified, 3 manual items'         │
│  }                                                     │
└────────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────────┐
│ STEP 11: pr-create BUILDS PR BODY                      │
│                                                        │
│ ### E2E Tests                                          │
│ ✅ 3 tests generated & verified                         │
│ 📋 Report: .wednesday/e2e-reports/oauth-2026-03-27.md  │
│                                                        │
│ Then: git push → gh pr create → PR URL returned        │
└────────────────────────────────────────────────────────┘
```

---

## Auto-Fix Loop Detail

```
Generate test
      ↓
   Run test
      ↓
  PASS? ──YES──→ ✅ Keep, mark Verified
      │
      NO
      ↓
  Attempt 1:
  Read error → Ask LLM fix → Rewrite → Run
      ↓
  PASS? ──YES──→ ✅ Keep, mark Auto-Fixed
      │
      NO
      ↓
  Attempt 2:
  Read error → Ask LLM fix → Rewrite → Run
      ↓
  PASS? ──YES──→ ✅ Keep, mark Auto-Fixed
      │
      NO
      ↓
  Attempt 3:
  Read error → Ask LLM fix → Rewrite → Run
      ↓
  PASS? ──YES──→ ✅ Keep, mark Auto-Fixed
      │
      NO
      ↓
  ❌ Downgrade to Tier 3 hints
```

---

## Token Budget

| Step | Max Tokens | Notes |
|------|-----------|-------|
| Graph data (Step 2) | 800 | Structured JSON only, no raw source |
| Feature description (Step 1) | 100 | User input |
| LLM ideation (Step 3) | 400 | Flow identification + tier assignment |
| Per-test generation (Step 5/6) | 500 | One test at a time |
| Per auto-fix iteration | 300 | Error output + fix only |
| **Total budget** | **3500** | Abort if exceeded, report what was done |

---

## Confidence Tier Criteria

| Tier | Confidence | Characteristics | Output |
|------|-----------|-----------------|--------|
| **Tier 1** | ≥80% | Pure functions, HTTP endpoints, deterministic flows, no timing | Full runnable test |
| **Tier 2** | 60–79% | Async flows, external mocks, multi-step state | Full runnable test + may auto-fix |
| **Tier 3** | <60% | Business logic, security, performance, domain knowledge | Hints only, no code |

---

## Files Created

```
test/
  e2e/
    <feature>-tier1.spec.ts     ← Tier 1 verified tests
    <feature>-tier2.spec.ts     ← Tier 2 verified tests
    <feature>-hints.md          ← Tier 3 manual review items

.wednesday/
  e2e-reports/
    <feature>-<YYYY-MM-DD>.md   ← Full verification report
```
