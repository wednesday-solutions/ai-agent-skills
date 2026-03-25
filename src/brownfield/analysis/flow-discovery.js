/**
 * 2B-5 — Functional Flow Discovery
 * Traces functional paths using DB-native queries.
 * Helps new devs understand "how a request moves through the system".
 */

 'use strict';

 /**
  * Discover the primary execution flows in the codebase using the DB store.
  * @param {GraphStore} store - instance of GraphStore
  * @param {number} maxPaths - number of flows to discover
  * @param {number} maxDepth - depth of each flow
  * @returns {Array<{ path: string, depth: number, description: string }>}
  */
 function discoverPrimaryFlows(store, maxPaths = 5, maxDepth = 4) {
   if (!store || typeof store.getPrimaryFlows !== 'function') return [];

   const flows = store.getPrimaryFlows(maxDepth, maxPaths);

   return flows.map(f => {
     const parts = f.path.split(' -> ');
     const entry = parts[0];
     const end = parts[parts.length - 1];
     
     return {
       ...f,
       entry,
       description: `Execution starts in \`${entry}\` and flows through ${parts.length - 2} intermediate layers to reach \`${end}\`.`
     };
   });
 }

 module.exports = { discoverPrimaryFlows };
