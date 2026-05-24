import path from 'path';
import crypto from 'crypto';

/**
 * Deploy helper functions for secure file deployment
 */

function shellQuote(value) {
  const quote = String.fromCharCode(39);
  return quote + String(value).replace(/'/g, quote + '\\' + quote + quote) + quote;
}

function assertSafeOwner(owner) {
  if (owner && !/^[A-Za-z_][A-Za-z0-9_-]*[$]?(?::[A-Za-z_][A-Za-z0-9_-]*[$]?)?$/.test(owner)) {
    throw new Error('owner contains unsafe characters');
  }
}

function assertSafePermissions(permissions) {
  if (permissions && !/^[0-7]{3,4}$/.test(String(permissions))) {
    throw new Error('permissions must be an octal mode such as 644 or 0755');
  }
}

function assertSafeServiceName(service) {
  if (service && !/^[A-Za-z0-9_.@:-]+$/.test(service)) {
    throw new Error('restart service name contains unsafe characters');
  }
}

/**
 * Generate a unique temporary filename
 */
export function getTempFilename(originalName) {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);
  return `/tmp/${base}_${timestamp}_${random}${ext}`;
}

/**
 * Build deployment strategy based on target path and permissions
 */
export function buildDeploymentStrategy(remotePath, options = {}) {
  const {
    sudoPassword = null,
    owner = null,
    permissions = null,
    backup = true,
    restart = null
  } = options;

  if (sudoPassword) {
    throw new Error('Password-based sudo is not supported because it exposes secrets in remote command text; configure NOPASSWD sudo or run the deploy as a privileged user.');
  }
  assertSafeOwner(owner);
  assertSafePermissions(permissions);
  assertSafeServiceName(restart);

  const strategy = {
    steps: [],
    requiresSudo: false
  };

  // Step 1: Backup existing file if requested
  if (backup) {
    strategy.steps.push({
      type: 'backup',
      command: `if [ -f ${shellQuote(remotePath)} ]; then cp ${shellQuote(remotePath)} ${shellQuote(`${remotePath}.bak`)}.$(date +%Y%m%d_%H%M%S); fi`
    });
  }

  // Step 2: Determine if we need sudo
  const needsSudo = remotePath.startsWith('/etc/') ||
                    remotePath.startsWith('/var/') ||
                    remotePath.startsWith('/usr/') ||
                    owner || permissions;

  if (needsSudo) {
    strategy.requiresSudo = true;
  }

  // Step 3: Copy from temp to final location
  const copyCmd = needsSudo ?
    `sudo -n cp {{tempFileQuoted}} ${shellQuote(remotePath)}` :
    `cp {{tempFileQuoted}} ${shellQuote(remotePath)}`;

  strategy.steps.push({
    type: 'copy',
    command: copyCmd
  });

  // Step 4: Set ownership if specified
  if (owner) {
    strategy.steps.push({
      type: 'chown',
      command: `sudo -n chown ${shellQuote(owner)} ${shellQuote(remotePath)}`
    });
  }

  // Step 5: Set permissions if specified
  if (permissions) {
    strategy.steps.push({
      type: 'chmod',
      command: `sudo -n chmod ${shellQuote(permissions)} ${shellQuote(remotePath)}`
    });
  }

  // Step 6: Restart service if specified
  if (restart) {
    strategy.steps.push({
      type: 'restart',
      command: `sudo -n systemctl restart ${shellQuote(restart)}`
    });
  }

  // Step 7: Cleanup temp file
  strategy.steps.push({
    type: 'cleanup',
    command: 'rm -f {{tempFileQuoted}}'
  });

  return strategy;
}

/**
 * Parse deployment configuration from file path patterns
 * Examples:
 *   /home/user/app/file.js -> normal deploy
 *   /etc/nginx/sites-available/site -> needs sudo
 *   /var/www/html/index.html -> needs sudo
 */
export function detectDeploymentNeeds(remotePath) {
  const needs = {
    sudo: false,
    suggestedOwner: null,
    suggestedPerms: null
  };

  // System directories that typically need sudo
  if (remotePath.startsWith('/etc/')) {
    needs.sudo = true;
    needs.suggestedOwner = 'root:root';
    needs.suggestedPerms = '644';
  } else if (remotePath.startsWith('/var/www/')) {
    needs.sudo = true;
    needs.suggestedOwner = 'www-data:www-data';
    needs.suggestedPerms = '644';
  } else if (remotePath.includes('/nginx/')) {
    needs.sudo = true;
    needs.suggestedOwner = 'root:root';
    needs.suggestedPerms = '644';
  } else if (remotePath.includes('/apache/') || remotePath.includes('/httpd/')) {
    needs.sudo = true;
    needs.suggestedOwner = 'www-data:www-data';
    needs.suggestedPerms = '644';
  } else if (remotePath.includes('/frappe-bench/')) {
    // For ERPNext/Frappe deployments
    needs.sudo = false;
    needs.suggestedOwner = null; // Will be handled by the app
    needs.suggestedPerms = '644';
  }

  return needs;
}

/**
 * Create batch deployment script for multiple files
 */
export function createBatchDeployScript(deployments) {
  const script = ['#!/bin/bash', 'set -e', ''];

  script.push('# Batch deployment script');
  script.push(`# Generated at ${new Date().toISOString()}`);
  script.push('');

  deployments.forEach((deploy, index) => {
    script.push(`# File ${index + 1}: ${deploy.localPath} -> ${deploy.remotePath}`);
    deploy.strategy.steps.forEach(step => {
      if (step.type !== 'cleanup') {
        script.push(step.command.replace('{{tempFileQuoted}}', shellQuote(deploy.tempFile)));
      }
    });
    script.push('');
  });

  // Cleanup all temp files at the end
  script.push('# Cleanup temporary files');
  deployments.forEach(deploy => {
    script.push(`rm -f ${shellQuote(deploy.tempFile)}`);
  });

  return script.join('\n');
}
