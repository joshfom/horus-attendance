/**
 * Sidecar Client
 * 
 * Handles communication with the Node.js ZKTeco sidecar process.
 * Uses a Rust proxy command to bypass webview HTTP restrictions in production.
 */

import { invoke } from '@tauri-apps/api/core';
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

/**
 * Convert app DeviceConfig to sidecar format
 */
function toSidecarConfig(config: DeviceConfig): SidecarDeviceConfig {
  return {
    ip: config.ip,
    port: config.port,
    commKey: config.commKey || undefined,
    timeout: 15000,
  };
}

/**
 * Sidecar Client class
 * 
 * Communicates with the Node.js ZKTeco sidecar via a Rust proxy command.
 * This bypasses the Tauri HTTP plugin scope restrictions that block
 * localhost requests in production builds.
 */
export class SidecarClient {
  private static instance: SidecarClient | null = null;
  private isConnected = false;

  private constructor() {}

  static getInstance(): SidecarClient {
    if (!SidecarClient.instance) {
      SidecarClient.instance = new SidecarClient();
    }
    return SidecarClient.instance;
  }

  async initialize(): Promise<void> {
    if (this.isConnected) return;
    this.isConnected = true;
  }

  /**
   * Send request to sidecar via Rust proxy command
   */
  private async sendRequest(endpoint: string, data: Record<string, unknown>): Promise<unknown> {
    console.log(`[SidecarClient] Sending request to ${endpoint}`);
    try {
      const responseText = await invoke<string>('sidecar_request', {
        endpoint,
        body: JSON.stringify(data),
      });
      const result = JSON.parse(responseText);
      console.log(`[SidecarClient] Response received from ${endpoint}`);
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[SidecarClient] Request error:', msg);
      throw new Error(msg);
    }
  }

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

  async getDeviceInfo(config: DeviceConfig): Promise<DeviceInfo> {
    return await this.sendRequest('/device-info', {
      config: toSidecarConfig(config),
    }) as DeviceInfo;
  }

  async getUsers(config: DeviceConfig): Promise<SidecarUser[]> {
    return await this.sendRequest('/users', {
      config: toSidecarConfig(config),
    }) as SidecarUser[];
  }

  async getAttendanceLogs(
    config: DeviceConfig,
    options?: SidecarSyncOptions
  ): Promise<SidecarAttendanceLog[]> {
    return await this.sendRequest('/attendance-logs', {
      config: toSidecarConfig(config),
      options,
    }) as SidecarAttendanceLog[];
  }

  async syncAll(
    config: DeviceConfig,
    options?: SidecarSyncOptions
  ): Promise<{ users: SidecarUser[]; logs: SidecarAttendanceLog[] }> {
    return await this.sendRequest('/sync-all', {
      config: toSidecarConfig(config),
      options,
    }) as { users: SidecarUser[]; logs: SidecarAttendanceLog[] };
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
  }
}

// Export types for use in other modules
export type {
  SidecarUser,
  SidecarAttendanceLog,
  SidecarSyncOptions,
  ConnectionTestResult,
};
