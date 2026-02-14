import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts';

// Animation variants for staggered card animations
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.3,
    },
  },
};

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color: 'primary' | 'success' | 'warning' | 'danger';
  onClick?: () => void;
}

function StatCard({ title, value, subtitle, icon, color, onClick }: StatCardProps) {
  const colorClasses = {
    primary: 'bg-primary-600/20 text-primary-400 border-primary-600/30',
    success: 'bg-success-600/20 text-success-500 border-success-600/30',
    warning: 'bg-warning-600/20 text-warning-500 border-warning-600/30',
    danger: 'bg-danger-600/20 text-danger-500 border-danger-600/30',
  };

  const tapAnimation = onClick ? { scale: 0.98 } : {};

  return (
    <motion.div
      variants={cardVariants}
      whileHover={{ scale: 1.02 }}
      whileTap={tapAnimation}
      onClick={onClick}
      className={`card border ${colorClasses[color]} ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-secondary-400 text-sm font-medium">{title}</p>
          <p className="text-3xl font-bold text-white mt-2">{value}</p>
          {subtitle && (
            <p className="text-secondary-500 text-sm mt-1">{subtitle}</p>
          )}
        </div>
        <div className={`p-3 rounded-lg ${colorClasses[color]}`}>
          {icon}
        </div>
      </div>
    </motion.div>
  );
}

interface QuickActionProps {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}

function QuickAction({ label, icon, onClick, variant = 'secondary' }: QuickActionProps) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${
        variant === 'primary'
          ? 'bg-primary-600 hover:bg-primary-700 text-white'
          : 'bg-secondary-700 hover:bg-secondary-600 text-secondary-200'
      }`}
    >
      {icon}
      <span>{label}</span>
    </motion.button>
  );
}

function formatLastSync(lastSyncAt: string | null): string {
  if (!lastSyncAt) return 'Never';
  
  const syncDate = new Date(lastSyncAt);
  const now = new Date();
  const diffMs = now.getTime() - syncDate.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  
  return syncDate.toLocaleDateString();
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { dashboardStats: stats, refreshDashboard } = useApp();

  // Refresh dashboard on mount
  React.useEffect(() => {
    refreshDashboard();
  }, [refreshDashboard]);

  if (!stats) {
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
        className="mb-8"
      >
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-secondary-400 mt-1">Welcome to Horus Attendance</p>
      </motion.div>

      {/* Stat Cards */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8"
      >
        <StatCard
          title="Last Sync"
          value={formatLastSync(stats?.lastSyncAt ?? null)}
          subtitle={stats?.lastSyncAt ? new Date(stats.lastSyncAt).toLocaleString() : 'No sync yet'}
          color="primary"
          onClick={() => navigate('/sync')}
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          }
        />

        <StatCard
          title="Total Users"
          value={stats?.totalActiveUsers ?? 0}
          subtitle="Active employees"
          color="success"
          onClick={() => navigate('/users')}
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          }
        />

        <StatCard
          title="Checked In"
          value={stats?.todayStats.checkedIn ?? 0}
          subtitle={`${stats?.todayStats.notCheckedIn ?? 0} not checked in`}
          color="success"
          onClick={() => navigate('/records')}
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />

        <StatCard
          title="Late Today"
          value={stats?.todayStats.late ?? 0}
          subtitle={stats?.todayStats.incomplete ? `${stats.todayStats.incomplete} incomplete` : 'All complete'}
          color={stats?.todayStats.late ? 'warning' : 'success'}
          onClick={() => navigate('/records')}
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </motion.div>

      {/* Quick Actions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-4">
          <QuickAction
            label="Sync Now"
            variant="primary"
            onClick={() => navigate('/sync')}
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            }
          />
          <QuickAction
            label="Weekly Report"
            onClick={() => navigate('/reports')}
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            }
          />
          <QuickAction
            label="View Records"
            onClick={() => navigate('/records')}
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
            }
          />
          <QuickAction
            label="Manage Users"
            onClick={() => navigate('/users')}
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            }
          />
        </div>
      </motion.div>

      {/* Today's Summary */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="mt-8"
      >
        <h2 className="text-lg font-semibold text-white mb-4">Today's Summary</h2>
        <div className="card">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-success-500">{stats?.todayStats.checkedIn ?? 0}</p>
              <p className="text-secondary-400 text-sm mt-1">Checked In</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-secondary-400">{stats?.todayStats.notCheckedIn ?? 0}</p>
              <p className="text-secondary-400 text-sm mt-1">Not Checked In</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-warning-500">{stats?.todayStats.late ?? 0}</p>
              <p className="text-secondary-400 text-sm mt-1">Late</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-primary-400">{stats?.todayStats.onLeave ?? 0}</p>
              <p className="text-secondary-400 text-sm mt-1">On Leave</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-danger-500">{stats?.todayStats.incomplete ?? 0}</p>
              <p className="text-secondary-400 text-sm mt-1">Incomplete</p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
