/**
 * Services exports
 */

export {
  RuleEngine,
  DEFAULT_ATTENDANCE_RULES,
  processDay,
  calculateLateMinutes,
  calculateEarlyMinutes,
  isWorkday,
  deriveAttendanceStatus,
  filterPunchesInWindow,
  parseTimeToMinutes,
  extractTimeFromTimestamp,
  extractDateFromTimestamp,
  isTimeInWindow,
} from './rule-engine';

export type { HolidayChecker } from './rule-engine';

export {
  ReportGenerator,
  getWeekStart,
  getWeekDates,
  getMonthDates,
  formatDate,
  summaryToDayAttendance,
  calculateWeeklySummary,
  calculateMonthlySummary,
  exportWeeklyReportToCSV,
  exportMonthlyReportToCSV,
  exportReportToCSV,
  parseCSV,
  isWeeklyReport,
} from './report-generator';

export {
  SidecarClient,
} from './sidecar-client';

export type {
  SidecarUser,
  SidecarAttendanceLog,
  SidecarSyncOptions,
  ConnectionTestResult,
} from './sidecar-client';

export {
  DeviceCommunicationService,
  DeviceErrorCodes,
  getDeviceCommunicationService,
} from './device-communication';

export type {
  DeviceErrorCode,
  DeviceError,
} from './device-communication';

export {
  UserSyncService,
  getUserSyncService,
  transformDeviceUserToAppUser,
  transformDeviceUsersToAppUsers,
} from './user-sync';

export type {
  UserSyncResult,
} from './user-sync';

export {
  AttendanceLogSyncService,
  getAttendanceLogSyncService,
  transformDeviceLogToAppLog,
  transformDeviceLogsToAppLogs,
} from './attendance-sync';

export type {
  CreateAttendanceLogInput,
  AttendanceLogSyncResult,
  AttendanceLogSyncOptions,
} from './attendance-sync';

export {
  SyncEngine,
  getSyncEngine,
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
  isInTransaction,
} from './sync-engine';

export type {
  SyncProgressCallback,
} from './sync-engine';

export {
  BackupManager,
  calculateChecksum,
  validateBackupStructure,
  verifyChecksum,
  APP_VERSION,
  BACKUP_VERSION,
} from './backup-manager';

export type {
  BackupDatabaseAdapter,
  BackupFileSystemAdapter,
  BackupData,
} from './backup-manager';

export {
  dashboardService,
  getDashboardStats,
  getLastSyncTime,
  getTodayAttendanceStats,
  calculateTodayStats,
} from './dashboard';

export type {
  DashboardStats,
  TodayAttendanceStats,
} from './dashboard';
