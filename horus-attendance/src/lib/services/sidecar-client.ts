/**
 * Sidecar Client
 * 
 * Handles communication with the Node.js ZKTeco sidecar process.
 * Uses Tauri's sidecar/shell API to spawn and communicate with the process.
 */

import { fetch } from '@tauri-apps/plugin-http';
import type { DeviceConfig, DeviceInfo } from '../../types/models';

// Types for sidecar communication
interface SidecarDeviceConfig {
  ip: string;
  port: number;
  commKey?: string | undefined;
  timeout?: number | undefined;
}

interface SidecarUser {
  deviceUserId: string;
  deviceName: string;
}

interface SidecarAttendanceLog {
  deviceUserId: string;
  timestamp: string;
  verifyType: number;
  punchType: number;
  userName?: string | null;
}

interface SidecarSyncOptions {
  mode: 'all' | 'range';
  startDate?: string | undefined;
  endDate?: string | undefined;
}

interface ConnectionTestResult {
  success: boolean;
  deviceInfo?: DeviceInfo | undefined;
  error?: string | undefined;
  latency: number;
}

// Sidecar process communication
let sidecarProcess: { write: (data: string) => Promise<void>; kill: () => Promise<void> } | null = null;
let responseHandlers: Map<string, { resolve: (data: unknown) => void; reject: (error: Error) => void }> = new Map();

/**
 * Convert app DeviceConfig to sidecar format
 */
function toSidecarConfig(config: DeviceConfig): SidecarDeviceConfig {
  return {
    ip: config.ip,
    port: config.port,
    commKey: config.commKey || undefined,
    timeout: 15000, // 15 second timeout for device connection
  };
}

/**
 * Sidecar Client class
 * 
 * Communicates with the Node.js ZKTeco sidecar via Tauri shell plugin.
 */
export class SidecarClient {
  private static instance: SidecarClient | null = null;
  private isConnected = false;
  private sidecarUrl = 'http://localhost:3847'; // Sidecar HTTP server port

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): SidecarClient {
    if (!SidecarClient.instance) {
      SidecarClient.instance = new SidecarClient();
    }
    return SidecarClient.instance;
  }

  /**
   * Initialize the sidecar connection
   */
  async initialize(): Promise<void> {
    if (this.isConnected) return;
    this.isConnected = true;
  }

  /**
   * Send HTTP request to sidecar
   */
  private async sendRequest(endpoint: string, data: Record<string, unknown>): Promise<unknown> {
    const url = `${this.sidecarUrl}${endpoint}`;
    console.log(`[SidecarClient] Sending request to ${url}`);
    
    try {
      const controller = new AbortController();
      // 120s timeout for large data transfers (11k+ attendance records)
      const timeoutId = setTimeout(() => controller.abort(), 120000);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[SidecarClient] HTTP error ${response.status}: ${errorText}`);
        throw new Error(`Sidecar error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log(`[SidecarClient] Response received from ${endpoint}`);
      return result;
    } catch (error) {
      // Check if it's an abort error
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('Request timed out. The device may be slow to respond with large data sets.');
      }
      // Check if it's a network error (sidecar not running)
      if (error instanceof TypeError) {
        console.error('[SidecarClient] Network error - sidecar may not be running:', error.message);
        throw new Error(`Sidecar connection failed: ${error.message}. Is the sidecar running on port 3847?`);
      }
      // Re-throw with context
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[SidecarClient] Request error:', msg);
      throw error;
    }
  }

  /**
   * Test connection to a ZKTeco device
   */
  async testConnection(config: DeviceConfig): Promise<ConnectionTestResult> {
    const startTime = Date.now();
    
    try {
      const result = await this.sendRequest('/test-connection', {
        config: toSidecarConfig(config),
      }) as { success: boolean; deviceInfo?: DeviceInfo; error?: string };
      
      return {
        success: result.success,
        deviceInfo: result.deviceInfo,
        error: result.error,
        latency: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        latency: Date.now() - startTime,
      };
    }
  }

  /**
   * Get device information
   */
  async getDeviceInfo(config: DeviceConfig): Promise<DeviceInfo> {
    const result = await this.sendRequest('/device-info', {
      config: toSidecarConfig(config),
    }) as DeviceInfo;
    return result;
  }

  /**
   * Get all users from the device
   */
  async getUsers(config: DeviceConfig): Promise<SidecarUser[]> {
    const result = await this.sendRequest('/users', {
      config: toSidecarConfig(config),
    }) as SidecarUser[];
    return result;
  }

  /**
   * Get attendance logs from the device
   */
  async getAttendanceLogs(
    config: DeviceConfig,
    options?: SidecarSyncOptions
  ): Promise<SidecarAttendanceLog[]> {
    const result = await this.sendRequest('/attendance-logs', {
      config: toSidecarConfig(config),
      options,
    }) as SidecarAttendanceLog[];
    return result;
  }

  /**
   * Combined sync: fetch users AND attendance logs in a single device session
   * This avoids concurrent connection issues with ZKTeco devices
   */
  async syncAll(
    config: DeviceConfig,
    options?: SidecarSyncOptions
  ): Promise<{ users: SidecarUser[]; logs: SidecarAttendanceLog[] }> {
    const result = await this.sendRequest('/sync-all', {
      config: toSidecarConfig(config),
      options,
    }) as { users: SidecarUser[]; logs: SidecarAttendanceLog[] };
    return result;
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect(): Promise<void> {
    this.isConnected = false;
    if (sidecarProcess) {
      await sidecarProcess.kill();
      sidecarProcess = null;
    }
    responseHandlers.clear();
  }
}

// Export types for use in other modules
export type {
  SidecarUser,
  SidecarAttendanceLog,
  SidecarSyncOptions,
  ConnectionTestResult,
};
