use tauri_plugin_sql::{Migration, MigrationKind};
use tauri::Manager;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

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
                CREATE INDEX IF NOT EXISTS idx_attendance_summary_date ON attendance_day_summary(date);
                CREATE INDEX IF NOT EXISTS idx_attendance_summary_user_date ON attendance_day_summary(user_id, date);
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
    
    let backup_dir = match destination {
        Some(dest) => PathBuf::from(dest),
        None => get_backup_dir(&app)?,
    };
    
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let backup_filename = format!("horus_backup_{}.db", timestamp);
    let backup_path = backup_dir.join(&backup_filename);
    
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

/// Write text content to a file path
#[tauri::command]
async fn write_text_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write file: {}", e))
}

/// Write binary content (base64-encoded) to a file path
#[tauri::command]
async fn write_binary_file(path: String, base64_data: String) -> Result<(), String> {
    use std::io::Write;
    let bytes = base64_decode(&base64_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;
    let mut file = fs::File::create(&path)
        .map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(&bytes)
        .map_err(|e| format!("Failed to write file: {}", e))
}

/// Proxy a POST request to the sidecar (bypasses webview HTTP restrictions)
#[tauri::command]
async fn sidecar_request(endpoint: String, body: String) -> Result<String, String> {
    let url = format!("http://127.0.0.1:3847{}", endpoint);
    let client = tauri_plugin_http::reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Sidecar request failed: {}. Is the sidecar running on port 3847?", e))?;
    let status = response.status();
    let text = response.text().await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    if !status.is_success() {
        return Err(format!("Sidecar error ({}): {}", status, text));
    }
    Ok(text)
}

/// Simple base64 decoder
fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    let chars: Vec<u8> = input.bytes().collect();
    let mut output = Vec::with_capacity(input.len() * 3 / 4);
    let table = |c: u8| -> Result<u8, String> {
        match c {
            b'A'..=b'Z' => Ok(c - b'A'),
            b'a'..=b'z' => Ok(c - b'a' + 26),
            b'0'..=b'9' => Ok(c - b'0' + 52),
            b'+' => Ok(62),
            b'/' => Ok(63),
            b'=' => Ok(0),
            _ => Err(format!("Invalid base64 character: {}", c as char)),
        }
    };
    let mut i = 0;
    while i < chars.len() {
        if i + 3 >= chars.len() { break; }
        let a = table(chars[i])?;
        let b = table(chars[i + 1])?;
        let c = table(chars[i + 2])?;
        let d = table(chars[i + 3])?;
        output.push((a << 2) | (b >> 4));
        if chars[i + 2] != b'=' {
            output.push((b << 4) | (c >> 2));
        }
        if chars[i + 3] != b'=' {
            output.push((c << 6) | d);
        }
        i += 4;
    }
    Ok(output)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
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
            sidecar_request,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
