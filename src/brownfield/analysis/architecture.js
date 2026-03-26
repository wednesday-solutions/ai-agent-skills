/**
 * 2B-6 — Architecture Pattern Recognition
 * Detects high-level patterns like VIP (Clean Swift), MVVM, or MVC
 * based on naming conventions and directory structures.
 */

'use strict';

const path = require('path');

/**
 * Detect the primary architecture pattern used in the project.
 * @param {Object} nodes - Dep-graph nodes
 * @returns {string|null} - Pattern name or null
 */
function detectArchitecturePattern(nodes) {
  const allFiles = Object.keys(nodes);
  
  // Clean Swift (VIP) indicators
  let interactors = 0;
  let presenters = 0;
  let routers = 0;
  let workers = 0;

  for (const file of allFiles) {
    const base = path.basename(file, path.extname(file));
    if (base.endsWith('Interactor')) interactors++;
    if (base.endsWith('Presenter')) presenters++;
    if (base.endsWith('Router')) routers++;
    if (base.endsWith('Worker')) workers++;
  }

  // Threshold: if we see a significant number of VIP components
  if (interactors >= 3 && presenters >= 3 && routers >= 3) {
    return 'Clean Swift (VIP)';
  }

  // MVVM indicators
  let viewModels = 0;
  for (const file of allFiles) {
    if (file.endsWith('ViewModel.swift') || file.endsWith('ViewModel.ts')) viewModels++;
  }
  if (viewModels >= 5) return 'MVVM';

  // NestJS (already handled by parser, but can be surfaced here)
  let controllers = 0;
  let services = 0;
  for (const file of allFiles) {
    if (file.endsWith('.controller.ts')) controllers++;
    if (file.endsWith('.service.ts')) services++;
  }
  if (controllers >= 3 && services >= 3) return 'NestJS (Modular)';

  return null;
}

module.exports = { detectArchitecturePattern };
