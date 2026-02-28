//! Tauri command handlers for ZKTeco device communication.
//!
//! These commands are invoked directly from the frontend,
//! replacing the old sidecar HTTP proxy approach.

use super::client::ZKClient;
use super::types::*;

/// Validate IP address format (basic IPv4 check)
fn validate_ip(ip: &str) -> Result<(), String> {
    let parts: Vec<&str> = ip.split('.').collect();
    if parts.len() != 4 {
        return Err(format!("Invalid IP address: {}", ip));
    }
    for part in &parts {
        match part.parse::<u8>() {
            Ok(_) => {}
            Err(_) => return Err(format!("Invalid IP address: {}", ip)),
        }
    }
    Ok(())
}

/// Validate port range
fn validate_port(port: u16) -> Result<(), String> {
    if port == 0 {
        return Err("Port cannot be 0".to_string());
    }
    Ok(())
}

/// Validate device config before use
fn validate_config(config: &DeviceConfig) -> Result<(), String> {
    validate_ip(&config.ip)?;
    validate_port(config.port)?;
    Ok(())
}

/// Test connection to a ZKTeco device
#[tauri::command]
pub async fn test_device_connection(config: DeviceConfig) -> Result<ConnectionTestResult, String> {
    validate_config(&config)?;
    log::info!(
        "[zkteco::cmd] test_device_connection {}:{}",
        config.ip,
        config.port
    );
    Ok(ZKClient::test_connection(&config).await)
}

/// Get device info (user count, log count, serial, firmware)
#[tauri::command]
pub async fn get_device_info(config: DeviceConfig) -> Result<DeviceInfo, String> {
    validate_config(&config)?;
    log::info!(
        "[zkteco::cmd] get_device_info {}:{}",
        config.ip,
        config.port
    );
    let mut client = ZKClient::connect(&config).await?;
    let info = client.get_device_info().await;
    let _ = client.disconnect().await;
    info
}

/// Get users from a ZKTeco device
#[tauri::command]
pub async fn get_device_users(config: DeviceConfig) -> Result<Vec<DeviceUser>, String> {
    validate_config(&config)?;
    log::info!(
        "[zkteco::cmd] get_device_users {}:{}",
        config.ip,
        config.port
    );
    let mut client = ZKClient::connect(&config).await?;
    let users = client.get_users().await;
    let _ = client.disconnect().await;
    users
}

/// Get attendance logs from a ZKTeco device
#[tauri::command]
pub async fn get_attendance_logs(
    config: DeviceConfig,
    options: Option<SyncOptions>,
) -> Result<Vec<AttendanceLog>, String> {
    validate_config(&config)?;
    log::info!(
        "[zkteco::cmd] get_attendance_logs {}:{}",
        config.ip,
        config.port
    );
    let mut client = ZKClient::connect(&config).await?;
    let logs = client.get_attendance_logs(options.as_ref()).await;
    let _ = client.disconnect().await;
    logs
}

/// Combined sync: get users AND attendance logs in one operation
/// Includes automatic retry on transient failures
#[tauri::command]
pub async fn sync_device_all(
    config: DeviceConfig,
    options: Option<SyncOptions>,
) -> Result<SyncAllResult, String> {
    validate_config(&config)?;
    log::info!(
        "[zkteco::cmd] sync_device_all {}:{}",
        config.ip,
        config.port
    );

    // Retry up to 3 times on transient connection failures, with increasing backoff
    let max_retries = 3;
    let mut last_error = String::new();

    for attempt in 0..=max_retries {
        if attempt > 0 {
            let delay_secs = attempt as u64 * 2; // 2s, 4s, 6s
            log::info!("[zkteco::cmd] Retry attempt {} for sync_device_all (waiting {}s)", attempt, delay_secs);
            tokio::time::sleep(std::time::Duration::from_secs(delay_secs)).await;
        }

        match ZKClient::sync_all(&config, options.as_ref()).await {
            Ok(result) => return Ok(result),
            Err(e) => {
                last_error = e.clone();
                // Only retry on connection/timeout errors, not auth failures
                let lower = e.to_lowercase();
                if lower.contains("auth") || lower.contains("denied") {
                    return Err(e);
                }
                log::warn!("[zkteco::cmd] sync_device_all attempt {} failed: {}", attempt, e);
            }
        }
    }

    Err(last_error)
}
