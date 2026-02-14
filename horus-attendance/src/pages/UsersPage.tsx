import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { User, Department, UpdateUserInput } from '../types/models';
import { userRepository } from '../lib/repositories/user.repository';
import { departmentRepository } from '../lib/repositories/department.repository';
import { useApp } from '../contexts';

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const rowVariants = {
  hidden: { opacity: 0, x: -10 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.2 } },
};

const modalVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, scale: 0.95, transition: { duration: 0.15 } },
};

// Status Badge Component
function StatusBadge({ status }: { status: 'active' | 'inactive' | 'linked' | 'unlinked' }) {
  const colors = {
    active: 'bg-success-600/20 text-success-500 border-success-600/30',
    inactive: 'bg-secondary-600/20 text-secondary-400 border-secondary-600/30',
    linked: 'bg-primary-600/20 text-primary-400 border-primary-600/30',
    unlinked: 'bg-warning-600/20 text-warning-500 border-warning-600/30',
  };
  const labels = { active: 'Active', inactive: 'Inactive', linked: 'Linked', unlinked: 'Unlinked' };
  return (
    <span className={`px-2 py-1 text-xs font-medium rounded border ${colors[status]}`}>
      {labels[status]}
    </span>
  );
}

// User Edit Modal Component
interface UserEditModalProps {
  user: User;
  departments: Department[];
  onSave: (id: string, data: UpdateUserInput) => Promise<void>;
  onClose: () => void;
}

function UserEditModal({ user, departments, onSave, onClose }: UserEditModalProps) {
  const [formData, setFormData] = useState({
    displayName: user.displayName,
    departmentId: user.departmentId || '',
    email: user.email || '',
    phone: user.phone || '',
    address: user.address || '',
    employeeCode: user.employeeCode || '',
    notes: user.notes || '',
    status: user.status,
  });
  const [saving, setSaving] = useState(false);

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(user.id, {
        displayName: formData.displayName,
        departmentId: formData.departmentId || null,
        email: formData.email || null,
        phone: formData.phone || null,
        address: formData.address || null,
        employeeCode: formData.employeeCode || null,
        notes: formData.notes || null,
        status: formData.status as 'active' | 'inactive',
      });
      onClose();
    } catch (error) {
      console.error('Failed to save user:', error);
    } finally {
      setSaving(false);
    }
  };

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
        className="relative bg-secondary-800 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white">Edit User</h2>
          <button onClick={onClose} className="text-secondary-400 hover:text-white">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {user.deviceUserId && (
          <div className="mb-4 p-3 bg-primary-600/10 border border-primary-600/30 rounded-lg">
            <p className="text-sm text-primary-400">
              <span className="font-medium">Device User ID:</span> {user.deviceUserId}
            </p>
            {user.deviceName && (
              <p className="text-sm text-primary-400 mt-1">
                <span className="font-medium">Device Name:</span> {user.deviceName}
              </p>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-secondary-300 mb-1">Display Name *</label>
            <input
              type="text"
              value={formData.displayName}
              onChange={(e) => handleChange('displayName', e.target.value)}
              required
              className="input w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-secondary-300 mb-1">Department</label>
            <select
              value={formData.departmentId}
              onChange={(e) => handleChange('departmentId', e.target.value)}
              className="input w-full"
            >
              <option value="">No Department</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>{dept.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-secondary-300 mb-1">Employee Code</label>
              <input
                type="text"
                value={formData.employeeCode}
                onChange={(e) => handleChange('employeeCode', e.target.value)}
                className="input w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-secondary-300 mb-1">Status</label>
              <select
                value={formData.status}
                onChange={(e) => handleChange('status', e.target.value)}
                className="input w-full"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-secondary-300 mb-1">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => handleChange('email', e.target.value)}
              className="input w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-secondary-300 mb-1">Phone</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => handleChange('phone', e.target.value)}
              className="input w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-secondary-300 mb-1">Address</label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => handleChange('address', e.target.value)}
              className="input w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-secondary-300 mb-1">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              rows={3}
              className="input w-full resize-none"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={saving}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              {saving ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              Save Changes
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={onClose}
              className="btn-secondary"
            >
              Cancel
            </motion.button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// Main Users Page Component
export function UsersPage() {
  const navigate = useNavigate();
  const { showNotification } = useApp();
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDepartment, setFilterDepartment] = useState('');
  const [filterStatus, setFilterStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [showUnlinkedOnly, setShowUnlinkedOnly] = useState(false);

  // Load data
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const filter: Parameters<typeof userRepository.listUsers>[0] = {
        status: filterStatus,
        linkedOnly: false,
      };
      if (searchQuery) filter.search = searchQuery;
      if (filterDepartment) filter.departmentId = filterDepartment;
      
      const [userList, deptList] = await Promise.all([
        userRepository.listUsers(filter),
        departmentRepository.listDepartments(),
      ]);
      
      // Filter unlinked users if needed
      const filteredUsers = showUnlinkedOnly
        ? userList.filter((u) => !u.deviceUserId || u.displayName === u.deviceName)
        : userList;
      
      setUsers(filteredUsers);
      setDepartments(deptList);
    } catch (error) {
      console.error('Failed to load users:', error);
      showNotification('Failed to load users', 'error');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, filterDepartment, filterStatus, showUnlinkedOnly, showNotification]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSaveUser = async (id: string, data: UpdateUserInput) => {
    try {
      await userRepository.updateUser(id, data);
      await loadData();
      showNotification('User updated successfully', 'success');
    } catch (error) {
      showNotification('Failed to update user', 'error');
      throw error;
    }
  };

  const handleBulkStatus = async (status: 'active' | 'inactive') => {
    if (selectedIds.size === 0) return;
    setBulkUpdating(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map(id => userRepository.updateUser(id, { status }))
      );
      showNotification(`${selectedIds.size} user(s) set to ${status}`, 'success');
      setSelectedIds(new Set());
      await loadData();
    } catch (error) {
      showNotification('Failed to update users', 'error');
    } finally {
      setBulkUpdating(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === users.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(users.map(u => u.id)));
    }
  };

  const getDepartmentName = (departmentId: string | null): string => {
    if (!departmentId) return '-';
    const dept = departments.find((d) => d.id === departmentId);
    return dept?.name || '-';
  };

  const unlinkedCount = users.filter((u) => !u.deviceUserId || u.displayName === u.deviceName).length;

  if (loading && users.length === 0) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="p-8">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-2xl font-bold text-white">Users</h1>
        <p className="text-secondary-400 mt-1">Manage employee profiles and device user linking</p>
      </motion.div>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="card mb-6"
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Search */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-secondary-300 mb-1">Search</label>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-secondary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name or employee code..."
                className="input w-full pl-10"
              />
            </div>
          </div>

          {/* Department Filter */}
          <div>
            <label className="block text-sm font-medium text-secondary-300 mb-1">Department</label>
            <select
              value={filterDepartment}
              onChange={(e) => setFilterDepartment(e.target.value)}
              className="input w-full"
            >
              <option value="">All Departments</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>{dept.name}</option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium text-secondary-300 mb-1">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as 'active' | 'inactive' | 'all')}
              className="input w-full"
            >
              <option value="active">Active Only</option>
              <option value="inactive">Inactive Only</option>
              <option value="all">All Users</option>
            </select>
          </div>
        </div>

        {/* Unlinked Users Toggle */}
        {unlinkedCount > 0 && (
          <div className="mt-4 pt-4 border-t border-secondary-700">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={showUnlinkedOnly}
                onChange={(e) => setShowUnlinkedOnly(e.target.checked)}
                className="w-4 h-4 rounded border-secondary-600 bg-secondary-700 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-secondary-300">
                Show only unlinked/unenriched users
                <span className="ml-2 px-2 py-0.5 text-xs bg-warning-600/20 text-warning-500 rounded">
                  {unlinkedCount} need attention
                </span>
              </span>
            </label>
          </div>
        )}
      </motion.div>

      {/* Bulk Action Bar */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="card mb-4 flex items-center gap-4"
          >
            <span className="text-sm text-secondary-300">{selectedIds.size} user{selectedIds.size !== 1 ? 's' : ''} selected</span>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleBulkStatus('active')}
              disabled={bulkUpdating}
              className="px-3 py-1.5 text-sm rounded-lg bg-success-600 hover:bg-success-700 text-white font-medium transition-colors"
            >
              Set Active
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleBulkStatus('inactive')}
              disabled={bulkUpdating}
              className="px-3 py-1.5 text-sm rounded-lg bg-secondary-600 hover:bg-secondary-500 text-white font-medium transition-colors"
            >
              Set Inactive
            </motion.button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-sm text-secondary-400 hover:text-white ml-auto"
            >
              Clear selection
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Users Table */}
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
                <th className="py-3 px-4 w-10">
                  <input
                    type="checkbox"
                    checked={users.length > 0 && selectedIds.size === users.length}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-secondary-600 bg-secondary-700 text-primary-600 focus:ring-primary-500"
                  />
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400">Name</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400">Device User ID</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400">Department</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400">Employee Code</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400">Status</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-secondary-400">Linked</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-secondary-400">Actions</th>
              </tr>
            </thead>
            <motion.tbody variants={containerVariants} initial="hidden" animate="visible">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-secondary-400">
                    No users found matching your filters
                  </td>
                </tr>
              ) : (
                users.map((user) => {
                  const isUnlinked = !user.deviceUserId || user.displayName === user.deviceName;
                  return (
                    <motion.tr
                      key={user.id}
                      variants={rowVariants}
                      className={`border-b border-secondary-700/50 hover:bg-secondary-700/30 ${
                        isUnlinked ? 'bg-warning-600/5' : ''
                      }`}
                    >
                      <td className="py-3 px-4">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(user.id)}
                          onChange={() => toggleSelect(user.id)}
                          className="w-4 h-4 rounded border-secondary-600 bg-secondary-700 text-primary-600 focus:ring-primary-500"
                        />
                      </td>
                      <td className="py-3 px-4">
                        <div>
                          <p className="text-white font-medium">{user.displayName}</p>
                          {user.email && (
                            <p className="text-secondary-400 text-sm">{user.email}</p>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-secondary-300 font-mono text-sm">
                        {user.deviceUserId || '-'}
                      </td>
                      <td className="py-3 px-4 text-secondary-300">
                        {getDepartmentName(user.departmentId)}
                      </td>
                      <td className="py-3 px-4 text-secondary-300">
                        {user.employeeCode || '-'}
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={user.status} />
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={isUnlinked ? 'unlinked' : 'linked'} />
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => navigate(`/users/${user.id}/attendance`)}
                            className="p-2 rounded-lg bg-secondary-700 hover:bg-secondary-600 text-secondary-300 hover:text-white"
                            title="View Attendance"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </motion.button>
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => setEditingUser(user)}
                            className="p-2 rounded-lg bg-secondary-700 hover:bg-secondary-600 text-secondary-300 hover:text-white"
                            title="Edit User"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </motion.button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </motion.tbody>
          </table>
        </div>

        {/* Summary */}
        <div className="px-4 py-3 border-t border-secondary-700 bg-secondary-800/50">
          <p className="text-sm text-secondary-400">
            Showing {users.length} user{users.length !== 1 ? 's' : ''}
            {unlinkedCount > 0 && !showUnlinkedOnly && (
              <span className="ml-2">
                • <span className="text-warning-500">{unlinkedCount} need profile enrichment</span>
              </span>
            )}
          </p>
        </div>
      </motion.div>

      {/* Edit Modal */}
      <AnimatePresence>
        {editingUser && (
          <UserEditModal
            user={editingUser}
            departments={departments}
            onSave={handleSaveUser}
            onClose={() => setEditingUser(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
