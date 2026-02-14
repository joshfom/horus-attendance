/**
 * Types for ZKTeco sidecar communication
 */

// ============================================================================
// Device Configuration
// ============================================================================

export interface DeviceConfig {
  ip: string;
  port: number;
  commKey?: string;
  timeout?: number;
}

// ============================================================================
// Device Info
// ============================================================================

export interface DeviceInfo {
  serialNumber: string;
  firmwareVersion: string;
  userCount: number;
  logCount: number;
  lastActivity: string;
}

// ============================================================================
// Connection Test Result
// ============================================================================

export interface ConnectionTestResult {
  success: boolean;
  deviceInfo?: DeviceInfo;
  error?: string;
  latency: number;
}

// ============================================================================
// Device User (from ZKTeco device)
// ============================================================================

export interface ZKDeviceUser {
  uid: number;
  userId: string;
  name: string;
  password?: string;
  role?: number;
  cardno?: string;
}

// ============================================================================
// App User Format (transformed)
// ============================================================================

export interface AppUser {
  deviceUserId: string;
  deviceName: string;
}

// ============================================================================
// Device Attendance Log (from ZKTeco device)
// ============================================================================

export interface ZKAttendanceLog {
  uid: number;
  id: number;
  state: number;
  timestamp: Date;
}

// ============================================================================
// App Attendance Log Format (transformed)
// ============================================================================

export interface AppAttendanceLog {
  deviceUserId: string;
  timestamp: string;
  verifyType: number;
  punchType: number;
}

// ============================================================================
// Sync Options
// ============================================================================

export interface SyncOptions {
  mode: 'all' | 'range';
  startDate?: string;
  endDate?: string;
}

// ============================================================================
// IPC Message Types
// ============================================================================

export type CommandType = 
  | 'testConnection'
  | 'getDeviceInfo'
  | 'getUsers'
  | 'getAttendanceLogs';

export interface IPCRequest {
  id: string;
  command: CommandType;
  params: Record<string, unknown>;
}

export interface IPCResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}
