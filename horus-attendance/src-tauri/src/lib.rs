use tauri_plugin_sql::{Migration, MigrationKind};
use tauri::Manager;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use base64::Engine;

mod zkteco;

fn get_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_initial_schema",
            sql: r#"
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
                CREATE INDEX IF NOT EXISTS idx_attendance_logs_device_ts ON attendance_logs_raw(device_id, timestamp);
                CREATE INDEX IF NOT EXISTS idx_attendance_summary_date ON attendance_day_summary(date);
                CREATE INDEX IF NOT EXISTS idx_attendance_summary_user_date ON attendance_day_summary(user_id, date);
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "enable_wal_mode",
            sql: r#"
                PRAGMA journal_mode = WAL;
                PRAGMA busy_timeout = 30000;
                PRAGMA synchronous = NORMAL;
            "#,
            kind: MigrationKind::Up,
        },
    ]
}

/// Backup metadata structure
#[derive(Debug, Serialize, Deserialize)]
pub struct BackupMetadata {
    pub version: String,
    pub created_at: String,
    pub app_version: String,
    pub user_count: u32,
    pub log_count: u32,
}

/// Result of backup operation
#[derive(Debug, Serialize, Deserialize)]
pub struct BackupResult {
    pub success: bool,
    pub file_path: String,
    pub file_size: u64,
    pub error: Option<String>,
}

/// Result of restore operation
#[derive(Debug, Serialize, Deserialize)]
pub struct RestoreResult {
    pub success: bool,
    pub error: Option<String>,
}

/// Get the database path
fn get_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    Ok(app_data_dir.join("horus_attendance.db"))
}

/// Get the default backup directory
fn get_backup_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let document_dir = app.path().document_dir()
        .map_err(|e| format!("Failed to get document directory: {}", e))?;
    let backup_dir = document_dir.join("HorusAttendance").join("backups");
    fs::create_dir_all(&backup_dir)
        .map_err(|e| format!("Failed to create backup directory: {}", e))?;
    Ok(backup_dir)
}

/// Export database backup
#[tauri::command]
async fn export_backup(app: tauri::AppHandle, destination: Option<String>) -> Result<BackupResult, String> {
    let db_path = get_db_path(&app)?;
    
    if !db_path.exists() {
        return Ok(BackupResult {
            success: false,
            file_path: String::new(),
            file_size: 0,
            error: Some("Database file not found".to_string()),
        });
    }
    
    let backup_path = match destination {
        Some(dest) => {
            // The save dialog returns a full file path — use it directly
            PathBuf::from(dest)
        },
        None => {
            let backup_dir = get_backup_dir(&app)?;
            let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
            let backup_filename = format!("horus_backup_{}.db", timestamp);
            backup_dir.join(&backup_filename)
        },
    };
    
    // Ensure parent directory exists
    if let Some(parent) = backup_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create backup directory: {}", e))?;
    }
    
    // Copy the database file
    fs::copy(&db_path, &backup_path)
        .map_err(|e| format!("Failed to copy database: {}", e))?;
    
    let file_size = fs::metadata(&backup_path)
        .map(|m| m.len())
        .unwrap_or(0);
    
    Ok(BackupResult {
        success: true,
        file_path: backup_path.to_string_lossy().to_string(),
        file_size,
        error: None,
    })
}

/// Restore database from backup
/// NOTE: After restore the app must be restarted for the SQL plugin to pick up the new file.
#[tauri::command]
async fn restore_backup(app: tauri::AppHandle, backup_path: String) -> Result<RestoreResult, String> {
    let source_path = PathBuf::from(&backup_path);
    
    if !source_path.exists() {
        return Ok(RestoreResult {
            success: false,
            error: Some("Backup file not found".to_string()),
        });
    }
    
    let db_path = get_db_path(&app)?;
    
    // Create a backup of current database before restore
    if db_path.exists() {
        let backup_dir = get_backup_dir(&app)?;
        let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
        let pre_restore_backup = backup_dir.join(format!("pre_restore_{}.db", timestamp));
        fs::copy(&db_path, &pre_restore_backup)
            .map_err(|e| format!("Failed to backup current database: {}", e))?;
    }
    
    // Copy the backup file to the database location
    fs::copy(&source_path, &db_path)
        .map_err(|e| format!("Failed to restore database: {}", e))?;
    
    Ok(RestoreResult {
        success: true,
        error: None,
    })
}

/// Get the default backup directory path
#[tauri::command]
async fn get_backup_directory(app: tauri::AppHandle) -> Result<String, String> {
    let backup_dir = get_backup_dir(&app)?;
    Ok(backup_dir.to_string_lossy().to_string())
}

/// List available backups
#[tauri::command]
async fn list_backups(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let backup_dir = get_backup_dir(&app)?;
    
    let mut backups = Vec::new();
    
    if let Ok(entries) = fs::read_dir(&backup_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "db") {
                if let Some(filename) = path.file_name() {
                    backups.push(filename.to_string_lossy().to_string());
                }
            }
        }
    }
    
    backups.sort_by(|a, b| b.cmp(a)); // Sort descending (newest first)
    Ok(backups)
}

/// Get app version
#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Reset the database by deleting all data
/// NOTE: After reset the app must be restarted for the SQL plugin to re-create a fresh DB.
#[tauri::command]
async fn reset_database(app: tauri::AppHandle) -> Result<RestoreResult, String> {
    let db_path = get_db_path(&app)?;
    
    if !db_path.exists() {
        return Ok(RestoreResult {
            success: true,
            error: None,
        });
    }
    
    // Create a backup before reset
    let backup_dir = get_backup_dir(&app)?;
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let pre_reset_backup = backup_dir.join(format!("pre_reset_{}.db", timestamp));
    
    if let Err(e) = fs::copy(&db_path, &pre_reset_backup) {
        return Ok(RestoreResult {
            success: false,
            error: Some(format!("Failed to backup before reset: {}", e)),
        });
    }
    
    // Delete the database file
    if let Err(e) = fs::remove_file(&db_path) {
        return Ok(RestoreResult {
            success: false,
            error: Some(format!("Failed to delete database: {}", e)),
        });
    }
    
    Ok(RestoreResult {
        success: true,
        error: None,
    })
}

/// Write text content to a file path (sandboxed to app data + documents)
#[tauri::command]
async fn write_text_file(app: tauri::AppHandle, path: String, content: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let target = target.canonicalize().unwrap_or_else(|_| target.clone());

    let app_data = app.path().app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {}", e))?;
    let documents = app.path().document_dir()
        .map_err(|e| format!("Cannot resolve document dir: {}", e))?;
    let downloads = app.path().download_dir().ok();

    let allowed = target.starts_with(&app_data)
        || target.starts_with(&documents)
        || downloads.as_ref().map_or(false, |d| target.starts_with(d));

    if !allowed {
        return Err(format!(
            "Write denied: path must be inside app data, documents, or downloads directory. Got: {}",
            path
        ));
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directories: {}", e))?;
    }

    fs::write(&target, content)
        .map_err(|e| format!("Failed to write file: {}", e))
}

/// Write binary content (base64-encoded) to a file path (sandboxed to app data + documents)
#[tauri::command]
async fn write_binary_file(app: tauri::AppHandle, path: String, base64_data: String) -> Result<(), String> {
    use std::io::Write;

    let target = PathBuf::from(&path);
    let target = target.canonicalize().unwrap_or_else(|_| target.clone());

    let app_data = app.path().app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {}", e))?;
    let documents = app.path().document_dir()
        .map_err(|e| format!("Cannot resolve document dir: {}", e))?;
    let downloads = app.path().download_dir().ok();

    let allowed = target.starts_with(&app_data)
        || target.starts_with(&documents)
        || downloads.as_ref().map_or(false, |d| target.starts_with(d));

    if !allowed {
        return Err(format!(
            "Write denied: path must be inside app data, documents, or downloads directory. Got: {}",
            path
        ));
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directories: {}", e))?;
    }

    let bytes = base64::engine::general_purpose::STANDARD.decode(&base64_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;
    let mut file = fs::File::create(&target)
        .map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(&bytes)
        .map_err(|e| format!("Failed to write file: {}", e))
}



#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:horus_attendance.db", get_migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            export_backup,
            restore_backup,
            get_backup_directory,
            list_backups,
            get_app_version,
            reset_database,
            write_text_file,
            write_binary_file,
            zkteco::commands::test_device_connection,
            zkteco::commands::get_device_info,
            zkteco::commands::get_device_users,
            zkteco::commands::get_attendance_logs,
            zkteco::commands::sync_device_all,
        ])
        .setup(|app| {
            // Enable logging in both debug and release builds
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(if cfg!(debug_assertions) {
                        log::LevelFilter::Debug
                    } else {
                        log::LevelFilter::Info
                    })
                    .build(),
            )?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
