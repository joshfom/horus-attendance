/**
 * Department Repository
 * CRUD operations for departments table
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */

import { execute, select } from '../database';
import type { Department, CreateDepartmentInput, UpdateDepartmentInput, User } from '../../types';
import type { DepartmentRow, UserRow } from '../../types/api';

/**
 * Generate a unique ID for new departments
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
 * Map database row to Department model
 */
function mapRowToDepartment(row: DepartmentRow): Department {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    memberCount: row.member_count ?? 0,
  };
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
 * Get a department by ID
 */
export async function getDepartmentById(id: string): Promise<Department | null> {
  const rows = await select<Record<string, unknown>>(
    `SELECT d.*, COUNT(u.id) as member_count 
     FROM departments d 
     LEFT JOIN users u ON u.department_id = d.id 
     WHERE d.id = ? 
     GROUP BY d.id`,
    [id]
  );
  if (rows.length === 0) return null;
  return mapRowToDepartment(rows[0] as unknown as DepartmentRow);
}

/**
 * Get a department by name
 */
export async function getDepartmentByName(name: string): Promise<Department | null> {
  const rows = await select<Record<string, unknown>>(
    `SELECT d.*, COUNT(u.id) as member_count 
     FROM departments d 
     LEFT JOIN users u ON u.department_id = d.id 
     WHERE d.name = ? 
     GROUP BY d.id`,
    [name]
  );
  if (rows.length === 0) return null;
  return mapRowToDepartment(rows[0] as unknown as DepartmentRow);
}

/**
 * List all departments with member counts
 */
export async function listDepartments(): Promise<Department[]> {
  const rows = await select<Record<string, unknown>>(
    `SELECT d.*, COUNT(u.id) as member_count 
     FROM departments d 
     LEFT JOIN users u ON u.department_id = d.id 
     GROUP BY d.id 
     ORDER BY d.name ASC`
  );
  return rows.map((row) => mapRowToDepartment(row as unknown as DepartmentRow));
}

/**
 * Create a new department
 * Throws error if name already exists (unique constraint)
 */
export async function createDepartment(data: CreateDepartmentInput): Promise<Department> {
  const id = generateId();
  const timestamp = now();
  
  try {
    await execute(
      'INSERT INTO departments (id, name, created_at) VALUES (?, ?, ?)',
      [id, data.name, timestamp]
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      throw new Error(`Department with name "${data.name}" already exists`);
    }
    throw error;
  }
  
  const department = await getDepartmentById(id);
  if (!department) {
    throw new Error('Failed to create department');
  }
  return department;
}

/**
 * Update an existing department
 */
export async function updateDepartment(
  id: string,
  data: UpdateDepartmentInput
): Promise<Department> {
  const existing = await getDepartmentById(id);
  if (!existing) {
    throw new Error(`Department not found: ${id}`);
  }
  
  try {
    await execute(
      'UPDATE departments SET name = ? WHERE id = ?',
      [data.name, id]
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      throw new Error(`Department with name "${data.name}" already exists`);
    }
    throw error;
  }
  
  const department = await getDepartmentById(id);
  if (!department) {
    throw new Error('Failed to update department');
  }
  return department;
}

/**
 * Delete a department
 * Users in this department will have their department_id set to null (ON DELETE SET NULL)
 */
export async function deleteDepartment(id: string): Promise<void> {
  await execute('DELETE FROM departments WHERE id = ?', [id]);
}

/**
 * Get all users in a department
 */
export async function getDepartmentMembers(id: string): Promise<User[]> {
  const rows = await select<Record<string, unknown>>(
    'SELECT * FROM users WHERE department_id = ? ORDER BY display_name ASC',
    [id]
  );
  return rows.map((row) => mapRowToUser(row as unknown as UserRow));
}

/**
 * Get department with member count
 */
export async function getDepartmentWithMemberCount(id: string): Promise<Department | null> {
  return getDepartmentById(id);
}

export const departmentRepository = {
  getDepartmentById,
  getDepartmentByName,
  listDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getDepartmentMembers,
  getDepartmentWithMemberCount,
};
