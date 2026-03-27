'use strict';

/**
 * Adapter Detector
 *
 * Scans source files for external service boundaries — database clients,
 * HTTP clients, cache, storage, email, payment, auth, and message queue
 * adapters. These are the mocking points for tests and failure points in
 * blast-radius analysis.
 *
 * Stored as adapter nodes in the graph DB keyed by file_path + kind + library.
 */

/**
 * Each entry:
 *   re       — pattern to detect usage
 *   kind     — adapter category
 *   library  — specific library name
 *   external — does it call outside the process boundary?
 */
const ADAPTER_PATTERNS = [
  // ── Database ────────────────────────────────────────────────────────────────
  { re: /mongoose\.connect\s*\(/,                         kind: 'database',     library: 'mongoose' },
  { re: /mongoose\.model\s*\(/,                           kind: 'database',     library: 'mongoose' },
  { re: /new\s+Sequelize\s*\(/,                           kind: 'database',     library: 'sequelize' },
  { re: /\bSequelize\b/,                                  kind: 'database',     library: 'sequelize' },
  { re: /\bprisma\b/i,                                    kind: 'database',     library: 'prisma' },
  { re: /createClient\s*\(\s*\{[^}]*database/i,          kind: 'database',     library: 'generic-db' },
  { re: /\bknex\s*\(/,                                    kind: 'database',     library: 'knex' },
  { re: /\btypeorm\b/i,                                   kind: 'database',     library: 'typeorm' },
  { re: /\bDataSource\s*\(/,                              kind: 'database',     library: 'typeorm' },
  { re: /\bpg\.Pool\b|\bnew Pool\b/,                     kind: 'database',     library: 'pg' },
  { re: /\bmysql\.createConnection\b|\bmysql2\b/,        kind: 'database',     library: 'mysql2' },
  { re: /\bMongoDB\b|\bMongoClient\b/,                   kind: 'database',     library: 'mongodb' },
  { re: /\bFirestore\b|\bgetFirestore\b/,                kind: 'database',     library: 'firebase-firestore' },
  { re: /\bgetDatabase\b|\bFirebaseDatabase\b/,          kind: 'database',     library: 'firebase-realtime-db' },

  // ── HTTP Clients ────────────────────────────────────────────────────────────
  { re: /axios\.create\s*\(/,                             kind: 'http-client',  library: 'axios' },
  { re: /\baxios\.(get|post|put|patch|delete|head)\b/,   kind: 'http-client',  library: 'axios' },
  { re: /\bfetch\s*\(\s*['"`]https?:\/\//,              kind: 'http-client',  library: 'fetch' },
  { re: /\bgot\s*\(/,                                    kind: 'http-client',  library: 'got' },
  { re: /\brequest\s*\(\s*\{[^}]*url/i,                 kind: 'http-client',  library: 'request' },
  { re: /\bneedle\s*\./,                                  kind: 'http-client',  library: 'needle' },
  { re: /new\s+XMLHttpRequest\s*\(/,                      kind: 'http-client',  library: 'xhr' },

  // ── Cache ───────────────────────────────────────────────────────────────────
  { re: /redis\.createClient\s*\(/,                       kind: 'cache',        library: 'redis' },
  { re: /new\s+Redis\s*\(/,                               kind: 'cache',        library: 'ioredis' },
  { re: /\bioredis\b/i,                                   kind: 'cache',        library: 'ioredis' },
  { re: /\bmemcached\b/i,                                 kind: 'cache',        library: 'memcached' },
  { re: /\bMemcache\b/,                                   kind: 'cache',        library: 'memcached' },

  // ── Storage ─────────────────────────────────────────────────────────────────
  { re: /new\s+S3\s*\(/,                                  kind: 'storage',      library: 'aws-s3' },
  { re: /new\s+AWS\.S3\s*\(/,                             kind: 'storage',      library: 'aws-s3' },
  { re: /\bS3Client\b/,                                   kind: 'storage',      library: 'aws-s3-v3' },
  { re: /new\s+Storage\s*\(\s*\{/,                        kind: 'storage',      library: 'gcs' },
  { re: /\bBlobServiceClient\b/,                          kind: 'storage',      library: 'azure-blob' },
  { re: /\bCloudinary\b|\bcloudinary\b/,                 kind: 'storage',      library: 'cloudinary' },

  // ── Email ───────────────────────────────────────────────────────────────────
  { re: /nodemailer\.createTransport\s*\(/,               kind: 'email',        library: 'nodemailer' },
  { re: /\bSendGrid\b|\bsendgrid\b/i,                    kind: 'email',        library: 'sendgrid' },
  { re: /\bMailgun\b|\bmailgun\b/i,                      kind: 'email',        library: 'mailgun' },
  { re: /\bSESClient\b|\bnew SES\b/,                     kind: 'email',        library: 'aws-ses' },
  { re: /\bPostmark\b|\bpostmark\b/i,                    kind: 'email',        library: 'postmark' },
  { re: /\bResend\b/,                                     kind: 'email',        library: 'resend' },

  // ── Payment ─────────────────────────────────────────────────────────────────
  { re: /new\s+Stripe\s*\(/,                              kind: 'payment',      library: 'stripe' },
  { re: /\bstripe\s*\(/,                                  kind: 'payment',      library: 'stripe' },
  { re: /\bRazorpay\b|\brazorpay\b/i,                    kind: 'payment',      library: 'razorpay' },
  { re: /\bPayPal\b|\bpaypal\b/i,                        kind: 'payment',      library: 'paypal' },
  { re: /\bBraintree\b|\bbraintree\b/i,                  kind: 'payment',      library: 'braintree' },

  // ── Auth / Identity ─────────────────────────────────────────────────────────
  { re: /passport\.use\s*\(/,                             kind: 'auth',         library: 'passport' },
  { re: /new\s+OAuth2Strategy\s*\(/,                      kind: 'auth',         library: 'passport-oauth2' },
  { re: /jwt\.sign\s*\(|jwt\.verify\s*\(/,               kind: 'auth',         library: 'jsonwebtoken' },
  { re: /bcrypt\.hash\s*\(|bcrypt\.compare\s*\(/,        kind: 'auth',         library: 'bcrypt' },
  { re: /\bAuth0\b|\bauth0\b/i,                          kind: 'auth',         library: 'auth0' },
  { re: /\bCognito\b|\bCognitoUser\b/,                   kind: 'auth',         library: 'aws-cognito' },

  // ── Message Queues ──────────────────────────────────────────────────────────
  { re: /amqplib\.connect\s*\(/,                          kind: 'message-queue', library: 'amqplib' },
  { re: /new\s+Queue\s*\(\s*['"`]/,                      kind: 'message-queue', library: 'bull' },
  { re: /new\s+Worker\s*\(\s*['"`]/,                     kind: 'message-queue', library: 'bullmq' },
  { re: /\bkafka\.producer\b|\bkafka\.consumer\b/,       kind: 'message-queue', library: 'kafkajs' },
  { re: /\bnew Kafka\b/,                                  kind: 'message-queue', library: 'kafkajs' },
  { re: /\bSQSClient\b|\bnew SQS\b/,                     kind: 'message-queue', library: 'aws-sqs' },
  { re: /\bNSQWriter\b|\bNSQReader\b/,                   kind: 'message-queue', library: 'nsq' },

  // ── SMS / Push Notifications ─────────────────────────────────────────────────
  { re: /\btwilio\b/i,                                    kind: 'sms',          library: 'twilio' },
  { re: /\bSNSClient\b|\bnew SNS\b/,                     kind: 'push',         library: 'aws-sns' },
  { re: /\bapn\b|\bAPNProvider\b/,                        kind: 'push',         library: 'apn' },
  { re: /\bfirebaseAdmin\b|\bgetMessaging\b/,             kind: 'push',         library: 'firebase-messaging' },

  // ── Analytics / Monitoring ───────────────────────────────────────────────────
  { re: /\bSentry\.init\b/,                               kind: 'monitoring',   library: 'sentry' },
  { re: /\bDatadog\b|\bnew StatsD\b/,                    kind: 'monitoring',   library: 'datadog' },
  { re: /\bNewRelic\b|\bnewrelic\b/i,                    kind: 'monitoring',   library: 'newrelic' },
  { re: /\bAmplitude\b|\bamplitude\b/i,                  kind: 'analytics',    library: 'amplitude' },
  { re: /\bMixpanel\b|\bmixpanel\b/i,                    kind: 'analytics',    library: 'mixpanel' },
];

/**
 * Strip string literals and comments to avoid false positives.
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
 * @param {string} src
 * @param {number} offset
 * @returns {number}
 */
function lineAt(src, offset) {
  return src.slice(0, offset).split('\n').length;
}

/**
 * Detect adapter patterns in a source file.
 *
 * Runs patterns on the ORIGINAL source so identifiers are intact,
 * then validates each match position against the stripped source to reject
 * matches that are inside string literals or comments.
 *
 * @param {string} filePath
 * @param {string} source  - raw source code
 * @returns {Array<{kind: string, library: string, external: boolean, line: number}>}
 */
function detectAdapters(filePath, source) {
  const stripped = stripStrings(source);
  const results  = [];
  const seen     = new Set();

  for (const { re, kind, library } of ADAPTER_PATTERNS) {
    const pattern = new RegExp(re.source, 'g');
    let match;
    while ((match = pattern.exec(source)) !== null) {
      // Reject if the match start was inside a stripped region
      if (stripped[match.index] === ' ' && source[match.index] !== ' ') continue;
      const line = lineAt(source, match.index);
      const key  = `${kind}|${library}|${line}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ kind, library, external: true, line });
      }
    }
  }

  return results;
}

module.exports = { detectAdapters };
