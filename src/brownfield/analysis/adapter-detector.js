'use strict';

/**
 * Adapter Detector
 *
 * Scans source files for external service boundaries — database clients,
 * HTTP clients, cache, storage, email, payment, auth, and message queue
 * adapters. These are the mocking points for tests and failure points in
 * blast-radius analysis.
 *
 * Patterns are language-scoped — JS patterns never run on Swift/Go files.
 *
 * Stored as adapter nodes in the graph DB keyed by file_path + kind + library.
 */

const path = require('path');

const JS_EXTS    = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs']);
const SWIFT_EXTS = new Set(['.swift', '.m', '.mm']);
const GO_EXTS    = new Set(['.go']);

/**
 * Each entry:
 *   re       — pattern to detect usage
 *   kind     — adapter category
 *   library  — specific library name
 */
const JS_ADAPTER_PATTERNS = [
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

// ── Swift / Objective-C adapter patterns ──────────────────────────────────────
const SWIFT_ADAPTER_PATTERNS = [
  // HTTP
  { re: /\bAF\.request\b|\bAF\.upload\b|\bAF\.download\b/,      kind: 'http-client',  library: 'alamofire' },
  { re: /\bSession\.default\b|\bSession\s*\(\s*configuration:/,  kind: 'http-client',  library: 'alamofire' },
  { re: /URLSession\.shared\.\w+Task\s*\(/,                      kind: 'http-client',  library: 'urlsession' },
  { re: /URLSession\s*\(\s*configuration:/,                      kind: 'http-client',  library: 'urlsession' },
  // Database
  { re: /NSPersistentContainer\s*\(/,                            kind: 'database',     library: 'coredata' },
  { re: /NSManagedObjectContext\b/,                              kind: 'database',     library: 'coredata' },
  { re: /NSFetchRequest\s*</,                                    kind: 'database',     library: 'coredata' },
  { re: /\btry\s+Realm\s*\(|\btry!\s+Realm\s*\(/,              kind: 'database',     library: 'realm' },
  { re: /\bRealm\.Configuration\b/,                              kind: 'database',     library: 'realm' },
  // Firebase
  { re: /Firestore\.firestore\s*\(\)/,                           kind: 'database',     library: 'firebase-firestore' },
  { re: /Auth\.auth\s*\(\)/,                                     kind: 'auth',         library: 'firebase-auth' },
  { re: /Messaging\.messaging\s*\(\)/,                           kind: 'push',         library: 'firebase-messaging' },
  { re: /Analytics\.logEvent\b|FirebaseAnalytics\b/,             kind: 'analytics',    library: 'firebase-analytics' },
  { re: /Crashlytics\.crashlytics\s*\(\)/,                       kind: 'monitoring',   library: 'firebase-crashlytics' },
  { re: /RemoteConfig\.remoteConfig\s*\(\)/,                     kind: 'config',       library: 'firebase-remote-config' },
  // Storage
  { re: /Storage\.storage\s*\(\)/,                               kind: 'storage',      library: 'firebase-storage' },
  // Auth / Keychain
  { re: /\bKeychain\b|\bKeychainSwift\b/,                        kind: 'auth',         library: 'keychain' },
  { re: /\bSecItemAdd\b|\bSecItemCopyMatching\b/,                kind: 'auth',         library: 'security-framework' },
  { re: /GIDSignIn\.sharedInstance\b/,                           kind: 'auth',         library: 'google-sign-in' },
  // Payments
  { re: /SKPaymentQueue\.default\(\)|SKProductsRequest\b/,       kind: 'payment',      library: 'storekit' },
  { re: /Purchases\.configure\b/,                                kind: 'payment',      library: 'revenuecat' },
  { re: /STPAPIClient\b|\bStripe\b/,                             kind: 'payment',      library: 'stripe-ios' },
  // Analytics / Monitoring
  { re: /SentrySDK\.start\b|\bSentrySDK\b/,                     kind: 'monitoring',   library: 'sentry' },
  { re: /Amplitude\.instance\(\)|AmplitudeSDK\b/,                kind: 'analytics',    library: 'amplitude' },
  { re: /Mixpanel\.initialize\b/,                                kind: 'analytics',    library: 'mixpanel' },
  // Push
  { re: /UNUserNotificationCenter\.current\(\)/,                 kind: 'push',         library: 'unnotifications' },
];

// ── Go adapter patterns ────────────────────────────────────────────────────────
const GO_ADAPTER_PATTERNS = [
  // Database
  { re: /\bsql\.Open\s*\(/,                                      kind: 'database',     library: 'database/sql' },
  { re: /\bgorm\.Open\s*\(/,                                     kind: 'database',     library: 'gorm' },
  { re: /\bpgx\.Connect\b|\bpgxpool\.New\b/,                    kind: 'database',     library: 'pgx' },
  // Cache
  { re: /redis\.NewClient\s*\(/,                                 kind: 'cache',        library: 'go-redis' },
  // HTTP
  { re: /http\.NewRequest\b|\bhttp\.Get\b|\bhttp\.Post\b/,       kind: 'http-client',  library: 'net/http' },
  // gRPC
  { re: /grpc\.Dial\b|\bgrpc\.NewServer\b/,                      kind: 'rpc',          library: 'grpc' },
  // Queue
  { re: /sarama\.NewSyncProducer\b|\bsarama\.NewConsumer\b/,     kind: 'message-queue', library: 'sarama-kafka' },
  { re: /amqp\.Dial\b/,                                          kind: 'message-queue', library: 'amqp' },
  // Storage
  { re: /s3\.New\b|\bs3\.NewFromConfig\b/,                       kind: 'storage',      library: 'aws-s3' },
];

function stripJs(src) {
  return src
    .replace(/"(?:[^"\\]|\\.)*"/g,  m => ' '.repeat(m.length))
    .replace(/'(?:[^'\\]|\\.)*'/g,  m => ' '.repeat(m.length))
    .replace(/`(?:[^`\\]|\\.)*`/g,  m => ' '.repeat(m.length))
    .replace(/\/\/[^\n]*/g,         m => ' '.repeat(m.length))
    .replace(/\/\*[\s\S]*?\*\//g,   m => ' '.repeat(m.length));
}

function stripSwift(src) {
  return src
    .replace(/"(?:[^"\\]|\\.)*"/g,  m => ' '.repeat(m.length))
    .replace(/\/\/[^\n]*/g,         m => ' '.repeat(m.length))
    .replace(/\/\*[\s\S]*?\*\//g,   m => ' '.repeat(m.length));
}

function lineAt(src, offset) {
  return src.slice(0, offset).split('\n').length;
}

function runPatterns(patterns, source, stripFn) {
  const stripped = stripFn(source);
  const results  = [];
  const seen     = new Set();

  for (const { re, kind, library } of patterns) {
    const pattern = new RegExp(re.source, 'g');
    let match;
    while ((match = pattern.exec(source)) !== null) {
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

/**
 * Detect adapter patterns in a source file.
 *
 * Routes to the correct pattern set based on file extension — JS patterns
 * never fire on Swift/Go files and vice-versa.
 *
 * @param {string} filePath
 * @param {string} source  - raw source code
 * @returns {Array<{kind: string, library: string, external: boolean, line: number}>}
 */
function detectAdapters(filePath, source) {
  const ext = path.extname(filePath).toLowerCase();

  if (JS_EXTS.has(ext))    return runPatterns(JS_ADAPTER_PATTERNS,    source, stripJs);
  if (SWIFT_EXTS.has(ext)) return runPatterns(SWIFT_ADAPTER_PATTERNS, source, stripSwift);
  if (GO_EXTS.has(ext))    return runPatterns(GO_ADAPTER_PATTERNS,    source, stripJs);

  return []; // unsupported language — no false positives
}

module.exports = { detectAdapters };
