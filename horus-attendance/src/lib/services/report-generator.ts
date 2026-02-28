/**
 * Report Generator Implementation
 * Produces weekly and monthly attendance reports with configurable filters
 * 
 * Requirements: 7.1, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4, 8.5
 */

import type {
  User,
  DayAttendance,
  WeeklySummary,
  WeeklyReportRow,
  MonthlySummary,
  MonthlyReportRow,
  ReportFilter,
  AttendanceRules,
  DailySummary,
  ExportSettings,
} from '../../types';
import { DEFAULT_ATTENDANCE_RULES, isWorkday } from './rule-engine';

/**
 * Get the Monday of the week containing the given date
 */
export function getWeekStart(date: string): string {
  const d = new Date(date);
  const day = d.getDay();
  // Adjust to Monday (day 1). If Sunday (0), go back 6 days
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return formatDate(d);
}

/**
 * Format a Date object to YYYY-MM-DD string
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get all dates in a week starting from Monday
 */
export function getWeekDates(weekStart: string): string[] {
  const dates: string[] = [];
  const start = new Date(weekStart);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push(formatDate(d));
  }
  return dates;
}

/**
 * Get all dates in a month
 */
export function getMonthDates(year: number, month: number): string[] {
  const dates: string[] = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month - 1, day);
    dates.push(formatDate(d));
  }
  return dates;
}

/**
 * Convert DailySummary to DayAttendance
 */
export function summaryToDayAttendance(
  summary: DailySummary | null,
  date: string,
  rules: AttendanceRules = DEFAULT_ATTENDANCE_RULES,
  isHoliday: boolean = false
): DayAttendance {
  const dateObj = new Date(date);
  const dayOfWeek = dateObj.getDay();

  if (!summary) {
    // No summary exists for this date
    let status: DayAttendance['status'] = 'absent';
    if (isHoliday) {
      status = 'holiday';
    } else if (!isWorkday(date, rules)) {
      status = 'weekend';
    }
    
    return {
      date,
      dayOfWeek,
      checkIn: null,
      checkOut: null,
      status,
      lateMinutes: 0,
      earlyMinutes: 0,
      isIncomplete: false,
    };
  }

  return {
    date,
    dayOfWeek,
    checkIn: summary.checkInTime,
    checkOut: summary.checkOutTime,
    status: summary.status,
    lateMinutes: summary.lateMinutes,
    earlyMinutes: summary.earlyMinutes,
    isIncomplete: summary.isIncomplete,
  };
}

/**
 * Calculate weekly summary from daily attendance data
 * Requirement 7.5: Calculate weekly totals for each user
 */
export function calculateWeeklySummary(
  days: DayAttendance[],
  rules: AttendanceRules = DEFAULT_ATTENDANCE_RULES
): WeeklySummary {
  let daysPresent = 0;
  let daysAbsent = 0;
  let totalLateMinutes = 0;
  let totalEarlyMinutes = 0;
  let incompleteDays = 0;

  for (const day of days) {
    // Only count workdays for present/absent calculations
    if (!isWorkday(day.date, rules) || day.status === 'holiday' || day.status === 'weekend') {
      continue;
    }

    if (day.status === 'present' || day.status === 'late' || day.status === 'early_leave') {
      daysPresent++;
    } else if (day.status === 'absent') {
      daysAbsent++;
    }

    if (day.isIncomplete) {
      incompleteDays++;
    }

    totalLateMinutes += day.lateMinutes;
    totalEarlyMinutes += day.earlyMinutes;
  }

  return {
    daysPresent,
    daysAbsent,
    totalLateMinutes,
    totalEarlyMinutes,
    incompleteDays,
  };
}

/**
 * Calculate monthly summary from daily attendance data
 * Requirement 8.2: Calculate monthly totals
 */
export function calculateMonthlySummary(
  days: DayAttendance[],
  rules: AttendanceRules = DEFAULT_ATTENDANCE_RULES
): MonthlySummary {
  let daysPresent = 0;
  let daysAbsent = 0;
  let totalLateMinutes = 0;
  let totalEarlyMinutes = 0;
  let incompleteDays = 0;
  let totalWorkingDays = 0;

  for (const day of days) {
    // Only count workdays
    if (!isWorkday(day.date, rules) || day.status === 'holiday' || day.status === 'weekend') {
      continue;
    }

    totalWorkingDays++;

    if (day.status === 'present' || day.status === 'late' || day.status === 'early_leave') {
      daysPresent++;
    } else if (day.status === 'absent') {
      daysAbsent++;
    }

    if (day.isIncomplete) {
      incompleteDays++;
    }

    totalLateMinutes += day.lateMinutes;
    totalEarlyMinutes += day.earlyMinutes;
  }

  const attendancePercentage = totalWorkingDays > 0 
    ? Math.round((daysPresent / totalWorkingDays) * 100) 
    : 0;

  return {
    daysPresent,
    daysAbsent,
    totalLateMinutes,
    totalEarlyMinutes,
    incompleteDays,
    totalWorkingDays,
    attendancePercentage,
  };
}


/**
 * Report Generator class
 * Generates weekly and monthly attendance reports
 */
export class ReportGenerator {
  private rules: AttendanceRules;
  private userFetcher: (filter?: ReportFilter) => Promise<User[]>;
  private summaryFetcher: (userId: string, startDate: string, endDate: string) => Promise<DailySummary[]>;
  private holidayChecker: (date: string) => boolean;

  constructor(
    userFetcher: (filter?: ReportFilter) => Promise<User[]>,
    summaryFetcher: (userId: string, startDate: string, endDate: string) => Promise<DailySummary[]>,
    rules: AttendanceRules = DEFAULT_ATTENDANCE_RULES,
    holidayChecker: (date: string) => boolean = () => false
  ) {
    this.userFetcher = userFetcher;
    this.summaryFetcher = summaryFetcher;
    this.rules = rules;
    this.holidayChecker = holidayChecker;
  }

  /**
   * Set attendance rules
   */
  setRules(rules: AttendanceRules): void {
    this.rules = rules;
  }

  /**
   * Set holiday checker
   */
  setHolidayChecker(checker: (date: string) => boolean): void {
    this.holidayChecker = checker;
  }

  /**
   * Generate weekly report with Mon-Sun columns
   * Requirement 7.1: Display table with users as rows and Mon-Sun as columns
   * Requirement 7.4: Filter by department
   * Requirement 7.5: Calculate weekly totals
   */
  async generateWeeklyReport(
    weekStart: string,
    filter?: ReportFilter
  ): Promise<WeeklyReportRow[]> {
    // Get users based on filter
    const users = await this.userFetcher(filter);
    
    // Filter by specific user IDs if provided
    const filteredUsers = filter?.userIds 
      ? users.filter(u => filter.userIds!.includes(u.id))
      : users;

    // Get week dates (Mon-Sun)
    const weekDates = getWeekDates(weekStart);
    const endDate = weekDates[weekDates.length - 1]!;

    const rows: WeeklyReportRow[] = [];

    for (const user of filteredUsers) {
      // Get summaries for the week
      const summaries = await this.summaryFetcher(user.id, weekStart, endDate);
      
      // Create a map for quick lookup
      const summaryMap = new Map<string, DailySummary>();
      for (const summary of summaries) {
        summaryMap.set(summary.date, summary);
      }

      // Build day attendance for each day of the week
      const days: DayAttendance[] = weekDates.map(date => {
        const summary = summaryMap.get(date) || null;
        const isHoliday = this.holidayChecker(date);
        return summaryToDayAttendance(summary, date, this.rules, isHoliday);
      });

      // Calculate weekly summary
      const summary = calculateWeeklySummary(days, this.rules);

      rows.push({
        user,
        days,
        summary,
      });
    }

    return rows;
  }

  /**
   * Generate monthly report with summary per user
   * Requirement 8.1: Display summary per user for selected month
   * Requirement 8.2: Show monthly totals
   * Requirement 8.3: Support drill-down to daily details
   * Requirement 8.5: Filter by department
   */
  async generateMonthlyReport(
    year: number,
    month: number,
    filter?: ReportFilter
  ): Promise<MonthlyReportRow[]> {
    // Get users based on filter
    const users = await this.userFetcher(filter);
    
    // Filter by specific user IDs if provided
    const filteredUsers = filter?.userIds 
      ? users.filter(u => filter.userIds!.includes(u.id))
      : users;

    // Get month dates
    const monthDates = getMonthDates(year, month);
    const startDate = monthDates[0]!;
    const endDate = monthDates[monthDates.length - 1]!;

    const rows: MonthlyReportRow[] = [];

    for (const user of filteredUsers) {
      // Get summaries for the month
      const summaries = await this.summaryFetcher(user.id, startDate, endDate);
      
      // Create a map for quick lookup
      const summaryMap = new Map<string, DailySummary>();
      for (const summary of summaries) {
        summaryMap.set(summary.date, summary);
      }

      // Build daily details for each day of the month
      const dailyDetails: DayAttendance[] = monthDates.map(date => {
        const summary = summaryMap.get(date) || null;
        const isHoliday = this.holidayChecker(date);
        return summaryToDayAttendance(summary, date, this.rules, isHoliday);
      });

      // Calculate monthly summary
      const summary = calculateMonthlySummary(dailyDetails, this.rules);

      rows.push({
        user,
        summary,
        dailyDetails,
      });
    }

    return rows;
  }
}

export default ReportGenerator;


// ============================================================================
// CSV Export Functions
// Requirements: 7.3, 8.4
// ============================================================================

/**
 * Escape a value for CSV format
 */
function escapeCSVValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  // If the value contains comma, quote, or newline, wrap in quotes and escape quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Export weekly report to CSV format
 * Requirement 7.3: Export weekly report to CSV
 */
export function exportWeeklyReportToCSV(report: WeeklyReportRow[]): string {
  if (report.length === 0) {
    return '';
  }

  const weekDates = report[0]!.days.map(d => d.date);
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Each day gets two columns: In and Out
  const headers = [
    'Employee Name',
    'Employee Code',
    ...dayNames.flatMap((name, i) => [`${name} (${weekDates[i]}) In`, `${name} (${weekDates[i]}) Out`]),
    'Days Present',
    'Days Absent',
    'Late Minutes',
    'Early Minutes',
    'Incomplete Days',
  ];

  const rows: string[] = [headers.map(escapeCSVValue).join(',')];

  const fmtTime = (t: string | null): string => {
    if (!t) return '';
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) return t.substring(0, 5);
    const raw = t.replace(/Z$/, '');
    const dt = new Date(raw);
    if (isNaN(dt.getTime())) return '';
    const hh = dt.getHours().toString().padStart(2, '0');
    const mm = dt.getMinutes().toString().padStart(2, '0');
    return `${hh}:${mm}`;
  };

  for (const row of report) {
    const dayCols = row.days.flatMap(d => [fmtTime(d.checkIn), fmtTime(d.checkOut)]);

    const dataRow = [
      row.user.displayName,
      row.user.employeeCode || '',
      ...dayCols,
      row.summary.daysPresent,
      row.summary.daysAbsent,
      row.summary.totalLateMinutes,
      row.summary.totalEarlyMinutes,
      row.summary.incompleteDays,
    ];

    rows.push(dataRow.map(escapeCSVValue).join(','));
  }

  return rows.join('\n');
}

/**
 * Export monthly report to CSV format
 * Requirement 8.4: Export monthly report to CSV
 */
export function exportMonthlyReportToCSV(report: MonthlyReportRow[]): string {
  if (report.length === 0) {
    return '';
  }

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Horizontal layout matching weekly: one row per employee, day columns as In/Out pairs
  const headers: string[] = ['Employee Name', 'Employee Code', 'Department'];
  for (const d of report[0]!.dailyDetails) {
    const dt = new Date(d.date);
    const dayLabel = dayLabels[dt.getDay()] || '';
    const dd = dt.getDate();
    headers.push(`${dayLabel} ${dd} In`, `${dayLabel} ${dd} Out`);
  }
  headers.push('Days Present', 'Days Absent', 'Total Working Days', 'Attendance %', 'Late Minutes', 'Early Minutes', 'Incomplete Days');

  const rows: string[] = [headers.map(escapeCSVValue).join(',')];

  const fmtTime = (t: string | null): string => {
    if (!t) return '';
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) return t.substring(0, 5);
    const raw = t.replace(/Z$/, '');
    const dt = new Date(raw);
    if (isNaN(dt.getTime())) return '';
    const hh = dt.getHours().toString().padStart(2, '0');
    const mm = dt.getMinutes().toString().padStart(2, '0');
    return `${hh}:${mm}`;
  };

  for (const row of report) {
    const dataRow: (string | number)[] = [
      row.user.displayName,
      row.user.employeeCode || '',
      (row.user as { departmentName?: string }).departmentName || '',
    ];
    for (const day of row.dailyDetails) {
      dataRow.push(day.status === 'weekend' ? 'Weekend' : day.status === 'holiday' ? 'Holiday' : fmtTime(day.checkIn));
      dataRow.push(day.status === 'weekend' ? '' : day.status === 'holiday' ? '' : fmtTime(day.checkOut));
    }
    dataRow.push(row.summary.daysPresent, row.summary.daysAbsent, row.summary.totalWorkingDays, row.summary.attendancePercentage, row.summary.totalLateMinutes, row.summary.totalEarlyMinutes, row.summary.incompleteDays);
    rows.push(dataRow.map(escapeCSVValue).join(','));
  }

  return rows.join('\n');
}

/**
 * Parse CSV string back to data (for round-trip testing)
 */
export function parseCSV(csv: string): string[][] {
  if (!csv) return [];
  
  const rows: string[][] = [];
  const lines = csv.split('\n');
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i]!;
      
      if (inQuotes) {
        if (char === '"') {
          if (line[i + 1] === '"') {
            current += '"';
            i++; // Skip next quote
          } else {
            inQuotes = false;
          }
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          cells.push(current);
          current = '';
        } else {
          current += char;
        }
      }
    }
    cells.push(current);
    rows.push(cells);
  }
  
  return rows;
}

/**
 * Check if a report is a weekly report
 */
export function isWeeklyReport(report: WeeklyReportRow[] | MonthlyReportRow[]): report is WeeklyReportRow[] {
  if (report.length === 0) return false;
  return 'days' in report[0]!;
}

/**
 * Export report to CSV (unified function)
 */
export function exportReportToCSV(report: WeeklyReportRow[] | MonthlyReportRow[]): string {
  if (isWeeklyReport(report)) {
    return exportWeeklyReportToCSV(report);
  }
  return exportMonthlyReportToCSV(report as MonthlyReportRow[]);
}

// ============================================================================
// Excel Export Functions (with cell coloring)
// ============================================================================

import ExcelJS from 'exceljs';

const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  onTimeThreshold: '09:00',
  lateThreshold: '09:10',
  colors: {
    onTime: '#C6EFCE',
    between: '#FFFFCC',
    late: '#FCE4D6',
    absent: '#FFC7CE',
    weekend: '#D9E1F2',
    header: '#4472C4',
  },
};

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function fmtTime(t: string | null): string {
  if (!t) return '';
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) return t.substring(0, 5);
  // Strip Z suffix — device timestamps are local time tagged as UTC
  const raw = t.replace(/Z$/, '');
  const dt = new Date(raw);
  if (isNaN(dt.getTime())) return '';
  const hh = dt.getHours().toString().padStart(2, '0');
  const mm = dt.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Convert hex color like #C6EFCE to ARGB like FFC6EFCE */
function hexToArgb(hex: string): string {
  return 'FF' + hex.replace('#', '');
}

function makeFill(hex: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: hexToArgb(hex) } };
}

const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFB0B0B0' } },
  left: { style: 'thin', color: { argb: 'FFB0B0B0' } },
  bottom: { style: 'thin', color: { argb: 'FFB0B0B0' } },
  right: { style: 'thin', color: { argb: 'FFB0B0B0' } },
};

/** Get fill color for a check-in time based on thresholds */
function getCheckInFill(checkIn: string | null, status: string, settings: ExportSettings): ExcelJS.Fill | undefined {
  const c = settings.colors ?? DEFAULT_EXPORT_SETTINGS.colors;
  if (status === 'weekend') return makeFill(c.weekend);
  if (status === 'holiday') return makeFill(c.weekend);
  if (status === 'absent' || (!checkIn && status !== 'weekend' && status !== 'holiday')) {
    return makeFill(c.absent);
  }
  if (!checkIn) return undefined;
  const t = fmtTime(checkIn);
  if (!t) return undefined;
  const mins = timeToMinutes(t);
  const lateMins = timeToMinutes(settings.lateThreshold);
  const onTimeMins = timeToMinutes(settings.onTimeThreshold);
  if (mins <= onTimeMins) return makeFill(c.onTime);
  if (mins > lateMins) return makeFill(c.late);
  return makeFill(c.between);
}

function styleHeaderRow(row: ExcelJS.Row, settings: ExportSettings) {
  const c = settings.colors ?? DEFAULT_EXPORT_SETTINGS.colors;
  const hFill = makeFill(c.header);
  const hFont: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  row.eachCell(cell => {
    cell.fill = hFill;
    cell.font = hFont;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = thinBorder;
  });
  row.height = 24;
}

export async function exportWeeklyReportToExcel(
  report: WeeklyReportRow[],
  settings: ExportSettings = DEFAULT_EXPORT_SETTINGS
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Weekly Report');

  if (report.length === 0) return new Uint8Array(await wb.xlsx.writeBuffer());

  const weekDates = report[0]!.days.map(d => d.date);
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Headers
  const headers = [
    'Employee Name',
    'Employee Code',
    ...dayNames.flatMap((name, i) => [`${name} (${weekDates[i]}) In`, `${name} (${weekDates[i]}) Out`]),
    'Present', 'Absent', 'Late (min)', 'Early (min)',
  ];
  const headerRow = ws.addRow(headers);
  styleHeaderRow(headerRow, settings);

  // Data rows
  for (const row of report) {
    const vals: (string | number)[] = [
      row.user.displayName,
      row.user.employeeCode || '',
    ];
    for (const d of row.days) {
      vals.push(d.status === 'weekend' ? 'Weekend' : d.status === 'holiday' ? 'Holiday' : fmtTime(d.checkIn));
      vals.push(d.status === 'weekend' ? '' : d.status === 'holiday' ? '' : fmtTime(d.checkOut));
    }
    vals.push(row.summary.daysPresent, row.summary.daysAbsent, row.summary.totalLateMinutes, row.summary.totalEarlyMinutes);

    const dataRow = ws.addRow(vals);

    // Add borders to all cells
    dataRow.eachCell(cell => { cell.border = thinBorder; });

    // Color the check-in cells (columns 3,5,7,9,11,13,15 — every other starting at col 3)
    for (let i = 0; i < 7; i++) {
      const day = row.days[i]!;
      const inCol = 3 + i * 2;  // 1-indexed
      const outCol = inCol + 1;
      const fill = getCheckInFill(day.checkIn, day.status, settings);
      if (fill) {
        dataRow.getCell(inCol).fill = fill;
        dataRow.getCell(outCol).fill = fill;
      }
    }
  }

  // Auto-width columns
  ws.columns.forEach(col => {
    col.width = 14;
  });
  ws.getColumn(1).width = 22;

  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export async function exportMonthlyReportToExcel(
  report: MonthlyReportRow[],
  settings: ExportSettings = DEFAULT_EXPORT_SETTINGS
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Monthly Report');

  if (report.length === 0) return new Uint8Array(await wb.xlsx.writeBuffer());

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Horizontal layout: Employee Name, Code, then (Day DD In, Day DD Out) per date, then summary cols
  const headers: string[] = ['Employee Name', 'Employee Code'];
  for (const d of report[0]!.dailyDetails) {
    const dt = new Date(d.date);
    const dayLabel = dayLabels[dt.getDay()] || '';
    const dd = dt.getDate();
    headers.push(`${dayLabel} ${dd} In`, `${dayLabel} ${dd} Out`);
  }
  headers.push('Present', 'Absent', 'Late (min)', 'Early (min)');

  const headerRow = ws.addRow(headers);
  styleHeaderRow(headerRow, settings);

  for (const row of report) {
    const vals: (string | number)[] = [
      row.user.displayName,
      row.user.employeeCode || '',
    ];
    for (const d of row.dailyDetails) {
      vals.push(d.status === 'weekend' ? 'Weekend' : d.status === 'holiday' ? 'Holiday' : fmtTime(d.checkIn));
      vals.push(d.status === 'weekend' ? '' : d.status === 'holiday' ? '' : fmtTime(d.checkOut));
    }
    vals.push(row.summary.daysPresent, row.summary.daysAbsent, row.summary.totalLateMinutes, row.summary.totalEarlyMinutes);

    const dataRow = ws.addRow(vals);
    dataRow.eachCell(cell => { cell.border = thinBorder; });

    // Color each day's In/Out cells
    for (let i = 0; i < row.dailyDetails.length; i++) {
      const day = row.dailyDetails[i]!;
      const inCol = 3 + i * 2; // 1-indexed
      const outCol = inCol + 1;
      const fill = getCheckInFill(day.checkIn, day.status, settings);
      if (fill) {
        dataRow.getCell(inCol).fill = fill;
        dataRow.getCell(outCol).fill = fill;
      }
    }
  }

  ws.columns.forEach(col => { col.width = 12; });
  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 14;

  return new Uint8Array(await wb.xlsx.writeBuffer());
}
