/**
 * API response and error types for Horus Attendance Desktop
 */

// ============================================================================
// Generic API Response Types
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// Error Codes
// ============================================================================

export const ErrorCodes = {
  // Database errors
  DB_CONNECTION_ERROR: 'DB_CONNECTION_ERROR',
  DB_QUERY_ERROR: 'DB_QUERY_ERROR',
  DB_CONSTRAINT_VIOLATION: 'DB_CONSTRAINT_VIOLATION',
  DB_NOT_FOUND: 'DB_NOT_FOUND',
  
  // Device errors
  DEVICE_CONNECTION_TIMEOUT: 'DEVICE_CONNECTION_TIMEOUT',
  DEVICE_AUTH_FAILED: 'DEVICE_AUTH_FAILED',
  DEVICE_UNREACHABLE: 'DEVICE_UNREACHABLE',
  DEVICE_PROTOCOL_ERROR: 'DEVICE_PROTOCOL_ERROR',
  
  // Sync errors
  SYNC_IN_PROGRESS: 'SYNC_IN_PROGRESS',
  SYNC_FAILED: 'SYNC_FAILED',
  SYNC_PARTIAL_FAILURE: 'SYNC_PARTIAL_FAILURE',
  
  // Backup errors
  BACKUP_INVALID_FILE: 'BACKUP_INVALID_FILE',
  BACKUP_CORRUPTED: 'BACKUP_CORRUPTED',
  BACKUP_PERMISSION_DENIED: 'BACKUP_PERMISSION_DENIED',
  BACKUP_RESTORE_FAILED: 'BACKUP_RESTORE_FAILED',
  
  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',
  
  // General errors
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

// ============================================================================
// Pagination Types
// ============================================================================

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ============================================================================
// Sort Types
// ============================================================================

export type SortDirection = 'asc' | 'desc';

export interface SortParams<T extends string = string> {
  field: T;
  direction: SortDirection;
}

// ============================================================================
// Filter Types for Attendance Records
// ============================================================================

export interface AttendanceRecordFilter {
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  departmentId?: string;
  punchType?: number;
}

export type AttendanceRecordSortField = 'timestamp' | 'user' | 'department';

// ============================================================================
// Dashboard Statistics Types
// ============================================================================

// DashboardStats is defined in src/lib/services/dashboard.ts
// (uses nested TodayAttendanceStats object)

// ============================================================================
// Database Row Types (for SQLite queries)
// ============================================================================

export interface DeviceRow {
  id: string;
  name: string;
  ip: string;
  port: number;
  comm_key: string;
  timezone: string;
  sync_mode: string;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DepartmentRow {
  id: string;
  name: string;
  created_at: string;
  member_count?: number;
}

export interface UserRow {
  id: string;
  device_user_id: string | null;
  device_name: string | null;
  display_name: string;
  department_id: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  employee_code: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface AttendanceLogRow {
  id: string;
  device_id: string;
  device_user_id: string;
  timestamp: string;
  verify_type: number | null;
  punch_type: number | null;
  raw_payload: string | null;
  created_at: string;
}

export interface AttendanceSummaryRow {
  id: string;
  user_id: string;
  date: string;
  check_in_time: string | null;
  check_out_time: string | null;
  is_incomplete: number;
  late_minutes: number;
  early_minutes: number;
  status: string;
  flags: string | null;
  created_at: string;
  updated_at: string;
}

export interface SettingsRow {
  key: string;
  value: string;
  updated_at: string;
}

export interface HolidayRow {
  id: string;
  date: string;
  name: string | null;
  created_at: string;
}
