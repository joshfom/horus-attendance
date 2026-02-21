/**
 * AttendanceLog Repository
 * CRUD operations for attendance_logs_raw table
 * Requirements: 2.2, 5.2, 5.5
 */

import { execute, select } from '../database';
import type { AttendanceLog, SortDirection } from '../../types';
import type { AttendanceLogRow, AttendanceRecordFilter, AttendanceRecordSortField } from '../../types/api';

/**
 * Generate a unique ID for new logs
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Get current ISO timestamp
 */
function now(): string {
  return new Date().toISOString();
}

/**
 * Map database row to AttendanceLog model
 */
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

/**
 * Insert attendance log with deduplication (ON CONFLICT IGNORE)
 * Returns true if inserted, false if duplicate
 * Stores userName in raw_payload as JSON for user matching
 */
export async function insertLog(log: {
  deviceId: string;
  deviceUserId: string;
  timestamp: string;
  verifyType?: number;
  punchType?: number;
  rawPayload?: string;
  userName?: string | null;
}): Promise<{ inserted: boolean; id: string }> {
  const id = generateId();
  const createdAt = now();
  
  // Build raw_payload JSON with userName for user matching
  let rawPayload = log.rawPayload ?? null;
  if (log.userName) {
    rawPayload = JSON.stringify({ userName: log.userName });
  }
  
  try {
    await execute(
      `INSERT OR IGNORE INTO attendance_logs_raw 
       (id, device_id, device_user_id, timestamp, verify_type, punch_type, raw_payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        log.deviceId,
        log.deviceUserId,
        log.timestamp,
        log.verifyType ?? null,
        log.punchType ?? null,
        rawPayload,
        createdAt,
      ]
    );
    
    // Check if the record was actually inserted
    const existing = await select<Record<string, unknown>>(
      'SELECT id FROM attendance_logs_raw WHERE id = ?',
      [id]
    );
    
    if (existing.length > 0) {
      return { inserted: true, id };
    }
    
    // Record was not inserted (duplicate), find the existing one
    const existingLog = await select<Record<string, unknown>>(
      'SELECT id FROM attendance_logs_raw WHERE device_id = ? AND device_user_id = ? AND timestamp = ?',
      [log.deviceId, log.deviceUserId, log.timestamp]
    );
    
    const existingId = existingLog[0] ? (existingLog[0] as { id: string }).id : id;
    return { inserted: false, id: existingId };
  } catch (error) {
    throw error;
  }
}


/**
 * Bulk insert attendance logs with deduplication
 * Uses a transaction for performance and atomicity.
 * Processes in batches to avoid holding write locks too long.
 * Supports userName for user matching.
 */
export async function insertLogs(logs: Array<{
  deviceId: string;
  deviceUserId: string;
  timestamp: string;
  verifyType?: number;
  punchType?: number;
  rawPayload?: string;
  userName?: string | null;
}>): Promise<{ inserted: number; duplicates: number }> {
  if (logs.length === 0) {
    return { inserted: 0, duplicates: 0 };
  }

  let inserted = 0;
  let duplicates = 0;

  // Process in batches — each batch is its own transaction to avoid
  // holding long write locks that cause "database is locked" errors.
  const BATCH_SIZE = 100;

  for (let batchStart = 0; batchStart < logs.length; batchStart += BATCH_SIZE) {
    const batch = logs.slice(batchStart, batchStart + BATCH_SIZE);

    // Each batch gets its own savepoint for atomicity
    const savepointName = `insert_logs_${batchStart}`;
    await execute(`SAVEPOINT ${savepointName}`);

    try {
      for (const log of batch) {
        const id = generateId();
        const createdAt = now();

        let rawPayload = log.rawPayload ?? null;
        if (log.userName) {
          rawPayload = JSON.stringify({ userName: log.userName });
        }

        const result = await execute(
          `INSERT OR IGNORE INTO attendance_logs_raw 
           (id, device_id, device_user_id, timestamp, verify_type, punch_type, raw_payload, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            log.deviceId,
            log.deviceUserId,
            log.timestamp,
            log.verifyType ?? null,
            log.punchType ?? null,
            rawPayload,
            createdAt,
          ]
        );

        if (result.rowsAffected > 0) {
          inserted++;
        } else {
          duplicates++;
        }
      }

      await execute(`RELEASE SAVEPOINT ${savepointName}`);
    } catch (error) {
      await execute(`ROLLBACK TO SAVEPOINT ${savepointName}`).catch(() => {});
      await execute(`RELEASE SAVEPOINT ${savepointName}`).catch(() => {});
      // Log the batch error but continue with remaining batches
      console.error(`[insertLogs] Batch starting at ${batchStart} failed:`, error);
    }
    
    // Yield to event loop between batches so UI stays responsive
    // and other DB operations (department CRUD, etc.) are not starved
    const { yieldToUI } = await import('../database');
    await yieldToUI();
  }

  return { inserted, duplicates };
}

/**
 * Get attendance log by ID
 */
export async function getLogById(id: string): Promise<AttendanceLog | null> {
  const rows = await select<Record<string, unknown>>(
    'SELECT * FROM attendance_logs_raw WHERE id = ?',
    [id]
  );
  if (rows.length === 0) return null;
  return mapRowToLog(rows[0] as unknown as AttendanceLogRow);
}

/**
 * List attendance logs with filtering and sorting
 */
export async function listLogs(
  filter?: AttendanceRecordFilter,
  sort?: { field: AttendanceRecordSortField; direction: SortDirection }
): Promise<AttendanceLog[]> {
  let query = `
    SELECT l.* FROM attendance_logs_raw l
    LEFT JOIN users u ON (
      l.device_user_id = u.device_user_id
      OR LOWER(l.device_user_id) = LOWER(u.device_name)
      OR LOWER(l.device_user_id) = LOWER(u.display_name)
    )
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
  
  // Sorting
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
  
  const rows = await select<Record<string, unknown>>(query, params);
  return rows.map((row) => mapRowToLog(row as unknown as AttendanceLogRow));
}

/**
 * Get logs for a specific user on a specific date
 */
export async function getLogsForUserOnDate(
  deviceUserId: string,
  date: string
): Promise<AttendanceLog[]> {
  const startOfDay = `${date}T00:00:00`;
  const endOfDay = `${date}T23:59:59`;
  
  const rows = await select<Record<string, unknown>>(
    `SELECT * FROM attendance_logs_raw 
     WHERE device_user_id = ? AND timestamp >= ? AND timestamp <= ?
     ORDER BY timestamp ASC`,
    [deviceUserId, startOfDay, endOfDay]
  );
  
  return rows.map((row) => mapRowToLog(row as unknown as AttendanceLogRow));
}

/**
 * Get logs for a date range
 */
export async function getLogsForDateRange(
  startDate: string,
  endDate: string,
  deviceUserId?: string
): Promise<AttendanceLog[]> {
  let query = `
    SELECT * FROM attendance_logs_raw 
    WHERE timestamp >= ? AND timestamp <= ?
  `;
  const params: unknown[] = [startDate, endDate];
  
  if (deviceUserId) {
    query += ' AND device_user_id = ?';
    params.push(deviceUserId);
  }
  
  query += ' ORDER BY timestamp ASC';
  
  const rows = await select<Record<string, unknown>>(query, params);
  return rows.map((row) => mapRowToLog(row as unknown as AttendanceLogRow));
}

/**
 * Delete logs for a device
 */
export async function deleteLogsForDevice(deviceId: string): Promise<number> {
  const result = await execute(
    'DELETE FROM attendance_logs_raw WHERE device_id = ?',
    [deviceId]
  );
  return result.rowsAffected;
}

/**
 * Get total log count
 */
export async function getLogCount(): Promise<number> {
  const rows = await select<Record<string, unknown>>(
    'SELECT COUNT(*) as count FROM attendance_logs_raw'
  );
  return (rows[0] as { count: number }).count;
}

export const attendanceLogRepository = {
  insertLog,
  insertLogs,
  getLogById,
  listLogs,
  getLogsForUserOnDate,
  getLogsForDateRange,
  deleteLogsForDevice,
  getLogCount,
};
