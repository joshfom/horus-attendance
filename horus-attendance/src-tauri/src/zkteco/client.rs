//! High-level ZKTeco client
//!
//! Tries TCP first, falls back to UDP (mirrors node-zklib behavior).
//! Provides a clean async API for Tauri commands.

use super::tcp::ZKTcp;
use super::types::*;
use super::udp::ZKUdp;

/// Connection type negotiated with the device
enum Transport {
    Tcp(ZKTcp),
    Udp(ZKUdp),
}

/// High-level ZKTeco device client
pub struct ZKClient {
    transport: Option<Transport>,
}

impl ZKClient {
    /// Create a new client and connect to the device.
    /// Tries TCP first, falls back to UDP.
    pub async fn connect(config: &DeviceConfig) -> Result<Self, String> {
        let ip = &config.ip;
        let port = config.port;
        let timeout_ms = config.timeout.unwrap_or(30000);
        let comm_key: u32 = config.comm_key.as_deref()
            .unwrap_or("0")
            .parse()
            .unwrap_or(0);

        // Try TCP first
        log::info!("[zkteco] Attempting TCP connection to {}:{} (timeout {}ms)", ip, port, timeout_ms);
        let mut tcp = ZKTcp::new(ip, port, timeout_ms);
        let tcp_error: String;
        match tcp.connect().await {
            Ok(()) => {
                // Authenticate if comm_key is set
                if comm_key > 0 {
                    if let Err(e) = tcp.auth(comm_key).await {
                        log::warn!("[zkteco] TCP auth failed: {}", e);
                        let _ = tcp.disconnect().await;
                        return Err(format!("Device authentication failed: {}", e));
                    }
                    log::info!("[zkteco] TCP auth successful");
                }
                log::info!("[zkteco] TCP connection established to {}:{}", ip, port);
                return Ok(Self {
                    transport: Some(Transport::Tcp(tcp)),
                });
            }
            Err(e) => {
                log::warn!("[zkteco] TCP failed ({}), trying UDP...", e);
                tcp_error = e;
                let _ = tcp.disconnect().await;
            }
        }

        // Fallback to UDP
        log::info!("[zkteco] Attempting UDP connection to {}:{}", ip, port);
        let mut udp = ZKUdp::new(ip, port, timeout_ms);
        match udp.connect().await {
            Ok(()) => {
                // Authenticate if comm_key is set
                if comm_key > 0 {
                    if let Err(e) = udp.auth(comm_key).await {
                        log::warn!("[zkteco] UDP auth failed: {}", e);
                        let _ = udp.disconnect().await;
                        return Err(format!("Device authentication failed: {}", e));
                    }
                    log::info!("[zkteco] UDP auth successful");
                }
                log::info!("[zkteco] UDP connection established to {}:{}", ip, port);
                Ok(Self {
                    transport: Some(Transport::Udp(udp)),
                })
            }
            Err(udp_error) => {
                // Include both TCP and UDP errors for better diagnostics
                let combined = format!(
                    "Failed to connect to device {}:{} — TCP: {} | UDP: {}",
                    ip, port, tcp_error, udp_error
                );
                Err(format_error(&combined))
            }
        }
    }

    /// Test connection and return device info
    pub async fn test_connection(config: &DeviceConfig) -> ConnectionTestResult {
        let start = std::time::Instant::now();

        match Self::connect(config).await {
            Ok(mut client) => {
                // Try to get device info
                let device_info = match client.get_device_info().await {
                    Ok(info) => Some(info),
                    Err(e) => {
                        log::warn!("[zkteco] Got connection but failed to get info: {}", e);
                        Some(DeviceInfo {
                            serial_number: "Unknown".to_string(),
                            firmware_version: "Unknown".to_string(),
                            user_count: 0,
                            log_count: 0,
                            last_activity: chrono::Utc::now().to_rfc3339(),
                        })
                    }
                };
                let _ = client.disconnect().await;
                ConnectionTestResult {
                    success: true,
                    device_info,
                    error: None,
                    latency: start.elapsed().as_millis() as u64,
                }
            }
            Err(e) => ConnectionTestResult {
                success: false,
                device_info: None,
                error: Some(format_error(&e)),
                latency: start.elapsed().as_millis() as u64,
            },
        }
    }

    /// Get device info (user count, log count)
    pub async fn get_device_info(&mut self) -> Result<DeviceInfo, String> {
        let (user_count, log_count) = match self.transport.as_mut() {
            Some(Transport::Tcp(tcp)) => tcp.get_info().await?,
            Some(Transport::Udp(udp)) => udp.get_info().await?,
            None => return Err("Not connected".to_string()),
        };

        Ok(DeviceInfo {
            serial_number: "Unknown".to_string(),
            firmware_version: "Unknown".to_string(),
            user_count,
            log_count,
            last_activity: chrono::Utc::now().to_rfc3339(),
        })
    }

    /// Get all users from the device
    pub async fn get_users(&mut self) -> Result<Vec<DeviceUser>, String> {
        let raw_users = match self.transport.as_mut() {
            Some(Transport::Tcp(tcp)) => tcp.get_users().await?,
            Some(Transport::Udp(udp)) => udp.get_users().await?,
            None => return Err("Not connected".to_string()),
        };

        log::info!("[zkteco] Retrieved {} users from device", raw_users.len());

        Ok(raw_users
            .into_iter()
            .map(|(_uid, user_id, name)| {
                let display_name = if name.is_empty() {
                    format!("User {}", user_id)
                } else {
                    name
                };
                DeviceUser {
                    device_user_id: user_id,
                    device_name: display_name,
                }
            })
            .collect())
    }

    /// Get attendance logs from the device, optionally filtered by date range
    pub async fn get_attendance_logs(
        &mut self,
        options: Option<&SyncOptions>,
    ) -> Result<Vec<AttendanceLog>, String> {
        let raw_records = match self.transport.as_mut() {
            Some(Transport::Tcp(tcp)) => tcp.get_attendances().await?,
            Some(Transport::Udp(udp)) => udp.get_attendances().await?,
            None => return Err("Not connected".to_string()),
        };

        log::info!(
            "[zkteco] Retrieved {} attendance records from device",
            raw_records.len()
        );

        let mut logs: Vec<AttendanceLog> = raw_records
            .into_iter()
            .map(|(device_user_id, timestamp, verify_type, punch_type)| AttendanceLog {
                device_user_id,
                timestamp,
                verify_type,
                punch_type,
            })
            .collect();

        // Apply date range filter if specified
        if let Some(opts) = options {
            if opts.mode == "range" {
                if let (Some(start), Some(end)) = (&opts.start_date, &opts.end_date) {
                    // Ensure start_str begins at midnight and end_str covers the full end day.
                    // Without the "T23:59:59" suffix, records ON the end date are excluded
                    // because "2026-02-28T09:00:00" > "2026-02-28" in string comparison.
                    let start_str = if start.contains('T') {
                        start.clone()
                    } else {
                        format!("{}T00:00:00", start)
                    };
                    let end_str = if end.contains('T') {
                        end.clone()
                    } else {
                        format!("{}T23:59:59", end)
                    };
                    logs.retain(|log| {
                        log.timestamp >= start_str && log.timestamp <= end_str
                    });
                    log::info!(
                        "[zkteco] After date filter ({} to {}): {} records remain",
                        start_str, end_str, logs.len()
                    );
                }
            }
        }

        Ok(logs)
    }

    /// Combined sync: get users AND attendance logs in one session
    pub async fn sync_all(
        config: &DeviceConfig,
        options: Option<&SyncOptions>,
    ) -> Result<SyncAllResult, String> {
        log::info!(
            "[zkteco] Starting combined sync for device {}:{}",
            config.ip,
            config.port
        );

        let mut client = Self::connect(config).await?;

        // Get users first
        let users = client.get_users().await?;
        log::info!("[zkteco] Got {} users", users.len());

        // Disconnect and reconnect for attendance logs
        // (device needs a fresh connection, mirrors sidecar behavior)
        let _ = client.disconnect().await;

        // Retry reconnection up to 3 times with increasing delays.
        // ZKTeco devices are slow to release the TCP socket after disconnect.
        let mut logs = Vec::new();
        let mut last_err = String::new();
        for attempt in 0..3 {
            let delay_ms = 500 + (attempt as u64 * 500); // 500ms, 1000ms, 1500ms
            tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;

            match Self::connect(config).await {
                Ok(mut reconnected) => {
                    match reconnected.get_attendance_logs(options).await {
                        Ok(fetched) => {
                            log::info!("[zkteco] Got {} attendance logs (attempt {})", fetched.len(), attempt + 1);
                            logs = fetched;
                            let _ = reconnected.disconnect().await;
                            last_err.clear();
                            break;
                        }
                        Err(e) => {
                            log::warn!("[zkteco] get_attendance_logs failed on attempt {}: {}", attempt + 1, e);
                            last_err = e;
                            let _ = reconnected.disconnect().await;
                        }
                    }
                }
                Err(e) => {
                    log::warn!("[zkteco] Reconnect attempt {} failed: {}", attempt + 1, e);
                    last_err = e;
                }
            }
        }

        if !last_err.is_empty() && logs.is_empty() {
            return Err(format!("Got {} users but failed to fetch attendance logs: {}", users.len(), last_err));
        }

        Ok(SyncAllResult { users, logs })
    }

    /// Disconnect from the device
    pub async fn disconnect(&mut self) -> Result<(), String> {
        match self.transport.take() {
            Some(Transport::Tcp(mut tcp)) => tcp.disconnect().await,
            Some(Transport::Udp(mut udp)) => udp.disconnect().await,
            None => Ok(()),
        }
    }
}

/// Format error messages for user-friendly display
fn format_error(error: &str) -> String {
    let lower = error.to_lowercase();

    // Device unreachable — common on macOS when ARP/ICMP fails
    if lower.contains("no route to host")
        || lower.contains("ehostunreach")
        || lower.contains("host unreachable")
        || lower.contains("broken pipe")
        || lower.contains("os error 32")
        || lower.contains("os error 65")
    {
        return format!(
            "Device is unreachable — make sure the ZKTeco device is powered on, \
             connected to the network, and on the same subnet as this computer. \
             ({})",
            error
        );
    }
    if lower.contains("timeout") || lower.contains("etimedout") {
        return format!(
            "Connection timeout — the device did not respond in time. \
             It may be off, unreachable, or the IP/port may be wrong. ({})",
            error
        );
    }
    if lower.contains("econnrefused") || lower.contains("connection refused") {
        return "Connection refused — check if device is powered on and network accessible"
            .to_string();
    }
    if lower.contains("auth") || lower.contains("password") {
        return "Authentication failed — check communication key".to_string();
    }

    error.to_string()
}
