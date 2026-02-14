# Requirements Document

## Introduction

Horus Attendance Desktop is a lightweight, installable desktop application for attendance management. It connects to ZKTeco Horus E1-FP biometric devices on the local network, syncs attendance logs, maintains enriched employee profiles in a local SQLite database, and generates configurable weekly/monthly reports with punch interpretation rules. The application is built with Tauri, React, Tailwind CSS, and Framer Motion, targeting macOS as the primary platform.

## Glossary

- **Device**: A ZKTeco Horus E1-FP biometric attendance device on the local network
- **Sync_Engine**: The component responsible for pulling data from the Device and storing it locally
- **User_Directory**: The component managing employee profiles and their linkage to device users
- **Report_Generator**: The component that produces weekly/monthly attendance reports
- **Punch_Record**: A single timestamp entry from the Device representing a check-in or check-out event
- **Attendance_Summary**: A daily aggregation of punch records for a user showing check-in, check-out, and status
- **Rule_Engine**: The component that interprets punch records according to configurable attendance rules
- **Backup_Manager**: The component handling database export and import operations
- **Department**: An organizational unit for grouping users
- **Device_User_ID**: The unique identifier assigned to a user on the biometric device
- **Comm_Key**: The communication key used to authenticate with the ZKTeco device

## Requirements

### Requirement 1: Device Configuration and Connection

**User Story:** As an admin, I want to configure and connect to my ZKTeco device, so that I can pull attendance data from it.

#### Acceptance Criteria

1. WHEN the admin opens the Sync page, THE Application SHALL display a device configuration form with fields for device name, IP address, port, communication key, timezone, and sync mode
2. WHEN the admin clicks the Test Connection button, THE Sync_Engine SHALL attempt to connect to the configured device and display connection status, device info, and last sync time
3. IF the connection test fails, THEN THE Application SHALL display a descriptive error message indicating the failure reason
4. WHEN the admin saves device configuration, THE Application SHALL persist the settings to the local database
5. THE Application SHALL support configuring multiple devices for future extensibility

### Requirement 2: Attendance Data Synchronization

**User Story:** As an admin, I want to sync attendance logs from my device, so that I have up-to-date attendance records in the application.

#### Acceptance Criteria

1. WHEN the admin clicks the Sync Now button, THE Sync_Engine SHALL pull all device users and attendance logs from the configured device
2. WHEN syncing attendance logs, THE Sync_Engine SHALL deduplicate records using a unique index on device_id, device_user_id, and timestamp
3. WHEN the admin selects a sync range option, THE Sync_Engine SHALL support syncing latest records only, last N days, or a custom date range
4. WHILE syncing is in progress, THE Application SHALL display a progress indicator showing sync status
5. IF a sync operation fails mid-way, THEN THE Sync_Engine SHALL rollback the transaction to prevent database corruption
6. WHEN sync completes successfully, THE Application SHALL update the last_sync_at timestamp for the device

### Requirement 3: User Directory and Profile Management

**User Story:** As an admin, I want to manage employee profiles with enriched information, so that I can maintain comprehensive employee records beyond what the device stores.

#### Acceptance Criteria

1. WHEN the admin opens the Users page, THE User_Directory SHALL display a list of all users with columns for full name, device user ID, department, status, last seen, and matching status
2. WHEN a new device user is synced, THE User_Directory SHALL create a corresponding app profile linked by device_user_id
3. WHEN the admin edits a user profile, THE Application SHALL allow modification of full name, department, email, phone, address, employee code, notes, and status fields
4. WHEN the admin searches for users, THE User_Directory SHALL filter the list by name, department, or employee code
5. THE User_Directory SHALL indicate unlinked device users that need profile enrichment
6. WHEN the admin changes a user's status to inactive, THE User_Directory SHALL exclude that user from active attendance tracking

### Requirement 4: Department Management

**User Story:** As an admin, I want to organize users into departments, so that I can filter and report on attendance by organizational unit.

#### Acceptance Criteria

1. WHEN the admin opens the Departments page, THE Application SHALL display a list of all departments with member counts
2. WHEN the admin creates a new department, THE Application SHALL add it to the database with a unique name
3. WHEN the admin edits a department, THE Application SHALL allow modification of the department name
4. WHEN the admin deletes a department, THE Application SHALL prompt for confirmation and handle users in that department appropriately
5. WHEN the admin assigns a user to a department, THE User_Directory SHALL update the user's department_id

### Requirement 5: Attendance Records Viewing

**User Story:** As an admin, I want to view all attendance punch records, so that I can audit and verify attendance data.

#### Acceptance Criteria

1. WHEN the admin opens the Records page, THE Application SHALL display a paginated table of all punch records
2. WHEN the admin applies filters, THE Application SHALL filter records by date range, user, department, or punch type
3. WHEN displaying a punch record, THE Application SHALL show timestamp, user name, verify type, and punch type
4. WHEN the admin clicks on a user in the records view, THE Application SHALL navigate to that user's detailed attendance view
5. THE Application SHALL support sorting records by timestamp, user, or department

### Requirement 6: User Attendance Detail View

**User Story:** As an admin, I want to view detailed attendance for a specific user, so that I can review their attendance patterns over time.

#### Acceptance Criteria

1. WHEN the admin views a user's attendance detail, THE Application SHALL display daily summaries for the selected time range
2. WHEN displaying a daily summary, THE Application SHALL show check-in time, check-out time, total hours, and status flags
3. WHEN the admin selects a week view, THE Application SHALL display Mon-Sun attendance for the selected week
4. WHEN the admin selects a month view, THE Application SHALL display all days in the selected month
5. WHEN the admin selects a custom range, THE Application SHALL display attendance for the specified date range

### Requirement 7: Weekly Report Generation

**User Story:** As an admin, I want to generate weekly attendance reports, so that I can review and share weekly attendance summaries.

#### Acceptance Criteria

1. WHEN the admin opens the Weekly Report view, THE Report_Generator SHALL display a table with users as rows and Mon-Sun as columns
2. WHEN displaying daily attendance in the report, THE Report_Generator SHALL show status badges indicating present, absent, late, early leave, or incomplete
3. WHEN the admin exports the weekly report, THE Application SHALL generate a CSV file with the report data
4. WHEN the admin filters by department, THE Report_Generator SHALL show only users from the selected department
5. THE Report_Generator SHALL calculate weekly totals for each user including days present, days absent, and total late minutes

### Requirement 8: Monthly Report Generation

**User Story:** As an admin, I want to generate monthly attendance reports, so that I can review attendance patterns over a full month.

#### Acceptance Criteria

1. WHEN the admin opens the Monthly Report view, THE Report_Generator SHALL display a summary per user for the selected month
2. WHEN displaying monthly summary, THE Report_Generator SHALL show total days present, days absent, total late minutes, total early leave minutes, and incomplete days
3. WHEN the admin clicks on a user's monthly summary, THE Application SHALL drill down to show daily details for that user
4. WHEN the admin exports the monthly report, THE Application SHALL generate a CSV file with the report data
5. WHEN the admin filters by department, THE Report_Generator SHALL show only users from the selected department

### Requirement 9: Punch Interpretation Rule Engine

**User Story:** As an admin, I want to configure attendance rules, so that the system correctly interprets punch records according to my organization's policies.

#### Acceptance Criteria

1. WHEN the admin configures work schedule, THE Rule_Engine SHALL accept work start time, work end time, and workdays configuration
2. WHEN the admin configures grace periods, THE Rule_Engine SHALL accept late grace period and early leave grace period in minutes
3. WHEN processing daily attendance, THE Rule_Engine SHALL use the first punch as check-in and the last punch as check-out
4. IF a user has only one punch in a day, THEN THE Rule_Engine SHALL mark the day as incomplete and use the single punch based on time-of-day logic
5. WHEN calculating late status, THE Rule_Engine SHALL compare check-in time against work start time plus grace period
6. WHEN calculating early leave status, THE Rule_Engine SHALL compare check-out time against work end time minus grace period
7. THE Rule_Engine SHALL support configuring check-in and check-out time windows to filter valid punches

### Requirement 10: Data Backup and Restore

**User Story:** As an admin, I want to backup and restore my attendance data, so that I can migrate to a new computer or recover from data loss.

#### Acceptance Criteria

1. WHEN the admin clicks Export Backup, THE Backup_Manager SHALL create a portable zip file containing the SQLite database and configuration
2. WHEN the admin clicks Import/Restore, THE Backup_Manager SHALL allow selection of a backup file and restore the database
3. WHEN restoring from backup, THE Backup_Manager SHALL validate the backup file integrity before overwriting existing data
4. IF the backup file is corrupted or invalid, THEN THE Backup_Manager SHALL display an error and abort the restore operation
5. WHEN backup completes, THE Application SHALL display the backup file location and size
6. THE Application SHALL store all data locally by default with no cloud dependencies

### Requirement 11: Settings Management

**User Story:** As an admin, I want to manage application settings in one place, so that I can configure all aspects of the application easily.

#### Acceptance Criteria

1. WHEN the admin opens the Settings page, THE Application SHALL display sections for device settings, attendance rules, workdays, holidays, data & backup, and appearance
2. WHEN the admin modifies settings, THE Application SHALL persist changes to the settings table
3. WHEN the admin configures holidays, THE Application SHALL allow adding dates that are excluded from attendance calculations
4. WHEN the admin configures appearance, THE Application SHALL support light and dark theme options
5. THE Application SHALL apply settings changes immediately without requiring restart

### Requirement 12: Dashboard Overview

**User Story:** As an admin, I want to see a dashboard overview, so that I can quickly understand the current attendance status.

#### Acceptance Criteria

1. WHEN the admin opens the Dashboard, THE Application SHALL display cards showing last sync time, total active users, and today's attendance statistics
2. WHEN displaying today's statistics, THE Application SHALL show count of users checked in, users not yet checked in, and users on leave
3. THE Application SHALL provide quick action buttons for common tasks like Sync Now and View Reports
4. WHEN the admin clicks on a dashboard card, THE Application SHALL navigate to the relevant detailed view

### Requirement 13: Application Installation and Startup

**User Story:** As an admin, I want to install and run the application easily, so that I can start using it without technical setup.

#### Acceptance Criteria

1. THE Application SHALL be installable on macOS without requiring additional dependencies
2. WHEN the application starts for the first time, THE Application SHALL create the SQLite database with the required schema
3. WHEN the application starts, THE Application SHALL display the Dashboard as the default view
4. THE Application SHALL provide smooth animations using Framer Motion for a polished user experience
5. THE Application SHALL handle 50-300 users and 1-3 years of attendance logs without performance degradation

### Requirement 14: Navigation and User Interface

**User Story:** As an admin, I want intuitive navigation, so that I can easily access all features of the application.

#### Acceptance Criteria

1. THE Application SHALL display a left sidebar navigation with links to Dashboard, Sync, Records, Users, Reports, Departments, and Settings
2. WHEN the admin clicks a navigation item, THE Application SHALL navigate to the corresponding page with a smooth transition
3. THE Application SHALL highlight the currently active navigation item
4. THE Application SHALL use Tailwind CSS for consistent styling across all pages
5. THE Application SHALL be responsive within reasonable desktop window sizes
