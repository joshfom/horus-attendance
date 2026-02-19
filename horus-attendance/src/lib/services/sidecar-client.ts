/**
 * Device Client
 * 
 * Communicates directly with ZKTeco devices via Rust-native protocol.
 * No sidecar or HTTP proxy needed — Tauri commands handle everything.
 */

import { invoke } from '@tauri-apps/api/core';
import type { DeviceConfig, DeviceInfo } from '../../types/models';

// Types for device communication
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
 * Convert app DeviceConfig to command format
 */
function toDeviceConfig(config: DeviceConfig): SidecarDeviceConfig {
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
 * Now communicates directly with ZKTeco devices via Rust Tauri commands.
 * The name is kept for backward compatibility with existing imports.
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

  async testConnection(config: DeviceConfig): Promise<ConnectionTestResult> {
    try {
      const result = await invoke<ConnectionTestResult>('test_device_connection', {
        config: toDeviceConfig(config),
      });
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        latency: 0,
      };
    }
  }

  async getDeviceInfo(config: DeviceConfig): Promise<DeviceInfo> {
    return await invoke<DeviceInfo>('get_device_info', {
      config: toDeviceConfig(config),
    });
  }

  async getUsers(config: DeviceConfig): Promise<SidecarUser[]> {
    return await invoke<SidecarUser[]>('get_device_users', {
      config: toDeviceConfig(config),
    });
  }

  async getAttendanceLogs(
    config: DeviceConfig,
    options?: SidecarSyncOptions
  ): Promise<SidecarAttendanceLog[]> {
    return await invoke<SidecarAttendanceLog[]>('get_attendance_logs', {
      config: toDeviceConfig(config),
      options: options ?? null,
    });
  }

  async syncAll(
    config: DeviceConfig,
    options?: SidecarSyncOptions
  ): Promise<{ users: SidecarUser[]; logs: SidecarAttendanceLog[] }> {
    return await invoke<{ users: SidecarUser[]; logs: SidecarAttendanceLog[] }>('sync_device_all', {
      config: toDeviceConfig(config),
      options: options ?? null,
    });
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
