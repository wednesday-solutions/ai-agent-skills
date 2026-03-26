/**
 * 2B-5 — Functional Flow Discovery
 * Traces functional paths using DB-native queries.
 * Helps new devs understand "how a request moves through the system".
 */

 'use strict';

 const path = require('path');

 /**
  * Discover the primary execution flows in the codebase using the DB store.
  * @param {GraphStore} store - instance of GraphStore
  * @param {number} maxPaths - number of flows to discover
  * @param {number} maxDepth - depth of each flow
  * @returns {Array<{ path: string, depth: number, description: string }>}
  */
 const BOILERPLATE_PATTERNS = [
   /Extensions?\.swift$/,
   /Constants?\.swift$/,
   /AppDelegate\.swift$/,
   /SceneDelegate\.swift$/,
   /Generated\//,
   /\+Extensions/,
   /Models?\.swift$/,
 ];

 /**
  * Discover the primary execution flows in the codebase using the DB store.
  * @param {GraphStore} store - instance of GraphStore
  * @param {number} maxPaths - number of flows to discover
  * @param {number} maxDepth - depth of each flow
  * @returns {Array<{ path: string, depth: number, description: string }>}
  */
 function discoverPrimaryFlows(store, maxPaths = 5, maxDepth = 6) {
   if (!store || typeof store.getPrimaryFlows !== 'function') return [];

   let flows = store.getPrimaryFlows(maxDepth, maxPaths * 3); // Get more to filter down

   // Filter out paths that are too noisy (mostly boilerplate/extensions)
   flows = flows.filter(f => {
     const parts = f.path.split(' -> ');
     // A flow is interesting if it has at least one non-boilerplate intermediate node
     const intermediates = parts.slice(1, -1);
     if (intermediates.length === 0) return true;
     return intermediates.some(p => !BOILERPLATE_PATTERNS.some(re => re.test(p)));
   });

   return flows.slice(0, maxPaths).map(f => {
     const parts = f.path.split(' -> ');
     const entry = path.basename(parts[0]);
     const end = path.basename(parts[parts.length - 1]);
     const flowType = f.has_call ? 'Functional flow' : 'Dependency path';
     
     return {
       ...f,
       entry,
       description: `**${flowType}**: Starts in \`${entry}\` and moves through ${parts.length - 2} layers to reach \`${end}\`.`
     };
   });
 }

 module.exports = { discoverPrimaryFlows };
