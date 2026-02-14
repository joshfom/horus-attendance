/**
 * Settings Repository
 * 
 * Provides key-value storage operations for application settings.
 * Requirements: 11.2
 */

import { execute, select } from '../database';
import type { AppSettings, AttendanceRules, AppearanceSettings, BackupSettings, ExportSettings, DeviceConfig } from '../../types/models';

// Default attendance rules
export const DEFAULT_ATTENDANCE_RULES: AttendanceRules = {
  workStartTime: '09:00',
  workEndTime: '18:00',
  lateGracePeriod: 15,
  earlyLeaveGracePeriod: 15,
  checkInWindowStart: '06:00',
  checkInWindowEnd: '12:00',
  checkOutWindowStart: '12:00',
  checkOutWindowEnd: '23:00',
  workdays: [1, 2, 3, 4, 5], // Monday to Friday
};

// Default appearance settings
export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  theme: 'dark',
};

// Default backup settings
export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  autoBackup: false,
  backupPath: '',
  lastBackupAt: null,
};

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  onTimeThreshold: '09:00',
  lateThreshold: '09:10',
  colors: {
    onTime: '#C6EFCE',
    between: '#FFFFCC',
    late: '#FCE4D6',
    absent: '#FFC7CE',
    weekend: '#D9E1F2',
    header: '#4472C4',
  },
};

// Default app settings
export const DEFAULT_APP_SETTINGS: AppSettings = {
  device: null,
  attendance: DEFAULT_ATTENDANCE_RULES,
  holidays: [],
  appearance: DEFAULT_APPEARANCE_SETTINGS,
  backup: DEFAULT_BACKUP_SETTINGS,
  export: DEFAULT_EXPORT_SETTINGS,
};

interface SettingsRow extends Record<string, unknown> {
  key: string;
  value: string;
  updated_at: string;
}

/**
 * Get a setting value by key
 */
export async function getSetting(key: string): Promise<string | null> {
  const rows = await select<SettingsRow>(
    'SELECT value FROM settings WHERE key = ?',
    [key]
  );
  return rows.length > 0 ? rows[0]!.value : null;
}

/**
 * Set a setting value
 */
export async function setSetting(key: string, value: string): Promise<void> {
  await execute(
    `INSERT INTO settings (key, value, updated_at) 
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value]
  );
}

/**
 * Delete a setting
 */
export async function deleteSetting(key: string): Promise<void> {
  await execute('DELETE FROM settings WHERE key = ?', [key]);
}

/**
 * Get all settings
 */
export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await select<SettingsRow>('SELECT key, value FROM settings');
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

/**
 * Get typed setting value
 */
export async function getTypedSetting<T>(key: string, defaultValue: T): Promise<T> {
  const value = await getSetting(key);
  if (value === null) {
    return defaultValue;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Set typed setting value
 */
export async function setTypedSetting<T>(key: string, value: T): Promise<void> {
  await setSetting(key, JSON.stringify(value));
}

/**
 * Get full app settings
 */
export async function getAppSettings(): Promise<AppSettings> {
  const [device, attendance, holidays, appearance, backup, exportSettings] = await Promise.all([
    getTypedSetting<DeviceConfig | null>('device', DEFAULT_APP_SETTINGS.device),
    getTypedSetting<AttendanceRules>('attendance', DEFAULT_APP_SETTINGS.attendance),
    getTypedSetting<string[]>('holidays', DEFAULT_APP_SETTINGS.holidays),
    getTypedSetting<AppearanceSettings>('appearance', DEFAULT_APP_SETTINGS.appearance),
    getTypedSetting<BackupSettings>('backup', DEFAULT_APP_SETTINGS.backup),
    getTypedSetting<ExportSettings>('exportSettings', DEFAULT_APP_SETTINGS.export),
  ]);

  return {
    device,
    attendance,
    holidays,
    appearance,
    backup,
    export: exportSettings,
  };
}

/**
 * Update app settings (partial update)
 */
export async function updateAppSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  const updates: Promise<void>[] = [];

  if (settings.device !== undefined) {
    updates.push(setTypedSetting('device', settings.device));
  }
  if (settings.attendance !== undefined) {
    updates.push(setTypedSetting('attendance', settings.attendance));
  }
  if (settings.holidays !== undefined) {
    updates.push(setTypedSetting('holidays', settings.holidays));
  }
  if (settings.appearance !== undefined) {
    updates.push(setTypedSetting('appearance', settings.appearance));
  }
  if (settings.backup !== undefined) {
    updates.push(setTypedSetting('backup', settings.backup));
  }
  if (settings.export !== undefined) {
    updates.push(setTypedSetting('exportSettings', settings.export));
  }

  await Promise.all(updates);
  return getAppSettings();
}

/**
 * Reset settings to defaults
 */
export async function resetToDefaults(): Promise<AppSettings> {
  await Promise.all([
    setTypedSetting('device', DEFAULT_APP_SETTINGS.device),
    setTypedSetting('attendance', DEFAULT_APP_SETTINGS.attendance),
    setTypedSetting('holidays', DEFAULT_APP_SETTINGS.holidays),
    setTypedSetting('appearance', DEFAULT_APP_SETTINGS.appearance),
    setTypedSetting('backup', DEFAULT_APP_SETTINGS.backup),
    setTypedSetting('exportSettings', DEFAULT_APP_SETTINGS.export),
  ]);
  return DEFAULT_APP_SETTINGS;
}

// Export repository object for consistency with other repositories
export const settingsRepository = {
  getSetting,
  setSetting,
  deleteSetting,
  getAllSettings,
  getTypedSetting,
  setTypedSetting,
  getAppSettings,
  updateAppSettings,
  resetToDefaults,
  DEFAULT_ATTENDANCE_RULES,
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_BACKUP_SETTINGS,
  DEFAULT_APP_SETTINGS,
};
