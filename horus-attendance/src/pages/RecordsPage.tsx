import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import type { AttendanceLog, User, Department } from '../types/models';
import type { AttendanceRecordFilter, AttendanceRecordSortField, SortDirection } from '../types/api';
import { attendanceLogRepository } from '../lib/repositories/attendance-log.repository';
import { userRepository } from '../lib/repositories/user.repository';
import { departmentRepository } from '../lib/repositories/department.repository';
import { useApp } from '../contexts';
import { useDebounce } from '../lib/hooks/useDebounce';

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

// Pagination constants
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

// Verify type labels
const VERIFY_TYPE_LABELS: Record<number, string> = {
  0: 'Password',
  1: 'Fingerprint',
  2: 'Card',
  15: 'Face',
};

// Punch type labels
const PUNCH_TYPE_LABELS: Record<number, string> = {
  0: 'Check In',
  1: 'Check Out',
  2: 'Break Out',
  3: 'Break In',
  4: 'OT In',
  5: 'OT Out',
};

// Sort Icon Component
function SortIcon({ field, currentField, direction }: { 
  field: AttendanceRecordSortField; 
  currentField: AttendanceRecordSortField; 
  direction: SortDirection;
}) {
  const isActive = field === currentField;
  return (
    <span className={`ml-1 inline-flex ${isActive ? 'text-primary-400' : 'text-secondary-500'}`}>
      {isActive && direction === 'asc' ? '↑' : isActive && direction === 'desc' ? '↓' : '↕'}
    </span>
  );
}

// Punch Type Badge Component
function PunchTypeBadge({ punchType }: { punchType: number }) {
  const colors: Record<number, string> = {
    0: 'bg-success-600/20 text-success-500 border-success-600/30',
    1: 'bg-warning-600/20 text-warning-500 border-warning-600/30',
    2: 'bg-secondary-600/20 text-secondary-400 border-secondary-600/30',
    3: 'bg-secondary-600/20 text-secondary-400 border-secondary-600/30',
    4: 'bg-primary-600/20 text-primary-400 border-primary-600/30',
    5: 'bg-primary-600/20 text-primary-400 border-primary-600/30',
  };
  const label = PUNCH_TYPE_LABELS[punchType] || `Type ${punchType}`;
  const color = colors[punchType] || 'bg-secondary-600/20 text-secondary-400 border-secondary-600/30';
  
  return (
    <span className={`px-2 py-1 text-xs font-medium rounded border ${color}`}>
      {label}
    </span>
  );
}

// Main Records Page Component
export function RecordsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showNotification } = useApp();
  
  // Data state
  const [records, setRecords] = useState<AttendanceLog[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [userMap, setUserMap] = useState<Map<string, User>>(new Map());
  const [loading, setLoading] = useState(true);
  const [totalRecords, setTotalRecords] = useState(0);
  
  // Filter state
  const [dateFrom, setDateFrom] = useState(searchParams.get('dateFrom') || '');
  const [dateTo, setDateTo] = useState(searchParams.get('dateTo') || '');
  const debouncedDateFrom = useDebounce(dateFrom, 300);
  const debouncedDateTo = useDebounce(dateTo, 300);
  const [selectedUserId, setSelectedUserId] = useState(searchParams.get('userId') || '');
  const [selectedDepartmentId, setSelectedDepartmentId] = useState(searchParams.get('departmentId') || '');
  const [selectedPunchType, setSelectedPunchType] = useState(searchParams.get('punchType') || '');
  
  // Sort state
  const [sortField, setSortField] = useState<AttendanceRecordSortField>(
    (searchParams.get('sortField') as AttendanceRecordSortField) || 'timestamp'
  );
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    (searchParams.get('sortDirection') as SortDirection) || 'desc'
  );
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(parseInt(searchParams.get('page') || '1', 10));
  const [pageSize, setPageSize] = useState(parseInt(searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10));

  // Load users and departments for filters
  useEffect(() => {
    const loadFilterData = async () => {
      try {
        const [userList, deptList] = await Promise.all([
          userRepository.listUsers({ status: 'all' }),
          departmentRepository.listDepartments(),
        ]);
        setUsers(userList);
        setDepartments(deptList);
        
        // Create user map for quick lookup by deviceUserId AND by name
        const map = new Map<string, User>();
        userList.forEach(user => {
          if (user.deviceUserId) {
            map.set(user.deviceUserId, user);
          }
          // Also map by device name and display name (case-insensitive) for name-based matching
          if (user.deviceName) {
            map.set(user.deviceName.toLowerCase(), user);
          }
          if (user.displayName) {
            map.set(user.displayName.toLowerCase(), user);
          }
        });
        setUserMap(map);
      } catch (error) {
        console.error('Failed to load filter data:', error);
        showNotification('Failed to load filter data', 'error');
      }
    };
    loadFilterData();
  }, []);

  // Load records
  const loadRecords = useCallback(async () => {
    try {
      setLoading(true);
      
      const filter: AttendanceRecordFilter = {};
      if (debouncedDateFrom) filter.dateFrom = `${debouncedDateFrom}T00:00:00`;
      if (debouncedDateTo) filter.dateTo = `${debouncedDateTo}T23:59:59`;
      if (selectedUserId) filter.userId = selectedUserId;
      if (selectedDepartmentId) filter.departmentId = selectedDepartmentId;
      if (selectedPunchType !== '') filter.punchType = parseInt(selectedPunchType, 10);
      
      const allRecords = await attendanceLogRepository.listLogs(
        filter,
        { field: sortField, direction: sortDirection }
      );
      
      setTotalRecords(allRecords.length);
      
      // Client-side pagination
      const startIndex = (currentPage - 1) * pageSize;
      const paginatedRecords = allRecords.slice(startIndex, startIndex + pageSize);
      setRecords(paginatedRecords);
      
      // Update URL params
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (selectedUserId) params.set('userId', selectedUserId);
      if (selectedDepartmentId) params.set('departmentId', selectedDepartmentId);
      if (selectedPunchType !== '') params.set('punchType', selectedPunchType);
      params.set('sortField', sortField);
      params.set('sortDirection', sortDirection);
      params.set('page', String(currentPage));
      params.set('pageSize', String(pageSize));
      setSearchParams(params, { replace: true });
      
    } catch (error) {
      console.error('Failed to load records:', error);
      showNotification('Failed to load records', 'error');
    } finally {
      setLoading(false);
    }
  }, [debouncedDateFrom, debouncedDateTo, selectedUserId, selectedDepartmentId, selectedPunchType, sortField, sortDirection, currentPage, pageSize, setSearchParams]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  // Handle sort change
  const handleSort = (field: AttendanceRecordSortField) => {
    if (field === sortField) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
    setCurrentPage(1);
  };

  // Handle filter reset
  const handleResetFilters = () => {
    setDateFrom('');
    setDateTo('');
    setSelectedUserId('');
    setSelectedDepartmentId('');
    setSelectedPunchType('');
    setCurrentPage(1);
  };

  // Export records to CSV
  const handleExportCSV = async () => {
    try {
      // Get all records with current filters (no pagination)
      const filter: AttendanceRecordFilter = {};
      if (dateFrom) filter.dateFrom = `${dateFrom}T00:00:00`;
      if (dateTo) filter.dateTo = `${dateTo}T23:59:59`;
      if (selectedUserId) filter.userId = selectedUserId;
      if (selectedDepartmentId) filter.departmentId = selectedDepartmentId;
      if (selectedPunchType !== '') filter.punchType = parseInt(selectedPunchType, 10);
      
      const allRecords = await attendanceLogRepository.listLogs(
        filter,
        { field: sortField, direction: sortDirection }
      );
      
      if (allRecords.length === 0) {
        showNotification('No records to export', 'info');
        return;
      }
      
      // Build CSV content
      const headers = ['Date', 'Time', 'User', 'Device User ID', 'Department', 'Verify Type', 'Punch Type'];
      const rows = allRecords.map(record => {
        const dt = new Date(record.timestamp);
        const user = resolveUser(record.deviceUserId);
        return [
          dt.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }),
          dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
          user?.displayName || record.deviceUserId,
          record.deviceUserId,
          user?.departmentId ? departments.find(d => d.id === user.departmentId)?.name || '-' : '-',
          VERIFY_TYPE_LABELS[record.verifyType] || `Type ${record.verifyType}`,
          PUNCH_TYPE_LABELS[record.punchType] || `Type ${record.punchType}`,
        ];
      });
      
      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n');
      
      // Save via native dialog
      const dateStr = dateFrom && dateTo ? `${dateFrom}_to_${dateTo}` : new Date().toISOString().split('T')[0];
      const filePath = await save({
        title: 'Export Records',
        defaultPath: `attendance-records-${dateStr}.csv`,
        filters: [{ name: 'CSV Files', extensions: ['csv'] }],
      });
      
      if (!filePath) return; // User cancelled
      
      await invoke('write_text_file', { path: filePath, content: csvContent });
      
      showNotification(`Exported ${allRecords.length} records`, 'success');
    } catch (error) {
      console.error('Export failed:', error);
      showNotification('Failed to export records', 'error');
    }
  };

  // Handle page change
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  // Handle page size change
  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  // Resolve a deviceUserId to a user (tries exact match, then name match)
  const resolveUser = (deviceUserId: string): User | undefined => {
    return userMap.get(deviceUserId) || userMap.get(deviceUserId.toLowerCase());
  };

  // Navigate to user detail
  const handleUserClick = (deviceUserId: string) => {
    const user = resolveUser(deviceUserId);
    if (user) {
      navigate(`/users/${user.id}/attendance`);
    }
  };

  // Get user display name from deviceUserId
  const getUserDisplayName = (deviceUserId: string): string => {
    const user = resolveUser(deviceUserId);
    return user?.displayName || deviceUserId;
  };

  // Get department name for a user
  const getDepartmentName = (deviceUserId: string): string => {
    const user = resolveUser(deviceUserId);
    if (!user?.departmentId) return '-';
    const dept = departments.find(d => d.id === user.departmentId);
    return dept?.name || '-';
  };

  // Format timestamp for display
  const formatTimestamp = (timestamp: string): { date: string; time: string } => {
    const dt = new Date(timestamp);
    return {
      date: dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
      time: dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
  };

  // Calculate pagination
  const totalPages = Math.ceil(totalRecords / pageSize);
  const startRecord = (currentPage - 1) * pageSize + 1;
  const endRecord = Math.min(currentPage * pageSize, totalRecords);

  // Generate page numbers for pagination
  const getPageNumbers = (): (number | string)[] => {
    const pages: (number | string)[] = [];
    const maxVisible = 5;
    
    if (totalPages <= maxVisible + 2) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('...');
      
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      
      for (let i = start; i <= end; i++) pages.push(i);
      
      if (currentPage < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    
    return pages;
  };

  return (
    <div className="p-8">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-2xl font-bold text-white">Attendance Records</h1>
        <p className="text-secondary-400 mt-1">View and filter all punch records from devices</p>
      </motion.div>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="card mb-6"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 items-end">
          {/* Date From */}
          <div className="flex flex-col">
            <label className="block text-sm font-medium text-secondary-300 mb-1">From Date</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setCurrentPage(1); }}
              className="input w-full h-10"
            />
          </div>

          {/* Date To */}
          <div className="flex flex-col">
            <label className="block text-sm font-medium text-secondary-300 mb-1">To Date</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setCurrentPage(1); }}
              className="input w-full h-10"
            />
          </div>

          {/* User Filter */}
          <div className="flex flex-col">
            <label className="block text-sm font-medium text-secondary-300 mb-1">User</label>
            <select
              value={selectedUserId}
              onChange={(e) => { setSelectedUserId(e.target.value); setCurrentPage(1); }}
              className="input w-full h-10"
            >
              <option value="">All Users</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>{user.displayName}</option>
              ))}
            </select>
          </div>

          {/* Department Filter */}
          <div className="flex flex-col">
            <label className="block text-sm font-medium text-secondary-300 mb-1">Department</label>
            <select
              value={selectedDepartmentId}
              onChange={(e) => { setSelectedDepartmentId(e.target.value); setCurrentPage(1); }}
              className="input w-full h-10"
            >
              <option value="">All Departments</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>{dept.name}</option>
              ))}
            </select>
          </div>

          {/* Punch Type Filter */}
          <div className="flex flex-col">
            <label className="block text-sm font-medium text-secondary-300 mb-1">Punch Type</label>
            <select
              value={selectedPunchType}
              onChange={(e) => { setSelectedPunchType(e.target.value); setCurrentPage(1); }}
              className="input w-full h-10"
            >
              <option value="">All Types</option>
              {Object.entries(PUNCH_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Reset Button */}
          <div className="flex flex-col">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleResetFilters}
              className="btn-secondary w-full h-10"
            >
              Reset Filters
            </motion.button>
          </div>
        </div>
        
        {/* Export Button Row */}
        <div className="mt-4 pt-4 border-t border-secondary-700 flex justify-end">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleExportCSV}
            disabled={totalRecords === 0}
            className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export to CSV ({totalRecords} records)
          </motion.button>
        </div>
      </motion.div>

      {/* Records Table */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="card overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-secondary-700">
                <th 
                  className="text-left py-3 px-4 text-sm font-medium text-secondary-400 cursor-pointer hover:text-white"
                  onClick={() => handleSort('timestamp')}
                >
                  Timestamp
                  <SortIcon field="timestamp" currentField={sortField} direction={sortDirection} />
                </th>
                <th 
                  className="text-left py-3 px-4 text-sm font-medium text-secondary-400 cursor-pointer hover:text-white"
                  onClick={() => handleSort('user')}
                >
                  User
                  <SortIcon field="user" currentField={sortField} direction={sortDirection} />
                </th>
                <th 
                  className="text-left py-3 px-4 text-sm font-medium text-secondary-400 cursor-pointer hover:text-white"
                  onClick={() => handleSort('department')}
                >
                  Department
                  <SortIcon field="department" currentField={sortField} direction={sortDirection} />
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400">Verify Type</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400">Punch Type</th>
              </tr>
            </thead>
            <AnimatePresence mode="wait">
              {loading ? (
                <tbody>
                  <tr>
                    <td colSpan={5} className="py-12 text-center">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                        className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full mx-auto"
                      />
                    </td>
                  </tr>
                </tbody>
              ) : records.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-secondary-400">
                      No records found matching your filters
                    </td>
                  </tr>
                </tbody>
              ) : (
                <motion.tbody
                  key="records"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                >
                  {records.map((record) => {
                    const { date, time } = formatTimestamp(record.timestamp);
                    return (
                      <motion.tr
                        key={record.id}
                        variants={rowVariants}
                        className="border-b border-secondary-700/50 hover:bg-secondary-700/30"
                      >
                        <td className="py-3 px-4">
                          <div>
                            <p className="text-white font-medium">{date}</p>
                            <p className="text-secondary-400 text-sm">{time}</p>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <button
                            onClick={() => handleUserClick(record.deviceUserId)}
                            className="text-primary-400 hover:text-primary-300 hover:underline text-left"
                          >
                            {getUserDisplayName(record.deviceUserId)}
                          </button>
                        </td>
                        <td className="py-3 px-4 text-secondary-300">
                          {getDepartmentName(record.deviceUserId)}
                        </td>
                        <td className="py-3 px-4 text-secondary-300">
                          {VERIFY_TYPE_LABELS[record.verifyType] || `Type ${record.verifyType}`}
                        </td>
                        <td className="py-3 px-4">
                          <PunchTypeBadge punchType={record.punchType} />
                        </td>
                      </motion.tr>
                    );
                  })}
                </motion.tbody>
              )}
            </AnimatePresence>
          </table>
        </div>

        {/* Pagination */}
        {totalRecords > 0 && (
          <div className="px-4 py-3 border-t border-secondary-700 bg-secondary-800/50 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <p className="text-sm text-secondary-400">
                Showing {startRecord} to {endRecord} of {totalRecords} records
              </p>
              <div className="flex items-center gap-2">
                <label className="text-sm text-secondary-400">Per page:</label>
                <select
                  value={pageSize}
                  onChange={(e) => handlePageSizeChange(parseInt(e.target.value, 10))}
                  className="input py-1 px-2 text-sm"
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
              </div>
            </div>
            
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="p-2 rounded-lg bg-secondary-700 hover:bg-secondary-600 text-secondary-300 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </motion.button>
                
                {getPageNumbers().map((page, index) => (
                  typeof page === 'number' ? (
                    <motion.button
                      key={index}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => handlePageChange(page)}
                      className={`px-3 py-1 rounded-lg text-sm font-medium ${
                        page === currentPage
                          ? 'bg-primary-600 text-white'
                          : 'bg-secondary-700 hover:bg-secondary-600 text-secondary-300 hover:text-white'
                      }`}
                    >
                      {page}
                    </motion.button>
                  ) : (
                    <span key={index} className="px-2 text-secondary-500">...</span>
                  )
                ))}
                
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="p-2 rounded-lg bg-secondary-700 hover:bg-secondary-600 text-secondary-300 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </motion.button>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
