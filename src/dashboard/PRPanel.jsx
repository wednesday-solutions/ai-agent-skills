import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { fetchOpenPRs } from './github.js';

export default function PRPanel({ prFilter, tick }) {
  const [prs, setPRs] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchOpenPRs(prFilter)
      .then(data => { setPRs(data); setError(null); })
      .catch(err => setError(err.message));
  }, [tick]);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="blue" padding={1} minHeight={8}>
      <Text bold color="blue"> Active PRs</Text>
      <Box marginTop={1} flexDirection="column">
        {error && <Text color="yellow">⚠ {error}</Text>}
        {!error && prs === null && <Text dimColor>Loading...</Text>}
        {!error && prs && prs.length === 0 && <Text dimColor>No open PRs</Text>}
        {!error && prs && prs.map(pr => (
          <Box key={pr.number} justifyContent="space-between">
            <Text>
              <Text color="cyan">#{pr.number}</Text>
              {' '}
              <Text>{pr.title.slice(0, 35)}{pr.title.length > 35 ? '…' : ''}</Text>
            </Text>
            <Text dimColor>{pr.fixes > 0 ? `${pr.fixes} fix${pr.fixes > 1 ? 'es' : ''}` : 'clear'}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
