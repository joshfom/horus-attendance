/**
 * ZKTeco device client wrapper
 * Handles communication with ZKTeco Horus E1-FP biometric devices
 */

import type {
  DeviceConfig,
  DeviceInfo,
  ConnectionTestResult,
  ZKDeviceUser,
  ZKAttendanceLog,
  AppUser,
  AppAttendanceLog,
  SyncOptions,
} from './types.js';

// Dynamic import for zklib (CommonJS module)
let ZKLib: any = null;

async function getZKLib() {
  if (!ZKLib) {
    try {
      // Try to import node-zklib
      const module = await import('node-zklib');
      ZKLib = module.default || module;
    } catch (error) {
      throw new Error('Failed to load ZKTeco library: ' + (error as Error).message);
    }
  }
  return ZKLib;
}

export class ZKTecoClient {
  private config: DeviceConfig;
  private zkInstance: any = null;

  constructor(config: DeviceConfig) {
    this.config = {
      ip: config.ip,
      port: config.port || 4370,
      commKey: config.commKey || '',
      timeout: config.timeout || 10000,
    };
  }

  /**
   * Create a new ZKLib instance
   */
  private async createInstance(): Promise<any> {
    const ZK = await getZKLib();
    return new ZK(this.config.ip, this.config.port, this.config.timeout, 4000);
  }

  /**
   * Ensure we have a connected instance, with retry
   */
  private async ensureConnected(retries = 2): Promise<void> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (!this.zkInstance) {
          this.zkInstance = await this.createInstance();
        }
        await this.zkInstance.createSocket();
        return;
      } catch (error) {
        console.log(`[ZKTecoClient] Connection attempt ${attempt + 1} failed:`, this.formatError(error));
        // Reset instance for retry
        this.zkInstance = null;
        if (attempt === retries) {
          throw error;
        }
        // Wait a bit before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * Test connection to the device
   */
  async testConnection(): Promise<ConnectionTestResult> {
    const startTime = Date.now();
    
    try {
      await this.ensureConnected();
      
      // Get device info to verify connection
      const deviceInfo = await this.getDeviceInfo();
      
      const latency = Date.now() - startTime;
      
      return {
        success: true,
        deviceInfo,
        latency,
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      
      return {
        success: false,
        error: this.formatError(error),
        latency,
      };
    }
  }

  /**
   * Get device information
   */
  async getDeviceInfo(): Promise<DeviceInfo> {
    try {
      if (!this.zkInstance) {
        await this.ensureConnected();
      }

      // Get users and logs count - these are the most reliable methods
      const [users, logs] = await Promise.all([
        this.zkInstance.getUsers().catch(() => ({ data: [] })),
        this.zkInstance.getAttendances().catch(() => ({ data: [] })),
      ]);

      // Try to get serial number if available
      let serialNumber = 'Unknown';
      let firmwareVersion = 'Unknown';
      
      try {
        if (typeof this.zkInstance.getSerialNumber === 'function') {
          serialNumber = await this.zkInstance.getSerialNumber();
        }
      } catch {
        // Ignore - not all devices support this
      }
      
      try {
        if (typeof this.zkInstance.getFirmware === 'function') {
          firmwareVersion = await this.zkInstance.getFirmware();
        }
      } catch {
        // Ignore - not all devices support this
      }

      return {
        serialNumber: serialNumber || 'Unknown',
        firmwareVersion: firmwareVersion || 'Unknown',
        userCount: users?.data?.length || 0,
        logCount: logs?.data?.length || 0,
        lastActivity: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error('Failed to get device info: ' + this.formatError(error));
    }
  }

  /**
   * Get all users from the device
   */
  async getUsers(): Promise<AppUser[]> {
    try {
      if (!this.zkInstance) {
        await this.ensureConnected();
      }

      const result = await this.zkInstance.getUsers();
      const zkUsers: ZKDeviceUser[] = result?.data || [];

      // Debug: Log raw user data
      console.log('[sidecar] ===== RAW USER DATA =====');
      for (let i = 0; i < Math.min(10, zkUsers.length); i++) {
        console.log(`[sidecar] User ${i}:`, JSON.stringify(zkUsers[i]));
      }
      console.log('[sidecar] ===== END RAW USER DATA =====');

      return zkUsers.map((user) => this.transformUser(user));
    } catch (error) {
      throw new Error('Failed to get users: ' + this.formatError(error));
    }
  }

  /**
   * Get attendance logs from the device
   * 
   * NOTE: There's a known issue with some ZKTeco devices where the user ID
   * is not properly stored in attendance records. The device may store a
   * constant value (like "001") instead of the actual user ID. In such cases,
   * attendance records cannot be correctly mapped to users.
   */
  /**
   * Get attendance logs from the device
   * Also parses verify_type and in_out_state from raw 40-byte records
   */
  async getAttendanceLogs(options?: SyncOptions): Promise<AppAttendanceLog[]> {
    try {
      if (!this.zkInstance) {
        await this.ensureConnected();
      }

      const result = await this.zkInstance.getAttendances();
      let zkLogs: ZKAttendanceLog[] = result?.data || [];
      
      console.log('[sidecar] Total attendance logs from device:', zkLogs.length);
      
      // Debug: Log the raw structure of the first few records with ALL fields
      if (zkLogs.length > 0) {
        console.log('[sidecar] ===== RAW ATTENDANCE DATA =====');
        for (let i = 0; i < Math.min(5, zkLogs.length); i++) {
          console.log(`[sidecar] Record ${i}: ${JSON.stringify(zkLogs[i])}`);
        }
        // Also check some records from the middle
        if (zkLogs.length > 100) {
          console.log(`[sidecar] Record 100: ${JSON.stringify(zkLogs[100])}`);
        }
        console.log('[sidecar] ===== END RAW ATTENDANCE DATA =====');
      }

      // Filter by date range if specified
      if (options?.mode === 'range' && options.startDate && options.endDate) {
        const startDate = new Date(options.startDate);
        const endDate = new Date(options.endDate);
        endDate.setHours(23, 59, 59, 999);

        zkLogs = zkLogs.filter((log) => {
          try {
            // The raw record has recordTime (from decodeRecordData40), not timestamp
            const rawLog = log as any;
            const logDate = new Date(rawLog.recordTime || rawLog.timestamp || log.timestamp);
            return !isNaN(logDate.getTime()) && logDate >= startDate && logDate <= endDate;
          } catch {
            return false;
          }
        });
      }

      return zkLogs.map((log) => this.transformAttendanceLog(log));
    } catch (error) {
      throw new Error('Failed to get attendance logs: ' + this.formatError(error));
    }
  }
  
  /**
   * Parse ZKTeco timestamp format
   */
  private parseZKTime(timeValue: number): Date {
    const second = timeValue % 60;
    timeValue = Math.floor(timeValue / 60);
    const minute = timeValue % 60;
    timeValue = Math.floor(timeValue / 60);
    const hour = timeValue % 24;
    timeValue = Math.floor(timeValue / 24);
    const day = (timeValue % 31) + 1;
    timeValue = Math.floor(timeValue / 31);
    const month = timeValue % 12;
    timeValue = Math.floor(timeValue / 12);
    const year = timeValue + 2000;
    
    return new Date(year, month, day, hour, minute, second);
  }

  /**
   * Disconnect from the device
   */
  async disconnect(): Promise<void> {
    try {
      if (this.zkInstance) {
        await this.zkInstance.disconnect();
        this.zkInstance = null;
      }
    } catch {
      // Ignore disconnect errors
      this.zkInstance = null;
    }
  }

  /**
   * Transform ZKTeco user to app format
   */
  private transformUser(zkUser: ZKDeviceUser): AppUser {
    // Use userId (enrollment/device ID) NOT uid (internal sequential ID)
    // Attendance records reference userId, not uid
    // e.g. Andrea: uid=82, userId="66" — attendance records have deviceUserId="66"
    return {
      deviceUserId: String(zkUser.userId || zkUser.uid),
      deviceName: zkUser.name || `User ${zkUser.userId || zkUser.uid}`,
    };
  }

  /**
   * Transform ZKTeco attendance log to app format
   * 
   * IMPORTANT: This device stores "001" as deviceUserId for ALL records.
   * The userSn field is a sequential record counter, NOT a user ID.
   * We use the raw deviceUserId field as-is.
   */
  private transformAttendanceLog(zkLog: ZKAttendanceLog): AppAttendanceLog {
    const log = zkLog as any;
    
    let timestamp: string;
    try {
      const rawTime = log.recordTime || log.timestamp || log.time;
      
      if (rawTime instanceof Date) {
        timestamp = rawTime.toISOString();
      } else if (typeof rawTime === 'string') {
        const date = new Date(rawTime);
        timestamp = isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
      } else if (typeof rawTime === 'number') {
        timestamp = new Date(rawTime).toISOString();
      } else {
        timestamp = new Date().toISOString();
      }
    } catch {
      timestamp = new Date().toISOString();
    }

    // Use the raw deviceUserId from the record
    // This contains the user's uid from the device (e.g., "67" for Maria, "86" for Abijith)
    // Some early setup records may have "001" but most have the actual user uid
    const userId = log.deviceUserId || 'unknown';

    return {
      deviceUserId: userId,
      timestamp,
      verifyType: log.verifyType ?? log.state ?? log.type ?? 0,
      punchType: log.inOutState ?? log.punchType ?? 0,
    };
  }

  /**
   * Format error message
   */
  private formatError(error: unknown): string {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      
      if (message.includes('timeout') || message.includes('etimedout')) {
        return 'Connection timeout - device may be unreachable or IP/port incorrect';
      }
      if (message.includes('econnrefused')) {
        return 'Connection refused - check if device is powered on and network accessible';
      }
      if (message.includes('ehostunreach')) {
        return 'Host unreachable - check network configuration';
      }
      if (message.includes('auth') || message.includes('password')) {
        return 'Authentication failed - check communication key';
      }
      
      return error.message;
    }
    // Handle plain objects (node-zklib often throws these)
    if (error && typeof error === 'object') {
      try {
        return JSON.stringify(error);
      } catch {
        return Object.prototype.toString.call(error);
      }
    }
    return String(error);
  }
}
