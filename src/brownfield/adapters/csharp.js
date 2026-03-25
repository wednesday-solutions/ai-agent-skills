/**
 * C# language adapter
 * Handles: using directives, public class/interface/record/enum exports,
 * reflection/Activator gaps, .NET framework detection.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { safeRead } = require('../core/parser');

function parse(filePath, rootDir) {
  const src = safeRead(filePath);
  if (src === null) {
    return { file: filePath, lang: 'csharp', imports: [], exports: [], gaps: [], meta: {}, error: true };
  }

  const imports = new Set();
  const exports = new Set();
  const gaps = [];
  const meta = {};

  // Strip block and line comments
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');

  // ── Using directives ──────────────────────────────────────────────────────

  // using System.Foo; / using static System.Foo; / using Alias = Foo.Bar;
  const usingRe = /^using\s+(?:static\s+)?(?:\w+\s*=\s*)?([\w.]+)\s*;/gm;
  let m;
  while ((m = usingRe.exec(stripped)) !== null) {
    const ns = m[1];
    const resolved = resolveCSharpNamespace(ns, rootDir);
    imports.add(resolved);
  }

  // ── Exports (public type declarations) ───────────────────────────────────

  // public [modifiers] class/interface/struct/enum/record/delegate Foo
  const typeRe = /\bpublic\s+(?:(?:abstract|sealed|static|partial|readonly|unsafe)\s+)*(?:class|interface|struct|enum|record|delegate)\s+([A-Za-z_]\w*)/g;
  while ((m = typeRe.exec(stripped)) !== null) {
    exports.add(m[1]);
  }

  // Public methods — captures contract surface
  const methodRe = /\bpublic\s+(?:(?:static|virtual|abstract|override|async|sealed|new|extern)\s+)*[\w<>\[\],?\s]+\s+([A-Za-z_]\w*)\s*</g;
  while ((m = methodRe.exec(stripped)) !== null) {
    const name = m[1];
    if (!['class', 'interface', 'struct', 'enum', 'record', 'delegate', 'event'].includes(name)) {
      exports.add(name);
    }
  }

  // ── Reflection / dynamic dispatch gaps ───────────────────────────────────

  const reflectionRe = /Assembly\.Load\s*\(|Activator\.CreateInstance\s*\(|Type\.GetType\s*\(|GetMethod\s*\(|GetProperty\s*\(|InvokeMember\s*\(/g;
  while ((m = reflectionRe.exec(stripped)) !== null) {
    gaps.push({ type: 'reflection', line: lineAt(src, m.index), pattern: m[0].trim() });
  }

  // DI container resolvals (common in .NET)
  const diRe = /\.GetService\s*<|\.GetRequiredService\s*<|serviceProvider\.GetService\s*\(/g;
  while ((m = diRe.exec(stripped)) !== null) {
    gaps.push({ type: 'dependency-injection', line: lineAt(src, m.index), pattern: m[0].trim() });
  }

  // ── Meta: framework detection ─────────────────────────────────────────────

  if (/\[ApiController\]|\[Route\(|WebApplication\.Create|IWebHostBuilder|WebHostBuilder/.test(stripped)) {
    meta.framework = 'aspnet-core';
  } else if (/Controller\s*:|ControllerBase\s*:|\[HttpGet\]|\[HttpPost\]/.test(stripped)) {
    meta.framework = 'aspnet-core';
    meta.role = 'controller';
  } else if (/DbContext|EntityTypeBuilder|IEntityTypeConfiguration/.test(stripped)) {
    meta.framework = 'entity-framework';
  } else if (/IRepository|Repository\s*<|GenericRepository/.test(stripped)) {
    meta.role = 'repository';
  } else if (/BackgroundService|IHostedService/.test(stripped)) {
    meta.role = 'background-service';
  } else if (/\[TestFixture\]|\[Test\]|\[Fact\]|\[Theory\]/.test(stripped)) {
    meta.isTest = true;
  }

  // Entry points
  if (/static\s+(?:async\s+)?(?:Task\s+)?Main\s*\(/.test(stripped)) {
    meta.isEntryPoint = true;
  }

  // Program.cs / Startup.cs are typically entry points in ASP.NET
  const basename = path.basename(filePath);
  if (basename === 'Program.cs' || basename === 'Startup.cs') {
    meta.isEntryPoint = true;
  }

  // ── Annotations ───────────────────────────────────────────────────────────

  const annotationRe = /\/\/\s*@wednesday-skills:(\S+)\s+(.*)/g;
  const annotations = [];
  while ((m = annotationRe.exec(src)) !== null) {
    annotations.push({ type: m[1], value: m[2].trim() });
    if (m[1] === 'connects-to') {
      const parts = m[2].split('→').map(s => s.trim());
      if (parts.length === 2) imports.add(parts[1]);
    }
  }
  if (annotations.length) meta.annotations = annotations;

  return {
    file: filePath,
    lang: 'csharp',
    imports: [...imports],
    exports: [...exports],
    gaps,
    meta,
    error: false,
  };
}

/**
 * Attempt to resolve a C# namespace to a source file.
 * e.g. MyApp.Services.UserService → src/Services/UserService.cs
 */
function resolveCSharpNamespace(ns, rootDir) {
  const parts = ns.split('.');
  if (parts.length < 2) return ns; // single-part = System-level, definitely external

  // Try: last part is the type, rest is path
  const typeName = parts[parts.length - 1];
  const nsPath = parts.join(path.sep);

  const candidates = [
    nsPath + '.cs',
    typeName + '.cs',
    'src/' + nsPath + '.cs',
    'src/' + typeName + '.cs',
    'lib/' + nsPath + '.cs',
  ];

  for (const rel of candidates) {
    if (fs.existsSync(path.join(rootDir, rel))) return rel;
  }

  return ns; // external namespace
}

function lineAt(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

module.exports = { parse };
