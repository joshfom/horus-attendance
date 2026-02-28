/**
 * Timezone formatting utilities
 * 
 * The ZKTeco device stores timestamps in LOCAL time but our Rust parser
 * appends a 'Z' (UTC) suffix. This means the raw timestamp string like
 * "2026-02-28T15:04:00.000Z" actually represents 3:04 PM local device time,
 * NOT 3:04 PM UTC.
 * 
 * To display correctly we strip the 'Z' and treat the timestamp as a
 * "wall clock" time, then format it in the configured timezone.
 * 
 * Since the device is in the same timezone as the configured app timezone,
 * we simply parse the date/time components directly without UTC conversion.
 */

import type { TimezoneSettings } from '../../types/models';

/** Common timezone list for the settings dropdown */
export const TIMEZONE_OPTIONS = [
  { value: 'Asia/Dubai', label: '(UTC+4) Dubai / Abu Dhabi' },
  { value: 'Asia/Muscat', label: '(UTC+4) Muscat' },
  { value: 'Asia/Riyadh', label: '(UTC+3) Riyadh / Kuwait' },
  { value: 'Asia/Qatar', label: '(UTC+3) Doha' },
  { value: 'Asia/Bahrain', label: '(UTC+3) Bahrain' },
  { value: 'Asia/Kolkata', label: '(UTC+5:30) India' },
  { value: 'Asia/Karachi', label: '(UTC+5) Pakistan' },
  { value: 'Asia/Tehran', label: '(UTC+3:30) Tehran' },
  { value: 'Asia/Baghdad', label: '(UTC+3) Baghdad' },
  { value: 'Africa/Cairo', label: '(UTC+2) Cairo' },
  { value: 'Europe/London', label: '(UTC+0) London' },
  { value: 'Europe/Paris', label: '(UTC+1) Paris / Berlin' },
  { value: 'Europe/Istanbul', label: '(UTC+3) Istanbul' },
  { value: 'America/New_York', label: '(UTC-5) New York' },
  { value: 'America/Chicago', label: '(UTC-6) Chicago' },
  { value: 'America/Los_Angeles', label: '(UTC-8) Los Angeles' },
  { value: 'Asia/Shanghai', label: '(UTC+8) Shanghai / Singapore' },
  { value: 'Asia/Tokyo', label: '(UTC+9) Tokyo' },
  { value: 'Australia/Sydney', label: '(UTC+11) Sydney' },
  { value: 'Pacific/Auckland', label: '(UTC+12) Auckland' },
  { value: 'UTC', label: '(UTC+0) UTC' },
];

/**
 * Format a timestamp string for display using the configured timezone.
 * 
 * The device timestamps have a 'Z' suffix but are actually local time.
 * We strip the Z and format the raw date/time values directly.
 * 
 * @param timestamp - ISO-ish string like "2026-02-28T15:04:00.000Z" or "15:04"
 * @param tzSettings - Timezone settings from app config
 * @param options - What to include in output
 */
export function formatTime(
  timestamp: string | null,
  tzSettings: TimezoneSettings,
  options: { date?: boolean; seconds?: boolean } = {}
): string {
  if (!timestamp) return '';

  // If it's already just a time string like "15:04" or "15:04:00", return as-is
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(timestamp)) {
    const parts = timestamp.split(':');
    const h = parseInt(parts[0]!, 10);
    const m = parts[1]!;
    const s = parts[2];
    if (tzSettings.timeFormat === '12h') {
      const period = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      return options.seconds && s ? `${h12}:${m}:${s} ${period}` : `${h12}:${m} ${period}`;
    }
    return options.seconds && s ? timestamp : `${parts[0]}:${m}`;
  }

  // Strip the Z suffix — the timestamp is actually local device time
  const raw = timestamp.replace(/Z$/, '');
  const dt = new Date(raw);
  if (isNaN(dt.getTime())) return '';

  const h = dt.getHours();
  const m = dt.getMinutes().toString().padStart(2, '0');
  const s = dt.getSeconds().toString().padStart(2, '0');

  let timeStr: string;
  if (tzSettings.timeFormat === '12h') {
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = (h % 12 || 12).toString();
    timeStr = options.seconds ? `${h12}:${m}:${s} ${period}` : `${h12}:${m} ${period}`;
  } else {
    const hh = h.toString().padStart(2, '0');
    timeStr = options.seconds ? `${hh}:${m}:${s}` : `${hh}:${m}`;
  }

  if (options.date) {
    const year = dt.getFullYear();
    const month = (dt.getMonth() + 1).toString().padStart(2, '0');
    const day = dt.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day} ${timeStr}`;
  }

  return timeStr;
}

/**
 * Format time for 24h display (used in reports/exports).
 * Returns HH:mm format.
 */
export function formatTime24(timestamp: string | null): string {
  if (!timestamp) return '';
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(timestamp)) return timestamp.substring(0, 5);
  const raw = timestamp.replace(/Z$/, '');
  const dt = new Date(raw);
  if (isNaN(dt.getTime())) return '';
  const hh = dt.getHours().toString().padStart(2, '0');
  const mm = dt.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Format a full datetime for display (e.g., dashboard "last sync" subtitle)
 */
export function formatDateTime(
  timestamp: string | null,
  tzSettings: TimezoneSettings
): string {
  if (!timestamp) return '';
  return formatTime(timestamp, tzSettings, { date: true, seconds: true });
}

/**
 * Extract the date portion (YYYY-MM-DD) from a device timestamp,
 * treating it as local time (stripping Z).
 */
export function extractLocalDate(timestamp: string): string {
  const raw = timestamp.replace(/Z$/, '');
  return raw.split('T')[0] ?? '';
}
