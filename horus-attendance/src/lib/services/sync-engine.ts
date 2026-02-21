/**
 * Sync Engine
 * 
 * Orchestrates synchronization of users and attendance logs from ZKTeco devices.
 * Implements transaction-based sync with rollback on failure.
 * Requirements: 2.1, 2.4, 2.5, 2.6
 */

import { execute, select, yieldToUI } from '../database';
import { getDeviceCommunicationService, type DeviceError } from './device-communication';
import { getDeviceById, updateLastSyncAt } from '../repositories/device.repository';
import { createUser, listUsers } from '../repositories/user.repository';
import { insertLogs } from '../repositories/attendance-log.repository';
import { upsertSummary } from '../repositories/attendance-summary.repository';
import { processDay, DEFAULT_ATTENDANCE_RULES } from './rule-engine';
import { settingsRepository } from '../repositories/settings.repository';
import { holidayRepository } from '../repositories/holiday.repository';
import type { DeviceConfig, DeviceInfo, PunchRecord, CreateUserInput } from '../../types/models';
import type { 
  SyncOptions, 
  SyncResult, 
  SyncStatus, 
  SyncProgress,
} from '../../types/services';

/**
 * Result of connection test
 */
export interface SyncEngineConnectionTestResult {
  success: boolean;
  deviceInfo?: DeviceInfo;
  error?: DeviceError;
  latency: number;
}

/**
 * Progress callback type for tracking sync progress
 */
export type SyncProgressCallback = (progress: SyncProgress) => void;

/**
 * Internal sync state for tracking progress
 */
interface SyncState {
  deviceId: string;
  isSyncing: boolean;
  progress: SyncProgress | null;
  lastSyncAt: string | null;
}

// Track sync state per device
const syncStates: Map<string, SyncState> = new Map();

/**
 * Get or create sync state for a device
 */
function getSyncState(deviceId: string): SyncState {
  let state = syncStates.get(deviceId);
  if (!state) {
    state = {
      deviceId,
      isSyncing: false,
      progress: null,
      lastSyncAt: null,
    };
    syncStates.set(deviceId, state);
  }
  return state;
}

/**
 * Update sync progress with detailed record counts
 */
function updateProgress(
  deviceId: string, 
  phase: SyncProgress['phase'], 
  current: number, 
  total: number, 
  message: string,
  callback?: SyncProgressCallback,
  details?: SyncProgress['details']
): void {
  const state = getSyncState(deviceId);
  const progress: SyncProgress = { phase, current, total, message };
  if (details) {
    progress.details = details;
  }
  state.progress = progress;
  if (callback) {
    callback(state.progress);
  }
}

/**
 * Convert SyncOptions to a simpler format for the sidecar
 */
function toAttendanceLogSyncOptions(options: SyncOptions): {
  mode: 'all' | 'latest' | 'days' | 'range';
  days?: number;
  startDate?: string;
  endDate?: string;
} {
  switch (options.mode) {
    case 'latest':
      return { mode: 'latest' };
    case 'days':
      if (options.days !== undefined) {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - options.days);
        const startStr = startDate.toISOString().split('T')[0] as string;
        const endStr = endDate.toISOString().split('T')[0] as string;
        return {
          mode: 'range',
          startDate: startStr,
          endDate: endStr,
        };
      }
      return { mode: 'all' };
    case 'range': {
      const sd = options.startDate;
      const ed = options.endDate;
      if (sd && ed) {
        return { mode: 'range', startDate: sd, endDate: ed };
      }
      return { mode: 'all' };
    }
    default:
      return { mode: 'all' };
  }
}

/**
 * Begin a database transaction
 */
async function beginTransaction(): Promise<void> {
  await execute('BEGIN TRANSACTION');
}

/**
 * Commit a database transaction
 */
async function commitTransaction(): Promise<void> {
  await execute('COMMIT');
}

/**
 * Rollback a database transaction
 */
async function rollbackTransaction(): Promise<void> {
  await execute('ROLLBACK');
}

/**
 * Check if we're currently in a transaction
 */
async function isInTransaction(): Promise<boolean> {
  try {
    // SQLite doesn't have a direct way to check transaction state via SQL
    // We'll track this internally instead
    return false;
  } catch {
    return false;
  }
}

/**
 * Sync Engine class
 * Orchestrates device communication and database operations
 */
export class SyncEngine {
  private deviceCommunication = getDeviceCommunicationService();

  /**
   * Test connection to a ZKTeco device
   */
  async testConnection(config: DeviceConfig): Promise<SyncEngineConnectionTestResult> {
    return this.deviceCommunication.testConnection(config);
  }

  /**
   * Get device information
   */
  async getDeviceInfo(config: DeviceConfig): Promise<DeviceInfo> {
    return this.deviceCommunication.getDeviceInfo(config);
  }

  /**
   * Get sync status for a device
   */
  async getSyncStatus(deviceId: string): Promise<SyncStatus> {
    const device = await getDeviceById(deviceId);
    const state = getSyncState(deviceId);
    
    const status: SyncStatus = {
      deviceId,
      lastSyncAt: device?.lastSyncAt || state.lastSyncAt,
      isSyncing: state.isSyncing,
    };
    
    if (state.progress) {
      status.progress = state.progress;
    }
    
    return status;
  }

  /**
   * Sync users and attendance logs from a device.
   * 
   * Accepts an optional AbortSignal for cancellation support.
   * Reports rich progress with actual record counts so the UI can
   * show "Inserting log 342 / 5,000" instead of just "40%".
   */
  async syncDevice(
    deviceId: string, 
    options: SyncOptions,
    progressCallback?: SyncProgressCallback,
    abortSignal?: AbortSignal
  ): Promise<SyncResult> {
    const state = getSyncState(deviceId);
    
    // Prevent concurrent syncs for the same device
    if (state.isSyncing) {
      return {
        success: false,
        usersAdded: 0,
        usersSynced: 0,
        logsAdded: 0,
        logsDeduplicated: 0,
        errors: ['Sync already in progress for this device'],
        syncedAt: new Date().toISOString(),
      };
    }

    /** Helper: throw if user cancelled */
    const checkAbort = () => {
      if (abortSignal?.aborted) {
        throw new Error('Sync cancelled');
      }
    };

    state.isSyncing = true;
    const errors: string[] = [];
    let usersAdded = 0;
    let usersSynced = 0;
    let logsAdded = 0;
    let logsDeduplicated = 0;

    // Shared details object updated throughout the sync
    const details: NonNullable<SyncProgress['details']> = {
      startedAt: new Date().toISOString(),
      totalRecordsFetched: 0,
      usersTotal: 0,
      usersProcessed: 0,
      logsTotal: 0,
      logsProcessed: 0,
      summariesTotal: 0,
      summariesProcessed: 0,
    };

    try {
      checkAbort();

      // Get device configuration
      const device = await getDeviceById(deviceId);
      if (!device) {
        throw new Error(`Device not found: ${deviceId}`);
      }

      const config: DeviceConfig = {
        id: device.id,
        name: device.name,
        ip: device.ip,
        port: device.port,
        commKey: device.commKey,
        timezone: device.timezone,
        syncMode: device.syncMode,
      };

      // ── Phase 1: Connect & fetch ──────────────────────────────────────
      updateProgress(deviceId, 'connecting', 0, 100, 'Connecting to device...', progressCallback, details);

      const logSyncOptions = toAttendanceLogSyncOptions(options);
      const sidecarOptions = logSyncOptions.mode === 'range' && logSyncOptions.startDate && logSyncOptions.endDate
        ? { mode: 'range' as const, startDate: logSyncOptions.startDate, endDate: logSyncOptions.endDate }
        : { mode: 'all' as const };

      let deviceUsers: { deviceUserId: string; deviceName: string }[] = [];
      let deviceLogs: { deviceUserId: string; timestamp: string; verifyType: number; punchType: number; userName?: string | null }[] = [];

      try {
        checkAbort();
        updateProgress(deviceId, 'fetching', 5, 100, 'Fetching users and attendance logs from device...', progressCallback, details);
        const syncResult = await this.deviceCommunication.syncAll(config, sidecarOptions);
        deviceUsers = syncResult.users;
        deviceLogs = syncResult.logs;

        details.usersTotal = deviceUsers.length;
        details.logsTotal = deviceLogs.length;
        details.totalRecordsFetched = deviceUsers.length + deviceLogs.length;

        console.log(`[SyncEngine] Received ${deviceUsers.length} users and ${deviceLogs.length} logs from device`);

        updateProgress(
          deviceId, 'fetching', 15, 100,
          `Fetched ${deviceUsers.length} users and ${deviceLogs.length} logs from device`,
          progressCallback, details
        );
      } catch (error) {
        if (abortSignal?.aborted) throw new Error('Sync cancelled');
        const errMsg = error instanceof Error ? error.message : String(error);
        errors.push(`Device sync error: ${errMsg}`);
      }

      // ── Phase 2: Process users ────────────────────────────────────────
      checkAbort();
      await yieldToUI();
      updateProgress(deviceId, 'users', 20, 100, `Processing ${deviceUsers.length} users...`, progressCallback, details);
      
      let syncedAt = new Date().toISOString();

      const existingUsers = await listUsers({ status: 'all' });
      const existingDeviceUserIds = new Set(
        existingUsers
          .filter(u => u.deviceUserId)
          .map(u => u.deviceUserId as string)
      );

      const totalNewUsers = deviceUsers.length;
      for (let i = 0; i < totalNewUsers; i++) {
        if (i % 10 === 0) checkAbort();

        const deviceUser = deviceUsers[i];
        if (!deviceUser) continue;
        
        const userData: CreateUserInput = {
          deviceUserId: deviceUser.deviceUserId,
          deviceName: deviceUser.deviceName,
          displayName: deviceUser.deviceName || `User ${deviceUser.deviceUserId}`,
          status: 'active',
        };

        if (existingDeviceUserIds.has(deviceUser.deviceUserId)) {
          usersSynced++;
          details.usersProcessed = usersAdded + usersSynced;
          continue;
        }

        try {
          await createUser(userData);
          usersAdded++;
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          if (!errMsg.includes('UNIQUE constraint')) {
            errors.push(`Failed to create user ${userData.displayName}: ${errMsg}`);
          } else {
            usersSynced++;
          }
        }
        
        details.usersProcessed = usersAdded + usersSynced;

        // Yield every 10 users so the UI can re-render and other CRUD works
        if (i % 10 === 0) {
          await yieldToUI();
          updateProgress(
            deviceId, 'users',
            20 + Math.floor(((i + 1) / totalNewUsers) * 10),
            100,
            `Users: ${details.usersProcessed} / ${totalNewUsers}`,
            progressCallback, details
          );
        }
      }

      // ── Phase 3: Insert attendance logs ───────────────────────────────
      checkAbort();
      await yieldToUI();
      updateProgress(deviceId, 'logs', 30, 100, `Inserting ${deviceLogs.length} attendance logs...`, progressCallback, details);
      
      if (deviceLogs.length > 0) {
        const logsToInsert = deviceLogs.map(log => ({
          deviceId: config.id,
          deviceUserId: log.deviceUserId,
          timestamp: log.timestamp,
          verifyType: log.verifyType,
          punchType: log.punchType,
          userName: log.userName || null,
        }));
        
        try {
          const insertResult = await insertLogs(logsToInsert, (processed, total) => {
            // Per-batch progress callback from insertLogs
            details.logsProcessed = processed;
            updateProgress(
              deviceId, 'logs',
              30 + Math.floor((processed / total) * 30),
              100,
              `Logs: ${processed.toLocaleString()} / ${total.toLocaleString()}`,
              progressCallback, details
            );
          }, abortSignal);
          logsAdded = insertResult.inserted;
          logsDeduplicated = insertResult.duplicates;
          details.logsProcessed = logsToInsert.length;
        } catch (error) {
          if (abortSignal?.aborted) throw new Error('Sync cancelled');
          errors.push(`Failed to insert logs: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // ── Phase 4: Generate daily summaries ─────────────────────────────
      checkAbort();
      await yieldToUI();
      updateProgress(deviceId, 'processing', 60, 100, 'Generating attendance summaries...', progressCallback, details);
      
      try {
        await this.generateSummariesFromLogs(deviceId, progressCallback, details, abortSignal);
      } catch (error) {
        if (abortSignal?.aborted) throw new Error('Sync cancelled');
        errors.push(`Failed to generate summaries: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Update last sync timestamp
      syncedAt = new Date().toISOString();
      try {
        await updateLastSyncAt(deviceId, syncedAt);
        state.lastSyncAt = syncedAt;
      } catch (error) {
        errors.push(`Failed to update sync timestamp: ${error instanceof Error ? error.message : String(error)}`);
      }

      // ── Phase 5: Complete ─────────────────────────────────────────────
      updateProgress(deviceId, 'complete', 100, 100, 'Sync complete!', progressCallback, details);

      return {
        success: errors.length === 0,
        usersAdded,
        usersSynced,
        logsAdded,
        logsDeduplicated,
        errors,
        syncedAt,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(errorMessage);

      return {
        success: false,
        usersAdded,
        usersSynced,
        logsAdded,
        logsDeduplicated,
        errors,
        syncedAt: new Date().toISOString(),
      };

    } finally {
      state.isSyncing = false;
    }
  }

  /**
   * Generate daily summaries from raw attendance logs
   * 
   * Matching strategy (in order of priority):
   * 1. Exact match: log.device_user_id === user.device_user_id
   * 2. Name match: log.device_user_id === user.device_name (case-insensitive)
   * 3. Name match: log.device_user_id === user.display_name (case-insensitive)
   * 
   * The ZKTeco device stores different values in the attendance record's userId field
   * depending on how the user was enrolled - sometimes it's a numeric ID, sometimes
   * it's the user's name. This method handles both cases.
   */
  async generateSummariesFromLogs(
    deviceId: string,
    progressCallback?: SyncProgressCallback,
    details?: NonNullable<SyncProgress['details']>,
    abortSignal?: AbortSignal
  ): Promise<void> {
    // Get all users
    const users = await listUsers({ status: 'all' });
    
    if (users.length === 0) {
      console.log('[SyncEngine] No users found, skipping summary generation');
      return;
    }

    // Build multiple lookup maps for flexible matching
    // Map 1: deviceUserId → user (exact ID match)
    const byDeviceUserId = new Map<string, typeof users[0]>();
    // Map 2: lowercase device_name → user (name match)
    const byDeviceName = new Map<string, typeof users[0]>();
    // Map 3: lowercase display_name → user (display name match)
    const byDisplayName = new Map<string, typeof users[0]>();

    for (const user of users) {
      if (user.deviceUserId) {
        byDeviceUserId.set(user.deviceUserId, user);
      }
      if (user.deviceName) {
        byDeviceName.set(user.deviceName.toLowerCase(), user);
      }
      if (user.displayName) {
        byDisplayName.set(user.displayName.toLowerCase(), user);
      }
    }
    
    console.log(`[SyncEngine] Built lookup maps: ${byDeviceUserId.size} by ID, ${byDeviceName.size} by device name, ${byDisplayName.size} by display name`);

    /**
     * Resolve a log's device_user_id to a user using multi-strategy matching
     */
    const resolveUser = (logDeviceUserId: string): typeof users[0] | undefined => {
      // Strategy 1: exact match on deviceUserId
      const byId = byDeviceUserId.get(logDeviceUserId);
      if (byId) return byId;
      
      // Strategy 2: match on device name (case-insensitive)
      const byName = byDeviceName.get(logDeviceUserId.toLowerCase());
      if (byName) return byName;
      
      // Strategy 3: match on display name (case-insensitive)
      const byDisplay = byDisplayName.get(logDeviceUserId.toLowerCase());
      if (byDisplay) return byDisplay;
      
      return undefined;
    };

    // Get attendance rules
    let rules = DEFAULT_ATTENDANCE_RULES;
    try {
      const settings = await settingsRepository.getAppSettings();
      rules = settings.attendance;
    } catch (error) {
      console.log('[SyncEngine] Using default attendance rules');
    }

    // Get holidays
    let holidays: Set<string> = new Set();
    try {
      const holidayList = await holidayRepository.listHolidays();
      holidays = new Set(holidayList.map(h => h.date));
    } catch (error) {
      console.log('[SyncEngine] Could not load holidays');
    }

    // Get all raw logs
    const allLogs = await select<{
      id: string;
      device_id: string;
      device_user_id: string;
      timestamp: string;
      verify_type: number;
      punch_type: number;
      raw_payload: string | null;
      created_at: string;
    }>(
      `SELECT * FROM attendance_logs_raw WHERE device_id = ? ORDER BY timestamp ASC`,
      [deviceId]
    );

    console.log(`[SyncEngine] Processing ${allLogs.length} raw logs`);

    if (allLogs.length === 0) {
      return;
    }

    // Match logs to users and group by user+date
    // Key: `${userId}|${date}` → logs
    const userDateLogs = new Map<string, { user: typeof users[0]; logs: typeof allLogs }>();
    let matchedCount = 0;
    let unmatchedCount = 0;
    const unmatchedIds = new Set<string>();

    for (const log of allLogs) {
      const user = resolveUser(log.device_user_id);
      if (!user) {
        unmatchedCount++;
        unmatchedIds.add(log.device_user_id);
        continue;
      }
      
      matchedCount++;
      const date = log.timestamp.split('T')[0] as string;
      const key = `${user.id}|${date}`;
      
      if (!userDateLogs.has(key)) {
        userDateLogs.set(key, { user, logs: [] });
      }
      userDateLogs.get(key)!.logs.push(log);
    }

    console.log(`[SyncEngine] Matched ${matchedCount} logs to users, ${unmatchedCount} unmatched`);
    if (unmatchedIds.size > 0) {
      const sample = Array.from(unmatchedIds).slice(0, 20);
      console.log(`[SyncEngine] Unmatched device_user_ids (sample): ${sample.join(', ')}`);
    }

    // Process each user+date combination in batched transactions
    // to avoid both slow auto-commits and long-held locks
    let processed = 0;
    const total = userDateLogs.size;
    const entries = Array.from(userDateLogs.entries());
    const SUMMARY_BATCH_SIZE = 50;

    if (details) {
      details.summariesTotal = total;
      details.summariesProcessed = 0;
    }

    for (let batchStart = 0; batchStart < entries.length; batchStart += SUMMARY_BATCH_SIZE) {
      // Check cancellation between batches
      if (abortSignal?.aborted) throw new Error('Sync cancelled');

      const batch = entries.slice(batchStart, batchStart + SUMMARY_BATCH_SIZE);
      
      // Wrap each batch in a savepoint for performance
      const savepointName = `summaries_${batchStart}`;
      try {
        await execute(`SAVEPOINT ${savepointName}`);
        
        for (const [key, { user, logs: dateLogs }] of batch) {
          const date = key.split('|')[1] as string;
          
          try {
            const punches: PunchRecord[] = dateLogs.map(log => ({
              id: log.id,
              userId: user.id,
              deviceId: log.device_id,
              deviceUserId: log.device_user_id,
              timestamp: log.timestamp,
              punchType: log.punch_type ?? 0,
              verifyType: log.verify_type ?? 0,
              createdAt: log.created_at,
            }));

            const isHoliday = holidays.has(date);
            const summary = processDay(user.id, date, punches, rules, isHoliday);

            await upsertSummary({
              userId: user.id,
              date: date,
              checkInTime: summary.checkInTime,
              checkOutTime: summary.checkOutTime,
              isIncomplete: summary.isIncomplete,
              lateMinutes: summary.lateMinutes,
              earlyMinutes: summary.earlyMinutes,
              status: summary.status,
              flags: summary.flags,
            });
          } catch (error) {
            console.error(`[SyncEngine] Error processing ${user.displayName} on ${date}:`, error);
          }

          processed++;
        }
        
        await execute(`RELEASE SAVEPOINT ${savepointName}`);
      } catch (batchError) {
        await execute(`ROLLBACK TO SAVEPOINT ${savepointName}`).catch(() => {});
        console.error(`[SyncEngine] Summary batch failed at offset ${batchStart}:`, batchError);
      }

      // Yield to event loop so UI stays responsive and other DB operations can interleave
      await yieldToUI();

      if (details) {
        details.summariesProcessed = processed;
      }

      if (progressCallback) {
        updateProgress(
          deviceId,
          'processing',
          60 + Math.floor((processed / total) * 35),
          100,
          `Summaries: ${processed.toLocaleString()} / ${total.toLocaleString()}`,
          progressCallback,
          details
        );
      }
    }

    console.log(`[SyncEngine] Generated ${processed} daily summaries`);
  }
}

// Export singleton instance
let syncEngine: SyncEngine | null = null;

export function getSyncEngine(): SyncEngine {
  if (!syncEngine) {
    syncEngine = new SyncEngine();
  }
  return syncEngine;
}

// Export transaction utilities for testing
export {
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
  isInTransaction,
};
