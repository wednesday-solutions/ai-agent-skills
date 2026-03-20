/**
 * Swift adapter — regex-based, no native compilation
 * Extracts: imports, public types/functions, SwiftUI views, UIKit controllers
 */

'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * Parse a .swift file
 * @param {string} filePath  — absolute path
 * @param {string} rootDir   — project root
 * @returns {Object} node
 */
function parse(filePath, rootDir) {
  let src;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 2 * 1024 * 1024) return null; // skip >2MB
    src = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { lang: 'swift', imports: [], exports: [], gaps: [], meta: {}, error: true };
  }

  const imports  = [];
  const exports  = [];
  const gaps     = [];
  const meta     = {};

  // ── Module imports ──────────────────────────────────────────────────────────
  // import Foundation / import UIKit / import SwiftUI / import MyModule
  for (const m of src.matchAll(/^\s*import\s+([A-Za-z_][A-Za-z0-9_.]*)/gm)) {
    const mod = m[1].trim();
    if (!imports.includes(mod)) imports.push(mod);
  }

  // @_exported import re-exports
  for (const m of src.matchAll(/^\s*@_exported\s+import\s+([A-Za-z_][A-Za-z0-9_.]*)/gm)) {
    const mod = m[1].trim();
    if (!imports.includes(mod)) imports.push(mod);
  }

  // ── Exported symbols ────────────────────────────────────────────────────────
  // public/open class, struct, enum, protocol, actor, extension, typealias, func
  const declPattern = /^\s*(?:(?:public|open)\s+)?(?:(?:public|open)\s+)?(?:final\s+)?(?:class|struct|enum|protocol|actor|typealias|extension)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
  for (const m of src.matchAll(declPattern)) {
    const name = m[1].trim();
    if (!exports.includes(name)) exports.push(name);
  }

  // public/open func (top-level and methods)
  const funcPattern = /^\s*(?:public|open)\s+(?:static\s+|class\s+)?func\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
  for (const m of src.matchAll(funcPattern)) {
    const name = m[1].trim();
    if (!exports.includes(name)) exports.push(name);
  }

  // public/open var/let properties
  const propPattern = /^\s*(?:public|open)\s+(?:static\s+|class\s+)?(?:var|let)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
  for (const m of src.matchAll(propPattern)) {
    const name = m[1].trim();
    if (!exports.includes(name)) exports.push(name);
  }

  // ── Framework detection ─────────────────────────────────────────────────────
  if (imports.includes('SwiftUI')) {
    meta.framework = 'SwiftUI';
    // Detect SwiftUI View structs
    if (/:\s*View\b/.test(src)) meta.isView = true;
  } else if (imports.includes('UIKit')) {
    meta.framework = 'UIKit';
    if (/:\s*UIViewController\b/.test(src)) meta.isViewController = true;
    if (/:\s*UIView\b/.test(src)) meta.isUIView = true;
    if (/:\s*UITableViewController\b/.test(src)) meta.isViewController = true;
  } else if (imports.includes('AppKit')) {
    meta.framework = 'AppKit';
  }

  // ── Combine Framework / Reactive patterns ───────────────────────────────────
  if (imports.includes('Combine')) {
    meta.usesCombine = true;
  }
  if (src.includes('@Published') || src.includes('ObservableObject')) {
    meta.isObservableObject = true;
  }

  // ── Codable / data models ────────────────────────────────────────────────────
  if (/:\s*(?:Codable|Decodable|Encodable)\b/.test(src)) {
    meta.isCodable = true;
  }

  // ── @IBOutlet / @IBAction — UIKit wiring (dynamic, can't fully resolve) ─────
  const ibOutlets = [...src.matchAll(/@IBOutlet\s+(?:weak\s+)?var\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1]);
  const ibActions = [...src.matchAll(/@IBAction\s+func\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1]);
  if (ibOutlets.length > 0 || ibActions.length > 0) {
    meta.ibConnections = { outlets: ibOutlets, actions: ibActions };
    // These are dynamic connections via Interface Builder — flag as gaps
    for (const action of ibActions) {
      gaps.push({ type: 'ib-action', line: 0, name: action });
    }
  }

  // ── #if canImport / conditional imports ─────────────────────────────────────
  for (const m of src.matchAll(/#if\s+canImport\(([A-Za-z_][A-Za-z0-9_.]*)\)/g)) {
    const mod = m[1];
    if (!imports.includes(mod)) gaps.push({ type: 'conditional-import', line: 0, name: mod });
  }

  // ── isBarrel heuristic — files named like index.swift or only re-exports ────
  const isBarrel = path.basename(filePath, '.swift').toLowerCase() === 'index'
    || (exports.length === 0 && src.includes('@_exported'));

  return {
    lang: 'swift',
    imports,
    exports,
    gaps,
    meta: { ...meta, isBarrel },
    error: false,
  };
}

module.exports = { parse };
