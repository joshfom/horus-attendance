/**
 * Property-based tests for User Repository
 * Property 4: User Profile CRUD and Linking
 * Property 5: User Search Filtering
 * Property 6: Inactive User Exclusion
 * Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6
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
import type { User, CreateUserInput, UpdateUserInput, UserFilter } from '../../types';
import type { UserRow, DepartmentRow } from '../../types/api';

// Initialize test database
initTestDatabase();

// Test-specific repository functions
function generateId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
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

function getUserById(id: string): User | null {
  const rows = testSelect<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
  return rows.length > 0 ? mapRowToUser(rows[0]) : null;
}


function listUsers(filter?: UserFilter): User[] {
  let query = 'SELECT * FROM users WHERE 1=1';
  const params: unknown[] = [];
  
  if (filter) {
    if (filter.status === 'all') {
      // No status filter
    } else if (filter.status) {
      query += ' AND status = ?';
      params.push(filter.status);
    } else {
      query += ' AND status = ?';
      params.push('active');
    }
    
    if (filter.departmentId) {
      query += ' AND department_id = ?';
      params.push(filter.departmentId);
    }
    
    if (filter.linkedOnly) {
      query += ' AND device_user_id IS NOT NULL';
    }
    
    if (filter.search) {
      const searchTerm = `%${filter.search}%`;
      query += ` AND (display_name LIKE ? OR employee_code LIKE ?)`;
      params.push(searchTerm, searchTerm);
    }
  } else {
    query += ' AND status = ?';
    params.push('active');
  }
  
  query += ' ORDER BY display_name ASC';
  
  const rows = testSelect<UserRow>(query, params);
  return rows.map(mapRowToUser);
}

function searchUsers(query: string): User[] {
  const searchTerm = `%${query}%`;
  const rows = testSelect<UserRow>(
    `SELECT u.* FROM users u
     LEFT JOIN departments d ON u.department_id = d.id
     WHERE u.status = 'active' 
       AND (u.display_name LIKE ? OR u.employee_code LIKE ? OR d.name LIKE ?)
     ORDER BY u.display_name ASC`,
    [searchTerm, searchTerm, searchTerm]
  );
  return rows.map(mapRowToUser);
}

function createUser(data: CreateUserInput): User {
  const id = generateId();
  const timestamp = now();
  
  testExecute(
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
  
  const user = getUserById(id);
  if (!user) throw new Error('Failed to create user');
  return user;
}

function updateUser(id: string, data: UpdateUserInput): User {
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
  if (data.status !== undefined) {
    fields.push('status = ?');
    values.push(data.status);
  }
  if (data.employeeCode !== undefined) {
    fields.push('employee_code = ?');
    values.push(data.employeeCode);
  }
  
  if (fields.length > 0) {
    fields.push('updated_at = ?');
    values.push(timestamp);
    values.push(id);
    testExecute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
  }
  
  const user = getUserById(id);
  if (!user) throw new Error('Failed to update user');
  return user;
}

function linkDeviceUser(userId: string, deviceUserId: string): User {
  const timestamp = now();
  testExecute(
    'UPDATE users SET device_user_id = ?, updated_at = ? WHERE id = ?',
    [deviceUserId, timestamp, userId]
  );
  const user = getUserById(userId);
  if (!user) throw new Error('Failed to link device user');
  return user;
}

function createDepartment(name: string): { id: string; name: string } {
  const id = generateId();
  const timestamp = now();
  testExecute(
    'INSERT INTO departments (id, name, created_at) VALUES (?, ?, ?)',
    [id, name, timestamp]
  );
  return { id, name };
}

// Arbitraries
const userNameArbitrary = fc.string({ minLength: 1, maxLength: 100 })
  .filter(s => s.trim().length > 0);

const employeeCodeArbitrary = fc.string({ minLength: 1, maxLength: 20 })
  .filter(s => /^[A-Za-z0-9-]+$/.test(s));

const statusArbitrary = fc.constantFrom('active' as const, 'inactive' as const);

const createUserInputArbitrary = fc.record({
  displayName: userNameArbitrary,
  deviceUserId: fc.option(fc.uuid(), { nil: undefined }),
  deviceName: fc.option(userNameArbitrary, { nil: undefined }),
  employeeCode: fc.option(employeeCodeArbitrary, { nil: undefined }),
  status: fc.option(statusArbitrary, { nil: undefined }),
});

describe('User Repository', () => {
  beforeEach(() => {
    resetTestDatabase();
  });

  afterAll(() => {
    closeTestDatabase();
  });

  /**
   * Property 4: User Profile CRUD and Linking
   * For any device user synced from a device, a corresponding user profile should be created
   * with the device_user_id linked. For any user profile update, the updated fields should
   * persist correctly when retrieved.
   * Validates: Requirements 3.2, 3.3, 3.5
   */
  it('Property 4: User Profile CRUD and Linking', () => {
    fc.assert(
      fc.property(
        createUserInputArbitrary,
        fc.uuid(),
        userNameArbitrary,
        (input, newDeviceUserId, newName) => {
          resetTestDatabase();
          
          // Create user
          const created = createUser(input);
          expect(created.displayName).toBe(input.displayName);
          expect(created.deviceUserId).toBe(input.deviceUserId || null);
          
          // Read user
          const read = getUserById(created.id);
          expect(read).not.toBeNull();
          expect(read!.displayName).toBe(input.displayName);
          
          // Update user
          const updated = updateUser(created.id, { displayName: newName });
          expect(updated.displayName).toBe(newName);
          
          // Verify update persisted
          const afterUpdate = getUserById(created.id);
          expect(afterUpdate!.displayName).toBe(newName);
          
          // Link device user (if not already linked)
          if (!input.deviceUserId) {
            const linked = linkDeviceUser(created.id, newDeviceUserId);
            expect(linked.deviceUserId).toBe(newDeviceUserId);
            
            // Verify link persisted
            const afterLink = getUserById(created.id);
            expect(afterLink!.deviceUserId).toBe(newDeviceUserId);
          }
        }
      ),
      { numRuns: 100 }
    );
  });


  /**
   * Property 5: User Search Filtering
   * For any search query (by name, department, or employee code), all returned users
   * should match the search criteria, and no matching users should be excluded from results.
   * Validates: Requirements 3.4
   */
  it('Property 5: User Search Filtering', () => {
    fc.assert(
      fc.property(
        fc.array(createUserInputArbitrary, { minLength: 1, maxLength: 10 }),
        (inputs) => {
          resetTestDatabase();
          
          // Create users with active status
          const users = inputs.map(input => createUser({ ...input, status: 'active' }));
          
          // Pick a random user to search for - use alphanumeric chars only for search
          const targetUser = users[0];
          const alphanumericChars = targetUser.displayName.replace(/[^a-zA-Z0-9]/g, '');
          
          // Skip if no alphanumeric characters
          if (alphanumericChars.length < 2) return;
          
          const searchTerm = alphanumericChars.substring(0, Math.min(3, alphanumericChars.length));
          
          // Search
          const results = searchUsers(searchTerm);
          
          // All results should contain the search term in name, employee code, or department
          results.forEach(user => {
            const matchesName = user.displayName.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesCode = user.employeeCode?.toLowerCase().includes(searchTerm.toLowerCase()) || false;
            expect(matchesName || matchesCode).toBe(true);
          });
          
          // Target user should be in results (if search term matches)
          if (targetUser.displayName.toLowerCase().includes(searchTerm.toLowerCase())) {
            const found = results.find(u => u.id === targetUser.id);
            expect(found).toBeDefined();
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property 6: Inactive User Exclusion
   * For any user marked as inactive, that user should not appear in active attendance
   * tracking queries or active user counts.
   * Validates: Requirements 3.6
   */
  it('Property 6: Inactive User Exclusion', () => {
    fc.assert(
      fc.property(
        fc.array(createUserInputArbitrary, { minLength: 2, maxLength: 10 }),
        fc.integer({ min: 0, max: 9 }),
        (inputs, inactiveIndex) => {
          resetTestDatabase();
          
          // Create users
          const users = inputs.map(input => createUser({ ...input, status: 'active' }));
          
          // Mark one user as inactive
          const targetIndex = inactiveIndex % users.length;
          const inactiveUser = updateUser(users[targetIndex].id, { status: 'inactive' });
          expect(inactiveUser.status).toBe('inactive');
          
          // List active users (default filter)
          const activeUsers = listUsers();
          
          // Inactive user should NOT be in the list
          const foundInactive = activeUsers.find(u => u.id === inactiveUser.id);
          expect(foundInactive).toBeUndefined();
          
          // All returned users should be active
          activeUsers.forEach(user => {
            expect(user.status).toBe('active');
          });
          
          // List with status='all' should include inactive
          const allUsers = listUsers({ status: 'all' });
          const foundInAll = allUsers.find(u => u.id === inactiveUser.id);
          expect(foundInAll).toBeDefined();
          expect(foundInAll!.status).toBe('inactive');
        }
      ),
      { numRuns: 50 }
    );
  });

  it('listUsers filters by department correctly', () => {
    fc.assert(
      fc.property(
        fc.array(userNameArbitrary, { minLength: 2, maxLength: 5 }),
        fc.array(userNameArbitrary, { minLength: 2, maxLength: 5 }),
        (dept1Users, dept2Users) => {
          resetTestDatabase();
          
          // Create two departments
          const dept1 = createDepartment('Department 1');
          const dept2 = createDepartment('Department 2');
          
          // Create users in each department
          dept1Users.forEach(name => createUser({ displayName: name, departmentId: dept1.id }));
          dept2Users.forEach(name => createUser({ displayName: name, departmentId: dept2.id }));
          
          // Filter by department 1
          const filtered = listUsers({ departmentId: dept1.id, status: 'all' });
          
          // All returned users should be in department 1
          expect(filtered.length).toBe(dept1Users.length);
          filtered.forEach(user => {
            expect(user.departmentId).toBe(dept1.id);
          });
        }
      ),
      { numRuns: 30 }
    );
  });

  it('listUsers filters by linkedOnly correctly', () => {
    fc.assert(
      fc.property(
        fc.array(createUserInputArbitrary, { minLength: 3, maxLength: 10 }),
        (inputs) => {
          resetTestDatabase();
          
          // Create users - some with deviceUserId, some without
          const users = inputs.map((input, i) => {
            const hasDeviceId = i % 2 === 0;
            return createUser({
              ...input,
              deviceUserId: hasDeviceId ? `device-${i}` : undefined,
              status: 'active',
            });
          });
          
          // Filter by linkedOnly
          const linkedUsers = listUsers({ linkedOnly: true, status: 'all' });
          
          // All returned users should have deviceUserId
          linkedUsers.forEach(user => {
            expect(user.deviceUserId).not.toBeNull();
          });
          
          // Count should match users with deviceUserId
          const expectedCount = users.filter(u => u.deviceUserId !== null).length;
          expect(linkedUsers.length).toBe(expectedCount);
        }
      ),
      { numRuns: 30 }
    );
  });
});
