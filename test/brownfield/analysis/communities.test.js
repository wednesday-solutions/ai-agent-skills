'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { GraphStore } = require('../../../src/brownfield/engine/store');
const { computeCommunities } = require('../../../src/brownfield/analysis/communities');

describe('Community Detection (Louvain)', () => {
  const TMP_DB = path.join(__dirname, 'test-communities.db');

  function setupStore() {
    if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
    return GraphStore.open(TMP_DB);
  }

  function cleanupStore(store) {
    if (store) store.close();
    if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
  }

  test('empty graph returns empty communities', () => {
    const store = setupStore();
    try {
      const results = computeCommunities(store);
      assert.equal(Object.keys(results).length, 0);
    } finally {
      cleanupStore(store);
    }
  });

  test('identifies a simple connected cluster', () => {
    const store = setupStore();
    try {
      // Create a triangle cluster
      const nodes = {
        'a.js': { file: 'a.js', imports: ['b.js'], importedBy: [] },
        'b.js': { file: 'b.js', imports: ['c.js'], importedBy: ['a.js'] },
        'c.js': { file: 'c.js', imports: ['a.js'], importedBy: ['b.js'] }
      };
      store.writeAll(nodes, {});

      const results = computeCommunities(store);
      assert.equal(Object.keys(results).length, 3);
      // All nodes in a triangle should be in the same community
      assert.equal(results['a.js'], results['b.js']);
      assert.equal(results['b.js'], results['c.js']);
    } finally {
      cleanupStore(store);
    }
  });

  test('isolates disconnected islands', () => {
    const store = setupStore();
    try {
      // Two separate pairs
      const nodes = {
        'a.js': { file: 'a.js', imports: ['b.js'], importedBy: [] },
        'b.js': { file: 'b.js', imports: [], importedBy: ['a.js'] },
        'x.js': { file: 'x.js', imports: ['y.js'], importedBy: [] },
        'y.js': { file: 'y.js', imports: [], importedBy: ['x.js'] }
      };
      store.writeAll(nodes, {});

      const results = computeCommunities(store);
      
      // a and b should share cid
      assert.equal(results['a.js'], results['b.js']);
      // x and y should share cid
      assert.equal(results['x.js'], results['y.js']);
      // the two groups should have different cids
      assert.notEqual(results['a.js'], results['x.js']);
    } finally {
      cleanupStore(store);
    }
  });

  test('respects weighted interactions (calls > imports)', () => {
    const store = setupStore();
    try {
      // Scenario: 'bridge.js' is between Group A and Group B.
      // It imports Group A but CALLS Group B.
      // Weighted Louvain should pull it into Group B.
      const nodes = {
        'a1.js': { file: 'a1.js', imports: ['a2.js'], importedBy: [] },
        'a2.js': { file: 'a2.js', imports: [], importedBy: ['a1.js'] },
        
        'b1.js': { file: 'b1.js', imports: ['b2.js'], importedBy: [] },
        'b2.js': { file: 'b2.js', imports: [], importedBy: ['b1.js'] },
        
        'bridge.js': { file: 'bridge.js', imports: ['a1.js', 'b1.js'], importedBy: [] }
      };
      store.writeAll(nodes, {});
      
      // Add a 'call' edge between bridge and b1 (kind 'call' or 'calls')
      store._db.prepare(`
        INSERT INTO edges (source, target, kind, file_path)
        VALUES (?, ?, 'call', 'bridge.js')
      `).run('bridge.js', 'b1.js');

      const results = computeCommunities(store);
      
      // bridge should be in the same community as b1, not necessarily a1
      // (This depends on the Louvain resolution, but with strong weighting it's highly likely)
      assert.equal(results['bridge.js'], results['b1.js']);
    } finally {
      cleanupStore(store);
    }
  });
});
