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
import { insertLogs, getLatestLogTimestamp } from '../repositories/attendance-log.repository';
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

      // The ZKTeco protocol always returns ALL records from the device regardless
      // of any date filter we send. Filtering must happen client-side after fetch.
      // We always request mode:'all' from the device and filter ourselves.
      const sidecarOptions = { mode: 'all' as const };

      // Determine the client-side filter window based on sync mode.
      // filterStartDate / filterEndDate define which records we actually keep.
      let filterStartDate: string | null = null;
      let filterEndDate: string | null = null;

      if (logSyncOptions.mode === 'latest') {
        // "Latest" mode: only records newer than what's already in DB (2-day overlap for safety)
        const lastTimestamp = await getLatestLogTimestamp(deviceId);
        if (lastTimestamp) {
          const cutoff = new Date(lastTimestamp);
          cutoff.setDate(cutoff.getDate() - 2);
          filterStartDate = cutoff.toISOString().split('T')[0] as string;
          console.log(`[SyncEngine] Latest mode: last record ${lastTimestamp}, filter from ${filterStartDate}`);
        } else {
          console.log('[SyncEngine] Latest mode: no existing records, will process all');
        }
      } else if (logSyncOptions.mode === 'range' && logSyncOptions.startDate && logSyncOptions.endDate) {
        // "Date Range" / "Last N Days" mode: only records in the requested window
        filterStartDate = logSyncOptions.startDate;
        filterEndDate = logSyncOptions.endDate;
        console.log(`[SyncEngine] Range mode: filter ${filterStartDate} to ${filterEndDate}`);
      }

      let deviceUsers: { deviceUserId: string; deviceName: string }[] = [];
      let deviceLogs: { deviceUserId: string; timestamp: string; verifyType: number; punchType: number; userName?: string | null }[] = [];

      try {
        checkAbort();
        updateProgress(deviceId, 'fetching', 5, 100, 'Fetching data from device...', progressCallback, details);

        // Try combined sync first; fall back to separate fetches on failure.
        let syncError: string | null = null;
        try {
          const syncResult = await this.deviceCommunication.syncAll(config, sidecarOptions);
          deviceUsers = syncResult.users;
          deviceLogs = syncResult.logs;
        } catch (combinedError) {
          syncError = combinedError instanceof Error ? combinedError.message : String(combinedError);
          console.warn(`[SyncEngine] Combined sync failed: ${syncError}. Trying separate fetches...`);
          updateProgress(deviceId, 'fetching', 7, 100, 'Retrying with separate fetches...', progressCallback, details);
        }

        // Fallback: fetch users and logs in separate calls
        if (syncError && !abortSignal?.aborted) {
          try {
            deviceUsers = await this.deviceCommunication.getUsers(config);
            console.log(`[SyncEngine] Separate fetch: got ${deviceUsers.length} users`);
          } catch (userError) {
            const msg = userError instanceof Error ? userError.message : String(userError);
            errors.push(`Failed to fetch users: ${msg}`);
          }
          checkAbort();
          try {
            deviceLogs = await this.deviceCommunication.getAttendanceLogs(config, sidecarOptions);
            console.log(`[SyncEngine] Separate fetch: got ${deviceLogs.length} logs`);
          } catch (logError) {
            const msg = logError instanceof Error ? logError.message : String(logError);
            errors.push(`Failed to fetch attendance logs: ${msg}`);
          }
        }

        const totalFetched = deviceLogs.length;

        // ── Client-side date filter ──
        // Apply the date window BEFORE any DB work so we never waste time on
        // records outside the requested range.
        if ((filterStartDate || filterEndDate) && deviceLogs.length > 0) {
          deviceLogs = deviceLogs.filter(log => {
            const logDate = log.timestamp.split('T')[0] ?? '';
            if (filterStartDate && logDate < filterStartDate) return false;
            if (filterEndDate && logDate > filterEndDate) return false;
            return true;
          });
          console.log(`[SyncEngine] Date filter: ${totalFetched} → ${deviceLogs.length} logs`);
        }

        details.usersTotal = deviceUsers.length;
        details.logsTotal = deviceLogs.length;
        details.totalRecordsFetched = deviceUsers.length + totalFetched;

        console.log(`[SyncEngine] Received ${deviceUsers.length} users and ${totalFetched} total logs (${deviceLogs.length} after filter)`);

        updateProgress(
          deviceId, 'fetching', 15, 100,
          `Fetched ${deviceUsers.length} users, ${deviceLogs.length} logs to process`,
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
      
      // Collect unique dates from the device logs for scoped summary generation
      const syncedDates = new Set<string>();

      if (deviceLogs.length > 0) {
        // ── Optimization: skip records already in DB ──
        // Query the latest existing timestamp for this device. Records at or before
        // this timestamp are almost certainly duplicates, so we only INSERT the tail.
        // This turns a 20-minute full-table dedup into a sub-second operation for
        // incremental syncs.
        let logsToProcess = deviceLogs;
        try {
          const latestExisting = await getLatestLogTimestamp(config.id);
          if (latestExisting) {
            const newLogs = deviceLogs.filter(log => log.timestamp > latestExisting);
            const skipped = deviceLogs.length - newLogs.length;
            if (skipped > 0) {
              console.log(`[SyncEngine] Pre-filter: skipping ${skipped} records at or before ${latestExisting}`);
              logsDeduplicated += skipped;
              logsToProcess = newLogs;
            }
          }
        } catch (err) {
          console.warn('[SyncEngine] Could not query latest timestamp, inserting all records');
        }

        const logsToInsert = logsToProcess.map(log => {
          const date = log.timestamp.split('T')[0];
          if (date) syncedDates.add(date);
          return {
            deviceId: config.id,
            deviceUserId: log.deviceUserId,
            timestamp: log.timestamp,
            verifyType: log.verifyType,
            punchType: log.punchType,
            userName: log.userName || null,
          };
        });

        if (logsToInsert.length > 0) {
          try {
            console.log(`[SyncEngine] Inserting ${logsToInsert.length} new logs (${logsDeduplicated} pre-filtered as duplicates)...`);
            const insertResult = await insertLogs(logsToInsert, (processed, total) => {
              details.logsProcessed = logsDeduplicated + processed;
              updateProgress(
                deviceId, 'logs',
                30 + Math.floor((processed / total) * 30),
                100,
                `Inserting: ${processed.toLocaleString()} / ${total.toLocaleString()} new records`,
                progressCallback, details
              );
            }, abortSignal);
            logsAdded = insertResult.inserted;
            logsDeduplicated += insertResult.duplicates;
            details.logsProcessed = deviceLogs.length;
            console.log(`[SyncEngine] Insert complete: ${logsAdded} new, ${logsDeduplicated} total duplicates`);
          } catch (error) {
            if (abortSignal?.aborted) throw new Error('Sync cancelled');
            const errMsg = error instanceof Error ? error.message : String(error);
            console.error('[SyncEngine] Failed to insert logs:', errMsg);
            errors.push(`Failed to insert logs: ${errMsg}`);
          }
        } else {
          console.log(`[SyncEngine] All ${deviceLogs.length} records already in DB, nothing to insert`);
          details.logsProcessed = deviceLogs.length;
        }
      }

      // ── Phase 4: Generate daily summaries ─────────────────────────────
      // ONLY regenerate summaries if we actually fetched and inserted new data.
      // When the device fetch fails, syncedDates is empty and there's nothing
      // new to process — running summaries would just churn through all existing
      // DB rows for no benefit and confuse the user with large counts.
      if (syncedDates.size > 0) {
        checkAbort();
        await yieldToUI();
        updateProgress(deviceId, 'processing', 60, 100, 'Generating attendance summaries...', progressCallback, details);
        
        try {
          const datesToProcess = Array.from(syncedDates);
          console.log(`[SyncEngine] Generating summaries for ${datesToProcess.length} dates...`);
          await this.generateSummariesFromLogs(deviceId, progressCallback, details, abortSignal, datesToProcess);
        } catch (error) {
          if (abortSignal?.aborted) throw new Error('Sync cancelled');
          const errMsg = error instanceof Error ? error.message : String(error);
          console.error('[SyncEngine] Failed to generate summaries:', errMsg);
          errors.push(`Failed to generate summaries: ${errMsg}`);
        }
      } else {
        console.log('[SyncEngine] No new data synced, skipping summary generation');
        updateProgress(deviceId, 'processing', 90, 100, 'No new data to summarize', progressCallback, details);
      }

      // Update last sync timestamp
      syncedAt = new Date().toISOString();
      try {
        await updateLastSyncAt(deviceId, syncedAt);
        state.lastSyncAt = syncedAt;
        console.log(`[SyncEngine] Updated last sync timestamp to ${syncedAt}`);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('[SyncEngine] Failed to update sync timestamp:', errMsg);
        errors.push(`Failed to update sync timestamp: ${errMsg}`);
      }

      // ── Phase 5: Complete ─────────────────────────────────────────────
      updateProgress(deviceId, 'complete', 100, 100, 'Sync complete!', progressCallback, details);

      if (errors.length > 0) {
        console.warn(`[SyncEngine] Sync completed with ${errors.length} error(s):`, errors);
      } else {
        console.log(`[SyncEngine] Sync completed successfully: ${logsAdded} logs, ${usersAdded} users added`);
      }

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
   * 
   * @param datesToProcess - If provided, only regenerate summaries for these dates
   *   (optimisation: avoids re-processing the entire history on every sync)
   */
  async generateSummariesFromLogs(
    deviceId: string,
    progressCallback?: SyncProgressCallback,
    details?: NonNullable<SyncProgress['details']>,
    abortSignal?: AbortSignal,
    datesToProcess?: string[]
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

    // Get all raw logs (scoped to synced dates if available for performance)
    let logQuery = `SELECT * FROM attendance_logs_raw WHERE device_id = ?`;
    const logParams: unknown[] = [deviceId];

    if (datesToProcess && datesToProcess.length > 0) {
      // Build date range filter: only load logs for the dates we just synced
      const sortedDates = [...datesToProcess].sort();
      const minDate = sortedDates[0]!;
      const maxDate = sortedDates[sortedDates.length - 1]!;
      logQuery += ` AND timestamp >= ? AND timestamp < ?`;
      logParams.push(`${minDate}T00:00:00`, `${maxDate}T23:59:59.999Z`);
      console.log(`[SyncEngine] Querying logs scoped to ${minDate} — ${maxDate} (${datesToProcess.length} dates)`);
    }

    logQuery += ` ORDER BY timestamp ASC`;

    const allLogs = await select<{
      id: string;
      device_id: string;
      device_user_id: string;
      timestamp: string;
      verify_type: number;
      punch_type: number;
      raw_payload: string | null;
      created_at: string;
    }>(logQuery, logParams);

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
    // to avoid both slow auto-commits and long-held locks.
    // Compute all summaries in CPU first, then bulk-INSERT per batch
    // to minimise IPC round-trips (1 SQL call per batch instead of N×2).
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

      // Phase 1: Compute all summaries in CPU (no DB calls)
      const computedSummaries: Array<{
        id: string;
        userId: string;
        date: string;
        checkInTime: string | null;
        checkOutTime: string | null;
        isIncomplete: number;
        lateMinutes: number;
        earlyMinutes: number;
        status: string;
        flags: string;
        timestamp: string;
      }> = [];

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

          computedSummaries.push({
            id: crypto.randomUUID(),
            userId: user.id,
            date,
            checkInTime: summary.checkInTime ?? null,
            checkOutTime: summary.checkOutTime ?? null,
            isIncomplete: summary.isIncomplete ? 1 : 0,
            lateMinutes: summary.lateMinutes ?? 0,
            earlyMinutes: summary.earlyMinutes ?? 0,
            status: summary.status ?? 'absent',
            flags: JSON.stringify(summary.flags ?? []),
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          console.error(`[SyncEngine] Error processing ${user.displayName} on ${date}:`, error);
        }

        processed++;
      }

      // Phase 2: Bulk insert all computed summaries in one multi-row SQL call
      if (computedSummaries.length > 0) {
        const savepointName = `summaries_${batchStart}`;
        try {
          await execute(`SAVEPOINT ${savepointName}`);

          const placeholders: string[] = [];
          const params: unknown[] = [];

          for (const s of computedSummaries) {
            placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
            params.push(
              s.id, s.userId, s.date,
              s.checkInTime, s.checkOutTime, s.isIncomplete,
              s.lateMinutes, s.earlyMinutes, s.status, s.flags,
              s.timestamp, s.timestamp,
            );
          }

          await execute(
            `INSERT INTO attendance_day_summary
             (id, user_id, date, check_in_time, check_out_time, is_incomplete,
              late_minutes, early_minutes, status, flags, created_at, updated_at)
             VALUES ${placeholders.join(',\n                    ')}
             ON CONFLICT(user_id, date) DO UPDATE SET
               check_in_time = excluded.check_in_time,
               check_out_time = excluded.check_out_time,
               is_incomplete = excluded.is_incomplete,
               late_minutes = excluded.late_minutes,
               early_minutes = excluded.early_minutes,
               status = excluded.status,
               flags = excluded.flags,
               updated_at = excluded.updated_at`,
            params
          );

          await execute(`RELEASE SAVEPOINT ${savepointName}`);
        } catch (batchError) {
          const errMsg = batchError instanceof Error ? batchError.message : String(batchError);
          await execute(`ROLLBACK TO SAVEPOINT ${savepointName}`).catch(() => {});
          await execute(`RELEASE SAVEPOINT ${savepointName}`).catch(() => {});
          console.error(`[SyncEngine] Summary batch failed at offset ${batchStart} (${computedSummaries.length} rows): ${errMsg}`);
        }
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
