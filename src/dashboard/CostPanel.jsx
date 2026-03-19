import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { loadUsageData } from './cache.js';

export default function CostPanel({ projectDir, tick }) {
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    setUsage(loadUsageData(projectDir));
  }, [tick]);

  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENROUTER_API_KEY) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="blue" padding={1} minHeight={8}>
        <Text bold color="blue"> Usage</Text>
        <Box marginTop={1}>
          <Text dimColor>No API key configured</Text>
        </Box>
      </Box>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const thisWeekStart = new Date();
  thisWeekStart.setDate(thisWeekStart.getDate() - 7);

  const todayRuns = usage?.runs?.filter(r => r.timestamp?.startsWith(today)) || [];
  const weekRuns = usage?.runs?.filter(r => new Date(r.timestamp) >= thisWeekStart) || [];

  const todayCost = todayRuns.reduce((sum, r) => sum + (r.estimatedCost || 0), 0);
  const weekCost = weekRuns.reduce((sum, r) => sum + (r.estimatedCost || 0), 0);
  const todayCalls = todayRuns.reduce((sum, r) => sum + ((r.models?.haiku || 0) + (r.models?.sonnet || 0)), 0);
  const weekCalls = weekRuns.reduce((sum, r) => sum + ((r.models?.haiku || 0) + (r.models?.sonnet || 0)), 0);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="blue" padding={1} minHeight={8}>
      <Text bold color="blue"> Usage</Text>
      <Box marginTop={1} flexDirection="column">
        <Box justifyContent="space-between">
          <Text>Today    </Text>
          <Text color="cyan">${todayCost.toFixed(2)}</Text>
          <Text dimColor>  {todayCalls} calls</Text>
        </Box>
        <Box justifyContent="space-between">
          <Text>This week</Text>
          <Text color="cyan">${weekCost.toFixed(2)}</Text>
          <Text dimColor>  {weekCalls} calls</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            {process.env.ANTHROPIC_API_KEY ? 'Anthropic' : 'OpenRouter'}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
