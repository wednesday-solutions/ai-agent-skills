'use strict';

/**
 * Daemon Detector
 *
 * Scans source files for background/async process patterns.
 * Patterns are language-scoped — JS patterns never run on Swift files, etc.
 * This avoids false positives where `.on()` or `.emit()` appear naturally
 * in non-JS code.
 *
 * Supported:
 *   .js .ts .jsx .tsx .mjs .cjs  → event emitters, timers, queues, WebSocket, cron
 *   .swift .m .mm                 → BGTaskScheduler, Timer, DispatchQueue, NotificationCenter
 *   .go                           → goroutines, time.Tick/After, channel ops
 *   .plist (LaunchDaemons/Agents) → launchd label extraction
 */

const path = require('path');

// ── Language sets ─────────────────────────────────────────────────────────────

const JS_EXTS    = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs']);
const SWIFT_EXTS = new Set(['.swift', '.m', '.mm']);
const GO_EXTS    = new Set(['.go']);

// ── Pattern tables ────────────────────────────────────────────────────────────

const JS_PATTERNS = [
  // Event emitters / listeners
  { re: /\.on\(\s*['"`](\w[^'"`]*?)['"`]/g,              kind: 'event-listener' },
  { re: /\.once\(\s*['"`](\w[^'"`]*?)['"`]/g,            kind: 'event-listener-once' },
  { re: /\.emit\(\s*['"`](\w[^'"`]*?)['"`]/g,            kind: 'event-emitter' },
  { re: /\.addEventListener\(\s*['"`](\w[^'"`]*?)['"`]/g, kind: 'dom-event' },
  { re: /\.removeEventListener\(\s*['"`](\w[^'"`]*?)['"`]/g, kind: 'dom-event-remove' },
  // Background timers
  { re: /\bsetInterval\s*\(/g,    kind: 'interval',  event: null },
  { re: /\bsetTimeout\s*\(/g,     kind: 'timeout',   event: null },
  { re: /\bsetImmediate\s*\(/g,   kind: 'immediate', event: null },
  { re: /\bqueueMicrotask\s*\(/g, kind: 'microtask', event: null },
  // Process signals
  { re: /process\.on\(\s*['"`](\w[^'"`]*?)['"`]/g,   kind: 'process-signal' },
  { re: /process\.once\(\s*['"`](\w[^'"`]*?)['"`]/g, kind: 'process-signal-once' },
  // Queue / pub-sub
  { re: /\.consume\s*\(/g,                                  kind: 'queue-consumer', event: null },
  { re: /\.subscribe\s*\(\s*['"`](\w[^'"`]*?)['"`]/g,      kind: 'subscriber' },
  { re: /\.subscribe\s*\([^'"`]/g,                          kind: 'subscriber',     event: null },
  { re: /\.listen\s*\(\s*['"`](\w[^'"`]*?)['"`]/g,         kind: 'listener' },
  // WebSocket
  { re: /io\.on\(\s*['"`](connection|disconnect)[^'"`]*['"`]/g, kind: 'websocket-server' },
  { re: /socket\.on\(\s*['"`](\w[^'"`]*?)['"`]/g,              kind: 'websocket-handler' },
  { re: /wss?\.on\(\s*['"`](\w[^'"`]*?)['"`]/g,                kind: 'websocket-raw' },
  // Cron
  { re: /cron\.schedule\s*\(\s*['"`]([^'"`]+)['"`]/g,    kind: 'cron-job' },
  { re: /schedule\s*\(\s*['"`]([\d*/,\- ]+)['"`]/g,      kind: 'cron-job' },
  { re: /new\s+CronJob\s*\(/g,                            kind: 'cron-job', event: null },
  { re: /\.scheduleJob\s*\(/g,                            kind: 'cron-job', event: null },
];

const SWIFT_PATTERNS = [
  // Background task scheduler (iOS 13+)
  { re: /BGTaskScheduler\.shared\.register\s*\(\s*forTaskWithIdentifier:\s*"([^"]+)"/g, kind: 'bg-task' },
  { re: /BGProcessingTaskRequest\s*\(\s*identifier:\s*"([^"]+)"/g, kind: 'bg-processing-task' },
  { re: /BGAppRefreshTaskRequest\s*\(\s*identifier:\s*"([^"]+)"/g, kind: 'bg-refresh-task' },
  // Timers
  { re: /Timer\.scheduledTimer\s*\(/g,    kind: 'timer',        event: null },
  { re: /Timer\.scheduledTimer\s*\(timeInterval:[^,]+,\s*target:[^,]+,\s*selector:\s*#selector\(\w+\.(\w+)\)/g, kind: 'timer' },
  { re: /DispatchQueue\.\w+\.asyncAfter\s*\(/g, kind: 'delayed-task', event: null },
  // Notification center
  { re: /NotificationCenter\.default\.addObserver\s*\(forName:\s*Notification\.Name\s*\("([^"]+)"\)/g, kind: 'notification-observer' },
  { re: /NotificationCenter\.default\.addObserver\s*\(forName:\s*\.(\w+)/g, kind: 'notification-observer' },
  { re: /NotificationCenter\.default\.addObserver\s*\([^,]+,\s*selector:[^,]+,\s*name:/g, kind: 'notification-observer', event: null },
  // URLSession background tasks
  { re: /URLSession\s*\(\s*configuration:\s*URLSessionConfiguration\.background/g, kind: 'bg-url-session', event: null },
  // Async network tasks (not bg but worth flagging)
  { re: /URLSession\.shared\.\w+Task\s*\(/g, kind: 'network-task', event: null },
  // XPC service connections
  { re: /NSXPCConnection\s*\(\s*serviceName:/g, kind: 'xpc-service', event: null },
  { re: /NSXPCConnection\s*\(\s*machServiceName:/g, kind: 'xpc-mach-service', event: null },
];

const GO_PATTERNS = [
  { re: /\bgo\s+func\s*\(/g,         kind: 'goroutine',  event: null },
  { re: /\btime\.Tick\s*\(/g,        kind: 'ticker',     event: null },
  { re: /\btime\.NewTicker\s*\(/g,   kind: 'ticker',     event: null },
  { re: /\btime\.After\s*\(/g,       kind: 'timeout',    event: null },
  { re: /\btime\.NewTimer\s*\(/g,    kind: 'timeout',    event: null },
  { re: /\bcron\.New\s*\(/g,         kind: 'cron-job',   event: null },
  { re: /\bcron\.AddFunc\s*\(/g,     kind: 'cron-job',   event: null },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function lineAt(src, offset) {
  return src.slice(0, offset).split('\n').length;
}

/**
 * Strip string literals and comments to prevent matching inside them.
 * Preserves original positions by replacing with spaces of same length.
 */
function stripStrings(src) {
  return src
    .replace(/"(?:[^"\\]|\\.)*"/g,  m => ' '.repeat(m.length))
    .replace(/'(?:[^'\\]|\\.)*'/g,  m => ' '.repeat(m.length))
    .replace(/`(?:[^`\\]|\\.)*`/g,  m => ' '.repeat(m.length))
    .replace(/\/\/[^\n]*/g,         m => ' '.repeat(m.length))
    .replace(/\/\*[\s\S]*?\*\//g,   m => ' '.repeat(m.length));
}

function stripSwiftStrings(src) {
  return src
    .replace(/"(?:[^"\\]|\\.)*"/g,  m => ' '.repeat(m.length))
    .replace(/\/\/[^\n]*/g,         m => ' '.repeat(m.length))
    .replace(/\/\*[\s\S]*?\*\//g,   m => ' '.repeat(m.length));
}

// ── Plist detection ───────────────────────────────────────────────────────────

/**
 * Detect launchd agents/daemons from .plist files.
 * Only fires for plist files under LaunchDaemons/ or LaunchAgents/ paths.
 */
function detectPlistDaemon(filePath, source) {
  if (path.extname(filePath).toLowerCase() !== '.plist') return null;
  const fp = filePath.replace(/\\/g, '/');
  const isDaemon = fp.includes('/LaunchDaemons/');
  const isAgent  = fp.includes('/LaunchAgents/');
  if (!isDaemon && !isAgent) return null;

  const labelMatch = source.match(/<key>Label<\/key>\s*<string>([^<]+)<\/string>/);
  const label = labelMatch ? labelMatch[1].trim() : path.basename(filePath, '.plist');
  return [{ kind: isDaemon ? 'launchd-daemon' : 'launchd-agent', event: label, line: 1 }];
}

// ── Core detection ────────────────────────────────────────────────────────────

function runPatterns(patterns, source, stripFn) {
  const stripped = stripFn(source);
  const results  = [];
  const seen     = new Set();

  for (const { re, kind, event: fixedEvent } of patterns) {
    const pattern = new RegExp(re.source, 'g');
    let match;
    while ((match = pattern.exec(source)) !== null) {
      // Reject if match start was inside a stripped region
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

/**
 * Detect daemon patterns in a source file.
 *
 * Routes to the correct pattern set based on file extension so JS patterns
 * never fire on Swift/Go files and vice-versa.
 *
 * @param {string} filePath
 * @param {string} source  - raw source code
 * @returns {Array<{kind: string, event: string|null, line: number}>}
 */
function detectDaemons(filePath, source) {
  // plist files: extract launchd label, skip regex detection
  const plist = detectPlistDaemon(filePath, source);
  if (plist !== null) return plist;

  const ext = path.extname(filePath).toLowerCase();

  if (JS_EXTS.has(ext))    return runPatterns(JS_PATTERNS,    source, stripStrings);
  if (SWIFT_EXTS.has(ext)) return runPatterns(SWIFT_PATTERNS, source, stripSwiftStrings);
  if (GO_EXTS.has(ext))    return runPatterns(GO_PATTERNS,    source, stripStrings);

  return []; // unsupported language — no false positives
}

module.exports = { detectDaemons };
