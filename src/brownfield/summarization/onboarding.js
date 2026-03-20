/**
 * 2C-4 — Onboarding guide generator
 * Interactive interview → scoped guide (not a full MASTER.md dump)
 * Cached by session answers + scoped node list.
 */

'use strict';

const https = require('https');

const ONBOARDING_QUESTIONS = [
  'What is your role? (e.g., frontend, backend, fullstack, devops)',
  'Which area will you work on first? (e.g., auth, API, UI, database, infrastructure)',
  'What is your familiarity with this codebase? (new/some/familiar)',
];

/**
 * Generate an onboarding guide given interview answers and the graph
 */
async function generateOnboarding(answers, graph, summaries, apiKey) {
  const nodes = graph.nodes;
  const role = answers[0] || 'developer';
  const area = answers[1] || 'general';

  // Scope the node list to relevant files
  const scopedNodes = selectScopedNodes(area, nodes);

  const scopedSummaries = scopedNodes
    .slice(0, 10)
    .map(file => `- ${file}: ${summaries[file] || '(no summary)'}`)
    .join('\n');

  const prompt = `New developer onboarding:
Role: ${role}
Focus area: ${area}
Familiarity: ${answers[2] || 'new'}

Relevant modules (${scopedNodes.length} files):
${scopedSummaries}

Write a focused 200-word onboarding guide. Include: 1) what to read first, 2) key concepts to understand, 3) files to avoid touching first. Be specific to the focus area.`;

  if (!apiKey) {
    return generateStructuralOnboarding(role, area, scopedNodes, summaries);
  }

  return new Promise(resolve => {
    const body = JSON.stringify({
      model: 'anthropic/claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 350,
      temperature: 0.1,
    });

    const options = {
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.choices?.[0]?.message?.content?.trim() || generateStructuralOnboarding(role, area, scopedNodes, summaries));
        } catch {
          resolve(generateStructuralOnboarding(role, area, scopedNodes, summaries));
        }
      });
    });
    req.on('error', () => resolve(generateStructuralOnboarding(role, area, scopedNodes, summaries)));
    req.setTimeout(30000, () => { req.destroy(); resolve(generateStructuralOnboarding(role, area, scopedNodes, summaries)); });
    req.write(body);
    req.end();
  });
}

/**
 * Select the most relevant nodes for a given area keyword
 */
function selectScopedNodes(area, nodes) {
  const areaLower = area.toLowerCase();
  const scored = Object.entries(nodes).map(([file, node]) => {
    let score = 0;
    if (file.toLowerCase().includes(areaLower)) score += 10;
    if (node.isEntryPoint) score += 5;
    if (node.importedBy.length > 5) score += 3;
    if (node.riskScore > 60) score += 2;
    return { file, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(s => s.file)
    .slice(0, 15);
}

function generateStructuralOnboarding(role, area, scopedNodes, summaries) {
  const topFiles = scopedNodes.slice(0, 5);
  const fileList = topFiles.map(f => `- \`${f}\`: ${(summaries[f] || '').split('.')[0]}`).join('\n');

  return `## Onboarding Guide — ${area} (${role})

### Start here
${fileList || '- No files matched your focus area'}

### Key concepts
- Read \`.wednesday/codebase/MASTER.md\` for the full architecture overview
- Check \`.wednesday/codebase/dep-graph.json\` for dependency relationships
- Run \`wednesday-skills score <file>\` before modifying any file

### Before touching code
- Run \`wednesday-skills blast <file>\` to see what depends on what you're changing
- Files with risk score > 60 need senior review`;
}

module.exports = { generateOnboarding, ONBOARDING_QUESTIONS, selectScopedNodes };
