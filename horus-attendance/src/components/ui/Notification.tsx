/**
 * Notification Component
 * Displays toast notifications for user feedback
 */

import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '../../contexts';

const notificationVariants = {
  hidden: { opacity: 0, y: -20, scale: 0.95 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, y: -20, scale: 0.95, transition: { duration: 0.15 } },
};

export function Notification() {
  const { notification, clearNotification } = useApp();

  const colors = {
    success: 'bg-success-600/90 border-success-500',
    error: 'bg-danger-600/90 border-danger-500',
    info: 'bg-primary-600/90 border-primary-500',
  };

  const icons = {
    success: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    error: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    info: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  };

  return (
    <div className="fixed top-4 right-4 z-50">
      <AnimatePresence>
        {notification && (
          <motion.div
            key={notification.id}
            variants={notificationVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-white shadow-lg ${colors[notification.type]}`}
          >
            {icons[notification.type]}
            <span className="font-medium">{notification.message}</span>
            <button
              onClick={clearNotification}
              className="ml-2 p-1 rounded hover:bg-white/20 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
