/**
 * Phase D: Community Detection Layer
 * Uses the Louvain algorithm to cluster files into logical 'communities'
 * based on their import and call relationships.
 */

'use strict';

const { Graph } = require('graphology');
const louvain = require('graphology-communities-louvain');

/**
 * Compute communities for all nodes in the store
 * @param {GraphStore} store
 * @returns {Object} communityMap — { filePath: communityId }
 */
function computeCommunities(store) {
  const nodes = store.getAllNodes();
  const edges = store.getAllEdges();

  if (nodes.length === 0) return {};

  // We use an undirected graph for Louvain clustering to capture 
  // "cliques" of files that work together, regardless of import direction.
  const graph = new Graph({ type: 'undirected' });

  // Add all nodes
  for (const node of nodes) {
    graph.addNode(node.file);
  }

  // Add all edges (imports and calls)
  // We weight 'calls' higher than 'imports' if both exist, as functional 
  // interaction is a stronger signal of "working together" than structural imports.
  for (const edge of edges) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
    if (edge.source === edge.target) continue;

    const weight = edge.kind === 'calls' ? 2 : 1;
    
    if (graph.hasEdge(edge.source, edge.target)) {
      const existing = graph.getEdgeAttribute(edge.source, edge.target, 'weight') || 1;
      graph.setEdgeAttribute(edge.source, edge.target, 'weight', Math.max(existing, weight));
    } else {
      graph.addEdge(edge.source, edge.target, { weight });
    }
  }

  // Run Louvain clustering
  const communities = louvain(graph);

  return communities;
}

module.exports = { computeCommunities };
