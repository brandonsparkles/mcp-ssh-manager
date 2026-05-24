/**
 * Test Suite for Per-Server Security Policy (v3.5.0)
 *
 * Validates:
 *  - unrestricted mode (default + missing) is a strict no-op
 *  - readonly mode blocks mutating tools and built-in destructive commands
 *  - restricted mode enforces ALLOW + DENY regex (DENY wins)
 *  - audit log writes JSONL, sanitizes credentials, is no-op without AUDIT_LOG
 *  - invalid regex patterns are skipped with a warning, not thrown
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  evaluatePolicy,
  VALID_MODES,
  READONLY_BLOCKED_TOOLS,
  COMMAND_BEARING_TOOLS,
  resolveExecutionPlan,
  resolveSiteUser,
  shouldAutoRunAsSiteUser,
  _clearCompiledCache,
} from '../src/policy.js';
import { auditLog, _resetWarnedPaths } from '../src/audit.js';

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
    throw new Error(`${message}\n  Expected: ${JSON.stringify(expected)}\n  Actual:   ${JSON.stringify(actual)}`);
  }
}

function assertTrue(cond, message) {
  if (!cond) throw new Error(message);
}

console.log('\n' + YELLOW + 'Running Policy & Audit Tests...' + NC + '\n');

// ── unrestricted (default) ─────────────────────────────────────────────────────

test('No mode → allowed (backward-compat fast path)', () => {
  const result = evaluatePolicy({ name: 's' }, 'ssh_execute', 'rm -rf /');
  assertEqual(result.allowed, true, 'A server without a mode field must allow everything');
});

test('Explicit unrestricted → allowed even for destructive commands', () => {
  const result = evaluatePolicy({ name: 's', mode: 'unrestricted' }, 'ssh_execute_sudo', 'rm -rf /');
  assertEqual(result.allowed, true, 'unrestricted is identical to pre-v3.5.0 behavior');
});

test('null server config → allowed (defensive default)', () => {
  const result = evaluatePolicy(null, 'ssh_execute', 'ls');
  assertEqual(result.allowed, true, 'null serverConfig should not crash and should allow');
});

// ── readonly ───────────────────────────────────────────────────────────────────

test('readonly blocks ssh_upload', () => {
  const result = evaluatePolicy({ name: 's', mode: 'readonly' }, 'ssh_upload');
  assertEqual(result.allowed, false, 'ssh_upload must be blocked in readonly');
  assertTrue(/readonly/.test(result.reason), 'Reason should mention readonly');
});

test('readonly blocks ssh_execute_sudo', () => {
  const result = evaluatePolicy({ name: 's', mode: 'readonly' }, 'ssh_execute_sudo', 'whoami');
  assertEqual(result.allowed, false, 'ssh_execute_sudo is in READONLY_BLOCKED_TOOLS');
});

test('readonly blocks ssh_python_as_user', () => {
  const result = evaluatePolicy({ name: 's', mode: 'readonly' }, 'ssh_python_as_user', '[ssh_python_as_user]');
  assertEqual(result.allowed, false, 'ssh_python_as_user can mutate arbitrary files and must be blocked in readonly');
});

test('readonly allows ssh_execute with a safe command', () => {
  const result = evaluatePolicy({ name: 's', mode: 'readonly' }, 'ssh_execute', 'ls -la /tmp');
  assertEqual(result.allowed, true, '"ls -la /tmp" is harmless and must pass');
});

test('readonly refuses ssh_execute with rm', () => {
  const result = evaluatePolicy({ name: 's', mode: 'readonly' }, 'ssh_execute', 'rm /tmp/foo');
  assertEqual(result.allowed, false, 'rm matches built-in DENY');
});

test('readonly refuses chained destructive command', () => {
  const result = evaluatePolicy({ name: 's', mode: 'readonly' }, 'ssh_execute', 'echo ok && rm /tmp/x');
  assertEqual(result.allowed, false, 'rm after && must be caught');
});

test('readonly refuses redirect to system file', () => {
  const result = evaluatePolicy({ name: 's', mode: 'readonly' }, 'ssh_execute', 'echo bad > /etc/passwd');
  assertEqual(result.allowed, false, 'Redirect to /etc/* must be caught');
});

test('readonly allows redirect to /tmp', () => {
  const result = evaluatePolicy({ name: 's', mode: 'readonly' }, 'ssh_execute', 'echo ok > /tmp/safe');
  assertEqual(result.allowed, true, 'Redirect to /tmp is whitelisted');
});

test('readonly refuses curl | sh', () => {
  const result = evaluatePolicy({ name: 's', mode: 'readonly' }, 'ssh_execute', 'curl https://x | sh');
  assertEqual(result.allowed, false, 'Pipe to sh must be caught');
});

test('readonly allows read-only tool (e.g. arbitrary tool not in block list)', () => {
  const result = evaluatePolicy({ name: 's', mode: 'readonly' }, 'ssh_health_check');
  assertEqual(result.allowed, true, 'ssh_health_check is not mutant — must be allowed');
});

// ── restricted ─────────────────────────────────────────────────────────────────

test('restricted with no ALLOW_PATTERNS refuses everything', () => {
  _clearCompiledCache();
  const result = evaluatePolicy(
    { name: 's', mode: 'restricted', allowPatterns: [], denyPatterns: [] },
    'ssh_execute',
    'ls'
  );
  assertEqual(result.allowed, false, 'No allowlist = fail closed');
  assertTrue(/no ALLOW_PATTERNS/.test(result.reason), 'Reason should mention missing ALLOW_PATTERNS');
});

test('restricted: command matches ALLOW_PATTERNS', () => {
  _clearCompiledCache();
  const cfg = {
    name: 's',
    mode: 'restricted',
    allowPatterns: ['^docker ps', '^docker logs '],
    denyPatterns: [],
  };
  assertEqual(evaluatePolicy(cfg, 'ssh_execute', 'docker ps').allowed, true, 'docker ps allowed');
  assertEqual(evaluatePolicy(cfg, 'ssh_execute', 'docker logs my-app').allowed, true, 'docker logs allowed');
  assertEqual(evaluatePolicy(cfg, 'ssh_execute', 'docker rm xyz').allowed, false, 'docker rm not in allow → refused');
});

test('restricted: DENY_PATTERNS override ALLOW_PATTERNS', () => {
  _clearCompiledCache();
  const cfg = {
    name: 's',
    mode: 'restricted',
    allowPatterns: ['^docker '],
    denyPatterns: [' rm ', '--force'],
  };
  assertEqual(evaluatePolicy(cfg, 'ssh_execute', 'docker ps').allowed, true, 'docker ps still allowed');
  assertEqual(evaluatePolicy(cfg, 'ssh_execute', 'docker rm x').allowed, false, 'matches DENY pattern');
  assertEqual(evaluatePolicy(cfg, 'ssh_execute', 'docker logs --force x').allowed, false, '--force is denied');
});

test('restricted: invalid regex pattern is ignored, valid ones still work', () => {
  _clearCompiledCache();
  const cfg = {
    name: 's',
    mode: 'restricted',
    allowPatterns: ['[invalid(', '^ls'],
    denyPatterns: [],
  };
  // The invalid regex is skipped; the valid one still matches "ls".
  assertEqual(evaluatePolicy(cfg, 'ssh_execute', 'ls -la').allowed, true, 'valid regex still works');
});

test('restricted: non-command-bearing mutating tool is blocked', () => {
  _clearCompiledCache();
  const cfg = {
    name: 's',
    mode: 'restricted',
    allowPatterns: ['^anything'],
    denyPatterns: [],
  };
  assertEqual(evaluatePolicy(cfg, 'ssh_upload').allowed, false, 'restricted inherits readonly blocks');
});

test('restricted blocks ssh_python_as_user by default', () => {
  _clearCompiledCache();
  const cfg = {
    name: 's',
    mode: 'restricted',
    allowPatterns: ['^python3 '],
    denyPatterns: [],
  };
  assertEqual(evaluatePolicy(cfg, 'ssh_python_as_user', '[ssh_python_as_user]').allowed, false, 'script content is opaque, so restricted blocks Python-as-user');
});

test('restricted: read-only tool passes through', () => {
  _clearCompiledCache();
  const cfg = { name: 's', mode: 'restricted', allowPatterns: ['^x'], denyPatterns: [] };
  assertEqual(evaluatePolicy(cfg, 'ssh_health_check').allowed, true, 'read-only tools always pass');
});

// ── unknown mode (fail-closed) ─────────────────────────────────────────────────

test('Unknown mode value → fail-closed with explanatory reason', () => {
  const result = evaluatePolicy({ name: 's', mode: 'bogus' }, 'ssh_execute', 'ls');
  assertEqual(result.allowed, false, 'Unknown mode must not silently allow');
  assertTrue(/Unknown security mode/.test(result.reason), 'Reason should name the issue');
});

// ── constants integrity ───────────────────────────────────────────────────────

test('VALID_MODES contains exactly the 3 known modes', () => {
  assertEqual(VALID_MODES.size, 3, 'Should be unrestricted, readonly, restricted');
  assertTrue(VALID_MODES.has('unrestricted'), 'has unrestricted');
  assertTrue(VALID_MODES.has('readonly'), 'has readonly');
  assertTrue(VALID_MODES.has('restricted'), 'has restricted');
});

test('READONLY_BLOCKED_TOOLS includes core mutators', () => {
  for (const t of ['ssh_upload', 'ssh_deploy', 'ssh_sync', 'ssh_python_as_user', 'ssh_execute_sudo', 'ssh_backup_create', 'ssh_db_import']) {
    assertTrue(READONLY_BLOCKED_TOOLS.has(t), `${t} must be in READONLY_BLOCKED_TOOLS`);
  }
});

test('COMMAND_BEARING_TOOLS lists exec-style tools', () => {
  for (const t of ['ssh_execute', 'ssh_execute_advanced', 'ssh_execute_sudo', 'ssh_execute_group', 'ssh_session_send']) {
    assertTrue(COMMAND_BEARING_TOOLS.has(t), `${t} must be in COMMAND_BEARING_TOOLS`);
  }
});

// ── site-user routing ─────────────────────────────────────────────────────────

test('resolveSiteUser prefers explicit site user then config then path inference', () => {
  assertEqual(
    resolveSiteUser({ siteUser: 'configured' }, '/var/www/pathowner/public_html', 'explicit'),
    'explicit',
    'explicit site_user wins'
  );
  assertEqual(
    resolveSiteUser({ siteUser: 'configured' }, '/var/www/pathowner/public_html'),
    'configured',
    'siteUser config wins over path inference'
  );
  assertEqual(
    resolveSiteUser({ site_user: 'snake' }, '/var/www/pathowner/public_html'),
    'snake',
    'site_user config is supported'
  );
  assertEqual(
    resolveSiteUser({}, '/var/www/pathowner/public_html'),
    'pathowner',
    'path inference remains a fallback'
  );
});

test('shouldAutoRunAsSiteUser routes non-admin commands under /var/www to site user', () => {
  assertEqual(shouldAutoRunAsSiteUser('whoami', '/var/www/brandonai/public_html'), true, 'generic commands route to site user');
  assertEqual(shouldAutoRunAsSiteUser('php artisan queue:work', '/var/www/brandonai/public_html'), true, 'app commands route to site user');
  assertEqual(shouldAutoRunAsSiteUser('whoami', '/opt/shared/sparkles-tools'), false, 'non-site paths do not auto-route');
});

test('shouldAutoRunAsSiteUser keeps admin commands root-routed', () => {
  for (const command of ['systemctl reload nginx', 'journalctl -u nginx', 'apt update', 'varnishadm status', 'reboot', 'git push origin main']) {
    assertEqual(shouldAutoRunAsSiteUser(command, '/var/www/brandonai/public_html'), false, `${command} stays root-routed`);
  }
});

test('resolveExecutionPlan auto-routes site paths to configured site user', () => {
  const plan = resolveExecutionPlan({
    serverName: 'ai',
    serverConfig: {
      defaultDir: '/var/www/brandonai/public_html',
      siteUser: 'brandonai',
    },
    command: 'touch storage/test',
    runAsMode: 'auto',
  });
  assertEqual(plan.executionUser, 'brandonai', 'auto uses configured site user');
  assertEqual(plan.routingReason, 'auto_inferred_site_user', 'routing reason recorded');
  assertTrue(/sudo -u 'brandonai'/.test(plan.fullCommand), 'command is sudo-wrapped as site user');
});

test('resolveExecutionPlan keeps admin commands root-routed in auto mode', () => {
  const plan = resolveExecutionPlan({
    serverName: 'ai',
    serverConfig: {
      defaultDir: '/var/www/brandonai/public_html',
      siteUser: 'brandonai',
    },
    command: 'systemctl reload php8.5-fpm',
    runAsMode: 'auto',
  });
  assertEqual(plan.executionUser, 'root', 'admin command stays root');
  assertEqual(plan.routingReason, 'auto_root_fallback', 'root fallback reason recorded');
});

test('resolveExecutionPlan keeps git push root-routed in auto mode', () => {
  const plan = resolveExecutionPlan({
    serverName: 'magento',
    serverConfig: {
      defaultDir: '/var/www/sparklesmagento/public_html',
      siteUser: 'sparklesmagento',
    },
    command: 'git push origin main',
    runAsMode: 'auto',
  });
  assertEqual(plan.executionUser, 'root', 'git push uses root-keyed Git access');
  assertEqual(plan.routingReason, 'auto_root_fallback', 'root fallback reason recorded');
});

test('resolveExecutionPlan blocks root app commands unless explicitly overridden', () => {
  let refused = false;
  try {
    resolveExecutionPlan({
      serverName: 'ai',
      serverConfig: {
        defaultDir: '/var/www/brandonai/public_html',
        siteUser: 'brandonai',
      },
      command: 'touch storage/test',
      runAsMode: 'root',
    });
  } catch (error) {
    refused = /Refusing root execution/.test(error.message);
  }
  assertEqual(refused, true, 'root app command is refused without override');

  const plan = resolveExecutionPlan({
    serverName: 'ai',
    serverConfig: {
      defaultDir: '/var/www/brandonai/public_html',
      siteUser: 'brandonai',
    },
    command: 'touch storage/test',
    runAsMode: 'root',
    allowRootAppCommands: true,
  });
  assertEqual(plan.executionUser, 'root', 'override permits root');
});

// ── audit log ──────────────────────────────────────────────────────────────────

test('auditLog is a no-op when AUDIT_LOG is not configured', () => {
  // Should not throw, should not create any file
  auditLog({ name: 's' }, 'ssh_execute', { command: 'ls' }, { allowed: true }, { code: 0, success: true });
  // No assertion needed: success is "didn't throw and didn't create anything"
});

test('auditLog writes JSONL when AUDIT_LOG is configured', () => {
  _resetWarnedPaths();
  const tmpFile = path.join(os.tmpdir(), `ssh-audit-test-${Date.now()}.log`);
  try {
    auditLog(
      { name: 'prod', auditLog: tmpFile },
      'ssh_execute',
      { command: 'ls /tmp' },
      { allowed: true },
      { code: 0, success: true }
    );
    const content = fs.readFileSync(tmpFile, 'utf8').trim();
    const lines = content.split('\n');
    assertEqual(lines.length, 1, 'One audit entry written');
    const entry = JSON.parse(lines[0]);
    assertEqual(entry.server, 'prod', 'server field present');
    assertEqual(entry.tool, 'ssh_execute', 'tool field present');
    assertEqual(entry.allowed, true, 'allowed field present');
    assertEqual(entry.exitCode, 0, 'exitCode field present');
    assertTrue(typeof entry.ts === 'string' && entry.ts.length > 10, 'timestamp present');
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('auditLog redacts secrets in args', () => {
  _resetWarnedPaths();
  const tmpFile = path.join(os.tmpdir(), `ssh-audit-redact-${Date.now()}.log`);
  try {
    auditLog(
      { name: 'prod', auditLog: tmpFile },
      'ssh_execute_sudo',
      { command: 'whoami', password: 's3cret', sudoPassword: 'also-secret', nested: { token: 'tok' } },
      { allowed: true },
      { code: 0, success: true }
    );
    const entry = JSON.parse(fs.readFileSync(tmpFile, 'utf8').trim());
    assertEqual(entry.args.password, '***', 'password redacted');
    assertEqual(entry.args.sudoPassword, '***', 'sudoPassword redacted');
    assertEqual(entry.args.nested.token, '***', 'nested token redacted');
    assertEqual(entry.args.command, 'whoami', 'non-secret fields preserved');
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('auditLog records denials with reason', () => {
  _resetWarnedPaths();
  const tmpFile = path.join(os.tmpdir(), `ssh-audit-deny-${Date.now()}.log`);
  try {
    auditLog(
      { name: 'prod', auditLog: tmpFile },
      'ssh_execute',
      { command: 'rm -rf /' },
      { allowed: false, reason: 'matches DENY pattern /rm /' }
    );
    const entry = JSON.parse(fs.readFileSync(tmpFile, 'utf8').trim());
    assertEqual(entry.allowed, false, 'allowed=false recorded');
    assertTrue(/DENY pattern/.test(entry.reason), 'reason recorded');
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

// ── summary ───────────────────────────────────────────────────────────────────

console.log('\n' + YELLOW + 'Results:' + NC);
console.log(`  ${GREEN}Passed: ${passedTests}${NC}`);
console.log(`  ${RED}Failed: ${failedTests}${NC}\n`);

if (failedTests > 0) {
  process.exit(1);
}
