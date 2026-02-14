/**
 * Property-based tests for Rule Engine
 * 
 * Property 17: First/Last Punch Rule
 * Property 18: Single Punch Incomplete Marking
 * Validates: Requirements 9.3, 9.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  processDay,
  DEFAULT_ATTENDANCE_RULES,
  calculateLateMinutes,
  calculateEarlyMinutes,
  filterPunchesInWindow,
  deriveAttendanceStatus,
  isWorkday,
} from './rule-engine';
import type { PunchRecord, AttendanceRules } from '../../types';

// Helper to create a punch record
function createPunchRecord(
  deviceUserId: string,
  timestamp: string,
  id?: string
): PunchRecord {
  return {
    id: id ?? crypto.randomUUID(),
    deviceId: 'device-1',
    deviceUserId,
    timestamp,
    verifyType: 1,
    punchType: 0,
    createdAt: new Date().toISOString(),
  };
}

// Helper to create a local timestamp for a specific time on a given date
// This ensures the time we specify is the local time that will be extracted
function createLocalTimestamp(date: string, time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const dateObj = new Date(date);
  dateObj.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  return dateObj.toISOString();
}

// Arbitrary for valid date in YYYY-MM-DD format (workdays only - Mon-Fri)
const workdayDateArbitrary = fc.date({
  min: new Date('2024-01-01'),
  max: new Date('2025-12-31'),
}).filter(d => {
  const day = d.getDay();
  return day >= 1 && day <= 5; // Monday to Friday
}).map(d => {
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
});

// Arbitrary for check-in time (within check-in window: 06:00-11:59)
const checkInTimeArbitrary = fc.tuple(
  fc.integer({ min: 6, max: 11 }),
  fc.integer({ min: 0, max: 59 })
).map(([h, m]) => `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);

// Arbitrary for check-out time (within check-out window: 12:00-23:59)
const checkOutTimeArbitrary = fc.tuple(
  fc.integer({ min: 12, max: 23 }),
  fc.integer({ min: 0, max: 59 })
).map(([h, m]) => `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);

// Arbitrary for middle times (between check-in and check-out windows)
const middleTimeArbitrary = fc.tuple(
  fc.integer({ min: 9, max: 17 }),
  fc.integer({ min: 0, max: 59 })
).map(([h, m]) => `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);

describe('Rule Engine - Property Tests', () => {
  /**
   * Property 17: First/Last Punch Rule
   * For any day with multiple punch records for a user, the check-in time should equal
   * the timestamp of the first punch, and the check-out time should equal the timestamp
   * of the last punch.
   * Validates: Requirements 9.3
   */
  describe('Property 17: First/Last Punch Rule', () => {
    it('check-in equals first punch timestamp, check-out equals last punch timestamp', () => {
      fc.assert(
        fc.property(
          workdayDateArbitrary,
          checkInTimeArbitrary,
          checkOutTimeArbitrary,
          fc.array(middleTimeArbitrary, { minLength: 0, maxLength: 3 }),
          (date, checkInTime, checkOutTime, middleTimes) => {
            // Ensure check-out is after check-in
            if (checkOutTime <= checkInTime) return true;
            
            const userId = 'user-1';
            
            // Create punches with distinct times
            const allTimes = [checkInTime, ...middleTimes.filter(t => t > checkInTime && t < checkOutTime), checkOutTime];
            const uniqueTimes = [...new Set(allTimes)].sort();
            
            // Need at least 2 punches
            if (uniqueTimes.length < 2) return true;
            
            const punches: PunchRecord[] = uniqueTimes.map(t => 
              createPunchRecord(userId, createLocalTimestamp(date, t))
            );
            
            const summary = processDay(userId, date, punches, DEFAULT_ATTENDANCE_RULES);
            
            // The first and last times should be check-in and check-out
            const expectedCheckIn = uniqueTimes[0];
            const expectedCheckOut = uniqueTimes[uniqueTimes.length - 1];
            
            expect(summary.checkInTime).toBe(expectedCheckIn);
            expect(summary.checkOutTime).toBe(expectedCheckOut);
            expect(summary.isIncomplete).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('with exactly two punches, first is check-in and second is check-out', () => {
      fc.assert(
        fc.property(
          workdayDateArbitrary,
          checkInTimeArbitrary,
          checkOutTimeArbitrary,
          (date, checkInTime, checkOutTime) => {
            // Ensure check-out is after check-in
            if (checkOutTime <= checkInTime) return true;
            
            const userId = 'user-1';
            const punches: PunchRecord[] = [
              createPunchRecord(userId, createLocalTimestamp(date, checkInTime)),
              createPunchRecord(userId, createLocalTimestamp(date, checkOutTime)),
            ];
            
            const summary = processDay(userId, date, punches, DEFAULT_ATTENDANCE_RULES);
            
            expect(summary.checkInTime).toBe(checkInTime);
            expect(summary.checkOutTime).toBe(checkOutTime);
            expect(summary.isIncomplete).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 18: Single Punch Incomplete Marking
   * For any day with exactly one punch record for a user, the day should be marked
   * as incomplete (is_incomplete = true).
   * Validates: Requirements 9.4
   */
  describe('Property 18: Single Punch Incomplete Marking', () => {
    it('single punch marks day as incomplete', () => {
      fc.assert(
        fc.property(
          workdayDateArbitrary,
          fc.oneof(checkInTimeArbitrary, checkOutTimeArbitrary),
          (date, time) => {
            const userId = 'user-1';
            const punches: PunchRecord[] = [
              createPunchRecord(userId, createLocalTimestamp(date, time)),
            ];
            
            const summary = processDay(userId, date, punches, DEFAULT_ATTENDANCE_RULES);
            
            expect(summary.isIncomplete).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('single morning punch is treated as check-in', () => {
      fc.assert(
        fc.property(
          workdayDateArbitrary,
          checkInTimeArbitrary,
          (date, time) => {
            const userId = 'user-1';
            const punches: PunchRecord[] = [
              createPunchRecord(userId, createLocalTimestamp(date, time)),
            ];
            
            const summary = processDay(userId, date, punches, DEFAULT_ATTENDANCE_RULES);
            
            expect(summary.isIncomplete).toBe(true);
            expect(summary.checkInTime).toBe(time);
            expect(summary.checkOutTime).toBeNull();
            expect(summary.flags).toContain('single_punch_checkin');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('single afternoon punch is treated as check-out', () => {
      fc.assert(
        fc.property(
          workdayDateArbitrary,
          checkOutTimeArbitrary,
          (date, time) => {
            const userId = 'user-1';
            const punches: PunchRecord[] = [
              createPunchRecord(userId, createLocalTimestamp(date, time)),
            ];
            
            const summary = processDay(userId, date, punches, DEFAULT_ATTENDANCE_RULES);
            
            expect(summary.isIncomplete).toBe(true);
            expect(summary.checkInTime).toBeNull();
            expect(summary.checkOutTime).toBe(time);
            expect(summary.flags).toContain('single_punch_checkout');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('status is incomplete for single punch days', () => {
      fc.assert(
        fc.property(
          workdayDateArbitrary,
          fc.oneof(checkInTimeArbitrary, checkOutTimeArbitrary),
          (date, time) => {
            const userId = 'user-1';
            const punches: PunchRecord[] = [
              createPunchRecord(userId, createLocalTimestamp(date, time)),
            ];
            
            const summary = processDay(userId, date, punches, DEFAULT_ATTENDANCE_RULES);
            
            expect(summary.status).toBe('incomplete');
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


describe('Rule Engine - Late/Early Calculations', () => {
  /**
   * Property 19: Late Minutes Calculation
   * For any check-in time after (work_start_time + grace_period), the late_minutes should
   * equal the difference in minutes between check-in time and (work_start_time + grace_period).
   * For any check-in time at or before (work_start_time + grace_period), late_minutes should be zero.
   * Validates: Requirements 9.5
   */
  describe('Property 19: Late Minutes Calculation', () => {
    it('late minutes is zero when check-in is at or before grace period end', () => {
      fc.assert(
        fc.property(
          // Work start time (6:00 - 11:00)
          fc.tuple(
            fc.integer({ min: 6, max: 11 }),
            fc.integer({ min: 0, max: 59 })
          ).map(([h, m]) => `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`),
          // Grace period (0-60 minutes)
          fc.integer({ min: 0, max: 60 }),
          // Check-in offset from work start (-30 to grace period)
          fc.integer({ min: -30, max: 60 }),
          (workStartTime, gracePeriod, checkInOffset) => {
            const rules: AttendanceRules = {
              ...DEFAULT_ATTENDANCE_RULES,
              workStartTime,
              lateGracePeriod: gracePeriod,
            };
            
            // Calculate check-in time
            const workStartMinutes = parseInt(workStartTime.split(':')[0]!) * 60 + parseInt(workStartTime.split(':')[1]!);
            const checkInMinutes = workStartMinutes + Math.min(checkInOffset, gracePeriod);
            
            // Ensure valid time
            if (checkInMinutes < 0 || checkInMinutes >= 24 * 60) return true;
            
            const checkInHours = Math.floor(checkInMinutes / 60);
            const checkInMins = checkInMinutes % 60;
            const checkInTime = `${checkInHours.toString().padStart(2, '0')}:${checkInMins.toString().padStart(2, '0')}`;
            
            const lateMinutes = calculateLateMinutes(checkInTime, rules);
            
            // If check-in is at or before grace period end, late minutes should be 0
            if (checkInOffset <= gracePeriod) {
              expect(lateMinutes).toBe(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('late minutes equals difference when check-in is after grace period end', () => {
      fc.assert(
        fc.property(
          // Work start time (6:00 - 10:00)
          fc.tuple(
            fc.integer({ min: 6, max: 10 }),
            fc.integer({ min: 0, max: 59 })
          ).map(([h, m]) => `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`),
          // Grace period (0-30 minutes)
          fc.integer({ min: 0, max: 30 }),
          // Late amount (1-120 minutes after grace period)
          fc.integer({ min: 1, max: 120 }),
          (workStartTime, gracePeriod, lateAmount) => {
            const rules: AttendanceRules = {
              ...DEFAULT_ATTENDANCE_RULES,
              workStartTime,
              lateGracePeriod: gracePeriod,
            };
            
            // Calculate check-in time (after grace period)
            const workStartMinutes = parseInt(workStartTime.split(':')[0]!) * 60 + parseInt(workStartTime.split(':')[1]!);
            const graceEndMinutes = workStartMinutes + gracePeriod;
            const checkInMinutes = graceEndMinutes + lateAmount;
            
            // Ensure valid time
            if (checkInMinutes >= 24 * 60) return true;
            
            const checkInHours = Math.floor(checkInMinutes / 60);
            const checkInMins = checkInMinutes % 60;
            const checkInTime = `${checkInHours.toString().padStart(2, '0')}:${checkInMins.toString().padStart(2, '0')}`;
            
            const lateMinutes = calculateLateMinutes(checkInTime, rules);
            
            expect(lateMinutes).toBe(lateAmount);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 20: Early Leave Minutes Calculation
   * For any check-out time before (work_end_time - grace_period), the early_minutes should
   * equal the difference in minutes between (work_end_time - grace_period) and check-out time.
   * For any check-out time at or after (work_end_time - grace_period), early_minutes should be zero.
   * Validates: Requirements 9.6
   */
  describe('Property 20: Early Leave Minutes Calculation', () => {
    it('early minutes is zero when check-out is at or after grace period start', () => {
      fc.assert(
        fc.property(
          // Work end time (15:00 - 20:00)
          fc.tuple(
            fc.integer({ min: 15, max: 20 }),
            fc.integer({ min: 0, max: 59 })
          ).map(([h, m]) => `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`),
          // Grace period (0-60 minutes)
          fc.integer({ min: 0, max: 60 }),
          // Check-out offset from work end (-grace period to +30)
          fc.integer({ min: -60, max: 30 }),
          (workEndTime, gracePeriod, checkOutOffset) => {
            const rules: AttendanceRules = {
              ...DEFAULT_ATTENDANCE_RULES,
              workEndTime,
              earlyLeaveGracePeriod: gracePeriod,
            };
            
            // Calculate check-out time
            const workEndMinutes = parseInt(workEndTime.split(':')[0]!) * 60 + parseInt(workEndTime.split(':')[1]!);
            const graceStartMinutes = workEndMinutes - gracePeriod;
            const checkOutMinutes = workEndMinutes + Math.max(checkOutOffset, -gracePeriod);
            
            // Ensure valid time
            if (checkOutMinutes < 0 || checkOutMinutes >= 24 * 60) return true;
            
            const checkOutHours = Math.floor(checkOutMinutes / 60);
            const checkOutMins = checkOutMinutes % 60;
            const checkOutTime = `${checkOutHours.toString().padStart(2, '0')}:${checkOutMins.toString().padStart(2, '0')}`;
            
            const earlyMinutes = calculateEarlyMinutes(checkOutTime, rules);
            
            // If check-out is at or after grace period start, early minutes should be 0
            if (checkOutMinutes >= graceStartMinutes) {
              expect(earlyMinutes).toBe(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('early minutes equals difference when check-out is before grace period start', () => {
      fc.assert(
        fc.property(
          // Work end time (15:00 - 20:00)
          fc.tuple(
            fc.integer({ min: 15, max: 20 }),
            fc.integer({ min: 0, max: 59 })
          ).map(([h, m]) => `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`),
          // Grace period (0-30 minutes)
          fc.integer({ min: 0, max: 30 }),
          // Early amount (1-120 minutes before grace period)
          fc.integer({ min: 1, max: 120 }),
          (workEndTime, gracePeriod, earlyAmount) => {
            const rules: AttendanceRules = {
              ...DEFAULT_ATTENDANCE_RULES,
              workEndTime,
              earlyLeaveGracePeriod: gracePeriod,
            };
            
            // Calculate check-out time (before grace period)
            const workEndMinutes = parseInt(workEndTime.split(':')[0]!) * 60 + parseInt(workEndTime.split(':')[1]!);
            const graceStartMinutes = workEndMinutes - gracePeriod;
            const checkOutMinutes = graceStartMinutes - earlyAmount;
            
            // Ensure valid time
            if (checkOutMinutes < 0) return true;
            
            const checkOutHours = Math.floor(checkOutMinutes / 60);
            const checkOutMins = checkOutMinutes % 60;
            const checkOutTime = `${checkOutHours.toString().padStart(2, '0')}:${checkOutMins.toString().padStart(2, '0')}`;
            
            const earlyMinutes = calculateEarlyMinutes(checkOutTime, rules);
            
            expect(earlyMinutes).toBe(earlyAmount);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


describe('Rule Engine - Punch Window Filtering', () => {
  /**
   * Property 21: Punch Window Filtering
   * For any punch record with timestamp outside the configured check-in or check-out windows,
   * that punch should be excluded from attendance calculations.
   * Validates: Requirements 9.7
   */
  describe('Property 21: Punch Window Filtering', () => {
    it('punches within check-in window are included', () => {
      fc.assert(
        fc.property(
          workdayDateArbitrary,
          // Time within check-in window (06:00-11:59)
          fc.tuple(
            fc.integer({ min: 6, max: 11 }),
            fc.integer({ min: 0, max: 59 })
          ).map(([h, m]) => `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`),
          (date, time) => {
            const userId = 'user-1';
            const punches: PunchRecord[] = [
              createPunchRecord(userId, createLocalTimestamp(date, time)),
            ];
            
            const filtered = filterPunchesInWindow(punches, DEFAULT_ATTENDANCE_RULES);
            
            expect(filtered.length).toBe(1);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('punches within check-out window are included', () => {
      fc.assert(
        fc.property(
          workdayDateArbitrary,
          // Time within check-out window (12:00-23:59)
          fc.tuple(
            fc.integer({ min: 12, max: 23 }),
            fc.integer({ min: 0, max: 59 })
          ).map(([h, m]) => `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`),
          (date, time) => {
            const userId = 'user-1';
            const punches: PunchRecord[] = [
              createPunchRecord(userId, createLocalTimestamp(date, time)),
            ];
            
            const filtered = filterPunchesInWindow(punches, DEFAULT_ATTENDANCE_RULES);
            
            expect(filtered.length).toBe(1);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('punches outside all windows are excluded', () => {
      fc.assert(
        fc.property(
          workdayDateArbitrary,
          // Time outside both windows (00:00-05:59)
          fc.tuple(
            fc.integer({ min: 0, max: 5 }),
            fc.integer({ min: 0, max: 59 })
          ).map(([h, m]) => `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`),
          (date, time) => {
            const userId = 'user-1';
            const punches: PunchRecord[] = [
              createPunchRecord(userId, createLocalTimestamp(date, time)),
            ];
            
            const filtered = filterPunchesInWindow(punches, DEFAULT_ATTENDANCE_RULES);
            
            expect(filtered.length).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('filtered punches do not affect attendance calculation', () => {
      fc.assert(
        fc.property(
          workdayDateArbitrary,
          checkInTimeArbitrary,
          checkOutTimeArbitrary,
          // Invalid time (outside windows: 00:00-05:59)
          fc.tuple(
            fc.integer({ min: 0, max: 5 }),
            fc.integer({ min: 0, max: 59 })
          ).map(([h, m]) => `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`),
          (date, checkInTime, checkOutTime, invalidTime) => {
            // Ensure check-out is after check-in
            if (checkOutTime <= checkInTime) return true;
            
            const userId = 'user-1';
            
            // Create punches with valid and invalid times
            const punchesWithInvalid: PunchRecord[] = [
              createPunchRecord(userId, createLocalTimestamp(date, invalidTime)),
              createPunchRecord(userId, createLocalTimestamp(date, checkInTime)),
              createPunchRecord(userId, createLocalTimestamp(date, checkOutTime)),
            ];
            
            const punchesWithoutInvalid: PunchRecord[] = [
              createPunchRecord(userId, createLocalTimestamp(date, checkInTime)),
              createPunchRecord(userId, createLocalTimestamp(date, checkOutTime)),
            ];
            
            const summaryWithInvalid = processDay(userId, date, punchesWithInvalid, DEFAULT_ATTENDANCE_RULES);
            const summaryWithoutInvalid = processDay(userId, date, punchesWithoutInvalid, DEFAULT_ATTENDANCE_RULES);
            
            // Both should have the same check-in and check-out times
            expect(summaryWithInvalid.checkInTime).toBe(summaryWithoutInvalid.checkInTime);
            expect(summaryWithInvalid.checkOutTime).toBe(summaryWithoutInvalid.checkOutTime);
            expect(summaryWithInvalid.isIncomplete).toBe(summaryWithoutInvalid.isIncomplete);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('custom window configuration is respected', () => {
      fc.assert(
        fc.property(
          workdayDateArbitrary,
          // Custom check-in window start (4:00-8:00)
          fc.integer({ min: 4, max: 8 }),
          // Custom check-in window end (10:00-13:00) - ensure gap from start
          fc.integer({ min: 10, max: 13 }),
          // Time to test (hour only, we'll use :00 minutes)
          fc.integer({ min: 0, max: 11 }),
          (date, windowStart, windowEnd, testHour) => {
            const rules: AttendanceRules = {
              ...DEFAULT_ATTENDANCE_RULES,
              checkInWindowStart: `${windowStart.toString().padStart(2, '0')}:00`,
              checkInWindowEnd: `${windowEnd.toString().padStart(2, '0')}:00`,
            };
            
            // Use :00 minutes to match window boundaries exactly
            const time = `${testHour.toString().padStart(2, '0')}:00`;
            const userId = 'user-1';
            const punches: PunchRecord[] = [
              createPunchRecord(userId, createLocalTimestamp(date, time)),
            ];
            
            const filtered = filterPunchesInWindow(punches, rules);
            
            // Morning punches (before noon) should be checked against check-in window
            const inWindow = testHour >= windowStart && testHour <= windowEnd;
            expect(filtered.length).toBe(inWindow ? 1 : 0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


describe('Rule Engine - Status Derivation and Holiday Exclusion', () => {
  /**
   * Property 12: Attendance Status Derivation
   * For any daily attendance record, the status (present, absent, late, early_leave, incomplete)
   * should be correctly derived from the check-in time, check-out time, and configured rules.
   * Validates: Requirements 7.2
   */
  describe('Property 12: Attendance Status Derivation', () => {
    it('status is absent when no punches', () => {
      fc.assert(
        fc.property(
          workdayDateArbitrary,
          (date) => {
            const status = deriveAttendanceStatus(
              null, null, false, 0, 0, date, DEFAULT_ATTENDANCE_RULES, false
            );
            expect(status).toBe('absent');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('status is incomplete when isIncomplete is true', () => {
      fc.assert(
        fc.property(
          workdayDateArbitrary,
          checkInTimeArbitrary,
          (date, checkInTime) => {
            const status = deriveAttendanceStatus(
              checkInTime, null, true, 0, 0, date, DEFAULT_ATTENDANCE_RULES, false
            );
            expect(status).toBe('incomplete');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('status is late when lateMinutes > 0', () => {
      fc.assert(
        fc.property(
          workdayDateArbitrary,
          checkInTimeArbitrary,
          checkOutTimeArbitrary,
          fc.integer({ min: 1, max: 120 }),
          (date, checkInTime, checkOutTime, lateMinutes) => {
            const status = deriveAttendanceStatus(
              checkInTime, checkOutTime, false, lateMinutes, 0, date, DEFAULT_ATTENDANCE_RULES, false
            );
            expect(status).toBe('late');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('status is early_leave when earlyMinutes > 0 and not late', () => {
      fc.assert(
        fc.property(
          workdayDateArbitrary,
          checkInTimeArbitrary,
          checkOutTimeArbitrary,
          fc.integer({ min: 1, max: 120 }),
          (date, checkInTime, checkOutTime, earlyMinutes) => {
            const status = deriveAttendanceStatus(
              checkInTime, checkOutTime, false, 0, earlyMinutes, date, DEFAULT_ATTENDANCE_RULES, false
            );
            expect(status).toBe('early_leave');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('status is present when on time with no issues', () => {
      fc.assert(
        fc.property(
          workdayDateArbitrary,
          checkInTimeArbitrary,
          checkOutTimeArbitrary,
          (date, checkInTime, checkOutTime) => {
            const status = deriveAttendanceStatus(
              checkInTime, checkOutTime, false, 0, 0, date, DEFAULT_ATTENDANCE_RULES, false
            );
            expect(status).toBe('present');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('status is weekend for non-workdays', () => {
      // Generate weekend dates (Saturday or Sunday)
      const weekendDateArbitrary = fc.date({
        min: new Date('2024-01-01'),
        max: new Date('2025-12-31'),
      }).filter(d => {
        const day = d.getDay();
        return day === 0 || day === 6; // Sunday or Saturday
      }).map(d => {
        const year = d.getFullYear();
        const month = (d.getMonth() + 1).toString().padStart(2, '0');
        const day = d.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
      });

      fc.assert(
        fc.property(
          weekendDateArbitrary,
          checkInTimeArbitrary,
          checkOutTimeArbitrary,
          (date, checkInTime, checkOutTime) => {
            const status = deriveAttendanceStatus(
              checkInTime, checkOutTime, false, 0, 0, date, DEFAULT_ATTENDANCE_RULES, false
            );
            expect(status).toBe('weekend');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('late takes priority over early_leave when both present', () => {
      fc.assert(
        fc.property(
          workdayDateArbitrary,
          checkInTimeArbitrary,
          checkOutTimeArbitrary,
          fc.integer({ min: 1, max: 60 }),
          fc.integer({ min: 1, max: 60 }),
          (date, checkInTime, checkOutTime, lateMinutes, earlyMinutes) => {
            const status = deriveAttendanceStatus(
              checkInTime, checkOutTime, false, lateMinutes, earlyMinutes, date, DEFAULT_ATTENDANCE_RULES, false
            );
            expect(status).toBe('late');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 25: Holiday Exclusion from Working Days
   * For any date configured as a holiday, that date should be excluded from working day
   * calculations and should not count as absent.
   * Validates: Requirements 11.3
   */
  describe('Property 25: Holiday Exclusion from Working Days', () => {
    it('status is holiday when isHoliday is true', () => {
      fc.assert(
        fc.property(
          workdayDateArbitrary,
          (date) => {
            // No punches on a holiday should return 'holiday', not 'absent'
            const status = deriveAttendanceStatus(
              null, null, false, 0, 0, date, DEFAULT_ATTENDANCE_RULES, true
            );
            expect(status).toBe('holiday');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('holiday status takes priority over all other statuses', () => {
      fc.assert(
        fc.property(
          workdayDateArbitrary,
          checkInTimeArbitrary,
          checkOutTimeArbitrary,
          fc.integer({ min: 0, max: 60 }),
          fc.integer({ min: 0, max: 60 }),
          fc.boolean(),
          (date, checkInTime, checkOutTime, lateMinutes, earlyMinutes, isIncomplete) => {
            const status = deriveAttendanceStatus(
              checkInTime, checkOutTime, isIncomplete, lateMinutes, earlyMinutes, date, DEFAULT_ATTENDANCE_RULES, true
            );
            expect(status).toBe('holiday');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('processDay returns holiday status when holiday checker returns true', () => {
      fc.assert(
        fc.property(
          workdayDateArbitrary,
          checkInTimeArbitrary,
          checkOutTimeArbitrary,
          (date, checkInTime, checkOutTime) => {
            const userId = 'user-1';
            const punches: PunchRecord[] = [
              createPunchRecord(userId, createLocalTimestamp(date, checkInTime)),
              createPunchRecord(userId, createLocalTimestamp(date, checkOutTime)),
            ];
            
            // Process with holiday flag
            const summary = processDay(userId, date, punches, DEFAULT_ATTENDANCE_RULES, true);
            
            expect(summary.status).toBe('holiday');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('holidays do not count as absent', () => {
      fc.assert(
        fc.property(
          workdayDateArbitrary,
          (date) => {
            const userId = 'user-1';
            const punches: PunchRecord[] = []; // No punches
            
            // Process with holiday flag
            const summary = processDay(userId, date, punches, DEFAULT_ATTENDANCE_RULES, true);
            
            // Should be holiday, not absent
            expect(summary.status).toBe('holiday');
            expect(summary.status).not.toBe('absent');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('isWorkday function', () => {
    it('returns true for configured workdays', () => {
      fc.assert(
        fc.property(
          workdayDateArbitrary,
          (date) => {
            expect(isWorkday(date, DEFAULT_ATTENDANCE_RULES)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('returns false for weekends with default rules', () => {
      const weekendDateArbitrary = fc.date({
        min: new Date('2024-01-01'),
        max: new Date('2025-12-31'),
      }).filter(d => {
        const day = d.getDay();
        return day === 0 || day === 6;
      }).map(d => {
        const year = d.getFullYear();
        const month = (d.getMonth() + 1).toString().padStart(2, '0');
        const day = d.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
      });

      fc.assert(
        fc.property(
          weekendDateArbitrary,
          (date) => {
            expect(isWorkday(date, DEFAULT_ATTENDANCE_RULES)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
