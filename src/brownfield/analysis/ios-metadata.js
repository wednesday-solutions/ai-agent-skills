/**
 * 2B-6 — iOS-Specific Metadata Extraction
 * Extracts Deployment Target, Firebase details, TabBar structure, and Environment config.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Extract iOS-specific metadata from the project root and graph nodes.
 * @param {string} rootDir - project root
 * @param {Object} nodes - graph nodes
 * @returns {Object} metadata
 */
function extractIosMetadata(rootDir, nodes) {
  const metadata = {
    deploymentTarget: null,
    firebase: { firestore: false, realtimeDB: false, messaging: false, analytics: false },
    tabBar: { items: [], file: null },
    environments: [],
  };

  // 1. Deployment Target (scan .xcodeproj or Podfile)
  try {
    const podfile = path.join(rootDir, 'Podfile');
    if (fs.existsSync(podfile)) {
      const content = fs.readFileSync(podfile, 'utf8');
      const match = content.match(/platform :ios, ['"]([\d.]+)['"]/);
      if (match) metadata.deploymentTarget = match[1];
    }
  } catch {}

  // 2. Firebase & Environments
  for (const [file, node] of Object.entries(nodes)) {
    const content = node.meta?.sigs || ''; // We might need to scan imports instead
    
    // Scan imports for Firebase specifics
    if (node.imports) {
      for (const imp of node.imports) {
        if (imp.includes('FirebaseFirestore')) metadata.firebase.firestore = true;
        if (imp.includes('FirebaseDatabase'))  metadata.firebase.realtimeDB = true;
        if (imp.includes('FirebaseMessaging')) metadata.firebase.messaging = true;
        if (imp.includes('FirebaseAnalytics')) metadata.firebase.analytics = true;
      }
    }

    // 3. TabBar structure (look for tabBarItem or UITabBarController)
    if (file.toLowerCase().includes('tabbar') || file.toLowerCase().includes('maincoordinator') || file.toLowerCase().includes('appdelegate')) {
       // Heuristic: any file that mentions tabBarItem and is a ViewController/Coordinator
       if (node.meta?.signatures?.includes('tabBarItem')) {
         const base = path.basename(file);
         if (!metadata.tabBar.items.includes(base)) {
           metadata.tabBar.items.push(base);
           metadata.tabBar.file = file;
         }
       }
    }

    // 4. Environments (.xcconfig detection)
    if (file.endsWith('.xcconfig')) {
      const base = path.basename(file, '.xcconfig');
      if (!metadata.environments.includes(base)) metadata.environments.push(base);
    }
  }

  // Final check for environment files on disk (top-level)
  try {
    const files = fs.readdirSync(rootDir);
    for (const f of files) {
      if (f.endsWith('.xcconfig')) {
        const base = path.basename(f, '.xcconfig');
        if (!metadata.environments.includes(base)) metadata.environments.push(base);
      }
    }
  } catch {}

  return metadata;
}

module.exports = { extractIosMetadata };
