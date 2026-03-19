import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { loadTriageCache } from './cache.js';

export default function TriagePanel({ prFilter, projectDir, tick }) {
  const [queue, setQueue] = useState(null);

  useEffect(() => {
    const data = loadTriageCache(projectDir);
    setQueue(data);
  }, [tick]);

  const items = queue
    ? Object.entries(queue)
        .filter(([prNum]) => !prFilter || String(prFilter) === prNum)
    : null;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="blue" padding={1} minHeight={8}>
      <Text bold color="blue"> Triage Queue</Text>
      <Box marginTop={1} flexDirection="column">
        {items === null && <Text dimColor>Loading...</Text>}
        {items && items.length === 0 && <Text dimColor>No triage data</Text>}
        {items && items.map(([prNum, counts]) => (
          <Box key={prNum} justifyContent="space-between">
            <Text color="cyan">#{prNum}</Text>
            <Text>
              {counts.style > 0 && <Text color="green"> style({counts.style})</Text>}
              {counts.logic > 0 && <Text color="yellow"> logic({counts.logic})</Text>}
              {counts.security > 0 && <Text color="red"> security({counts.security})</Text>}
              {counts.style === 0 && counts.logic === 0 && counts.security === 0 && (
                <Text dimColor> clear</Text>
              )}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
