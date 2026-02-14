/**
 * Rule Engine Implementation
 * Interprets punch records according to configured attendance rules
 * 
 * Requirements: 9.3, 9.4, 9.5, 9.6, 9.7, 7.2, 11.3
 */

import type {
  PunchRecord,
  DailySummary,
  AttendanceRules,
  AttendanceStatus,
} from '../../types';

/**
 * Default attendance rules
 */
export const DEFAULT_ATTENDANCE_RULES: AttendanceRules = {
  workStartTime: '09:00',
  workEndTime: '18:00',
  lateGracePeriod: 15,
  earlyLeaveGracePeriod: 15,
  checkInWindowStart: '06:00',
  checkInWindowEnd: '12:00',
  checkOutWindowStart: '12:00',
  checkOutWindowEnd: '23:59',
  workdays: [1, 2, 3, 4, 5], // Monday to Friday
};

/**
 * Generate a unique ID
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Get current timestamp in ISO format
 */
function now(): string {
  return new Date().toISOString();
}

/**
 * Parse time string (HH:mm) to minutes since midnight
 */
export function parseTimeToMinutes(time: string): number {
  const parts = time.split(':').map(Number);
  const hours = parts[0] ?? 0;
  const minutes = parts[1] ?? 0;
  return hours * 60 + minutes;
}

/**
 * Extract time (HH:mm) from ISO timestamp
 */
export function extractTimeFromTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Extract date (YYYY-MM-DD) from ISO timestamp
 */
export function extractDateFromTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Check if a time is within a window
 */
export function isTimeInWindow(
  time: string,
  windowStart: string,
  windowEnd: string
): boolean {
  const timeMinutes = parseTimeToMinutes(time);
  const startMinutes = parseTimeToMinutes(windowStart);
  const endMinutes = parseTimeToMinutes(windowEnd);
  
  return timeMinutes >= startMinutes && timeMinutes <= endMinutes;
}

/**
 * Filter punches that are within valid windows
 * Requirement 9.7: Filter punches outside check-in/check-out windows
 */
export function filterPunchesInWindow(
  punches: PunchRecord[],
  rules: AttendanceRules
): PunchRecord[] {
  return punches.filter(punch => {
    const time = extractTimeFromTimestamp(punch.timestamp);
    const timeMinutes = parseTimeToMinutes(time);
    const midday = parseTimeToMinutes('12:00');
    
    // Determine if this is likely a check-in or check-out based on time
    if (timeMinutes < midday) {
      // Morning punch - check against check-in window
      return isTimeInWindow(time, rules.checkInWindowStart, rules.checkInWindowEnd);
    } else {
      // Afternoon/evening punch - check against check-out window
      return isTimeInWindow(time, rules.checkOutWindowStart, rules.checkOutWindowEnd);
    }
  });
}

/**
 * Calculate late minutes based on check-in time and rules
 * Requirement 9.5: Compare check-in time against work start time plus grace period
 */
export function calculateLateMinutes(
  checkInTime: string,
  rules: AttendanceRules
): number {
  const checkInMinutes = parseTimeToMinutes(checkInTime);
  const workStartMinutes = parseTimeToMinutes(rules.workStartTime);
  const graceEndMinutes = workStartMinutes + rules.lateGracePeriod;
  
  if (checkInMinutes <= graceEndMinutes) {
    return 0;
  }
  
  return checkInMinutes - graceEndMinutes;
}

/**
 * Calculate early leave minutes based on check-out time and rules
 * Requirement 9.6: Compare check-out time against work end time minus grace period
 */
export function calculateEarlyMinutes(
  checkOutTime: string,
  rules: AttendanceRules
): number {
  const checkOutMinutes = parseTimeToMinutes(checkOutTime);
  const workEndMinutes = parseTimeToMinutes(rules.workEndTime);
  const graceStartMinutes = workEndMinutes - rules.earlyLeaveGracePeriod;
  
  if (checkOutMinutes >= graceStartMinutes) {
    return 0;
  }
  
  return graceStartMinutes - checkOutMinutes;
}

/**
 * Check if a date is a workday based on rules
 */
export function isWorkday(date: string, rules: AttendanceRules): boolean {
  const dateObj = new Date(date);
  const dayOfWeek = dateObj.getDay(); // 0 = Sunday, 1 = Monday, etc.
  return rules.workdays.includes(dayOfWeek);
}

/**
 * Holiday checker function type
 */
export type HolidayChecker = (date: string) => boolean;

/**
 * Derive attendance status from daily data
 * Requirement 7.2: Derive status from check-in time, check-out time, and configured rules
 */
export function deriveAttendanceStatus(
  checkInTime: string | null,
  checkOutTime: string | null,
  isIncomplete: boolean,
  lateMinutes: number,
  earlyMinutes: number,
  date: string,
  rules: AttendanceRules,
  isHoliday: boolean = false
): AttendanceStatus {
  // Check if it's a holiday
  if (isHoliday) {
    return 'holiday';
  }
  
  // Check if it's a weekend (non-workday)
  if (!isWorkday(date, rules)) {
    return 'weekend';
  }
  
  // No punches at all
  if (!checkInTime && !checkOutTime) {
    return 'absent';
  }
  
  // Single punch - incomplete
  if (isIncomplete) {
    return 'incomplete';
  }
  
  // Both late and early leave - prioritize late
  if (lateMinutes > 0 && earlyMinutes > 0) {
    return 'late';
  }
  
  // Late arrival
  if (lateMinutes > 0) {
    return 'late';
  }
  
  // Early leave
  if (earlyMinutes > 0) {
    return 'early_leave';
  }
  
  // Present (on time)
  return 'present';
}

/**
 * Process a day's punches and generate a daily summary
 * Requirements 9.3, 9.4: First punch as check-in, last punch as check-out
 */
export function processDay(
  userId: string,
  date: string,
  punches: PunchRecord[],
  rules: AttendanceRules = DEFAULT_ATTENDANCE_RULES,
  isHoliday: boolean = false
): DailySummary {
  const timestamp = now();
  const flags: string[] = [];
  
  // Filter punches within valid windows
  const validPunches = filterPunchesInWindow(punches, rules);
  
  // Sort punches by timestamp
  const sortedPunches = [...validPunches].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  // No valid punches
  if (sortedPunches.length === 0) {
    return {
      id: generateId(),
      userId,
      date,
      checkInTime: null,
      checkOutTime: null,
      isIncomplete: false,
      lateMinutes: 0,
      earlyMinutes: 0,
      status: deriveAttendanceStatus(null, null, false, 0, 0, date, rules, isHoliday),
      flags,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
  
  // Single punch - mark as incomplete (Requirement 9.4)
  if (sortedPunches.length === 1) {
    const singlePunch = sortedPunches[0]!;
    const punchTime = extractTimeFromTimestamp(singlePunch.timestamp);
    const punchMinutes = parseTimeToMinutes(punchTime);
    const midday = parseTimeToMinutes('12:00');
    
    // Use time-of-day logic to determine if it's check-in or check-out
    let checkInTime: string | null = null;
    let checkOutTime: string | null = null;
    let lateMinutes = 0;
    let earlyMinutes = 0;
    
    if (punchMinutes < midday) {
      // Morning punch - treat as check-in
      checkInTime = punchTime;
      lateMinutes = calculateLateMinutes(punchTime, rules);
      flags.push('single_punch_checkin');
    } else {
      // Afternoon/evening punch - treat as check-out
      checkOutTime = punchTime;
      earlyMinutes = calculateEarlyMinutes(punchTime, rules);
      flags.push('single_punch_checkout');
    }
    
    return {
      id: generateId(),
      userId,
      date,
      checkInTime,
      checkOutTime,
      isIncomplete: true,
      lateMinutes,
      earlyMinutes,
      status: deriveAttendanceStatus(checkInTime, checkOutTime, true, lateMinutes, earlyMinutes, date, rules, isHoliday),
      flags,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
  
  // Multiple punches - first is check-in, last is check-out (Requirement 9.3)
  const firstPunch = sortedPunches[0]!;
  const lastPunch = sortedPunches[sortedPunches.length - 1]!;
  
  const checkInTime = extractTimeFromTimestamp(firstPunch.timestamp);
  const checkOutTime = extractTimeFromTimestamp(lastPunch.timestamp);
  
  const lateMinutes = calculateLateMinutes(checkInTime, rules);
  const earlyMinutes = calculateEarlyMinutes(checkOutTime, rules);
  
  if (sortedPunches.length > 2) {
    flags.push('multiple_punches');
  }
  
  return {
    id: generateId(),
    userId,
    date,
    checkInTime,
    checkOutTime,
    isIncomplete: false,
    lateMinutes,
    earlyMinutes,
    status: deriveAttendanceStatus(checkInTime, checkOutTime, false, lateMinutes, earlyMinutes, date, rules, isHoliday),
    flags,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/**
 * RuleEngine class implementation
 */
export class RuleEngine {
  private rules: AttendanceRules;
  private holidayChecker: HolidayChecker;
  
  constructor(
    rules: AttendanceRules = DEFAULT_ATTENDANCE_RULES,
    holidayChecker: HolidayChecker = () => false
  ) {
    this.rules = rules;
    this.holidayChecker = holidayChecker;
  }
  
  /**
   * Update the attendance rules
   */
  setRules(rules: AttendanceRules): void {
    this.rules = rules;
  }
  
  /**
   * Get current rules
   */
  getRules(): AttendanceRules {
    return this.rules;
  }
  
  /**
   * Set the holiday checker function
   */
  setHolidayChecker(checker: HolidayChecker): void {
    this.holidayChecker = checker;
  }
  
  /**
   * Process a day's punches
   */
  processDay(userId: string, date: string, punches: PunchRecord[]): DailySummary {
    const isHoliday = this.holidayChecker(date);
    return processDay(userId, date, punches, this.rules, isHoliday);
  }
  
  /**
   * Calculate late minutes
   */
  calculateLateMinutes(checkInTime: string): number {
    return calculateLateMinutes(checkInTime, this.rules);
  }
  
  /**
   * Calculate early leave minutes
   */
  calculateEarlyMinutes(checkOutTime: string): number {
    return calculateEarlyMinutes(checkOutTime, this.rules);
  }
  
  /**
   * Check if a date is a workday
   */
  isWorkday(date: string): boolean {
    return isWorkday(date, this.rules);
  }
  
  /**
   * Check if a date is a holiday
   */
  isHoliday(date: string): boolean {
    return this.holidayChecker(date);
  }
  
  /**
   * Filter punches within valid windows
   */
  filterPunchesInWindow(punches: PunchRecord[]): PunchRecord[] {
    return filterPunchesInWindow(punches, this.rules);
  }
}

export default RuleEngine;
