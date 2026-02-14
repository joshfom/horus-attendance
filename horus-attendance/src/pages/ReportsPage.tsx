import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import type { 
  Department, 
  WeeklyReportRow, 
  MonthlyReportRow, 
  AttendanceStatus,
  User,
  DayAttendance,
  UserStatus,
  ExportSettings
} from '../types/models';
import { departmentRepository } from '../lib/repositories/department.repository';
import { userRepository } from '../lib/repositories/user.repository';
import { attendanceSummaryRepository } from '../lib/repositories/attendance-summary.repository';
import { settingsRepository } from '../lib/repositories/settings.repository';
import { 
  ReportGenerator, 
  getWeekStart, 
  exportWeeklyReportToExcel, 
  exportMonthlyReportToExcel 
} from '../lib/services/report-generator';

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.03 },
  },
};

const rowVariants = {
  hidden: { opacity: 0, x: -10 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.15 } },
};

const modalVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, scale: 0.95, transition: { duration: 0.15 } },
};

// Report type
type ReportType = 'weekly' | 'monthly';

// Day names for weekly report
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Helper function to format date to YYYY-MM-DD
function formatDateString(date: Date): string {
  return date.toISOString().split('T')[0] as string;
}

// Status Badge Component
function StatusBadge({ status, compact = false }: { status: AttendanceStatus; compact?: boolean }) {
  const colors: Record<AttendanceStatus, string> = {
    present: 'bg-success-600/20 text-success-500 border-success-600/30',
    absent: 'bg-danger-600/20 text-danger-500 border-danger-600/30',
    late: 'bg-warning-600/20 text-warning-500 border-warning-600/30',
    early_leave: 'bg-orange-600/20 text-orange-500 border-orange-600/30',
    incomplete: 'bg-secondary-600/20 text-secondary-400 border-secondary-600/30',
    holiday: 'bg-primary-600/20 text-primary-400 border-primary-600/30',
    weekend: 'bg-secondary-600/20 text-secondary-500 border-secondary-600/30',
  };
  
  const labels: Record<AttendanceStatus, string> = {
    present: compact ? 'P' : 'Present',
    absent: compact ? 'A' : 'Absent',
    late: compact ? 'L' : 'Late',
    early_leave: compact ? 'E' : 'Early',
    incomplete: compact ? 'I' : 'Incomplete',
    holiday: compact ? 'H' : 'Holiday',
    weekend: compact ? '-' : 'Weekend',
  };
  
  return (
    <span className={`px-2 py-1 text-xs font-medium rounded border ${colors[status]} ${compact ? 'min-w-[28px] text-center inline-block' : ''}`}>
      {labels[status]}
    </span>
  );
}

// Format time string — handles both ISO timestamps and HH:mm:ss time-only strings
function formatTime(time: string | null): string {
  if (!time) return '--:--';
  // If it's a time-only string like "08:30:00" or "08:30", return HH:mm directly
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(time)) {
    return time.substring(0, 5);
  }
  const dt = new Date(time);
  if (isNaN(dt.getTime())) return '--:--';
  return dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// Day Cell Component for Weekly Report
function DayCell({ day, showTimes = false }: { day: DayAttendance; showTimes?: boolean }) {
  if (showTimes) {
    return (
      <div className="text-center">
        <p className="text-xs text-white font-mono">{formatTime(day.checkIn)}</p>
        <p className="text-xs text-secondary-400 font-mono">{formatTime(day.checkOut)}</p>
        {day.lateMinutes > 0 && (
          <p className="text-xs text-warning-500">+{day.lateMinutes}m</p>
        )}
      </div>
    );
  }

  return (
    <div className="text-center">
      <StatusBadge status={day.status} compact />
      {day.checkIn && (
        <p className="text-xs text-secondary-400 mt-1">{formatTime(day.checkIn)}</p>
      )}
      {day.lateMinutes > 0 && (
        <p className="text-xs text-warning-500">+{day.lateMinutes}m</p>
      )}
    </div>
  );
}

// User Daily Details Modal for Monthly Report Drill-down
interface UserDailyDetailsModalProps {
  user: User;
  dailyDetails: DayAttendance[];
  month: string;
  onClose: () => void;
}

function UserDailyDetailsModal({ user, dailyDetails, month, onClose }: UserDailyDetailsModalProps) {

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <motion.div
        variants={modalVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="relative bg-secondary-800 rounded-xl p-6 w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-white">{user.displayName}</h2>
            <p className="text-secondary-400 text-sm">Daily Details - {month}</p>
          </div>
          <button onClick={onClose} className="text-secondary-400 hover:text-white">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          <table className="w-full">
            <thead className="sticky top-0 bg-secondary-800">
              <tr className="border-b border-secondary-700">
                <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400">Date</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400">Day</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400">Check In</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400">Check Out</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400">Late</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400">Early</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400">Status</th>
              </tr>
            </thead>
            <tbody>
              {dailyDetails.map((day) => {
                const date = new Date(day.date);
                const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                return (
                  <tr key={day.date} className="border-b border-secondary-700/50 hover:bg-secondary-700/30">
                    <td className="py-3 px-4 text-white">
                      {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </td>
                    <td className="py-3 px-4 text-secondary-300">{dayNames[day.dayOfWeek]}</td>
                    <td className="py-3 px-4 text-white font-mono">{formatTime(day.checkIn)}</td>
                    <td className="py-3 px-4 text-white font-mono">{formatTime(day.checkOut)}</td>
                    <td className="py-3 px-4">
                      {day.lateMinutes > 0 ? (
                        <span className="text-warning-500">{day.lateMinutes} min</span>
                      ) : (
                        <span className="text-secondary-500">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {day.earlyMinutes > 0 ? (
                        <span className="text-orange-500">{day.earlyMinutes} min</span>
                      ) : (
                        <span className="text-secondary-500">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4"><StatusBadge status={day.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}

// Weekly Report Table Component
interface WeeklyReportTableProps {
  report: WeeklyReportRow[];
  weekDates: string[];
  loading: boolean;
  showTimes: boolean;
}

function WeeklyReportTable({ report, weekDates, loading, showTimes }: WeeklyReportTableProps) {
  if (loading) {
    return (
      <div className="py-12 text-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full mx-auto"
        />
      </div>
    );
  }

  if (report.length === 0) {
    return (
      <div className="py-12 text-center text-secondary-400">
        No attendance data found for this week
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-secondary-700">
            <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400 sticky left-0 bg-secondary-800">
              Employee
            </th>
            {DAY_NAMES.map((day, i) => (
              <th key={day} className="text-center py-3 px-2 text-sm font-medium text-secondary-400 min-w-[80px]">
                <div>{day}</div>
                <div className="text-xs text-secondary-500">
                  {weekDates[i] ? new Date(weekDates[i]!).getDate() : ''}
                </div>
              </th>
            ))}
            <th className="text-center py-3 px-2 text-sm font-medium text-secondary-400">Present</th>
            <th className="text-center py-3 px-2 text-sm font-medium text-secondary-400">Absent</th>
            <th className="text-center py-3 px-2 text-sm font-medium text-secondary-400">Late</th>
          </tr>
        </thead>
        <motion.tbody variants={containerVariants} initial="hidden" animate="visible">
          {report.map((row) => (
            <motion.tr
              key={row.user.id}
              variants={rowVariants}
              className="border-b border-secondary-700/50 hover:bg-secondary-700/30"
            >
              <td className="py-3 px-4 sticky left-0 bg-secondary-800">
                <div>
                  <p className="text-white font-medium">{row.user.displayName}</p>
                  {row.user.employeeCode && (
                    <p className="text-secondary-400 text-xs">{row.user.employeeCode}</p>
                  )}
                </div>
              </td>
              {row.days.map((day, i) => (
                <td key={i} className="py-3 px-2">
                  <DayCell day={day} showTimes={showTimes} />
                </td>
              ))}
              <td className="py-3 px-2 text-center">
                <span className="text-success-500 font-medium">{row.summary.daysPresent}</span>
              </td>
              <td className="py-3 px-2 text-center">
                <span className="text-danger-500 font-medium">{row.summary.daysAbsent}</span>
              </td>
              <td className="py-3 px-2 text-center">
                <span className="text-warning-500 font-medium">{row.summary.totalLateMinutes}m</span>
              </td>
            </motion.tr>
          ))}
        </motion.tbody>
      </table>
    </div>
  );
}

// Monthly Report Table Component
interface MonthlyReportTableProps {
  report: MonthlyReportRow[];
  loading: boolean;
  onUserClick: (row: MonthlyReportRow) => void;
}

function MonthlyReportTable({ report, loading, onUserClick }: MonthlyReportTableProps) {
  if (loading) {
    return (
      <div className="py-12 text-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full mx-auto"
        />
      </div>
    );
  }

  if (report.length === 0) {
    return (
      <div className="py-12 text-center text-secondary-400">
        No attendance data found for this month
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-secondary-700">
            <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400">Employee</th>
            <th className="text-center py-3 px-4 text-sm font-medium text-secondary-400">Working Days</th>
            <th className="text-center py-3 px-4 text-sm font-medium text-secondary-400">Present</th>
            <th className="text-center py-3 px-4 text-sm font-medium text-secondary-400">Absent</th>
            <th className="text-center py-3 px-4 text-sm font-medium text-secondary-400">Attendance %</th>
            <th className="text-center py-3 px-4 text-sm font-medium text-secondary-400">Late (min)</th>
            <th className="text-center py-3 px-4 text-sm font-medium text-secondary-400">Early (min)</th>
            <th className="text-center py-3 px-4 text-sm font-medium text-secondary-400">Incomplete</th>
            <th className="text-right py-3 px-4 text-sm font-medium text-secondary-400">Actions</th>
          </tr>
        </thead>
        <motion.tbody variants={containerVariants} initial="hidden" animate="visible">
          {report.map((row) => (
            <motion.tr
              key={row.user.id}
              variants={rowVariants}
              className="border-b border-secondary-700/50 hover:bg-secondary-700/30"
            >
              <td className="py-3 px-4">
                <div>
                  <p className="text-white font-medium">{row.user.displayName}</p>
                  {row.user.employeeCode && (
                    <p className="text-secondary-400 text-xs">{row.user.employeeCode}</p>
                  )}
                </div>
              </td>
              <td className="py-3 px-4 text-center text-secondary-300">
                {row.summary.totalWorkingDays}
              </td>
              <td className="py-3 px-4 text-center">
                <span className="text-success-500 font-medium">{row.summary.daysPresent}</span>
              </td>
              <td className="py-3 px-4 text-center">
                <span className="text-danger-500 font-medium">{row.summary.daysAbsent}</span>
              </td>
              <td className="py-3 px-4 text-center">
                <span className={`font-medium ${
                  row.summary.attendancePercentage >= 90 ? 'text-success-500' :
                  row.summary.attendancePercentage >= 75 ? 'text-warning-500' :
                  'text-danger-500'
                }`}>
                  {row.summary.attendancePercentage}%
                </span>
              </td>
              <td className="py-3 px-4 text-center">
                <span className="text-warning-500">{row.summary.totalLateMinutes}</span>
              </td>
              <td className="py-3 px-4 text-center">
                <span className="text-orange-500">{row.summary.totalEarlyMinutes}</span>
              </td>
              <td className="py-3 px-4 text-center">
                <span className="text-secondary-400">{row.summary.incompleteDays}</span>
              </td>
              <td className="py-3 px-4 text-right">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => onUserClick(row)}
                  className="p-2 rounded-lg bg-secondary-700 hover:bg-secondary-600 text-secondary-300 hover:text-white"
                  title="View Daily Details"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </motion.button>
              </td>
            </motion.tr>
          ))}
        </motion.tbody>
      </table>
    </div>
  );
}

// Monthly Detail Table Component (horizontal layout like weekly)
interface MonthlyDetailTableProps {
  report: MonthlyReportRow[];
  loading: boolean;
  showTimes: boolean;
}

function MonthlyDetailTable({ report, loading, showTimes }: MonthlyDetailTableProps) {
  if (loading) {
    return (
      <div className="py-12 text-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full mx-auto"
        />
      </div>
    );
  }

  if (report.length === 0) {
    return (
      <div className="py-12 text-center text-secondary-400">
        No attendance data found for this month
      </div>
    );
  }

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dates = report[0]!.dailyDetails;

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-secondary-700">
            <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400 sticky left-0 bg-secondary-800">
              Employee
            </th>
            {dates.map((d) => {
              const dt = new Date(d.date);
              return (
                <th key={d.date} className="text-center py-3 px-1 text-sm font-medium text-secondary-400 min-w-[60px]">
                  <div className="text-xs">{dayLabels[dt.getDay()]}</div>
                  <div className="text-xs text-secondary-500">{dt.getDate()}</div>
                </th>
              );
            })}
            <th className="text-center py-3 px-2 text-sm font-medium text-secondary-400">Present</th>
            <th className="text-center py-3 px-2 text-sm font-medium text-secondary-400">Absent</th>
            <th className="text-center py-3 px-2 text-sm font-medium text-secondary-400">Late</th>
          </tr>
        </thead>
        <motion.tbody variants={containerVariants} initial="hidden" animate="visible">
          {report.map((row) => (
            <motion.tr
              key={row.user.id}
              variants={rowVariants}
              className="border-b border-secondary-700/50 hover:bg-secondary-700/30"
            >
              <td className="py-3 px-4 sticky left-0 bg-secondary-800">
                <div>
                  <p className="text-white font-medium text-sm">{row.user.displayName}</p>
                  {row.user.employeeCode && (
                    <p className="text-secondary-400 text-xs">{row.user.employeeCode}</p>
                  )}
                </div>
              </td>
              {row.dailyDetails.map((day) => (
                <td key={day.date} className="py-3 px-1">
                  <DayCell day={day} showTimes={showTimes} />
                </td>
              ))}
              <td className="py-3 px-2 text-center">
                <span className="text-success-500 font-medium">{row.summary.daysPresent}</span>
              </td>
              <td className="py-3 px-2 text-center">
                <span className="text-danger-500 font-medium">{row.summary.daysAbsent}</span>
              </td>
              <td className="py-3 px-2 text-center">
                <span className="text-warning-500 font-medium">{row.summary.totalLateMinutes}m</span>
              </td>
            </motion.tr>
          ))}
        </motion.tbody>
      </table>
    </div>
  );
}

// Multi-Select Dropdown Component for user filtering
interface MultiSelectDropdownProps {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
}

function MultiSelectDropdown({ options, selected, onChange, placeholder = 'All Employees' }: MultiSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()));

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value]);
  };

  const label = selected.length === 0
    ? placeholder
    : selected.length <= 2
      ? selected.map(id => options.find(o => o.value === id)?.label || id).join(', ')
      : `${selected.length} selected`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="input min-w-[220px] text-left flex items-center justify-between gap-2"
      >
        <span className="truncate text-sm">{label}</span>
        <svg className={`w-4 h-4 text-secondary-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-secondary-800 border border-secondary-600 rounded-lg shadow-xl max-h-64 overflow-hidden flex flex-col">
          <div className="p-2 border-b border-secondary-700">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="input w-full text-sm py-1.5"
              autoFocus
            />
          </div>
          <div className="overflow-y-auto flex-1">
            {selected.length > 0 && (
              <button
                onClick={() => { onChange([]); setSearch(''); }}
                className="w-full text-left px-3 py-2 text-xs text-primary-400 hover:bg-secondary-700 border-b border-secondary-700"
              >
                Clear selection
              </button>
            )}
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm text-secondary-500 text-center">No matches</div>
            ) : (
              filtered.map(opt => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-secondary-700 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(opt.value)}
                    onChange={() => toggle(opt.value)}
                    className="w-3.5 h-3.5 rounded border-secondary-600 bg-secondary-700 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm text-secondary-200 truncate">{opt.label}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Main Reports Page Component
export function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  
  // State
  const [reportType, setReportType] = useState<ReportType>(
    (searchParams.get('type') as ReportType) || 'weekly'
  );
  const [departments, setDepartments] = useState<Department[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState(searchParams.get('departmentId') || '');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<UserStatus | 'all'>('active');
  const [loading, setLoading] = useState(true);
  
  // Weekly report state
  const [weeklyReport, setWeeklyReport] = useState<WeeklyReportRow[]>([]);
  const [selectedWeekStart, setSelectedWeekStart] = useState(() => {
    const dateParam = searchParams.get('weekStart');
    return dateParam || getWeekStart(formatDateString(new Date()));
  });
  const [weekDates, setWeekDates] = useState<string[]>([]);
  
  // Monthly report state
  const [monthlyReport, setMonthlyReport] = useState<MonthlyReportRow[]>([]);
  const [selectedYear, setSelectedYear] = useState(() => {
    const yearParam = searchParams.get('year');
    return yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
  });
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const monthParam = searchParams.get('month');
    return monthParam ? parseInt(monthParam, 10) : new Date().getMonth() + 1;
  });
  
  // Drill-down modal state
  const [selectedUserRow, setSelectedUserRow] = useState<MonthlyReportRow | null>(null);
  
  // View toggles
  const [showTimes, setShowTimes] = useState(false);
  const [monthlyView, setMonthlyView] = useState<'detail' | 'summary'>('detail');

  // Load departments and users for filters
  useEffect(() => {
    const loadFilterData = async () => {
      try {
        const [deptList, userList] = await Promise.all([
          departmentRepository.listDepartments(),
          userRepository.listUsers({ status: 'all' }),
        ]);
        setDepartments(deptList);
        setAllUsers(userList);
      } catch (error) {
        console.error('Failed to load filter data:', error);
      }
    };
    loadFilterData();
  }, []);

  // Create report generator
  const createReportGenerator = useCallback(() => {
    const userFetcher = async (filter?: { departmentId?: string }) => {
      const userFilter: { status: UserStatus | 'all'; departmentId?: string } = { status: statusFilter };
      if (filter?.departmentId) {
        userFilter.departmentId = filter.departmentId;
      }
      const users = await userRepository.listUsers(userFilter);
      return users;
    };

    const summaryFetcher = async (userId: string, startDate: string, endDate: string) => {
      return attendanceSummaryRepository.getSummariesForDateRange(userId, startDate, endDate);
    };

    return new ReportGenerator(userFetcher, summaryFetcher);
  }, [statusFilter]);

  // Load weekly report
  const loadWeeklyReport = useCallback(async () => {
    try {
      setLoading(true);
      const generator = createReportGenerator();
      const filter: { departmentId?: string; userIds?: string[] } = {};
      if (selectedDepartmentId) filter.departmentId = selectedDepartmentId;
      if (selectedUserIds.length > 0) filter.userIds = selectedUserIds;
      const report = await generator.generateWeeklyReport(selectedWeekStart, Object.keys(filter).length > 0 ? filter : undefined);
      setWeeklyReport(report);
      
      // Calculate week dates
      const dates: string[] = [];
      const start = new Date(selectedWeekStart);
      for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        dates.push(formatDateString(d));
      }
      setWeekDates(dates);
    } catch (error) {
      console.error('Failed to load weekly report:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedWeekStart, selectedDepartmentId, selectedUserIds, createReportGenerator]);

  // Load monthly report
  const loadMonthlyReport = useCallback(async () => {
    try {
      setLoading(true);
      const generator = createReportGenerator();
      const filter: { departmentId?: string; userIds?: string[] } = {};
      if (selectedDepartmentId) filter.departmentId = selectedDepartmentId;
      if (selectedUserIds.length > 0) filter.userIds = selectedUserIds;
      const report = await generator.generateMonthlyReport(selectedYear, selectedMonth, Object.keys(filter).length > 0 ? filter : undefined);
      setMonthlyReport(report);
    } catch (error) {
      console.error('Failed to load monthly report:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedYear, selectedMonth, selectedDepartmentId, selectedUserIds, createReportGenerator]);

  // Load report based on type
  useEffect(() => {
    if (reportType === 'weekly') {
      loadWeeklyReport();
    } else {
      loadMonthlyReport();
    }
    
    // Update URL params
    const params = new URLSearchParams();
    params.set('type', reportType);
    if (selectedDepartmentId) params.set('departmentId', selectedDepartmentId);
    if (reportType === 'weekly') {
      params.set('weekStart', selectedWeekStart);
    } else {
      params.set('year', String(selectedYear));
      params.set('month', String(selectedMonth));
    }
    setSearchParams(params, { replace: true });
  }, [reportType, selectedWeekStart, selectedYear, selectedMonth, selectedDepartmentId, selectedUserIds, statusFilter, loadWeeklyReport, loadMonthlyReport, setSearchParams]);

  // Navigation handlers for weekly report
  const handlePreviousWeek = () => {
    const current = new Date(selectedWeekStart);
    current.setDate(current.getDate() - 7);
    setSelectedWeekStart(formatDateString(current));
  };

  const handleNextWeek = () => {
    const current = new Date(selectedWeekStart);
    current.setDate(current.getDate() + 7);
    setSelectedWeekStart(formatDateString(current));
  };

  const handleCurrentWeek = () => {
    setSelectedWeekStart(getWeekStart(formatDateString(new Date())));
  };

  // Navigation handlers for monthly report
  const handlePreviousMonth = () => {
    if (selectedMonth === 1) {
      setSelectedYear(selectedYear - 1);
      setSelectedMonth(12);
    } else {
      setSelectedMonth(selectedMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (selectedMonth === 12) {
      setSelectedYear(selectedYear + 1);
      setSelectedMonth(1);
    } else {
      setSelectedMonth(selectedMonth + 1);
    }
  };

  const handleCurrentMonth = () => {
    const now = new Date();
    setSelectedYear(now.getFullYear());
    setSelectedMonth(now.getMonth() + 1);
  };

  // Excel Export handler
  const handleExportCSV = async () => {
    try {
      // Load export settings for color thresholds
      const appSettings = await settingsRepository.getAppSettings();
      const exportSettings: ExportSettings = appSettings.export;

      let buffer: Uint8Array;
      let defaultFilename: string;
      
      if (reportType === 'weekly') {
        buffer = await exportWeeklyReportToExcel(weeklyReport, exportSettings);
        defaultFilename = `weekly-report-${selectedWeekStart}.xlsx`;
      } else {
        buffer = await exportMonthlyReportToExcel(monthlyReport, exportSettings);
        defaultFilename = `monthly-report-${selectedYear}-${String(selectedMonth).padStart(2, '0')}.xlsx`;
      }
      
      // Open native save dialog
      const filePath = await save({
        title: 'Export Report',
        defaultPath: defaultFilename,
        filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
      });
      
      if (!filePath) return;
      
      // Convert Uint8Array to base64 and write via Tauri command
      const binary = Array.from(buffer).map(b => String.fromCharCode(b)).join('');
      const base64 = btoa(binary);
      await invoke('write_binary_file', { path: filePath, base64Data: base64 });
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  // Format period label
  const getWeekPeriodLabel = (): string => {
    const start = new Date(selectedWeekStart);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  };

  const getMonthPeriodLabel = (): string => {
    const date = new Date(selectedYear, selectedMonth - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  // Month options for dropdown
  const monthOptions = [
    { value: 1, label: 'January' },
    { value: 2, label: 'February' },
    { value: 3, label: 'March' },
    { value: 4, label: 'April' },
    { value: 5, label: 'May' },
    { value: 6, label: 'June' },
    { value: 7, label: 'July' },
    { value: 8, label: 'August' },
    { value: 9, label: 'September' },
    { value: 10, label: 'October' },
    { value: 11, label: 'November' },
    { value: 12, label: 'December' },
  ];

  // Year options (last 5 years)
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i);

  return (
    <div className="p-8">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-2xl font-bold text-white">Reports</h1>
        <p className="text-secondary-400 mt-1">Generate and export attendance reports</p>
      </motion.div>

      {/* Report Type Tabs and Filters */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="card mb-6"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Report Type Tabs */}
          <div className="flex items-center gap-2">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setReportType('weekly')}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                reportType === 'weekly'
                  ? 'bg-primary-600 text-white'
                  : 'bg-secondary-700 hover:bg-secondary-600 text-secondary-300 hover:text-white'
              }`}
            >
              Weekly Report
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setReportType('monthly')}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                reportType === 'monthly'
                  ? 'bg-primary-600 text-white'
                  : 'bg-secondary-700 hover:bg-secondary-600 text-secondary-300 hover:text-white'
              }`}
            >
              Monthly Report
            </motion.button>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <label className="block text-sm font-medium text-secondary-300 mb-1">Department</label>
              <select
                value={selectedDepartmentId}
                onChange={(e) => setSelectedDepartmentId(e.target.value)}
                className="input min-w-[180px]"
              >
                <option value="">All Departments</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>{dept.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-secondary-300 mb-1">Employees</label>
              <MultiSelectDropdown
                options={allUsers
                  .filter(u => statusFilter === 'all' || u.status === statusFilter)
                  .filter(u => !selectedDepartmentId || u.departmentId === selectedDepartmentId)
                  .map(u => ({ value: u.id, label: u.displayName }))}
                selected={selectedUserIds}
                onChange={setSelectedUserIds}
                placeholder="All Employees"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-secondary-300 mb-1">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value as UserStatus | 'all'); setSelectedUserIds([]); }}
                className="input min-w-[140px]"
              >
                <option value="active">Active Only</option>
                <option value="inactive">Inactive Only</option>
                <option value="all">All Users</option>
              </select>
            </div>

            {/* Export Button */}
            <div className="flex items-end">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleExportCSV}
                disabled={loading || (reportType === 'weekly' ? weeklyReport.length === 0 : monthlyReport.length === 0)}
                className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export Excel
              </motion.button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Period Navigation */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="card mb-6"
      >
        {reportType === 'weekly' ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handlePreviousWeek}
                className="p-2 rounded-lg bg-secondary-700 hover:bg-secondary-600 text-secondary-300 hover:text-white"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </motion.button>
              
              <span className="px-4 py-2 text-white font-medium min-w-[250px] text-center">
                {getWeekPeriodLabel()}
              </span>
              
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleNextWeek}
                className="p-2 rounded-lg bg-secondary-700 hover:bg-secondary-600 text-secondary-300 hover:text-white"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </motion.button>
              
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleCurrentWeek}
                className="btn-secondary ml-2"
              >
                This Week
              </motion.button>
            </div>
            
            <div className="text-secondary-400 text-sm">
              {weeklyReport.length} employee{weeklyReport.length !== 1 ? 's' : ''}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handlePreviousMonth}
                  className="p-2 rounded-lg bg-secondary-700 hover:bg-secondary-600 text-secondary-300 hover:text-white"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </motion.button>
                
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(parseInt(e.target.value, 10))}
                  className="input"
                >
                  {monthOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
                  className="input"
                >
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
                
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleNextMonth}
                  className="p-2 rounded-lg bg-secondary-700 hover:bg-secondary-600 text-secondary-300 hover:text-white"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </motion.button>
              </div>
              
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleCurrentMonth}
                className="btn-secondary"
              >
                This Month
              </motion.button>
            </div>
            
            <div className="text-secondary-400 text-sm">
              {monthlyReport.length} employee{monthlyReport.length !== 1 ? 's' : ''}
            </div>
          </div>
        )}
      </motion.div>

      {/* View Toggles */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="flex items-center gap-4 mb-4"
      >
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showTimes}
            onChange={(e) => setShowTimes(e.target.checked)}
            className="w-4 h-4 rounded border-secondary-600 bg-secondary-700 text-primary-600 focus:ring-primary-500"
          />
          <span className="text-sm text-secondary-300">Show In/Out times</span>
        </label>

        {reportType === 'monthly' && (
          <div className="flex items-center gap-1 bg-secondary-800 rounded-lg p-1 border border-secondary-700">
            <button
              onClick={() => setMonthlyView('detail')}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                monthlyView === 'detail'
                  ? 'bg-primary-600 text-white'
                  : 'text-secondary-400 hover:text-white'
              }`}
            >
              Detail
            </button>
            <button
              onClick={() => setMonthlyView('summary')}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                monthlyView === 'summary'
                  ? 'bg-primary-600 text-white'
                  : 'text-secondary-400 hover:text-white'
              }`}
            >
              Summary
            </button>
          </div>
        )}
      </motion.div>

      {/* Report Table */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="card overflow-hidden"
      >
        <AnimatePresence mode="wait">
          {reportType === 'weekly' ? (
            <motion.div
              key="weekly"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <WeeklyReportTable
                report={weeklyReport}
                weekDates={weekDates}
                loading={loading}
                showTimes={showTimes}
              />
            </motion.div>
          ) : monthlyView === 'detail' ? (
            <motion.div
              key="monthly-detail"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <MonthlyDetailTable
                report={monthlyReport}
                loading={loading}
                showTimes={showTimes}
              />
            </motion.div>
          ) : (
            <motion.div
              key="monthly-summary"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <MonthlyReportTable
                report={monthlyReport}
                loading={loading}
                onUserClick={setSelectedUserRow}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* User Daily Details Modal */}
      <AnimatePresence>
        {selectedUserRow && (
          <UserDailyDetailsModal
            user={selectedUserRow.user}
            dailyDetails={selectedUserRow.dailyDetails}
            month={getMonthPeriodLabel()}
            onClose={() => setSelectedUserRow(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
