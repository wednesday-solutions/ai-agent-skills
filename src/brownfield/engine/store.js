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
      this._data = { nodes: {}, edges: [], symbols: [], metadata: {} }; 
    }
    pragma() {}
    exec(schema) {}
    prepare(sql) {
      const db = this;
      return {
        run: (args) => {
          // crude simulation of inserts/upserts for common patterns
          if (sql.includes('INSERT INTO nodes')) {
            db._data.nodes[args.file_path] = args;
          } else if (sql.includes('INSERT INTO edges')) {
            db._data.edges.push(args);
          } else if (sql.includes('INSERT INTO metadata')) {
            db._data.metadata[args.key || args[0]] = args.value || args[1];
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
          }
          if (sql.includes('FROM nodes')) return Object.values(db._data.nodes);
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
  exports      TEXT    NOT NULL DEFAULT '[]',
  gaps         TEXT    NOT NULL DEFAULT '[]',
  meta         TEXT    NOT NULL DEFAULT '{}',
  file_hash    TEXT,
  error        INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
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

CREATE INDEX IF NOT EXISTS idx_edges_source   ON edges(source);
CREATE INDEX IF NOT EXISTS idx_edges_target   ON edges(target);
CREATE INDEX IF NOT EXISTS idx_edges_file     ON edges(file_path);
CREATE INDEX IF NOT EXISTS idx_nodes_lang     ON nodes(lang);
CREATE INDEX IF NOT EXISTS idx_nodes_risk     ON nodes(risk_score);
CREATE INDEX IF NOT EXISTS idx_nodes_entry    ON nodes(is_entry);
CREATE INDEX IF NOT EXISTS idx_symbols_file   ON symbols(file_path);
CREATE INDEX IF NOT EXISTS idx_symbols_name   ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_daemons_file   ON daemons(file_path);
CREATE INDEX IF NOT EXISTS idx_daemons_kind   ON daemons(kind);
CREATE INDEX IF NOT EXISTS idx_adapters_file  ON adapters(file_path);
CREATE INDEX IF NOT EXISTS idx_adapters_kind  ON adapters(kind);
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
    this._prepare();
  }

  // ── Prepared statements (hot paths) ─────────────────────────────────────────

  _prepare() {
    this._stmts = {
      upsertNode: this._db.prepare(`
        INSERT INTO nodes
          (file_path, lang, risk_score, is_entry, is_barrel, exports, gaps, meta, file_hash, error, updated_at)
        VALUES
          (@file_path, @lang, @risk_score, @is_entry, @is_barrel, @exports, @gaps, @meta, @file_hash, @error, @updated_at)
        ON CONFLICT(file_path) DO UPDATE SET
          lang=excluded.lang, risk_score=excluded.risk_score,
          is_entry=excluded.is_entry, is_barrel=excluded.is_barrel,
          exports=excluded.exports, gaps=excluded.gaps,
          meta=excluded.meta, file_hash=excluded.file_hash,
          error=excluded.error, updated_at=excluded.updated_at
      `),

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
    this._stmts.upsertNode.run({
      file_path:  node.file,
      lang:       node.lang || '',
      risk_score: node.riskScore || 0,
      is_entry:   node.isEntryPoint ? 1 : 0,
      is_barrel:  node.isBarrel ? 1 : 0,
      exports:    JSON.stringify(node.exports || []),
      gaps:       JSON.stringify(node.gaps || []),
      meta:       JSON.stringify(node.meta || {}),
      file_hash:  fileHash || null,
      error:      node.error ? 1 : 0,
      updated_at: Date.now(),
    });
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
          WHERE (nodes.is_entry = 1 OR (nodes.file_path LIKE '%ViewController%' AND nodes.imported_by_count < 2))
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
      exports:      this._parseJson(row.exports, []),
      gaps:         this._parseJson(row.gaps, []),
      meta:         this._parseJson(row.meta, {}),
      error:        row.error === 1,
      // imports and importedBy populated by toGraphObject()
      imports:      [],
      importedBy:   [],
    };
  }

  _parseJson(str, fallback) {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch { return fallback; }
  }
}

module.exports = { GraphStore };
