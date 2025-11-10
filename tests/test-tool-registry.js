/**
 * Test Suite for Tool Registry
 *
 * Validates that all tools are properly organized into groups
 * and that there are no duplicates or missing tools.
 */

import {
  TOOL_GROUPS,
  TOOL_GROUP_DESCRIPTIONS,
  TOOL_GROUP_COUNTS,
  getAllTools,
  findToolGroup,
  getGroupTools,
  validateToolRegistry,
  getToolStats,
  verifyIntegrity
} from '../src/tool-registry.js';

// Test colors
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const NC = '\x1b[0m';

let passedTests = 0;
let failedTests = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`${GREEN}✓${NC} ${name}`);
    passedTests++;
  } catch (error) {
    console.log(`${RED}✗${NC} ${name}`);
    console.log(`  ${RED}Error: ${error.message}${NC}`);
    failedTests++;
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\n  Expected: ${expected}\n  Actual: ${actual}`);
  }
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

console.log('\n' + YELLOW + 'Running Tool Registry Tests...' + NC + '\n');

// Test 1: All tools are accounted for
test('All 37 tools are defined in groups', () => {
  const allTools = getAllTools();
  assertEqual(allTools.length, 37, 'Should have exactly 37 tools');
});

// Test 2: No duplicate tools
test('No duplicate tools across groups', () => {
  const allTools = getAllTools();
  const uniqueTools = new Set(allTools);
  assertEqual(uniqueTools.size, 37, 'All 37 tools should be unique');
});

// Test 3: Tool group counts are correct
test('Tool group counts match TOOL_GROUP_COUNTS', () => {
  for (const [groupName, tools] of Object.entries(TOOL_GROUPS)) {
    assertEqual(
      tools.length,
      TOOL_GROUP_COUNTS[groupName],
      `Group ${groupName} count mismatch`
    );
  }
});

// Test 4: All groups have descriptions
test('All groups have descriptions', () => {
  for (const groupName of Object.keys(TOOL_GROUPS)) {
    assertTrue(
      groupName in TOOL_GROUP_DESCRIPTIONS,
      `Group ${groupName} missing description`
    );
    assertTrue(
      TOOL_GROUP_DESCRIPTIONS[groupName].length > 0,
      `Group ${groupName} has empty description`
    );
  }
});

// Test 5: findToolGroup works correctly
test('findToolGroup returns correct group', () => {
  assertEqual(findToolGroup('ssh_execute'), 'core', 'ssh_execute should be in core group');
  assertEqual(findToolGroup('ssh_session_start'), 'sessions', 'ssh_session_start should be in sessions group');
  assertEqual(findToolGroup('ssh_backup_create'), 'backup', 'ssh_backup_create should be in backup group');
  assertEqual(findToolGroup('nonexistent_tool'), null, 'Should return null for unknown tool');
});

// Test 6: getGroupTools returns correct tools
test('getGroupTools returns correct tools', () => {
  const coreTools = getGroupTools('core');
  assertEqual(coreTools.length, 5, 'Core group should have 5 tools');
  assertTrue(coreTools.includes('ssh_execute'), 'Core should include ssh_execute');

  const advancedTools = getGroupTools('advanced');
  assertEqual(advancedTools.length, 14, 'Advanced group should have 14 tools');
});

// Test 7: Core tools are correct
test('Core group contains expected tools', () => {
  const coreTools = getGroupTools('core');
  const expectedCore = ['ssh_list_servers', 'ssh_execute', 'ssh_upload', 'ssh_download', 'ssh_sync'];

  for (const tool of expectedCore) {
    assertTrue(coreTools.includes(tool), `Core should include ${tool}`);
  }
});

// Test 8: Verify integrity check
test('verifyIntegrity returns valid', () => {
  const integrity = verifyIntegrity();
  assertTrue(integrity.valid, 'Integrity check should pass');
  assertEqual(integrity.duplicates.length, 0, 'Should have no duplicates');
  assertEqual(integrity.issues.length, 0, 'Should have no issues');
});

// Test 9: getToolStats returns correct stats
test('getToolStats returns correct statistics', () => {
  const stats = getToolStats();
  assertEqual(stats.totalGroups, 6, 'Should have 6 groups');
  assertEqual(stats.totalTools, 37, 'Should have 37 total tools');
  assertEqual(stats.groups.length, 6, 'Should have 6 group entries');
});

// Test 10: All tool names follow naming convention
test('All tools follow ssh_* naming convention', () => {
  const allTools = getAllTools();
  for (const tool of allTools) {
    assertTrue(
      tool.startsWith('ssh_'),
      `Tool ${tool} should start with 'ssh_'`
    );
  }
});

// Test 11: validateToolRegistry works
test('validateToolRegistry identifies correct tools', () => {
  const allTools = getAllTools();
  const validation = validateToolRegistry(allTools);

  assertTrue(validation.valid, 'Validation should pass for all tools');
  assertEqual(validation.missing.length, 0, 'Should have no missing tools');
  assertEqual(validation.unexpected.length, 0, 'Should have no unexpected tools');
  assertEqual(validation.total, 37, 'Should expect 37 tools');
  assertEqual(validation.registered, 37, 'Should register 37 tools');
});

// Test 12: validateToolRegistry catches missing tools
test('validateToolRegistry detects missing tools', () => {
  const partialTools = ['ssh_execute', 'ssh_upload'];
  const validation = validateToolRegistry(partialTools);

  assertTrue(!validation.valid, 'Validation should fail for partial list');
  assertEqual(validation.registered, 2, 'Should show 2 registered');
  assertTrue(validation.missing.length > 0, 'Should have missing tools');
});

// Test 13: Specific group sizes
test('Group sizes match specifications', () => {
  assertEqual(TOOL_GROUPS.core.length, 5, 'Core should have 5 tools');
  assertEqual(TOOL_GROUPS.sessions.length, 4, 'Sessions should have 4 tools');
  assertEqual(TOOL_GROUPS.monitoring.length, 6, 'Monitoring should have 6 tools');
  assertEqual(TOOL_GROUPS.backup.length, 4, 'Backup should have 4 tools');
  assertEqual(TOOL_GROUPS.database.length, 4, 'Database should have 4 tools');
  assertEqual(TOOL_GROUPS.advanced.length, 14, 'Advanced should have 14 tools');
});

// Summary
console.log('\n' + '='.repeat(60));
console.log(`${GREEN}Passed: ${passedTests}${NC}`);
console.log(`${RED}Failed: ${failedTests}${NC}`);
console.log('='.repeat(60) + '\n');

process.exit(failedTests > 0 ? 1 : 0);
