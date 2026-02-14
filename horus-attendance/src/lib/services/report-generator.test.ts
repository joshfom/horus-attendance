/**
 * Property-based tests for Report Generator
 * 
 * Property 13: Report Department Filtering
 * Property 14: Weekly Summary Calculation
 * Property 15: Monthly Summary Calculation
 * Property 16: Report CSV Export Round-Trip
 * 
 * Validates: Requirements 7.3, 7.4, 7.5, 8.2, 8.4, 8.5
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  ReportGenerator,
  getWeekStart,
  getWeekDates,
  getMonthDates,
  formatDate,
  calculateWeeklySummary,
  calculateMonthlySummary,
  summaryToDayAttendance,
  exportWeeklyReportToCSV,
  exportMonthlyReportToCSV,
  parseCSV,
} from './report-generator';
import { DEFAULT_ATTENDANCE_RULES, isWorkday } from './rule-engine';
import type { User, DailySummary, DayAttendance, AttendanceStatus, ReportFilter, WeeklyReportRow, MonthlyReportRow } from '../../types';

// Helper to create a user
function createUser(id: string, departmentId: string | null = null): User {
  return {
    id,
    deviceUserId: `device-${id}`,
    deviceName: `Device User ${id}`,
    displayName: `User ${id}`,
    departmentId,
    email: null,
    phone: null,
    address: null,
    employeeCode: null,
    notes: null,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// Helper to create a daily summary
function createDailySummary(
  userId: string,
  date: string,
  status: AttendanceStatus,
  lateMinutes: number = 0,
  earlyMinutes: number = 0,
  isIncomplete: boolean = false
): DailySummary {
  return {
    id: crypto.randomUUID(),
    userId,
    date,
    checkInTime: status !== 'absent' ? '09:00' : null,
    checkOutTime: status !== 'absent' && !isIncomplete ? '18:00' : null,
    isIncomplete,
    lateMinutes,
    earlyMinutes,
    status,
    flags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// Arbitrary for valid Monday date (week start)
// Generate week number and compute the Monday
const mondayDateArbitrary = fc.integer({ min: 0, max: 103 }).map(weekNum => {
  // Start from 2024-01-01 (which is a Monday)
  const baseDate = new Date('2024-01-01');
  baseDate.setDate(baseDate.getDate() + weekNum * 7);
  return formatDate(baseDate);
});

// Arbitrary for year/month
const yearMonthArbitrary = fc.tuple(
  fc.integer({ min: 2024, max: 2025 }),
  fc.integer({ min: 1, max: 12 })
);

// Arbitrary for attendance status (workday statuses only)
const workdayStatusArbitrary = fc.constantFrom<AttendanceStatus>(
  'present', 'absent', 'late', 'early_leave', 'incomplete'
);

// Arbitrary for late/early minutes
const minutesArbitrary = fc.integer({ min: 0, max: 120 });

describe('Report Generator - Helper Functions', () => {
  describe('getWeekStart', () => {
    it('returns Monday for any date in the week', () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
          (date) => {
            const dateStr = formatDate(date);
            const weekStart = getWeekStart(dateStr);
            const monday = new Date(weekStart);
            expect(monday.getDay()).toBe(1); // Monday
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('getWeekDates', () => {
    it('returns exactly 7 dates starting from Monday', () => {
      fc.assert(
        fc.property(mondayDateArbitrary, (monday) => {
          const dates = getWeekDates(monday);
          expect(dates.length).toBe(7);
          expect(dates[0]).toBe(monday);
          
          // Verify consecutive days
          for (let i = 1; i < 7; i++) {
            const prev = new Date(dates[i - 1]!);
            const curr = new Date(dates[i]!);
            expect(curr.getTime() - prev.getTime()).toBe(24 * 60 * 60 * 1000);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('getMonthDates', () => {
    it('returns correct number of days for each month', () => {
      fc.assert(
        fc.property(yearMonthArbitrary, ([year, month]) => {
          const dates = getMonthDates(year, month);
          const expectedDays = new Date(year, month, 0).getDate();
          expect(dates.length).toBe(expectedDays);
        }),
        { numRuns: 100 }
      );
    });
  });
});


describe('Report Generator - Property Tests', () => {
  /**
   * Property 13: Report Department Filtering
   * For any report filtered by department, all users in the report should belong to
   * the specified department, and no users from other departments should be included.
   * Validates: Requirements 7.4, 8.5
   */
  describe('Property 13: Report Department Filtering', () => {
    it('weekly report only includes users from specified department', async () => {
      await fc.assert(
        fc.asyncProperty(
          mondayDateArbitrary,
          fc.integer({ min: 2, max: 5 }),
          fc.integer({ min: 2, max: 5 }),
          async (weekStart, dept1Count, dept2Count) => {
            const targetDeptId = 'target-dept';
            
            // Create users in two departments with unique IDs
            const dept1Users = Array.from({ length: dept1Count }, (_, i) => 
              createUser(`dept1-user-${i}`, targetDeptId)
            );
            const dept2Users = Array.from({ length: dept2Count }, (_, i) => 
              createUser(`dept2-user-${i}`, 'other-dept')
            );
            const allUsers = [...dept1Users, ...dept2Users];

            // Mock fetchers
            const userFetcher = async (filter?: ReportFilter) => {
              if (filter?.departmentId) {
                return allUsers.filter(u => u.departmentId === filter.departmentId);
              }
              return allUsers;
            };
            const summaryFetcher = async () => [] as DailySummary[];

            const generator = new ReportGenerator(userFetcher, summaryFetcher);
            const report = await generator.generateWeeklyReport(weekStart, { departmentId: targetDeptId });

            // All users in report should be from target department
            for (const row of report) {
              if (row.user.departmentId !== targetDeptId) return false;
            }
            
            // Report should have same count as dept1 users
            return report.length === dept1Users.length;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('monthly report only includes users from specified department', async () => {
      await fc.assert(
        fc.asyncProperty(
          yearMonthArbitrary,
          fc.integer({ min: 2, max: 5 }),
          fc.integer({ min: 2, max: 5 }),
          async ([year, month], dept1Count, dept2Count) => {
            const targetDeptId = 'target-dept';
            
            // Create users in two departments with unique IDs
            const dept1Users = Array.from({ length: dept1Count }, (_, i) => 
              createUser(`dept1-user-${i}`, targetDeptId)
            );
            const dept2Users = Array.from({ length: dept2Count }, (_, i) => 
              createUser(`dept2-user-${i}`, 'other-dept')
            );
            const allUsers = [...dept1Users, ...dept2Users];

            // Mock fetchers
            const userFetcher = async (filter?: ReportFilter) => {
              if (filter?.departmentId) {
                return allUsers.filter(u => u.departmentId === filter.departmentId);
              }
              return allUsers;
            };
            const summaryFetcher = async () => [] as DailySummary[];

            const generator = new ReportGenerator(userFetcher, summaryFetcher);
            const report = await generator.generateMonthlyReport(year, month, { departmentId: targetDeptId });

            // All users in report should be from target department
            for (const row of report) {
              if (row.user.departmentId !== targetDeptId) return false;
            }
            
            // Report should have same count as dept1 users
            return report.length === dept1Users.length;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Property 14: Weekly Summary Calculation
   * For any weekly report, the weekly totals (days present, days absent, total late minutes)
   * should equal the sum of the corresponding daily values for that week.
   * Validates: Requirements 7.5
   */
  describe('Property 14: Weekly Summary Calculation', () => {
    it('weekly totals equal sum of daily values', () => {
      fc.assert(
        fc.property(
          // Generate 7 days of attendance data (for Mon-Sun)
          fc.array(
            fc.tuple(workdayStatusArbitrary, minutesArbitrary, minutesArbitrary, fc.boolean()),
            { minLength: 7, maxLength: 7 }
          ),
          (dailyData) => {
            const weekDates = getWeekDates('2024-01-08'); // A Monday
            
            const days: DayAttendance[] = dailyData.map(([status, late, early, incomplete], i) => {
              const date = weekDates[i]!;
              const dateObj = new Date(date);
              const dayOfWeek = dateObj.getDay();
              
              // Weekend days get weekend status
              const actualStatus = (dayOfWeek === 0 || dayOfWeek === 6) ? 'weekend' : status;
              
              return {
                date,
                dayOfWeek,
                checkIn: actualStatus !== 'absent' && actualStatus !== 'weekend' ? '09:00' : null,
                checkOut: actualStatus !== 'absent' && actualStatus !== 'weekend' && !incomplete ? '18:00' : null,
                status: actualStatus,
                lateMinutes: actualStatus === 'weekend' ? 0 : late,
                earlyMinutes: actualStatus === 'weekend' ? 0 : early,
                isIncomplete: actualStatus === 'weekend' ? false : incomplete,
              };
            });

            const summary = calculateWeeklySummary(days, DEFAULT_ATTENDANCE_RULES);

            // Calculate expected values manually
            let expectedPresent = 0;
            let expectedAbsent = 0;
            let expectedLate = 0;
            let expectedEarly = 0;
            let expectedIncomplete = 0;

            for (const day of days) {
              if (day.status === 'weekend' || day.status === 'holiday') continue;
              
              if (day.status === 'present' || day.status === 'late' || day.status === 'early_leave') {
                expectedPresent++;
              } else if (day.status === 'absent') {
                expectedAbsent++;
              }
              
              if (day.isIncomplete) expectedIncomplete++;
              expectedLate += day.lateMinutes;
              expectedEarly += day.earlyMinutes;
            }

            expect(summary.daysPresent).toBe(expectedPresent);
            expect(summary.daysAbsent).toBe(expectedAbsent);
            expect(summary.totalLateMinutes).toBe(expectedLate);
            expect(summary.totalEarlyMinutes).toBe(expectedEarly);
            expect(summary.incompleteDays).toBe(expectedIncomplete);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('weekly report days array has exactly 7 entries', async () => {
      await fc.assert(
        fc.asyncProperty(
          mondayDateArbitrary,
          async (weekStart) => {
            const userId = 'test-user';
            const user = createUser(userId);
            const userFetcher = async () => [user];
            const summaryFetcher = async () => [] as DailySummary[];

            const generator = new ReportGenerator(userFetcher, summaryFetcher);
            const report = await generator.generateWeeklyReport(weekStart);

            return report.length === 1 && report[0]!.days.length === 7;
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});


  /**
   * Property 15: Monthly Summary Calculation
   * For any monthly report, the monthly totals (days present, days absent, total late minutes,
   * total early minutes, incomplete days) should equal the sum of the corresponding daily values
   * for that month.
   * Validates: Requirements 8.2
   */
  describe('Property 15: Monthly Summary Calculation', () => {
    it('monthly totals equal sum of daily values', () => {
      fc.assert(
        fc.property(
          yearMonthArbitrary,
          ([ year, month ]) => {
            const monthDates = getMonthDates(year, month);
            
            // Generate random attendance data for each day
            const days: DayAttendance[] = monthDates.map(date => {
              const dateObj = new Date(date);
              const dayOfWeek = dateObj.getDay();
              
              // Weekend days get weekend status
              const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
              const status: AttendanceStatus = isWeekend 
                ? 'weekend' 
                : (['present', 'absent', 'late', 'early_leave', 'incomplete'] as AttendanceStatus[])[Math.floor(Math.random() * 5)]!;
              
              const lateMinutes = isWeekend ? 0 : Math.floor(Math.random() * 60);
              const earlyMinutes = isWeekend ? 0 : Math.floor(Math.random() * 60);
              const isIncomplete = isWeekend ? false : Math.random() > 0.8;
              
              return {
                date,
                dayOfWeek,
                checkIn: status !== 'absent' && !isWeekend ? '09:00' : null,
                checkOut: status !== 'absent' && !isWeekend && !isIncomplete ? '18:00' : null,
                status,
                lateMinutes,
                earlyMinutes,
                isIncomplete,
              };
            });

            const summary = calculateMonthlySummary(days, DEFAULT_ATTENDANCE_RULES);

            // Calculate expected values manually
            let expectedPresent = 0;
            let expectedAbsent = 0;
            let expectedLate = 0;
            let expectedEarly = 0;
            let expectedIncomplete = 0;
            let expectedWorkingDays = 0;

            for (const day of days) {
              if (day.status === 'weekend' || day.status === 'holiday') continue;
              
              expectedWorkingDays++;
              
              if (day.status === 'present' || day.status === 'late' || day.status === 'early_leave') {
                expectedPresent++;
              } else if (day.status === 'absent') {
                expectedAbsent++;
              }
              
              if (day.isIncomplete) expectedIncomplete++;
              expectedLate += day.lateMinutes;
              expectedEarly += day.earlyMinutes;
            }

            expect(summary.daysPresent).toBe(expectedPresent);
            expect(summary.daysAbsent).toBe(expectedAbsent);
            expect(summary.totalLateMinutes).toBe(expectedLate);
            expect(summary.totalEarlyMinutes).toBe(expectedEarly);
            expect(summary.incompleteDays).toBe(expectedIncomplete);
            expect(summary.totalWorkingDays).toBe(expectedWorkingDays);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('attendance percentage is correctly calculated', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 10 }), // days present
          fc.integer({ min: 0, max: 10 }), // days absent
          (daysPresent, daysAbsent) => {
            const totalWorkingDays = daysPresent + daysAbsent;
            
            // Create mock days using actual workday dates (Mon-Fri)
            // Start from 2024-01-08 which is a Monday
            const days: DayAttendance[] = [];
            let dayIndex = 0;
            let dateOffset = 0;
            
            while (dayIndex < daysPresent + daysAbsent) {
              const date = new Date('2024-01-08');
              date.setDate(date.getDate() + dateOffset);
              const dayOfWeek = date.getDay();
              
              // Skip weekends
              if (dayOfWeek === 0 || dayOfWeek === 6) {
                dateOffset++;
                continue;
              }
              
              const dateStr = formatDate(date);
              
              if (dayIndex < daysPresent) {
                days.push({
                  date: dateStr,
                  dayOfWeek,
                  checkIn: '09:00',
                  checkOut: '18:00',
                  status: 'present',
                  lateMinutes: 0,
                  earlyMinutes: 0,
                  isIncomplete: false,
                });
              } else {
                days.push({
                  date: dateStr,
                  dayOfWeek,
                  checkIn: null,
                  checkOut: null,
                  status: 'absent',
                  lateMinutes: 0,
                  earlyMinutes: 0,
                  isIncomplete: false,
                });
              }
              
              dayIndex++;
              dateOffset++;
            }

            const summary = calculateMonthlySummary(days, DEFAULT_ATTENDANCE_RULES);

            const expectedPercentage = totalWorkingDays > 0 
              ? Math.round((daysPresent / totalWorkingDays) * 100) 
              : 0;

            expect(summary.attendancePercentage).toBe(expectedPercentage);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('monthly report dailyDetails has correct number of entries', async () => {
      await fc.assert(
        fc.asyncProperty(
          yearMonthArbitrary,
          async ([year, month]) => {
            const userId = 'test-user';
            const user = createUser(userId);
            const userFetcher = async () => [user];
            const summaryFetcher = async () => [] as DailySummary[];

            const generator = new ReportGenerator(userFetcher, summaryFetcher);
            const report = await generator.generateMonthlyReport(year, month);

            const expectedDays = new Date(year, month, 0).getDate();
            return report.length === 1 && report[0]!.dailyDetails.length === expectedDays;
          }
        ),
        { numRuns: 50 }
      );
    });
  });


describe('CSV Export - Property Tests', () => {
  /**
   * Property 16: Report CSV Export Round-Trip
   * For any report (weekly or monthly), exporting to CSV and parsing the CSV should
   * produce data equivalent to the original report data.
   * Validates: Requirements 7.3, 8.4
   */
  describe('Property 16: Report CSV Export Round-Trip', () => {
    it('weekly report CSV preserves user names and summary data', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              displayName: fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes(',') && !s.includes('"') && !s.includes('\n')),
              daysPresent: fc.integer({ min: 0, max: 5 }),
              daysAbsent: fc.integer({ min: 0, max: 5 }),
              lateMinutes: fc.integer({ min: 0, max: 300 }),
              earlyMinutes: fc.integer({ min: 0, max: 300 }),
              incompleteDays: fc.integer({ min: 0, max: 5 }),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (userData) => {
            // Create weekly report rows
            const weekDates = getWeekDates('2024-01-08');
            const report: WeeklyReportRow[] = userData.map((data, i) => ({
              user: createUser(`user-${i}`),
              days: weekDates.map(date => ({
                date,
                dayOfWeek: new Date(date).getDay(),
                checkIn: '09:00',
                checkOut: '18:00',
                status: 'present' as AttendanceStatus,
                lateMinutes: 0,
                earlyMinutes: 0,
                isIncomplete: false,
              })),
              summary: {
                daysPresent: data.daysPresent,
                daysAbsent: data.daysAbsent,
                totalLateMinutes: data.lateMinutes,
                totalEarlyMinutes: data.earlyMinutes,
                incompleteDays: data.incompleteDays,
              },
            }));

            // Update user display names
            report.forEach((row, i) => {
              row.user.displayName = userData[i]!.displayName;
            });

            // Export to CSV
            const csv = exportWeeklyReportToCSV(report);
            
            // Parse CSV
            const parsed = parseCSV(csv);
            
            // Verify structure
            expect(parsed.length).toBe(report.length + 1); // +1 for header
            
            // Verify each row has correct summary values
            for (let i = 0; i < report.length; i++) {
              const row = parsed[i + 1]!; // Skip header
              const original = report[i]!;
              
              // Check user name (first column)
              expect(row[0]).toBe(original.user.displayName);
              
              // Check summary values (last 5 columns)
              const summaryStart = row.length - 5;
              expect(parseInt(row[summaryStart]!)).toBe(original.summary.daysPresent);
              expect(parseInt(row[summaryStart + 1]!)).toBe(original.summary.daysAbsent);
              expect(parseInt(row[summaryStart + 2]!)).toBe(original.summary.totalLateMinutes);
              expect(parseInt(row[summaryStart + 3]!)).toBe(original.summary.totalEarlyMinutes);
              expect(parseInt(row[summaryStart + 4]!)).toBe(original.summary.incompleteDays);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('monthly report CSV preserves user names and summary data', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              displayName: fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes(',') && !s.includes('"') && !s.includes('\n')),
              daysPresent: fc.integer({ min: 0, max: 22 }),
              daysAbsent: fc.integer({ min: 0, max: 22 }),
              totalWorkingDays: fc.integer({ min: 0, max: 22 }),
              attendancePercentage: fc.integer({ min: 0, max: 100 }),
              lateMinutes: fc.integer({ min: 0, max: 600 }),
              earlyMinutes: fc.integer({ min: 0, max: 600 }),
              incompleteDays: fc.integer({ min: 0, max: 22 }),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (userData) => {
            // Create monthly report rows
            const report: MonthlyReportRow[] = userData.map((data, i) => ({
              user: createUser(`user-${i}`),
              summary: {
                daysPresent: data.daysPresent,
                daysAbsent: data.daysAbsent,
                totalWorkingDays: data.totalWorkingDays,
                attendancePercentage: data.attendancePercentage,
                totalLateMinutes: data.lateMinutes,
                totalEarlyMinutes: data.earlyMinutes,
                incompleteDays: data.incompleteDays,
              },
              dailyDetails: [],
            }));

            // Update user display names
            report.forEach((row, i) => {
              row.user.displayName = userData[i]!.displayName;
            });

            // Export to CSV
            const csv = exportMonthlyReportToCSV(report);
            
            // Parse CSV
            const parsed = parseCSV(csv);
            
            // Verify structure
            expect(parsed.length).toBe(report.length + 1); // +1 for header
            
            // Verify each row has correct summary values
            for (let i = 0; i < report.length; i++) {
              const row = parsed[i + 1]!; // Skip header
              const original = report[i]!;
              
              // Check user name (first column)
              expect(row[0]).toBe(original.user.displayName);
              
              // Check summary values
              expect(parseInt(row[3]!)).toBe(original.summary.daysPresent);
              expect(parseInt(row[4]!)).toBe(original.summary.daysAbsent);
              expect(parseInt(row[5]!)).toBe(original.summary.totalWorkingDays);
              expect(parseInt(row[6]!)).toBe(original.summary.attendancePercentage);
              expect(parseInt(row[7]!)).toBe(original.summary.totalLateMinutes);
              expect(parseInt(row[8]!)).toBe(original.summary.totalEarlyMinutes);
              expect(parseInt(row[9]!)).toBe(original.summary.incompleteDays);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('CSV escapes special characters correctly', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 30 }),
          (name) => {
            // Create a simple monthly report with the name
            const report: MonthlyReportRow[] = [{
              user: {
                ...createUser('user-1'),
                displayName: name,
              },
              summary: {
                daysPresent: 10,
                daysAbsent: 2,
                totalWorkingDays: 12,
                attendancePercentage: 83,
                totalLateMinutes: 30,
                totalEarlyMinutes: 15,
                incompleteDays: 1,
              },
              dailyDetails: [],
            }];

            // Export to CSV
            const csv = exportMonthlyReportToCSV(report);
            
            // Parse CSV
            const parsed = parseCSV(csv);
            
            // The name should be preserved after round-trip
            expect(parsed[1]![0]).toBe(name);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('empty report produces empty CSV', () => {
      const weeklyCSV = exportWeeklyReportToCSV([]);
      const monthlyCSV = exportMonthlyReportToCSV([]);
      
      expect(weeklyCSV).toBe('');
      expect(monthlyCSV).toBe('');
    });
  });
});
