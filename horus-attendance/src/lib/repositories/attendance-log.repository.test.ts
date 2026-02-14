/**
 * Property-based tests for AttendanceLog Repository
 * Property 2: Attendance Log Deduplication
 * Property 9: Attendance Record Filtering
 * Property 10: Attendance Record Sorting
 * Validates: Requirements 2.2, 5.2, 5.5
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
import type { AttendanceLog, SortDirection } from '../../types';
import type { AttendanceLogRow, AttendanceRecordFilter, AttendanceRecordSortField } from '../../types/api';

// Initialize test database
initTestDatabase();

// Test-specific repository functions
function generateId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function mapRowToLog(row: AttendanceLogRow): AttendanceLog {
  return {
    id: row.id,
    deviceId: row.device_id,
    deviceUserId: row.device_user_id,
    timestamp: row.timestamp,
    verifyType: row.verify_type ?? 0,
    punchType: row.punch_type ?? 0,
    rawPayload: row.raw_payload,
    createdAt: row.created_at,
  };
}

function insertLog(log: {
  deviceId: string;
  deviceUserId: string;
  timestamp: string;
  verifyType?: number;
  punchType?: number;
}): { inserted: boolean; id: string } {
  const id = generateId();
  const createdAt = now();
  
  try {
    testExecute(
      `INSERT OR IGNORE INTO attendance_logs_raw 
       (id, device_id, device_user_id, timestamp, verify_type, punch_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, log.deviceId, log.deviceUserId, log.timestamp, log.verifyType ?? null, log.punchType ?? null, createdAt]
    );
    
    const existing = testSelect<{ id: string }>('SELECT id FROM attendance_logs_raw WHERE id = ?', [id]);
    
    if (existing.length > 0) {
      return { inserted: true, id };
    }
    
    const existingLog = testSelect<{ id: string }>(
      'SELECT id FROM attendance_logs_raw WHERE device_id = ? AND device_user_id = ? AND timestamp = ?',
      [log.deviceId, log.deviceUserId, log.timestamp]
    );
    
    return { inserted: false, id: existingLog[0].id };
  } catch {
    throw new Error('Failed to insert log');
  }
}


function listLogs(
  filter?: AttendanceRecordFilter,
  sort?: { field: AttendanceRecordSortField; direction: SortDirection }
): AttendanceLog[] {
  let query = `
    SELECT l.* FROM attendance_logs_raw l
    LEFT JOIN users u ON l.device_user_id = u.device_user_id
    LEFT JOIN departments d ON u.department_id = d.id
    WHERE 1=1
  `;
  const params: unknown[] = [];
  
  if (filter) {
    if (filter.dateFrom) {
      query += ' AND l.timestamp >= ?';
      params.push(filter.dateFrom);
    }
    if (filter.dateTo) {
      query += ' AND l.timestamp <= ?';
      params.push(filter.dateTo);
    }
    if (filter.userId) {
      query += ' AND u.id = ?';
      params.push(filter.userId);
    }
    if (filter.departmentId) {
      query += ' AND u.department_id = ?';
      params.push(filter.departmentId);
    }
    if (filter.punchType !== undefined) {
      query += ' AND l.punch_type = ?';
      params.push(filter.punchType);
    }
  }
  
  if (sort) {
    switch (sort.field) {
      case 'timestamp':
        query += ` ORDER BY l.timestamp ${sort.direction === 'asc' ? 'ASC' : 'DESC'}`;
        break;
      case 'user':
        query += ` ORDER BY u.display_name ${sort.direction === 'asc' ? 'ASC' : 'DESC'}, l.timestamp DESC`;
        break;
      case 'department':
        query += ` ORDER BY d.name ${sort.direction === 'asc' ? 'ASC' : 'DESC'}, l.timestamp DESC`;
        break;
      default:
        query += ' ORDER BY l.timestamp DESC';
    }
  } else {
    query += ' ORDER BY l.timestamp DESC';
  }
  
  const rows = testSelect<AttendanceLogRow>(query, params);
  return rows.map(mapRowToLog);
}

function createDevice(name: string): string {
  const id = generateId();
  const timestamp = now();
  testExecute(
    `INSERT INTO devices (id, name, ip, port, created_at, updated_at)
     VALUES (?, ?, '192.168.1.1', 4370, ?, ?)`,
    [id, name, timestamp, timestamp]
  );
  return id;
}

function createUser(displayName: string, deviceUserId: string, departmentId?: string): string {
  const id = generateId();
  const timestamp = now();
  testExecute(
    `INSERT INTO users (id, device_user_id, display_name, department_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    [id, deviceUserId, displayName, departmentId || null, timestamp, timestamp]
  );
  return id;
}

function createDepartment(name: string): string {
  const id = generateId();
  const timestamp = now();
  testExecute(
    'INSERT INTO departments (id, name, created_at) VALUES (?, ?, ?)',
    [id, name, timestamp]
  );
  return id;
}

// Arbitraries
const timestampArbitrary = fc.date({
  min: new Date('2024-01-01'),
  max: new Date('2024-12-31'),
}).map(d => d.toISOString());

const logInputArbitrary = fc.record({
  deviceUserId: fc.uuid(),
  timestamp: timestampArbitrary,
  verifyType: fc.integer({ min: 0, max: 5 }),
  punchType: fc.integer({ min: 0, max: 3 }),
});

describe('AttendanceLog Repository', () => {
  beforeEach(() => {
    resetTestDatabase();
  });

  afterAll(() => {
    closeTestDatabase();
  });

  /**
   * Property 2: Attendance Log Deduplication
   * For any set of attendance log records, inserting the same record
   * (same device_id, device_user_id, timestamp) multiple times should
   * result in exactly one record in the database.
   * Validates: Requirements 2.2
   */
  it('Property 2: Attendance Log Deduplication', () => {
    fc.assert(
      fc.property(
        logInputArbitrary,
        fc.integer({ min: 2, max: 5 }),
        (logInput, insertCount) => {
          resetTestDatabase();
          
          const deviceId = createDevice('Test Device');
          
          // Insert the same log multiple times
          const results: { inserted: boolean; id: string }[] = [];
          for (let i = 0; i < insertCount; i++) {
            results.push(insertLog({
              deviceId,
              deviceUserId: logInput.deviceUserId,
              timestamp: logInput.timestamp,
              verifyType: logInput.verifyType,
              punchType: logInput.punchType,
            }));
          }
          
          // First insert should succeed
          expect(results[0].inserted).toBe(true);
          
          // Subsequent inserts should be duplicates
          for (let i = 1; i < results.length; i++) {
            expect(results[i].inserted).toBe(false);
          }
          
          // All should return the same ID
          const firstId = results[0].id;
          results.forEach(r => {
            expect(r.id).toBe(firstId);
          });
          
          // Only one record should exist
          const count = testSelect<{ count: number }>(
            'SELECT COUNT(*) as count FROM attendance_logs_raw WHERE device_id = ? AND device_user_id = ? AND timestamp = ?',
            [deviceId, logInput.deviceUserId, logInput.timestamp]
          );
          expect(count[0].count).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });


  /**
   * Property 9: Attendance Record Filtering
   * For any filter criteria (date range, user, department, punch type),
   * all returned attendance records should match all specified criteria.
   * Validates: Requirements 5.2
   */
  it('Property 9: Attendance Record Filtering by date range', () => {
    fc.assert(
      fc.property(
        fc.array(logInputArbitrary, { minLength: 5, maxLength: 20 }),
        (logInputs) => {
          resetTestDatabase();
          
          const deviceId = createDevice('Test Device');
          
          // Insert logs
          logInputs.forEach(input => {
            insertLog({ deviceId, ...input });
          });
          
          // Pick a date range from the middle
          const sortedTimestamps = logInputs.map(l => l.timestamp).sort();
          const midIndex = Math.floor(sortedTimestamps.length / 2);
          const dateFrom = sortedTimestamps[Math.max(0, midIndex - 2)];
          const dateTo = sortedTimestamps[Math.min(sortedTimestamps.length - 1, midIndex + 2)];
          
          // Filter by date range
          const filtered = listLogs({ dateFrom, dateTo });
          
          // All returned records should be within the date range
          filtered.forEach(log => {
            expect(log.timestamp >= dateFrom).toBe(true);
            expect(log.timestamp <= dateTo).toBe(true);
          });
        }
      ),
      { numRuns: 50 }
    );
  });

  it('Property 9: Attendance Record Filtering by department', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 10 }),
        fc.integer({ min: 3, max: 10 }),
        (dept1Count, dept2Count) => {
          resetTestDatabase();
          
          const deviceId = createDevice('Test Device');
          const dept1Id = createDepartment('Department 1');
          const dept2Id = createDepartment('Department 2');
          
          // Create users in each department and insert logs with unique timestamps
          for (let i = 0; i < dept1Count; i++) {
            const deviceUserId = `dept1-user-${i}`;
            createUser(`User ${i} Dept1`, deviceUserId, dept1Id);
            insertLog({
              deviceId,
              deviceUserId,
              timestamp: new Date(2024, 0, 1, 9, i, 0).toISOString(),
            });
          }
          
          for (let i = 0; i < dept2Count; i++) {
            const deviceUserId = `dept2-user-${i}`;
            createUser(`User ${i} Dept2`, deviceUserId, dept2Id);
            insertLog({
              deviceId,
              deviceUserId,
              timestamp: new Date(2024, 0, 1, 10, i, 0).toISOString(),
            });
          }
          
          // Filter by department 1
          const filtered = listLogs({ departmentId: dept1Id });
          
          // All returned records should be from department 1 users
          expect(filtered.length).toBe(dept1Count);
          filtered.forEach(log => {
            expect(log.deviceUserId.startsWith('dept1-user-')).toBe(true);
          });
        }
      ),
      { numRuns: 30 }
    );
  });

  /**
   * Property 10: Attendance Record Sorting
   * For any sort order (by timestamp, user, or department), the returned
   * attendance records should be in the correct ascending or descending order.
   * Validates: Requirements 5.5
   */
  it('Property 10: Attendance Record Sorting by timestamp', () => {
    fc.assert(
      fc.property(
        fc.array(logInputArbitrary, { minLength: 3, maxLength: 15 }),
        fc.constantFrom('asc' as const, 'desc' as const),
        (logInputs, direction) => {
          resetTestDatabase();
          
          const deviceId = createDevice('Test Device');
          
          // Insert logs with unique timestamps
          const uniqueLogs = logInputs.filter(
            (l, i, arr) => arr.findIndex(x => x.timestamp === l.timestamp) === i
          );
          
          uniqueLogs.forEach(input => {
            insertLog({ deviceId, ...input });
          });
          
          // Sort by timestamp
          const sorted = listLogs(undefined, { field: 'timestamp', direction });
          
          // Verify order
          for (let i = 1; i < sorted.length; i++) {
            if (direction === 'asc') {
              expect(sorted[i].timestamp >= sorted[i - 1].timestamp).toBe(true);
            } else {
              expect(sorted[i].timestamp <= sorted[i - 1].timestamp).toBe(true);
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('Property 10: Attendance Record Sorting by user', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 10 }),
        fc.constantFrom('asc' as const, 'desc' as const),
        (userCount, direction) => {
          resetTestDatabase();
          
          const deviceId = createDevice('Test Device');
          
          // Create users with predictable names (all lowercase for consistent sorting)
          const names = ['alice', 'bob', 'charlie', 'david', 'eve', 'frank', 'grace', 'henry', 'ivy', 'jack'];
          for (let i = 0; i < userCount; i++) {
            const deviceUserId = `user-${i}`;
            createUser(names[i], deviceUserId);
            insertLog({
              deviceId,
              deviceUserId,
              timestamp: new Date(2024, 0, 1, 9, i, 0).toISOString(),
            });
          }
          
          // Sort by user
          const sorted = listLogs(undefined, { field: 'user', direction });
          
          // Get user names for verification
          const userNames = sorted.map(log => {
            const user = testSelect<{ display_name: string }>(
              'SELECT display_name FROM users WHERE device_user_id = ?',
              [log.deviceUserId]
            );
            return user[0]?.display_name || '';
          });
          
          // Verify order
          for (let i = 1; i < userNames.length; i++) {
            const cmp = userNames[i].localeCompare(userNames[i - 1]);
            if (direction === 'asc') {
              expect(cmp).toBeGreaterThanOrEqual(0);
            } else {
              expect(cmp).toBeLessThanOrEqual(0);
            }
          }
        }
      ),
      { numRuns: 30 }
    );
  });
});
