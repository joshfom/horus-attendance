/**
 * Data model types for Horus Attendance Desktop
 */

// ============================================================================
// Device Types
// ============================================================================

export interface Device {
  id: string;
  name: string;
  ip: string;
  port: number;
  commKey: string;
  timezone: string;
  syncMode: 'auto' | 'manual';
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceConfig {
  id: string;
  name: string;
  ip: string;
  port: number;
  commKey: string;
  timezone: string;
  syncMode: 'auto' | 'manual';
}

export interface DeviceInfo {
  serialNumber: string;
  firmwareVersion: string;
  userCount: number;
  logCount: number;
  lastActivity: string;
}

// ============================================================================
// Department Types
// ============================================================================

export interface Department {
  id: string;
  name: string;
  createdAt: string;
  memberCount?: number;
}

export interface CreateDepartmentInput {
  name: string;
}

export interface UpdateDepartmentInput {
  name: string;
}

// ============================================================================
// User Types
// ============================================================================

export type UserStatus = 'active' | 'inactive';

export interface User {
  id: string;
  deviceUserId: string | null;
  deviceName: string | null;
  displayName: string;
  departmentId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  employeeCode: string | null;
  notes: string | null;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceUser {
  deviceUserId: string;
  deviceName: string;
  deviceId: string;
}

export interface CreateUserInput {
  deviceUserId?: string;
  deviceName?: string;
  displayName: string;
  departmentId?: string;
  email?: string;
  phone?: string;
  address?: string;
  employeeCode?: string;
  notes?: string;
  status?: UserStatus;
}

export interface UpdateUserInput {
  displayName?: string;
  departmentId?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  employeeCode?: string | null;
  notes?: string | null;
  status?: UserStatus;
}

export interface UserFilter {
  search?: string;
  departmentId?: string;
  status?: UserStatus | 'all';
  linkedOnly?: boolean;
}


// ============================================================================
// Attendance Types
// ============================================================================

export type AttendanceStatus = 
  | 'present' 
  | 'absent' 
  | 'late' 
  | 'early_leave' 
  | 'incomplete' 
  | 'holiday' 
  | 'weekend';

export interface PunchRecord {
  id: string;
  deviceId: string;
  deviceUserId: string;
  timestamp: string;
  verifyType: number;
  punchType: number;
  rawPayload?: string;
  createdAt: string;
}

export interface AttendanceLog {
  id: string;
  deviceId: string;
  deviceUserId: string;
  timestamp: string;
  verifyType: number;
  punchType: number;
  rawPayload: string | null;
  createdAt: string;
}

export interface DailySummary {
  id: string;
  userId: string;
  date: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  isIncomplete: boolean;
  lateMinutes: number;
  earlyMinutes: number;
  status: AttendanceStatus;
  flags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DayAttendance {
  date: string;
  dayOfWeek: number;
  checkIn: string | null;
  checkOut: string | null;
  status: AttendanceStatus;
  lateMinutes: number;
  earlyMinutes: number;
  isIncomplete: boolean;
}

// ============================================================================
// Report Types
// ============================================================================

export interface WeeklySummary {
  daysPresent: number;
  daysAbsent: number;
  totalLateMinutes: number;
  totalEarlyMinutes: number;
  incompleteDays: number;
}

export interface WeeklyReportRow {
  user: User;
  days: DayAttendance[];
  summary: WeeklySummary;
}

export interface MonthlySummary {
  daysPresent: number;
  daysAbsent: number;
  totalLateMinutes: number;
  totalEarlyMinutes: number;
  incompleteDays: number;
  totalWorkingDays: number;
  attendancePercentage: number;
}

export interface MonthlyReportRow {
  user: User;
  summary: MonthlySummary;
  dailyDetails: DayAttendance[];
}

export interface ReportFilter {
  departmentId?: string;
  userIds?: string[];
}

// ============================================================================
// Settings Types
// ============================================================================

export interface AttendanceRules {
  workStartTime: string; // HH:mm format
  workEndTime: string;
  lateGracePeriod: number; // minutes
  earlyLeaveGracePeriod: number; // minutes
  checkInWindowStart: string; // HH:mm
  checkInWindowEnd: string;
  checkOutWindowStart: string;
  checkOutWindowEnd: string;
  workdays: number[]; // 0=Sunday, 1=Monday, etc.
}

export interface AppearanceSettings {
  theme: 'light' | 'dark' | 'system';
}

export interface BackupSettings {
  autoBackup: boolean;
  backupPath: string;
  lastBackupAt: string | null;
}

export interface ExportSettings {
  /** Time threshold — arrivals at or before this are "early/on-time" (green) */
  onTimeThreshold: string; // HH:mm
  /** Time threshold — arrivals after this are "late" (orange) */
  lateThreshold: string; // HH:mm
  /** Hex colors for Excel cell fills */
  colors: {
    onTime: string;    // green
    between: string;   // yellow
    late: string;      // orange
    absent: string;    // red
    weekend: string;   // blue
    header: string;    // header background
  };
}

export interface TimezoneSettings {
  /** IANA timezone identifier, e.g. 'Asia/Dubai' */
  timezone: string;
  /** Display format for times: 12h or 24h */
  timeFormat: '12h' | '24h';
}

export interface AppSettings {
  device: DeviceConfig | null;
  attendance: AttendanceRules;
  holidays: string[]; // ISO date strings
  appearance: AppearanceSettings;
  backup: BackupSettings;
  export: ExportSettings;
  timezone: TimezoneSettings;
}

// ============================================================================
// Holiday Types
// ============================================================================

export interface Holiday {
  id: string;
  date: string;
  name: string | null;
  createdAt: string;
}

export interface CreateHolidayInput {
  date: string;
  name?: string;
}
