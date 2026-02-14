/**
 * Type exports for Horus Attendance Desktop
 */

// Data models
export type {
  Device,
  DeviceConfig,
  DeviceInfo,
  Department,
  CreateDepartmentInput,
  UpdateDepartmentInput,
  User,
  UserStatus,
  DeviceUser,
  CreateUserInput,
  UpdateUserInput,
  UserFilter,
  AttendanceStatus,
  PunchRecord,
  AttendanceLog,
  DailySummary,
  DayAttendance,
  WeeklySummary,
  WeeklyReportRow,
  MonthlySummary,
  MonthlyReportRow,
  ReportFilter,
  AttendanceRules,
  AppearanceSettings,
  BackupSettings,
  AppSettings,
  ExportSettings,
  Holiday,
  CreateHolidayInput,
} from './models';

// Service interfaces
export type {
  SyncOptions,
  SyncResult,
  ConnectionTestResult,
  SyncStatus,
  SyncProgress,
  SyncEngine,
  UserDirectoryService,
  DepartmentService,
  ReportGenerator,
  RuleEngine,
  BackupMetadata,
  BackupResult,
  RestoreResult,
  BackupManager,
  SettingsService,
  DeviceRepository,
  HolidayRepository,
} from './services';

// API types
export type {
  ApiResponse,
  ApiError,
  ErrorCode,
  PaginationParams,
  PaginatedResponse,
  SortDirection,
  SortParams,
  AttendanceRecordFilter,
  AttendanceRecordSortField,
  DashboardStats,
  DeviceRow,
  DepartmentRow,
  UserRow,
  AttendanceLogRow,
  AttendanceSummaryRow,
  SettingsRow,
  HolidayRow,
} from './api';

export { ErrorCodes } from './api';
