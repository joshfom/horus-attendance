import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback } from 'react';
import type { Department, User } from '../types/models';
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

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2 } },
};

const modalVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, scale: 0.95, transition: { duration: 0.15 } },
};

// Department Form Modal Component
interface DepartmentModalProps {
  department: Department | null;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}

function DepartmentModal({ department, onSave, onClose }: DepartmentModalProps) {
  const [name, setName] = useState(department?.name || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Department name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save department');
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
        className="relative bg-secondary-800 rounded-xl p-6 w-full max-w-md"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white">
            {department ? 'Edit Department' : 'Create Department'}
          </h2>
          <button onClick={onClose} className="text-secondary-400 hover:text-white">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-secondary-300 mb-1">
              Department Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Engineering, Sales, HR"
              className={`input w-full ${error ? 'border-danger-500' : ''}`}
              autoFocus
            />
            {error && <p className="text-danger-500 text-sm mt-1">{error}</p>}
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
              {department ? 'Update' : 'Create'}
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

// Delete Confirmation Modal
interface DeleteModalProps {
  department: Department;
  members: User[];
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

function DeleteModal({ department, members, onConfirm, onClose }: DeleteModalProps) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onConfirm();
      onClose();
    } catch (error) {
      console.error('Failed to delete department:', error);
      onClose();
    } finally {
      setDeleting(false);
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
        className="relative bg-secondary-800 rounded-xl p-6 w-full max-w-md"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 rounded-full bg-danger-600/20">
            <svg className="w-6 h-6 text-danger-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-white">Delete Department</h2>
        </div>

        <p className="text-secondary-300 mb-4">
          Are you sure you want to delete <span className="font-medium text-white">{department.name}</span>?
        </p>

        {members.length > 0 && (
          <div className="mb-4 p-3 bg-warning-600/10 border border-warning-600/30 rounded-lg">
            <p className="text-warning-500 text-sm">
              <span className="font-medium">{members.length} user{members.length !== 1 ? 's' : ''}</span> will be unassigned from this department.
            </p>
            <ul className="mt-2 text-sm text-warning-400 max-h-32 overflow-y-auto">
              {members.slice(0, 5).map((user) => (
                <li key={user.id}>• {user.displayName}</li>
              ))}
              {members.length > 5 && (
                <li className="text-secondary-400">...and {members.length - 5} more</li>
              )}
            </ul>
          </div>
        )}

        <div className="flex gap-3">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleDelete}
            disabled={deleting}
            className="flex-1 bg-danger-600 hover:bg-danger-700 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {deleting ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
              />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            )}
            Delete
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onClose}
            className="btn-secondary"
          >
            Cancel
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}

// Department Card Component
interface DepartmentCardProps {
  department: Department;
  onEdit: () => void;
  onDelete: () => void;
}

function DepartmentCard({ department, onEdit, onDelete }: DepartmentCardProps) {
  return (
    <motion.div
      variants={cardVariants}
      whileHover={{ scale: 1.01 }}
      className="card border border-secondary-700/50"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-white">{department.name}</h3>
          <p className="text-secondary-400 mt-1">
            {department.memberCount ?? 0} member{(department.memberCount ?? 0) !== 1 ? 's' : ''}
          </p>
          <p className="text-secondary-500 text-sm mt-2">
            Created {new Date(department.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex gap-2">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={onEdit}
            className="p-2 rounded-lg bg-secondary-700 hover:bg-secondary-600 text-secondary-300 hover:text-white"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={onDelete}
            className="p-2 rounded-lg bg-danger-600/20 hover:bg-danger-600/30 text-danger-500"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

// Main Departments Page Component
export function DepartmentsPage() {
  const { showNotification } = useApp();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const [deletingDepartment, setDeletingDepartment] = useState<Department | null>(null);
  const [deletingMembers, setDeletingMembers] = useState<User[]>([]);

  const loadDepartments = useCallback(async () => {
    try {
      setLoading(true);
      const deptList = await departmentRepository.listDepartments();
      setDepartments(deptList);
    } catch (error) {
      console.error('Failed to load departments:', error);
      showNotification('Failed to load departments', 'error');
    } finally {
      setLoading(false);
    }
  }, [showNotification]);

  useEffect(() => {
    loadDepartments();
  }, [loadDepartments]);

  const handleCreate = async (name: string) => {
    await departmentRepository.createDepartment({ name });
    await loadDepartments();
    showNotification('Department created successfully', 'success');
  };

  const handleUpdate = async (name: string) => {
    if (!editingDepartment) return;
    await departmentRepository.updateDepartment(editingDepartment.id, { name });
    await loadDepartments();
    showNotification('Department updated successfully', 'success');
  };

  const handleDelete = async () => {
    if (!deletingDepartment) return;
    try {
      await departmentRepository.deleteDepartment(deletingDepartment.id);
      await loadDepartments();
      showNotification('Department deleted successfully', 'success');
    } catch (error) {
      console.error('Failed to delete department:', error);
      showNotification('Failed to delete department', 'error');
    }
  };

  const openDeleteModal = async (department: Department) => {
    try {
      const members = await departmentRepository.getDepartmentMembers(department.id);
      setDeletingMembers(members);
      setDeletingDepartment(department);
    } catch (error) {
      console.error('Failed to load department members:', error);
      showNotification('Failed to load department members', 'error');
    }
  };

  const totalMembers = departments.reduce((sum, d) => sum + (d.memberCount ?? 0), 0);

  if (loading && departments.length === 0) {
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
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-6"
      >
        <div>
          <h1 className="text-2xl font-bold text-white">Departments</h1>
          <p className="text-secondary-400 mt-1">
            {departments.length} department{departments.length !== 1 ? 's' : ''} • {totalMembers} total member{totalMembers !== 1 ? 's' : ''}
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setShowCreateModal(true)}
          className="btn-primary flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Department
        </motion.button>
      </motion.div>

      {/* Department Grid */}
      {departments.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card text-center py-12"
        >
          <svg className="w-16 h-16 mx-auto text-secondary-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
          <h3 className="text-lg font-medium text-white mb-2">No departments yet</h3>
          <p className="text-secondary-400 mb-4">Create your first department to organize users</p>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowCreateModal(true)}
            className="btn-primary"
          >
            Create Department
          </motion.button>
        </motion.div>
      ) : (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {departments.map((department) => (
            <DepartmentCard
              key={department.id}
              department={department}
              onEdit={() => setEditingDepartment(department)}
              onDelete={() => openDeleteModal(department)}
            />
          ))}
        </motion.div>
      )}

      {/* Create Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <DepartmentModal
            department={null}
            onSave={handleCreate}
            onClose={() => setShowCreateModal(false)}
          />
        )}
      </AnimatePresence>

      {/* Edit Modal */}
      <AnimatePresence>
        {editingDepartment && (
          <DepartmentModal
            department={editingDepartment}
            onSave={handleUpdate}
            onClose={() => setEditingDepartment(null)}
          />
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deletingDepartment && (
          <DeleteModal
            department={deletingDepartment}
            members={deletingMembers}
            onConfirm={handleDelete}
            onClose={() => {
              setDeletingDepartment(null);
              setDeletingMembers([]);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
