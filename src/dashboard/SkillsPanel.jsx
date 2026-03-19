import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { loadInstalledSkills } from './cache.js';

export default function SkillsPanel({ projectDir, tick }) {
  const [skills, setSkills] = useState(null);

  useEffect(() => {
    setSkills(loadInstalledSkills(projectDir));
  }, [tick]);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="blue" padding={1} minHeight={8}>
      <Text bold color="blue"> Skills Installed</Text>
      <Box marginTop={1} flexDirection="column">
        {skills === null && <Text dimColor>Loading...</Text>}
        {skills && skills.length === 0 && <Text dimColor>No skills installed</Text>}
        {skills && skills.map(skill => (
          <Box key={skill.name} justifyContent="space-between">
            <Text>{skill.name.padEnd(20)}</Text>
            <Text dimColor>{skill.version.padEnd(6)}</Text>
            <Text color="green">active</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
