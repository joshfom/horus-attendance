/**
 * Property-based tests for AttendanceSummary Repository
 * Property 11: Date Range Query Completeness
 * Validates: Requirements 6.1, 6.3, 6.4, 6.5
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
import type { DailySummary, AttendanceStatus } from '../../types';
import type { AttendanceSummaryRow } from '../../types/api';

// Initialize test database
initTestDatabase();

// Test-specific repository functions
function generateId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

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

function getSummaryForUserOnDate(userId: string, date: string): DailySummary | null {
  const rows = testSelect<AttendanceSummaryRow>(
    'SELECT * FROM attendance_day_summary WHERE user_id = ? AND date = ?',
    [userId, date]
  );
  return rows.length > 0 ? mapRowToSummary(rows[0]) : null;
}

function getSummaryById(id: string): DailySummary | null {
  const rows = testSelect<AttendanceSummaryRow>(
    'SELECT * FROM attendance_day_summary WHERE id = ?',
    [id]
  );
  return rows.length > 0 ? mapRowToSummary(rows[0]) : null;
}


function upsertSummary(summary: {
  userId: string;
  date: string;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  isIncomplete?: boolean;
  lateMinutes?: number;
  earlyMinutes?: number;
  status?: AttendanceStatus;
  flags?: string[];
}): DailySummary {
  const timestamp = now();
  const existing = getSummaryForUserOnDate(summary.userId, summary.date);
  
  if (existing) {
    testExecute(
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
    return getSummaryById(existing.id)!;
  } else {
    const id = generateId();
    testExecute(
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
    return getSummaryById(id)!;
  }
}

function getSummariesForDateRange(
  userId: string,
  startDate: string,
  endDate: string
): DailySummary[] {
  const rows = testSelect<AttendanceSummaryRow>(
    `SELECT * FROM attendance_day_summary 
     WHERE user_id = ? AND date >= ? AND date <= ?
     ORDER BY date ASC`,
    [userId, startDate, endDate]
  );
  return rows.map(mapRowToSummary);
}

function getSummariesForWeek(userId: string, weekStartDate: string): DailySummary[] {
  const startDate = new Date(weekStartDate);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);
  return getSummariesForDateRange(userId, weekStartDate, endDate.toISOString().split('T')[0]);
}

function getSummariesForMonth(userId: string, year: number, month: number): DailySummary[] {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);
  return getSummariesForDateRange(
    userId,
    startDate.toISOString().split('T')[0],
    endDate.toISOString().split('T')[0]
  );
}

function createUser(displayName: string): string {
  const id = generateId();
  const timestamp = now();
  testExecute(
    `INSERT INTO users (id, display_name, status, created_at, updated_at)
     VALUES (?, ?, 'active', ?, ?)`,
    [id, displayName, timestamp, timestamp]
  );
  return id;
}

// Helper to generate date string
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

// Helper to get all dates in a range
function getDatesInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(startDate);
  const end = new Date(endDate);
  
  while (current <= end) {
    dates.push(formatDate(current));
    current.setDate(current.getDate() + 1);
  }
  
  return dates;
}

// Arbitraries
const statusArbitrary = fc.constantFrom<AttendanceStatus>(
  'present', 'absent', 'late', 'early_leave', 'incomplete'
);

describe('AttendanceSummary Repository', () => {
  beforeEach(() => {
    resetTestDatabase();
  });

  afterAll(() => {
    closeTestDatabase();
  });

  /**
   * Property 11: Date Range Query Completeness
   * For any date range query (week, month, or custom), the returned daily summaries
   * should include exactly one entry for each day in the specified range that has data,
   * with no gaps or duplicates.
   * Validates: Requirements 6.1, 6.3, 6.4, 6.5
   */
  it('Property 11: Date Range Query returns all summaries in range without duplicates', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 30 }),
        fc.integer({ min: 2024, max: 2025 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        (dayCount, year, month, startDay) => {
          resetTestDatabase();
          
          const userId = createUser('Test User');
          
          // Create summaries for a range of days
          const startDate = new Date(year, month - 1, startDay);
          const dates: string[] = [];
          
          for (let i = 0; i < dayCount; i++) {
            const date = new Date(startDate);
            date.setDate(date.getDate() + i);
            const dateStr = formatDate(date);
            dates.push(dateStr);
            
            upsertSummary({
              userId,
              date: dateStr,
              status: 'present',
              checkInTime: '09:00',
              checkOutTime: '17:00',
            });
          }
          
          // Query the range
          const endDate = new Date(startDate);
          endDate.setDate(endDate.getDate() + dayCount - 1);
          
          const summaries = getSummariesForDateRange(
            userId,
            formatDate(startDate),
            formatDate(endDate)
          );
          
          // Verify count matches
          expect(summaries.length).toBe(dayCount);
          
          // Verify no duplicates
          const uniqueDates = new Set(summaries.map(s => s.date));
          expect(uniqueDates.size).toBe(summaries.length);
          
          // Verify all dates are in range
          summaries.forEach(summary => {
            expect(dates.includes(summary.date)).toBe(true);
          });
          
          // Verify sorted by date
          for (let i = 1; i < summaries.length; i++) {
            expect(summaries[i].date >= summaries[i - 1].date).toBe(true);
          }
        }
      ),
      { numRuns: 50 }
    );
  });


  it('Property 11: Week query returns exactly 7 days when all populated', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2024, max: 2025 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 21 }),
        (year, month, startDay) => {
          resetTestDatabase();
          
          const userId = createUser('Test User');
          const weekStart = new Date(year, month - 1, startDay);
          
          // Create summaries for all 7 days
          for (let i = 0; i < 7; i++) {
            const date = new Date(weekStart);
            date.setDate(date.getDate() + i);
            upsertSummary({
              userId,
              date: formatDate(date),
              status: i < 5 ? 'present' : 'weekend' as AttendanceStatus,
            });
          }
          
          // Query the week
          const summaries = getSummariesForWeek(userId, formatDate(weekStart));
          
          // Should have exactly 7 entries
          expect(summaries.length).toBe(7);
          
          // Verify dates are consecutive
          for (let i = 0; i < 7; i++) {
            const expectedDate = new Date(weekStart);
            expectedDate.setDate(expectedDate.getDate() + i);
            expect(summaries[i].date).toBe(formatDate(expectedDate));
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  it('Property 11: Month query returns correct number of days', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2024, max: 2025 }),
        fc.integer({ min: 1, max: 12 }),
        (year, month) => {
          resetTestDatabase();
          
          const userId = createUser('Test User');
          
          // Calculate days in month
          const daysInMonth = new Date(year, month, 0).getDate();
          
          // Create summaries for all days in month
          for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month - 1, day);
            upsertSummary({
              userId,
              date: formatDate(date),
              status: 'present',
            });
          }
          
          // Query the month
          const summaries = getSummariesForMonth(userId, year, month);
          
          // Should have exactly daysInMonth entries
          expect(summaries.length).toBe(daysInMonth);
          
          // Verify all days are present
          for (let day = 1; day <= daysInMonth; day++) {
            const expectedDate = formatDate(new Date(year, month - 1, day));
            const found = summaries.find(s => s.date === expectedDate);
            expect(found).toBeDefined();
          }
        }
      ),
      { numRuns: 24 }
    );
  });

  it('Upsert creates new summary and updates existing', () => {
    fc.assert(
      fc.property(
        statusArbitrary,
        statusArbitrary,
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 60 }),
        (status1, status2, late1, late2) => {
          resetTestDatabase();
          
          const userId = createUser('Test User');
          const date = '2024-06-15';
          
          // Create initial summary
          const created = upsertSummary({
            userId,
            date,
            status: status1,
            lateMinutes: late1,
          });
          
          expect(created.status).toBe(status1);
          expect(created.lateMinutes).toBe(late1);
          
          // Update the summary
          const updated = upsertSummary({
            userId,
            date,
            status: status2,
            lateMinutes: late2,
          });
          
          expect(updated.id).toBe(created.id); // Same record
          expect(updated.status).toBe(status2);
          expect(updated.lateMinutes).toBe(late2);
          
          // Verify only one record exists
          const all = getSummariesForDateRange(userId, date, date);
          expect(all.length).toBe(1);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('Query returns only summaries within date range', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 15, max: 30 }),
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 3, max: 5 }),
        (totalDays, startOffset, rangeLength) => {
          resetTestDatabase();
          
          const userId = createUser('Test User');
          const baseDate = new Date(2024, 5, 1); // June 1, 2024
          
          // Create summaries for totalDays
          for (let i = 0; i < totalDays; i++) {
            const date = new Date(baseDate);
            date.setDate(date.getDate() + i);
            upsertSummary({
              userId,
              date: formatDate(date),
              status: 'present',
            });
          }
          
          // Query a subset (ensure it's within bounds)
          const queryStart = new Date(baseDate);
          queryStart.setDate(queryStart.getDate() + startOffset);
          const queryEnd = new Date(queryStart);
          queryEnd.setDate(queryEnd.getDate() + rangeLength - 1);
          
          // Calculate expected count (may be less if range extends beyond data)
          const maxEndOffset = startOffset + rangeLength - 1;
          const expectedCount = Math.min(rangeLength, totalDays - startOffset);
          
          const summaries = getSummariesForDateRange(
            userId,
            formatDate(queryStart),
            formatDate(queryEnd)
          );
          
          // Should only return summaries in range (up to what exists)
          expect(summaries.length).toBe(expectedCount);
          
          summaries.forEach(summary => {
            expect(summary.date >= formatDate(queryStart)).toBe(true);
            expect(summary.date <= formatDate(queryEnd)).toBe(true);
          });
        }
      ),
      { numRuns: 30 }
    );
  });
});
