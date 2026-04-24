const { analyze, query } = require('./src/brownfield/index');
const path = require('path');
const fs = require('fs');

async function runTest(name, setupFn, testFn) {
  console.log(`\n--- [TEST] ${name} ---`);
  const rootDir = path.resolve(`./test-fixtures/edge-cases/${name}`);
  if (fs.existsSync(rootDir)) fs.rmSync(rootDir, { recursive: true });
  fs.mkdirSync(rootDir, { recursive: true });

  setupFn(rootDir);

  console.log('Running analysis...');
  await analyze(rootDir, { full: true, silent: true });

  try {
    await testFn(rootDir);
    console.log(`[PASS] ${name}`);
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
    process.exit(1);
  }
}

async function main() {
  // 1. JS Aliased Imports
  await runTest('js-aliases', 
    (dir) => {
      fs.writeFileSync(path.join(dir, 'utils.js'), 'export function helper() { return 1; }');
      fs.writeFileSync(path.join(dir, 'main.js'), `
        import { helper as h } from './utils';
        function start() {
          h();
        }
      `);
    },
    async (dir) => {
      const calls = query(dir, 'getSymbolCalls', 'main.js', 'start');
      // Current system limitation check: Does it find 'helper' even if aliased?
      if (!calls.some(c => c.symbol === 'helper')) {
        throw new Error('Could not find call to helper (aliasing gap detected)');
      }
    }
  );

  // 2. Python Relative Imports
  await runTest('python-relative',
    (dir) => {
      fs.mkdirSync(path.join(dir, 'pkg'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'pkg', 'utils.py'), 'def get_data(): return 1');
      fs.writeFileSync(path.join(dir, 'pkg', 'main.py'), `
from .utils import get_data
def process():
    get_data()
      `);
    },
    async (dir) => {
      const calls = query(dir, 'getSymbolCalls', 'pkg/main.py', 'process');
      if (!calls.some(c => c.symbol === 'get_data' && c.file === 'pkg/utils.py')) {
        throw new Error('Python relative import call not detected');
      }
    }
  );

  // 3. Go Receiver Methods
  await runTest('go-methods',
    (dir) => {
      fs.writeFileSync(path.join(dir, 'go.mod'), 'module example.com/test');
      fs.writeFileSync(path.join(dir, 'db.go'), `
package main
type Store struct{}
func (s *Store) Save() {}
      `);
      fs.writeFileSync(path.join(dir, 'main.go'), `
package main
import "example.com/test/db"
func Run(s *Store) {
    s.Save()
}
      `);
    },
    async (dir) => {
      const calls = query(dir, 'getSymbolCalls', 'main.go', 'Run');
      if (!calls.some(c => c.symbol === 'Save')) {
        throw new Error('Go method call not detected');
      }
    }
  );

  // 4. Resilience: Syntax Error
  await runTest('resilience-syntax',
    (dir) => {
      fs.writeFileSync(path.join(dir, 'broken.js'), 'function broken() { const = ; }');
      fs.writeFileSync(path.join(dir, 'ok.js'), 'export function ok() {}');
    },
    async (dir) => {
      const queries = require('./src/brownfield/db/queries');
      const dbPath = path.join(dir, '.wednesday', 'graph.db');
      const nodes = queries.openDb(dbPath).getAllNodes();
      if (!nodes.some(n => n.file_path === 'ok.js')) {
        throw new Error('System halted on syntax error in broken.js');
      }
    }
  );

  console.log('\n--- ALL TESTS COMPLETED ---');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
