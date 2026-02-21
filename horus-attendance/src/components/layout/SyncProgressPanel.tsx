/**
 * Floating Sync Progress Panel
 * 
 * Always-mounted component that shows active sync progress
 * regardless of which page the user is on.
 * Inspired by the scratch app's UploadQueue pattern.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { useSync } from '../../contexts';
import { useLocation } from 'react-router-dom';

export function SyncProgressPanel() {
  const { activeSync, cancelSync } = useSync();
  const location = useLocation();

  // Don't show the floating panel if user is already on the sync page
  // (the sync page has its own inline progress)
  const isOnSyncPage = location.pathname === '/sync';

  if (!activeSync || isOnSyncPage) return null;

  const { progress, deviceName } = activeSync;
  const percentage = Math.round((progress.current / progress.total) * 100);
  const details = progress.details;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 50, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 50, scale: 0.95 }}
        className="fixed bottom-4 right-4 z-50 w-80 bg-secondary-800 border border-secondary-700 rounded-xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-secondary-750 border-b border-secondary-700">
          <div className="flex items-center gap-2">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
              className="w-4 h-4 border-2 border-primary-400 border-t-transparent rounded-full"
            />
            <span className="text-sm font-medium text-white">Syncing {deviceName}</span>
          </div>
          <button
            onClick={cancelSync}
            className="text-secondary-400 hover:text-danger-400 transition-colors p-1"
            title="Cancel sync"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Progress */}
        <div className="px-4 py-3 space-y-2">
          {/* Bar */}
          <div className="h-1.5 bg-secondary-700 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-primary-500"
              initial={{ width: 0 }}
              animate={{ width: `${percentage}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>

          {/* Message */}
          <p className="text-xs text-secondary-300">{progress.message}</p>

          {/* Record counts */}
          {details && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-secondary-400">
              {details.usersTotal != null && details.usersTotal > 0 && (
                <span>Users: {details.usersProcessed ?? 0}/{details.usersTotal}</span>
              )}
              {details.logsTotal != null && details.logsTotal > 0 && (
                <span>Logs: {(details.logsProcessed ?? 0).toLocaleString()}/{details.logsTotal.toLocaleString()}</span>
              )}
              {details.summariesTotal != null && details.summariesTotal > 0 && (
                <span>Summaries: {(details.summariesProcessed ?? 0).toLocaleString()}/{details.summariesTotal.toLocaleString()}</span>
              )}
              {details.totalRecordsFetched != null && details.totalRecordsFetched > 0 && (
                <span>Total fetched: {details.totalRecordsFetched.toLocaleString()}</span>
              )}
            </div>
          )}

          <div className="flex justify-between items-center text-xs">
            <span className="text-secondary-500">{percentage}%</span>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
