import { Client } from 'ssh2';
import fs from 'fs';
import os from 'os';
import { getCurrentHostKey, addHostKey } from './ssh-key-manager.js';
import { logger } from './logger.js';

function shellQuote(value) {
  const quote = String.fromCharCode(39);
  return quote + String(value).replace(/'/g, quote + '\\' + quote + quote) + quote;
}

class SSHManager {
  constructor(config) {
    this.config = config;
    this.client = new Client();
    this.connected = false;
    this.sftp = null;
    this.cachedHomeDir = null;
    this.autoAcceptHostKey = config.autoAcceptHostKey || false;
    this.hostKeyVerification = config.hostKeyVerification !== false; // Default true
    this.jumpConnection = null;
  }

  async connect(options = {}) {
    // Read the private key (if any) asynchronously before entering the Promise
    // executor so we never block the event loop with a synchronous file read.
    // Support both keyPath and keypath for compatibility.
    const keyPath = this.config.keyPath || this.config.keypath;
    let privateKey = null;
    if (keyPath) {
      // Only expand a leading "~" (bare or followed by "/"); never replace a
      // tilde that appears elsewhere in the path.
      const resolvedKeyPath = keyPath.replace(/^~(?=\/|$)/, os.homedir());
      privateKey = await fs.promises.readFile(resolvedKeyPath);
    }

    return new Promise((resolve, reject) => {
      this.client.on('ready', () => {
        this.connected = true;
        resolve();
      });

      this.client.on('error', (err) => {
        this.connected = false;
        reject(err);
      });

      this.client.on('end', () => {
        this.connected = false;
      });

      // Build connection config
      const connConfig = {
        host: this.config.host,
        port: this.config.port || 22,
        username: this.config.user,
        readyTimeout: 60000, // Increased from 20000 to 60000 for slow connections
        keepaliveInterval: 10000,
        // Add compatibility options for problematic servers
        algorithms: {
          kex: ['ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521', 'diffie-hellman-group-exchange-sha256', 'diffie-hellman-group14-sha256', 'diffie-hellman-group14-sha1'],
          cipher: ['aes128-ctr', 'aes192-ctr', 'aes256-ctr', 'aes128-gcm', 'aes256-gcm', 'aes128-cbc', 'aes192-cbc', 'aes256-cbc'],
          serverHostKey: ['rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'ssh-ed25519'],
          hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1']
        },
        debug: (info) => {
          if (info.includes('Handshake') || info.includes('error')) {
            logger.debug('SSH2 Debug', { info });
          }
        }
      };

      // Add host key verification callback if enabled
      if (this.hostKeyVerification) {
        connConfig.hostVerifier = (hostKey) => {
          const port = this.config.port || 22;
          const host = this.config.host;
          const presentedKey = Buffer.isBuffer(hostKey) ? hostKey.toString('base64') : null;

          // Check if host is already known and the presented key matches.
          const knownKeys = getCurrentHostKey(host, port) || [];
          if (presentedKey && knownKeys.some(key => key.key === presentedKey)) {
            logger.info('Host key verified', { host, port });
            return true;
          }

          if (knownKeys.length > 0) {
            logger.error('SSH host key mismatch', { host, port });
            return false;
          }

          // If autoAcceptHostKey is enabled, accept and add the key
          if (this.autoAcceptHostKey) {
            logger.info('Auto-accept host key', { host, port });
            // Schedule key addition after connection
            setImmediate(async () => {
              try {
                await addHostKey(host, port);
                logger.info('Host key added', { host, port });
              } catch (err) {
                logger.warn('Failed to add host key', {
                  host,
                  port,
                  error: err.message
                });
              }
            });
            return true;
          }

          logger.warn('Rejecting unknown SSH host key', { host, port });
          return false;
        };
      }

      // Use ssh-agent if available (handles passphrase-protected keys transparently)
      if (process.env.SSH_AUTH_SOCK) {
        connConfig.agent = process.env.SSH_AUTH_SOCK;
      }

      // Add authentication (key read above before entering the Promise executor)
      if (privateKey) {
        connConfig.privateKey = privateKey;
        if (this.config.passphrase) {
          connConfig.passphrase = this.config.passphrase;
        }
      } else if (this.config.password) {
        connConfig.password = this.config.password;
      }

      // Use provided stream for proxy jump / proxy command connections
      if (options.sock) {
        connConfig.sock = options.sock;
      }

      this.client.connect(connConfig);
    });
  }

  async execCommand(command, options = {}) {
    if (!this.connected) {
      throw new Error('Not connected to SSH server');
    }

    const {
      timeout = 30000,
      cwd,
      rawCommand = false,
      // Optional stdin payload: written to the remote command's stdin, then the
      // input side is half-closed (EOF). Lets a single exec channel both receive
      // data and run (e.g. `base64 -d > file` fed the script) instead of a
      // separate SFTP transfer + exec.
      stdin = null,
      // Quiet window (ms) to keep draining buffered output after the
      // foreground command has exited. See the 'exit' handler below.
      backgroundDrainMs = 250,
    } = options;
    const fullCommand = (cwd && !rawCommand) ? `cd ${shellQuote(cwd)} && ${command}` : command;

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let completed = false;
      let exited = false;
      let stream = null;
      let timeoutId = null;
      let drainId = null;
      let exitCode = null;
      let exitSignal = null;

      const clearTimers = () => {
        if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
        if (drainId) { clearTimeout(drainId); drainId = null; }
      };

      const finish = () => {
        if (completed) return;
        completed = true;
        clearTimers();
        // The channel may still be open here when a backgrounded/detached
        // child is holding the stdio fds; stop accumulating its output so a
        // lingering channel can't grow these buffers unbounded.
        if (stream) {
          try { stream.removeAllListeners('data'); } catch (e) { /* ignore */ }
          try { stream.stderr.removeAllListeners('data'); } catch (e) { /* ignore */ }
        }
        resolve({ stdout, stderr, code: exitCode || 0, signal: exitSignal });
      };

      const fail = (err) => {
        if (completed) return;
        completed = true;
        clearTimers();
        reject(err);
      };

      // After the foreground command has exited, (re)arm a short quiet-window
      // timer. Each subsequent chunk of buffered output pushes it back, so we
      // capture trailing output but resolve once the stream goes quiet — we do
      // NOT wait for channel 'close', which a detached child (`cmd &`, setsid,
      // nohup) keeps open for its whole lifetime.
      const bumpDrain = () => {
        if (!exited || completed) return;
        if (drainId) clearTimeout(drainId);
        drainId = setTimeout(finish, Math.max(0, backgroundDrainMs));
      };

      // Hard timeout: only trips when the foreground command never exits.
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          if (completed) return;

          // Try multiple ways to kill the stream
          if (stream) {
            try {
              stream.write('\x03'); // Send Ctrl+C
              stream.end();
              stream.destroy();
            } catch (e) {
              // Ignore errors
            }
          }

          // Kill the entire client connection as last resort
          try {
            this.client.end();
            this.connected = false;
          } catch (e) {
            // Ignore errors
          }

          fail(new Error(`Command timeout after ${timeout}ms: ${command.substring(0, 100)}${command.length > 100 ? '...' : ''}`));
        }, timeout);
      }

      this.client.exec(fullCommand, (err, streamObj) => {
        if (err) {
          fail(err);
          return;
        }

        stream = streamObj;

        // 'exit' carries the foreground command's status and fires before
        // 'close'. ssh2 calls it as (code) for normal exits, or
        // (null, signalName, ...) for signal terminations.
        stream.on('exit', (code, signalName) => {
          if (typeof code === 'number') {
            exitCode = code;
          } else if (signalName) {
            exitSignal = signalName;
          }
          exited = true;
          bumpDrain();
        });

        // 'close' (channel fully closed) is the fast path for ordinary
        // commands: it fires right after 'exit', so we resolve immediately
        // and the drain timer never actually elapses.
        stream.on('close', (code, signal) => {
          if (typeof code === 'number') exitCode = code;
          if (signal) exitSignal = signal;
          finish();
        });

        stream.on('data', (data) => {
          stdout += data.toString();
          bumpDrain();
        });

        stream.stderr.on('data', (data) => {
          stderr += data.toString();
          bumpDrain();
        });

        stream.on('error', (err) => {
          fail(err);
        });

        // Feed stdin (if any) and half-close the input side so commands that
        // read until EOF (base64 -d, cat, etc.) complete. Errors here surface
        // through the stream 'error' handler above.
        if (stdin != null) {
          try {
            stream.end(stdin);
          } catch (e) {
            fail(e);
          }
        }
      });
    });
  }

  async execCommandStream(command, options = {}) {
    if (!this.connected) {
      throw new Error('Not connected to SSH server');
    }

    const { cwd, onStdout, onStderr } = options;
    const fullCommand = cwd ? `cd ${shellQuote(cwd)} && ${command}` : command;

    return new Promise((resolve, reject) => {
      this.client.exec(fullCommand, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('close', (code, signal) => {
          resolve({
            stdout,
            stderr,
            code: code || 0,
            signal,
            stream
          });
        });

        stream.on('data', (data) => {
          const chunk = data.toString();
          stdout += chunk;
          if (onStdout) onStdout(chunk);
        });

        stream.stderr.on('data', (data) => {
          const chunk = data.toString();
          stderr += chunk;
          if (onStderr) onStderr(chunk);
        });

        stream.on('error', reject);
      });
    });
  }

  async requestShell(options = {}) {
    if (!this.connected) {
      throw new Error('Not connected to SSH server');
    }

    return new Promise((resolve, reject) => {
      this.client.shell(options, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(stream);
      });
    });
  }

  async getSFTP() {
    if (this.sftp) return this.sftp;

    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }
        this.sftp = sftp;
        resolve(sftp);
      });
    });
  }

  async resolveHomePath() {
    if (this.cachedHomeDir) {
      return this.cachedHomeDir;
    }

    let homeDir = null;

    // Method 1: Try getent (most reliable)
    try {
      const result = await this.execCommand('getent passwd $USER | cut -d: -f6', {
        timeout: 5000,
        rawCommand: true
      });
      homeDir = result.stdout.trim();
      if (homeDir && homeDir.startsWith('/')) {
        this.cachedHomeDir = homeDir;
        return homeDir;
      }
    } catch (err) {
      // getent might not be available, try next method
    }

    // Method 2: Try env -i to get clean HOME
    try {
      const result = await this.execCommand('env -i HOME=$HOME bash -c "echo $HOME"', {
        timeout: 5000,
        rawCommand: true
      });
      homeDir = result.stdout.trim();
      if (homeDir && homeDir.startsWith('/')) {
        this.cachedHomeDir = homeDir;
        return homeDir;
      }
    } catch (err) {
      // env method failed, try next
    }

    // Method 3: Parse /etc/passwd directly
    try {
      const result = await this.execCommand('grep "^$USER:" /etc/passwd | cut -d: -f6', {
        timeout: 5000,
        rawCommand: true
      });
      homeDir = result.stdout.trim();
      if (homeDir && homeDir.startsWith('/')) {
        this.cachedHomeDir = homeDir;
        return homeDir;
      }
    } catch (err) {
      // /etc/passwd parsing failed, try last resort
    }

    // Method 4: Last resort - try cd ~ && pwd
    try {
      const result = await this.execCommand('cd ~ && pwd', {
        timeout: 5000,
        rawCommand: true
      });
      homeDir = result.stdout.trim();
      if (homeDir && homeDir.startsWith('/')) {
        this.cachedHomeDir = homeDir;
        return homeDir;
      }
    } catch (err) {
      // All methods failed
    }

    throw new Error('Unable to determine home directory on remote server');
  }

  async putFile(localPath, remotePath) {
    // SFTP doesn't resolve ~ automatically, we need to get the real path
    let resolvedRemotePath = remotePath;
    if (remotePath.includes('~')) {
      try {
        const homeDir = await this.resolveHomePath();
        // Replace ~ with the actual home directory
        // Handle both ~/path and ~ alone
        if (remotePath === '~') {
          resolvedRemotePath = homeDir;
        } else if (remotePath.startsWith('~/')) {
          resolvedRemotePath = homeDir + remotePath.substring(1);
        } else {
          // If ~ is not at the beginning, don't replace it
          resolvedRemotePath = remotePath;
        }
      } catch (err) {
        // If we can't resolve home, throw a more descriptive error
        throw new Error(`Failed to resolve home directory for path: ${remotePath}. ${err.message}`);
      }
    }

    const sftp = await this.getSFTP();
    return new Promise((resolve, reject) => {
      // Check if local file exists and is readable
      if (!fs.existsSync(localPath)) {
        reject(new Error(`Local file does not exist: ${localPath}`));
        return;
      }

      sftp.fastPut(localPath, resolvedRemotePath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async getFile(localPath, remotePath) {
    // SFTP doesn't resolve ~ automatically, we need to get the real path
    let resolvedRemotePath = remotePath;
    if (remotePath.includes('~')) {
      try {
        const homeDir = await this.resolveHomePath();
        // Replace ~ with the actual home directory
        // Handle both ~/path and ~ alone
        if (remotePath === '~') {
          resolvedRemotePath = homeDir;
        } else if (remotePath.startsWith('~/')) {
          resolvedRemotePath = homeDir + remotePath.substring(1);
        } else {
          // If ~ is not at the beginning, don't replace it
          resolvedRemotePath = remotePath;
        }
      } catch (err) {
        // If we can't resolve home, throw a more descriptive error
        throw new Error(`Failed to resolve home directory for path: ${remotePath}. ${err.message}`);
      }
    }

    const sftp = await this.getSFTP();
    return new Promise((resolve, reject) => {
      sftp.fastGet(resolvedRemotePath, localPath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async putFiles(files, options = {}) {
    const results = [];

    for (const file of files) {
      try {
        await this.putFile(file.local, file.remote);
        results.push({ ...file, success: true });
      } catch (error) {
        results.push({ ...file, success: false, error: error.message });
        if (options.stopOnError) break;
      }
    }

    return results;
  }

  isConnected() {
    return this.connected && this.client && !this.client.destroyed;
  }

  dispose() {
    if (this.sftp) {
      this.sftp.end();
      this.sftp = null;
    }
    if (this.client) {
      this.client.end();
      this.connected = false;
    }
  }

  async forwardOut(srcAddr, srcPort, dstAddr, dstPort) {
    if (!this.connected) {
      throw new Error('Not connected to SSH server');
    }
    return new Promise((resolve, reject) => {
      this.client.forwardOut(srcAddr, srcPort, dstAddr, dstPort, (err, stream) => {
        if (err) reject(err);
        else resolve(stream);
      });
    });
  }

  async ping() {
    try {
      const result = await this.execCommand('echo "ping"', { timeout: 5000 });
      return result.stdout.trim() === 'ping';
    } catch (error) {
      return false;
    }
  }
}

export default SSHManager;
