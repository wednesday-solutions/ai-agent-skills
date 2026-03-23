/**
 * 2A-3 — NestJS DI parser
 * Extracts @Inject, @Module, @Injectable relationships as soft edges (strength: "di")
 */

'use strict';

const { safeRead } = require('../core/parser');

function parse(filePath) {
  const src = safeRead(filePath);
  if (!src) return { edges: [], meta: {} };

  const edges = [];
  const meta = {};

  // ── @Injectable — marks this as a provider ────────────────────────────────
  if (/@Injectable\(\)/.test(src)) {
    meta.isProvider = true;
  }

  // ── @Controller — marks this as a controller ─────────────────────────────
  const ctrlMatch = src.match(/@Controller\(['"]([^'"]*)['"]\)/);
  if (ctrlMatch) {
    meta.isController = true;
    meta.controllerPath = ctrlMatch[1];
  }

  // ── @Module — extract imports, providers, controllers ────────────────────
  const moduleMatch = src.match(/@Module\(\s*\{([\s\S]*?)\}\s*\)/);
  if (moduleMatch) {
    meta.isModule = true;
    const body = moduleMatch[1];

    // imports: [ModuleA, ModuleB]
    const importsMatch = body.match(/imports\s*:\s*\[([\s\S]*?)\]/);
    if (importsMatch) {
      const names = importsMatch[1].match(/\b[A-Z]\w+/g) || [];
      names.forEach(n => edges.push({ to: n, type: 'module-import', strength: 'di' }));
    }

    // providers: [ServiceA, ServiceB]
    const providersMatch = body.match(/providers\s*:\s*\[([\s\S]*?)\]/);
    if (providersMatch) {
      const names = providersMatch[1].match(/\b[A-Z]\w+/g) || [];
      names.forEach(n => edges.push({ to: n, type: 'di-provider', strength: 'di' }));
    }
  }

  // ── Constructor @Inject — direct injection ────────────────────────────────
  const injectRe = /@Inject(?:able)?\(\s*(?:['"]([^'"]+)['"]|(\w+))\s*\)/g;
  let m;
  while ((m = injectRe.exec(src)) !== null) {
    const token = m[1] || m[2];
    if (token) edges.push({ to: token, type: 'inject', strength: 'di' });
  }

  return { edges, meta };
}

module.exports = { parse };
