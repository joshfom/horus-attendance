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
  // Enable WAL mode for concurrent read/write access (prevents "database is locked" errors)
  await db.execute('PRAGMA journal_mode = WAL');
  // Set busy timeout to 30 seconds — retry on lock instead of failing immediately
  // Windows SQLite is more aggressive about locking than macOS
  await db.execute('PRAGMA busy_timeout = 30000');
  // Synchronous NORMAL is safe with WAL and faster than FULL
  await db.execute('PRAGMA synchronous = NORMAL');
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
 * Retries on "database is locked" errors (common on Windows).
 */
export async function execute(
  query: string,
  bindValues?: unknown[]
): Promise<{ rowsAffected: number; lastInsertId?: number }> {
  const database = getDatabase();
  return retryOnLock(() => database.execute(query, bindValues));
}

/**
 * Execute a SQL query that returns results (SELECT).
 */
export async function select<T extends Record<string, unknown>>(
  query: string,
  bindValues?: unknown[]
): Promise<T[]> {
  const database = getDatabase();
  return retryOnLock(() => database.select<T[]>(query, bindValues));
}

/**
 * Retry a database operation if it fails with "database is locked".
 * Uses exponential backoff with jitter.
 */
async function retryOnLock<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const isLocked = msg.includes('database is locked') || msg.includes('(code: 5)');
      if (!isLocked || attempt === maxRetries) {
        throw error;
      }
      // Exponential backoff: 100ms, 200ms, 400ms, 800ms, 1600ms + jitter
      const delay = Math.min(100 * Math.pow(2, attempt), 2000) + Math.random() * 100;
      console.warn(`[database] Locked, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Unreachable');
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
