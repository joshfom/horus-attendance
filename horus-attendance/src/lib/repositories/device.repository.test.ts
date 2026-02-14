/**
 * Property-based tests for Device Repository
 * Property 1: Device Configuration Round-Trip
 * Validates: Requirements 1.4, 1.5
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
import type { DeviceConfig, Device } from '../../types';
import type { DeviceRow } from '../../types/api';

// Initialize test database
initTestDatabase();

// Test-specific repository functions that use the test database
function generateId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

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

function getDeviceById(id: string): Device | null {
  const rows = testSelect<DeviceRow>('SELECT * FROM devices WHERE id = ?', [id]);
  return rows.length > 0 ? mapRowToDevice(rows[0]) : null;
}

function listDevices(): Device[] {
  const rows = testSelect<DeviceRow>('SELECT * FROM devices ORDER BY name ASC');
  return rows.map(mapRowToDevice);
}


function saveDevice(config: DeviceConfig): Device {
  const timestamp = now();
  const id = config.id || generateId();
  
  const existing = getDeviceById(id);
  
  if (existing) {
    testExecute(
      `UPDATE devices SET 
        name = ?, ip = ?, port = ?, comm_key = ?, 
        timezone = ?, sync_mode = ?, updated_at = ?
       WHERE id = ?`,
      [config.name, config.ip, config.port, config.commKey, config.timezone, config.syncMode, timestamp, id]
    );
  } else {
    testExecute(
      `INSERT INTO devices (id, name, ip, port, comm_key, timezone, sync_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, config.name, config.ip, config.port, config.commKey, config.timezone, config.syncMode, timestamp, timestamp]
    );
  }
  
  const device = getDeviceById(id);
  if (!device) throw new Error('Failed to save device');
  return device;
}

function deleteDevice(id: string): void {
  testExecute('DELETE FROM devices WHERE id = ?', [id]);
}

// Arbitraries for property-based testing
const ipArbitrary = fc.tuple(
  fc.integer({ min: 1, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 1, max: 254 })
).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

const portArbitrary = fc.integer({ min: 1, max: 65535 });

const syncModeArbitrary = fc.constantFrom('auto' as const, 'manual' as const);

const timezoneArbitrary = fc.constantFrom(
  'UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo', 'Australia/Sydney'
);

const deviceConfigArbitrary = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
  ip: ipArbitrary,
  port: portArbitrary,
  commKey: fc.string({ minLength: 0, maxLength: 50 }),
  timezone: timezoneArbitrary,
  syncMode: syncModeArbitrary,
});

describe('Device Repository', () => {
  beforeEach(() => {
    resetTestDatabase();
  });

  afterAll(() => {
    closeTestDatabase();
  });

  /**
   * Property 1: Device Configuration Round-Trip
   * For any valid device configuration, saving it to the database and then
   * retrieving it should return an equivalent configuration object.
   * Validates: Requirements 1.4, 1.5
   */
  it('Property 1: Device Configuration Round-Trip', () => {
    fc.assert(
      fc.property(deviceConfigArbitrary, (config) => {
        // Save the device
        const saved = saveDevice(config);
        
        // Retrieve the device
        const retrieved = getDeviceById(config.id);
        
        // Verify round-trip equivalence
        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(config.id);
        expect(retrieved!.name).toBe(config.name);
        expect(retrieved!.ip).toBe(config.ip);
        expect(retrieved!.port).toBe(config.port);
        expect(retrieved!.commKey).toBe(config.commKey);
        expect(retrieved!.timezone).toBe(config.timezone);
        expect(retrieved!.syncMode).toBe(config.syncMode);
        
        // Verify saved device matches retrieved
        expect(saved.id).toBe(retrieved!.id);
        expect(saved.name).toBe(retrieved!.name);
      }),
      { numRuns: 100 }
    );
  });

  it('listDevices returns all saved devices', () => {
    fc.assert(
      fc.property(
        fc.array(deviceConfigArbitrary, { minLength: 1, maxLength: 10 }),
        (configs) => {
          // Reset database for each iteration
          resetTestDatabase();
          
          // Ensure unique IDs
          const uniqueConfigs = configs.filter(
            (c, i, arr) => arr.findIndex(x => x.id === c.id) === i
          );
          
          // Save all devices
          uniqueConfigs.forEach(config => saveDevice(config));
          
          // List all devices
          const devices = listDevices();
          
          // Verify all saved devices are returned
          expect(devices.length).toBe(uniqueConfigs.length);
          uniqueConfigs.forEach(config => {
            const found = devices.find(d => d.id === config.id);
            expect(found).toBeDefined();
          });
        }
      ),
      { numRuns: 50 }
    );
  });

  it('deleteDevice removes the device', () => {
    fc.assert(
      fc.property(deviceConfigArbitrary, (config) => {
        // Save the device
        saveDevice(config);
        
        // Verify it exists
        expect(getDeviceById(config.id)).not.toBeNull();
        
        // Delete the device
        deleteDevice(config.id);
        
        // Verify it's gone
        expect(getDeviceById(config.id)).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it('saveDevice updates existing device', () => {
    fc.assert(
      fc.property(
        deviceConfigArbitrary,
        deviceConfigArbitrary,
        (config1, config2) => {
          // Use same ID for both configs
          const id = config1.id;
          const updatedConfig = { ...config2, id };
          
          // Save initial config
          saveDevice(config1);
          
          // Update with new config
          saveDevice(updatedConfig);
          
          // Retrieve and verify update
          const retrieved = getDeviceById(id);
          expect(retrieved).not.toBeNull();
          expect(retrieved!.name).toBe(config2.name);
          expect(retrieved!.ip).toBe(config2.ip);
          expect(retrieved!.port).toBe(config2.port);
          
          // Verify only one device exists with this ID
          const allDevices = listDevices();
          const matchingDevices = allDevices.filter(d => d.id === id);
          expect(matchingDevices.length).toBe(1);
        }
      ),
      { numRuns: 50 }
    );
  });
});
