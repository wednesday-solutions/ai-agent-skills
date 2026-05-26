/**
 * SQLite-backed graph store — Phase A
 *
 * Replaces three separate storage mechanisms:
 *   dep-graph.json          → nodes + edges tables (queried on demand)
 *   cache/hashes.json       → nodes.file_hash column
 *   cache/summaries/*.json  → nodes table rows (500 files → 0 files)
 *
 * Single file on disk: .wednesday/graph.db
 *
 * All methods are synchronous (better-sqlite3 API).
 * Use GraphStore.open(dbPath) to get an instance.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { computeRiskScore } = require('./graph');

let Database;
let isNative = false;
try {
  const BetterSqlite3 = require('better-sqlite3');
  // Probe: Ensure bindings are actually working
  new BetterSqlite3(':memory:').close();
  Database = BetterSqlite3;
  isNative = true;
} catch (e) {
  console.warn('[wednesday-skills] Native better-sqlite3 failed (missing bindings or version mismatch). Falling back to in-memory store.');
  // Mock Database for in-memory operations if native load fails
  Database = class MockDatabase {
    constructor() {
      this._data = { nodes: {}, edges: [], symbols: [], metadata: {}, daemons: [], adapters: [] };
    }
    pragma() {}
    exec(schema) {}
    prepare(sql) {
      const db = this;
      return {
        run: (args) => {
          if (sql.includes('INSERT INTO nodes')) {
            db._data.nodes[args.file_path] = args;
          } else if (sql.includes('UPDATE nodes SET summary')) {
            // args = (summary, file_path) positional
            const [summary, fp] = Array.isArray(args) ? args : [args, null];
            if (db._data.nodes[fp]) db._data.nodes[fp].summary = summary;
          } else if (sql.includes('UPDATE nodes SET band')) {
            const [band, score, fp] = Array.isArray(args) ? args : [args, 0, null];
            if (db._data.nodes[fp]) { db._data.nodes[fp].band = band; db._data.nodes[fp].risk_score = score; }
          } else if (sql.includes('INSERT INTO edges')) {
            db._data.edges.push(args);
          } else if (sql.includes('INSERT INTO metadata')) {
            db._data.metadata[args.key || args[0]] = args.value || args[1];
          } else if (sql.includes('INSERT INTO daemons')) {
            db._data.daemons.push(args);
          } else if (sql.includes('INSERT INTO adapters')) {
            db._data.adapters.push(args);
          } else if (sql.includes('DELETE FROM daemons')) {
            const fp = typeof args === 'string' ? args : args.file_path;
            db._data.daemons = db._data.daemons.filter(d => d.file_path !== fp);
          } else if (sql.includes('DELETE FROM adapters')) {
            const fp = typeof args === 'string' ? args : args.file_path;
            db._data.adapters = db._data.adapters.filter(a => a.file_path !== fp);
          } else if (sql.includes('DELETE FROM edges')) {
            // deleteEdgesByFileAndKind — args is (file_path, kind) positional
          }
          return { changes: 1 };
        },
        get: (key) => {
          if (sql.includes('FROM nodes')) return db._data.nodes[key] || null;
          if (sql.includes('FROM metadata')) return { value: db._data.metadata[key] } || null;
          if (sql.includes('COUNT(*)')) return { c: Object.keys(db._data.nodes).length };
          return null;
        },
        all: (arg1, arg2) => {
          if (sql.includes('FROM edges')) {
            if (sql.includes('source = ?')) return db._data.edges.filter(e => e.source === arg1);
            if (sql.includes('target = ?')) return db._data.edges.filter(e => e.target === arg1);
            if (sql.includes('kind = ?')) return db._data.edges.filter(e => e.target === arg1 && e.kind === arg2);
            return db._data.edges;
          }
          if (sql.includes('FROM nodes')) return Object.values(db._data.nodes);
          if (sql.includes('FROM daemons')) {
            if (sql.includes('file_path = ?')) return db._data.daemons.filter(d => d.file_path === arg1);
            if (sql.includes('kind = ?')) return db._data.daemons.filter(d => d.kind === arg1);
            return db._data.daemons;
          }
          if (sql.includes('FROM adapters')) {
            if (sql.includes('file_path = ?')) return db._data.adapters.filter(a => a.file_path === arg1);
            if (sql.includes('kind = ?')) return db._data.adapters.filter(a => a.kind === arg1);
            return db._data.adapters;
          }
          return [];
        },
        transaction: (fn) => (args) => fn(args)
      };
    }
    transaction(fn) { return (args) => fn(args); }
    close() {}
  };
}

// ── Schema ────────────────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nodes (
  file_path    TEXT    PRIMARY KEY,
  lang         TEXT    NOT NULL DEFAULT '',
  risk_score   INTEGER NOT NULL DEFAULT 0,
  is_entry     INTEGER NOT NULL DEFAULT 0,
  is_barrel    INTEGER NOT NULL DEFAULT 0,
  is_test      INTEGER NOT NULL DEFAULT 0,
  role         TEXT    NOT NULL DEFAULT '',
  band         TEXT    NOT NULL DEFAULT '',
  summary      TEXT    NOT NULL DEFAULT '',
  purpose      TEXT    NOT NULL DEFAULT '',
  exports      TEXT    NOT NULL DEFAULT '[]',
  gaps         TEXT    NOT NULL DEFAULT '[]',
  meta         TEXT    NOT NULL DEFAULT '{}',
  file_hash    TEXT,
  error        INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL,

  -- Git history (from git log)
  total_commits        INTEGER NOT NULL DEFAULT 0,
  bug_fix_commits      INTEGER NOT NULL DEFAULT 0,
  hack_commits         INTEGER NOT NULL DEFAULT 0,
  todo_count           INTEGER NOT NULL DEFAULT 0,
  first_commit_date    TEXT    DEFAULT NULL,
  last_commit_date     TEXT    DEFAULT NULL,
  age_in_days          INTEGER NOT NULL DEFAULT 0,
  authors              TEXT    NOT NULL DEFAULT '[]',

  -- Relationships (denormalized for speed)
  imported_by_count    INTEGER NOT NULL DEFAULT 0,
  import_count         INTEGER NOT NULL DEFAULT 0,

  -- Risk & safety
  is_public_contract   INTEGER NOT NULL DEFAULT 0,
  has_tests            INTEGER NOT NULL DEFAULT 0,
  is_dead_file         INTEGER NOT NULL DEFAULT 0,
  danger_reason        TEXT    DEFAULT NULL,

  -- Entry points
  entry_point_type     TEXT    DEFAULT NULL,
  entry_point_confidence INTEGER NOT NULL DEFAULT 0,

  -- Analysis results
  is_circular_dep      INTEGER NOT NULL DEFAULT 0,
  circular_cycle_id    INTEGER DEFAULT NULL,
  gap_count            INTEGER NOT NULL DEFAULT 0,
  community_id         INTEGER DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS edges (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source       TEXT    NOT NULL,
  target       TEXT    NOT NULL,
  kind         TEXT    NOT NULL DEFAULT 'imports',
  file_path    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS metadata (
  key          TEXT    PRIMARY KEY,
  value        TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS symbols (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path  TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  kind       TEXT    NOT NULL DEFAULT 'function',
  line_start INTEGER NOT NULL DEFAULT 0,
  signature  TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS daemons (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT    NOT NULL,
  kind      TEXT    NOT NULL,
  event     TEXT,
  line      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS adapters (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT    NOT NULL,
  kind      TEXT    NOT NULL,
  library   TEXT    NOT NULL,
  external  INTEGER NOT NULL DEFAULT 1,
  line      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS symbol_calls (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_file     TEXT    NOT NULL,
  source_symbol   TEXT    NOT NULL,
  target_file     TEXT    NOT NULL,
  target_symbol   TEXT    NOT NULL,
  kind            TEXT    NOT NULL DEFAULT 'call',
  file_path       TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS blast_radius (
  file_path             TEXT PRIMARY KEY,
  direct_dependents     TEXT NOT NULL DEFAULT '[]',
  transitive_dependents TEXT NOT NULL DEFAULT '[]',
  transitive_count      INTEGER NOT NULL DEFAULT 0,
  cross_language_hits   TEXT NOT NULL DEFAULT '[]',
  max_import_depth      INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(file_path) REFERENCES nodes(file_path)
);

CREATE TABLE IF NOT EXISTS dead_code (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path             TEXT NOT NULL,
  type                  TEXT NOT NULL,
  export_name           TEXT,
  is_safe_to_delete     INTEGER NOT NULL DEFAULT 0,
  reason                TEXT,
  UNIQUE(file_path, export_name),
  FOREIGN KEY(file_path) REFERENCES nodes(file_path)
);

CREATE TABLE IF NOT EXISTS circular_dependencies (
  cycle_id              INTEGER PRIMARY KEY AUTOINCREMENT,
  files                 TEXT NOT NULL,
  files_count           INTEGER NOT NULL,
  detected_at_line      INTEGER,
  severity              TEXT NOT NULL DEFAULT 'logic'
);

CREATE TABLE IF NOT EXISTS coverage_gaps (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path             TEXT NOT NULL,
  gap_type              TEXT NOT NULL,
  pattern               TEXT,
  line_number           INTEGER,
  severity              TEXT NOT NULL DEFAULT 'medium',
  FOREIGN KEY(file_path) REFERENCES nodes(file_path)
);

CREATE TABLE IF NOT EXISTS entry_points (
  file_path             TEXT PRIMARY KEY,
  detection_method      TEXT NOT NULL,
  confidence            INTEGER NOT NULL DEFAULT 0,
  signal_score          INTEGER NOT NULL DEFAULT 0,
  reason                TEXT,
  FOREIGN KEY(file_path) REFERENCES nodes(file_path)
);

CREATE TABLE IF NOT EXISTS module_roles (
  file_path             TEXT PRIMARY KEY,
  primary_role          TEXT NOT NULL,
  confidence            INTEGER NOT NULL DEFAULT 0,
  reason                TEXT,
  FOREIGN KEY(file_path) REFERENCES nodes(file_path)
);

CREATE INDEX IF NOT EXISTS idx_edges_source   ON edges(source);
CREATE INDEX IF NOT EXISTS idx_edges_target   ON edges(target);
CREATE INDEX IF NOT EXISTS idx_edges_file     ON edges(file_path);
CREATE INDEX IF NOT EXISTS idx_notes_lang     ON nodes(lang);
CREATE INDEX IF NOT EXISTS idx_symbols_file   ON symbols(file_path);
CREATE INDEX IF NOT EXISTS idx_symbols_name   ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_daemons_file   ON daemons(file_path);
CREATE INDEX IF NOT EXISTS idx_daemons_kind   ON daemons(kind);
CREATE INDEX IF NOT EXISTS idx_adapters_file  ON adapters(file_path);
CREATE INDEX IF NOT EXISTS idx_adapters_kind  ON adapters(kind);
CREATE INDEX IF NOT EXISTS idx_symbol_calls_source ON symbol_calls(source_file, source_symbol);
CREATE INDEX IF NOT EXISTS idx_symbol_calls_target ON symbol_calls(target_file, target_symbol);
CREATE INDEX IF NOT EXISTS idx_symbol_calls_file   ON symbol_calls(file_path);
`;

// ── GraphStore ────────────────────────────────────────────────────────────────

class GraphStore {
  /**
   * Open (or create) the graph database.
   * @param {string} dbPath  — absolute path to .wednesday/graph.db
   * @returns {GraphStore}
   */
  static open(dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    return new GraphStore(dbPath);
  }

  constructor(dbPath) {
    this._db = new Database(dbPath);
    this._db.pragma('journal_mode = WAL');   // concurrent readers, faster writes
    this._db.pragma('synchronous = NORMAL'); // safe + faster than FULL
    this._db.pragma('foreign_keys = OFF');   // we manage integrity ourselves
    this._db.exec(SCHEMA);
    this._migrate();
    this._prepare();
  }

  // ── Migrations for existing DBs ──────────────────────────────────────────────
  _migrate() {
    // ALTER TABLE ADD COLUMN is safe to run repeatedly — errors mean column exists
    const newCols = [
      'ALTER TABLE nodes ADD COLUMN is_test  INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE nodes ADD COLUMN role     TEXT    NOT NULL DEFAULT \'\'',
      'ALTER TABLE nodes ADD COLUMN band     TEXT    NOT NULL DEFAULT \'\'',
      'ALTER TABLE nodes ADD COLUMN summary  TEXT    NOT NULL DEFAULT \'\'',
      // Phase 2: DB Enrichment columns
      'ALTER TABLE nodes ADD COLUMN purpose      TEXT    NOT NULL DEFAULT \'\'',
      'ALTER TABLE nodes ADD COLUMN total_commits        INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE nodes ADD COLUMN bug_fix_commits      INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE nodes ADD COLUMN hack_commits         INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE nodes ADD COLUMN todo_count           INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE nodes ADD COLUMN first_commit_date    TEXT    DEFAULT NULL',
      'ALTER TABLE nodes ADD COLUMN last_commit_date     TEXT    DEFAULT NULL',
      'ALTER TABLE nodes ADD COLUMN age_in_days          INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE nodes ADD COLUMN authors              TEXT    NOT NULL DEFAULT \'[]\'',
      'ALTER TABLE nodes ADD COLUMN imported_by_count    INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE nodes ADD COLUMN import_count         INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE nodes ADD COLUMN is_public_contract   INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE nodes ADD COLUMN has_tests            INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE nodes ADD COLUMN is_dead_file         INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE nodes ADD COLUMN danger_reason        TEXT    DEFAULT NULL',
      'ALTER TABLE nodes ADD COLUMN entry_point_type     TEXT    DEFAULT NULL',
      'ALTER TABLE nodes ADD COLUMN entry_point_confidence INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE nodes ADD COLUMN is_circular_dep      INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE nodes ADD COLUMN circular_cycle_id    INTEGER DEFAULT NULL',
      'ALTER TABLE nodes ADD COLUMN gap_count            INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE nodes ADD COLUMN community_id         INTEGER DEFAULT NULL',
    ];
    for (const sql of newCols) {
      try { this._db.exec(sql); } catch { /* column already exists */ }
    }
    // New indexes (CREATE INDEX IF NOT EXISTS is idempotent)
    try {
      this._db.exec(`
        CREATE INDEX IF NOT EXISTS idx_nodes_risk ON nodes(risk_score DESC);
        CREATE INDEX IF NOT EXISTS idx_nodes_entry ON nodes(is_entry);
        CREATE INDEX IF NOT EXISTS idx_nodes_role ON nodes(role);
        CREATE INDEX IF NOT EXISTS idx_nodes_band ON nodes(band);
        CREATE INDEX IF NOT EXISTS idx_nodes_community ON nodes(community_id);
        CREATE INDEX IF NOT EXISTS idx_nodes_test ON nodes(is_test);
        CREATE INDEX IF NOT EXISTS idx_nodes_imported_by ON nodes(imported_by_count DESC);
        CREATE INDEX IF NOT EXISTS idx_nodes_dead ON nodes(is_dead_file);
        CREATE INDEX IF NOT EXISTS idx_entry_confidence ON entry_points(confidence DESC);
        CREATE INDEX IF NOT EXISTS idx_role_primary ON module_roles(primary_role);
        CREATE INDEX IF NOT EXISTS idx_dead_safe ON dead_code(is_safe_to_delete);
        CREATE INDEX IF NOT EXISTS idx_circular_files ON circular_dependencies(files);
        CREATE INDEX IF NOT EXISTS idx_gaps_file ON coverage_gaps(file_path);
      `);
    } catch (e) {
      console.warn('[db-migration] Index creation failed:', e.message);
    }
  }

  // ── Prepared statements (hot paths) ─────────────────────────────────────────

  _prepare() {
    this._stmts = {
      upsertNode: this._db.prepare(`
        INSERT INTO nodes
          (file_path, lang, risk_score, is_entry, is_barrel, is_test, role, band, summary, purpose, exports, gaps, meta,
           file_hash, error, updated_at, total_commits, bug_fix_commits, hack_commits, todo_count, first_commit_date,
           last_commit_date, age_in_days, authors, imported_by_count, import_count, is_public_contract, has_tests,
           is_dead_file, danger_reason, entry_point_type, entry_point_confidence, is_circular_dep, circular_cycle_id, gap_count, community_id)
        VALUES
          (@file_path, @lang, @risk_score, @is_entry, @is_barrel, @is_test, @role, @band, @summary, @purpose, @exports, @gaps, @meta,
           @file_hash, @error, @updated_at, @total_commits, @bug_fix_commits, @hack_commits, @todo_count, @first_commit_date,
           @last_commit_date, @age_in_days, @authors, @imported_by_count, @import_count, @is_public_contract, @has_tests,
           @is_dead_file, @danger_reason, @entry_point_type, @entry_point_confidence, @is_circular_dep, @circular_cycle_id, @gap_count, @community_id)
        ON CONFLICT(file_path) DO UPDATE SET
          lang=excluded.lang, risk_score=excluded.risk_score,
          is_entry=excluded.is_entry, is_barrel=excluded.is_barrel,
          is_test=excluded.is_test, role=excluded.role, band=excluded.band,
          summary=excluded.summary, purpose=excluded.purpose, exports=excluded.exports, gaps=excluded.gaps,
          meta=excluded.meta, file_hash=excluded.file_hash,
          error=excluded.error, updated_at=excluded.updated_at,
          total_commits=excluded.total_commits, bug_fix_commits=excluded.bug_fix_commits,
          hack_commits=excluded.hack_commits, todo_count=excluded.todo_count,
          first_commit_date=excluded.first_commit_date, last_commit_date=excluded.last_commit_date,
          age_in_days=excluded.age_in_days, authors=excluded.authors,
          imported_by_count=excluded.imported_by_count, import_count=excluded.import_count,
          is_public_contract=excluded.is_public_contract, has_tests=excluded.has_tests,
          is_dead_file=excluded.is_dead_file, danger_reason=excluded.danger_reason,
          entry_point_type=excluded.entry_point_type, entry_point_confidence=excluded.entry_point_confidence,
          is_circular_dep=excluded.is_circular_dep, circular_cycle_id=excluded.circular_cycle_id, gap_count=excluded.gap_count, community_id=excluded.community_id
      `),

      updateSummary: this._db.prepare(
        `UPDATE nodes SET summary = ? WHERE file_path = ?`
      ),

      updateBand: this._db.prepare(
        `UPDATE nodes SET band = ?, risk_score = ? WHERE file_path = ?`
      ),

      updateRole: this._db.prepare(
        `UPDATE nodes SET role = ? WHERE file_path = ?`
      ),

      getByRole: this._db.prepare(
        `SELECT file_path, summary, risk_score, band FROM nodes WHERE role = ? AND is_test = 0 ORDER BY risk_score DESC`
      ),

      getByBand: this._db.prepare(
        `SELECT file_path, role, summary, risk_score FROM nodes WHERE band = ? AND is_test = 0 ORDER BY risk_score DESC`
      ),

      searchSummary: this._db.prepare(
        `SELECT file_path, role, summary, risk_score, band FROM nodes WHERE summary LIKE ? AND is_test = 0 ORDER BY risk_score DESC LIMIT 10`
      ),

      insertEdge: this._db.prepare(`
        INSERT INTO edges (source, target, kind, file_path)
        VALUES (@source, @target, @kind, @file_path)
      `),

      deleteEdgesByFileAndKind: this._db.prepare(
        'DELETE FROM edges WHERE file_path = ? AND kind = ?'
      ),

      deleteNode: this._db.prepare(
        'DELETE FROM nodes WHERE file_path = ?'
      ),

      getNode: this._db.prepare(
        'SELECT * FROM nodes WHERE file_path = ?'
      ),

      getFileHash: this._db.prepare(
        'SELECT file_hash FROM nodes WHERE file_path = ?'
      ),

      edgesBySource: this._db.prepare(
        'SELECT target, kind FROM edges WHERE source = ?'
      ),

      edgesByTarget: this._db.prepare(
        'SELECT source, kind FROM edges WHERE target = ?'
      ),

      edgesByKind: this._db.prepare(
        'SELECT source, target FROM edges WHERE target = ? AND kind = ?'
      ),

      getCallsBySource: this._db.prepare(
        'SELECT target FROM edges WHERE source = ? AND kind = ?'
      ),

      setMeta: this._db.prepare(`
        INSERT INTO metadata (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value
      `),

      getMeta: this._db.prepare(
        'SELECT value FROM metadata WHERE key = ?'
      ),

      deleteSymbolsByFile: this._db.prepare(
        'DELETE FROM symbols WHERE file_path = ?'
      ),

      insertSymbol: this._db.prepare(`
        INSERT INTO symbols (file_path, name, kind, line_start, signature)
        VALUES (@file_path, @name, @kind, @line_start, @signature)
      `),

      getSymbolsByFile: this._db.prepare(
        'SELECT name, kind, line_start, signature FROM symbols WHERE file_path = ?'
      ),

      findSymbolByName: this._db.prepare(
        'SELECT file_path, name, kind, line_start, signature FROM symbols WHERE name = ? COLLATE NOCASE'
      ),

      deleteSymbolCallsByFile: this._db.prepare(
        'DELETE FROM symbol_calls WHERE file_path = ?'
      ),

      insertSymbolCall: this._db.prepare(`
        INSERT INTO symbol_calls (source_file, source_symbol, target_file, target_symbol, kind, file_path)
        VALUES (@source_file, @source_symbol, @target_file, @target_symbol, @kind, @file_path)
      `),

      getSymbolCallsBySource: this._db.prepare(
        'SELECT target_file, target_symbol, kind FROM symbol_calls WHERE source_file = ? AND source_symbol = ?'
      ),

      getSymbolCallersByTarget: this._db.prepare(
        'SELECT source_file, source_symbol, kind FROM symbol_calls WHERE target_file = ? AND target_symbol = ?'
      ),

      deleteDaemonsByFile: this._db.prepare(
        'DELETE FROM daemons WHERE file_path = ?'
      ),

      insertDaemon: this._db.prepare(`
        INSERT INTO daemons (file_path, kind, event, line)
        VALUES (@file_path, @kind, @event, @line)
      `),

      getDaemonsByFile: this._db.prepare(
        'SELECT kind, event, line FROM daemons WHERE file_path = ?'
      ),

      getDaemonsByKind: this._db.prepare(
        'SELECT file_path, event, line FROM daemons WHERE kind = ?'
      ),

      getAllDaemons: this._db.prepare(
        'SELECT file_path, kind, event, line FROM daemons ORDER BY file_path'
      ),

      deleteAdaptersByFile: this._db.prepare(
        'DELETE FROM adapters WHERE file_path = ?'
      ),

      insertAdapter: this._db.prepare(`
        INSERT INTO adapters (file_path, kind, library, external, line)
        VALUES (@file_path, @kind, @library, @external, @line)
      `),

      getAdaptersByFile: this._db.prepare(
        'SELECT kind, library, external, line FROM adapters WHERE file_path = ?'
      ),

      getAdaptersByKind: this._db.prepare(
        'SELECT file_path, library, line FROM adapters WHERE kind = ?'
      ),

      getAllAdapters: this._db.prepare(
        'SELECT file_path, kind, library, external, line FROM adapters ORDER BY kind, library'
      ),

      // Blast radius operations
      upsertBlastRadius: this._db.prepare(`
        INSERT INTO blast_radius
          (file_path, direct_dependents, transitive_dependents, transitive_count, cross_language_hits, max_import_depth)
        VALUES
          (@file_path, @direct_dependents, @transitive_dependents, @transitive_count, @cross_language_hits, @max_import_depth)
        ON CONFLICT(file_path) DO UPDATE SET
          direct_dependents=excluded.direct_dependents,
          transitive_dependents=excluded.transitive_dependents,
          transitive_count=excluded.transitive_count,
          cross_language_hits=excluded.cross_language_hits,
          max_import_depth=excluded.max_import_depth
      `),

      getBlastRadius: this._db.prepare(
        'SELECT * FROM blast_radius WHERE file_path = ?'
      ),

      // Dead code operations
      insertDeadCode: this._db.prepare(`
        INSERT OR REPLACE INTO dead_code (file_path, type, export_name, is_safe_to_delete, reason)
        VALUES (@file_path, @type, @export_name, @is_safe_to_delete, @reason)
      `),

      getDeadCode: this._db.prepare(
        'SELECT file_path, type, export_name, reason FROM dead_code WHERE is_safe_to_delete = 1 ORDER BY file_path'
      ),

      // Entry point operations
      upsertEntryPoint: this._db.prepare(`
        INSERT INTO entry_points (file_path, detection_method, confidence, signal_score, reason)
        VALUES (@file_path, @detection_method, @confidence, @signal_score, @reason)
        ON CONFLICT(file_path) DO UPDATE SET
          detection_method=excluded.detection_method,
          confidence=excluded.confidence,
          signal_score=excluded.signal_score,
          reason=excluded.reason
      `),

      getEntryPoints: this._db.prepare(
        'SELECT file_path, detection_method, confidence, reason FROM entry_points ORDER BY confidence DESC'
      ),

      getHighConfidenceEntryPoints: this._db.prepare(
        'SELECT file_path FROM entry_points WHERE confidence > ? ORDER BY confidence DESC'
      ),

      // Module role operations
      upsertModuleRole: this._db.prepare(`
        INSERT INTO module_roles (file_path, primary_role, confidence, reason)
        VALUES (@file_path, @primary_role, @confidence, @reason)
        ON CONFLICT(file_path) DO UPDATE SET
          primary_role=excluded.primary_role,
          confidence=excluded.confidence,
          reason=excluded.reason
      `),

      getModulesByRole: this._db.prepare(
        'SELECT file_path, primary_role, confidence FROM module_roles WHERE primary_role = ? ORDER BY confidence DESC'
      ),

      // Circular dependency operations
      insertCircularDependency: this._db.prepare(`
        INSERT INTO circular_dependencies (files, files_count, detected_at_line, severity)
        VALUES (@files, @files_count, @detected_at_line, @severity)
      `),

      getCircularDependencies: this._db.prepare(
        'SELECT cycle_id, files, files_count, severity FROM circular_dependencies ORDER BY files_count DESC'
      ),

      // Coverage gap operations
      insertCoverageGap: this._db.prepare(`
        INSERT INTO coverage_gaps (file_path, gap_type, pattern, line_number, severity)
        VALUES (@file_path, @gap_type, @pattern, @line_number, @severity)
      `),

      getCoverageGapsByFile: this._db.prepare(
        'SELECT gap_type, pattern, line_number, severity FROM coverage_gaps WHERE file_path = ?'
      ),

      getAllCoverageGaps: this._db.prepare(
        'SELECT file_path, gap_type, COUNT(*) as count FROM coverage_gaps GROUP BY file_path, gap_type ORDER BY count DESC'
      ),
    };
  }

  // ── Write operations ─────────────────────────────────────────────────────────

  /**
   * Insert or replace a node.
   * Accepts the same shape as the in-memory graph nodes object.
   *
   * @param {Object} node  — graph node { file, lang, imports, exports, gaps,
   *                          riskScore, isEntryPoint, isBarrel, meta, error }
   * @param {string} [fileHash]
   */
  upsertNode(node, fileHash) {
    const isTest = /\.test\.[jt]sx?$|\.spec\.[jt]sx?$|\/__tests__\/|Tests\.swift$|Spec\.swift$|UITests\.swift$|\/Tests\/|_test\.go$|Test\.kt$|\/androidTest\//.test(node.file) ? 1 : 0;
    this._stmts.upsertNode.run({
      file_path:  node.file,
      lang:       node.lang || '',
      risk_score: node.riskScore || 0,
      is_entry:   node.isEntryPoint ? 1 : 0,
      is_barrel:  node.isBarrel ? 1 : 0,
      is_test:    isTest,
      role:       node.role || '',
      band:       node.band || '',
      summary:    node.summary || '',
      purpose:    node.purpose || '',
      exports:    JSON.stringify(node.exports || []),
      gaps:       JSON.stringify(node.gaps || []),
      meta:       JSON.stringify(node.meta || {}),
      file_hash:  fileHash || null,
      error:      node.error ? 1 : 0,
      updated_at: Date.now(),
      // Enrichment fields (populated by separate analysis passes)
      total_commits:        node.gitHistory?.totalCommits || 0,
      bug_fix_commits:      node.gitHistory?.bugFixCommits || 0,
      hack_commits:         node.gitHistory?.hackCommits || 0,
      todo_count:           node.gitHistory?.todoCount || 0,
      first_commit_date:    node.gitHistory?.firstCommit || null,
      last_commit_date:     node.gitHistory?.lastCommit || null,
      age_in_days:          node.gitHistory?.ageInDays || 0,
      authors:              JSON.stringify(node.gitHistory?.authors || []),
      imported_by_count:    node.importedByCount || 0,
      import_count:         (node.imports?.length || 0),
      is_public_contract:   node.isPublicContract ? 1 : 0,
      has_tests:            node.hasTests ? 1 : 0,
      is_dead_file:         node.isDeadFile ? 1 : 0,
      danger_reason:        node.dangerReason || null,
      entry_point_type:     node.entryPointType || null,
      entry_point_confidence: node.entryPointConfidence || 0,
      is_circular_dep:      node.isCircularDep ? 1 : 0,
      circular_cycle_id:    node.circularCycleId || null,
      gap_count:            node.gaps?.length || 0,
      community_id:         node.communityId || null,
    });
  }

  /**
   * Bulk-update summary strings after LLM summarization.
   * @param {Object} summaries  — { filePath: summaryString }
   */
  updateSummaries(summaries) {
    const tx = this._db.transaction((entries) => {
      for (const [file, summary] of entries) {
        this._stmts.updateSummary.run(summary || '', file);
      }
    });
    tx(Object.entries(summaries));
  }

  /**
   * Bulk-update band + risk_score after safety scoring.
   * @param {Object} scoreMap  — { filePath: { band, score } }
   */
  updateScores(scoreMap) {
    const tx = this._db.transaction((entries) => {
      for (const [file, s] of entries) {
        this._stmts.updateBand.run(s.band || '', s.score || 0, file);
      }
    });
    tx(Object.entries(scoreMap));
  }

  /**
   * Bulk-update role classifications after role assignment.
   * @param {Object} roleMap  — { filePath: roleString }
   */
  updateRoles(roleMap) {
    const tx = this._db.transaction((entries) => {
      for (const [file, role] of entries) {
        this._stmts.updateRole.run(role || '', file);
      }
    });
    tx(Object.entries(roleMap));
  }

  /**
   * Replace all edges of a given kind owned by a file.
   * Deletes old edges first (atomic within one file's transaction).
   *
   * @param {string}   filePath  — relative file path that owns these edges
   * @param {string[]} targets   — list of target file paths (imports)
   * @param {string}   [kind]    — edge kind, default 'imports'
   */
  upsertEdges(filePath, targets, kind = 'imports') {
    this._stmts.deleteEdgesByFileAndKind.run(filePath, kind);
    for (const target of targets) {
      this._stmts.insertEdge.run({ source: filePath, target, kind, file_path: filePath });
    }
  }

  /**
   * Remove all data (node + edges) for a file.
   * Used during incremental map when a file is deleted.
   */
  removeFile(filePath) {
    this._stmts.deleteEdgesByFileAndKind.run(filePath, 'imports');
    this._stmts.deleteEdgesByFileAndKind.run(filePath, 'calls');
    this._stmts.deleteSymbolsByFile.run(filePath);
    this._stmts.deleteSymbolCallsByFile.run(filePath);
    this._stmts.deleteNode.run(filePath);
  }

  /**
   * Replace all symbols for a file atomically.
   * @param {string}   filePath  — relative file path
   * @param {Array}    symbols   — [{ name, kind, lineStart, signature }]
   */
  upsertSymbols(filePath, symbols) {
    this._stmts.deleteSymbolsByFile.run(filePath);
    for (const sym of symbols) {
      this._stmts.insertSymbol.run({
        file_path:  filePath,
        name:       sym.name,
        kind:       sym.kind || 'function',
        line_start: sym.lineStart || 0,
        signature:  sym.signature || '',
      });
    }
  }

  /**
   * Replace all symbol calls for a file atomically.
   * @param {string} filePath
   * @param {Array}  calls — [{ sourceSymbol, targetFile, targetSymbol, kind }]
   */
  upsertSymbolCalls(filePath, calls) {
    this._stmts.deleteSymbolCallsByFile.run(filePath);
    for (const c of calls) {
      this._stmts.insertSymbolCall.run({
        source_file:   filePath,
        source_symbol: c.sourceSymbol,
        target_file:   c.targetFile,
        target_symbol: c.targetSymbol,
        kind:          c.kind || 'call',
        file_path:     filePath,
      });
    }
  }

  /**
   * Write all nodes and edges from a full graph object in one transaction.
   * Used at the end of a full buildGraph pass.
   *
   * @param {Object} nodes    — dep-graph nodes object { filePath: nodeData }
   * @param {Object} hashMap  — optional { relPath: sha1Hash } for file-change detection
   */
  writeAll(nodes, hashMap = {}) {
    const writeAllTx = this._db.transaction((nodeEntries) => {
      // Clear existing data
      this._db.exec('DELETE FROM nodes; DELETE FROM edges; DELETE FROM symbols;');

      for (const [, node] of nodeEntries) {
        this.upsertNode(node, hashMap[node.file] || null);
        this.upsertEdges(node.file, node.imports || [], 'imports');
        if (node.calls && node.calls.length > 0) {
          this.upsertEdges(node.file, node.calls, 'calls');
        }
        if (node.symbols && node.symbols.length > 0) {
          this.upsertSymbols(node.file, node.symbols);
        }
        if (node.symbolCalls && node.symbolCalls.length > 0) {
          this.upsertSymbolCalls(node.file, node.symbolCalls);
        }
      }
    });
    writeAllTx(Object.entries(nodes));
  }

  /**
   * Write a single node + its edges atomically.
   * Used during incremental map for changed files.
   *
   * @param {Object} node
   * @param {string} fileHash
   */
  writeFile(node, fileHash) {
    const writeTx = this._db.transaction(() => {
      this.upsertNode(node, fileHash);
      this.upsertEdges(node.file, node.imports || [], 'imports');
      if (node.calls && node.calls.length > 0) {
        this.upsertEdges(node.file, node.calls, 'calls');
      }
      if (node.symbols && node.symbols.length > 0) {
        this.upsertSymbols(node.file, node.symbols);
      }
      if (node.symbolCalls && node.symbolCalls.length > 0) {
        this.upsertSymbolCalls(node.file, node.symbolCalls);
      }
    });
    writeTx();
  }

  setMeta(key, value) {
    this._stmts.setMeta.run(key, String(value));
  }

  getMeta(key) {
    const row = this._stmts.getMeta.get(key);
    return row ? row.value : null;
  }

  // ── Read operations ──────────────────────────────────────────────────────────

  /**
   * Get a single node by file path.
   * Returns null if not found.
   */
  getNode(filePath) {
    const row = this._stmts.getNode.get(filePath);
    return row ? this._rowToNode(row) : null;
  }

  /**
   * Get the stored file hash for a path.
   * Returns null if file not in database (first run, or new file).
   */
  getFileHash(filePath) {
    const row = this._stmts.getFileHash.get(filePath);
    return row ? row.file_hash : null;
  }

  /**
   * Get all files that import the given file path (reverse edges).
   * @returns {string[]} list of source file paths
   */
  getImporters(filePath) {
    return this._stmts.edgesByTarget.all(filePath).map(r => r.source);
  }

  /**
   * Get all files imported by the given file path (forward edges).
   * @returns {string[]} list of target file paths
   */
  getImports(filePath) {
    return this._stmts.edgesBySource.all(filePath).filter(r => r.kind === 'imports').map(r => r.target);
  }

  /**
   * Get all files/symbols that call the given qualified name.
   * @param {string} qualifiedName — e.g. 'src/auth/token.js::signToken'
   * @returns {string[]} source file paths
   */
  getCallers(qualifiedName) {
    return this._stmts.edgesByKind.all(qualifiedName, 'calls').map(r => r.source);
  }

  /**
   * Get all qualified names called by this file.
   * @param {string} filePath
   * @returns {string[]} qualified names like 'src/auth/token.js::signToken'
   */
  getCalls(filePath) {
    return this._stmts.getCallsBySource.all(filePath, 'calls').map(r => r.target);
  }

  /**
   * Get all calls made BY a specific symbol in a file.
   * @param {string} file
   * @param {string} symbol
   */
  getSymbolCalls(file, symbol) {
    return this._stmts.getSymbolCallsBySource.all(file, symbol).map(r => ({
      file:   r.target_file,
      symbol: r.target_symbol,
      kind:   r.kind,
    }));
  }

  /**
   * Get all callers OF a specific symbol.
   * @param {string} file
   * @param {string} symbol
   */
  getSymbolCallers(file, symbol) {
    return this._stmts.getSymbolCallersByTarget.all(file, symbol).map(r => ({
      file:   r.source_file,
      symbol: r.source_symbol,
      kind:   r.kind,
    }));
  }

  /**
   * Get all nodes as raw rows (for full-graph operations).
   */
  getAllNodes() {
    return this._db.prepare('SELECT * FROM nodes').all().map(r => this._rowToNode(r));
  }

  /**
   * Get all edges as raw objects.
   */
  getAllEdges() {
    return this._db.prepare('SELECT source, target, kind, file_path FROM edges').all();
  }

  /**
   * Aggregate statistics — same shape as graph.stats.
   */
  getStats() {
    const total = this._db.prepare('SELECT COUNT(*) as c FROM nodes').get().c;
    const edges = this._db.prepare('SELECT COUNT(*) as c FROM edges').get().c;
    const highRisk = this._db.prepare('SELECT COUNT(*) as c FROM nodes WHERE risk_score > 60').get().c;
    const errors = this._db.prepare('SELECT COUNT(*) as c FROM nodes WHERE error = 1').get().c;
    const gaps = this._db.prepare("SELECT SUM(json_array_length(gaps)) as c FROM nodes").get().c || 0;

    const byLangRows = this._db.prepare(
      'SELECT lang, COUNT(*) as c FROM nodes GROUP BY lang'
    ).all();
    const byLang = {};
    for (const r of byLangRows) byLang[r.lang] = r.c;

    return {
      totalFiles:    total,
      totalEdges:    edges,
      highRiskFiles: highRisk,
      errorFiles:    errors,
      gapCount:      gaps,
      byLang,
    };
  }

  /**
   * Check if the store has any data.
   */
  isEmpty() {
    return this._db.prepare('SELECT COUNT(*) as c FROM nodes').get().c === 0;
  }
  
  /**
   * Get all file paths in the graph.
   * @returns {Array<string>}
   */
  getAllFiles() {
    return this._db.prepare('SELECT file_path FROM nodes').all().map(r => r.file_path);
  }

  /**
   * Get files matching a simple LIKE pattern.
   * @param {string} pattern - SQL LIKE pattern
   * @returns {Array<string>}
   */
  getFilesByPattern(pattern) {
    return this._db.prepare('SELECT file_path FROM nodes WHERE file_path LIKE ?').all(pattern).map(r => r.file_path);
  }

  /**
   * Get all symbols defined in a file.
   * @returns {Array<{ name, kind, lineStart, signature }>}
   */
  getSymbols(filePath) {
    return this._stmts.getSymbolsByFile.all(filePath).map(r => ({
      name:      r.name,
      kind:      r.kind,
      lineStart: r.line_start,
      signature: r.signature,
    }));
  }

  /**
   * Find the most significant functional flows in the codebase.
   * Uses a recursive CTE to trace paths from entry points (depth up to 4).
   * @returns {Array<{ path: string, depth: number }>}
   */
  getPrimaryFlows(maxDepth = 8, limit = 10) {
    const query = `
      WITH RECURSIVE
        path_trace(source, target, depth, path, has_call) AS (
          -- Anchor: start from entry points OR logical scene roots (ViewControllers with low in-degree)
          SELECT source, target, 1, source || ' -> ' || target, (kind = 'calls')
          FROM edges
          JOIN nodes ON edges.source = nodes.file_path
          WHERE (nodes.is_entry = 1 OR (nodes.file_path LIKE '%ViewController%' AND (SELECT COUNT(*) FROM edges ie WHERE ie.target = nodes.file_path AND ie.kind = 'imports') < 2))
            AND target NOT LIKE '%Extensions%'
            AND target NOT LIKE '%Constants%'
            AND target NOT LIKE '%Generated%'
            AND target NOT LIKE '%Mock%'
            AND target NOT LIKE '%Tests%'
          
          UNION ALL
          
          -- Recursive step: find next hop
          SELECT pt.target, e.target, pt.depth + 1, pt.path || ' -> ' || e.target, 
                 pt.has_call OR (e.kind = 'calls')
          FROM path_trace pt
          JOIN edges e ON pt.target = e.source
          -- Filter out structural nodes from intermediates EXCEPT VIP layers
          WHERE pt.depth < ? 
            AND pt.path NOT LIKE '%' || e.target || '%'
            -- Hard structural filters
            AND e.target NOT LIKE '%Extensions%'
            AND e.target NOT LIKE '%Constants%'
            AND e.target NOT LIKE '%Generated%'
            AND e.target NOT LIKE '%UserDefaults%'
            AND e.target NOT LIKE '%Config%'
            AND e.target NOT LIKE '%Resource%'
            -- Allow Interactor, Presenter, Router specifically
            AND (
              e.target LIKE '%Interactor%' OR 
              e.target LIKE '%Presenter%' OR 
              e.target LIKE '%Router%' OR 
              e.target LIKE '%Controller%' OR
              e.target LIKE '%Service%' OR
              (e.target NOT LIKE '%Manager%' AND e.target NOT LIKE '%Helper%' AND e.target NOT LIKE '%Util%')
            )
        )
      SELECT path, depth, has_call, target
      FROM path_trace
      WHERE depth >= 2
        -- Focus on paths ending in core business logic or display
        AND (target LIKE '%Controller%' OR target LIKE '%Interactor%' OR target LIKE '%Presenter%' OR target LIKE '%Service%')
      GROUP BY path -- Deduplicate same-path traces
      ORDER BY has_call DESC, depth DESC
      LIMIT ?;
    `;
    // We get more and let the JS layer (flow-discovery.js) do the final "interestingness" filtering
    return this._db.prepare(query).all(maxDepth, limit * 2);
  }

  /**
   * Find all definitions of a symbol by name (case-insensitive).
   * @returns {Array<{ file, name, kind, lineStart, signature }>}
   */
  findSymbol(name) {
    return this._stmts.findSymbolByName.all(name).map(r => ({
      file:      r.file_path,
      name:      r.name,
      kind:      r.kind,
      lineStart: r.line_start,
      signature: r.signature,
    }));
  }

  // ── Query methods — role / band / summary ────────────────────────────────────

  /** Files matching a role (e.g. 'service', 'controller', 'React hook') */
  getByRole(role) {
    return this._stmts.getByRole.all(role).map(r => ({
      file: r.file_path, summary: r.summary, score: r.risk_score, band: r.band,
    }));
  }

  /** Files in a risk band: 'critical' | 'risky' | 'moderate' | 'safe' */
  getByBand(band) {
    return this._stmts.getByBand.all(band).map(r => ({
      file: r.file_path, role: r.role, summary: r.summary, score: r.risk_score,
    }));
  }

  /**
   * Full-text search over summaries.
   * @param {string} term  — plain word or phrase (wrapped with % wildcards)
   */
  searchByTopic(term) {
    return this._stmts.searchSummary.all(`%${term}%`).map(r => ({
      file: r.file_path, role: r.role, summary: r.summary, score: r.risk_score, band: r.band,
    }));
  }

  // ── Daemon methods ───────────────────────────────────────────────────────────

  /**
   * Replace all daemon entries for a file.
   * @param {string} filePath
   * @param {Array<{kind: string, event: string|null, line: number}>} daemons
   */
  saveDaemons(filePath, daemons) {
    this._stmts.deleteDaemonsByFile.run(filePath);
    for (const d of daemons) {
      this._stmts.insertDaemon.run({
        file_path: filePath,
        kind:      d.kind,
        event:     d.event ?? null,
        line:      d.line,
      });
    }
  }

  getDaemons(filePath) {
    return this._stmts.getDaemonsByFile.all(filePath);
  }

  getDaemonsByKind(kind) {
    return this._stmts.getDaemonsByKind.all(kind).map(r => ({
      file: r.file_path, event: r.event, line: r.line,
    }));
  }

  getAllDaemons() {
    return this._stmts.getAllDaemons.all().map(r => ({
      file: r.file_path, kind: r.kind, event: r.event, line: r.line,
    }));
  }

  // ── Adapter methods ──────────────────────────────────────────────────────────

  /**
   * Replace all adapter entries for a file.
   * @param {string} filePath
   * @param {Array<{kind: string, library: string, external: boolean, line: number}>} adapters
   */
  saveAdapters(filePath, adapters) {
    this._stmts.deleteAdaptersByFile.run(filePath);
    for (const a of adapters) {
      this._stmts.insertAdapter.run({
        file_path: filePath,
        kind:      a.kind,
        library:   a.library,
        external:  a.external ? 1 : 0,
        line:      a.line,
      });
    }
  }

  getAdapters(filePath) {
    return this._stmts.getAdaptersByFile.all(filePath).map(r => ({
      kind: r.kind, library: r.library, external: !!r.external, line: r.line,
    }));
  }

  getAdaptersByKind(kind) {
    return this._stmts.getAdaptersByKind.all(kind).map(r => ({
      file: r.file_path, library: r.library, line: r.line,
    }));
  }

  getAllAdapters() {
    return this._stmts.getAllAdapters.all().map(r => ({
      file: r.file_path, kind: r.kind, library: r.library,
      external: !!r.external, line: r.line,
    }));
  }

  /**
   * Export to the same shape as the current dep-graph.json.
   * Zero changes needed in any caller of loadGraph().
   *
   * @param {string} rootDir
   * @returns {Object} { version, generatedAt, rootDir, nodes, stats }
   */
  toGraphObject(rootDir) {
    const allNodes = this.getAllNodes();
    const allEdges = this.getAllEdges();
    const stats    = this.getStats();

    // Build importedBy from edges (reverse of imports)
    const importedBy = {};
    for (const edge of allEdges) {
      if (edge.kind === 'imports') {
        importedBy[edge.target] = importedBy[edge.target] || [];
        importedBy[edge.target].push(edge.source);
      }
    }

    // Build imports map from edges (forward)
    const importsMap = {};
    for (const edge of allEdges) {
      if (edge.kind === 'imports') {
        importsMap[edge.source] = importsMap[edge.source] || [];
        importsMap[edge.source].push(edge.target);
      }
    }

    // Assemble nodes object — identical shape to what buildGraph() returned
    const nodes = {};
    for (const node of allNodes) {
      const assembled = {
        ...node,
        imports:    importsMap[node.file]    || [],
        importedBy: importedBy[node.file]    || [],
      };
      // Recompute risk score using the actual current importedBy from edges.
      // The stored risk_score column can be stale after incremental writes where
      // new files imported this node but only their own row was updated.
      assembled.riskScore = computeRiskScore(assembled);
      nodes[node.file] = assembled;
    }

    return {
      version:     2,
      generatedAt: this.getMeta('last_analyzed') || new Date().toISOString(),
      rootDir:     rootDir || this.getMeta('root_dir') || '',
      nodes,
      stats,
    };
  }

  close() {
    this._db.close();
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  /**
   * Convert a SQLite row to a graph node object.
   * Note: imports and importedBy are NOT included here — they come from edges.
   * toGraphObject() assembles the full node with those fields.
   */
  _rowToNode(row) {
    return {
      file:         row.file_path,
      lang:         row.lang,
      riskScore:    row.risk_score,
      isEntryPoint: row.is_entry === 1,
      isBarrel:     row.is_barrel === 1,
      isTest:       row.is_test === 1,
      role:         row.role || '',
      band:         row.band || '',
      summary:      row.summary || '',
      exports:      this._parseJson(row.exports, []),
      gaps:         this._parseJson(row.gaps, []),
      meta:         this._parseJson(row.meta, {}),
      error:        row.error === 1,
      communityId:  row.community_id,
      // imports and importedBy populated by toGraphObject()
      imports:      [],
      importedBy:   [],
    };
  }

  // ── Enrichment: Blast Radius ────────────────────────────────────────────────

  /**
   * Save blast radius data for a file.
   * @param {string} filePath
   * @param {Object} data — { directDependents, transitiveDependents, etc. }
   */
  saveBlastRadius(filePath, data) {
    this._stmts.upsertBlastRadius.run({
      file_path: filePath,
      direct_dependents: JSON.stringify(data.directDependents || []),
      transitive_dependents: JSON.stringify(data.transitiveDependents || []),
      transitive_count: data.transitiveDependents?.length || 0,
      cross_language_hits: JSON.stringify(data.crossLanguageHits || []),
      max_import_depth: data.maxImportDepth || 0,
    });
    // Also update the counts in nodes table
    const tx = this._db.transaction(() => {
      this._db.prepare(
        'UPDATE nodes SET imported_by_count = ?, gap_count = ? WHERE file_path = ?'
      ).run(data.directDependents?.length || 0, data.gaps?.length || 0, filePath);
    });
    tx();
  }

  getBlastRadius(filePath) {
    const row = this._stmts.getBlastRadius.get(filePath);
    if (!row) return null;
    return {
      filePath: row.file_path,
      directDependents: this._parseJson(row.direct_dependents, []),
      transitiveDependents: this._parseJson(row.transitive_dependents, []),
      transitiveCount: row.transitive_count,
      crossLanguageHits: this._parseJson(row.cross_language_hits, []),
      maxImportDepth: row.max_import_depth,
    };
  }

  // ── Enrichment: Dead Code ───────────────────────────────────────────────────

  saveDeadCode(entries) {
    const tx = this._db.transaction((list) => {
      for (const entry of list) {
        this._stmts.insertDeadCode.run({
          file_path: entry.filePath,
          type: entry.type, // 'file' or 'export'
          export_name: entry.exportName || null,
          is_safe_to_delete: entry.isSafeToDelete ? 1 : 0,
          reason: entry.reason || null,
        });
        // Also mark file as dead if type='file'
        if (entry.type === 'file') {
          this._db.prepare(
            'UPDATE nodes SET is_dead_file = 1 WHERE file_path = ?'
          ).run(entry.filePath);
        }
      }
    });
    tx(entries);
  }

  getDeadCode() {
    return this._stmts.getDeadCode.all().map(r => ({
      filePath: r.file_path,
      type: r.type,
      exportName: r.export_name,
      reason: r.reason,
    }));
  }

  // ── Enrichment: Entry Points ────────────────────────────────────────────────

  saveEntryPoints(entries) {
    const tx = this._db.transaction((list) => {
      for (const entry of list) {
        this._stmts.upsertEntryPoint.run({
          file_path: entry.filePath,
          detection_method: entry.detectionMethod,
          confidence: entry.confidence,
          signal_score: entry.signalScore || 0,
          reason: entry.reason || null,
        });
        // Update node's entry point info
        this._db.prepare(
          'UPDATE nodes SET entry_point_type = ?, entry_point_confidence = ? WHERE file_path = ?'
        ).run(entry.detectionMethod, entry.confidence, entry.filePath);
      }
    });
    tx(entries);
  }

  getEntryPoints() {
    return this._stmts.getEntryPoints.all().map(r => ({
      filePath: r.file_path,
      detectionMethod: r.detection_method,
      confidence: r.confidence,
      reason: r.reason,
    }));
  }

  getHighConfidenceEntryPoints(minConfidence = 70) {
    return this._stmts.getHighConfidenceEntryPoints.all(minConfidence).map(r => r.file_path);
  }

  // ── Enrichment: Module Roles ────────────────────────────────────────────────

  saveModuleRoles(entries) {
    const tx = this._db.transaction((list) => {
      for (const entry of list) {
        this._stmts.upsertModuleRole.run({
          file_path: entry.filePath,
          primary_role: entry.primaryRole,
          confidence: entry.confidence,
          reason: entry.reason || null,
        });
      }
    });
    tx(entries);
  }

  getModulesByRole(role) {
    return this._stmts.getModulesByRole.all(role).map(r => ({
      filePath: r.file_path,
      primaryRole: r.primary_role,
      confidence: r.confidence,
    }));
  }

  // ── Enrichment: Circular Dependencies ────────────────────────────────────────

  saveCircularDependencies(cycles) {
    const tx = this._db.transaction((list) => {
      for (const cycle of list) {
        const result = this._stmts.insertCircularDependency.run({
          files: JSON.stringify(cycle.files || []),
          files_count: cycle.files?.length || 0,
          detected_at_line: cycle.detectedAtLine || null,
          severity: cycle.severity || 'logic',
        });
        const cycleId = result.lastInsertRowid;
        // Mark all files in the cycle
        const tx2 = this._db.transaction(() => {
          for (const file of cycle.files || []) {
            this._db.prepare(
              'UPDATE nodes SET is_circular_dep = 1, circular_cycle_id = ? WHERE file_path = ?'
            ).run(cycleId, file);
          }
        });
        tx2();
      }
    });
    tx(cycles);
  }

  getCircularDependencies() {
    return this._stmts.getCircularDependencies.all().map(r => ({
      cycleId: r.cycle_id,
      files: this._parseJson(r.files, []),
      filesCount: r.files_count,
      severity: r.severity,
    }));
  }

  // ── Enrichment: Coverage Gaps ───────────────────────────────────────────────

  saveCoverageGaps(gaps) {
    const tx = this._db.transaction((list) => {
      for (const gap of list) {
        this._stmts.insertCoverageGap.run({
          file_path: gap.filePath,
          gap_type: gap.gapType,
          pattern: gap.pattern || null,
          line_number: gap.lineNumber || null,
          severity: gap.severity || 'medium',
        });
      }
    });
    tx(gaps);
  }

  getCoverageGapsByFile(filePath) {
    return this._stmts.getCoverageGapsByFile.all(filePath).map(r => ({
      gapType: r.gap_type,
      pattern: r.pattern,
      lineNumber: r.line_number,
      severity: r.severity,
    }));
  }

  getAllCoverageGaps() {
    return this._stmts.getAllCoverageGaps.all().map(r => ({
      filePath: r.file_path,
      gapType: r.gap_type,
      count: r.count,
    }));
  }

  // ── Enrichment: File Summary (denormalized for speed) ────────────────────────

  /**
   * Get comprehensive file info for commands (all enrichment in one query).
   * @param {string} filePath
   * @returns {Object} — complete file summary with all enrichment
   */
  getFileSummary(filePath) {
    const node = this._db.prepare(`
      SELECT file_path, lang, summary, purpose, role, risk_score, band,
             imported_by_count, import_count, bug_fix_commits, total_commits,
             age_in_days, has_tests, is_dead_file, is_circular_dep,
             entry_point_type, entry_point_confidence, danger_reason
      FROM nodes WHERE file_path = ?
    `).get(filePath);

    if (!node) return null;

    const blastRadius = this.getBlastRadius(filePath);
    const gaps = this.getCoverageGapsByFile(filePath);

    return {
      filePath: node.file_path,
      lang: node.lang,
      summary: node.summary,
      purpose: node.purpose,
      role: node.role,
      riskScore: node.risk_score,
      band: node.band,
      importedByCount: node.imported_by_count,
      importCount: node.import_count,
      bugFixCommits: node.bug_fix_commits,
      totalCommits: node.total_commits,
      ageInDays: node.age_in_days,
      hasTests: node.has_tests === 1,
      isDeadFile: node.is_dead_file === 1,
      isCircularDep: node.is_circular_dep === 1,
      entryPointType: node.entry_point_type,
      entryPointConfidence: node.entry_point_confidence,
      dangerReason: node.danger_reason,
      blastRadius,
      coverageGaps: gaps,
    };
  }

  /**
   * Get reading order: top N files by importance score.
   * importance = (imported_by_count × 0.4) + (bug_fix_commits × 0.3) + (total_commits × 0.3)
   * @param {number} limit — default 25
   * @returns {Array} — files with importance scores
   */
  getReadingOrder(limit = 25) {
    return this._db.prepare(`
      SELECT file_path, summary, imported_by_count, bug_fix_commits,
             total_commits, entry_point_type, entry_point_confidence
      FROM nodes
      WHERE is_test = 0
      ORDER BY
        (imported_by_count * 0.4 + bug_fix_commits * 0.3 + total_commits * 0.3) DESC
      LIMIT ?
    `).all(limit).map(r => ({
      filePath: r.file_path,
      summary: r.summary,
      importedByCount: r.imported_by_count,
      bugFixCommits: r.bug_fix_commits,
      totalCommits: r.total_commits,
      isEntryPoint: r.entry_point_type !== null,
      entryPointConfidence: r.entry_point_confidence,
    }));
  }

  _parseJson(str, fallback) {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch { return fallback; }
  }

  /**
   * Bulk-update community IDs after clustering.
   * @param {Object} communityMap — { filePath: communityId }
   */
  updateCommunities(communityMap) {
    const tx = this._db.transaction((entries) => {
      const stmt = this._db.prepare('UPDATE nodes SET community_id = ? WHERE file_path = ?');
      for (const [file, cid] of entries) {
        stmt.run(cid, file);
      }
    });
    tx(Object.entries(communityMap));
  }

  /**
   * Get all nodes grouped by community ID.
   * @returns {Object} — { communityId: [filePaths] }
   */
  getCommunities() {
    const rows = this._db.prepare('SELECT file_path, community_id FROM nodes WHERE community_id IS NOT NULL').all();
    const map = {};
    for (const r of rows) {
      map[r.community_id] = map[r.community_id] || [];
      map[r.community_id].push(r.file_path);
    }
    return map;
  }
}

module.exports = { GraphStore };
