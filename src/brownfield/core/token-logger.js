/**
 * Token usage logger — tracks LLM spend vs baseline (raw file reads).
 *
 * Baseline model: what would Claude Code spend if it had NO pre-computed graph
 * and had to read raw source files to answer the same question?
 * Conservative estimates — we don't inflate savings figures.
 *
 * Usage:
 *   tokenLogger.setCommand('map');
 *   tokenLogger.record({ operation, model, inputTokens, outputTokens });
 *   tokenLogger.recordCacheHit('summarize');
 *   const summary = tokenLogger.flush(rootDir);
 *   tokenLogger.printReport(summary);
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// Pricing per 1M tokens { in, out } in USD.
// Baseline cost is computed using Claude Sonnet (what Claude Code itself uses).
const PRICES = {
  'google/gemini-2.5-flash-lite':                  { in: 0.10,  out: 0.40  },
  'google/gemini-2.5-flash':                        { in: 0.15,  out: 0.60  },
  'google/gemma-3-27b-it:free':                     { in: 0,     out: 0     },
  'meta-llama/llama-3.3-70b-instruct:free':         { in: 0,     out: 0     },
  'nousresearch/hermes-3-llama-3.1-405b:free':      { in: 0,     out: 0     },
  'minimax/minimax-m2.5':                           { in: 0.10,  out: 0.40  },
  'stepfun/step-3.5-flash:free':                    { in: 0,     out: 0     },
  'claude-haiku-4-5-20251001':                      { in: 0.80,  out: 4.00  },
  'claude-haiku-4-5':                               { in: 0.80,  out: 4.00  },
  'claude-sonnet-4-6':                              { in: 3.00,  out: 15.00 },
  'cache':                                          { in: 0,     out: 0     },
};

// Baseline cost reference: Claude Sonnet input price (what Claude Code itself uses).
const BASELINE_PRICE_PER_M = 3.00; // $/1M tokens

function priceFor(model) {
  if (!model) return { in: 0, out: 0 };
  // Exact match first, then substring match
  const key = Object.keys(PRICES).find(k => model === k || model.includes(k) || k.includes(model));
  return key ? PRICES[key] : { in: 0, out: 0 };
}

function tokenCost(inputTokens, outputTokens, model) {
  const p = priceFor(model);
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
}

// Baseline token cost per operation — conservative estimates.
// Represents what Claude Code would spend reading raw files without our graph.
const BASELINE = {
  'summarize':      300,   // avg raw file read  (~150 lines × ~2 tokens/line)
  'gap-fill':      1800,   // 6 nearby files × 300 tokens
  'arch-overview': 6000,   // 20 high-value files × 300 tokens
  'qa':            2000,   // MASTER.md section read
  'chat-synthesis':4500,   // ~15 files × 300 tokens (typical query scope)
  'comment-intel':  600,   // 2 files × 300 tokens
  'insights':      3000,   // full graph scan equivalent
  'test-gen':      1200,   // target file + context reads
  'conflict':      1500,   // module pair reads
  'product-orientation': 4500, // ~15 file signatures x 300 tokens
  'default':        300,
};

class TokenLogger {
  constructor() {
    this._reset();
  }

  _reset() {
    this._sessionStart = new Date().toISOString();
    this._command      = null;
    this._calls        = [];
  }

  /** Call at the start of each top-level command (map, summarize, fill-gaps). */
  setCommand(command) {
    this._reset();
    this._command = command;
  }

  /**
   * Record a completed LLM call.
   * @param {Object} opts
   * @param {string} opts.operation   - e.g. 'summarize', 'gap-fill'
   * @param {string} opts.model       - resolved model name
   * @param {number} opts.inputTokens
   * @param {number} opts.outputTokens
   * @param {number} [opts.baselineTokens] - override default baseline for this op
   */
  record({ operation, model, inputTokens, outputTokens, baselineTokens }) {
    this._calls.push({
      operation,
      model,
      inputTokens,
      outputTokens,
      baselineTokens: baselineTokens ?? BASELINE[operation] ?? BASELINE.default,
      cacheHit: false,
    });
  }

  /**
   * Record a cache hit (0 tokens spent, but baseline is still saved).
   * @param {string} operation
   * @param {number} [baselineTokens]
   */
  recordCacheHit(operation, baselineTokens) {
    this._calls.push({
      operation,
      model: 'cache',
      inputTokens: 0,
      outputTokens: 0,
      baselineTokens: baselineTokens ?? BASELINE[operation] ?? BASELINE.default,
      cacheHit: true,
    });
  }

  /** Build the session summary object. */
  summary() {
    const llmCalls   = this._calls.filter(c => !c.cacheHit);
    const cacheHits  = this._calls.filter(c =>  c.cacheHit);

    const totalInput    = llmCalls.reduce((s, c) => s + c.inputTokens,  0);
    const totalOutput   = llmCalls.reduce((s, c) => s + c.outputTokens, 0);
    const totalUsed     = totalInput + totalOutput;
    const totalBaseline = this._calls.reduce((s, c) => s + c.baselineTokens, 0);
    const tokensSaved   = totalBaseline - totalUsed;
    const savingsPct    = totalBaseline > 0
      ? Math.round((tokensSaved / totalBaseline) * 100)
      : 0;

    const actualCost   = llmCalls.reduce((s, c) => s + tokenCost(c.inputTokens, c.outputTokens, c.model), 0);
    const baselineCost = (totalBaseline / 1_000_000) * BASELINE_PRICE_PER_M;
    const costSaved    = baselineCost - actualCost;

    // Per-operation breakdown
    const byOp = {};
    for (const c of this._calls) {
      const op = c.operation;
      if (!byOp[op]) {
        byOp[op] = { calls: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0, baselineTokens: 0 };
      }
      byOp[op].baselineTokens += c.baselineTokens;
      if (c.cacheHit) {
        byOp[op].cacheHits++;
      } else {
        byOp[op].calls++;
        byOp[op].inputTokens  += c.inputTokens;
        byOp[op].outputTokens += c.outputTokens;
      }
    }

    return {
      sessionId:           this._sessionStart,
      command:             this._command,
      totalInputTokens:    totalInput,
      totalOutputTokens:   totalOutput,
      totalTokensUsed:     totalUsed,
      totalBaselineTokens: totalBaseline,
      tokensSaved,
      savingsPct,
      actualCost,
      baselineCost,
      costSaved,
      llmCalls:            llmCalls.length,
      cacheHits:           cacheHits.length,
      breakdown:           Object.entries(byOp).map(([operation, stats]) => ({ operation, ...stats })),
    };
  }

  /**
   * Append this session to .wednesday/token-log.json (keeps last 50 sessions).
   * @param {string} rootDir - project root
   * @returns {Object} summary
   */
  flush(rootDir) {
    const s       = this.summary();
    const logPath = path.join(rootDir, '.wednesday', 'token-log.json');

    let log = { sessions: [] };
    try { log = JSON.parse(fs.readFileSync(logPath, 'utf8')); } catch { /* first run */ }

    log.sessions.unshift(s);
    if (log.sessions.length > 50) log.sessions = log.sessions.slice(0, 50);

    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2));

    return s;
  }

  /**
   * Print a colored token report to stdout.
   * @param {Object} s - summary from flush() or summary()
   */
  printReport(s) {
    if (s.llmCalls === 0 && s.cacheHits === 0) return;

    const GREEN  = '\x1b[32m';
    const RED    = '\x1b[31m';
    const BOLD   = '\x1b[1m';
    const DIM    = '\x1b[2m';
    const RESET  = '\x1b[0m';

    const saving  = s.tokensSaved >= 0;
    const color   = saving ? GREEN : RED;
    const arrow   = saving ? '▼' : '▲';
    const verb    = saving ? 'saved' : 'extra';

    const fmt    = n => n.toLocaleString();
    const fmtUSD = n => `$${n < 0.001 ? n.toFixed(5) : n.toFixed(4)}`;

    console.log('');
    console.log(`${BOLD}${color}━━━ Token Usage Report ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
    console.log(`  Command:       ${s.command || '—'}`);
    console.log(`  LLM calls:     ${s.llmCalls}   ${DIM}(${s.cacheHits} cache hits → 0 tokens)${RESET}`);
    console.log(`  Tokens used:   ${fmt(s.totalTokensUsed)}  ${DIM}(in: ${fmt(s.totalInputTokens)} / out: ${fmt(s.totalOutputTokens)})${RESET}`);
    console.log(`  Baseline est:  ${fmt(s.totalBaselineTokens)}  ${DIM}(cost of reading raw files)${RESET}`);
    console.log(`  ${color}${BOLD}${arrow} ${fmt(Math.abs(s.tokensSaved))} tokens ${verb}  (${s.savingsPct}%)${RESET}`);
    console.log(`  Cost:          ${fmtUSD(s.actualCost)}  ${DIM}(baseline: ${fmtUSD(s.baselineCost)} vs Claude Sonnet)${RESET}`);
    console.log(`  ${color}${BOLD}${arrow} ${fmtUSD(Math.abs(s.costSaved))} ${verb} by using this model${RESET}`);

    if (s.breakdown.length > 0) {
      console.log(`  ${DIM}──────────────────────────────────────────────────${RESET}`);
      console.log(`  ${'Operation'.padEnd(18)} ${'Used'.padStart(7)}  ${'Baseline'.padStart(8)}  ${'Saved%'.padStart(7)}  Calls`);
      for (const b of s.breakdown.sort((a, z) => z.baselineTokens - a.baselineTokens)) {
        const used     = b.inputTokens + b.outputTokens;
        const saved    = b.baselineTokens - used;
        const pct      = b.baselineTokens > 0 ? Math.round((saved / b.baselineTokens) * 100) : 0;
        const pctStr   = (pct >= 0 ? `${GREEN}${pct}%${RESET}` : `${RED}${pct}%${RESET}`);
        const hitStr   = b.cacheHits > 0 ? ` +${b.cacheHits}cached` : '';
        console.log(`  ${b.operation.padEnd(18)} ${fmt(used).padStart(7)}  ${fmt(b.baselineTokens).padStart(8)}  ${pctStr.padStart(7)}  ${b.calls}${hitStr}`);
      }
    }

    console.log(`${color}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
    console.log('');
  }
}

// Singleton — one logger per process run
module.exports = new TokenLogger();
