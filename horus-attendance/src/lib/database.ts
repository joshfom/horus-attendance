import Database from '@tauri-apps/plugin-sql';

let db: Database | null = null;

/**
 * Initialize the database connection.
 * The migrations are handled by the Rust backend on app startup.
 */
export async function initDatabase(): Promise<Database> {
  if (db) {
    return db;
  }
  
  db = await Database.load('sqlite:horus_attendance.db');
  // Enable foreign key enforcement (SQLite has it off by default)
  await db.execute('PRAGMA foreign_keys = ON');
  return db;
}

/**
 * Get the database instance.
 * Throws if database is not initialized.
 */
export function getDatabase(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Close the database connection.
 */
export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.close();
    db = null;
  }
}

/**
 * Execute a SQL query that doesn't return results (INSERT, UPDATE, DELETE).
 */
export async function execute(
  query: string,
  bindValues?: unknown[]
): Promise<{ rowsAffected: number; lastInsertId?: number }> {
  const database = getDatabase();
  return database.execute(query, bindValues);
}

/**
 * Execute a SQL query that returns results (SELECT).
 */
export async function select<T extends Record<string, unknown>>(
  query: string,
  bindValues?: unknown[]
): Promise<T[]> {
  const database = getDatabase();
  return database.select<T[]>(query, bindValues);
}

/**
 * Flush all data from the database tables.
 * This deletes all records but keeps the schema intact.
 */
export async function flushDatabase(): Promise<void> {
  const database = getDatabase();
  
  // Delete in order to respect foreign key constraints
  await database.execute('DELETE FROM attendance_day_summary');
  await database.execute('DELETE FROM attendance_logs_raw');
  await database.execute('DELETE FROM users');
  await database.execute('DELETE FROM departments');
  await database.execute('DELETE FROM devices');
  await database.execute('DELETE FROM holidays');
  await database.execute('DELETE FROM settings');
  
  console.log('Database flushed successfully');
}

export { Database };
