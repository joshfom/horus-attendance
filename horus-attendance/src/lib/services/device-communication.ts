/**
 * Device Communication Service
 * 
 * High-level service for communicating with ZKTeco devices.
 * Wraps the sidecar client and provides error handling.
 */

import type { DeviceConfig, DeviceInfo } from '../../types/models';
import type { ConnectionTestResult, SidecarUser, SidecarAttendanceLog, SidecarSyncOptions } from './sidecar-client';
import { SidecarClient } from './sidecar-client';

// Error codes for device communication
export const DeviceErrorCodes = {
  CONNECTION_TIMEOUT: 'DEVICE_CONNECTION_TIMEOUT',
  AUTH_FAILED: 'DEVICE_AUTH_FAILED',
  UNREACHABLE: 'DEVICE_UNREACHABLE',
  PROTOCOL_ERROR: 'DEVICE_PROTOCOL_ERROR',
  SIDECAR_NOT_READY: 'SIDECAR_NOT_READY',
} as const;

export type DeviceErrorCode = typeof DeviceErrorCodes[keyof typeof DeviceErrorCodes];

export interface DeviceError {
  code: DeviceErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Parse error message to determine error code
 */
function parseErrorCode(message: string): DeviceErrorCode {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('timeout') || lowerMessage.includes('etimedout')) {
    return DeviceErrorCodes.CONNECTION_TIMEOUT;
  }
  if (lowerMessage.includes('auth') || lowerMessage.includes('password') || lowerMessage.includes('key')) {
    return DeviceErrorCodes.AUTH_FAILED;
  }
  if (lowerMessage.includes('unreachable') || lowerMessage.includes('econnrefused') || lowerMessage.includes('ehostunreach')) {
    return DeviceErrorCodes.UNREACHABLE;
  }
  if (lowerMessage.includes('sidecar') || lowerMessage.includes('not implemented')) {
    return DeviceErrorCodes.SIDECAR_NOT_READY;
  }
  
  return DeviceErrorCodes.PROTOCOL_ERROR;
}

/**
 * Create a DeviceError from an error message
 */
function createDeviceError(message: string): DeviceError {
  const code = parseErrorCode(message);
  
  const friendlyMessages: Record<DeviceErrorCode, string> = {
    [DeviceErrorCodes.CONNECTION_TIMEOUT]: 'Connection timed out. Please check if the device is powered on and the IP address is correct.',
    [DeviceErrorCodes.AUTH_FAILED]: 'Authentication failed. Please verify the communication key.',
    [DeviceErrorCodes.UNREACHABLE]: 'Device is unreachable. Please check the network connection and IP address.',
    [DeviceErrorCodes.PROTOCOL_ERROR]: 'Communication error with the device. Please try again.',
    [DeviceErrorCodes.SIDECAR_NOT_READY]: 'Device communication service is not ready. Please restart the application.',
  };
  
  return {
    code,
    message: friendlyMessages[code],
    details: { originalError: message },
  };
}

/**
 * Device Communication Service
 */
export class DeviceCommunicationService {
  private sidecarClient: SidecarClient;

  constructor() {
    this.sidecarClient = SidecarClient.getInstance();
  }

  /**
   * Test connection to a ZKTeco device
   * Returns device info on success, or error details on failure
   */
  async testConnection(config: DeviceConfig): Promise<{
    success: boolean;
    deviceInfo?: DeviceInfo;
    error?: DeviceError;
    latency: number;
  }> {
    const startTime = Date.now();
    
    try {
      const result = await this.sidecarClient.testConnection(config);
      
      if (result.success && result.deviceInfo) {
        return {
          success: true,
          deviceInfo: result.deviceInfo,
          latency: result.latency,
        };
      }
      
      return {
        success: false,
        error: createDeviceError(result.error || 'Unknown error'),
        latency: result.latency,
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);
      
      return {
        success: false,
        error: createDeviceError(message),
        latency,
      };
    }
  }

  /**
   * Get device information
   */
  async getDeviceInfo(config: DeviceConfig): Promise<DeviceInfo> {
    try {
      return await this.sidecarClient.getDeviceInfo(config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const deviceError = createDeviceError(message);
      throw new Error(deviceError.message);
    }
  }

  /**
   * Get all users from the device
   */
  async getUsers(config: DeviceConfig): Promise<SidecarUser[]> {
    try {
      return await this.sidecarClient.getUsers(config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const deviceError = createDeviceError(message);
      throw new Error(deviceError.message);
    }
  }

  /**
   * Get attendance logs from the device
   */
  async getAttendanceLogs(
    config: DeviceConfig,
    options?: SidecarSyncOptions
  ): Promise<SidecarAttendanceLog[]> {
    try {
      return await this.sidecarClient.getAttendanceLogs(config, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const deviceError = createDeviceError(message);
      throw new Error(deviceError.message);
    }
  }

  /**
   * Combined sync: fetch users AND attendance logs in a single device session
   * Avoids concurrent connection issues with ZKTeco devices
   */
  async syncAll(
    config: DeviceConfig,
    options?: SidecarSyncOptions
  ): Promise<{ users: SidecarUser[]; logs: SidecarAttendanceLog[] }> {
    try {
      return await this.sidecarClient.syncAll(config, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[DeviceCommunication] syncAll error:', message);
      // Pass through the original error message so it's visible in sync results
      throw new Error(message);
    }
  }
}

// Export singleton instance
let deviceCommunicationService: DeviceCommunicationService | null = null;

export function getDeviceCommunicationService(): DeviceCommunicationService {
  if (!deviceCommunicationService) {
    deviceCommunicationService = new DeviceCommunicationService();
  }
  return deviceCommunicationService;
}

// Re-export types
export type { ConnectionTestResult, SidecarUser, SidecarAttendanceLog, SidecarSyncOptions };
