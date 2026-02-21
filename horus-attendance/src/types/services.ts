/**
 * Service interface types for Horus Attendance Desktop
 */

import type {
  Device,
  DeviceConfig,
  DeviceInfo,
  DeviceUser,
  Department,
  User,
  UserFilter,
  CreateUserInput,
  UpdateUserInput,
  CreateDepartmentInput,
  UpdateDepartmentInput,
  PunchRecord,
  DailySummary,
  WeeklyReportRow,
  MonthlyReportRow,
  ReportFilter,
  AttendanceRules,
  AppSettings,
  Holiday,
  CreateHolidayInput,
} from './models';

// ============================================================================
// Sync Engine Types
// ============================================================================

export interface SyncOptions {
  mode: 'latest' | 'days' | 'range';
  days?: number;
  startDate?: string;
  endDate?: string;
}

export interface SyncResult {
  success: boolean;
  usersAdded: number;
  usersSynced: number;
  logsAdded: number;
  logsDeduplicated: number;
  errors: string[];
  syncedAt: string;
}

export interface ConnectionTestResult {
  success: boolean;
  deviceInfo?: DeviceInfo;
  error?: string;
  latency: number;
}

export interface SyncStatus {
  deviceId: string;
  lastSyncAt: string | null;
  isSyncing: boolean;
  progress?: SyncProgress;
}

export interface SyncProgress {
  phase: 'connecting' | 'fetching' | 'users' | 'logs' | 'processing' | 'complete';
  current: number;
  total: number;
  message: string;
  /** Detailed record counts for granular progress */
  details?: {
    totalRecordsFetched?: number;
    usersTotal?: number;
    usersProcessed?: number;
    logsTotal?: number;
    logsProcessed?: number;
    summariesTotal?: number;
    summariesProcessed?: number;
    startedAt?: string;
  };
}

export interface SyncEngine {
  testConnection(config: DeviceConfig): Promise<ConnectionTestResult>;
  syncDevice(deviceId: string, options: SyncOptions): Promise<SyncResult>;
  getDeviceInfo(config: DeviceConfig): Promise<DeviceInfo>;
  getSyncStatus(deviceId: string): Promise<SyncStatus>;
}

// ============================================================================
// User Directory Service Types
// ============================================================================

export interface UserDirectoryService {
  listUsers(filter: UserFilter): Promise<User[]>;
  getUser(id: string): Promise<User | null>;
  createUser(data: CreateUserInput): Promise<User>;
  updateUser(id: string, data: UpdateUserInput): Promise<User>;
  linkDeviceUser(userId: string, deviceUserId: string): Promise<User>;
  getUnlinkedDeviceUsers(): Promise<DeviceUser[]>;
  searchUsers(query: string): Promise<User[]>;
}

// ============================================================================
// Department Service Types
// ============================================================================

export interface DepartmentService {
  listDepartments(): Promise<Department[]>;
  getDepartment(id: string): Promise<Department | null>;
  createDepartment(data: CreateDepartmentInput): Promise<Department>;
  updateDepartment(id: string, data: UpdateDepartmentInput): Promise<Department>;
  deleteDepartment(id: string): Promise<void>;
  getDepartmentMembers(id: string): Promise<User[]>;
}


// ============================================================================
// Report Generator Types
// ============================================================================

export interface ReportGenerator {
  generateWeeklyReport(weekStart: string, filter?: ReportFilter): Promise<WeeklyReportRow[]>;
  generateMonthlyReport(year: number, month: number, filter?: ReportFilter): Promise<MonthlyReportRow[]>;
  exportToCSV(report: WeeklyReportRow[] | MonthlyReportRow[], filename: string): Promise<string>;
}

// ============================================================================
// Rule Engine Types
// ============================================================================

export interface RuleEngine {
  processDay(userId: string, date: string, punches: PunchRecord[]): DailySummary;
  calculateLateMinutes(checkInTime: string, rules: AttendanceRules): number;
  calculateEarlyMinutes(checkOutTime: string, rules: AttendanceRules): number;
  isWorkday(date: string, rules: AttendanceRules): boolean;
  isHoliday(date: string): Promise<boolean>;
}

// ============================================================================
// Backup Manager Types
// ============================================================================

export interface BackupMetadata {
  version: string;
  createdAt: string;
  appVersion: string;
  userCount: number;
  logCount: number;
  checksum: string;
}

export interface BackupResult {
  success: boolean;
  filePath: string;
  fileSize: number;
  metadata: BackupMetadata;
}

export interface RestoreResult {
  success: boolean;
  usersRestored: number;
  logsRestored: number;
  error?: string;
}

export interface BackupManager {
  createBackup(destinationPath?: string): Promise<BackupResult>;
  restoreBackup(filePath: string): Promise<RestoreResult>;
  validateBackup(filePath: string): Promise<BackupMetadata | null>;
  getBackupHistory(): Promise<BackupMetadata[]>;
}

// ============================================================================
// Settings Service Types
// ============================================================================

export interface SettingsService {
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: Partial<AppSettings>): Promise<AppSettings>;
  getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]>;
  setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void>;
  resetToDefaults(): Promise<AppSettings>;
}

// ============================================================================
// Device Repository Types
// ============================================================================

export interface DeviceRepository {
  getDeviceById(id: string): Promise<Device | null>;
  listDevices(): Promise<Device[]>;
  saveDevice(device: DeviceConfig): Promise<Device>;
  updateDevice(id: string, device: Partial<DeviceConfig>): Promise<Device>;
  deleteDevice(id: string): Promise<void>;
  updateLastSyncAt(id: string, syncedAt: string): Promise<void>;
}

// ============================================================================
// Holiday Repository Types
// ============================================================================

export interface HolidayRepository {
  listHolidays(): Promise<Holiday[]>;
  getHoliday(id: string): Promise<Holiday | null>;
  getHolidayByDate(date: string): Promise<Holiday | null>;
  createHoliday(data: CreateHolidayInput): Promise<Holiday>;
  deleteHoliday(id: string): Promise<void>;
  isHoliday(date: string): Promise<boolean>;
}
