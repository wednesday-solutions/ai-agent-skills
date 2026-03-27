'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { buildSymbolIndex }  = require('../src/brownfield/engine/symbol-index');
const { extractCallEdges }  = require('../src/brownfield/engine/calls-extractor');
const { computeRiskScore }  = require('../src/brownfield/engine/graph');
const { score }             = require('../src/brownfield/analysis/safety-scorer');

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeNode(overrides = {}) {
  return {
    file:        'src/placeholder.js',
    lang:        'javascript',
    imports:     [],
    importedBy:  [],
    exports:     [],
    symbols:     [],
    gaps:        [],
    riskScore:   0,
    isEntryPoint: false,
    isBarrel:    false,
    meta:        {},
    error:       false,
    ...overrides,
  };
}

// ─── 1. testCoverage default ──────────────────────────────────────────────────

describe('testCoverage default', () => {
  test('computeRiskScore uses 0% when testCoverage is omitted', () => {
    const node = makeNode({ importedBy: [], exports: [] });
    const s = computeRiskScore(node);
    // With 0 dependents + 0 public contract + (100-0)*0.15 = 15
    assert.equal(s, 15);
  });

  test('safety-scorer.score uses 0% for unknown files', () => {
    const nodes = { 'src/a.js': makeNode({ file: 'src/a.js', importedBy: [] }) };
    const result = score('src/a.js', nodes, {}); // no testCoverageMap entry
    assert.equal(result.details.testCoverage, 0);
  });

  test('unknown coverage gives higher score than 50% coverage', () => {
    const nodes = {
      'src/a.js': makeNode({ file: 'src/a.js', importedBy: ['src/b.js', 'src/c.js'] }),
    };
    const withUnknown = score('src/a.js', nodes, {});
    const withHalf    = score('src/a.js', nodes, { 'src/a.js': 50 });
    assert.ok(withUnknown.score > withHalf.score, `unknown (${withUnknown.score}) should exceed half-covered (${withHalf.score})`);
  });
});

// ─── 2. riskScore formula ─────────────────────────────────────────────────────

describe('computeRiskScore', () => {
  test('zero dependents + no exports = only testCoverage term', () => {
    const node = makeNode({ importedBy: [], exports: [] });
    assert.equal(computeRiskScore(node, 0),   15); // (100-0)*0.15
    assert.equal(computeRiskScore(node, 100),  0); // (100-100)*0.15
    assert.equal(computeRiskScore(node, 50),   8); // (100-50)*0.15 = 7.5 → Math.round = 8
  });

  test('public contract adds 25 points', () => {
    const node = makeNode({
      importedBy: ['src/b.js'],
      exports:    ['foo'],
    });
    const s = computeRiskScore(node, 100); // coverage=100% to isolate term
    // (1*1.2) + 25 + 0 = 26
    assert.equal(s, 26);
  });

  test('capped at 100', () => {
    const manyImporters = Array.from({ length: 60 }, (_, i) => `src/${i}.js`);
    const node = makeNode({ importedBy: manyImporters, exports: ['x'] });
    assert.ok(computeRiskScore(node, 0) <= 100);
  });
});

// ─── 3. symbol index — no last-wins collision ─────────────────────────────────

describe('buildSymbolIndex', () => {
  test('two files exporting the same name are both indexed', () => {
    const nodes = {
      'src/a.js': makeNode({ file: 'src/a.js', exports: ['foo'], symbols: [{ name: 'foo', kind: 'function', lineStart: 1 }] }),
      'src/b.js': makeNode({ file: 'src/b.js', exports: ['foo'], symbols: [{ name: 'foo', kind: 'function', lineStart: 5 }] }),
    };
    const idx = buildSymbolIndex(nodes);
    assert.equal(idx.size, 2, 'should have two qualified entries');
    assert.ok(idx.has('src/a.js::foo'));
    assert.ok(idx.has('src/b.js::foo'));
  });

  test('byName holds all definitions for a shared name', () => {
    const nodes = {
      'src/a.js': makeNode({ file: 'src/a.js', exports: ['foo'], symbols: [{ name: 'foo', kind: 'function', lineStart: 1 }] }),
      'src/b.js': makeNode({ file: 'src/b.js', exports: ['foo'], symbols: [{ name: 'foo', kind: 'function', lineStart: 5 }] }),
    };
    const idx = buildSymbolIndex(nodes);
    assert.equal(idx.byName.get('foo').length, 2);
    const files = idx.byName.get('foo').map(e => e.file);
    assert.ok(files.includes('src/a.js'));
    assert.ok(files.includes('src/b.js'));
  });

  test('unexported symbols are not indexed', () => {
    const nodes = {
      'src/a.js': makeNode({
        file: 'src/a.js',
        exports: ['pub'],
        symbols: [
          { name: 'pub',     kind: 'function', lineStart: 1 },
          { name: 'private', kind: 'function', lineStart: 9 },
        ],
      }),
    };
    const idx = buildSymbolIndex(nodes);
    assert.ok(idx.has('src/a.js::pub'));
    assert.ok(!idx.has('src/a.js::private'));
  });

  test('byName is non-enumerable (does not pollute spread/Object.keys)', () => {
    const nodes = {
      'src/a.js': makeNode({ file: 'src/a.js', exports: ['foo'], symbols: [{ name: 'foo', kind: 'function', lineStart: 1 }] }),
    };
    const idx = buildSymbolIndex(nodes);
    assert.ok(!Object.keys(idx).includes('byName'));
  });
});

// ─── 4. call extractor — uses byName, catches all definitions ─────────────────

describe('extractCallEdges', () => {
  test('finds calls to a symbol imported from one file', () => {
    const nodes = {
      'src/a.js': makeNode({ file: 'src/a.js', exports: ['doThing'], symbols: [{ name: 'doThing', kind: 'function', lineStart: 1 }] }),
    };
    const idx  = buildSymbolIndex(nodes);
    const node = makeNode({ file: 'src/consumer.js', imports: ['src/a.js'] });
    const src  = 'const result = doThing(payload);';
    const calls = extractCallEdges('src/consumer.js', src, node, idx);
    assert.deepEqual(calls, ['src/a.js::doThing']);
  });

  test('finds calls to BOTH files when two files export the same name', () => {
    const nodes = {
      'src/a.js': makeNode({ file: 'src/a.js', exports: ['parse'], symbols: [{ name: 'parse', kind: 'function', lineStart: 1 }] }),
      'src/b.js': makeNode({ file: 'src/b.js', exports: ['parse'], symbols: [{ name: 'parse', kind: 'function', lineStart: 3 }] }),
    };
    const idx  = buildSymbolIndex(nodes);
    const node = makeNode({ file: 'src/consumer.js', imports: ['src/a.js', 'src/b.js'] });
    const src  = 'const r = parse(input);';
    const calls = extractCallEdges('src/consumer.js', src, node, idx);
    assert.ok(calls.includes('src/a.js::parse'), 'should include a.js::parse');
    assert.ok(calls.includes('src/b.js::parse'), 'should include b.js::parse');
  });

  test('does not find calls to non-imported files', () => {
    const nodes = {
      'src/a.js': makeNode({ file: 'src/a.js', exports: ['signToken'], symbols: [{ name: 'signToken', kind: 'function', lineStart: 1 }] }),
    };
    const idx  = buildSymbolIndex(nodes);
    // consumer does NOT import src/a.js
    const node = makeNode({ file: 'src/consumer.js', imports: [] });
    const src  = 'const t = signToken(user);';
    const calls = extractCallEdges('src/consumer.js', src, node, idx);
    assert.deepEqual(calls, []);
  });

  test('dot-property access counts as a call edge', () => {
    const nodes = {
      'src/db.js': makeNode({ file: 'src/db.js', exports: ['db'], symbols: [{ name: 'db', kind: 'const', lineStart: 1 }] }),
    };
    const idx  = buildSymbolIndex(nodes);
    const node = makeNode({ file: 'src/consumer.js', imports: ['src/db.js'] });
    const src  = 'await db.query(sql);';
    const calls = extractCallEdges('src/consumer.js', src, node, idx);
    assert.deepEqual(calls, ['src/db.js::db']);
  });
});

// ─── 5. string literal false-positive suppression ────────────────────────────

describe('extractCallEdges — string literal suppression', () => {
  test('symbol inside double-quoted string is not a call', () => {
    const nodes = {
      'src/a.js': makeNode({ file: 'src/a.js', exports: ['foo'], symbols: [{ name: 'foo', kind: 'function', lineStart: 1 }] }),
    };
    const idx  = buildSymbolIndex(nodes);
    const node = makeNode({ file: 'src/consumer.js', imports: ['src/a.js'] });
    const src  = 'console.log("foo(bar) is great");';
    const calls = extractCallEdges('src/consumer.js', src, node, idx);
    assert.deepEqual(calls, [], 'string literal should not be a call edge');
  });

  test('symbol inside single-quoted string is not a call', () => {
    const nodes = {
      'src/a.js': makeNode({ file: 'src/a.js', exports: ['foo'], symbols: [{ name: 'foo', kind: 'function', lineStart: 1 }] }),
    };
    const idx  = buildSymbolIndex(nodes);
    const node = makeNode({ file: 'src/consumer.js', imports: ['src/a.js'] });
    const src  = "const msg = 'call foo(x) to proceed';";
    const calls = extractCallEdges('src/consumer.js', src, node, idx);
    assert.deepEqual(calls, [], 'string literal should not be a call edge');
  });

  test('symbol inside template literal is not a call', () => {
    const nodes = {
      'src/a.js': makeNode({ file: 'src/a.js', exports: ['foo'], symbols: [{ name: 'foo', kind: 'function', lineStart: 1 }] }),
    };
    const idx  = buildSymbolIndex(nodes);
    const node = makeNode({ file: 'src/consumer.js', imports: ['src/a.js'] });
    const src  = 'throw new Error(`foo() returned null`);';
    const calls = extractCallEdges('src/consumer.js', src, node, idx);
    assert.deepEqual(calls, [], 'template literal should not be a call edge');
  });

  test('real call after a string is still detected', () => {
    const nodes = {
      'src/a.js': makeNode({ file: 'src/a.js', exports: ['foo'], symbols: [{ name: 'foo', kind: 'function', lineStart: 1 }] }),
    };
    const idx  = buildSymbolIndex(nodes);
    const node = makeNode({ file: 'src/consumer.js', imports: ['src/a.js'] });
    const src  = 'const msg = "foo is described here"; return foo(x);';
    const calls = extractCallEdges('src/consumer.js', src, node, idx);
    assert.deepEqual(calls, ['src/a.js::foo']);
  });
});
