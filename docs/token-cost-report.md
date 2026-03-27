# Token Cost & Savings Report

Every LLM-backed command (`map`, `summarize`, `gen-tests`, `chat-synthesis`, etc.) automatically prints a cost report when it finishes.

## Example Output

```
━━━ Token Usage Report ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Command:       map
  LLM calls:     18   (6 cache hits → 0 tokens)
  Tokens used:   9,240  (in: 6,800 / out: 2,440)
  Baseline est:  54,000  (cost of reading raw files)
  ▼ 44,760 tokens saved  (82%)
  Cost:          $0.0013  (baseline: $0.1620 vs Claude Sonnet)
  ▼ $0.1607 saved by using this model
  ──────────────────────────────────────────────────
  Operation          Used  Baseline   Saved%  Calls
  arch-overview     1,320     6,000    78%  1
  summarize         5,480    15,000    63%  12 +6cached
  gap-fill          2,440     9,000    72%  5
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## How It Works

### Tokens Used
The actual input + output tokens sent to the LLM for this run. Cache hits are shown separately — they consumed **zero tokens** because the result was already computed.

### Baseline Estimate
What Claude Sonnet would spend if there were **no pre-computed graph** and it had to read the equivalent raw source files directly. Conservative per-operation estimates:

| Operation | Baseline Tokens | Rationale |
|-----------|----------------|-----------|
| `summarize` | 300 | ~150 lines × 2 tokens/line |
| `gap-fill` | 1,800 | 6 nearby files × 300 tokens |
| `arch-overview` | 6,000 | 20 high-value files × 300 tokens |
| `chat-synthesis` | 4,500 | ~15 files × 300 tokens |
| `qa` | 2,000 | MASTER.md section read |
| `comment-intel` | 600 | 2 files × 300 tokens |
| `insights` | 3,000 | full graph scan equivalent |
| `test-gen` | 1,200 | target file + context reads |
| `conflict` | 1,500 | module pair reads |

### Cost
Actual dollar cost computed from the model's published pricing. The baseline cost uses Claude Sonnet ($3.00/M input tokens) as the reference — that's what Claude Code itself would spend reading raw files.

#### Model Pricing Table

| Model | Input ($/1M) | Output ($/1M) |
|-------|-------------|--------------|
| `google/gemini-2.5-flash-lite` | $0.10 | $0.40 |
| `google/gemini-2.5-flash` | $0.15 | $0.60 |
| `claude-haiku-4-5` | $0.80 | $4.00 |
| `claude-sonnet-4-6` | $3.00 | $15.00 |
| Free models (`:free` suffix) | $0 | $0 |

### Cost Saved
`baseline_cost − actual_cost`. This represents the combined benefit of:
1. **Graph pre-computation** — fewer tokens needed because results are cached in SQLite
2. **Model selection** — using a cheaper model (e.g. Gemini Flash Lite) instead of Claude Sonnet

## Token Log

Every session is appended to `.wednesday/token-log.json` (last 50 sessions retained). The log includes all fields shown in the report — `actualCost`, `baselineCost`, `costSaved` — so you can track spend over time.

```json
{
  "sessions": [
    {
      "command": "map",
      "totalTokensUsed": 9240,
      "totalBaselineTokens": 54000,
      "tokensSaved": 44760,
      "savingsPct": 82,
      "actualCost": 0.0013,
      "baselineCost": 0.162,
      "costSaved": 0.1607,
      "llmCalls": 18,
      "cacheHits": 6
    }
  ]
}
```

## Configuring the Model

Run `wednesday-skills config` or set env vars in `.env`:

```bash
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL_HAIKU=google/gemini-2.5-flash-lite   # default, cheapest
OPENROUTER_MODEL_SONNET=google/gemini-2.5-flash        # for heavier tasks
```

The system tries models left-to-right on rate limits, automatically falling back to free models.
