/**
 * Property-based tests for Dashboard Service
 * 
 * Property 26: Dashboard Statistics Accuracy
 * Validates: Requirements 12.1, 12.2
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { calculateTodayStats } from './dashboard';
import type { DailySummary, AttendanceStatus } from '../../types';

// Helper to create a daily summary
function createDailySummary(
  userId: string,
  date: string,
  options: {
    checkInTime?: string | null;
    checkOutTime?: string | null;
    isIncomplete?: boolean;
    lateMinutes?: number;
    earlyMinutes?: number;
    status?: AttendanceStatus;
  } = {}
): DailySummary {
  return {
    id: crypto.randomUUID(),
    userId,
    date,
    checkInTime: options.checkInTime ?? null,
    checkOutTime: options.checkOutTime ?? null,
    isIncomplete: options.isIncomplete ?? false,
    lateMinutes: options.lateMinutes ?? 0,
    earlyMinutes: options.earlyMinutes ?? 0,
    status: options.status ?? 'absent',
    flags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// Arbitrary for valid time in HH:mm format
const timeArbitrary = fc.tuple(
  fc.integer({ min: 0, max: 23 }),
  fc.integer({ min: 0, max: 59 })
).map(([h, m]) => `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);

// Arbitrary for attendance status
const statusArbitrary = fc.constantFrom<AttendanceStatus>(
  'present', 'absent', 'late', 'early_leave', 'incomplete', 'holiday', 'weekend'
);

// Arbitrary for a daily summary with various configurations
const dailySummaryArbitrary = fc.record({
  hasCheckIn: fc.boolean(),
  hasCheckOut: fc.boolean(),
  isIncomplete: fc.boolean(),
  isLate: fc.boolean(),
  lateMinutes: fc.integer({ min: 0, max: 120 }),
  earlyMinutes: fc.integer({ min: 0, max: 120 }),
  status: statusArbitrary,
});

describe('Dashboard Service - Property Tests', () => {
  /**
   * Property 26: Dashboard Statistics Accuracy
   * For any day, the dashboard statistics (users checked in, users not checked in)
   * should accurately reflect the attendance_day_summary data for active users.
   * Validates: Requirements 12.1, 12.2
   */
  describe('Property 26: Dashboard Statistics Accuracy', () => {
    it('checkedIn count equals number of summaries with checkInTime', () => {
      fc.assert(
        fc.property(
          fc.array(dailySummaryArbitrary, { minLength: 0, maxLength: 50 }),
          fc.integer({ min: 0, max: 100 }),
          (summaryConfigs, extraUsers) => {
            const date = '2024-06-15';
            
            // Create summaries based on configs
            const summaries: DailySummary[] = summaryConfigs.map((config, index) => 
              createDailySummary(`user-${index}`, date, {
                checkInTime: config.hasCheckIn ? '09:00' : null,
                checkOutTime: config.hasCheckOut ? '18:00' : null,
                isIncomplete: config.isIncomplete,
                lateMinutes: config.isLate ? config.lateMinutes : 0,
                earlyMinutes: config.earlyMinutes,
                status: config.status,
              })
            );
            
            // Total active users includes those with summaries plus extra users without summaries
            const totalActiveUsers = summaries.length + extraUsers;
            
            const stats = calculateTodayStats(summaries, totalActiveUsers, date);
            
            // Count expected checked in
            const expectedCheckedIn = summaries.filter(s => s.checkInTime !== null).length;
            
            expect(stats.checkedIn).toBe(expectedCheckedIn);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('notCheckedIn equals totalActiveUsers minus checkedIn', () => {
      fc.assert(
        fc.property(
          fc.array(dailySummaryArbitrary, { minLength: 0, maxLength: 50 }),
          fc.integer({ min: 0, max: 100 }),
          (summaryConfigs, extraUsers) => {
            const date = '2024-06-15';
            
            const summaries: DailySummary[] = summaryConfigs.map((config, index) => 
              createDailySummary(`user-${index}`, date, {
                checkInTime: config.hasCheckIn ? '09:00' : null,
                checkOutTime: config.hasCheckOut ? '18:00' : null,
                isIncomplete: config.isIncomplete,
                lateMinutes: config.isLate ? config.lateMinutes : 0,
                status: config.status,
              })
            );
            
            const totalActiveUsers = summaries.length + extraUsers;
            
            const stats = calculateTodayStats(summaries, totalActiveUsers, date);
            
            // Not checked in should be total minus checked in
            expect(stats.notCheckedIn).toBe(totalActiveUsers - stats.checkedIn);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('late count equals number of summaries with late status', () => {
      fc.assert(
        fc.property(
          fc.array(dailySummaryArbitrary, { minLength: 0, maxLength: 50 }),
          (summaryConfigs) => {
            const date = '2024-06-15';
            
            const summaries: DailySummary[] = summaryConfigs.map((config, index) => 
              createDailySummary(`user-${index}`, date, {
                checkInTime: config.hasCheckIn ? '09:00' : null,
                checkOutTime: config.hasCheckOut ? '18:00' : null,
                isIncomplete: config.isIncomplete,
                lateMinutes: config.lateMinutes,
                status: config.status,
              })
            );
            
            const stats = calculateTodayStats(summaries, summaries.length, date);
            
            // Count expected late
            const expectedLate = summaries.filter(s => s.status === 'late').length;
            
            expect(stats.late).toBe(expectedLate);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('incomplete count equals number of summaries with isIncomplete true', () => {
      fc.assert(
        fc.property(
          fc.array(dailySummaryArbitrary, { minLength: 0, maxLength: 50 }),
          (summaryConfigs) => {
            const date = '2024-06-15';
            
            const summaries: DailySummary[] = summaryConfigs.map((config, index) => 
              createDailySummary(`user-${index}`, date, {
                checkInTime: config.hasCheckIn ? '09:00' : null,
                checkOutTime: config.hasCheckOut ? '18:00' : null,
                isIncomplete: config.isIncomplete,
                lateMinutes: config.lateMinutes,
                status: config.status,
              })
            );
            
            const stats = calculateTodayStats(summaries, summaries.length, date);
            
            // Count expected incomplete
            const expectedIncomplete = summaries.filter(s => s.isIncomplete).length;
            
            expect(stats.incomplete).toBe(expectedIncomplete);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('stats date matches input date', () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') })
            .map(d => d.toISOString().split('T')[0] ?? ''),
          fc.array(dailySummaryArbitrary, { minLength: 0, maxLength: 10 }),
          (date, summaryConfigs) => {
            const summaries: DailySummary[] = summaryConfigs.map((config, index) => 
              createDailySummary(`user-${index}`, date, {
                checkInTime: config.hasCheckIn ? '09:00' : null,
                status: config.status,
              })
            );
            
            const stats = calculateTodayStats(summaries, summaries.length, date);
            
            expect(stats.date).toBe(date);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('notCheckedIn is never negative', () => {
      fc.assert(
        fc.property(
          fc.array(dailySummaryArbitrary, { minLength: 0, maxLength: 50 }),
          fc.integer({ min: 0, max: 100 }),
          (summaryConfigs, totalActiveUsers) => {
            const date = '2024-06-15';
            
            const summaries: DailySummary[] = summaryConfigs.map((config, index) => 
              createDailySummary(`user-${index}`, date, {
                checkInTime: config.hasCheckIn ? '09:00' : null,
                status: config.status,
              })
            );
            
            const stats = calculateTodayStats(summaries, totalActiveUsers, date);
            
            expect(stats.notCheckedIn).toBeGreaterThanOrEqual(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('all counts are non-negative integers', () => {
      fc.assert(
        fc.property(
          fc.array(dailySummaryArbitrary, { minLength: 0, maxLength: 50 }),
          fc.integer({ min: 0, max: 100 }),
          (summaryConfigs, extraUsers) => {
            const date = '2024-06-15';
            
            const summaries: DailySummary[] = summaryConfigs.map((config, index) => 
              createDailySummary(`user-${index}`, date, {
                checkInTime: config.hasCheckIn ? '09:00' : null,
                checkOutTime: config.hasCheckOut ? '18:00' : null,
                isIncomplete: config.isIncomplete,
                lateMinutes: config.lateMinutes,
                status: config.status,
              })
            );
            
            const totalActiveUsers = summaries.length + extraUsers;
            const stats = calculateTodayStats(summaries, totalActiveUsers, date);
            
            expect(Number.isInteger(stats.checkedIn)).toBe(true);
            expect(Number.isInteger(stats.notCheckedIn)).toBe(true);
            expect(Number.isInteger(stats.late)).toBe(true);
            expect(Number.isInteger(stats.incomplete)).toBe(true);
            expect(Number.isInteger(stats.onLeave)).toBe(true);
            
            expect(stats.checkedIn).toBeGreaterThanOrEqual(0);
            expect(stats.notCheckedIn).toBeGreaterThanOrEqual(0);
            expect(stats.late).toBeGreaterThanOrEqual(0);
            expect(stats.incomplete).toBeGreaterThanOrEqual(0);
            expect(stats.onLeave).toBeGreaterThanOrEqual(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('checkedIn + notCheckedIn equals totalActiveUsers', () => {
      fc.assert(
        fc.property(
          fc.array(dailySummaryArbitrary, { minLength: 0, maxLength: 50 }),
          fc.integer({ min: 0, max: 100 }),
          (summaryConfigs, extraUsers) => {
            const date = '2024-06-15';
            
            const summaries: DailySummary[] = summaryConfigs.map((config, index) => 
              createDailySummary(`user-${index}`, date, {
                checkInTime: config.hasCheckIn ? '09:00' : null,
                status: config.status,
              })
            );
            
            const totalActiveUsers = summaries.length + extraUsers;
            const stats = calculateTodayStats(summaries, totalActiveUsers, date);
            
            // The sum should equal total active users
            expect(stats.checkedIn + stats.notCheckedIn).toBe(totalActiveUsers);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('empty summaries with active users shows all as not checked in', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }),
          (totalActiveUsers) => {
            const date = '2024-06-15';
            const summaries: DailySummary[] = [];
            
            const stats = calculateTodayStats(summaries, totalActiveUsers, date);
            
            expect(stats.checkedIn).toBe(0);
            expect(stats.notCheckedIn).toBe(totalActiveUsers);
            expect(stats.late).toBe(0);
            expect(stats.incomplete).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('all users checked in shows zero not checked in', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 50 }),
          (userCount) => {
            const date = '2024-06-15';
            
            // Create summaries where all users have checked in
            const summaries: DailySummary[] = Array.from({ length: userCount }, (_, index) => 
              createDailySummary(`user-${index}`, date, {
                checkInTime: '09:00',
                checkOutTime: '18:00',
                status: 'present',
              })
            );
            
            const stats = calculateTodayStats(summaries, userCount, date);
            
            expect(stats.checkedIn).toBe(userCount);
            expect(stats.notCheckedIn).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
