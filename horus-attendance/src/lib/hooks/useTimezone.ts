/**
 * Hook to load and cache timezone settings from the database.
 * Returns the current TimezoneSettings (defaults to Asia/Dubai, 24h).
 */

import { useState, useEffect } from 'react';
import type { TimezoneSettings } from '../../types/models';
import { getTypedSetting, DEFAULT_TIMEZONE_SETTINGS } from '../repositories/settings.repository';

let cachedSettings: TimezoneSettings | null = null;

export function useTimezone(): TimezoneSettings {
  const [tz, setTz] = useState<TimezoneSettings>(cachedSettings ?? DEFAULT_TIMEZONE_SETTINGS);

  useEffect(() => {
    if (cachedSettings) return;
    getTypedSetting<TimezoneSettings>('timezone', DEFAULT_TIMEZONE_SETTINGS).then(s => {
      cachedSettings = s;
      setTz(s);
    });
  }, []);

  return tz;
}

/** Call this after saving timezone settings to bust the cache */
export function invalidateTimezoneCache(): void {
  cachedSettings = null;
}
