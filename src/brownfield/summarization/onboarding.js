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
 * Generate an onboarding guide given interview answers and the graph.
 * When commentIntel is provided and has reversePrd, uses developer-written context
 * instead of structural file summaries — ~40% fewer input tokens, better output.
 */
async function generateOnboarding(answers, graph, summaries, apiKey, commentIntel = null, store = null) {
  const nodes = graph.nodes;
  const role  = answers[0] || 'developer';
  const area  = answers[1] || 'general';

  // Scope the node list to relevant files
  const scopedNodes = selectScopedNodes(area, nodes);
  const { discoverPrimaryFlows } = require('../analysis/flow-discovery');
  const flows = store ? discoverPrimaryFlows(store, 1, 4) : [];
  const primaryFlow = flows[0] ? flows[0].path.replace(/ -> /g, ' ➔ ') : '(no flow detected)';

  // When reversePrd exists, use developer intent as context instead of structural
  // file summaries — same token budget, far more meaningful onboarding signal
  let contextBlock;
  if (commentIntel?.reversePrd) {
    const bizModules = (commentIntel.modules || [])
      .filter(m => m.isBizFeature === true && m.purpose)
      .slice(0, 4)
      .map(m => `- \`${m.dir}/\`: ${m.purpose}`)
      .join('\n');
    contextBlock = `Project context:\n${commentIntel.reversePrd}\n\nPrimary execution flow:\n${primaryFlow}\n\nKey modules:\n${bizModules || '(none enriched)'}`;
  } else {
    const scopedSummaries = scopedNodes
      .slice(0, 8)
      .map(file => `- ${file}: ${summaries[file] || '(no summary)'}`)
      .join('\n');
    contextBlock = `Relevant modules (${scopedNodes.length} files):\n${scopedSummaries}\n\nPrimary execution flow:\n${primaryFlow}`;
  }

  const prompt = `New developer onboarding:
Role: ${role}
Focus area: ${area}
Familiarity: ${answers[2] || 'new'}

${contextBlock}

Explain the "User Flow" of this focus area. How does a request/action start and where does it end?
Include: 1) the step-by-step path, 2) core logic files to study, 3) how to verify changes.`;

  if (!apiKey) {
    return generateStructuralOnboarding(role, area, scopedNodes, summaries, commentIntel, primaryFlow);
  }


  return new Promise(resolve => {
    const body = JSON.stringify({
      model: 'anthropic/claude-haiku-4-5',
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

function generateStructuralOnboarding(role, area, scopedNodes, summaries, commentIntel = null, primaryFlow = '') {
  const topFiles = scopedNodes.slice(0, 5);
  const fileList = topFiles.map(f => `- \`${f}\`: ${(summaries[f] || '').split('.')[0]}`).join('\n');

  const projectContext = commentIntel?.reversePrd
    ? `\n### What this project does\n${commentIntel.reversePrd.split('\n')[0]}\n`
    : '';

  const flowSection = primaryFlow 
    ? `\n### Primary execution flow\n\`${primaryFlow}\`\n`
    : '';

  return `## Onboarding Guide — ${area} (${role})
${projectContext}
${flowSection}
### Start here
${fileList || '- No files matched your focus area'}

### Key concepts
- Read \`.wednesday/codebase/MASTER.md\` for the full architecture overview
- Check \`.wednesday/codebase/graph.db\` for dependency relationships
- Run \`wednesday-skills score <file>\` before modifying any file

### Before touching code
- Run \`wednesday-skills blast <file>\` to see what depends on what you're changing
- Files with risk score > 60 need senior review`;
}

module.exports = { generateOnboarding, ONBOARDING_QUESTIONS, selectScopedNodes };
