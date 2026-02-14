/**
 * Tauri Commands
 * TypeScript bindings for Tauri backend commands
 */

import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';

// ============================================================================
// Types
// ============================================================================

export interface BackupResult {
  success: boolean;
  file_path: string;
  file_size: number;
  error: string | null;
}

export interface RestoreResult {
  success: boolean;
  error: string | null;
}

// ============================================================================
// Backup Commands
// ============================================================================

/**
 * Export database backup to a file
 * @param destination Optional destination directory path
 * @returns BackupResult with file path and size
 */
export async function exportBackup(destination?: string): Promise<BackupResult> {
  return invoke<BackupResult>('export_backup', { destination });
}

/**
 * Restore database from a backup file
 * @param backupPath Path to the backup file
 * @returns RestoreResult indicating success or failure
 */
export async function restoreBackup(backupPath: string): Promise<RestoreResult> {
  return invoke<RestoreResult>('restore_backup', { backupPath });
}

/**
 * Get the default backup directory path
 * @returns Path to the backup directory
 */
export async function getBackupDirectory(): Promise<string> {
  return invoke<string>('get_backup_directory');
}

/**
 * List available backup files
 * @returns Array of backup filenames
 */
export async function listBackups(): Promise<string[]> {
  return invoke<string[]>('list_backups');
}

/**
 * Get the application version
 * @returns Version string
 */
export async function getAppVersion(): Promise<string> {
  return invoke<string>('get_app_version');
}

/**
 * Reset the database by deleting all data
 * Creates a backup before reset
 * @returns RestoreResult indicating success or failure
 */
export async function resetDatabase(): Promise<RestoreResult> {
  try {
    // First create a backup
    await invoke<BackupResult>('export_backup', { destination: null });
    
    // Then flush all tables via SQL (this works even with open connection)
    const { flushDatabase } = await import('./database');
    await flushDatabase();
    
    return { success: true, error: null };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

// ============================================================================
// File Dialog Functions
// ============================================================================

/**
 * Open file dialog to select a backup file for restore
 * @returns Selected file path or null if cancelled
 */
export async function selectBackupFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    filters: [{
      name: 'Database Backup',
      extensions: ['db'],
    }],
    title: 'Select Backup File',
  });
  
  return selected as string | null;
}

/**
 * Open save dialog to choose backup destination
 * @returns Selected file path or null if cancelled
 */
export async function selectBackupDestination(): Promise<string | null> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const defaultName = `horus_backup_${timestamp}.db`;
  
  const selected = await save({
    defaultPath: defaultName,
    filters: [{
      name: 'Database Backup',
      extensions: ['db'],
    }],
    title: 'Save Backup As',
  });
  
  return selected;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if running in Tauri environment
 */
export function isTauriEnvironment(): boolean {
  // Check for Tauri internals - works with Tauri v2
  if (typeof window !== 'undefined') {
    // Check for __TAURI_INTERNALS__ (Tauri v2)
    if ('__TAURI_INTERNALS__' in window) {
      return true;
    }
    // Check for __TAURI__ (Tauri v1)
    if ('__TAURI__' in window) {
      return true;
    }
  }
  return false;
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Parse backup filename to extract date
 */
export function parseBackupDate(filename: string): Date | null {
  // Format: horus_backup_YYYYMMDD_HHMMSS.db
  const match = filename.match(/horus_backup_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.db/);
  if (!match) return null;
  
  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    parseInt(year!, 10),
    parseInt(month!, 10) - 1,
    parseInt(day!, 10),
    parseInt(hour!, 10),
    parseInt(minute!, 10),
    parseInt(second!, 10)
  );
}
