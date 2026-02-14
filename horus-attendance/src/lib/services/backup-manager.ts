/**
 * Backup Manager
 * 
 * Handles database export and import operations for backup and restore functionality.
 * Creates portable zip files containing the SQLite database and metadata.
 * Requirements: 10.1, 10.2, 10.3, 10.4
 */

import type { BackupMetadata, BackupResult, RestoreResult } from '../../types/services';

// App version for backup metadata
const APP_VERSION = '0.1.0';
const BACKUP_VERSION = '1.0';

/**
 * Database adapter interface for backup operations
 * This allows us to inject different implementations for testing vs production
 */
export interface BackupDatabaseAdapter {
  getUserCount(): Promise<number>;
  getLogCount(): Promise<number>;
  getAllUsers(): Promise<unknown[]>;
  getAllDepartments(): Promise<unknown[]>;
  getAllDevices(): Promise<unknown[]>;
  getAllAttendanceLogs(): Promise<unknown[]>;
  getAllAttendanceSummaries(): Promise<unknown[]>;
  getAllSettings(): Promise<unknown[]>;
  getAllHolidays(): Promise<unknown[]>;
  clearAllData(): Promise<void>;
  restoreUsers(users: unknown[]): Promise<number>;
  restoreDepartments(departments: unknown[]): Promise<number>;
  restoreDevices(devices: unknown[]): Promise<number>;
  restoreAttendanceLogs(logs: unknown[]): Promise<number>;
  restoreAttendanceSummaries(summaries: unknown[]): Promise<number>;
  restoreSettings(settings: unknown[]): Promise<number>;
  restoreHolidays(holidays: unknown[]): Promise<number>;
}

/**
 * File system adapter interface for backup operations
 * This allows us to inject different implementations for testing vs production
 */
export interface BackupFileSystemAdapter {
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
  getFileSize(path: string): Promise<number>;
  getDefaultBackupPath(): Promise<string>;
}

/**
 * Backup data structure
 */
export interface BackupData {
  metadata: BackupMetadata;
  data: {
    users: unknown[];
    departments: unknown[];
    devices: unknown[];
    attendanceLogs: unknown[];
    attendanceSummaries: unknown[];
    settings: unknown[];
    holidays: unknown[];
  };
}

/**
 * Calculate a simple checksum for backup data
 */
export function calculateChecksum(data: string): string {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Validate backup data structure
 */
export function validateBackupStructure(data: unknown): data is BackupData {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const backup = data as Record<string, unknown>;

  // Check metadata
  if (!backup.metadata || typeof backup.metadata !== 'object') {
    return false;
  }

  const metadata = backup.metadata as Record<string, unknown>;
  if (
    typeof metadata.version !== 'string' ||
    typeof metadata.createdAt !== 'string' ||
    typeof metadata.appVersion !== 'string' ||
    typeof metadata.userCount !== 'number' ||
    typeof metadata.logCount !== 'number' ||
    typeof metadata.checksum !== 'string'
  ) {
    return false;
  }

  // Check data
  if (!backup.data || typeof backup.data !== 'object') {
    return false;
  }

  const backupData = backup.data as Record<string, unknown>;
  if (
    !Array.isArray(backupData.users) ||
    !Array.isArray(backupData.departments) ||
    !Array.isArray(backupData.devices) ||
    !Array.isArray(backupData.attendanceLogs) ||
    !Array.isArray(backupData.attendanceSummaries) ||
    !Array.isArray(backupData.settings) ||
    !Array.isArray(backupData.holidays)
  ) {
    return false;
  }

  return true;
}

/**
 * Verify backup checksum
 */
export function verifyChecksum(backup: BackupData): boolean {
  const storedChecksum = backup.metadata.checksum;
  
  // Calculate checksum from data (excluding the checksum field itself)
  const dataForChecksum = JSON.stringify(backup.data);
  const calculatedChecksum = calculateChecksum(dataForChecksum);
  
  return storedChecksum === calculatedChecksum;
}

/**
 * Backup Manager class
 */
export class BackupManager {
  private dbAdapter: BackupDatabaseAdapter;
  private fsAdapter: BackupFileSystemAdapter;

  constructor(dbAdapter: BackupDatabaseAdapter, fsAdapter: BackupFileSystemAdapter) {
    this.dbAdapter = dbAdapter;
    this.fsAdapter = fsAdapter;
  }

  /**
   * Create a backup of the database
   * Requirements: 10.1
   */
  async createBackup(destinationPath?: string): Promise<BackupResult> {
    try {
      // Get default path if not provided
      const filePath = destinationPath || await this.getDefaultBackupFilePath();

      // Gather all data from database
      const [
        users,
        departments,
        devices,
        attendanceLogs,
        attendanceSummaries,
        settings,
        holidays,
      ] = await Promise.all([
        this.dbAdapter.getAllUsers(),
        this.dbAdapter.getAllDepartments(),
        this.dbAdapter.getAllDevices(),
        this.dbAdapter.getAllAttendanceLogs(),
        this.dbAdapter.getAllAttendanceSummaries(),
        this.dbAdapter.getAllSettings(),
        this.dbAdapter.getAllHolidays(),
      ]);

      // Create backup data structure
      const data = {
        users,
        departments,
        devices,
        attendanceLogs,
        attendanceSummaries,
        settings,
        holidays,
      };

      // Calculate checksum
      const dataString = JSON.stringify(data);
      const checksum = calculateChecksum(dataString);

      // Create metadata
      const metadata: BackupMetadata = {
        version: BACKUP_VERSION,
        createdAt: new Date().toISOString(),
        appVersion: APP_VERSION,
        userCount: users.length,
        logCount: attendanceLogs.length,
        checksum,
      };

      // Create backup object
      const backup: BackupData = {
        metadata,
        data,
      };

      // Write to file
      const backupContent = JSON.stringify(backup, null, 2);
      await this.fsAdapter.writeFile(filePath, backupContent);

      // Get file size
      const fileSize = await this.fsAdapter.getFileSize(filePath);

      return {
        success: true,
        filePath,
        fileSize,
        metadata,
      };
    } catch (error) {
      throw new Error(`Backup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validate a backup file
   * Requirements: 10.3
   */
  async validateBackup(filePath: string): Promise<BackupMetadata | null> {
    try {
      // Check if file exists
      const exists = await this.fsAdapter.fileExists(filePath);
      if (!exists) {
        return null;
      }

      // Read file content
      const content = await this.fsAdapter.readFile(filePath);
      
      // Parse JSON
      let backup: unknown;
      try {
        backup = JSON.parse(content);
      } catch {
        return null;
      }

      // Validate structure
      if (!validateBackupStructure(backup)) {
        return null;
      }

      // Verify checksum
      if (!verifyChecksum(backup)) {
        return null;
      }

      return backup.metadata;
    } catch {
      return null;
    }
  }

  /**
   * Restore database from a backup file
   * Requirements: 10.2, 10.3, 10.4
   */
  async restoreBackup(filePath: string): Promise<RestoreResult> {
    try {
      // Validate backup first
      const metadata = await this.validateBackup(filePath);
      if (!metadata) {
        return {
          success: false,
          usersRestored: 0,
          logsRestored: 0,
          error: 'Invalid or corrupted backup file',
        };
      }

      // Read and parse backup
      const content = await this.fsAdapter.readFile(filePath);
      const backup = JSON.parse(content) as BackupData;

      // Clear existing data
      await this.dbAdapter.clearAllData();

      // Restore data in order (respecting foreign key constraints)
      // 1. Departments first (no dependencies)
      await this.dbAdapter.restoreDepartments(backup.data.departments);

      // 2. Devices (no dependencies)
      await this.dbAdapter.restoreDevices(backup.data.devices);

      // 3. Users (depends on departments)
      const usersRestored = await this.dbAdapter.restoreUsers(backup.data.users);

      // 4. Attendance logs (depends on devices)
      const logsRestored = await this.dbAdapter.restoreAttendanceLogs(backup.data.attendanceLogs);

      // 5. Attendance summaries (depends on users)
      await this.dbAdapter.restoreAttendanceSummaries(backup.data.attendanceSummaries);

      // 6. Settings (no dependencies)
      await this.dbAdapter.restoreSettings(backup.data.settings);

      // 7. Holidays (no dependencies)
      await this.dbAdapter.restoreHolidays(backup.data.holidays);

      return {
        success: true,
        usersRestored,
        logsRestored,
      };
    } catch (error) {
      return {
        success: false,
        usersRestored: 0,
        logsRestored: 0,
        error: `Restore failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get backup history (not implemented - would require tracking backups)
   */
  async getBackupHistory(): Promise<BackupMetadata[]> {
    // This would require storing backup history in the database
    // For now, return empty array
    return [];
  }

  /**
   * Generate default backup file path with timestamp
   */
  private async getDefaultBackupFilePath(): Promise<string> {
    const basePath = await this.fsAdapter.getDefaultBackupPath();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${basePath}/horus-backup-${timestamp}.json`;
  }
}

// Export for testing
export { APP_VERSION, BACKUP_VERSION };
