import { Client } from 'ssh2';
import fs from 'fs';
import { promisify } from 'util';

class SSHManager {
  constructor(config) {
    this.config = config;
    this.client = new Client();
    this.connected = false;
    this.sftp = null;
  }

  async connect() {
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
        readyTimeout: 20000,
        keepaliveInterval: 10000
      };

      // Add authentication
      if (this.config.keypath) {
        const keyPath = this.config.keypath.replace('~', process.env.HOME);
        connConfig.privateKey = fs.readFileSync(keyPath);
      } else if (this.config.password) {
        connConfig.password = this.config.password;
      }

      this.client.connect(connConfig);
    });
  }

  async execCommand(command, options = {}) {
    if (!this.connected) {
      throw new Error('Not connected to SSH server');
    }

    const { timeout = 30000, cwd, rawCommand = false } = options;
    const fullCommand = (cwd && !rawCommand) ? `cd ${cwd} && ${command}` : command;

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let completed = false;
      let stream = null;
      let timeoutId = null;

      // Setup timeout first
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          if (!completed) {
            completed = true;
            
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
            
            reject(new Error(`Command timeout after ${timeout}ms: ${command.substring(0, 100)}...`));
          }
        }, timeout);
      }

      this.client.exec(fullCommand, (err, streamObj) => {
        if (err) {
          completed = true;
          if (timeoutId) clearTimeout(timeoutId);
          reject(err);
          return;
        }

        stream = streamObj;

        stream.on('close', (code, signal) => {
          if (!completed) {
            completed = true;
            if (timeoutId) clearTimeout(timeoutId);
            resolve({
              stdout,
              stderr,
              code: code || 0,
              signal
            });
          }
        });

        stream.on('data', (data) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        stream.on('error', (err) => {
          if (!completed) {
            completed = true;
            if (timeoutId) clearTimeout(timeoutId);
            reject(err);
          }
        });
      });
    });
  }

  async execCommandStream(command, options = {}) {
    if (!this.connected) {
      throw new Error('Not connected to SSH server');
    }

    const { cwd, onStdout, onStderr } = options;
    const fullCommand = cwd ? `cd ${cwd} && ${command}` : command;

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

  async putFile(localPath, remotePath) {
    // SFTP doesn't resolve ~ automatically, we need to get the real path
    let resolvedRemotePath = remotePath;
    if (remotePath.includes('~')) {
      // Use pwd in home directory to get the real path
      const result = await this.execCommand('cd ~ && pwd', { timeout: 5000, rawCommand: true });
      const homeDir = result.stdout.trim();
      // Replace ~ with the actual home directory
      resolvedRemotePath = remotePath.replace(/^~/, homeDir);
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
      // Use pwd in home directory to get the real path
      const result = await this.execCommand('cd ~ && pwd', { timeout: 5000, rawCommand: true });
      const homeDir = result.stdout.trim();
      // Replace ~ with the actual home directory
      resolvedRemotePath = remotePath.replace(/^~/, homeDir);
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
    const sftp = await this.getSFTP();
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