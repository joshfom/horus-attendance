/**
 * Holiday Repository
 * 
 * Provides CRUD operations for holidays table.
 * Requirements: 11.3
 */

import { execute, select } from '../database';
import type { Holiday, CreateHolidayInput } from '../../types/models';

interface HolidayRow extends Record<string, unknown> {
  id: string;
  date: string;
  name: string | null;
  created_at: string;
}

function rowToHoliday(row: HolidayRow): Holiday {
  return {
    id: row.id,
    date: row.date,
    name: row.name,
    createdAt: row.created_at,
  };
}

/**
 * List all holidays
 */
export async function listHolidays(): Promise<Holiday[]> {
  const rows = await select<HolidayRow>(
    'SELECT id, date, name, created_at FROM holidays ORDER BY date ASC'
  );
  return rows.map(rowToHoliday);
}

/**
 * Get a holiday by ID
 */
export async function getHoliday(id: string): Promise<Holiday | null> {
  const rows = await select<HolidayRow>(
    'SELECT id, date, name, created_at FROM holidays WHERE id = ?',
    [id]
  );
  return rows.length > 0 ? rowToHoliday(rows[0]!) : null;
}

/**
 * Get a holiday by date
 */
export async function getHolidayByDate(date: string): Promise<Holiday | null> {
  const rows = await select<HolidayRow>(
    'SELECT id, date, name, created_at FROM holidays WHERE date = ?',
    [date]
  );
  return rows.length > 0 ? rowToHoliday(rows[0]!) : null;
}

/**
 * Create a new holiday
 */
export async function createHoliday(data: CreateHolidayInput): Promise<Holiday> {
  const id = crypto.randomUUID();
  await execute(
    `INSERT INTO holidays (id, date, name, created_at) 
     VALUES (?, ?, ?, datetime('now'))`,
    [id, data.date, data.name || null]
  );
  const holiday = await getHoliday(id);
  if (!holiday) {
    throw new Error('Failed to create holiday');
  }
  return holiday;
}

/**
 * Update a holiday
 */
export async function updateHoliday(id: string, data: Partial<CreateHolidayInput>): Promise<Holiday> {
  const existing = await getHoliday(id);
  if (!existing) {
    throw new Error('Holiday not found');
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (data.date !== undefined) {
    updates.push('date = ?');
    values.push(data.date);
  }
  if (data.name !== undefined) {
    updates.push('name = ?');
    values.push(data.name || null);
  }

  if (updates.length > 0) {
    values.push(id);
    await execute(
      `UPDATE holidays SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
  }

  const updated = await getHoliday(id);
  if (!updated) {
    throw new Error('Failed to update holiday');
  }
  return updated;
}

/**
 * Delete a holiday
 */
export async function deleteHoliday(id: string): Promise<void> {
  await execute('DELETE FROM holidays WHERE id = ?', [id]);
}

/**
 * Check if a date is a holiday
 */
export async function isHoliday(date: string): Promise<boolean> {
  const rows = await select<{ count: number }>(
    'SELECT COUNT(*) as count FROM holidays WHERE date = ?',
    [date]
  );
  return rows.length > 0 && rows[0]!.count > 0;
}

/**
 * Get holidays in a date range
 */
export async function getHolidaysInRange(startDate: string, endDate: string): Promise<Holiday[]> {
  const rows = await select<HolidayRow>(
    'SELECT id, date, name, created_at FROM holidays WHERE date >= ? AND date <= ? ORDER BY date ASC',
    [startDate, endDate]
  );
  return rows.map(rowToHoliday);
}

// Export repository object for consistency with other repositories
export const holidayRepository = {
  listHolidays,
  getHoliday,
  getHolidayByDate,
  createHoliday,
  updateHoliday,
  deleteHoliday,
  isHoliday,
  getHolidaysInRange,
};
