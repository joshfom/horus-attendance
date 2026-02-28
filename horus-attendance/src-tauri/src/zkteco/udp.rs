//! ZKTeco UDP transport
//!
//! Implements the ZKTeco protocol over UDP (fallback transport).
//! Used when TCP connection to port 4370 is refused.

use std::net::SocketAddr;
use std::time::Duration;
use tokio::net::UdpSocket;
use tokio::time::timeout;

use super::protocol::*;

/// UDP transport for ZKTeco protocol
pub struct ZKUdp {
    ip: String,
    port: u16,
    timeout_ms: u64,
    socket: Option<UdpSocket>,
    session_id: u16,
    reply_id: u16,
}

impl ZKUdp {
    pub fn new(ip: &str, port: u16, timeout_ms: u64) -> Self {
        Self {
            ip: ip.to_string(),
            port,
            timeout_ms,
            socket: None,
            session_id: 0,
            reply_id: 0,
        }
    }

    /// Bind a local UDP socket and send CMD_CONNECT
    pub async fn connect(&mut self) -> Result<(), String> {
        // Bind to any available local port
        let socket = UdpSocket::bind("0.0.0.0:0")
            .await
            .map_err(|e| format!("Failed to bind UDP socket: {}", e))?;

        let addr: SocketAddr = format!("{}:{}", self.ip, self.port)
            .parse()
            .map_err(|e| format!("Invalid device address: {}", e))?;

        socket
            .connect(addr)
            .await
            .map_err(|e| format!("UDP connect failed: {}", e))?;

        self.socket = Some(socket);
        self.session_id = 0;
        self.reply_id = 0;

        let reply = self.execute_cmd(cmd::CMD_CONNECT, &[]).await?;
        if reply.len() >= 6 {
            self.session_id = u16::from_le_bytes([reply[4], reply[5]]);
        }

        Ok(())
    }

    /// Authenticate with comm_key (CMD_AUTH). Required when device has a password set.
    pub async fn auth(&mut self, comm_key: u32) -> Result<(), String> {
        let mut auth_data = vec![0u8; 4];
        auth_data[0..4].copy_from_slice(&comm_key.to_le_bytes());
        let reply = self.execute_cmd(cmd::CMD_AUTH, &auth_data).await?;
        if reply.len() >= 2 {
            let cmd_id = u16::from_le_bytes([reply[0], reply[1]]);
            if cmd_id == cmd::CMD_ACK_OK {
                return Ok(());
            }
            return Err(format!("Device authentication failed (response: {})", command_name(cmd_id)));
        }
        Err("Device authentication failed: empty response".to_string())
    }

    /// Execute a command and wait for reply
    pub async fn execute_cmd(&mut self, command: u16, data: &[u8]) -> Result<Vec<u8>, String> {
        if command == cmd::CMD_CONNECT {
            self.session_id = 0;
            self.reply_id = 0;
        } else {
            self.reply_id = self.reply_id.wrapping_add(1);
        }

        let buf = create_udp_header(command, self.session_id, self.reply_id, data);
        let socket = self.socket.as_ref().ok_or("UDP not connected")?;

        socket
            .send(&buf)
            .await
            .map_err(|e| format!("UDP send failed: {}", e))?;

        // Use full timeout for all commands — high-latency devices need more than 2s
        let dur = Duration::from_millis(self.timeout_ms);

        let mut resp_buf = vec![0u8; 65536];
        let n = timeout(dur, socket.recv(&mut resp_buf))
            .await
            .map_err(|_| "Timeout waiting for UDP response".to_string())?
            .map_err(|e| format!("UDP recv failed: {}", e))?;

        Ok(resp_buf[..n].to_vec())
    }

    /// Send a chunk request
    fn build_chunk_request(&mut self, start: u32, size: u32) -> Vec<u8> {
        self.reply_id = self.reply_id.wrapping_add(1);
        let mut req_data = vec![0u8; 8];
        req_data[0..4].copy_from_slice(&start.to_le_bytes());
        req_data[4..8].copy_from_slice(&size.to_le_bytes());
        create_udp_header(cmd::CMD_DATA_RDY, self.session_id, self.reply_id, &req_data)
    }

    /// Read large data via multi-packet protocol
    pub async fn read_with_buffer(&mut self, req_data: &[u8]) -> Result<(Vec<u8>, bool), String> {
        self.reply_id = self.reply_id.wrapping_add(1);
        let buf = create_udp_header(cmd::CMD_DATA_WRRQ, self.session_id, self.reply_id, req_data);

        let socket = self.socket.as_ref().ok_or("UDP not connected")?;
        socket
            .send(&buf)
            .await
            .map_err(|e| format!("UDP send failed: {}", e))?;

        // Wait for initial response
        let dur = Duration::from_millis(self.timeout_ms);
        let mut resp_buf = vec![0u8; 65536];
        let n = timeout(dur, socket.recv(&mut resp_buf))
            .await
            .map_err(|_| "Timeout receiving data request response".to_string())?
            .map_err(|e| format!("UDP recv failed: {}", e))?;

        let reply = &resp_buf[..n];

        if reply.len() < 8 {
            return Err("Response too short".to_string());
        }

        let header = decode_udp_header(&reply[0..8]);

        match header.command_id {
            cmd::CMD_DATA => {
                // Small data — single packet response
                Ok((reply[8..].to_vec(), true))
            }
            cmd::CMD_ACK_OK | cmd::CMD_PREPARE_DATA => {
                // Large data — multi-packet
                let recv_data = &reply[8..];
                if recv_data.len() < 5 {
                    return Err("Prepare data response too short".to_string());
                }
                let size = u32::from_le_bytes([
                    recv_data[1],
                    recv_data[2],
                    recv_data[3],
                    recv_data[4],
                ]) as usize;

                let remain = size % MAX_CHUNK;
                let total_packets = (size + MAX_CHUNK - 1) / MAX_CHUNK; // ceil division

                let mut total_buffer = Vec::with_capacity(size);

                // Send all chunk requests
                for i in 0..total_packets {
                    let start = i * MAX_CHUNK;
                    let chunk_size = if i == total_packets - 1 && remain > 0 {
                        remain
                    } else {
                        MAX_CHUNK
                    };
                    let chunk_buf =
                        self.build_chunk_request(start as u32, chunk_size as u32);
                    let socket = self.socket.as_ref().ok_or("UDP not connected")?;
                    socket
                        .send(&chunk_buf)
                        .await
                        .map_err(|e| format!("UDP send chunk request failed: {}", e))?;
                }

                // Receive chunks
                // Scale timeout with data size: base 60s + 30s per chunk.
                let chunk_timeout_secs = 60 + (total_packets as u64 * 30);
                log::info!(
                    "[zkteco] UDP: expecting {} bytes in {} chunks, timeout {}s",
                    size, total_packets, chunk_timeout_secs
                );
                let chunk_timeout = Duration::from_secs(chunk_timeout_secs);
                let deadline = tokio::time::Instant::now() + chunk_timeout;

                while total_buffer.len() < size {
                    let remaining_time = deadline.saturating_duration_since(tokio::time::Instant::now());
                    if remaining_time.is_zero() {
                        return Err(format!(
                            "Timeout receiving UDP chunks, got {}/{} bytes",
                            total_buffer.len(),
                            size
                        ));
                    }

                    let socket = self.socket.as_ref().ok_or("UDP not connected")?;
                    let n = timeout(remaining_time, socket.recv(&mut resp_buf))
                        .await
                        .map_err(|_| {
                            format!(
                                "Timeout receiving UDP chunk, got {}/{} bytes",
                                total_buffer.len(),
                                size
                            )
                        })?
                        .map_err(|e| format!("UDP recv chunk failed: {}", e))?;

                    let chunk = &resp_buf[..n];

                    // Skip event packets
                    if check_not_event_udp(chunk) {
                        continue;
                    }

                    if chunk.len() < 8 {
                        continue;
                    }

                    let chunk_header = decode_udp_header(&chunk[0..8]);
                    match chunk_header.command_id {
                        cmd::CMD_PREPARE_DATA => {
                            // Info packet, skip
                        }
                        cmd::CMD_DATA => {
                            total_buffer.extend_from_slice(&chunk[8..]);
                        }
                        cmd::CMD_ACK_OK => {
                            if total_buffer.len() >= size {
                                break;
                            }
                        }
                        _ => {}
                    }
                }

                Ok((total_buffer, false))
            }
            _ => Err(format!(
                "Unexpected command in data response: {} ({})",
                header.command_id,
                command_name(header.command_id)
            )),
        }
    }

    /// Get users from device (UDP uses 28-byte records)
    pub async fn get_users(&mut self) -> Result<Vec<(u16, String, String)>, String> {
        self.free_data().await.ok();

        let (data, _is_small) = self.read_with_buffer(request_data::GET_USERS).await?;

        self.free_data().await.ok();

        let user_packet_size = 28;
        if data.len() < 4 {
            return Ok(vec![]);
        }
        let mut user_data = &data[4..];
        let mut users = Vec::new();

        while user_data.len() >= user_packet_size {
            let user = decode_user_data_28(&user_data[..user_packet_size]);
            users.push(user);
            user_data = &user_data[user_packet_size..];
        }

        Ok(users)
    }

    /// Get attendance logs from device (UDP uses 16-byte records, small uses 8-byte)
    pub async fn get_attendances(&mut self) -> Result<Vec<(String, String, u8, u8)>, String> {
        self.free_data().await.ok();

        let (data, is_small) = self
            .read_with_buffer(request_data::GET_ATTENDANCE_LOGS)
            .await?;

        self.free_data().await.ok();

        if data.len() < 4 {
            return Ok(vec![]);
        }
        let mut record_data = &data[4..];
        let mut records = Vec::new();

        if is_small {
            // Small response: 8-byte records
            let record_packet_size = 8;
            while record_data.len() >= record_packet_size {
                let record = decode_record_data_8(&record_data[..record_packet_size]);
                records.push(record);
                record_data = &record_data[record_packet_size..];
            }
        } else {
            // Normal response: 16-byte records
            let record_packet_size = 16;
            while record_data.len() >= record_packet_size {
                let record = decode_record_data_16(&record_data[..record_packet_size]);
                records.push(record);
                record_data = &record_data[record_packet_size..];
            }
        }

        Ok(records)
    }

    /// Get device info
    pub async fn get_info(&mut self) -> Result<(u32, u32), String> {
        let reply = self.execute_cmd(cmd::CMD_GET_FREE_SIZES, &[]).await?;
        let payload = if reply.len() > 8 { &reply[8..] } else { &reply };
        if payload.len() >= 76 {
            let user_count = u32::from_le_bytes([
                payload[24],
                payload[25],
                payload[26],
                payload[27],
            ]);
            let log_count = u32::from_le_bytes([
                payload[40],
                payload[41],
                payload[42],
                payload[43],
            ]);
            Ok((user_count, log_count))
        } else {
            Ok((0, 0))
        }
    }

    /// Free data buffer
    pub async fn free_data(&mut self) -> Result<(), String> {
        self.execute_cmd(cmd::CMD_FREE_DATA, &[]).await?;
        Ok(())
    }

    /// Disconnect
    pub async fn disconnect(&mut self) -> Result<(), String> {
        if self.socket.is_some() {
            let _ = self.execute_cmd(cmd::CMD_EXIT, &[]).await;
            self.socket = None;
        }
        Ok(())
    }
}

impl Drop for ZKUdp {
    fn drop(&mut self) {
        // Best-effort cleanup: drop the UDP socket
        self.socket.take();
    }
}
