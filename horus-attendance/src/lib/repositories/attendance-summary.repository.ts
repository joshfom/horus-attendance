/**
 * AttendanceSummary Repository
 * CRUD operations for attendance_day_summary table
 * Requirements: 6.1, 6.3, 6.4, 6.5
 */

import { execute, select } from '../database';
import type { DailySummary, AttendanceStatus } from '../../types';
import type { AttendanceSummaryRow } from '../../types/api';

/**
 * Generate a unique ID for new summaries
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
 * Map database row to DailySummary model
 */
function mapRowToSummary(row: AttendanceSummaryRow): DailySummary {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date,
    checkInTime: row.check_in_time,
    checkOutTime: row.check_out_time,
    isIncomplete: row.is_incomplete === 1,
    lateMinutes: row.late_minutes,
    earlyMinutes: row.early_minutes,
    status: row.status as AttendanceStatus,
    flags: row.flags ? JSON.parse(row.flags) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Get summary by ID
 */
export async function getSummaryById(id: string): Promise<DailySummary | null> {
  const rows = await select<Record<string, unknown>>(
    'SELECT * FROM attendance_day_summary WHERE id = ?',
    [id]
  );
  if (rows.length === 0) return null;
  return mapRowToSummary(rows[0] as unknown as AttendanceSummaryRow);
}

/**
 * Get summary for a user on a specific date
 */
export async function getSummaryForUserOnDate(
  userId: string,
  date: string
): Promise<DailySummary | null> {
  const rows = await select<Record<string, unknown>>(
    'SELECT * FROM attendance_day_summary WHERE user_id = ? AND date = ?',
    [userId, date]
  );
  if (rows.length === 0) return null;
  return mapRowToSummary(rows[0] as unknown as AttendanceSummaryRow);
}


/**
 * Create or update a daily summary
 */
export async function upsertSummary(summary: {
  userId: string;
  date: string;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  isIncomplete?: boolean;
  lateMinutes?: number;
  earlyMinutes?: number;
  status?: AttendanceStatus;
  flags?: string[];
}): Promise<DailySummary> {
  const timestamp = now();
  const existing = await getSummaryForUserOnDate(summary.userId, summary.date);
  
  if (existing) {
    // Update existing
    await execute(
      `UPDATE attendance_day_summary SET
        check_in_time = ?, check_out_time = ?, is_incomplete = ?,
        late_minutes = ?, early_minutes = ?, status = ?, flags = ?, updated_at = ?
       WHERE id = ?`,
      [
        summary.checkInTime ?? existing.checkInTime,
        summary.checkOutTime ?? existing.checkOutTime,
        (summary.isIncomplete ?? existing.isIncomplete) ? 1 : 0,
        summary.lateMinutes ?? existing.lateMinutes,
        summary.earlyMinutes ?? existing.earlyMinutes,
        summary.status ?? existing.status,
        JSON.stringify(summary.flags ?? existing.flags),
        timestamp,
        existing.id,
      ]
    );
    return (await getSummaryById(existing.id))!;
  } else {
    // Insert new
    const id = generateId();
    await execute(
      `INSERT INTO attendance_day_summary 
       (id, user_id, date, check_in_time, check_out_time, is_incomplete, 
        late_minutes, early_minutes, status, flags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        summary.userId,
        summary.date,
        summary.checkInTime ?? null,
        summary.checkOutTime ?? null,
        summary.isIncomplete ? 1 : 0,
        summary.lateMinutes ?? 0,
        summary.earlyMinutes ?? 0,
        summary.status ?? 'absent',
        JSON.stringify(summary.flags ?? []),
        timestamp,
        timestamp,
      ]
    );
    return (await getSummaryById(id))!;
  }
}

/**
 * Get summaries for a date range
 */
export async function getSummariesForDateRange(
  userId: string,
  startDate: string,
  endDate: string
): Promise<DailySummary[]> {
  const rows = await select<Record<string, unknown>>(
    `SELECT * FROM attendance_day_summary 
     WHERE user_id = ? AND date >= ? AND date <= ?
     ORDER BY date ASC`,
    [userId, startDate, endDate]
  );
  return rows.map((row) => mapRowToSummary(row as unknown as AttendanceSummaryRow));
}

/**
 * Get summaries for a week (Mon-Sun)
 */
export async function getSummariesForWeek(
  userId: string,
  weekStartDate: string
): Promise<DailySummary[]> {
  const startDate = new Date(weekStartDate);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);
  
  const endDateStr = endDate.toISOString().split('T')[0];
  return getSummariesForDateRange(
    userId,
    weekStartDate,
    endDateStr ?? weekStartDate
  );
}

/**
 * Get summaries for a month
 */
export async function getSummariesForMonth(
  userId: string,
  year: number,
  month: number
): Promise<DailySummary[]> {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0); // Last day of month
  
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  return getSummariesForDateRange(
    userId,
    startDateStr ?? `${year}-${String(month).padStart(2, '0')}-01`,
    endDateStr ?? `${year}-${String(month).padStart(2, '0')}-28`
  );
}

/**
 * Get all summaries for a specific date (all users)
 */
export async function getSummariesForDate(date: string): Promise<DailySummary[]> {
  const rows = await select<Record<string, unknown>>(
    'SELECT * FROM attendance_day_summary WHERE date = ? ORDER BY user_id ASC',
    [date]
  );
  return rows.map((row) => mapRowToSummary(row as unknown as AttendanceSummaryRow));
}

/**
 * Delete summary by ID
 */
export async function deleteSummary(id: string): Promise<void> {
  await execute('DELETE FROM attendance_day_summary WHERE id = ?', [id]);
}

/**
 * Delete all summaries for a user
 */
export async function deleteSummariesForUser(userId: string): Promise<number> {
  const result = await execute(
    'DELETE FROM attendance_day_summary WHERE user_id = ?',
    [userId]
  );
  return result.rowsAffected;
}

export const attendanceSummaryRepository = {
  getSummaryById,
  getSummaryForUserOnDate,
  upsertSummary,
  getSummariesForDateRange,
  getSummariesForWeek,
  getSummariesForMonth,
  getSummariesForDate,
  deleteSummary,
  deleteSummariesForUser,
};
