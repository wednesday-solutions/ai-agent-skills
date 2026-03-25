'use strict';

const path = require('path');

// ── Role classifier ────────────────────────────────────────────────────────────
function classifyRole(file, node) {
  const f    = file.toLowerCase();
  const name = path.basename(f, path.extname(f));
  if (node.meta?.isController)                              return 'controller';
  if (node.meta?.isProvider)                               return 'service';
  if (node.isEntryPoint)                                   return 'entry point';
  if (node.isBarrel)                                       return 'module index';
  if (/\.test\.|\.spec\./.test(f))                         return 'test file';
  if (/\/(hooks?)\//i.test(f) || /^use[A-Z]/.test(name))  return 'React hook';
  if (/\/(components?|views?|screens?|pages?)\//i.test(f) || /component|view|screen|page/i.test(name)) return 'UI component';
  if (/service/i.test(name))                               return 'service';
  if (/util|helper/i.test(name))                           return 'utility';
  if (/\/model[s]?\/|\/schema/i.test(f))                   return 'data model';
  if (/config|constant/i.test(name))                       return 'config';
  if (/route|router/i.test(name))                          return 'router';
  if (/middleware/i.test(name))                            return 'middleware';
  if (/store|redux|context/i.test(f))                      return 'state store';
  if (node.lang === 'graphql')                             return 'GraphQL schema';
  if (node.lang === 'go')                                  return 'Go package';
  if (node.lang === 'kotlin')                              return 'Android module';
  if (node.lang === 'swift') {
    if (node.meta?.isViewController) return 'iOS ViewController';
    if (node.meta?.isView)           return 'SwiftUI View';
    if (node.meta?.isObservableObject) return 'iOS ViewModel';
    return 'iOS module';
  }
  return 'module';
}

// Role → plain-English sentence template
const ROLE_PURPOSE = {
  'controller':     (name) => `Handles incoming requests for the ${name} area and decides what the app does with them.`,
  'service':        (name) => `Contains the core logic for ${name} — the rules and operations that make this feature work.`,
  'entry point':    (name) => `The starting point of the application. Everything else is kicked off from here.`,
  'module index':   (name) => `Re-exports everything from the ${name} directory so other parts of the app have one place to import from.`,
  'test file':      (name) => `Automated tests that verify ${name} works correctly.`,
  'React hook':     (name) => `A reusable React hook that manages ${name.replace(/^use/, '').replace(/([A-Z])/g, ' $1').trim().toLowerCase()} behaviour across components.`,
  'UI component':   (name) => `A visual building block that renders the ${name} part of the user interface.`,
  'utility':        (name) => `A collection of helper functions for ${name} used across the codebase.`,
  'data model':     (name) => `Defines the shape of ${name} data — what fields it has and what types they are.`,
  'config':         (name) => `Stores configuration values for ${name} that control how the app behaves.`,
  'router':         (name) => `Maps URLs or commands to the right handlers for the ${name} area.`,
  'middleware':     (name) => `Runs in the middle of every request for ${name} — checks, transforms, or blocks traffic.`,
  'state store':    (name) => `Holds shared application state for ${name} so multiple components can read and update it.`,
  'GraphQL schema': (name) => `Defines the ${name} types and operations available in the GraphQL API.`,
  'Go package':          (name) => `A Go package providing ${name} functionality. Exported symbols start with a capital letter.`,
  'Android module':      (name) => `An Android/Kotlin module for ${name}. May include Activities, Fragments, or ViewModels.`,
  'iOS ViewController':  (name) => `An iOS screen controller for ${name}. Manages what the user sees and responds to their taps.`,
  'SwiftUI View':        (name) => `A SwiftUI screen or component that draws the ${name} part of the app UI.`,
  'iOS ViewModel':       (name) => `An observable data holder for ${name} — keeps the UI in sync with the app state.`,
  'iOS module':          (name) => `A Swift module providing ${name} functionality to the iOS app.`,
  'module':              (name) => `Provides ${name} functionality to other parts of the app.`,
};

function purposeSentence(file, node) {
  const role = classifyRole(file, node);
  const name = path.basename(file, path.extname(file))
    .replace(/([A-Z])/g, ' $1').replace(/[-_]/g, ' ').trim().toLowerCase();
  return ROLE_PURPOSE[role]?.(name) || `Provides ${name} functionality.`;
}

module.exports = { classifyRole, purposeSentence };
