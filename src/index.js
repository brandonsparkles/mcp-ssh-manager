#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { NodeSSH } from 'node-ssh';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getTempFilename,
  buildDeploymentStrategy,
  detectDeploymentNeeds
} from './deploy-helper.js';
import {
  resolveServerName,
  addAlias,
  removeAlias,
  listAliases
} from './server-aliases.js';
import {
  expandCommandAlias,
  addCommandAlias,
  removeCommandAlias,
  listCommandAliases,
  suggestAliases
} from './command-aliases.js';
import {
  initializeHooks,
  executeHook,
  toggleHook,
  listHooks
} from './hooks-system.js';
import {
  loadProfile,
  listProfiles,
  setActiveProfile,
  getActiveProfileName
} from './profile-loader.js';
import { logger } from './logger.js';
import {
  createSession,
  getSession,
  listSessions,
  closeSession,
  SESSION_STATES
} from './session-manager.js';
import {
  getGroup,
  createGroup,
  updateGroup,
  deleteGroup,
  addServersToGroup,
  removeServersFromGroup,
  listGroups,
  executeOnGroup,
  EXECUTION_STRATEGIES
} from './server-groups.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Initialize logger
logger.info('MCP SSH Manager starting', { 
  logLevel: process.env.SSH_LOG_LEVEL || 'INFO',
  verbose: process.env.SSH_VERBOSE === 'true'
});

// Initialize hooks system
initializeHooks().catch(error => {
  logger.error('Failed to initialize hooks', { error: error.message });
});

// Map to store active connections
const connections = new Map();

// Map to store connection timestamps for timeout management
const connectionTimestamps = new Map();

// Connection timeout in milliseconds (30 minutes)
const CONNECTION_TIMEOUT = 30 * 60 * 1000;

// Keepalive interval in milliseconds (5 minutes)
const KEEPALIVE_INTERVAL = 5 * 60 * 1000;

// Map to store keepalive intervals
const keepaliveIntervals = new Map();

// Load server configuration from .env
function loadServerConfig() {
  const servers = {};

  // Parse environment variables to extract servers
  const knownFields = ['HOST', 'USER', 'PASSWORD', 'PORT', 'KEYPATH', 'DEFAULT_DIR', 'DESCRIPTION', 'SUDO_PASSWORD', 'ALIAS'];

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('SSH_SERVER_')) {
      // Remove SSH_SERVER_ prefix
      const remaining = key.substring(11);

      // Find the last known field in the key
      let serverName = null;
      let field = null;

      for (const knownField of knownFields) {
        const idx = remaining.lastIndexOf('_' + knownField);
        if (idx !== -1) {
          serverName = remaining.substring(0, idx).toLowerCase();
          field = knownField.toLowerCase();
          break;
        }
      }

      if (serverName && field) {
        if (!servers[serverName]) {
          servers[serverName] = {};
        }
        servers[serverName][field] = value;
      }
    }
  }

  return servers;
}

// Check if a connection is still valid
async function isConnectionValid(ssh) {
  try {
    // Try to execute a simple command to check if connection is alive
    const result = await ssh.execCommand('echo "ping"', { timeout: 5000 });
    return result.stdout.trim() === 'ping';
  } catch (error) {
    logger.debug('Connection validation failed', { error: error.message });
    return false;
  }
}

// Setup keepalive for a connection
function setupKeepalive(serverName, ssh) {
  // Clear existing keepalive if any
  if (keepaliveIntervals.has(serverName)) {
    clearInterval(keepaliveIntervals.get(serverName));
  }

  // Set up new keepalive interval
  const interval = setInterval(async () => {
    try {
      const isValid = await isConnectionValid(ssh);
      if (!isValid) {
        logger.warn(`Connection to ${serverName} lost, will reconnect on next use`);
        closeConnection(serverName);
      } else {
        // Update timestamp on successful keepalive
        connectionTimestamps.set(serverName, Date.now());
        logger.debug('Keepalive successful', { server: serverName });
      }
    } catch (error) {
      logger.error(`Keepalive failed for ${serverName}`, { error: error.message });
    }
  }, KEEPALIVE_INTERVAL);

  keepaliveIntervals.set(serverName, interval);
}

// Close a connection and clean up
function closeConnection(serverName) {
  const normalizedName = serverName.toLowerCase();

  // Clear keepalive interval
  if (keepaliveIntervals.has(normalizedName)) {
    clearInterval(keepaliveIntervals.get(normalizedName));
    keepaliveIntervals.delete(normalizedName);
  }

  // Close SSH connection
  const ssh = connections.get(normalizedName);
  if (ssh) {
    ssh.dispose();
    connections.delete(normalizedName);
  }

  // Remove timestamp
  connectionTimestamps.delete(normalizedName);

  logger.logConnection(serverName, 'closed');
}

// Clean up old connections
function cleanupOldConnections() {
  const now = Date.now();
  for (const [serverName, timestamp] of connectionTimestamps.entries()) {
    if (now - timestamp > CONNECTION_TIMEOUT) {
      logger.info(`Connection to ${serverName} timed out, closing`, { timeout: CONNECTION_TIMEOUT });
      closeConnection(serverName);
    }
  }
}

// Get or create SSH connection with reconnection support
async function getConnection(serverName) {
  const servers = loadServerConfig();

  // Execute pre-connect hook
  await executeHook('pre-connect', { server: serverName });

  // Try to resolve through aliases first
  const resolvedName = resolveServerName(serverName, servers);

  if (!resolvedName) {
    const availableServers = Object.keys(servers);
    const aliases = listAliases();
    const aliasInfo = aliases.length > 0 ?
      ` Aliases: ${aliases.map(a => `${a.alias}->${a.target}`).join(', ')}` : '';
    throw new Error(
      `Server "${serverName}" not found. Available servers: ${availableServers.join(', ') || 'none'}.${aliasInfo}`
    );
  }

  const normalizedName = resolvedName;

  // Check if we have an existing connection
  if (connections.has(normalizedName)) {
    const existingSSH = connections.get(normalizedName);

    // Verify the connection is still valid
    const isValid = await isConnectionValid(existingSSH);

    if (isValid) {
      // Update timestamp and return existing connection
      connectionTimestamps.set(normalizedName, Date.now());
      return existingSSH;
    } else {
      // Connection is dead, remove it
      logger.info(`Connection to ${serverName} lost, reconnecting`);
      closeConnection(normalizedName);
    }
  }

  // Create new connection
  const serverConfig = servers[normalizedName];
  const ssh = new NodeSSH();

  try {
    const connectionConfig = {
      host: serverConfig.host,
      username: serverConfig.user,
      port: parseInt(serverConfig.port || '22'),
      keepaliveInterval: 60000, // Send keepalive every 60 seconds
      keepaliveCountMax: 10, // Allow 10 keepalive failures before disconnecting
      readyTimeout: 30000, // 30 second timeout for initial connection
    };

    // Use password or SSH key
    if (serverConfig.password) {
      connectionConfig.password = serverConfig.password;
    } else if (serverConfig.keypath) {
      const keyPath = serverConfig.keypath.replace('~', process.env.HOME);
      connectionConfig.privateKey = fs.readFileSync(keyPath, 'utf8');
    }

    await ssh.connect(connectionConfig);
    connections.set(normalizedName, ssh);
    connectionTimestamps.set(normalizedName, Date.now());

    // Setup keepalive
    setupKeepalive(normalizedName, ssh);

    logger.logConnection(serverName, 'established', {
      host: serverConfig.host,
      port: connectionConfig.port,
      method: serverConfig.password ? 'password' : 'key'
    });

    // Execute post-connect hook
    await executeHook('post-connect', { server: serverName });
  } catch (error) {
    logger.logConnection(serverName, 'failed', { error: error.message });
    // Execute error hook
    await executeHook('on-error', { server: serverName, error: error.message });
    throw new Error(`Failed to connect to ${serverName}: ${error.message}`);
  }

  return connections.get(normalizedName);
}

// Create MCP server
const server = new McpServer({
  name: 'mcp-ssh-manager',
  version: '1.2.0',
});

logger.info('MCP Server initialized', { version: '1.2.0' });

// Register available tools
server.registerTool(
  'ssh_execute',
  {
    description: 'Execute command on remote SSH server',
    inputSchema: {
      server: z.string().describe('Server name from configuration'),
      command: z.string().describe('Command to execute'),
      cwd: z.string().optional().describe('Working directory (optional, uses default if configured)')
    }
  },
  async ({ server: serverName, command, cwd }) => {
    try {
      const ssh = await getConnection(serverName);

      // Expand command aliases
      const expandedCommand = expandCommandAlias(command);

      // Execute hooks for bench commands
      if (expandedCommand.includes('bench update')) {
        await executeHook('pre-bench-update', {
          server: serverName,
          sshConnection: ssh,
          defaultDir: cwd
        });
      }

      // Use provided cwd, or default_dir from config, or no cwd
      const servers = loadServerConfig();
      const serverConfig = servers[serverName.toLowerCase()];
      const workingDir = cwd || serverConfig?.default_dir;
      const fullCommand = workingDir ? `cd ${workingDir} && ${expandedCommand}` : expandedCommand;

      // Log command execution
      const startTime = logger.logCommand(serverName, fullCommand, workingDir);

      const result = await ssh.execCommand(fullCommand);
      
      // Log command result
      logger.logCommandResult(serverName, fullCommand, startTime, result);

      // Execute post-hooks for bench commands
      if (expandedCommand.includes('bench update') && result.code === 0) {
        await executeHook('post-bench-update', {
          server: serverName,
          sshConnection: ssh,
          defaultDir: cwd
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              server: serverName,
              command: fullCommand,
              stdout: result.stdout,
              stderr: result.stderr,
              code: result.code,
              success: result.code === 0,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Error: ${error.message}`,
          },
        ],
      };
    }
  }
);

server.registerTool(
  'ssh_upload',
  {
    description: 'Upload file to remote SSH server',
    inputSchema: {
      server: z.string().describe('Server name'),
      localPath: z.string().describe('Local file path'),
      remotePath: z.string().describe('Remote destination path')
    }
  },
  async ({ server: serverName, localPath, remotePath }) => {
    try {
      const ssh = await getConnection(serverName);
      
      logger.logTransfer('upload', serverName, localPath, remotePath);
      const startTime = Date.now();
      
      await ssh.putFile(localPath, remotePath);
      
      const fileStats = fs.statSync(localPath);
      logger.logTransfer('upload', serverName, localPath, remotePath, {
        success: true,
        size: fileStats.size,
        duration: `${Date.now() - startTime}ms`
      });

      return {
        content: [
          {
            type: 'text',
            text: `✅ File uploaded successfully\nServer: ${serverName}\nLocal: ${localPath}\nRemote: ${remotePath}`,
          },
        ],
      };
    } catch (error) {
      logger.logTransfer('upload', serverName, localPath, remotePath, {
        success: false,
        error: error.message
      });
      return {
        content: [
          {
            type: 'text',
            text: `❌ Upload error: ${error.message}`,
          },
        ],
      };
    }
  }
);

server.registerTool(
  'ssh_download',
  {
    description: 'Download file from remote SSH server',
    inputSchema: {
      server: z.string().describe('Server name'),
      remotePath: z.string().describe('Remote file path'),
      localPath: z.string().describe('Local destination path')
    }
  },
  async ({ server: serverName, remotePath, localPath }) => {
    try {
      const ssh = await getConnection(serverName);
      
      logger.logTransfer('download', serverName, remotePath, localPath);
      const startTime = Date.now();
      
      await ssh.getFile(localPath, remotePath);
      
      const fileStats = fs.statSync(localPath);
      logger.logTransfer('download', serverName, remotePath, localPath, {
        success: true,
        size: fileStats.size,
        duration: `${Date.now() - startTime}ms`
      });

      return {
        content: [
          {
            type: 'text',
            text: `✅ File downloaded successfully\nServer: ${serverName}\nRemote: ${remotePath}\nLocal: ${localPath}`,
          },
        ],
      };
    } catch (error) {
      logger.logTransfer('download', serverName, remotePath, localPath, {
        success: false,
        error: error.message
      });
      return {
        content: [
          {
            type: 'text',
            text: `❌ Download error: ${error.message}`,
          },
        ],
      };
    }
  }
);

server.registerTool(
  'ssh_sync',
  {
    description: 'Synchronize files/folders between local and remote via rsync',
    inputSchema: {
      server: z.string().describe('Server name from configuration'),
      source: z.string().describe('Source path (use "local:" or "remote:" prefix)'),
      destination: z.string().describe('Destination path (use "local:" or "remote:" prefix)'),
      exclude: z.array(z.string()).optional().describe('Patterns to exclude from sync'),
      dryRun: z.boolean().optional().describe('Perform dry run without actual changes'),
      delete: z.boolean().optional().describe('Delete files in destination not in source'),
      compress: z.boolean().optional().describe('Compress during transfer'),
      verbose: z.boolean().optional().describe('Show detailed progress'),
      checksum: z.boolean().optional().describe('Use checksum instead of timestamp for comparison')
    }
  },
  async ({ server: serverName, source, destination, exclude = [], dryRun = false, delete: deleteFiles = false, compress = true, verbose = false, checksum = false }) => {
    try {
      const ssh = await getConnection(serverName);
      const servers = loadServerConfig();
      const serverConfig = servers[serverName.toLowerCase()];
      
      // Determine sync direction based on source/destination prefixes
      const isLocalSource = source.startsWith('local:');
      const isRemoteSource = source.startsWith('remote:');
      const isLocalDest = destination.startsWith('local:');
      const isRemoteDest = destination.startsWith('remote:');
      
      // Clean paths
      const cleanSource = source.replace(/^(local:|remote:)/, '');
      const cleanDest = destination.replace(/^(local:|remote:)/, '');
      
      // Validate direction
      if ((isLocalSource && isLocalDest) || (isRemoteSource && isRemoteDest)) {
        throw new Error('Source and destination must be different (one local, one remote). Use prefixes: local: or remote:');
      }
      
      // If no prefixes, assume old format (local source to remote dest)
      const direction = (isLocalSource || (!isLocalSource && !isRemoteSource)) ? 'push' : 'pull';
      
      // Build rsync command
      let rsyncOptions = ['-avz'];
      
      if (!compress) {
        rsyncOptions = ['-av'];
      }
      
      if (checksum) {
        rsyncOptions.push('--checksum');
      }
      
      if (deleteFiles) {
        rsyncOptions.push('--delete');
      }
      
      if (dryRun) {
        rsyncOptions.push('--dry-run');
      }
      
      if (verbose || logger.verbose) {
        rsyncOptions.push('--progress', '--stats');
      }
      
      // Add exclude patterns
      exclude.forEach(pattern => {
        rsyncOptions.push('--exclude', pattern);
      });
      
      let command;
      let localPath;
      let remotePath;
      
      if (direction === 'push') {
        localPath = cleanSource;
        remotePath = cleanDest;
        
        // Check if local path exists
        if (!fs.existsSync(localPath)) {
          throw new Error(`Local path does not exist: ${localPath}`);
        }
        
        // Build rsync command for push
        command = `rsync ${rsyncOptions.join(' ')} "${localPath}" "${serverConfig.user}@${serverConfig.host}:${remotePath}"`;
      } else {
        localPath = cleanDest;
        remotePath = cleanSource;
        
        // Build rsync command for pull
        command = `rsync ${rsyncOptions.join(' ')} "${serverConfig.user}@${serverConfig.host}:${remotePath}" "${localPath}"`;
      }
      
      // Add SSH options if using non-standard port or key
      const sshOptions = [];
      if (serverConfig.port && serverConfig.port !== '22') {
        sshOptions.push(`-p ${serverConfig.port}`);
      }
      if (serverConfig.keypath) {
        const keyPath = serverConfig.keypath.replace('~', process.env.HOME);
        sshOptions.push(`-i ${keyPath}`);
      }
      
      if (sshOptions.length > 0) {
        command = command.replace('rsync ', `rsync -e "ssh ${sshOptions.join(' ')}" `);
      }
      
      logger.info(`Starting rsync ${direction}`, {
        server: serverName,
        source: direction === 'push' ? localPath : remotePath,
        destination: direction === 'push' ? remotePath : localPath,
        dryRun,
        deleteFiles
      });
      
      const startTime = Date.now();
      
      // Execute rsync via local shell (not SSH)
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      try {
        const { stdout, stderr } = await execAsync(command, {
          maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large outputs
        });
        
        const duration = Date.now() - startTime;
        
        // Parse rsync output for statistics
        let stats = {
          filesTransferred: 0,
          totalSize: 0,
          totalTime: duration
        };
        
        // Extract statistics from rsync output
        const filesMatch = stdout.match(/Number of files transferred: (\d+)/);
        const sizeMatch = stdout.match(/Total transferred file size: ([\d,]+) bytes/);
        const speedMatch = stdout.match(/([\d.]+) bytes\/sec/);
        
        if (filesMatch) stats.filesTransferred = parseInt(filesMatch[1]);
        if (sizeMatch) stats.totalSize = parseInt(sizeMatch[1].replace(/,/g, ''));
        if (speedMatch) stats.speed = parseFloat(speedMatch[1]);
        
        logger.info(`Rsync ${direction} completed`, {
          server: serverName,
          direction,
          duration: `${duration}ms`,
          filesTransferred: stats.filesTransferred,
          totalSize: stats.totalSize,
          dryRun
        });
        
        // Format output
        let resultText = dryRun ? '🔍 Dry run completed\n' : '✅ Sync completed successfully\n';
        resultText += `Direction: ${direction === 'push' ? 'Local → Remote' : 'Remote → Local'}\n`;
        resultText += `Server: ${serverName}\n`;
        resultText += `Source: ${direction === 'push' ? localPath : remotePath}\n`;
        resultText += `Destination: ${direction === 'push' ? remotePath : localPath}\n`;
        
        if (stats.filesTransferred > 0) {
          resultText += `Files transferred: ${stats.filesTransferred}\n`;
          if (stats.totalSize > 0) {
            const sizeKB = (stats.totalSize / 1024).toFixed(2);
            resultText += `Total size: ${sizeKB} KB\n`;
          }
          if (stats.speed) {
            const speedKB = (stats.speed / 1024).toFixed(2);
            resultText += `Average speed: ${speedKB} KB/s\n`;
          }
        } else {
          resultText += 'No files needed to be transferred\n';
        }
        
        resultText += `Time: ${(duration / 1000).toFixed(2)} seconds\n`;
        
        if (verbose || dryRun) {
          resultText += '\n📋 Detailed output:\n' + stdout;
          if (stderr && stderr.trim()) {
            resultText += '\n⚠️ Warnings:\n' + stderr;
          }
        }
        
        return {
          content: [
            {
              type: 'text',
              text: resultText
            }
          ]
        };
      } catch (execError) {
        logger.error(`Rsync ${direction} failed`, {
          server: serverName,
          error: execError.message,
          stdout: execError.stdout,
          stderr: execError.stderr
        });
        
        throw new Error(`Rsync failed: ${execError.stderr || execError.message}`);
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Sync error: ${error.message}`
          }
        ]
      };
    }
  }
);

server.registerTool(
  'ssh_tail',
  {
    description: 'Tail remote log files in real-time',
    inputSchema: {
      server: z.string().describe('Server name from configuration'),
      file: z.string().describe('Path to the log file to tail'),
      lines: z.number().optional().describe('Number of lines to show initially (default: 10)'),
      follow: z.boolean().optional().describe('Follow file for new content (default: true)'),
      grep: z.string().optional().describe('Filter lines with grep pattern')
    }
  },
  async ({ server: serverName, file, lines = 10, follow = true, grep }) => {
    try {
      const ssh = await getConnection(serverName);
      
      // Build tail command
      let command = `tail -n ${lines}`;
      if (follow) {
        command += ' -f';
      }
      command += ` "${file}"`;
      
      // Add grep filter if specified
      if (grep) {
        command += ` | grep "${grep}"`;
      }
      
      logger.info(`Starting tail on ${serverName}`, {
        file,
        lines,
        follow,
        grep
      });
      
      // For follow mode, we need to handle streaming
      if (follow) {
        // Create a unique session ID for this tail
        const sessionId = `tail_${Date.now()}`;
        
        // Store the SSH stream for later cleanup
        const stream = await ssh.execCommand(command, {
          onStdout: (chunk) => {
            // In a real implementation, this would stream to the client
            console.error(`[${serverName}:${file}] ${chunk.toString()}`);
          },
          onStderr: (chunk) => {
            console.error(`[ERROR] ${chunk.toString()}`);
          },
          timeout: 0 // No timeout for tail -f
        });
        
        return {
          content: [
            {
              type: 'text',
              text: `📜 Tailing ${file} on ${serverName}\nSession ID: ${sessionId}\nShowing last ${lines} lines${grep ? ` (filtered: ${grep})` : ''}\n\n⚠️ Note: In follow mode, output is streamed to stderr.\nTo stop tailing, you'll need to kill the session.`
            }
          ]
        };
      } else {
        // Non-follow mode - just get the output
        const result = await ssh.execCommand(command);
        
        if (result.code !== 0) {
          throw new Error(result.stderr || 'Failed to tail file');
        }
        
        logger.info(`Tail completed on ${serverName}`, {
          file,
          lines: result.stdout.split('\n').length
        });
        
        return {
          content: [
            {
              type: 'text',
              text: `📜 Last ${lines} lines of ${file} on ${serverName}${grep ? ` (filtered: ${grep})` : ''}:\n\n${result.stdout}`
            }
          ]
        };
      }
    } catch (error) {
      logger.error(`Tail failed on ${serverName}`, {
        file,
        error: error.message
      });
      
      return {
        content: [
          {
            type: 'text',
            text: `❌ Tail error: ${error.message}`
          }
        ]
      };
    }
  }
);

server.registerTool(
  'ssh_monitor',
  {
    description: 'Monitor system resources (CPU, RAM, disk) on remote server',
    inputSchema: {
      server: z.string().describe('Server name from configuration'),
      type: z.enum(['overview', 'cpu', 'memory', 'disk', 'network', 'process']).optional().describe('Type of monitoring (default: overview)'),
      interval: z.number().optional().describe('Update interval in seconds for continuous monitoring'),
      duration: z.number().optional().describe('Duration in seconds for continuous monitoring')
    }
  },
  async ({ server: serverName, type = 'overview', interval, duration }) => {
    try {
      const ssh = await getConnection(serverName);
      
      logger.info(`Starting system monitoring on ${serverName}`, {
        type,
        interval,
        duration
      });
      
      let commands = {};
      let output = {};
      
      // Define monitoring commands based on type
      switch (type) {
        case 'cpu':
          commands.cpu = "top -bn1 | head -20";
          commands.load = "uptime";
          commands.cores = "nproc";
          break;
          
        case 'memory':
          commands.memory = "free -h";
          commands.swap = "swapon --show";
          commands.top_mem = "ps aux --sort=-%mem | head -10";
          break;
          
        case 'disk':
          commands.disk = "df -h";
          commands.inodes = "df -i";
          commands.io = "iostat -x 1 2 | tail -n +4";
          break;
          
        case 'network':
          commands.interfaces = "ip -s link show";
          commands.connections = "ss -tunap | head -20";
          commands.netstat = "netstat -i";
          break;
          
        case 'process':
          commands.process = "ps aux --sort=-%cpu | head -20";
          commands.count = "ps aux | wc -l";
          commands.zombies = "ps aux | grep -c defunct || echo 0";
          break;
          
        case 'overview':
        default:
          commands.uptime = "uptime";
          commands.cpu = "mpstat 1 1 2>/dev/null || top -bn1 | grep 'Cpu'";
          commands.memory = "free -h";
          commands.disk = "df -h | grep -E '^/dev/' | head -5";
          commands.load = "cat /proc/loadavg";
          commands.processes = "ps aux | wc -l";
          break;
      }
      
      // Execute all monitoring commands
      const startTime = Date.now();
      
      for (const [key, cmd] of Object.entries(commands)) {
        try {
          const result = await ssh.execCommand(cmd);
          if (result.code === 0) {
            output[key] = result.stdout.trim();
          } else {
            output[key] = `Error: ${result.stderr || 'Command failed'}`;
          }
        } catch (err) {
          output[key] = `Error: ${err.message}`;
        }
      }
      
      const monitoringDuration = Date.now() - startTime;
      
      // Format the output based on type
      let formattedOutput = `📊 System Monitor - ${serverName}\n`;
      formattedOutput += `Type: ${type} | Time: ${new Date().toISOString()}\n`;
      formattedOutput += `Collection time: ${monitoringDuration}ms\n`;
      formattedOutput += '━'.repeat(50) + '\n\n';
      
      switch (type) {
        case 'overview':
          formattedOutput += `⏱️ UPTIME\n${output.uptime || 'N/A'}\n\n`;
          formattedOutput += `💻 CPU\n${output.cpu || 'N/A'}\n\n`;
          formattedOutput += `📈 LOAD AVERAGE\n${output.load || 'N/A'}\n\n`;
          formattedOutput += `💾 MEMORY\n${output.memory || 'N/A'}\n\n`;
          formattedOutput += `💿 DISK USAGE\n${output.disk || 'N/A'}\n\n`;
          formattedOutput += `📝 PROCESSES: ${output.processes || 'N/A'}\n`;
          break;
          
        case 'cpu':
          formattedOutput += `🖥️ CPU CORES: ${output.cores || 'N/A'}\n\n`;
          formattedOutput += `📊 LOAD\n${output.load || 'N/A'}\n\n`;
          formattedOutput += `📈 TOP PROCESSES\n${output.cpu || 'N/A'}\n`;
          break;
          
        case 'memory':
          formattedOutput += `💾 MEMORY USAGE\n${output.memory || 'N/A'}\n\n`;
          formattedOutput += `🔄 SWAP\n${output.swap || 'No swap configured'}\n\n`;
          formattedOutput += `📊 TOP MEMORY CONSUMERS\n${output.top_mem || 'N/A'}\n`;
          break;
          
        case 'disk':
          formattedOutput += `💿 DISK SPACE\n${output.disk || 'N/A'}\n\n`;
          formattedOutput += `📁 INODE USAGE\n${output.inodes || 'N/A'}\n\n`;
          formattedOutput += `⚡ I/O STATS\n${output.io || 'N/A'}\n`;
          break;
          
        case 'network':
          formattedOutput += `🌐 NETWORK INTERFACES\n${output.interfaces || 'N/A'}\n\n`;
          formattedOutput += `🔌 CONNECTIONS\n${output.connections || 'N/A'}\n\n`;
          formattedOutput += `📊 INTERFACE STATS\n${output.netstat || 'N/A'}\n`;
          break;
          
        case 'process':
          formattedOutput += `📝 PROCESS COUNT: ${output.count || 'N/A'}\n`;
          formattedOutput += `⚠️ ZOMBIE PROCESSES: ${output.zombies || '0'}\n\n`;
          formattedOutput += `📊 TOP PROCESSES BY CPU\n${output.process || 'N/A'}\n`;
          break;
      }
      
      // Log monitoring results
      logger.info(`System monitoring completed on ${serverName}`, {
        type,
        duration: `${monitoringDuration}ms`,
        metrics: Object.keys(output).length
      });
      
      // If continuous monitoring requested
      if (interval && duration) {
        formattedOutput += `\n\n⏰ Continuous monitoring: Every ${interval}s for ${duration}s\n`;
        formattedOutput += `(Not implemented in this version - would require streaming support)`;
      }
      
      return {
        content: [
          {
            type: 'text',
            text: formattedOutput
          }
        ]
      };
    } catch (error) {
      logger.error(`Monitoring failed on ${serverName}`, {
        type,
        error: error.message
      });
      
      return {
        content: [
          {
            type: 'text',
            text: `❌ Monitor error: ${error.message}`
          }
        ]
      };
    }
  }
);

server.registerTool(
  'ssh_history',
  {
    description: 'View SSH command history',
    inputSchema: {
      limit: z.number().optional().describe('Number of commands to show (default: 20)'),
      server: z.string().optional().describe('Filter by server name'),
      success: z.boolean().optional().describe('Filter by success/failure'),
      search: z.string().optional().describe('Search in commands')
    }
  },
  async ({ limit = 20, server, success, search }) => {
    try {
      // Get history from logger
      let history = logger.getHistory(limit * 2); // Get more to account for filtering
      
      // Apply filters
      if (server) {
        history = history.filter(h => h.server?.toLowerCase().includes(server.toLowerCase()));
      }
      
      if (success !== undefined) {
        history = history.filter(h => h.success === success);
      }
      
      if (search) {
        history = history.filter(h => h.command?.toLowerCase().includes(search.toLowerCase()));
      }
      
      // Limit results
      history = history.slice(-limit);
      
      // Format output
      let output = `📜 SSH Command History\n`;
      output += `Showing last ${history.length} commands`;
      
      const filters = [];
      if (server) filters.push(`server: ${server}`);
      if (success !== undefined) filters.push(success ? 'successful only' : 'failed only');
      if (search) filters.push(`search: ${search}`);
      
      if (filters.length > 0) {
        output += ` (filtered: ${filters.join(', ')})`;
      }
      
      output += '\n' + '━'.repeat(60) + '\n\n';
      
      if (history.length === 0) {
        output += 'No commands found matching the criteria.\n';
      } else {
        history.forEach((entry, index) => {
          const time = new Date(entry.timestamp).toLocaleString();
          const status = entry.success ? '✅' : '❌';
          const duration = entry.duration || 'N/A';
          
          output += `${history.length - index}. ${status} [${time}]\n`;
          output += `   Server: ${entry.server || 'unknown'}\n`;
          output += `   Command: ${entry.command?.substring(0, 100) || 'N/A'}`;
          if (entry.command && entry.command.length > 100) {
            output += '...';
          }
          output += '\n';
          output += `   Duration: ${duration}`;
          
          if (!entry.success && entry.error) {
            output += `\n   Error: ${entry.error}`;
          }
          
          output += '\n\n';
        });
      }
      
      output += '━'.repeat(60) + '\n';
      output += `Total commands in history: ${logger.getHistory(1000).length}\n`;
      
      logger.info('Command history retrieved', {
        limit,
        filters: filters.length,
        results: history.length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: output
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Error retrieving history: ${error.message}`
          }
        ]
      };
    }
  }
);

// SSH Session Management Tools

server.registerTool(
  'ssh_session_start',
  {
    description: 'Start a persistent SSH session that maintains state and context',
    inputSchema: {
      server: z.string().describe('Server name from configuration'),
      name: z.string().optional().describe('Optional session name for identification')
    }
  },
  async ({ server: serverName, name }) => {
    try {
      const ssh = await getConnection(serverName);
      const session = await createSession(serverName, ssh);
      
      const sessionName = name || `Session on ${serverName}`;
      
      logger.info('SSH session started', {
        id: session.id,
        server: serverName,
        name: sessionName
      });
      
      return {
        content: [
          {
            type: 'text',
            text: `🚀 SSH Session Started\n\nSession ID: ${session.id}\nServer: ${serverName}\nName: ${sessionName}\nState: ${session.state}\nWorking Directory: ${session.context.cwd}\n\nUse ssh_session_send to execute commands in this session.\nUse ssh_session_close to terminate the session.`
          }
        ]
      };
    } catch (error) {
      logger.error('Failed to start SSH session', {
        server: serverName,
        error: error.message
      });
      
      return {
        content: [
          {
            type: 'text',
            text: `❌ Failed to start session: ${error.message}`
          }
        ]
      };
    }
  }
);

server.registerTool(
  'ssh_session_send',
  {
    description: 'Send a command to an existing SSH session',
    inputSchema: {
      session: z.string().describe('Session ID from ssh_session_start'),
      command: z.string().describe('Command to execute in the session'),
      timeout: z.number().optional().describe('Command timeout in milliseconds (default: 30000)')
    }
  },
  async ({ session: sessionId, command, timeout = 30000 }) => {
    try {
      const session = getSession(sessionId);
      
      const startTime = Date.now();
      const result = await session.execute(command, { timeout });
      const duration = Date.now() - startTime;
      
      logger.info('Session command executed', {
        session: sessionId,
        command: command.substring(0, 50),
        success: result.success,
        duration: `${duration}ms`
      });
      
      let output = `📟 Session: ${sessionId}\n`;
      output += `Server: ${session.serverName}\n`;
      output += `Working Directory: ${session.context.cwd}\n`;
      output += `Command: ${command}\n`;
      output += `Duration: ${duration}ms\n`;
      output += '━'.repeat(60) + '\n\n';
      
      if (result.success) {
        output += '✅ Output:\n' + result.output;
      } else {
        output += '❌ Error:\n' + (result.error || result.output);
      }
      
      // Add session state info
      output += '\n\n' + '━'.repeat(60) + '\n';
      output += `Session State: ${session.state}\n`;
      output += `Commands Executed: ${session.context.history.length}\n`;
      
      return {
        content: [
          {
            type: 'text',
            text: output
          }
        ]
      };
    } catch (error) {
      logger.error('Failed to send command to session', {
        session: sessionId,
        command,
        error: error.message
      });
      
      return {
        content: [
          {
            type: 'text',
            text: `❌ Session error: ${error.message}`
          }
        ]
      };
    }
  }
);

server.registerTool(
  'ssh_session_list',
  {
    description: 'List all active SSH sessions',
    inputSchema: {
      server: z.string().optional().describe('Filter by server name')
    }
  },
  async ({ server }) => {
    try {
      let sessions = listSessions();
      
      // Filter by server if specified
      if (server) {
        sessions = sessions.filter(s => 
          s.server.toLowerCase().includes(server.toLowerCase())
        );
      }
      
      let output = `📋 Active SSH Sessions\n`;
      output += '━'.repeat(60) + '\n\n';
      
      if (sessions.length === 0) {
        output += 'No active sessions';
        if (server) {
          output += ` for server "${server}"`;
        }
        output += '.\n';
      } else {
        sessions.forEach((session, index) => {
          const age = Math.floor((Date.now() - new Date(session.created).getTime()) / 1000);
          const idle = Math.floor((Date.now() - new Date(session.lastActivity).getTime()) / 1000);
          
          output += `${index + 1}. Session: ${session.id}\n`;
          output += `   Server: ${session.server}\n`;
          output += `   State: ${session.state}\n`;
          output += `   Working Dir: ${session.cwd || 'unknown'}\n`;
          output += `   Commands Run: ${session.historyCount}\n`;
          output += `   Age: ${formatDuration(age)}\n`;
          output += `   Idle: ${formatDuration(idle)}\n`;
          
          if (session.variables.length > 0) {
            output += `   Variables: ${session.variables.join(', ')}\n`;
          }
          
          output += '\n';
        });
      }
      
      output += '━'.repeat(60) + '\n';
      output += `Total Active Sessions: ${sessions.length}\n`;
      
      logger.info('Listed SSH sessions', {
        total: sessions.length,
        filter: server
      });
      
      return {
        content: [
          {
            type: 'text',
            text: output
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Error listing sessions: ${error.message}`
          }
        ]
      };
    }
  }
);

server.registerTool(
  'ssh_session_close',
  {
    description: 'Close an SSH session',
    inputSchema: {
      session: z.string().describe('Session ID to close (or "all" to close all sessions)')
    }
  },
  async ({ session: sessionId }) => {
    try {
      if (sessionId === 'all') {
        const sessions = listSessions();
        const count = sessions.length;
        
        sessions.forEach(s => {
          try {
            closeSession(s.id);
          } catch (err) {
            // Ignore individual close errors
          }
        });
        
        logger.info('Closed all SSH sessions', { count });
        
        return {
          content: [
            {
              type: 'text',
              text: `🔚 Closed ${count} SSH sessions`
            }
          ]
        };
      } else {
        closeSession(sessionId);
        
        logger.info('SSH session closed', { session: sessionId });
        
        return {
          content: [
            {
              type: 'text',
              text: `🔚 Session closed: ${sessionId}`
            }
          ]
        };
      }
    } catch (error) {
      logger.error('Failed to close session', {
        session: sessionId,
        error: error.message
      });
      
      return {
        content: [
          {
            type: 'text',
            text: `❌ Failed to close session: ${error.message}`
          }
        ]
      };
    }
  }
);

// Helper function to format duration
function formatDuration(seconds) {
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  } else {
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }
}

// Server Group Management Tools

server.registerTool(
  'ssh_execute_group',
  {
    description: 'Execute command on a group of servers',
    inputSchema: {
      group: z.string().describe('Group name (e.g., "production", "staging", "all")'),
      command: z.string().describe('Command to execute'),
      strategy: z.enum(['parallel', 'sequential', 'rolling']).optional().describe('Execution strategy'),
      delay: z.number().optional().describe('Delay between servers in ms (for rolling)'),
      stopOnError: z.boolean().optional().describe('Stop execution on first error'),
      cwd: z.string().optional().describe('Working directory')
    }
  },
  async ({ group: groupName, command, strategy, delay, stopOnError, cwd }) => {
    try {
      // Execute command on each server in the group
      const result = await executeOnGroup(
        groupName,
        async (serverName) => {
          const ssh = await getConnection(serverName);
          
          // Build full command with cwd if provided
          const servers = loadServerConfig();
          const serverConfig = servers[serverName.toLowerCase()];
          const workingDir = cwd || serverConfig?.default_dir;
          const fullCommand = workingDir ? `cd ${workingDir} && ${command}` : command;
          
          const execResult = await ssh.execCommand(fullCommand);
          
          return {
            stdout: execResult.stdout,
            stderr: execResult.stderr,
            code: execResult.code,
            success: execResult.code === 0
          };
        },
        { strategy, delay, stopOnError }
      );
      
      // Format output
      let output = `🚀 Group Execution: ${groupName}\n`;
      output += `Command: ${command}\n`;
      output += `Strategy: ${result.strategy}\n`;
      output += '━'.repeat(60) + '\n\n';
      
      // Show results for each server
      result.results.forEach(({ server, success, result: execResult, error }) => {
        output += `📍 ${server}: ${success ? '✅ SUCCESS' : '❌ FAILED'}\n`;
        
        if (success && execResult) {
          if (execResult.stdout) {
            output += `   Output: ${execResult.stdout.substring(0, 200)}`;
            if (execResult.stdout.length > 200) output += '...';
            output += '\n';
          }
          if (execResult.stderr) {
            output += `   Stderr: ${execResult.stderr.substring(0, 100)}\n`;
          }
        } else if (error) {
          output += `   Error: ${error}\n`;
        }
        output += '\n';
      });
      
      // Summary
      output += '━'.repeat(60) + '\n';
      output += `Summary: ${result.summary.successful}/${result.summary.total} successful`;
      if (result.summary.failed > 0) {
        output += ` (${result.summary.failed} failed)`;
      }
      output += '\n';
      
      logger.info('Group command executed', {
        group: groupName,
        command: command.substring(0, 50),
        ...result.summary
      });
      
      return {
        content: [
          {
            type: 'text',
            text: output
          }
        ]
      };
    } catch (error) {
      logger.error('Group execution failed', {
        group: groupName,
        error: error.message
      });
      
      return {
        content: [
          {
            type: 'text',
            text: `❌ Group execution error: ${error.message}`
          }
        ]
      };
    }
  }
);

server.registerTool(
  'ssh_group_manage',
  {
    description: 'Manage server groups (create, update, delete, list)',
    inputSchema: {
      action: z.enum(['create', 'update', 'delete', 'list', 'add-servers', 'remove-servers']).describe('Action to perform'),
      name: z.string().optional().describe('Group name'),
      servers: z.array(z.string()).optional().describe('Server names'),
      description: z.string().optional().describe('Group description'),
      strategy: z.enum(['parallel', 'sequential', 'rolling']).optional().describe('Execution strategy'),
      delay: z.number().optional().describe('Delay between servers in ms'),
      stopOnError: z.boolean().optional().describe('Stop on error flag')
    }
  },
  async ({ action, name, servers, description, strategy, delay, stopOnError }) => {
    try {
      let result;
      let output = '';
      
      switch (action) {
        case 'create':
          if (!name) throw new Error('Group name required for create');
          result = createGroup(name, servers || [], {
            description,
            strategy,
            delay,
            stopOnError
          });
          output = `✅ Group '${name}' created\n`;
          output += `Servers: ${result.servers.join(', ') || 'none'}\n`;
          output += `Strategy: ${result.strategy}\n`;
          break;
          
        case 'update':
          if (!name) throw new Error('Group name required for update');
          result = updateGroup(name, {
            servers,
            description,
            strategy,
            delay,
            stopOnError
          });
          output = `✅ Group '${name}' updated\n`;
          output += `Servers: ${result.servers.join(', ')}\n`;
          break;
          
        case 'delete':
          if (!name) throw new Error('Group name required for delete');
          deleteGroup(name);
          output = `✅ Group '${name}' deleted`;
          break;
          
        case 'add-servers':
          if (!name) throw new Error('Group name required');
          if (!servers || servers.length === 0) throw new Error('Servers required');
          result = addServersToGroup(name, servers);
          output = `✅ Added ${servers.length} servers to '${name}'\n`;
          output += `Total servers: ${result.servers.length}\n`;
          output += `Members: ${result.servers.join(', ')}`;
          break;
          
        case 'remove-servers':
          if (!name) throw new Error('Group name required');
          if (!servers || servers.length === 0) throw new Error('Servers required');
          result = removeServersFromGroup(name, servers);
          output = `✅ Removed ${servers.length} servers from '${name}'\n`;
          output += `Remaining: ${result.servers.length}\n`;
          output += `Members: ${result.servers.join(', ') || 'none'}`;
          break;
          
        case 'list':
          const groups = listGroups();
          output = `📋 Server Groups\n`;
          output += '━'.repeat(60) + '\n\n';
          
          groups.forEach(group => {
            output += `📁 ${group.name}`;
            if (group.dynamic) output += ' (dynamic)';
            output += '\n';
            output += `   Description: ${group.description}\n`;
            output += `   Servers: ${group.serverCount} servers\n`;
            if (group.servers.length > 0) {
              output += `   Members: ${group.servers.slice(0, 5).join(', ')}`;
              if (group.servers.length > 5) output += ` ... +${group.servers.length - 5} more`;
              output += '\n';
            }
            output += `   Strategy: ${group.strategy || 'parallel'}\n`;
            if (group.delay) output += `   Delay: ${group.delay}ms\n`;
            if (group.stopOnError) output += `   Stop on error: yes\n`;
            output += '\n';
          });
          
          output += '━'.repeat(60) + '\n';
          output += `Total groups: ${groups.length}`;
          break;
          
        default:
          throw new Error(`Unknown action: ${action}`);
      }
      
      logger.info('Group management action completed', {
        action,
        name,
        servers: servers?.length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: output
          }
        ]
      };
    } catch (error) {
      logger.error('Group management failed', {
        action,
        name,
        error: error.message
      });
      
      return {
        content: [
          {
            type: 'text',
            text: `❌ Group management error: ${error.message}`
          }
        ]
      };
    }
  }
);

server.registerTool(
  'ssh_list_servers',
  {
    description: 'List all configured SSH servers',
    inputSchema: {}
  },
  async () => {
    const servers = loadServerConfig();
    const serverInfo = Object.entries(servers).map(([name, config]) => ({
      name,
      host: config.host,
      user: config.user,
      port: config.port || '22',
      auth: config.password ? 'password' : 'key',
      defaultDir: config.default_dir || '',
      description: config.description || ''
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(serverInfo, null, 2),
        },
      ],
    };
  }
);

// New deploy tool for automated deployment
server.registerTool(
  'ssh_deploy',
  {
    description: 'Deploy files to remote server with automatic permission handling',
    inputSchema: {
      server: z.string().describe('Server name or alias'),
      files: z.array(z.object({
        local: z.string().describe('Local file path'),
        remote: z.string().describe('Remote file path')
      })).describe('Array of files to deploy'),
      options: z.object({
        owner: z.string().optional().describe('Set file owner (e.g., "user:group")'),
        permissions: z.string().optional().describe('Set file permissions (e.g., "644")'),
        backup: z.boolean().optional().default(true).describe('Backup existing files'),
        restart: z.string().optional().describe('Service to restart after deployment'),
        sudoPassword: z.string().optional().describe('Sudo password if needed (use with caution)')
      }).optional().describe('Deployment options')
    }
  },
  async ({ server, files, options = {} }) => {
    try {
      const ssh = await getConnection(server);

      // Execute pre-deploy hook
      await executeHook('pre-deploy', {
        server: server,
        files: files.map(f => f.local).join(', ')
      });

      const deployments = [];
      const results = [];

      // Prepare deployment for each file
      for (const file of files) {
        const tempFile = getTempFilename(path.basename(file.local));
        const needs = detectDeploymentNeeds(file.remote);

        // Merge detected needs with user options
        const deployOptions = {
          ...options,
          owner: options.owner || needs.suggestedOwner,
          permissions: options.permissions || needs.suggestedPerms
        };

        const strategy = buildDeploymentStrategy(file.remote, deployOptions);

        // Upload file to temp location first
        await ssh.putFile(file.local, tempFile);
        results.push(`✅ Uploaded ${path.basename(file.local)} to temp location`);

        // Execute deployment strategy
        for (const step of strategy.steps) {
          const command = step.command.replace('{{tempFile}}', tempFile);

          const result = await ssh.execCommand(command);

          if (result.code !== 0 && step.type !== 'backup') {
            throw new Error(`${step.type} failed: ${result.stderr}`);
          }

          if (step.type !== 'cleanup') {
            results.push(`✅ ${step.type}: ${file.remote}`);
          }
        }

        deployments.push({
          local: file.local,
          remote: file.remote,
          tempFile,
          strategy
        });
      }

      // Execute post-deploy hook
      await executeHook('post-deploy', {
        server: server,
        files: files.map(f => f.remote).join(', ')
      });

      return {
        content: [
          {
            type: 'text',
            text: `🚀 Deployment successful!\n\n${results.join('\n')}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Deployment failed: ${error.message}`,
          },
        ],
      };
    }
  }
);

// Execute command with sudo support
server.registerTool(
  'ssh_execute_sudo',
  {
    description: 'Execute command with sudo on remote server',
    inputSchema: {
      server: z.string().describe('Server name or alias'),
      command: z.string().describe('Command to execute with sudo'),
      password: z.string().optional().describe('Sudo password (will be masked in output)'),
      cwd: z.string().optional().describe('Working directory')
    }
  },
  async ({ server, command, password, cwd }) => {
    try {
      const ssh = await getConnection(server);
      const servers = loadServerConfig();
      const resolvedName = resolveServerName(server, servers);
      const serverConfig = servers[resolvedName];

      // Build the full command
      let fullCommand = command;

      // Add sudo if not already present
      if (!fullCommand.startsWith('sudo ')) {
        fullCommand = `sudo ${fullCommand}`;
      }

      // Add password if provided
      if (password) {
        fullCommand = `echo "${password}" | sudo -S ${command.replace(/^sudo /, '')}`;
      } else if (serverConfig?.sudo_password) {
        // Use configured sudo password if available
        fullCommand = `echo "${serverConfig.sudo_password}" | sudo -S ${command.replace(/^sudo /, '')}`;
      }

      // Add working directory if specified
      if (cwd) {
        fullCommand = `cd ${cwd} && ${fullCommand}`;
      } else if (serverConfig?.default_dir) {
        fullCommand = `cd ${serverConfig.default_dir} && ${fullCommand}`;
      }

      const result = await ssh.execCommand(fullCommand);

      // Mask password in output for security
      const maskedCommand = fullCommand.replace(/echo "[^"]+" \| sudo -S/, 'sudo');

      return {
        content: [
          {
            type: 'text',
            text: `🔐 Sudo command executed\nServer: ${server}\nCommand: ${maskedCommand}\nExit code: ${result.code}\n\nOutput:\n${result.stdout || result.stderr}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Sudo execution failed: ${error.message}`,
          },
        ],
      };
    }
  }
);

// Manage command aliases
server.registerTool(
  'ssh_command_alias',
  {
    description: 'Manage command aliases for frequently used commands',
    inputSchema: {
      action: z.enum(['add', 'remove', 'list', 'suggest']).describe('Action to perform'),
      alias: z.string().optional().describe('Alias name (for add/remove)'),
      command: z.string().optional().describe('Command to alias (for add) or search term (for suggest)')
    }
  },
  async ({ action, alias, command }) => {
    try {
      switch (action) {
      case 'add': {
        if (!alias || !command) {
          throw new Error('Both alias and command are required for add action');
        }

        addCommandAlias(alias, command);
        return {
          content: [
            {
              type: 'text',
              text: `✅ Command alias created: ${alias} -> ${command}`,
            },
          ],
        };
      }

      case 'remove': {
        if (!alias) {
          throw new Error('Alias is required for remove action');
        }

        removeCommandAlias(alias);
        return {
          content: [
            {
              type: 'text',
              text: `✅ Command alias removed: ${alias}`,
            },
          ],
        };
      }

      case 'list': {
        const aliases = listCommandAliases();

        const aliasInfo = aliases.map(({ alias, command, isFromProfile, isCustom }) =>
          `  ${alias} -> ${command}${isFromProfile ? ' (profile)' : ''}${isCustom ? ' (custom)' : ''}`
        ).join('\n');

        return {
          content: [
            {
              type: 'text',
              text: aliases.length > 0 ?
                `📝 Command aliases:\n${aliasInfo}` :
                '📝 No command aliases configured',
            },
          ],
        };
      }

      case 'suggest': {
        if (!command) {
          throw new Error('Command search term is required for suggest action');
        }

        const suggestions = suggestAliases(command);

        const suggestionInfo = suggestions.map(({ alias, command }) =>
          `  ${alias} -> ${command}`
        ).join('\n');

        return {
          content: [
            {
              type: 'text',
              text: suggestions.length > 0 ?
                `💡 Suggested aliases for "${command}":\n${suggestionInfo}` :
                `💡 No aliases found matching "${command}"`,
            },
          ],
        };
      }
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Command alias operation failed: ${error.message}`,
          },
        ],
      };
    }
  }
);

// Manage hooks
server.registerTool(
  'ssh_hooks',
  {
    description: 'Manage automation hooks for SSH operations',
    inputSchema: {
      action: z.enum(['list', 'enable', 'disable', 'status']).describe('Action to perform'),
      hook: z.string().optional().describe('Hook name (for enable/disable)')
    }
  },
  async ({ action, hook }) => {
    try {
      switch (action) {
      case 'list': {
        const hooks = listHooks();

        const hooksInfo = hooks.map(({ name, enabled, description, actionCount }) =>
          `  ${enabled ? '✅' : '⭕'} ${name}: ${description} (${actionCount} actions)`
        ).join('\n');

        return {
          content: [
            {
              type: 'text',
              text: hooks.length > 0 ?
                `🎣 Available hooks:\n${hooksInfo}` :
                '🎣 No hooks configured',
            },
          ],
        };
      }

      case 'enable': {
        if (!hook) {
          throw new Error('Hook name is required for enable action');
        }

        toggleHook(hook, true);
        return {
          content: [
            {
              type: 'text',
              text: `✅ Hook enabled: ${hook}`,
            },
          ],
        };
      }

      case 'disable': {
        if (!hook) {
          throw new Error('Hook name is required for disable action');
        }

        toggleHook(hook, false);
        return {
          content: [
            {
              type: 'text',
              text: `⭕ Hook disabled: ${hook}`,
            },
          ],
        };
      }

      case 'status': {
        const hooks = listHooks();
        const enabledHooks = hooks.filter(h => h.enabled);
        const disabledHooks = hooks.filter(h => !h.enabled);

        return {
          content: [
            {
              type: 'text',
              text: `🎣 Hook status:\n  Enabled: ${enabledHooks.map(h => h.name).join(', ') || 'none'}\n  Disabled: ${disabledHooks.map(h => h.name).join(', ') || 'none'}`,
            },
          ],
        };
      }
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Hook operation failed: ${error.message}`,
          },
        ],
      };
    }
  }
);

// Manage profiles
server.registerTool(
  'ssh_profile',
  {
    description: 'Manage SSH Manager profiles for different project types',
    inputSchema: {
      action: z.enum(['list', 'switch', 'current']).describe('Action to perform'),
      profile: z.string().optional().describe('Profile name (for switch)')
    }
  },
  async ({ action, profile }) => {
    try {
      switch (action) {
      case 'list': {
        const profiles = listProfiles();

        const profileInfo = profiles.map(p =>
          `  ${p.name}: ${p.description} (${p.aliasCount} aliases, ${p.hookCount} hooks)`
        ).join('\n');

        const current = getActiveProfileName();

        return {
          content: [
            {
              type: 'text',
              text: profiles.length > 0 ?
                `📚 Available profiles (current: ${current}):\n${profileInfo}` :
                '📚 No profiles found',
            },
          ],
        };
      }

      case 'switch': {
        if (!profile) {
          throw new Error('Profile name is required for switch action');
        }

        if (setActiveProfile(profile)) {
          return {
            content: [
              {
                type: 'text',
                text: `✅ Switched to profile: ${profile}\n⚠️  Restart Claude Code to apply profile changes`,
              },
            ],
          };
        } else {
          throw new Error(`Failed to switch to profile: ${profile}`);
        }
      }

      case 'current': {
        const current = getActiveProfileName();
        const profile = loadProfile();

        return {
          content: [
            {
              type: 'text',
              text: `📦 Current profile: ${current}\n📝 Description: ${profile.description || 'No description'}\n🔧 Aliases: ${Object.keys(profile.commandAliases || {}).length}\n🎣 Hooks: ${Object.keys(profile.hooks || {}).length}`,
            },
          ],
        };
      }
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Profile operation failed: ${error.message}`,
          },
        ],
      };
    }
  }
);

// Connection management tool
server.registerTool(
  'ssh_connection_status',
  {
    description: 'Check status of SSH connections and manage connection pool',
    inputSchema: {
      action: z.enum(['status', 'reconnect', 'disconnect', 'cleanup']).describe('Action to perform'),
      server: z.string().optional().describe('Server name (for reconnect/disconnect)')
    }
  },
  async ({ action, server }) => {
    try {
      switch (action) {
      case 'status': {
        const activeConnections = [];
        const now = Date.now();

        for (const [serverName, ssh] of connections.entries()) {
          const timestamp = connectionTimestamps.get(serverName);
          const ageMinutes = Math.floor((now - timestamp) / 1000 / 60);
          const isValid = await isConnectionValid(ssh);

          activeConnections.push({
            server: serverName,
            status: isValid ? '✅ Active' : '❌ Dead',
            age: `${ageMinutes} minutes`,
            keepalive: keepaliveIntervals.has(serverName) ? '✅' : '❌'
          });
        }

        const statusInfo = activeConnections.length > 0 ?
          activeConnections.map(c => `  ${c.server}: ${c.status} (age: ${c.age}, keepalive: ${c.keepalive})`).join('\n') :
          '  No active connections';

        return {
          content: [
            {
              type: 'text',
              text: `🔌 Connection Pool Status:\n${statusInfo}\n\nSettings:\n  Timeout: ${CONNECTION_TIMEOUT / 1000 / 60} minutes\n  Keepalive: Every ${KEEPALIVE_INTERVAL / 1000 / 60} minutes`,
            },
          ],
        };
      }

      case 'reconnect': {
        if (!server) {
          throw new Error('Server name is required for reconnect action');
        }

        const normalizedName = server.toLowerCase();
        if (connections.has(normalizedName)) {
          closeConnection(normalizedName);
        }

        await getConnection(server);
        return {
          content: [
            {
              type: 'text',
              text: `♻️  Reconnected to ${server}`,
            },
          ],
        };
      }

      case 'disconnect': {
        if (!server) {
          throw new Error('Server name is required for disconnect action');
        }

        closeConnection(server);
        return {
          content: [
            {
              type: 'text',
              text: `🔌 Disconnected from ${server}`,
            },
          ],
        };
      }

      case 'cleanup': {
        const oldCount = connections.size;
        cleanupOldConnections();

        // Also check and remove dead connections
        for (const [serverName, ssh] of connections.entries()) {
          const isValid = await isConnectionValid(ssh);
          if (!isValid) {
            closeConnection(serverName);
          }
        }

        const cleaned = oldCount - connections.size;
        return {
          content: [
            {
              type: 'text',
              text: `🧹 Cleanup complete: ${cleaned} connections closed, ${connections.size} active`,
            },
          ],
        };
      }
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Connection management failed: ${error.message}`,
          },
        ],
      };
    }
  }
);

// Manage server aliases
server.registerTool(
  'ssh_alias',
  {
    description: 'Manage server aliases for easier access',
    inputSchema: {
      action: z.enum(['add', 'remove', 'list']).describe('Action to perform'),
      alias: z.string().optional().describe('Alias name (for add/remove)'),
      server: z.string().optional().describe('Server name (for add)')
    }
  },
  async ({ action, alias, server }) => {
    try {
      switch (action) {
      case 'add': {
        if (!alias || !server) {
          throw new Error('Both alias and server are required for add action');
        }

        const servers = loadServerConfig();
        const resolvedName = resolveServerName(server, servers);

        if (!resolvedName) {
          throw new Error(`Server "${server}" not found`);
        }

        addAlias(alias, resolvedName);
        return {
          content: [
            {
              type: 'text',
              text: `✅ Alias created: ${alias} -> ${resolvedName}`,
            },
          ],
        };
      }

      case 'remove': {
        if (!alias) {
          throw new Error('Alias is required for remove action');
        }

        removeAlias(alias);
        return {
          content: [
            {
              type: 'text',
              text: `✅ Alias removed: ${alias}`,
            },
          ],
        };
      }

      case 'list': {
        const aliases = listAliases();
        const servers = loadServerConfig();

        const aliasInfo = aliases.map(({ alias, target }) => {
          const server = servers[target];
          return `  ${alias} -> ${target} (${server?.host || 'unknown'})`;
        }).join('\n');

        return {
          content: [
            {
              type: 'text',
              text: aliases.length > 0 ?
                `📝 Server aliases:\n${aliasInfo}` :
                '📝 No aliases configured',
            },
          ],
        };
      }
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Alias operation failed: ${error.message}`,
          },
        ],
      };
    }
  }
);

// Clean up connections on shutdown
process.on('SIGINT', async () => {
  console.error('\n🔌 Closing SSH connections...');
  for (const [name, ssh] of connections) {
    ssh.dispose();
    console.error(`  Closed connection to ${name}`);
  }
  process.exit(0);
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const servers = loadServerConfig();
  const serverList = Object.keys(servers);
  const activeProfile = getActiveProfileName();

  console.error('🚀 MCP SSH Manager Server started');
  console.error(`📦 Profile: ${activeProfile}`);
  console.error(`🖥️  Available servers: ${serverList.length > 0 ? serverList.join(', ') : 'none configured'}`);
  console.error('💡 Use server-manager.py to configure servers');
  console.error('🔄 Connection management: Auto-reconnect enabled, 30min timeout');

  // Set up periodic cleanup of old connections (every 10 minutes)
  setInterval(() => {
    cleanupOldConnections();
  }, 10 * 60 * 1000);
}

main().catch(console.error);
