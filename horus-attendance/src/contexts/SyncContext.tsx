/**
 * Sync Context
 * 
 * Global sync state that survives page navigation.
 * Inspired by the scratch app's (tauri-drive) global Svelte stores pattern.
 * 
 * Key features:
 * - Sync progress persists when user navigates away from SyncPage and back
 * - Active sync indicator visible in sidebar
 * - Cancel support via AbortController
 * - Rich progress with actual record counts (not just percentages)
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import type { SyncOptions, SyncResult, SyncProgress } from '../types/services';
import { getSyncEngine } from '../lib/services/sync-engine';
import { useApp } from './AppContext';

// ============================================================================
// Types
// ============================================================================

export interface ActiveSync {
  deviceId: string;
  deviceName: string;
  progress: SyncProgress;
  startedAt: string;
}

interface SyncContextValue {
  /** Currently active sync (null if idle) */
  activeSync: ActiveSync | null;
  /** Last completed sync result */
  lastResult: SyncResult | null;
  /** Whether any sync is in progress */
  isSyncing: boolean;
  /** Start a sync for a device */
  startSync: (
    deviceId: string,
    deviceName: string,
    options: SyncOptions
  ) => Promise<SyncResult>;
  /** Cancel the current sync */
  cancelSync: () => void;
  /** Clear the last result (e.g. when user dismisses it) */
  clearResult: () => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

// ============================================================================
// Hook
// ============================================================================

export function useSync(): SyncContextValue {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error('useSync must be used within a SyncProvider');
  }
  return context;
}

// ============================================================================
// Provider
// ============================================================================

export function SyncProvider({ children }: { children: ReactNode }) {
  const [activeSync, setActiveSync] = useState<ActiveSync | null>(null);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { refreshDashboard, showNotification } = useApp();

  const isSyncing = activeSync !== null;

  const startSync = useCallback(
    async (
      deviceId: string,
      deviceName: string,
      options: SyncOptions
    ): Promise<SyncResult> => {
      // Prevent double-sync
      if (abortRef.current) {
        throw new Error('A sync is already in progress. Cancel it first or wait for it to finish.');
      }

      const controller = new AbortController();
      abortRef.current = controller;
      const startedAt = new Date().toISOString();

      setLastResult(null);
      setActiveSync({
        deviceId,
        deviceName,
        progress: {
          phase: 'connecting',
          current: 0,
          total: 100,
          message: 'Starting sync...',
          details: { startedAt },
        },
        startedAt,
      });

      const syncEngine = getSyncEngine();

      try {
        const result = await syncEngine.syncDevice(
          deviceId,
          options,
          (progress) => {
            // Update global state on every progress tick
            setActiveSync((prev) =>
              prev
                ? { ...prev, progress: { ...progress, details: { ...progress.details, startedAt } } }
                : null
            );
          },
          controller.signal
        );

        setLastResult(result);
        setActiveSync(null);
        abortRef.current = null;

        // Refresh dashboard after sync
        await refreshDashboard();

        if (result.success) {
          showNotification(
            `Sync completed: ${result.logsAdded} logs added, ${result.usersAdded} users added`,
            'success'
          );
        } else {
          showNotification(
            `Sync completed with errors: ${result.errors.join(', ')}`,
            'error'
          );
        }

        return result;
      } catch (error) {
        const cancelled = controller.signal.aborted;
        const errorResult: SyncResult = {
          success: false,
          usersAdded: 0,
          usersSynced: 0,
          logsAdded: 0,
          logsDeduplicated: 0,
          errors: [cancelled ? 'Sync cancelled by user' : (error instanceof Error ? error.message : 'Sync failed')],
          syncedAt: new Date().toISOString(),
        };

        setLastResult(errorResult);
        setActiveSync(null);
        abortRef.current = null;

        if (cancelled) {
          showNotification('Sync cancelled', 'info');
        } else {
          showNotification(
            error instanceof Error ? error.message : 'Sync failed',
            'error'
          );
        }

        return errorResult;
      }
    },
    [refreshDashboard, showNotification]
  );

  const cancelSync = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      // activeSync will be cleared when the syncDevice promise settles
    }
  }, []);

  const clearResult = useCallback(() => {
    setLastResult(null);
  }, []);

  return (
    <SyncContext.Provider
      value={{
        activeSync,
        lastResult,
        isSyncing,
        startSync,
        cancelSync,
        clearResult,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
}
