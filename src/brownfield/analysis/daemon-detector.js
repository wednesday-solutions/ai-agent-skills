'use strict';

/**
 * Daemon Detector
 *
 * Scans source files for background/async process patterns that are invisible
 * to import/export analysis: event emitters, timers, queue consumers,
 * WebSocket handlers, cron jobs, and process signals.
 *
 * These are stored as daemon nodes in the graph DB so the E2E test generator
 * and blast-radius queries can account for async side effects.
 */

const DAEMON_PATTERNS = [
  // ── Event emitters / listeners ──────────────────────────────────────────────
  { re: /\.on\(\s*['"`](\w[^'"`]*?)['"`]/g,              kind: 'event-listener' },
  { re: /\.once\(\s*['"`](\w[^'"`]*?)['"`]/g,            kind: 'event-listener-once' },
  { re: /\.emit\(\s*['"`](\w[^'"`]*?)['"`]/g,            kind: 'event-emitter' },
  { re: /\.addEventListener\(\s*['"`](\w[^'"`]*?)['"`]/g, kind: 'dom-event' },
  { re: /\.removeEventListener\(\s*['"`](\w[^'"`]*?)['"`]/g, kind: 'dom-event-remove' },

  // ── Background timers ───────────────────────────────────────────────────────
  { re: /\bsetInterval\s*\(/g,                            kind: 'interval',         event: null },
  { re: /\bsetTimeout\s*\(/g,                             kind: 'timeout',          event: null },
  { re: /\bsetImmediate\s*\(/g,                           kind: 'immediate',        event: null },
  { re: /\bqueueMicrotask\s*\(/g,                         kind: 'microtask',        event: null },

  // ── Process signals ─────────────────────────────────────────────────────────
  { re: /process\.on\(\s*['"`](\w[^'"`]*?)['"`]/g,       kind: 'process-signal' },
  { re: /process\.once\(\s*['"`](\w[^'"`]*?)['"`]/g,     kind: 'process-signal-once' },

  // ── Queue / Pub-Sub consumers ───────────────────────────────────────────────
  { re: /\.consume\s*\(/g,                                kind: 'queue-consumer',   event: null },
  { re: /\.subscribe\s*\(\s*['"`](\w[^'"`]*?)['"`]/g,    kind: 'subscriber' },
  { re: /\.subscribe\s*\([^'"`]/g,                        kind: 'subscriber',       event: null },
  { re: /\.listen\s*\(\s*['"`](\w[^'"`]*?)['"`]/g,       kind: 'listener' },

  // ── WebSocket handlers ──────────────────────────────────────────────────────
  { re: /io\.on\(\s*['"`](connection|disconnect)[^'"`]*['"`]/g, kind: 'websocket-server' },
  { re: /socket\.on\(\s*['"`](\w[^'"`]*?)['"`]/g,              kind: 'websocket-handler' },
  { re: /wss?\.on\(\s*['"`](\w[^'"`]*?)['"`]/g,                kind: 'websocket-raw' },

  // ── Cron jobs ───────────────────────────────────────────────────────────────
  { re: /cron\.schedule\s*\(\s*['"`]([^'"`]+)['"`]/g,    kind: 'cron-job' },
  { re: /schedule\s*\(\s*['"`]([\d*/,\- ]+)['"`]/g,      kind: 'cron-job' },
  { re: /new\s+CronJob\s*\(/g,                            kind: 'cron-job',         event: null },
  { re: /\.scheduleJob\s*\(/g,                            kind: 'cron-job',         event: null },
];

/**
 * Get 1-based line number for a character offset in source.
 * @param {string} src
 * @param {number} offset
 * @returns {number}
 */
function lineAt(src, offset) {
  return src.slice(0, offset).split('\n').length;
}

/**
 * Strip string literals from source so we don't match inside comments/strings.
 * @param {string} src
 * @returns {string}
 */
function stripStrings(src) {
  return src
    .replace(/"(?:[^"\\]|\\.)*"/g,  m => ' '.repeat(m.length))
    .replace(/'(?:[^'\\]|\\.)*'/g,  m => ' '.repeat(m.length))
    .replace(/`(?:[^`\\]|\\.)*`/g,  m => ' '.repeat(m.length))
    .replace(/\/\/[^\n]*/g,         m => ' '.repeat(m.length))
    .replace(/\/\*[\s\S]*?\*\//g,   m => ' '.repeat(m.length));
}

/**
 * Detect daemon patterns in a source file.
 *
 * Runs patterns on the ORIGINAL source (to capture event names inside strings),
 * then validates each match position against the stripped source to reject
 * matches that are themselves inside string literals or comments.
 *
 * @param {string} filePath
 * @param {string} source  - raw source code
 * @returns {Array<{kind: string, event: string|null, line: number}>}
 */
function detectDaemons(filePath, source) {
  const stripped = stripStrings(source);
  const results  = [];
  const seen     = new Set();

  for (const { re, kind, event: fixedEvent } of DAEMON_PATTERNS) {
    const pattern = new RegExp(re.source, 'g');
    let match;
    // Search original source so event names are readable
    while ((match = pattern.exec(source)) !== null) {
      // Reject if the match start was inside a stripped region
      // (stripStrings replaces string/comment content with spaces,
      //  so if stripped[idx] is ' ' but source[idx] isn't, it was inside a string)
      if (stripped[match.index] === ' ' && source[match.index] !== ' ') continue;

      const event = fixedEvent !== undefined ? fixedEvent : (match[1] || null);
      const line  = lineAt(source, match.index);
      const key   = `${kind}|${event}|${line}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ kind, event, line });
      }
    }
  }

  return results;
}

module.exports = { detectDaemons };
