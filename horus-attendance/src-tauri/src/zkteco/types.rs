//! ZKTeco data types for Tauri command serialization

use serde::{Deserialize, Serialize};

/// Device connection configuration (received from frontend)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceConfig {
    pub ip: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default)]
    pub comm_key: Option<String>,
    #[serde(default = "default_timeout")]
    pub timeout: Option<u64>,
}

fn default_port() -> u16 {
    4370
}

fn default_timeout() -> Option<u64> {
    Some(10000)
}

/// Device information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub serial_number: String,
    pub firmware_version: String,
    pub user_count: u32,
    pub log_count: u32,
    pub last_activity: String,
}

/// A user record from the device
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceUser {
    pub device_user_id: String,
    pub device_name: String,
}

/// An attendance log record from the device
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttendanceLog {
    pub device_user_id: String,
    pub timestamp: String,
    pub verify_type: u8,
    pub punch_type: u8,
}

/// Connection test result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_info: Option<DeviceInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub latency: u64,
}

/// Sync options for attendance log retrieval
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOptions {
    pub mode: String, // "all" or "range"
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

/// Combined sync result (users + logs)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncAllResult {
    pub users: Vec<DeviceUser>,
    pub logs: Vec<AttendanceLog>,
}
