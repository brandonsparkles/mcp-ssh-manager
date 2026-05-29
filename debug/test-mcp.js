#!/usr/bin/env node

// Test script to verify MCP server functionality
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔧 Testing MCP SSH Manager Server...\n');

// Start the MCP server
const serverPath = path.join(__dirname, '..', 'src', 'index.js');
const server = spawn('node', [serverPath], {
  stdio: ['pipe', 'pipe', 'pipe']
});

// Handle server output. Messages are newline-delimited JSON, so buffer raw
// chunks and only parse complete lines — a single chunk may contain a partial
// frame or several frames concatenated together.
let stdoutBuffer = '';
server.stdout.on('data', (data) => {
  stdoutBuffer += data.toString();
  let newlineIndex;
  while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
    const line = stdoutBuffer.slice(0, newlineIndex);
    stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
    if (!line.trim()) continue;
    try {
      const response = JSON.parse(line);
      console.log('✅ Server Response:', JSON.stringify(response, null, 2));
    } catch (e) {
      console.log('📝 Server Output:', line);
    }
  }
});

server.stderr.on('data', (data) => {
  console.log('ℹ️ Server Info:', data.toString());
});

server.on('error', (error) => {
  console.error('❌ Failed to start server:', error);
});

// Wait for server to start
setTimeout(() => {
  console.log('\n📋 Sending initialization request...\n');
  
  // Send initialization request
  const initRequest = {
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '0.1.0',
      capabilities: {},
      clientInfo: {
        name: 'test-client',
        version: '1.0.0'
      }
    },
    id: 1
  };
  
  server.stdin.write(JSON.stringify(initRequest) + '\n');
  
  // Wait and then request tools list
  setTimeout(() => {
    console.log('\n🔧 Requesting tools list...\n');
    
    const toolsRequest = {
      jsonrpc: '2.0',
      method: 'tools/list',
      params: {},
      id: 2
    };
    
    server.stdin.write(JSON.stringify(toolsRequest) + '\n');
    
    // Give time for response then exit
    setTimeout(() => {
      console.log('\n✅ Test complete. Shutting down...');
      server.kill();
      process.exit(0);
    }, 2000);
  }, 1000);
}, 500);