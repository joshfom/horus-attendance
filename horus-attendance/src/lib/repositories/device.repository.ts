/**
 * Device Repository
 * CRUD operations for devices table
 * Requirements: 1.4, 1.5
 */

import { execute, select } from '../database';
import type { Device, DeviceConfig, DeviceRepository } from '../../types';
import type { DeviceRow } from '../../types/api';

/**
 * Generate a unique ID for new devices
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Get current ISO timestamp
 */
function now(): string {
  return new Date().toISOString();
}

/**
 * Map database row to Device model
 */
function mapRowToDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    name: row.name,
    ip: row.ip,
    port: row.port,
    commKey: row.comm_key,
    timezone: row.timezone,
    syncMode: row.sync_mode as 'auto' | 'manual',
    lastSyncAt: row.last_sync_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Get a device by ID
 */
export async function getDeviceById(id: string): Promise<Device | null> {
  const rows = await select<Record<string, unknown>>(
    'SELECT * FROM devices WHERE id = ?',
    [id]
  );
  if (rows.length === 0) return null;
  return mapRowToDevice(rows[0] as unknown as DeviceRow);
}

/**
 * List all devices
 */
export async function listDevices(): Promise<Device[]> {
  const rows = await select<Record<string, unknown>>(
    'SELECT * FROM devices ORDER BY name ASC'
  );
  return rows.map((row) => mapRowToDevice(row as unknown as DeviceRow));
}


/**
 * Save a new device or update existing one
 */
export async function saveDevice(config: DeviceConfig): Promise<Device> {
  const timestamp = now();
  const id = config.id || generateId();
  
  // Check if device exists
  const existing = await getDeviceById(id);
  
  if (existing) {
    // Update existing device
    await execute(
      `UPDATE devices SET 
        name = ?, ip = ?, port = ?, comm_key = ?, 
        timezone = ?, sync_mode = ?, updated_at = ?
       WHERE id = ?`,
      [
        config.name,
        config.ip,
        config.port,
        config.commKey,
        config.timezone,
        config.syncMode,
        timestamp,
        id,
      ]
    );
  } else {
    // Insert new device
    await execute(
      `INSERT INTO devices (id, name, ip, port, comm_key, timezone, sync_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        config.name,
        config.ip,
        config.port,
        config.commKey,
        config.timezone,
        config.syncMode,
        timestamp,
        timestamp,
      ]
    );
  }
  
  const device = await getDeviceById(id);
  if (!device) {
    throw new Error('Failed to save device');
  }
  return device;
}

/**
 * Update an existing device
 */
export async function updateDevice(
  id: string,
  updates: Partial<DeviceConfig>
): Promise<Device> {
  const existing = await getDeviceById(id);
  if (!existing) {
    throw new Error(`Device not found: ${id}`);
  }
  
  const timestamp = now();
  const fields: string[] = [];
  const values: unknown[] = [];
  
  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.ip !== undefined) {
    fields.push('ip = ?');
    values.push(updates.ip);
  }
  if (updates.port !== undefined) {
    fields.push('port = ?');
    values.push(updates.port);
  }
  if (updates.commKey !== undefined) {
    fields.push('comm_key = ?');
    values.push(updates.commKey);
  }
  if (updates.timezone !== undefined) {
    fields.push('timezone = ?');
    values.push(updates.timezone);
  }
  if (updates.syncMode !== undefined) {
    fields.push('sync_mode = ?');
    values.push(updates.syncMode);
  }
  
  if (fields.length > 0) {
    fields.push('updated_at = ?');
    values.push(timestamp);
    values.push(id);
    
    await execute(
      `UPDATE devices SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
  }
  
  const device = await getDeviceById(id);
  if (!device) {
    throw new Error('Failed to update device');
  }
  return device;
}

/**
 * Delete a device by ID
 */
export async function deleteDevice(id: string): Promise<void> {
  await execute('DELETE FROM devices WHERE id = ?', [id]);
}

/**
 * Update the last sync timestamp for a device
 */
export async function updateLastSyncAt(id: string, syncedAt: string): Promise<void> {
  await execute(
    'UPDATE devices SET last_sync_at = ?, updated_at = ? WHERE id = ?',
    [syncedAt, now(), id]
  );
}

/**
 * Device repository implementation
 */
export const deviceRepository: DeviceRepository = {
  getDeviceById,
  listDevices,
  saveDevice,
  updateDevice,
  deleteDevice,
  updateLastSyncAt,
};
