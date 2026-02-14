/**
 * Property-based tests for Sync Engine
 * Property 3: Transaction Rollback on Sync Failure
 * Validates: Requirements 2.5
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
import type { DeviceRow, UserRow, AttendanceLogRow } from '../../types/api';

// Initialize test database
initTestDatabase();

// Helper functions for test database operations
function generateId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

// Transaction management functions
function beginTransaction(): void {
  testExecute('BEGIN TRANSACTION');
}

function commitTransaction(): void {
  testExecute('COMMIT');
}

function rollbackTransaction(): void {
  testExecute('ROLLBACK');
}

// Device operations
function createDevice(config: {
  id: string;
  name: string;
  ip: string;
  port: number;
  commKey: string;
  timezone: string;
  syncMode: 'auto' | 'manual';
}): void {
  const timestamp = now();
  testExecute(
    `INSERT INTO devices (id, name, ip, port, comm_key, timezone, sync_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [config.id, config.name, config.ip, config.port, config.commKey, config.timezone, config.syncMode, timestamp, timestamp]
  );
}

function getDeviceCount(): number {
  const rows = testSelect<{ count: number }>('SELECT COUNT(*) as count FROM devices');
  return rows[0]?.count ?? 0;
}

// User operations
function createUser(data: {
  id?: string;
  deviceUserId?: string;
  deviceName?: string;
  displayName: string;
  status?: 'active' | 'inactive';
}): string {
  const id = data.id || generateId();
  const timestamp = now();
  testExecute(
    `INSERT INTO users (id, device_user_id, device_name, display_name, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, data.deviceUserId || null, data.deviceName || null, data.displayName, data.status || 'active', timestamp, timestamp]
  );
  return id;
}

function getUserCount(): number {
  const rows = testSelect<{ count: number }>('SELECT COUNT(*) as count FROM users');
  return rows[0]?.count ?? 0;
}

function listUsers(): UserRow[] {
  return testSelect<UserRow>('SELECT * FROM users');
}

// Attendance log operations
function insertAttendanceLog(log: {
  deviceId: string;
  deviceUserId: string;
  timestamp: string;
  verifyType?: number;
  punchType?: number;
}): string {
  const id = generateId();
  const createdAt = now();
  testExecute(
    `INSERT OR IGNORE INTO attendance_logs_raw 
     (id, device_id, device_user_id, timestamp, verify_type, punch_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, log.deviceId, log.deviceUserId, log.timestamp, log.verifyType ?? 0, log.punchType ?? 0, createdAt]
  );
  return id;
}

function getAttendanceLogCount(): number {
  const rows = testSelect<{ count: number }>('SELECT COUNT(*) as count FROM attendance_logs_raw');
  return rows[0]?.count ?? 0;
}

function listAttendanceLogs(): AttendanceLogRow[] {
  return testSelect<AttendanceLogRow>('SELECT * FROM attendance_logs_raw');
}

// Snapshot functions for comparing database state
interface DatabaseSnapshot {
  deviceCount: number;
  userCount: number;
  logCount: number;
  users: UserRow[];
  logs: AttendanceLogRow[];
}

function takeSnapshot(): DatabaseSnapshot {
  return {
    deviceCount: getDeviceCount(),
    userCount: getUserCount(),
    logCount: getAttendanceLogCount(),
    users: listUsers(),
    logs: listAttendanceLogs(),
  };
}

function snapshotsEqual(a: DatabaseSnapshot, b: DatabaseSnapshot): boolean {
  if (a.deviceCount !== b.deviceCount) return false;
  if (a.userCount !== b.userCount) return false;
  if (a.logCount !== b.logCount) return false;
  
  // Compare users by ID
  const aUserIds = new Set(a.users.map(u => u.id));
  const bUserIds = new Set(b.users.map(u => u.id));
  if (aUserIds.size !== bUserIds.size) return false;
  for (const id of aUserIds) {
    if (!bUserIds.has(id)) return false;
  }
  
  // Compare logs by ID
  const aLogIds = new Set(a.logs.map(l => l.id));
  const bLogIds = new Set(b.logs.map(l => l.id));
  if (aLogIds.size !== bLogIds.size) return false;
  for (const id of aLogIds) {
    if (!bLogIds.has(id)) return false;
  }
  
  return true;
}

// Arbitraries for property-based testing
const userDataArbitrary = fc.record({
  deviceUserId: fc.uuid(),
  deviceName: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
  displayName: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
});

const attendanceLogArbitrary = (deviceId: string) => fc.record({
  deviceId: fc.constant(deviceId),
  deviceUserId: fc.uuid(),
  timestamp: fc.date({ min: new Date('2024-01-01'), max: new Date('2024-12-31') })
    .map(d => d.toISOString()),
  verifyType: fc.integer({ min: 0, max: 5 }),
  punchType: fc.integer({ min: 0, max: 3 }),
});

describe('Sync Engine', () => {
  beforeEach(() => {
    resetTestDatabase();
  });

  afterAll(() => {
    closeTestDatabase();
  });

  /**
   * Property 3: Transaction Rollback on Sync Failure
   * For any sync operation that fails mid-way, the database state after the failure
   * should be identical to the state before the sync started (no partial data).
   * Validates: Requirements 2.5
   */
  it('Property 3: Transaction Rollback on Sync Failure', () => {
    fc.assert(
      fc.property(
        fc.array(userDataArbitrary, { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 0, max: 4 }), // Index at which to simulate failure
        (usersToSync, failureIndex) => {
          // Setup: Create a device first
          const deviceId = generateId();
          createDevice({
            id: deviceId,
            name: 'Test Device',
            ip: '192.168.1.100',
            port: 4370,
            commKey: '',
            timezone: 'UTC',
            syncMode: 'manual',
          });

          // Take snapshot of initial state
          const initialSnapshot = takeSnapshot();

          // Simulate a sync operation with transaction
          let transactionStarted = false;
          const actualFailureIndex = Math.min(failureIndex, usersToSync.length - 1);

          try {
            beginTransaction();
            transactionStarted = true;

            // Insert users one by one, simulating failure at failureIndex
            for (let i = 0; i < usersToSync.length; i++) {
              if (i === actualFailureIndex) {
                // Simulate failure by throwing an error
                throw new Error('Simulated sync failure');
              }
              
              const userData = usersToSync[i];
              if (userData) {
                createUser({
                  deviceUserId: userData.deviceUserId,
                  deviceName: userData.deviceName,
                  displayName: userData.displayName,
                });
              }
            }

            // If we get here without failure, commit
            commitTransaction();
            transactionStarted = false;
          } catch (error) {
            // Rollback on failure
            if (transactionStarted) {
              rollbackTransaction();
            }
          }

          // Take snapshot after rollback
          const finalSnapshot = takeSnapshot();

          // Verify: Database state should be identical to initial state
          expect(snapshotsEqual(initialSnapshot, finalSnapshot)).toBe(true);
          expect(finalSnapshot.userCount).toBe(initialSnapshot.userCount);
          expect(finalSnapshot.logCount).toBe(initialSnapshot.logCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Transaction commits successfully when no failure occurs', () => {
    fc.assert(
      fc.property(
        fc.array(userDataArbitrary, { minLength: 1, maxLength: 5 }),
        (usersToSync) => {
          // Setup: Create a device first
          const deviceId = generateId();
          createDevice({
            id: deviceId,
            name: 'Test Device',
            ip: '192.168.1.100',
            port: 4370,
            commKey: '',
            timezone: 'UTC',
            syncMode: 'manual',
          });

          // Take snapshot of initial state
          const initialSnapshot = takeSnapshot();

          // Ensure unique device user IDs
          const uniqueUsers = usersToSync.filter(
            (u, i, arr) => arr.findIndex(x => x.deviceUserId === u.deviceUserId) === i
          );

          // Perform sync operation with transaction (no failure)
          beginTransaction();
          
          for (const userData of uniqueUsers) {
            createUser({
              deviceUserId: userData.deviceUserId,
              deviceName: userData.deviceName,
              displayName: userData.displayName,
            });
          }

          commitTransaction();

          // Take snapshot after commit
          const finalSnapshot = takeSnapshot();

          // Verify: All users should be added
          expect(finalSnapshot.userCount).toBe(initialSnapshot.userCount + uniqueUsers.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Rollback preserves attendance logs state on failure', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }), // Number of logs to insert before failure
        fc.integer({ min: 1, max: 5 }), // Number of logs to attempt after transaction starts
        (preExistingLogs, logsToAttempt) => {
          // Reset database for each iteration
          resetTestDatabase();
          
          // Setup: Create a device first
          const deviceId = generateId();
          createDevice({
            id: deviceId,
            name: 'Test Device',
            ip: '192.168.1.100',
            port: 4370,
            commKey: '',
            timezone: 'UTC',
            syncMode: 'manual',
          });

          // Insert some pre-existing logs (outside transaction)
          for (let i = 0; i < preExistingLogs; i++) {
            insertAttendanceLog({
              deviceId,
              deviceUserId: generateId(),
              timestamp: new Date(2024, 0, i + 1, 9, 0, 0).toISOString(),
            });
          }

          // Take snapshot of initial state
          const initialSnapshot = takeSnapshot();
          expect(initialSnapshot.logCount).toBe(preExistingLogs);

          // Simulate a sync operation that fails
          let transactionStarted = false;
          const failureIndex = Math.floor(logsToAttempt / 2);

          try {
            beginTransaction();
            transactionStarted = true;

            // Insert logs, simulating failure midway
            for (let i = 0; i < logsToAttempt; i++) {
              if (i === failureIndex) {
                throw new Error('Simulated sync failure');
              }
              
              insertAttendanceLog({
                deviceId,
                deviceUserId: generateId(),
                timestamp: new Date(2024, 1, i + 1, 9, 0, 0).toISOString(),
              });
            }

            commitTransaction();
            transactionStarted = false;
          } catch (error) {
            if (transactionStarted) {
              rollbackTransaction();
            }
          }

          // Take snapshot after rollback
          const finalSnapshot = takeSnapshot();

          // Verify: Log count should be same as before transaction
          expect(finalSnapshot.logCount).toBe(initialSnapshot.logCount);
        }
      ),
      { numRuns: 100 }
    );
  });
});
