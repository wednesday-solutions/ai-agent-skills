import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import PRPanel from './PRPanel.js';
import TriagePanel from './TriagePanel.js';
import SkillsPanel from './SkillsPanel.js';
import CostPanel from './CostPanel.js';

const REFRESH_INTERVAL_MS = 30_000;

export default function App({ prFilter, projectDir }) {
  const { exit } = useApp();
  const [tick, setTick] = useState(0);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(() => {
      setTick(t => t + 1);
      setLastRefresh(new Date());
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Keyboard controls
  useInput((input) => {
    if (input === 'q' || input === 'Q') exit();
    if (input === 'r' || input === 'R') {
      setTick(t => t + 1);
      setLastRefresh(new Date());
    }
  });

  const refreshTime = lastRefresh.toLocaleTimeString();

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold color="blue">Wednesday Skills Dashboard</Text>
        <Text dimColor>Last refresh: {refreshTime}  [r] refresh  [q] quit</Text>
      </Box>

      {/* Top row */}
      <Box flexDirection="row" gap={2} marginBottom={1}>
        <Box flexGrow={1}>
          <PRPanel prFilter={prFilter} tick={tick} />
        </Box>
        <Box flexGrow={1}>
          <TriagePanel prFilter={prFilter} projectDir={projectDir} tick={tick} />
        </Box>
      </Box>

      {/* Bottom row */}
      <Box flexDirection="row" gap={2}>
        <Box flexGrow={1}>
          <SkillsPanel projectDir={projectDir} tick={tick} />
        </Box>
        <Box flexGrow={1}>
          <CostPanel projectDir={projectDir} tick={tick} />
        </Box>
      </Box>
    </Box>
  );
}
