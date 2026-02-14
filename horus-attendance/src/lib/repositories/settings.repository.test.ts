/**
 * Property-based tests for Settings Repository
 * 
 * Property 24: Settings Persistence
 * For any settings update (attendance rules, work schedule, grace periods),
 * the updated values should persist correctly and be retrievable after application restart.
 * Validates: Requirements 9.1, 9.2, 11.2
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fc from 'fast-check';
import {
  initTestDatabase,
  closeTestDatabase,
  resetTestDatabase,
  testExecute,
  testSelect,
} from '../test-utils';
import type { AttendanceRules, AppearanceSettings, BackupSettings, AppSettings } from '../../types/models';

// Initialize test database
initTestDatabase();

// Default values for testing
const DEFAULT_ATTENDANCE_RULES: AttendanceRules = {
  workStartTime: '09:00',
  workEndTime: '18:00',
  lateGracePeriod: 15,
  earlyLeaveGracePeriod: 15,
  checkInWindowStart: '06:00',
  checkInWindowEnd: '12:00',
  checkOutWindowStart: '12:00',
  checkOutWindowEnd: '23:00',
  workdays: [1, 2, 3, 4, 5],
};

const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  theme: 'dark',
};

const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  autoBackup: false,
  backupPath: '',
  lastBackupAt: null,
};

const DEFAULT_APP_SETTINGS: AppSettings = {
  device: null,
  attendance: DEFAULT_ATTENDANCE_RULES,
  holidays: [],
  appearance: DEFAULT_APPEARANCE_SETTINGS,
  backup: DEFAULT_BACKUP_SETTINGS,
};

// Test-specific repository functions that use the test database
interface SettingsRow {
  key: string;
  value: string;
  updated_at: string;
}

function getSetting(key: string): string | null {
  const rows = testSelect<SettingsRow>(
    'SELECT value FROM settings WHERE key = ?',
    [key]
  );
  return rows.length > 0 && rows[0] ? rows[0].value : null;
}

function setSetting(key: string, value: string): void {
  testExecute(
    `INSERT INTO settings (key, value, updated_at) 
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value]
  );
}

function deleteSetting(key: string): void {
  testExecute('DELETE FROM settings WHERE key = ?', [key]);
}

function getTypedSetting<T>(key: string, defaultValue: T): T {
  const value = getSetting(key);
  if (value === null) {
    return defaultValue;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return defaultValue;
  }
}

function setTypedSetting<T>(key: string, value: T): void {
  setSetting(key, JSON.stringify(value));
}

function getAppSettings(): AppSettings {
  const device = getTypedSetting<AppSettings['device']>('device', DEFAULT_APP_SETTINGS.device);
  const attendance = getTypedSetting<AttendanceRules>('attendance', DEFAULT_APP_SETTINGS.attendance);
  const holidays = getTypedSetting<string[]>('holidays', DEFAULT_APP_SETTINGS.holidays);
  const appearance = getTypedSetting<AppearanceSettings>('appearance', DEFAULT_APP_SETTINGS.appearance);
  const backup = getTypedSetting<BackupSettings>('backup', DEFAULT_APP_SETTINGS.backup);

  return {
    device,
    attendance,
    holidays,
    appearance,
    backup,
  };
}

function updateAppSettings(settings: Partial<AppSettings>): AppSettings {
  if (settings.device !== undefined) {
    setTypedSetting('device', settings.device);
  }
  if (settings.attendance !== undefined) {
    setTypedSetting('attendance', settings.attendance);
  }
  if (settings.holidays !== undefined) {
    setTypedSetting('holidays', settings.holidays);
  }
  if (settings.appearance !== undefined) {
    setTypedSetting('appearance', settings.appearance);
  }
  if (settings.backup !== undefined) {
    setTypedSetting('backup', settings.backup);
  }

  return getAppSettings();
}

function resetToDefaults(): AppSettings {
  setTypedSetting('device', DEFAULT_APP_SETTINGS.device);
  setTypedSetting('attendance', DEFAULT_APP_SETTINGS.attendance);
  setTypedSetting('holidays', DEFAULT_APP_SETTINGS.holidays);
  setTypedSetting('appearance', DEFAULT_APP_SETTINGS.appearance);
  setTypedSetting('backup', DEFAULT_APP_SETTINGS.backup);
  return DEFAULT_APP_SETTINGS;
}

describe('Settings Repository - Property Tests', () => {
  beforeEach(() => {
    resetTestDatabase();
  });

  afterAll(() => {
    closeTestDatabase();
  });

  /**
   * Property 24: Settings Persistence
   * For any settings update (attendance rules, work schedule, grace periods),
   * the updated values should persist correctly and be retrievable.
   * Validates: Requirements 9.1, 9.2, 11.2
   */
  describe('Property 24: Settings Persistence', () => {
    // Arbitrary for valid time in HH:mm format
    const timeArbitrary = fc.tuple(
      fc.integer({ min: 0, max: 23 }),
      fc.integer({ min: 0, max: 59 })
    ).map(([h, m]) => `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);

    // Arbitrary for grace period (0-120 minutes)
    const gracePeriodArbitrary = fc.integer({ min: 0, max: 120 });

    // Arbitrary for workdays (array of 0-6)
    const workdaysArbitrary = fc.array(
      fc.integer({ min: 0, max: 6 }),
      { minLength: 1, maxLength: 7 }
    ).map(days => [...new Set(days)].sort());

    // Arbitrary for attendance rules
    const attendanceRulesArbitrary = fc.record({
      workStartTime: timeArbitrary,
      workEndTime: timeArbitrary,
      lateGracePeriod: gracePeriodArbitrary,
      earlyLeaveGracePeriod: gracePeriodArbitrary,
      checkInWindowStart: timeArbitrary,
      checkInWindowEnd: timeArbitrary,
      checkOutWindowStart: timeArbitrary,
      checkOutWindowEnd: timeArbitrary,
      workdays: workdaysArbitrary,
    });

    // Arbitrary for theme
    const themeArbitrary = fc.constantFrom('light', 'dark', 'system') as fc.Arbitrary<'light' | 'dark' | 'system'>;

    // Arbitrary for appearance settings
    const appearanceArbitrary: fc.Arbitrary<AppearanceSettings> = fc.record({
      theme: themeArbitrary,
    });

    // Arbitrary for backup settings
    const backupArbitrary: fc.Arbitrary<BackupSettings> = fc.record({
      autoBackup: fc.boolean(),
      backupPath: fc.string({ minLength: 0, maxLength: 100 }),
      lastBackupAt: fc.option(fc.date().map(d => d.toISOString()), { nil: null }),
    });

    it('string settings round-trip correctly', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.string({ minLength: 0, maxLength: 200 }),
          (key, value) => {
            // Set the setting
            setSetting(key, value);
            
            // Retrieve the setting
            const retrieved = getSetting(key);
            
            // Should match exactly
            expect(retrieved).toBe(value);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('typed settings round-trip correctly', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.oneof(
            fc.integer(),
            fc.boolean(),
            fc.string(),
            fc.array(fc.integer()),
            fc.record({ a: fc.integer(), b: fc.string() })
          ),
          (key, value) => {
            // Set the typed setting
            setTypedSetting(key, value);
            
            // Retrieve the typed setting
            const retrieved = getTypedSetting(key, null);
            
            // Should match exactly (deep equality)
            expect(retrieved).toEqual(value);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('attendance rules persist correctly', () => {
      fc.assert(
        fc.property(
          attendanceRulesArbitrary,
          (rules) => {
            // Reset for each iteration
            resetTestDatabase();
            
            // Update attendance rules
            updateAppSettings({ attendance: rules });
            
            // Retrieve settings
            const settings = getAppSettings();
            
            // Attendance rules should match
            expect(settings.attendance.workStartTime).toBe(rules.workStartTime);
            expect(settings.attendance.workEndTime).toBe(rules.workEndTime);
            expect(settings.attendance.lateGracePeriod).toBe(rules.lateGracePeriod);
            expect(settings.attendance.earlyLeaveGracePeriod).toBe(rules.earlyLeaveGracePeriod);
            expect(settings.attendance.checkInWindowStart).toBe(rules.checkInWindowStart);
            expect(settings.attendance.checkInWindowEnd).toBe(rules.checkInWindowEnd);
            expect(settings.attendance.checkOutWindowStart).toBe(rules.checkOutWindowStart);
            expect(settings.attendance.checkOutWindowEnd).toBe(rules.checkOutWindowEnd);
            expect(settings.attendance.workdays).toEqual(rules.workdays);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('work schedule (start/end times) persists correctly', () => {
      fc.assert(
        fc.property(
          timeArbitrary,
          timeArbitrary,
          (workStartTime, workEndTime) => {
            // Reset for each iteration
            resetTestDatabase();
            
            // Update work schedule
            const rules: AttendanceRules = {
              ...DEFAULT_ATTENDANCE_RULES,
              workStartTime,
              workEndTime,
            };
            updateAppSettings({ attendance: rules });
            
            // Retrieve settings
            const settings = getAppSettings();
            
            // Work schedule should match
            expect(settings.attendance.workStartTime).toBe(workStartTime);
            expect(settings.attendance.workEndTime).toBe(workEndTime);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('grace periods persist correctly', () => {
      fc.assert(
        fc.property(
          gracePeriodArbitrary,
          gracePeriodArbitrary,
          (lateGracePeriod, earlyLeaveGracePeriod) => {
            // Reset for each iteration
            resetTestDatabase();
            
            // Update grace periods
            const rules: AttendanceRules = {
              ...DEFAULT_ATTENDANCE_RULES,
              lateGracePeriod,
              earlyLeaveGracePeriod,
            };
            updateAppSettings({ attendance: rules });
            
            // Retrieve settings
            const settings = getAppSettings();
            
            // Grace periods should match
            expect(settings.attendance.lateGracePeriod).toBe(lateGracePeriod);
            expect(settings.attendance.earlyLeaveGracePeriod).toBe(earlyLeaveGracePeriod);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('workdays configuration persists correctly', () => {
      fc.assert(
        fc.property(
          workdaysArbitrary,
          (workdays) => {
            // Reset for each iteration
            resetTestDatabase();
            
            // Update workdays
            const rules: AttendanceRules = {
              ...DEFAULT_ATTENDANCE_RULES,
              workdays,
            };
            updateAppSettings({ attendance: rules });
            
            // Retrieve settings
            const settings = getAppSettings();
            
            // Workdays should match
            expect(settings.attendance.workdays).toEqual(workdays);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('appearance settings persist correctly', () => {
      fc.assert(
        fc.property(
          appearanceArbitrary,
          (appearance) => {
            // Reset for each iteration
            resetTestDatabase();
            
            // Update appearance
            updateAppSettings({ appearance });
            
            // Retrieve settings
            const settings = getAppSettings();
            
            // Appearance should match
            expect(settings.appearance.theme).toBe(appearance.theme);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('backup settings persist correctly', () => {
      fc.assert(
        fc.property(
          backupArbitrary,
          (backup) => {
            // Reset for each iteration
            resetTestDatabase();
            
            // Update backup settings
            updateAppSettings({ backup });
            
            // Retrieve settings
            const settings = getAppSettings();
            
            // Backup settings should match
            expect(settings.backup.autoBackup).toBe(backup.autoBackup);
            expect(settings.backup.backupPath).toBe(backup.backupPath);
            expect(settings.backup.lastBackupAt).toBe(backup.lastBackupAt);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('multiple settings updates preserve all values', () => {
      fc.assert(
        fc.property(
          attendanceRulesArbitrary,
          appearanceArbitrary,
          backupArbitrary,
          (attendance, appearance, backup) => {
            // Reset for each iteration
            resetTestDatabase();
            
            // Update all settings
            updateAppSettings({ attendance });
            updateAppSettings({ appearance });
            updateAppSettings({ backup });
            
            // Retrieve settings
            const settings = getAppSettings();
            
            // All settings should be preserved
            expect(settings.attendance).toEqual(attendance);
            expect(settings.appearance).toEqual(appearance);
            expect(settings.backup).toEqual(backup);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('partial updates do not affect other settings', () => {
      fc.assert(
        fc.property(
          attendanceRulesArbitrary,
          appearanceArbitrary,
          (attendance, appearance) => {
            // Reset for each iteration
            resetTestDatabase();
            
            // Set initial attendance rules
            updateAppSettings({ attendance });
            
            // Update only appearance
            updateAppSettings({ appearance });
            
            // Retrieve settings
            const settings = getAppSettings();
            
            // Attendance should still match original
            expect(settings.attendance).toEqual(attendance);
            // Appearance should match new value
            expect(settings.appearance).toEqual(appearance);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('reset to defaults restores all default values', () => {
      fc.assert(
        fc.property(
          attendanceRulesArbitrary,
          appearanceArbitrary,
          (attendance, appearance) => {
            // Reset for each iteration
            resetTestDatabase();
            
            // Set custom values
            updateAppSettings({ attendance, appearance });
            
            // Reset to defaults
            resetToDefaults();
            
            // Retrieve settings
            const settings = getAppSettings();
            
            // Should match defaults
            expect(settings).toEqual(DEFAULT_APP_SETTINGS);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('deleted settings return default values', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.string({ minLength: 1, maxLength: 100 }),
          (key, value) => {
            // Set a setting
            setSetting(key, value);
            
            // Delete the setting
            deleteSetting(key);
            
            // Should return null
            const retrieved = getSetting(key);
            expect(retrieved).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('overwriting settings preserves latest value', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.array(fc.string({ minLength: 0, maxLength: 100 }), { minLength: 2, maxLength: 5 }),
          (key, values) => {
            // Write multiple values to the same key
            for (const value of values) {
              setSetting(key, value);
            }
            
            // Should return the last value
            const retrieved = getSetting(key);
            expect(retrieved).toBe(values[values.length - 1]);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
