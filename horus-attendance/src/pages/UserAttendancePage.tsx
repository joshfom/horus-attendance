import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import type { User, DailySummary, AttendanceStatus } from '../types/models';
import { userRepository } from '../lib/repositories/user.repository';
import { attendanceSummaryRepository } from '../lib/repositories/attendance-summary.repository';
import { useApp } from '../contexts';

// Helper function to format date to YYYY-MM-DD
function formatDateString(date: Date): string {
  return date.toISOString().split('T')[0] as string;
}

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.03 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2 } },
};

// View mode type
type ViewMode = 'week' | 'month' | 'custom';

// Day names
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Status Badge Component
function StatusBadge({ status }: { status: AttendanceStatus }) {
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
    present: 'Present',
    absent: 'Absent',
    late: 'Late',
    early_leave: 'Early Leave',
    incomplete: 'Incomplete',
    holiday: 'Holiday',
    weekend: 'Weekend',
  };
  
  return (
    <span className={`px-2 py-1 text-xs font-medium rounded border ${colors[status]}`}>
      {labels[status]}
    </span>
  );
}

// Summary Stats Component
function SummaryStats({ summaries }: { summaries: DailySummary[] }) {
  const stats = summaries.reduce(
    (acc, s) => {
      if (s.status === 'present' || s.status === 'late' || s.status === 'early_leave') {
        acc.present++;
      } else if (s.status === 'absent') {
        acc.absent++;
      }
      acc.lateMinutes += s.lateMinutes;
      acc.earlyMinutes += s.earlyMinutes;
      if (s.isIncomplete) acc.incomplete++;
      return acc;
    },
    { present: 0, absent: 0, lateMinutes: 0, earlyMinutes: 0, incomplete: 0 }
  );

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <div className="bg-secondary-700/50 rounded-lg p-4">
        <p className="text-secondary-400 text-sm">Days Present</p>
        <p className="text-2xl font-bold text-success-500">{stats.present}</p>
      </div>
      <div className="bg-secondary-700/50 rounded-lg p-4">
        <p className="text-secondary-400 text-sm">Days Absent</p>
        <p className="text-2xl font-bold text-danger-500">{stats.absent}</p>
      </div>
      <div className="bg-secondary-700/50 rounded-lg p-4">
        <p className="text-secondary-400 text-sm">Late Minutes</p>
        <p className="text-2xl font-bold text-warning-500">{stats.lateMinutes}</p>
      </div>
      <div className="bg-secondary-700/50 rounded-lg p-4">
        <p className="text-secondary-400 text-sm">Early Leave</p>
        <p className="text-2xl font-bold text-orange-500">{stats.earlyMinutes} min</p>
      </div>
      <div className="bg-secondary-700/50 rounded-lg p-4">
        <p className="text-secondary-400 text-sm">Incomplete</p>
        <p className="text-2xl font-bold text-secondary-400">{stats.incomplete}</p>
      </div>
    </div>
  );
}

// Day Card Component for Week View
function DayCard({ date, summary, isToday }: { date: Date; summary: DailySummary | undefined; isToday: boolean }) {
  const dayOfWeek = date.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  
  const formatTime = (time: string | null): string => {
    if (!time) return '--:--';
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(time)) return time.substring(0, 5);
    const raw = time.replace(/Z$/, '');
    const dt = new Date(raw);
    if (isNaN(dt.getTime())) return '--:--';
    const hh = dt.getHours().toString().padStart(2, '0');
    const mm = dt.getMinutes().toString().padStart(2, '0');
    return `${hh}:${mm}`;
  };

  return (
    <motion.div
      variants={cardVariants}
      className={`bg-secondary-700/30 rounded-lg p-4 border ${
        isToday ? 'border-primary-500' : 'border-secondary-700'
      } ${isWeekend ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-white font-medium">{FULL_DAY_NAMES[dayOfWeek]}</p>
          <p className="text-secondary-400 text-sm">
            {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </p>
        </div>
        {summary && <StatusBadge status={summary.status} />}
        {!summary && isWeekend && <StatusBadge status="weekend" />}
        {!summary && !isWeekend && <StatusBadge status="absent" />}
      </div>
      
      {summary ? (
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-secondary-400">Check In</span>
            <span className="text-white font-mono">{formatTime(summary.checkInTime)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-secondary-400">Check Out</span>
            <span className="text-white font-mono">{formatTime(summary.checkOutTime)}</span>
          </div>
          {summary.lateMinutes > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-warning-500">Late</span>
              <span className="text-warning-500">{summary.lateMinutes} min</span>
            </div>
          )}
          {summary.earlyMinutes > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-orange-500">Early Leave</span>
              <span className="text-orange-500">{summary.earlyMinutes} min</span>
            </div>
          )}
          {summary.isIncomplete && (
            <p className="text-xs text-secondary-400 italic">Incomplete record</p>
          )}
        </div>
      ) : (
        <div className="text-secondary-500 text-sm">
          {isWeekend ? 'Weekend' : 'No attendance data'}
        </div>
      )}
    </motion.div>
  );
}

// Main User Attendance Page Component
export function UserAttendancePage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showNotification } = useApp();
  
  // Data state
  const [user, setUser] = useState<User | null>(null);
  const [summaries, setSummaries] = useState<DailySummary[]>([]);
  const [loading, setLoading] = useState(true);
  
  // View mode state
  const [viewMode, setViewMode] = useState<ViewMode>(
    (searchParams.get('view') as ViewMode) || 'week'
  );
  
  // Date state
  const today = useMemo(() => new Date(), []);
  const [selectedDate, setSelectedDate] = useState(() => {
    const dateParam = searchParams.get('date');
    return dateParam ? new Date(dateParam) : today;
  });
  const [customStartDate, setCustomStartDate] = useState(searchParams.get('startDate') || '');
  const [customEndDate, setCustomEndDate] = useState(searchParams.get('endDate') || '');

  // Load user data
  useEffect(() => {
    const loadUser = async () => {
      if (!userId) return;
      try {
        const userData = await userRepository.getUserById(userId);
        setUser(userData);
      } catch (error) {
        console.error('Failed to load user:', error);
        showNotification('Failed to load user data', 'error');
      }
    };
    loadUser();
  }, [userId]);

  // Calculate date range based on view mode
  const getDateRange = useCallback((): { start: string; end: string } => {
    if (viewMode === 'week') {
      // Get Monday of the selected week
      const date = new Date(selectedDate);
      const day = date.getDay();
      const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
      const monday = new Date(date.setDate(diff));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      
      return {
        start: formatDateString(monday),
        end: formatDateString(sunday),
      };
    } else if (viewMode === 'month') {
      const year = selectedDate.getFullYear();
      const month = selectedDate.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      
      return {
        start: formatDateString(firstDay),
        end: formatDateString(lastDay),
      };
    } else {
      // Custom range
      return {
        start: customStartDate || formatDateString(today),
        end: customEndDate || formatDateString(today),
      };
    }
  }, [viewMode, selectedDate, customStartDate, customEndDate, today]);

  // Load attendance summaries
  const loadSummaries = useCallback(async () => {
    if (!userId) return;
    
    try {
      setLoading(true);
      const { start, end } = getDateRange();
      const data = await attendanceSummaryRepository.getSummariesForDateRange(userId, start, end);
      setSummaries(data);
      
      // Update URL params
      const params = new URLSearchParams();
      params.set('view', viewMode);
      if (viewMode === 'custom') {
        if (customStartDate) params.set('startDate', customStartDate);
        if (customEndDate) params.set('endDate', customEndDate);
      } else {
        params.set('date', formatDateString(selectedDate));
      }
      setSearchParams(params, { replace: true });
    } catch (error) {
      console.error('Failed to load summaries:', error);
      showNotification('Failed to load attendance summaries', 'error');
    } finally {
      setLoading(false);
    }
  }, [userId, viewMode, selectedDate, customStartDate, customEndDate, getDateRange, setSearchParams]);

  useEffect(() => {
    loadSummaries();
  }, [loadSummaries]);

  // Navigation handlers
  const handlePrevious = () => {
    const newDate = new Date(selectedDate);
    if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() - 7);
    } else if (viewMode === 'month') {
      newDate.setMonth(newDate.getMonth() - 1);
    }
    setSelectedDate(newDate);
  };

  const handleNext = () => {
    const newDate = new Date(selectedDate);
    if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() + 7);
    } else if (viewMode === 'month') {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    setSelectedDate(newDate);
  };

  const handleToday = () => {
    setSelectedDate(new Date());
  };

  // Generate dates for the current view
  const getDatesForView = (): Date[] => {
    const { start, end } = getDateRange();
    const dates: Date[] = [];
    const current = new Date(start);
    const endDate = new Date(end);
    
    while (current <= endDate) {
      dates.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    
    return dates;
  };

  // Get summary for a specific date
  const getSummaryForDate = (date: Date): DailySummary | undefined => {
    const dateStr = formatDateString(date);
    return summaries.find(s => s.date === dateStr);
  };

  // Check if date is today
  const isToday = (date: Date): boolean => {
    return date.toDateString() === today.toDateString();
  };

  // Format period label
  const getPeriodLabel = (): string => {
    if (viewMode === 'week') {
      const { start, end } = getDateRange();
      const startDate = new Date(start);
      const endDate = new Date(end);
      return `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } else if (viewMode === 'month') {
      return selectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    } else {
      if (customStartDate && customEndDate) {
        return `${new Date(customStartDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${new Date(customEndDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      }
      return 'Custom Range';
    }
  };

  if (!userId) {
    return (
      <div className="p-8">
        <div className="card text-center py-12">
          <p className="text-secondary-400">No user selected</p>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate('/users')}
            className="btn-primary mt-4"
          >
            Go to Users
          </motion.button>
        </div>
      </div>
    );
  }

  const dates = getDatesForView();

  return (
    <div className="p-8">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <div className="flex items-center gap-4 mb-2">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => navigate('/users')}
            className="p-2 rounded-lg bg-secondary-700 hover:bg-secondary-600 text-secondary-300 hover:text-white"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </motion.button>
          <div>
            <h1 className="text-2xl font-bold text-white">
              {user?.displayName || 'Loading...'}
            </h1>
            <p className="text-secondary-400">Attendance Details</p>
          </div>
        </div>
        {user && (
          <div className="flex items-center gap-4 text-sm text-secondary-400">
            {user.employeeCode && <span>Employee Code: {user.employeeCode}</span>}
            {user.deviceUserId && <span>Device ID: {user.deviceUserId}</span>}
          </div>
        )}
      </motion.div>

      {/* View Mode Selector */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="card mb-6"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* View Mode Tabs */}
          <div className="flex items-center gap-2">
            {(['week', 'month', 'custom'] as ViewMode[]).map((mode) => (
              <motion.button
                key={mode}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setViewMode(mode)}
                className={`px-4 py-2 rounded-lg text-sm font-medium capitalize ${
                  viewMode === mode
                    ? 'bg-primary-600 text-white'
                    : 'bg-secondary-700 hover:bg-secondary-600 text-secondary-300 hover:text-white'
                }`}
              >
                {mode}
              </motion.button>
            ))}
          </div>

          {/* Navigation Controls */}
          {viewMode !== 'custom' && (
            <div className="flex items-center gap-2">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handlePrevious}
                className="p-2 rounded-lg bg-secondary-700 hover:bg-secondary-600 text-secondary-300 hover:text-white"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </motion.button>
              
              <span className="px-4 py-2 text-white font-medium min-w-[200px] text-center">
                {getPeriodLabel()}
              </span>
              
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleNext}
                className="p-2 rounded-lg bg-secondary-700 hover:bg-secondary-600 text-secondary-300 hover:text-white"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </motion.button>
              
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleToday}
                className="btn-secondary ml-2"
              >
                Today
              </motion.button>
            </div>
          )}

          {/* Custom Date Range */}
          {viewMode === 'custom' && (
            <div className="flex items-center gap-4">
              <div>
                <label className="block text-sm text-secondary-400 mb-1">From</label>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm text-secondary-400 mb-1">To</label>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="input"
                />
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {/* Summary Stats */}
      {!loading && summaries.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="card mb-6"
        >
          <h2 className="text-lg font-semibold text-white mb-4">Summary</h2>
          <SummaryStats summaries={summaries} />
        </motion.div>
      )}

      {/* Attendance Grid */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="card"
      >
        <h2 className="text-lg font-semibold text-white mb-4">Daily Attendance</h2>
        
        <AnimatePresence mode="wait">
          {loading ? (
            <div className="py-12 text-center">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full mx-auto"
              />
            </div>
          ) : viewMode === 'week' ? (
            <motion.div
              key="week-view"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="grid grid-cols-1 md:grid-cols-7 gap-4"
            >
              {dates.map((date) => (
                <DayCard
                  key={date.toISOString()}
                  date={date}
                  summary={getSummaryForDate(date)}
                  isToday={isToday(date)}
                />
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="list-view"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="overflow-x-auto"
            >
              <table className="w-full">
                <thead>
                  <tr className="border-b border-secondary-700">
                    <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400">Date</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400">Day</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400">Check In</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400">Check Out</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400">Late</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400">Early Leave</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dates.map((date) => {
                    const summary = getSummaryForDate(date);
                    const dayOfWeek = date.getDay();
                    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                    
                    const formatTime = (time: string | null): string => {
                      if (!time) return '--:--';
                      if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(time)) return time.substring(0, 5);
                      const raw = time.replace(/Z$/, '');
                      const dt = new Date(raw);
                      if (isNaN(dt.getTime())) return '--:--';
                      const hh = dt.getHours().toString().padStart(2, '0');
                      const mm = dt.getMinutes().toString().padStart(2, '0');
                      return `${hh}:${mm}`;
                    };
                    
                    return (
                      <motion.tr
                        key={date.toISOString()}
                        variants={cardVariants}
                        className={`border-b border-secondary-700/50 ${
                          isToday(date) ? 'bg-primary-600/10' : ''
                        } ${isWeekend ? 'opacity-60' : ''}`}
                      >
                        <td className="py-3 px-4 text-white">
                          {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </td>
                        <td className="py-3 px-4 text-secondary-300">
                          {DAY_NAMES[dayOfWeek]}
                        </td>
                        <td className="py-3 px-4 text-white font-mono">
                          {summary ? formatTime(summary.checkInTime) : '--:--'}
                        </td>
                        <td className="py-3 px-4 text-white font-mono">
                          {summary ? formatTime(summary.checkOutTime) : '--:--'}
                        </td>
                        <td className="py-3 px-4">
                          {summary && summary.lateMinutes > 0 ? (
                            <span className="text-warning-500">{summary.lateMinutes} min</span>
                          ) : (
                            <span className="text-secondary-500">-</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {summary && summary.earlyMinutes > 0 ? (
                            <span className="text-orange-500">{summary.earlyMinutes} min</span>
                          ) : (
                            <span className="text-secondary-500">-</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {summary ? (
                            <StatusBadge status={summary.status} />
                          ) : isWeekend ? (
                            <StatusBadge status="weekend" />
                          ) : (
                            <StatusBadge status="absent" />
                          )}
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
