/**
 * Test database utilities using better-sqlite3
 * This provides an in-memory SQLite database for testing repositories
 */

import BetterSqlite3 from 'better-sqlite3';

let testDb: BetterSqlite3.Database | null = null;

const SCHEMA = `
-- Devices table for storing ZKTeco device configurations
CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    ip TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 4370,
    comm_key TEXT DEFAULT '',
    timezone TEXT DEFAULT 'UTC',
    sync_mode TEXT DEFAULT 'manual' CHECK (sync_mode IN ('auto', 'manual')),
    last_sync_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Departments table for organizational units
CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Users table with enriched profile data
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    device_user_id TEXT UNIQUE,
    device_name TEXT,
    display_name TEXT NOT NULL,
    department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    employee_code TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);


-- Raw attendance logs from device
CREATE TABLE IF NOT EXISTS attendance_logs_raw (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    device_user_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    verify_type INTEGER,
    punch_type INTEGER,
    raw_payload TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(device_id, device_user_id, timestamp)
);

-- Daily attendance summaries (computed from raw logs)
CREATE TABLE IF NOT EXISTS attendance_day_summary (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    check_in_time TEXT,
    check_out_time TEXT,
    is_incomplete INTEGER NOT NULL DEFAULT 0,
    late_minutes INTEGER NOT NULL DEFAULT 0,
    early_minutes INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'absent',
    flags TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, date)
);

-- Application settings key-value store
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Holidays table
CREATE TABLE IF NOT EXISTS holidays (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL UNIQUE,
    name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_device_user_id ON users(device_user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_timestamp ON attendance_logs_raw(timestamp);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_device_user ON attendance_logs_raw(device_user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_summary_date ON attendance_day_summary(date);
CREATE INDEX IF NOT EXISTS idx_attendance_summary_user_date ON attendance_day_summary(user_id, date);
`;

/**
 * Initialize an in-memory test database
 */
export function initTestDatabase(): BetterSqlite3.Database {
  if (testDb) {
    return testDb;
  }
  testDb = new BetterSqlite3(':memory:');
  testDb.exec(SCHEMA);
  return testDb;
}

/**
 * Get the test database instance
 */
export function getTestDatabase(): BetterSqlite3.Database {
  if (!testDb) {
    throw new Error('Test database not initialized. Call initTestDatabase() first.');
  }
  return testDb;
}

/**
 * Close and reset the test database
 */
export function closeTestDatabase(): void {
  if (testDb) {
    testDb.close();
    testDb = null;
  }
}

/**
 * Reset the test database (clear all data but keep schema)
 */
export function resetTestDatabase(): void {
  if (testDb) {
    testDb.exec(`
      DELETE FROM attendance_day_summary;
      DELETE FROM attendance_logs_raw;
      DELETE FROM users;
      DELETE FROM departments;
      DELETE FROM devices;
      DELETE FROM settings;
      DELETE FROM holidays;
    `);
  }
}

/**
 * Execute a SQL query that doesn't return results
 */
export function testExecute(
  query: string,
  bindValues?: unknown[]
): { rowsAffected: number; lastInsertId?: number } {
  const db = getTestDatabase();
  const stmt = db.prepare(query);
  const result = stmt.run(...(bindValues || []));
  return {
    rowsAffected: result.changes,
    lastInsertId: result.lastInsertRowid as number,
  };
}

/**
 * Execute a SQL query that returns results
 */
export function testSelect<T>(query: string, bindValues?: unknown[]): T[] {
  const db = getTestDatabase();
  const stmt = db.prepare(query);
  return stmt.all(...(bindValues || [])) as T[];
}
