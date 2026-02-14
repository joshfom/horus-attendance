/**
 * User Repository
 * CRUD operations for users table
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

import { execute, select } from '../database';
import type { User, CreateUserInput, UpdateUserInput, UserFilter, DeviceUser } from '../../types';
import type { UserRow } from '../../types/api';

/**
 * Generate a unique ID for new users
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
 * Map database row to User model
 */
function mapRowToUser(row: UserRow): User {
  return {
    id: row.id,
    deviceUserId: row.device_user_id,
    deviceName: row.device_name,
    displayName: row.display_name,
    departmentId: row.department_id,
    email: row.email,
    phone: row.phone,
    address: row.address,
    employeeCode: row.employee_code,
    notes: row.notes,
    status: row.status as 'active' | 'inactive',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Get a user by ID
 */
export async function getUserById(id: string): Promise<User | null> {
  const rows = await select<Record<string, unknown>>(
    'SELECT * FROM users WHERE id = ?',
    [id]
  );
  if (rows.length === 0) return null;
  return mapRowToUser(rows[0] as unknown as UserRow);
}


/**
 * Get a user by device user ID
 */
export async function getUserByDeviceUserId(deviceUserId: string): Promise<User | null> {
  const rows = await select<Record<string, unknown>>(
    'SELECT * FROM users WHERE device_user_id = ?',
    [deviceUserId]
  );
  if (rows.length === 0) return null;
  return mapRowToUser(rows[0] as unknown as UserRow);
}

/**
 * List users with optional filtering
 */
export async function listUsers(filter?: UserFilter): Promise<User[]> {
  let query = 'SELECT * FROM users WHERE 1=1';
  const params: unknown[] = [];
  
  if (filter) {
    // Filter by status (default excludes inactive unless 'all' is specified)
    if (filter.status === 'all') {
      // No status filter
    } else if (filter.status) {
      query += ' AND status = ?';
      params.push(filter.status);
    } else {
      // Default: only active users
      query += ' AND status = ?';
      params.push('active');
    }
    
    // Filter by department
    if (filter.departmentId) {
      query += ' AND department_id = ?';
      params.push(filter.departmentId);
    }
    
    // Filter by linked status
    if (filter.linkedOnly) {
      query += ' AND device_user_id IS NOT NULL';
    }
    
    // Search filter (name, department, employee code)
    if (filter.search) {
      const searchTerm = `%${filter.search}%`;
      query += ` AND (display_name LIKE ? OR employee_code LIKE ?)`;
      params.push(searchTerm, searchTerm);
    }
  } else {
    // Default: only active users
    query += ' AND status = ?';
    params.push('active');
  }
  
  query += ' ORDER BY display_name ASC';
  
  const rows = await select<Record<string, unknown>>(query, params);
  return rows.map((row) => mapRowToUser(row as unknown as UserRow));
}

/**
 * Search users by name, department, or employee code
 */
export async function searchUsers(query: string): Promise<User[]> {
  const searchTerm = `%${query}%`;
  const rows = await select<Record<string, unknown>>(
    `SELECT u.* FROM users u
     LEFT JOIN departments d ON u.department_id = d.id
     WHERE u.status = 'active' 
       AND (u.display_name LIKE ? OR u.employee_code LIKE ? OR d.name LIKE ?)
     ORDER BY u.display_name ASC`,
    [searchTerm, searchTerm, searchTerm]
  );
  return rows.map((row) => mapRowToUser(row as unknown as UserRow));
}

/**
 * Create a new user
 */
export async function createUser(data: CreateUserInput): Promise<User> {
  const id = generateId();
  const timestamp = now();
  
  await execute(
    `INSERT INTO users (
      id, device_user_id, device_name, display_name, department_id,
      email, phone, address, employee_code, notes, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.deviceUserId || null,
      data.deviceName || null,
      data.displayName,
      data.departmentId || null,
      data.email || null,
      data.phone || null,
      data.address || null,
      data.employeeCode || null,
      data.notes || null,
      data.status || 'active',
      timestamp,
      timestamp,
    ]
  );
  
  const user = await getUserById(id);
  if (!user) {
    throw new Error('Failed to create user');
  }
  return user;
}


/**
 * Update an existing user
 */
export async function updateUser(id: string, data: UpdateUserInput): Promise<User> {
  const existing = await getUserById(id);
  if (!existing) {
    throw new Error(`User not found: ${id}`);
  }
  
  const timestamp = now();
  const fields: string[] = [];
  const values: unknown[] = [];
  
  if (data.displayName !== undefined) {
    fields.push('display_name = ?');
    values.push(data.displayName);
  }
  if (data.departmentId !== undefined) {
    fields.push('department_id = ?');
    values.push(data.departmentId);
  }
  if (data.email !== undefined) {
    fields.push('email = ?');
    values.push(data.email);
  }
  if (data.phone !== undefined) {
    fields.push('phone = ?');
    values.push(data.phone);
  }
  if (data.address !== undefined) {
    fields.push('address = ?');
    values.push(data.address);
  }
  if (data.employeeCode !== undefined) {
    fields.push('employee_code = ?');
    values.push(data.employeeCode);
  }
  if (data.notes !== undefined) {
    fields.push('notes = ?');
    values.push(data.notes);
  }
  if (data.status !== undefined) {
    fields.push('status = ?');
    values.push(data.status);
  }
  
  if (fields.length > 0) {
    fields.push('updated_at = ?');
    values.push(timestamp);
    values.push(id);
    
    await execute(
      `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
  }
  
  const user = await getUserById(id);
  if (!user) {
    throw new Error('Failed to update user');
  }
  return user;
}

/**
 * Link a device user to an app user profile
 */
export async function linkDeviceUser(userId: string, deviceUserId: string): Promise<User> {
  const timestamp = now();
  
  await execute(
    'UPDATE users SET device_user_id = ?, updated_at = ? WHERE id = ?',
    [deviceUserId, timestamp, userId]
  );
  
  const user = await getUserById(userId);
  if (!user) {
    throw new Error('Failed to link device user');
  }
  return user;
}

/**
 * Get unlinked device users (users from device that don't have app profiles)
 */
export async function getUnlinkedDeviceUsers(): Promise<DeviceUser[]> {
  // This would typically query from a separate device_users table
  // For now, return users that have device_user_id but need enrichment
  const rows = await select<Record<string, unknown>>(
    `SELECT device_user_id, device_name, '' as device_id 
     FROM users 
     WHERE device_user_id IS NOT NULL 
       AND (display_name = device_name OR display_name IS NULL OR display_name = '')
     ORDER BY device_name ASC`
  );
  
  return rows.map((row) => ({
    deviceUserId: (row as { device_user_id: string }).device_user_id,
    deviceName: (row as { device_name: string }).device_name || '',
    deviceId: '',
  }));
}

/**
 * Delete a user
 */
export async function deleteUser(id: string): Promise<void> {
  await execute('DELETE FROM users WHERE id = ?', [id]);
}

/**
 * Get count of active users
 */
export async function getActiveUserCount(): Promise<number> {
  const rows = await select<Record<string, unknown>>(
    "SELECT COUNT(*) as count FROM users WHERE status = 'active'"
  );
  return (rows[0] as { count: number }).count;
}

export const userRepository = {
  getUserById,
  getUserByDeviceUserId,
  listUsers,
  searchUsers,
  createUser,
  updateUser,
  linkDeviceUser,
  getUnlinkedDeviceUsers,
  deleteUser,
  getActiveUserCount,
};
