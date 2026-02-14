# Implementation Plan: Horus Attendance Desktop

## Overview

This implementation plan breaks down the Horus Attendance Desktop application into incremental coding tasks. The approach starts with project scaffolding and core data layer, then builds up through business logic services, and finally integrates the UI components. Property-based tests are included as optional sub-tasks to validate correctness properties.

## Tasks
p- [x] 1. Project Setup and Core Infrastructure
  - [x] 1.1 Initialize Tauri + React + TypeScript project with Tailwind CSS and Framer Motion
    - Create new Tauri project with React template
    - Configure Tailwind CSS with custom theme
    - Add Framer Motion dependency
    - Set up TypeScript strict mode configuration
    - _Requirements: 13.1, 14.4_
  
  - [x] 1.2 Set up SQLite database with Tauri SQL plugin
    - Install and configure @tauri-apps/plugin-sql
    - Create database initialization module
    - Implement schema migration system
    - Create all tables from design (devices, departments, users, attendance_logs_raw, attendance_day_summary, settings, holidays)
    - _Requirements: 13.2_
  
  - [x] 1.3 Define TypeScript interfaces and types
    - Create types for all data models (Device, User, Department, AttendanceLog, etc.)
    - Create types for service interfaces (SyncEngine, UserDirectory, ReportGenerator, etc.)
    - Create types for API responses and errors
    - _Requirements: All_

- [x] 2. Checkpoint - Verify project builds and database initializes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Data Access Layer
  - [x] 3.1 Implement Device repository
    - Create CRUD operations for devices table
    - Implement getDeviceById, listDevices, saveDevice, deleteDevice
    - _Requirements: 1.4, 1.5_
  
  - [x] 3.2 Write property test for Device repository
    - **Property 1: Device Configuration Round-Trip**
    - **Validates: Requirements 1.4, 1.5**
  
  - [x] 3.3 Implement Department repository
    - Create CRUD operations for departments table
    - Implement getDepartmentWithMemberCount
    - Handle unique name constraint
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  
  - [x] 3.4 Write property test for Department repository
    - **Property 7: Department CRUD with Member Counts**
    - **Validates: Requirements 4.1, 4.2, 4.3**
  
  - [x] 3.5 Implement User repository
    - Create CRUD operations for users table
    - Implement search by name, department, employee code
    - Implement linking device users to profiles
    - Handle inactive user filtering
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  
  - [x] 3.6 Write property tests for User repository
    - **Property 4: User Profile CRUD and Linking**
    - **Property 5: User Search Filtering**
    - **Property 6: Inactive User Exclusion**
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6**
  
  - [x] 3.7 Implement AttendanceLog repository
    - Create insert with deduplication (ON CONFLICT IGNORE)
    - Implement filtering by date range, user, department
    - Implement sorting by timestamp, user, department
    - _Requirements: 2.2, 5.2, 5.5_
  
  - [x] 3.8 Write property tests for AttendanceLog repository
    - **Property 2: Attendance Log Deduplication**
    - **Property 9: Attendance Record Filtering**
    - **Property 10: Attendance Record Sorting**
    - **Validates: Requirements 2.2, 5.2, 5.5**
  
  - [x] 3.9 Implement AttendanceSummary repository
    - Create CRUD for attendance_day_summary table
    - Implement date range queries (week, month, custom)
    - _Requirements: 6.1, 6.3, 6.4, 6.5_
  
  - [x] 3.10 Write property test for AttendanceSummary repository
    - **Property 11: Date Range Query Completeness**
    - **Validates: Requirements 6.1, 6.3, 6.4, 6.5**
  
  - [x] 3.11 Implement Settings repository
    - Create key-value storage operations
    - Implement typed getters/setters for AppSettings
    - _Requirements: 11.2_
  
  - [x] 3.12 Implement Holiday repository
    - Create CRUD for holidays table
    - Implement isHoliday check
    - _Requirements: 11.3_

- [x] 4. Checkpoint - Verify all repositories work correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Rule Engine Implementation
  - [x] 5.1 Implement core Rule Engine
    - Create RuleEngine class with processDay method
    - Implement first punch as check-in, last punch as check-out logic
    - Implement single punch handling (mark as incomplete)
    - _Requirements: 9.3, 9.4_
  
  - [x] 5.2 Write property tests for first/last punch and single punch
    - **Property 17: First/Last Punch Rule**
    - **Property 18: Single Punch Incomplete Marking**
    - **Validates: Requirements 9.3, 9.4**
  
  - [x] 5.3 Implement late/early calculations
    - Implement calculateLateMinutes with grace period
    - Implement calculateEarlyMinutes with grace period
    - _Requirements: 9.5, 9.6_
  
  - [x] 5.4 Write property tests for late/early calculations
    - **Property 19: Late Minutes Calculation**
    - **Property 20: Early Leave Minutes Calculation**
    - **Validates: Requirements 9.5, 9.6**
  
  - [x] 5.5 Implement punch window filtering
    - Filter punches outside check-in/check-out windows
    - _Requirements: 9.7_
  
  - [x] 5.6 Write property test for punch window filtering
    - **Property 21: Punch Window Filtering**
    - **Validates: Requirements 9.7**
  
  - [x] 5.7 Implement attendance status derivation
    - Derive status (present, absent, late, early_leave, incomplete) from daily data
    - Integrate holiday checking
    - _Requirements: 7.2, 11.3_
  
  - [x] 5.8 Write property tests for status derivation and holiday exclusion
    - **Property 12: Attendance Status Derivation**
    - **Property 25: Holiday Exclusion from Working Days**
    - **Validates: Requirements 7.2, 11.3**

- [x] 6. Checkpoint - Verify Rule Engine calculations
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Report Generator Implementation
  - [x] 7.1 Implement Weekly Report Generator
    - Generate weekly report with Mon-Sun columns
    - Calculate weekly totals (days present, absent, late minutes)
    - Implement department filtering
    - _Requirements: 7.1, 7.4, 7.5_
  
  - [x] 7.2 Write property tests for weekly report
    - **Property 13: Report Department Filtering**
    - **Property 14: Weekly Summary Calculation**
    - **Validates: Requirements 7.4, 7.5**
  
  - [x] 7.3 Implement Monthly Report Generator
    - Generate monthly summary per user
    - Calculate monthly totals
    - Implement drill-down to daily details
    - _Requirements: 8.1, 8.2, 8.3_
  
  - [x] 7.4 Write property test for monthly report
    - **Property 15: Monthly Summary Calculation**
    - **Validates: Requirements 8.2**
  
  - [x] 7.5 Implement CSV Export
    - Export weekly and monthly reports to CSV
    - Include all required columns
    - _Requirements: 7.3, 8.4_
  
  - [x] 7.6 Write property test for CSV export
    - **Property 16: Report CSV Export Round-Trip**
    - **Validates: Requirements 7.3, 8.4**

- [x] 8. Checkpoint - Verify Report Generator
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Device Communication (Node Sidecar)
  - [x] 9.1 Set up Node.js sidecar for ZKTeco communication
    - Create sidecar project structure
    - Install zklib or equivalent ZKTeco library
    - Configure Tauri sidecar integration
    - _Requirements: 1.2, 2.1_
  
  - [x] 9.2 Implement device connection and test
    - Implement testConnection function
    - Return device info (serial, firmware, user count, log count)
    - Handle connection errors
    - _Requirements: 1.2, 1.3_
  
  - [x] 9.3 Implement user sync from device
    - Pull all users from device
    - Transform to app user format
    - _Requirements: 2.1_
  
  - [x] 9.4 Implement attendance log sync from device
    - Pull attendance logs with date range options
    - Transform to app log format
    - _Requirements: 2.1, 2.3_

- [x] 10. Sync Engine Implementation
  - [x] 10.1 Implement Sync Engine orchestration
    - Coordinate sidecar calls with database operations
    - Implement transaction-based sync with rollback on failure
    - Update last_sync_at on success
    - _Requirements: 2.1, 2.5, 2.6_
  
  - [x] 10.2 Write property test for transaction rollback
    - **Property 3: Transaction Rollback on Sync Failure**
    - **Validates: Requirements 2.5**
  
  - [x] 10.3 Implement sync progress tracking
    - Track sync progress for UI display
    - Report users synced, logs added, duplicates skipped
    - _Requirements: 2.4_

- [x] 11. Backup Manager Implementation
  - [x] 11.1 Implement backup export
    - Create zip file with SQLite database
    - Include metadata (version, checksum, counts)
    - _Requirements: 10.1_
  
  - [x] 11.2 Implement backup restore
    - Validate backup file before restore
    - Restore database from backup
    - Handle corrupted/invalid files
    - _Requirements: 10.2, 10.3, 10.4_
  
  - [x] 11.3 Write property tests for backup
    - **Property 22: Backup and Restore Round-Trip**
    - **Property 23: Backup Validation**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4**

- [x] 12. Checkpoint - Verify all services work correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. UI Components - Layout and Navigation
  - [x] 13.1 Implement App Shell with sidebar navigation
    - Create left sidebar with navigation links
    - Implement active state highlighting
    - Add Framer Motion page transitions
    - _Requirements: 14.1, 14.2, 14.3_
  
  - [x] 13.2 Implement Dashboard page
    - Create stat cards (last sync, total users, today's attendance)
    - Add quick action buttons
    - Implement navigation to detailed views
    - _Requirements: 12.1, 12.2, 12.3, 12.4_
  
  - [x] 13.3 Write property test for dashboard statistics
    - **Property 26: Dashboard Statistics Accuracy**
    - **Validates: Requirements 12.1, 12.2**

- [x] 14. UI Components - Sync and Device Management
  - [x] 14.1 Implement Sync page
    - Create device configuration form
    - Add test connection button with status display
    - Add sync now button with progress indicator
    - Implement sync range options
    - _Requirements: 1.1, 1.2, 1.3, 2.3, 2.4_

- [x] 15. UI Components - User and Department Management
  - [x] 15.1 Implement Users page
    - Create user list table with search and filters
    - Implement user edit modal
    - Show unlinked device users section
    - _Requirements: 3.1, 3.3, 3.4, 3.5_
  
  - [x] 15.2 Implement Departments page
    - Create department list with member counts
    - Implement create/edit/delete operations
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  
  - [x] 15.3 Write property test for department deletion
    - **Property 8: Department Deletion User Handling**
    - **Validates: Requirements 4.4**

- [x] 16. UI Components - Records and Attendance
  - [x] 16.1 Implement Records page
    - Create paginated table with filters
    - Implement sorting controls
    - Add navigation to user detail
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  
  - [x] 16.2 Implement User Attendance Detail view
    - Create week/month/custom range views
    - Display daily summaries with status badges
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 17. UI Components - Reports
  - [x] 17.1 Implement Weekly Report page
    - Create table with Mon-Sun columns
    - Add status badges
    - Implement department filter
    - Add CSV export button
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  
  - [x] 17.2 Implement Monthly Report page
    - Create summary table per user
    - Implement drill-down to daily details
    - Add department filter and CSV export
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 18. UI Components - Settings
  - [x] 18.1 Implement Settings page
    - Create sections for device, attendance rules, workdays, holidays
    - Implement data & backup section with export/import buttons
    - Add appearance settings (theme toggle)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
  
  - [x] 18.2 Write property test for settings persistence
    - **Property 24: Settings Persistence**
    - **Validates: Requirements 9.1, 9.2, 11.2**

- [x] 19. Final Integration and Polish
  - [x] 19.1 Wire all components together
    - Connect UI pages to services
    - Implement error handling and user feedback
    - Add loading states and animations
    - _Requirements: All_
  
  - [x] 19.2 Implement Tauri commands for all service operations
    - Create Tauri invoke commands for sync, reports, backup
    - Handle IPC between frontend and backend
    - _Requirements: All_

- [x] 20. Final Checkpoint - Full application verification
  - Ensure all tests pass, ask the user if questions arise.
  - Verify MVP acceptance criteria:
    1. Admin can install on macOS and run without extra dependencies
    2. Admin can enter device IP and successfully sync users + logs
    3. Users are linked by device_user_id; admin can edit enriched fields
    4. Weekly and monthly report views exist with first/last punch handling
    5. Late/early logic works based on configurable thresholds
    6. Backup export + import restore works

## Notes

- All tasks including property tests are required for comprehensive coverage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The Node sidecar approach is chosen for faster initial development; Rust implementation can be added later
