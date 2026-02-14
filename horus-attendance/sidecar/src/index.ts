#!/usr/bin/env node
/**
 * ZKTeco Sidecar HTTP Server
 * 
 * This sidecar runs as an HTTP server that the Tauri app communicates with.
 * It handles ZKTeco device communication operations.
 */

import * as http from 'http';
import { ZKTecoClient } from './zkteco-client.js';
import type { DeviceConfig, SyncOptions } from './types.js';

const PORT = 3847;

// Request queue - ZKTeco devices can only handle one connection at a time
let requestQueue: Promise<void> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = requestQueue.then(fn, fn);
  requestQueue = result.then(() => {}, () => {});
  return result;
}

/**
 * Parse JSON body from request
 */
async function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function sendJson(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

/**
 * Send error response
 */
function sendError(res: http.ServerResponse, message: string, status = 500): void {
  sendJson(res, { success: false, error: message }, status);
}

/**
 * Handle test connection request
 */
async function handleTestConnection(config: DeviceConfig): Promise<{
  success: boolean;
  deviceInfo?: unknown;
  error?: string;
}> {
  const client = new ZKTecoClient(config);
  try {
    const result = await client.testConnection();
    return result;
  } finally {
    await client.disconnect();
  }
}

/**
 * Handle get device info request
 */
async function handleGetDeviceInfo(config: DeviceConfig): Promise<unknown> {
  const client = new ZKTecoClient(config);
  try {
    return await client.getDeviceInfo();
  } finally {
    await client.disconnect();
  }
}

/**
 * Handle get users request
 */
async function handleGetUsers(config: DeviceConfig): Promise<unknown[]> {
  const client = new ZKTecoClient(config);
  try {
    return await client.getUsers();
  } finally {
    await client.disconnect();
  }
}

/**
 * Handle get attendance logs request
 * 
 * IMPORTANT: This device firmware stores "001" as deviceUserId for ALL attendance records.
 * The userSn field is a sequential record counter (1, 2, 3...), NOT a user ID.
 * There is NO user identifier in the attendance records from this device firmware.
 */
async function handleGetAttendanceLogs(
  config: DeviceConfig,
  options?: SyncOptions
): Promise<unknown[]> {
  const client = new ZKTecoClient(config);
  try {
    const logs = await client.getAttendanceLogs(options);
    
    console.log(`[sidecar] Returning ${logs.length} attendance logs (no user mapping - device doesn't store user IDs)`);
    
    return logs.map(log => ({
      ...log,
      userName: null,
    }));
  } finally {
    await client.disconnect();
  }
}

/**
 * Handle combined sync request - fetches users AND attendance logs in a single connection session
 * This avoids the concurrent connection issue where separate requests overwhelm the device
 */
async function handleSyncAll(
  config: DeviceConfig,
  options?: SyncOptions
): Promise<{ users: unknown[]; logs: unknown[] }> {
  const client = new ZKTecoClient(config);
  try {
    console.log(`[sidecar] Starting combined sync for device ${config.ip}:${config.port}`);
    
    // Fetch users first
    const users = await client.getUsers();
    console.log(`[sidecar] Got ${users.length} users`);
    
    // Disconnect and reconnect for attendance logs (device needs a fresh connection)
    await client.disconnect();
    await new Promise(resolve => setTimeout(resolve, 500)); // Brief pause between operations
    
    // Fetch attendance logs
    const logs = await client.getAttendanceLogs(options);
    console.log(`[sidecar] Got ${logs.length} attendance logs`);
    
    return {
      users,
      logs: logs.map(log => ({
        ...log,
        userName: null,
      })),
    };
  } finally {
    await client.disconnect();
  }
}

/**
 * Request handler
 */
async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendError(res, 'Method not allowed', 405);
    return;
  }

  try {
    const body = await parseBody(req);
    const config = body.config as DeviceConfig;

    if (!config || !config.ip) {
      sendError(res, 'Missing device config', 400);
      return;
    }

    const url = req.url || '/';
    console.log(`[sidecar] ${req.method} ${url} - Device: ${config.ip}:${config.port}`);

    switch (url) {
      case '/test-connection': {
        const result = await enqueue(() => handleTestConnection(config));
        sendJson(res, result);
        break;
      }

      case '/device-info': {
        const info = await enqueue(() => handleGetDeviceInfo(config));
        sendJson(res, info);
        break;
      }

      case '/users': {
        const users = await enqueue(() => handleGetUsers(config));
        sendJson(res, users);
        break;
      }

      case '/attendance-logs': {
        const options = body.options as SyncOptions | undefined;
        const logs = await enqueue(() => handleGetAttendanceLogs(config, options));
        sendJson(res, logs);
        break;
      }

      case '/sync-all': {
        const options = body.options as SyncOptions | undefined;
        const result = await enqueue(() => handleSyncAll(config, options));
        sendJson(res, result);
        break;
      }

      case '/health': {
        sendJson(res, { status: 'ok', timestamp: new Date().toISOString() });
        break;
      }

      default:
        sendError(res, 'Not found', 404);
    }
  } catch (error) {
    console.error('[sidecar] Error:', error);
    sendError(res, error instanceof Error ? error.message : String(error));
  }
}

// Create and start server
const server = http.createServer(handleRequest);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[sidecar] ZKTeco sidecar HTTP server running on port ${PORT}`);
  console.log(`[sidecar] Endpoints:`);
  console.log(`  POST /test-connection - Test device connection`);
  console.log(`  POST /device-info     - Get device information`);
  console.log(`  POST /users           - Get users from device`);
  console.log(`  POST /attendance-logs - Get attendance logs`);
  console.log(`  POST /sync-all        - Get users + attendance logs (combined)`);
  console.log(`  POST /health          - Health check`);
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('[sidecar] Shutting down...');
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[sidecar] Shutting down...');
  server.close();
  process.exit(0);
});
