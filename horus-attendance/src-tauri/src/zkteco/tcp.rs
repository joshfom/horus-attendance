//! ZKTeco TCP transport
//!
//! Implements the ZKTeco protocol over TCP (primary transport).
//! Devices are connected on port 4370 via TCP first.

use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

use super::protocol::*;

/// TCP transport for ZKTeco protocol
pub struct ZKTcp {
    ip: String,
    port: u16,
    timeout_ms: u64,
    stream: Option<TcpStream>,
    session_id: u16,
    reply_id: u16,
}

impl ZKTcp {
    pub fn new(ip: &str, port: u16, timeout_ms: u64) -> Self {
        Self {
            ip: ip.to_string(),
            port,
            timeout_ms,
            stream: None,
            session_id: 0,
            reply_id: 0,
        }
    }

    /// Connect TCP socket and send CMD_CONNECT
    pub async fn connect(&mut self) -> Result<(), String> {
        let addr = format!("{}:{}", self.ip, self.port);
        let dur = Duration::from_millis(self.timeout_ms.min(5000));

        let stream = timeout(dur, TcpStream::connect(&addr))
            .await
            .map_err(|_| format!("TCP connect timeout to {}", addr))?
            .map_err(|e| format!("TCP connect failed to {}: {}", addr, e))?;

        self.stream = Some(stream);

        // Send CMD_CONNECT
        self.session_id = 0;
        self.reply_id = 0;

        let reply = self.execute_cmd(cmd::CMD_CONNECT, &[]).await?;
        let inner = remove_tcp_header(&reply);
        if inner.len() >= 6 {
            self.session_id = u16::from_le_bytes([inner[4], inner[5]]);
        }

        Ok(())
    }

    /// Authenticate with comm_key (CMD_AUTH). Required when device has a password set.
    pub async fn auth(&mut self, comm_key: u32) -> Result<(), String> {
        let mut auth_data = vec![0u8; 4];
        auth_data[0..4].copy_from_slice(&comm_key.to_le_bytes());
        let reply = self.execute_cmd(cmd::CMD_AUTH, &auth_data).await?;
        let inner = remove_tcp_header(&reply);
        if inner.len() >= 2 {
            let cmd_id = u16::from_le_bytes([inner[0], inner[1]]);
            if cmd_id == cmd::CMD_ACK_OK {
                return Ok(());
            }
            return Err(format!("Device authentication failed (response: {})", command_name(cmd_id)));
        }
        Err("Device authentication failed: empty response".to_string())
    }

    /// Execute a command and wait for a single response
    pub async fn execute_cmd(&mut self, command: u16, data: &[u8]) -> Result<Vec<u8>, String> {
        if command == cmd::CMD_CONNECT {
            self.session_id = 0;
            self.reply_id = 0;
        } else {
            self.reply_id = self.reply_id.wrapping_add(1);
        }

        let buf = create_tcp_header(command, self.session_id, self.reply_id, data);
        let stream = self.stream.as_mut().ok_or("TCP not connected")?;

        stream
            .write_all(&buf)
            .await
            .map_err(|e| format!("TCP write failed: {}", e))?;

        let is_connect = command == cmd::CMD_CONNECT || command == cmd::CMD_EXIT;
        let dur = Duration::from_millis(if is_connect { 2000 } else { self.timeout_ms });

        let mut resp_buf = vec![0u8; 65536];
        let n = timeout(dur, stream.read(&mut resp_buf))
            .await
            .map_err(|_| "Timeout waiting for TCP response".to_string())?
            .map_err(|e| format!("TCP read failed: {}", e))?;

        if n == 0 {
            return Err("Connection closed by device".to_string());
        }

        Ok(resp_buf[..n].to_vec())
    }

    /// Send a chunk request during multi-packet data transfer
    fn build_chunk_request(&mut self, start: u32, size: u32) -> Vec<u8> {
        self.reply_id = self.reply_id.wrapping_add(1);
        let mut req_data = vec![0u8; 8];
        req_data[0..4].copy_from_slice(&start.to_le_bytes());
        req_data[4..8].copy_from_slice(&size.to_le_bytes());
        create_tcp_header(cmd::CMD_DATA_RDY, self.session_id, self.reply_id, &req_data)
    }

    /// Read large data (users or attendance) via multi-packet protocol
    pub async fn read_with_buffer(&mut self, req_data: &[u8]) -> Result<(Vec<u8>, bool), String> {
        self.reply_id = self.reply_id.wrapping_add(1);
        let buf = create_tcp_header(cmd::CMD_DATA_WRRQ, self.session_id, self.reply_id, req_data);

        let stream = self.stream.as_mut().ok_or("TCP not connected")?;
        stream
            .write_all(&buf)
            .await
            .map_err(|e| format!("TCP write failed: {}", e))?;

        // Read initial response
        let dur = Duration::from_millis(self.timeout_ms);
        let mut reply_buf = Vec::with_capacity(65536);
        let mut tmp = vec![0u8; 65536];

        // Accumulate data until we have at least a full header
        loop {
            let n = timeout(dur, stream.read(&mut tmp))
                .await
                .map_err(|_| "Timeout receiving data request response".to_string())?
                .map_err(|e| format!("TCP read failed: {}", e))?;
            if n == 0 {
                return Err("Connection closed during data request".to_string());
            }
            reply_buf.extend_from_slice(&tmp[..n]);

            // Need at least 16 bytes for TCP header
            if reply_buf.len() >= 16 {
                break;
            }
        }

        let (header, _payload_size) = decode_tcp_header(&reply_buf);

        match header.command_id {
            cmd::CMD_DATA => {
                // Small data response — all data in one packet
                let data = reply_buf[16..].to_vec();
                Ok((data, true))
            }
            cmd::CMD_ACK_OK | cmd::CMD_PREPARE_DATA => {
                // Large data — need to receive in chunks
                let recv_data = &reply_buf[16..];
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

                let mut reply_data = Vec::with_capacity(size);
                let mut total_buffer = Vec::new();
                let mut real_total_buffer = Vec::new();
                let mut packets_remaining = total_packets;

                // Pre-build all chunk requests (avoids borrow conflict with stream)
                let mut chunk_requests = Vec::new();
                for i in 0..total_packets {
                    let start = i * MAX_CHUNK;
                    let chunk_size = if i == total_packets - 1 && remain > 0 {
                        remain
                    } else {
                        MAX_CHUNK
                    };
                    let chunk_buf =
                        self.build_chunk_request(start as u32, chunk_size as u32);
                    chunk_requests.push(chunk_buf);
                }

                // Send all chunk requests
                let stream = self.stream.as_mut().ok_or("TCP not connected")?;
                for chunk_buf in &chunk_requests {
                    stream
                        .write_all(chunk_buf)
                        .await
                        .map_err(|e| format!("TCP write chunk request failed: {}", e))?;
                }

                // Receive all chunk responses
                // Scale timeout with data size: base 60s + 30s per chunk.
                // For 11k records (~464KB, ~8 chunks) this gives ~300s.
                let chunk_timeout_secs = 60 + (total_packets as u64 * 30);
                log::info!(
                    "[zkteco] TCP: expecting {} bytes in {} chunks, timeout {}s",
                    size, total_packets, chunk_timeout_secs
                );
                let chunk_timeout = Duration::from_secs(chunk_timeout_secs);
                let deadline = tokio::time::Instant::now() + chunk_timeout;

                while packets_remaining > 0 {
                    let remaining_time = deadline.saturating_duration_since(tokio::time::Instant::now());
                    if remaining_time.is_zero() {
                        return Err(format!(
                            "Timeout receiving chunks, {} packets remain, got {}/{} bytes",
                            packets_remaining,
                            reply_data.len(),
                            size
                        ));
                    }

                    let stream = self.stream.as_mut().ok_or("TCP not connected")?;
                    let n = timeout(remaining_time, stream.read(&mut tmp))
                        .await
                        .map_err(|_| {
                            format!(
                                "Timeout receiving chunk data, {} packets remain",
                                packets_remaining
                            )
                        })?
                        .map_err(|e| format!("TCP read chunk failed: {}", e))?;

                    if n == 0 {
                        return Err("Connection closed during chunk transfer".to_string());
                    }

                    // Skip real-time event packets
                    if check_not_event_tcp(&tmp[..n]) {
                        continue;
                    }

                    total_buffer.extend_from_slice(&tmp[..n]);

                    // Process complete packets from total_buffer
                    while total_buffer.len() >= 8 {
                        let packet_length =
                            u16::from_le_bytes([total_buffer[4], total_buffer[5]]) as usize;

                        if total_buffer.len() < 8 + packet_length {
                            break; // Wait for more data
                        }

                        real_total_buffer
                            .extend_from_slice(&total_buffer[16..8 + packet_length]);
                        total_buffer = total_buffer[8 + packet_length..].to_vec();

                        let expected_size = if packets_remaining > 1 {
                            MAX_CHUNK + 8
                        } else {
                            remain + 8
                        };

                        if real_total_buffer.len() >= expected_size {
                            if real_total_buffer.len() > 8 {
                                reply_data.extend_from_slice(&real_total_buffer[8..]);
                            }
                            real_total_buffer.clear();
                            packets_remaining -= 1;
                        }
                    }
                }

                Ok((reply_data, false))
            }
            _ => Err(format!(
                "Unexpected command in data response: {} ({})",
                header.command_id,
                command_name(header.command_id)
            )),
        }
    }

    /// Get users from device (TCP uses 72-byte records)
    pub async fn get_users(&mut self) -> Result<Vec<(u16, String, String)>, String> {
        self.free_data().await.ok();

        let (data, _is_small) = self.read_with_buffer(request_data::GET_USERS).await?;

        self.free_data().await.ok();

        let user_packet_size = 72;
        if data.len() < 4 {
            return Ok(vec![]);
        }
        let mut user_data = &data[4..];
        let mut users = Vec::new();

        while user_data.len() >= user_packet_size {
            let user = decode_user_data_72(&user_data[..user_packet_size]);
            users.push(user);
            user_data = &user_data[user_packet_size..];
        }

        Ok(users)
    }

    /// Get attendance logs from device (TCP uses 40-byte records)
    pub async fn get_attendances(&mut self) -> Result<Vec<(String, String, u8, u8)>, String> {
        self.free_data().await.ok();

        let (data, _is_small) = self
            .read_with_buffer(request_data::GET_ATTENDANCE_LOGS)
            .await?;

        self.free_data().await.ok();

        let record_packet_size = 40;
        if data.len() < 4 {
            return Ok(vec![]);
        }
        let mut record_data = &data[4..];
        let mut records = Vec::new();

        while record_data.len() >= record_packet_size {
            let record = decode_record_data_40(&record_data[..record_packet_size]);
            records.push(record);
            record_data = &record_data[record_packet_size..];
        }

        Ok(records)
    }

    /// Get device info (free sizes)
    pub async fn get_info(&mut self) -> Result<(u32, u32), String> {
        let reply = self.execute_cmd(cmd::CMD_GET_FREE_SIZES, &[]).await?;
        let data = remove_tcp_header(&reply);
        // user count at offset 24, log count at offset 40 (relative to data after header)
        let payload = if data.len() > 8 { &data[8..] } else { data };
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
            // Fallback: can't parse, return 0
            Ok((0, 0))
        }
    }

    /// Free data buffer on device
    pub async fn free_data(&mut self) -> Result<(), String> {
        self.execute_cmd(cmd::CMD_FREE_DATA, &[]).await?;
        Ok(())
    }

    /// Disconnect from device
    pub async fn disconnect(&mut self) -> Result<(), String> {
        if self.stream.is_some() {
            let _ = self.execute_cmd(cmd::CMD_EXIT, &[]).await;
            if let Some(mut stream) = self.stream.take() {
                let _ = stream.shutdown().await;
            }
        }
        Ok(())
    }
}

impl Drop for ZKTcp {
    fn drop(&mut self) {
        // Best-effort cleanup: drop the TCP stream
        // (cannot send CMD_EXIT since Drop is sync, but the stream will close)
        self.stream.take();
    }
}
