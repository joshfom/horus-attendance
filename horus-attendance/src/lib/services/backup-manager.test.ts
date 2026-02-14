/**
 * Property-based tests for Backup Manager
 * Property 22: Backup and Restore Round-Trip
 * Property 23: Backup Validation
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fc from 'fast-check';
import {
  initTestDatabase,
  closeTestDatabase,
  resetTestDatabase,
  testExecute,
  testSelect,
} from '../test-utils';
import {
  BackupManager,
  calculateChecksum,
  validateBackupStructure,
  verifyChecksum,
  type BackupDatabaseAdapter,
  type BackupFileSystemAdapter,
  type BackupData,
} from './backup-manager';

// Initialize test database
initTestDatabase();

// Helper functions
function generateId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

// Database row types
interface DepartmentRow {
  id: string;
  name: string;
  created_at: string;
}

interface UserRow {
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

interface DeviceRow {
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

interface AttendanceLogRow {
  id: string;
  device_id: string;
  device_user_id: string;
  timestamp: string;
  verify_type: number;
  punch_type: number;
  raw_payload: string | null;
  created_at: string;
}

interface AttendanceSummaryRow {
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

interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

interface HolidayRow {
  id: string;
  date: string;
  name: string | null;
  created_at: string;
}

// In-memory file system for testing
const fileSystem: Map<string, string> = new Map();

// Test database adapter implementation
const testDbAdapter: BackupDatabaseAdapter = {
  async getUserCount(): Promise<number> {
    const rows = testSelect<{ count: number }>('SELECT COUNT(*) as count FROM users');
    return rows[0]?.count ?? 0;
  },

  async getLogCount(): Promise<number> {
    const rows = testSelect<{ count: number }>('SELECT COUNT(*) as count FROM attendance_logs_raw');
    return rows[0]?.count ?? 0;
  },

  async getAllUsers(): Promise<UserRow[]> {
    return testSelect<UserRow>('SELECT * FROM users');
  },

  async getAllDepartments(): Promise<DepartmentRow[]> {
    return testSelect<DepartmentRow>('SELECT * FROM departments');
  },

  async getAllDevices(): Promise<DeviceRow[]> {
    return testSelect<DeviceRow>('SELECT * FROM devices');
  },

  async getAllAttendanceLogs(): Promise<AttendanceLogRow[]> {
    return testSelect<AttendanceLogRow>('SELECT * FROM attendance_logs_raw');
  },

  async getAllAttendanceSummaries(): Promise<AttendanceSummaryRow[]> {
    return testSelect<AttendanceSummaryRow>('SELECT * FROM attendance_day_summary');
  },

  async getAllSettings(): Promise<SettingRow[]> {
    return testSelect<SettingRow>('SELECT * FROM settings');
  },

  async getAllHolidays(): Promise<HolidayRow[]> {
    return testSelect<HolidayRow>('SELECT * FROM holidays');
  },

  async clearAllData(): Promise<void> {
    testExecute('DELETE FROM attendance_day_summary');
    testExecute('DELETE FROM attendance_logs_raw');
    testExecute('DELETE FROM users');
    testExecute('DELETE FROM departments');
    testExecute('DELETE FROM devices');
    testExecute('DELETE FROM settings');
    testExecute('DELETE FROM holidays');
  },

  async restoreUsers(users: unknown[]): Promise<number> {
    let count = 0;
    for (const user of users as UserRow[]) {
      testExecute(
        `INSERT INTO users (id, device_user_id, device_name, display_name, department_id, email, phone, address, employee_code, notes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [user.id, user.device_user_id, user.device_name, user.display_name, user.department_id, user.email, user.phone, user.address, user.employee_code, user.notes, user.status, user.created_at, user.updated_at]
      );
      count++;
    }
    return count;
  },

  async restoreDepartments(departments: unknown[]): Promise<number> {
    let count = 0;
    for (const dept of departments as DepartmentRow[]) {
      testExecute(
        'INSERT INTO departments (id, name, created_at) VALUES (?, ?, ?)',
        [dept.id, dept.name, dept.created_at]
      );
      count++;
    }
    return count;
  },

  async restoreDevices(devices: unknown[]): Promise<number> {
    let count = 0;
    for (const device of devices as DeviceRow[]) {
      testExecute(
        `INSERT INTO devices (id, name, ip, port, comm_key, timezone, sync_mode, last_sync_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [device.id, device.name, device.ip, device.port, device.comm_key, device.timezone, device.sync_mode, device.last_sync_at, device.created_at, device.updated_at]
      );
      count++;
    }
    return count;
  },

  async restoreAttendanceLogs(logs: unknown[]): Promise<number> {
    let count = 0;
    for (const log of logs as AttendanceLogRow[]) {
      testExecute(
        `INSERT INTO attendance_logs_raw (id, device_id, device_user_id, timestamp, verify_type, punch_type, raw_payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [log.id, log.device_id, log.device_user_id, log.timestamp, log.verify_type, log.punch_type, log.raw_payload, log.created_at]
      );
      count++;
    }
    return count;
  },

  async restoreAttendanceSummaries(summaries: unknown[]): Promise<number> {
    let count = 0;
    for (const summary of summaries as AttendanceSummaryRow[]) {
      testExecute(
        `INSERT INTO attendance_day_summary (id, user_id, date, check_in_time, check_out_time, is_incomplete, late_minutes, early_minutes, status, flags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [summary.id, summary.user_id, summary.date, summary.check_in_time, summary.check_out_time, summary.is_incomplete, summary.late_minutes, summary.early_minutes, summary.status, summary.flags, summary.created_at, summary.updated_at]
      );
      count++;
    }
    return count;
  },

  async restoreSettings(settings: unknown[]): Promise<number> {
    let count = 0;
    for (const setting of settings as SettingRow[]) {
      testExecute(
        'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
        [setting.key, setting.value, setting.updated_at]
      );
      count++;
    }
    return count;
  },

  async restoreHolidays(holidays: unknown[]): Promise<number> {
    let count = 0;
    for (const holiday of holidays as HolidayRow[]) {
      testExecute(
        'INSERT INTO holidays (id, date, name, created_at) VALUES (?, ?, ?, ?)',
        [holiday.id, holiday.date, holiday.name, holiday.created_at]
      );
      count++;
    }
    return count;
  },
};

// Test file system adapter implementation
const testFsAdapter: BackupFileSystemAdapter = {
  async writeFile(path: string, content: string): Promise<void> {
    fileSystem.set(path, content);
  },

  async readFile(path: string): Promise<string> {
    const content = fileSystem.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  },

  async fileExists(path: string): Promise<boolean> {
    return fileSystem.has(path);
  },

  async getFileSize(path: string): Promise<number> {
    const content = fileSystem.get(path);
    return content ? content.length : 0;
  },

  async getDefaultBackupPath(): Promise<string> {
    return '/backups';
  },
};

// Helper functions for creating test data
function createDepartment(name: string): string {
  const id = generateId();
  const timestamp = now();
  testExecute(
    'INSERT INTO departments (id, name, created_at) VALUES (?, ?, ?)',
    [id, name, timestamp]
  );
  return id;
}

function createUser(data: {
  displayName: string;
  departmentId?: string;
  deviceUserId?: string;
  deviceName?: string;
  status?: string;
}): string {
  const id = generateId();
  const timestamp = now();
  testExecute(
    `INSERT INTO users (id, device_user_id, device_name, display_name, department_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.deviceUserId || null, data.deviceName || null, data.displayName, data.departmentId || null, data.status || 'active', timestamp, timestamp]
  );
  return id;
}

function createDevice(data: {
  name: string;
  ip: string;
  port?: number;
}): string {
  const id = generateId();
  const timestamp = now();
  testExecute(
    `INSERT INTO devices (id, name, ip, port, comm_key, timezone, sync_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.name, data.ip, data.port || 4370, '', 'UTC', 'manual', timestamp, timestamp]
  );
  return id;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function createAttendanceLog(data: {
  deviceId: string;
  deviceUserId: string;
  timestamp: string;
}): string {
  const id = generateId();
  const createdAt = now();
  testExecute(
    `INSERT INTO attendance_logs_raw (id, device_id, device_user_id, timestamp, verify_type, punch_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, data.deviceId, data.deviceUserId, data.timestamp, 0, 0, createdAt]
  );
  return id;
}

function createHoliday(date: string, name?: string): string {
  const id = generateId();
  const timestamp = now();
  testExecute(
    'INSERT INTO holidays (id, date, name, created_at) VALUES (?, ?, ?, ?)',
    [id, date, name || null, timestamp]
  );
  return id;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function createSetting(key: string, value: string): void {
  const timestamp = now();
  testExecute(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
    [key, value, timestamp]
  );
}

// Arbitraries for property-based testing
const departmentArbitrary = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
});

const userArbitrary = fc.record({
  displayName: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
  deviceUserId: fc.option(fc.uuid(), { nil: undefined }),
  deviceName: fc.option(fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0), { nil: undefined }),
  status: fc.constantFrom('active', 'inactive'),
});

const deviceArbitrary = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
  ip: fc.tuple(
    fc.integer({ min: 1, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 1, max: 254 })
  ).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
  port: fc.integer({ min: 1, max: 65535 }),
});

const holidayArbitrary = fc.record({
  date: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') })
    .map(d => d.toISOString().split('T')[0] as string),
  name: fc.option(fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0), { nil: undefined }),
});

describe('Backup Manager', () => {
  let backupManager: BackupManager;

  beforeEach(() => {
    resetTestDatabase();
    fileSystem.clear();
    backupManager = new BackupManager(testDbAdapter, testFsAdapter);
  });

  afterAll(() => {
    closeTestDatabase();
  });

  /**
   * Property 22: Backup and Restore Round-Trip
   * For any database state, creating a backup and then restoring from that backup
   * should result in a database state equivalent to the original.
   * **Validates: Requirements 10.1, 10.2**
   */
  it('Property 22: Backup and Restore Round-Trip', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(departmentArbitrary, { minLength: 0, maxLength: 3 }),
        fc.array(userArbitrary, { minLength: 0, maxLength: 5 }),
        fc.array(deviceArbitrary, { minLength: 0, maxLength: 2 }),
        fc.array(holidayArbitrary, { minLength: 0, maxLength: 3 }),
        async (departments, users, devices, holidays) => {
          // Reset for each iteration
          resetTestDatabase();
          fileSystem.clear();

          // Create departments with unique names
          const uniqueDepts = departments.filter(
            (d, i, arr) => arr.findIndex(x => x.name === d.name) === i
          );
          const deptIds: string[] = [];
          for (const dept of uniqueDepts) {
            deptIds.push(createDepartment(dept.name));
          }

          // Create users with unique device user IDs
          const uniqueUsers = users.filter(
            (u, i, arr) => !u.deviceUserId || arr.findIndex(x => x.deviceUserId === u.deviceUserId) === i
          );
          for (const user of uniqueUsers) {
            const deptId = deptIds.length > 0 ? deptIds[Math.floor(Math.random() * deptIds.length)] : undefined;
            createUser({
              displayName: user.displayName,
              ...(deptId ? { departmentId: deptId } : {}),
              ...(user.deviceUserId ? { deviceUserId: user.deviceUserId } : {}),
              ...(user.deviceName ? { deviceName: user.deviceName } : {}),
              status: user.status,
            });
          }

          // Create devices
          for (const device of devices) {
            createDevice(device);
          }

          // Create holidays with unique dates
          const uniqueHolidays = holidays.filter(
            (h, i, arr) => arr.findIndex(x => x.date === h.date) === i
          );
          for (const holiday of uniqueHolidays) {
            createHoliday(holiday.date, holiday.name);
          }

          // Get original counts
          const originalUserCount = await testDbAdapter.getUserCount();
          const originalDeptCount = (await testDbAdapter.getAllDepartments()).length;
          const originalDeviceCount = (await testDbAdapter.getAllDevices()).length;
          const originalHolidayCount = (await testDbAdapter.getAllHolidays()).length;

          // Create backup
          const backupResult = await backupManager.createBackup('/backups/test-backup.json');
          expect(backupResult.success).toBe(true);

          // Clear database
          await testDbAdapter.clearAllData();

          // Verify database is empty
          expect(await testDbAdapter.getUserCount()).toBe(0);
          expect((await testDbAdapter.getAllDepartments()).length).toBe(0);

          // Restore from backup
          const restoreResult = await backupManager.restoreBackup('/backups/test-backup.json');
          expect(restoreResult.success).toBe(true);

          // Verify restored counts match original
          const restoredUserCount = await testDbAdapter.getUserCount();
          const restoredDeptCount = (await testDbAdapter.getAllDepartments()).length;
          const restoredDeviceCount = (await testDbAdapter.getAllDevices()).length;
          const restoredHolidayCount = (await testDbAdapter.getAllHolidays()).length;

          expect(restoredUserCount).toBe(originalUserCount);
          expect(restoredDeptCount).toBe(originalDeptCount);
          expect(restoredDeviceCount).toBe(originalDeviceCount);
          expect(restoredHolidayCount).toBe(originalHolidayCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 23: Backup Validation
   * For any corrupted or invalid backup file, the restore operation should fail
   * with an error and leave the existing database unchanged.
   * **Validates: Requirements 10.3, 10.4**
   */
  it('Property 23: Backup Validation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(userArbitrary, { minLength: 1, maxLength: 3 }),
        fc.constantFrom('invalid_json', 'missing_metadata', 'missing_data', 'wrong_checksum', 'missing_fields'),
        async (users, corruptionType) => {
          // Reset for each iteration
          resetTestDatabase();
          fileSystem.clear();

          // Create some initial data
          for (const user of users) {
            createUser({
              displayName: user.displayName,
              status: user.status,
            });
          }

          // Get original state
          const originalUserCount = await testDbAdapter.getUserCount();
          const originalUsers = await testDbAdapter.getAllUsers();

          // Create a corrupted backup file based on corruption type
          let corruptedContent: string;
          switch (corruptionType) {
            case 'invalid_json':
              corruptedContent = '{ invalid json content';
              break;
            case 'missing_metadata':
              corruptedContent = JSON.stringify({ data: { users: [], departments: [], devices: [], attendanceLogs: [], attendanceSummaries: [], settings: [], holidays: [] } });
              break;
            case 'missing_data':
              corruptedContent = JSON.stringify({ metadata: { version: '1.0', createdAt: now(), appVersion: '0.1.0', userCount: 0, logCount: 0, checksum: 'abc123' } });
              break;
            case 'wrong_checksum':
              const validBackup: BackupData = {
                metadata: { version: '1.0', createdAt: now(), appVersion: '0.1.0', userCount: 0, logCount: 0, checksum: 'wrong_checksum' },
                data: { users: [], departments: [], devices: [], attendanceLogs: [], attendanceSummaries: [], settings: [], holidays: [] },
              };
              corruptedContent = JSON.stringify(validBackup);
              break;
            case 'missing_fields':
              corruptedContent = JSON.stringify({
                metadata: { version: '1.0' }, // Missing required fields
                data: { users: [] }, // Missing required arrays
              });
              break;
            default:
              corruptedContent = 'corrupted';
          }

          fileSystem.set('/backups/corrupted.json', corruptedContent);

          // Attempt to restore from corrupted backup
          const restoreResult = await backupManager.restoreBackup('/backups/corrupted.json');

          // Verify restore failed
          expect(restoreResult.success).toBe(false);
          expect(restoreResult.error).toBeDefined();

          // Verify database state is unchanged
          const finalUserCount = await testDbAdapter.getUserCount();
          const finalUsers = await testDbAdapter.getAllUsers();

          expect(finalUserCount).toBe(originalUserCount);
          expect(finalUsers.length).toBe(originalUsers.length);

          // Verify user IDs match
          const originalIds = new Set((originalUsers as UserRow[]).map((u: UserRow) => u.id));
          const finalIds = new Set((finalUsers as UserRow[]).map((u: UserRow) => u.id));
          expect(originalIds.size).toBe(finalIds.size);
          for (const id of originalIds) {
            expect(finalIds.has(id)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Unit tests for helper functions
  describe('calculateChecksum', () => {
    it('should produce consistent checksums for same input', () => {
      const data = '{"test": "data"}';
      const checksum1 = calculateChecksum(data);
      const checksum2 = calculateChecksum(data);
      expect(checksum1).toBe(checksum2);
    });

    it('should produce different checksums for different inputs', () => {
      const checksum1 = calculateChecksum('data1');
      const checksum2 = calculateChecksum('data2');
      expect(checksum1).not.toBe(checksum2);
    });
  });

  describe('validateBackupStructure', () => {
    it('should return true for valid backup structure', () => {
      const validBackup: BackupData = {
        metadata: {
          version: '1.0',
          createdAt: now(),
          appVersion: '0.1.0',
          userCount: 0,
          logCount: 0,
          checksum: 'abc123',
        },
        data: {
          users: [],
          departments: [],
          devices: [],
          attendanceLogs: [],
          attendanceSummaries: [],
          settings: [],
          holidays: [],
        },
      };
      expect(validateBackupStructure(validBackup)).toBe(true);
    });

    it('should return false for null', () => {
      expect(validateBackupStructure(null)).toBe(false);
    });

    it('should return false for missing metadata', () => {
      expect(validateBackupStructure({ data: {} })).toBe(false);
    });

    it('should return false for missing data', () => {
      expect(validateBackupStructure({ metadata: {} })).toBe(false);
    });
  });

  describe('verifyChecksum', () => {
    it('should return true for valid checksum', () => {
      const data = {
        users: [],
        departments: [],
        devices: [],
        attendanceLogs: [],
        attendanceSummaries: [],
        settings: [],
        holidays: [],
      };
      const checksum = calculateChecksum(JSON.stringify(data));
      const backup: BackupData = {
        metadata: {
          version: '1.0',
          createdAt: now(),
          appVersion: '0.1.0',
          userCount: 0,
          logCount: 0,
          checksum,
        },
        data,
      };
      expect(verifyChecksum(backup)).toBe(true);
    });

    it('should return false for invalid checksum', () => {
      const backup: BackupData = {
        metadata: {
          version: '1.0',
          createdAt: now(),
          appVersion: '0.1.0',
          userCount: 0,
          logCount: 0,
          checksum: 'invalid',
        },
        data: {
          users: [],
          departments: [],
          devices: [],
          attendanceLogs: [],
          attendanceSummaries: [],
          settings: [],
          holidays: [],
        },
      };
      expect(verifyChecksum(backup)).toBe(false);
    });
  });

  describe('Backup file not found', () => {
    it('should return null when validating non-existent file', async () => {
      const result = await backupManager.validateBackup('/backups/nonexistent.json');
      expect(result).toBeNull();
    });

    it('should fail restore for non-existent file', async () => {
      const result = await backupManager.restoreBackup('/backups/nonexistent.json');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
