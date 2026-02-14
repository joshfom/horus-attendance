/**
 * Property-based tests for Department Repository
 * Property 7: Department CRUD with Member Counts
 * Validates: Requirements 4.1, 4.2, 4.3
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
import type { Department, CreateDepartmentInput, User } from '../../types';
import type { DepartmentRow, UserRow } from '../../types/api';

// Initialize test database
initTestDatabase();

// Test-specific repository functions
function generateId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function mapRowToDepartment(row: DepartmentRow): Department {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    memberCount: row.member_count,
  };
}

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


function getDepartmentById(id: string): Department | null {
  const rows = testSelect<DepartmentRow>(
    `SELECT d.*, COUNT(u.id) as member_count 
     FROM departments d 
     LEFT JOIN users u ON u.department_id = d.id 
     WHERE d.id = ? 
     GROUP BY d.id`,
    [id]
  );
  return rows.length > 0 ? mapRowToDepartment(rows[0]) : null;
}

function getDepartmentByName(name: string): Department | null {
  const rows = testSelect<DepartmentRow>(
    `SELECT d.*, COUNT(u.id) as member_count 
     FROM departments d 
     LEFT JOIN users u ON u.department_id = d.id 
     WHERE d.name = ? 
     GROUP BY d.id`,
    [name]
  );
  return rows.length > 0 ? mapRowToDepartment(rows[0]) : null;
}

function listDepartments(): Department[] {
  const rows = testSelect<DepartmentRow>(
    `SELECT d.*, COUNT(u.id) as member_count 
     FROM departments d 
     LEFT JOIN users u ON u.department_id = d.id 
     GROUP BY d.id 
     ORDER BY d.name ASC`
  );
  return rows.map(mapRowToDepartment);
}

function createDepartment(data: CreateDepartmentInput): Department {
  const id = generateId();
  const timestamp = now();
  
  testExecute(
    'INSERT INTO departments (id, name, created_at) VALUES (?, ?, ?)',
    [id, data.name, timestamp]
  );
  
  const department = getDepartmentById(id);
  if (!department) throw new Error('Failed to create department');
  return department;
}

function updateDepartment(id: string, name: string): Department {
  testExecute('UPDATE departments SET name = ? WHERE id = ?', [name, id]);
  const department = getDepartmentById(id);
  if (!department) throw new Error('Failed to update department');
  return department;
}

function deleteDepartment(id: string): void {
  testExecute('DELETE FROM departments WHERE id = ?', [id]);
}

function createUser(displayName: string, departmentId: string | null): User {
  const id = generateId();
  const timestamp = now();
  testExecute(
    `INSERT INTO users (id, display_name, department_id, status, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?)`,
    [id, displayName, departmentId, timestamp, timestamp]
  );
  const rows = testSelect<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
  return mapRowToUser(rows[0]);
}

function getUserById(id: string): User | null {
  const rows = testSelect<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
  return rows.length > 0 ? mapRowToUser(rows[0]) : null;
}

// Arbitraries
const departmentNameArbitrary = fc.string({ minLength: 1, maxLength: 100 })
  .filter(s => s.trim().length > 0);

const userNameArbitrary = fc.string({ minLength: 1, maxLength: 100 })
  .filter(s => s.trim().length > 0);

describe('Department Repository', () => {
  beforeEach(() => {
    resetTestDatabase();
  });

  afterAll(() => {
    closeTestDatabase();
  });

  /**
   * Property 7: Department CRUD with Member Counts
   * For any department, the member count should equal the number of users with that department_id.
   * For any department name, creating a department with a duplicate name should be rejected.
   * Validates: Requirements 4.1, 4.2, 4.3
   */
  it('Property 7: Department member count equals users with that department_id', () => {
    fc.assert(
      fc.property(
        departmentNameArbitrary,
        fc.array(userNameArbitrary, { minLength: 0, maxLength: 10 }),
        (deptName, userNames) => {
          resetTestDatabase();
          
          // Create department
          const dept = createDepartment({ name: deptName });
          
          // Create users in this department
          userNames.forEach(name => createUser(name, dept.id));
          
          // Get department with member count
          const retrieved = getDepartmentById(dept.id);
          
          expect(retrieved).not.toBeNull();
          expect(retrieved!.memberCount).toBe(userNames.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Creating department with duplicate name throws error', () => {
    fc.assert(
      fc.property(departmentNameArbitrary, (name) => {
        resetTestDatabase();
        
        // Create first department
        createDepartment({ name });
        
        // Attempt to create duplicate should throw
        expect(() => createDepartment({ name })).toThrow();
      }),
      { numRuns: 50 }
    );
  });

  it('Department CRUD operations work correctly', () => {
    fc.assert(
      fc.property(
        departmentNameArbitrary,
        departmentNameArbitrary.filter(n => n !== ''),
        (name1, name2) => {
          resetTestDatabase();
          
          // Create
          const created = createDepartment({ name: name1 });
          expect(created.name).toBe(name1);
          expect(created.memberCount).toBe(0);
          
          // Read
          const read = getDepartmentById(created.id);
          expect(read).not.toBeNull();
          expect(read!.name).toBe(name1);
          
          // Update (only if names are different)
          if (name1 !== name2) {
            const updated = updateDepartment(created.id, name2);
            expect(updated.name).toBe(name2);
          }
          
          // Delete
          deleteDepartment(created.id);
          expect(getDepartmentById(created.id)).toBeNull();
        }
      ),
      { numRuns: 50 }
    );
  });

  it('listDepartments returns all departments with correct member counts', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: departmentNameArbitrary,
            userCount: fc.integer({ min: 0, max: 5 }),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (deptConfigs) => {
          resetTestDatabase();
          
          // Ensure unique names
          const uniqueConfigs = deptConfigs.filter(
            (c, i, arr) => arr.findIndex(x => x.name === c.name) === i
          );
          
          // Create departments and users
          const createdDepts: Department[] = [];
          uniqueConfigs.forEach(config => {
            const dept = createDepartment({ name: config.name });
            createdDepts.push(dept);
            for (let i = 0; i < config.userCount; i++) {
              createUser(`User ${i} in ${config.name}`, dept.id);
            }
          });
          
          // List all departments
          const departments = listDepartments();
          
          expect(departments.length).toBe(uniqueConfigs.length);
          
          // Verify member counts
          uniqueConfigs.forEach(config => {
            const dept = departments.find(d => d.name === config.name);
            expect(dept).toBeDefined();
            expect(dept!.memberCount).toBe(config.userCount);
          });
        }
      ),
      { numRuns: 30 }
    );
  });

  /**
   * Property 8: Department Deletion User Handling
   * For any department that is deleted, all users previously in that department 
   * should have their department_id set to null.
   * **Validates: Requirements 4.4**
   */
  it('Property 8: Deleting department sets user department_id to null', () => {
    fc.assert(
      fc.property(
        departmentNameArbitrary,
        fc.array(userNameArbitrary, { minLength: 1, maxLength: 5 }),
        (deptName, userNames) => {
          resetTestDatabase();
          
          // Create department
          const dept = createDepartment({ name: deptName });
          
          // Create users in this department
          const users = userNames.map(name => createUser(name, dept.id));
          
          // Verify users are in department
          users.forEach(user => {
            const retrieved = getUserById(user.id);
            expect(retrieved!.departmentId).toBe(dept.id);
          });
          
          // Delete department
          deleteDepartment(dept.id);
          
          // Verify users now have null department_id
          users.forEach(user => {
            const retrieved = getUserById(user.id);
            expect(retrieved).not.toBeNull();
            expect(retrieved!.departmentId).toBeNull();
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});
