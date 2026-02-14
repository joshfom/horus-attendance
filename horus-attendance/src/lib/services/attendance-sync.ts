/**
 * Attendance Log Sync Service
 * 
 * Handles synchronization of attendance logs from ZKTeco devices to the local database.
 * Transforms device attendance log format to app format.
 */

import type { DeviceConfig } from '../../types/models';
import type { SidecarAttendanceLog, SidecarSyncOptions } from './sidecar-client';
import { getDeviceCommunicationService } from './device-communication';

/**
 * Input for creating an attendance log record
 */
export interface CreateAttendanceLogInput {
  deviceId: string;
  deviceUserId: string;
  timestamp: string;
  verifyType: number;
  punchType: number;
  rawPayload?: string | null;
  userName?: string | null;
}

/**
 * Result of attendance log sync operation
 */
export interface AttendanceLogSyncResult {
  success: boolean;
  logsAdded: number;
  logsDeduplicated: number;
  totalLogs: number;
  errors: string[];
}

/**
 * Options for syncing attendance logs
 */
export interface AttendanceLogSyncOptions {
  mode: 'all' | 'latest' | 'days' | 'range';
  days?: number;
  startDate?: string;
  endDate?: string;
}

/**
 * Transform a device attendance log to app format
 */
export function transformDeviceLogToAppLog(
  deviceLog: SidecarAttendanceLog,
  deviceId: string
): CreateAttendanceLogInput {
  return {
    deviceId,
    deviceUserId: deviceLog.deviceUserId,
    timestamp: deviceLog.timestamp,
    verifyType: deviceLog.verifyType,
    punchType: deviceLog.punchType,
    rawPayload: null,
    userName: deviceLog.userName || null,
  };
}

/**
 * Transform multiple device logs to app format
 */
export function transformDeviceLogsToAppLogs(
  deviceLogs: SidecarAttendanceLog[],
  deviceId: string
): CreateAttendanceLogInput[] {
  return deviceLogs.map((log) => transformDeviceLogToAppLog(log, deviceId));
}

/**
 * Convert sync options to sidecar format
 */
function toSidecarSyncOptions(options: AttendanceLogSyncOptions): SidecarSyncOptions | undefined {
  switch (options.mode) {
    case 'all':
      return { mode: 'all' };
    
    case 'latest':
      // For latest, we'll get all and let the database handle deduplication
      return { mode: 'all' };
    
    case 'days':
      if (options.days) {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - options.days);
        const result: SidecarSyncOptions = {
          mode: 'range',
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0],
        };
        return result;
      }
      return { mode: 'all' };
    
    case 'range':
      if (options.startDate && options.endDate) {
        const result: SidecarSyncOptions = {
          mode: 'range',
          startDate: options.startDate,
          endDate: options.endDate,
        };
        return result;
      }
      return { mode: 'all' };
    
    default:
      return { mode: 'all' };
  }
}

/**
 * Attendance Log Sync Service class
 */
export class AttendanceLogSyncService {
  private deviceCommunication = getDeviceCommunicationService();

  /**
   * Pull attendance logs from a device
   * Returns the raw device logs in app format
   */
  async pullLogsFromDevice(
    config: DeviceConfig,
    options: AttendanceLogSyncOptions = { mode: 'all' }
  ): Promise<{
    success: boolean;
    logs: CreateAttendanceLogInput[];
    error?: string;
  }> {
    try {
      const sidecarOptions = toSidecarSyncOptions(options);
      const deviceLogs = await this.deviceCommunication.getAttendanceLogs(config, sidecarOptions);
      const appLogs = transformDeviceLogsToAppLogs(deviceLogs, config.id);
      
      return {
        success: true,
        logs: appLogs,
      };
    } catch (error) {
      return {
        success: false,
        logs: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Sync attendance logs from device
   * This method pulls logs from the device and returns them for database insertion
   * The actual database operations (including deduplication) should be handled by the caller
   */
  async syncLogsFromDevice(
    config: DeviceConfig,
    options: AttendanceLogSyncOptions = { mode: 'all' }
  ): Promise<{
    logs: CreateAttendanceLogInput[];
    error?: string | undefined;
  }> {
    const result = await this.pullLogsFromDevice(config, options);
    
    if (!result.success) {
      return {
        logs: [],
        error: result.error,
      };
    }

    return {
      logs: result.logs,
    };
  }

  /**
   * Filter logs by date range (client-side filtering)
   */
  filterLogsByDateRange(
    logs: CreateAttendanceLogInput[],
    startDate: string,
    endDate: string
  ): CreateAttendanceLogInput[] {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    return logs.filter((log) => {
      const logDate = new Date(log.timestamp);
      return logDate >= start && logDate <= end;
    });
  }

  /**
   * Sort logs by timestamp
   */
  sortLogsByTimestamp(
    logs: CreateAttendanceLogInput[],
    direction: 'asc' | 'desc' = 'asc'
  ): CreateAttendanceLogInput[] {
    return [...logs].sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return direction === 'asc' ? timeA - timeB : timeB - timeA;
    });
  }
}

// Export singleton instance
let attendanceLogSyncService: AttendanceLogSyncService | null = null;

export function getAttendanceLogSyncService(): AttendanceLogSyncService {
  if (!attendanceLogSyncService) {
    attendanceLogSyncService = new AttendanceLogSyncService();
  }
  return attendanceLogSyncService;
}
