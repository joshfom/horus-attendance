/**
 * App Context
 * Provides global application state and database initialization
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { initDatabase } from '../lib/database';
import { getDashboardStats, type DashboardStats } from '../lib/services/dashboard';

interface AppState {
  initialized: boolean;
  initializing: boolean;
  error: string | null;
  dashboardStats: DashboardStats | null;
}

interface AppContextValue extends AppState {
  refreshDashboard: () => Promise<void>;
  showNotification: (message: string, type: 'success' | 'error' | 'info') => void;
  notification: Notification | null;
  clearNotification: () => void;
}

interface Notification {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}

interface AppProviderProps {
  children: ReactNode;
}

export function AppProvider({ children }: AppProviderProps) {
  const [state, setState] = useState<AppState>({
    initialized: false,
    initializing: true,
    error: null,
    dashboardStats: null,
  });

  const [notification, setNotification] = useState<Notification | null>(null);

  // Initialize database on mount
  useEffect(() => {
    const init = async () => {
      try {
        await initDatabase();
        const stats = await getDashboardStats();
        setState({
          initialized: true,
          initializing: false,
          error: null,
          dashboardStats: stats,
        });
      } catch (error) {
        console.error('Failed to initialize app:', error);
        setState({
          initialized: false,
          initializing: false,
          error: error instanceof Error ? error.message : 'Failed to initialize application',
          dashboardStats: null,
        });
      }
    };
    init();
  }, []);

  // Refresh dashboard stats
  const refreshDashboard = useCallback(async () => {
    try {
      const stats = await getDashboardStats();
      setState(prev => ({ ...prev, dashboardStats: stats }));
    } catch (error) {
      console.error('Failed to refresh dashboard:', error);
    }
  }, []);

  // Show notification
  const showNotification = useCallback((message: string, type: 'success' | 'error' | 'info') => {
    const id = crypto.randomUUID();
    setNotification({ id, message, type });
    
    // Auto-clear after 5 seconds
    setTimeout(() => {
      setNotification(prev => prev?.id === id ? null : prev);
    }, 5000);
  }, []);

  // Clear notification
  const clearNotification = useCallback(() => {
    setNotification(null);
  }, []);

  const value: AppContextValue = {
    ...state,
    refreshDashboard,
    showNotification,
    notification,
    clearNotification,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}
