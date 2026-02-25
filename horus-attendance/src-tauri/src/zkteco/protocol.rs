//! ZKTeco binary protocol: constants, packet encoding/decoding
//!
//! Faithfully mirrors the node-zklib protocol implementation.

use chrono::Datelike;

/// ZKTeco protocol command codes
#[allow(dead_code)]
pub mod cmd {
    pub const CMD_CONNECT: u16 = 1000;
    pub const CMD_EXIT: u16 = 1001;
    pub const CMD_ENABLEDEVICE: u16 = 1002;
    pub const CMD_DISABLEDEVICE: u16 = 1003;
    pub const CMD_RESTART: u16 = 1004;
    pub const CMD_POWEROFF: u16 = 1005;
    pub const CMD_GET_VERSION: u16 = 1100;
    pub const CMD_AUTH: u16 = 1102;
    pub const CMD_PREPARE_DATA: u16 = 1500;
    pub const CMD_DATA: u16 = 1501;
    pub const CMD_FREE_DATA: u16 = 1502;
    pub const CMD_DATA_WRRQ: u16 = 1503;
    pub const CMD_DATA_RDY: u16 = 1504;
    pub const CMD_DB_RRQ: u16 = 7;
    pub const CMD_USER_WRQ: u16 = 8;
    pub const CMD_USERTEMP_RRQ: u16 = 9;
    pub const CMD_OPTIONS_RRQ: u16 = 11;
    pub const CMD_ATTLOG_RRQ: u16 = 13;
    pub const CMD_CLEAR_ATTLOG: u16 = 15;
    pub const CMD_GET_FREE_SIZES: u16 = 50;
    pub const CMD_GET_TIME: u16 = 201;
    pub const CMD_SET_TIME: u16 = 202;
    pub const CMD_REG_EVENT: u16 = 500;

    // Response codes
    pub const CMD_ACK_OK: u16 = 2000;
    pub const CMD_ACK_ERROR: u16 = 2001;
    pub const CMD_ACK_DATA: u16 = 2002;
    pub const CMD_ACK_UNAUTH: u16 = 2005;
    pub const CMD_ACK_UNKNOWN: u16 = 0xFFFF;
    pub const CMD_ACK_ERROR_CMD: u16 = 0xFFFD;
    pub const CMD_ACK_ERROR_INIT: u16 = 0xFFFC;
    pub const CMD_ACK_ERROR_DATA: u16 = 0xFFFB;
}

pub const USHRT_MAX: u32 = 65535;
pub const MAX_CHUNK: usize = 65472;

/// Pre-built request data payloads
#[allow(dead_code)]
pub mod request_data {
    pub const DISABLE_DEVICE: &[u8] = &[0x00, 0x00, 0x00, 0x00];

    pub const GET_ATTENDANCE_LOGS: &[u8] = &[
        0x01, 0x0d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ];

    pub const GET_USERS: &[u8] = &[
        0x01, 0x09, 0x00, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ];
}

/// TCP packet prefix bytes
pub const TCP_PREFIX: [u8; 4] = [0x50, 0x50, 0x82, 0x7d];

/// Compute ZKTeco checksum over a packet buffer
pub fn create_checksum(buf: &[u8]) -> u16 {
    let mut chksum: u32 = 0;
    let mut i = 0;
    while i < buf.len() {
        if i == buf.len() - 1 {
            chksum += buf[i] as u32;
        } else {
            chksum += u16::from_le_bytes([buf[i], buf[i + 1]]) as u32;
        }
        chksum %= USHRT_MAX;
        i += 2;
    }
    chksum = USHRT_MAX - chksum - 1;
    chksum as u16
}

/// Decoded packet header
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct PacketHeader {
    pub command_id: u16,
    pub checksum: u16,
    pub session_id: u16,
    pub reply_id: u16,
}

/// Decode a UDP header (8 bytes)
pub fn decode_udp_header(data: &[u8]) -> PacketHeader {
    PacketHeader {
        command_id: u16::from_le_bytes([data[0], data[1]]),
        checksum: u16::from_le_bytes([data[2], data[3]]),
        session_id: u16::from_le_bytes([data[4], data[5]]),
        reply_id: u16::from_le_bytes([data[6], data[7]]),
    }
}

/// Decode a TCP header (16 bytes: 8 prefix + 8 payload header)
pub fn decode_tcp_header(data: &[u8]) -> (PacketHeader, u16) {
    let payload_size = u16::from_le_bytes([data[4], data[5]]);
    let recv = &data[8..];
    let header = PacketHeader {
        command_id: u16::from_le_bytes([recv[0], recv[1]]),
        checksum: u16::from_le_bytes([recv[2], recv[3]]),
        session_id: u16::from_le_bytes([recv[4], recv[5]]),
        reply_id: u16::from_le_bytes([recv[6], recv[7]]),
    };
    (header, payload_size)
}

/// Create a UDP packet: 8-byte header + data
/// The wire reply_id is `reply_id + 1` per ZKTeco / node-zklib convention.
pub fn create_udp_header(command: u16, session_id: u16, reply_id: u16, data: &[u8]) -> Vec<u8> {
    let mut buf = vec![0u8; 8 + data.len()];
    buf[0..2].copy_from_slice(&command.to_le_bytes());
    // checksum placeholder at 2..4
    buf[4..6].copy_from_slice(&session_id.to_le_bytes());
    // Write reply_id + 1 first, so checksum covers the actual wire value
    let next_reply = (reply_id.wrapping_add(1)) % (USHRT_MAX as u16);
    buf[6..8].copy_from_slice(&next_reply.to_le_bytes());
    buf[8..].copy_from_slice(data);

    let chksum = create_checksum(&buf);
    buf[2..4].copy_from_slice(&chksum.to_le_bytes());

    buf
}

/// Create a TCP packet: 8-byte TCP prefix + 8-byte header + data
/// The wire reply_id is `reply_id + 1` per ZKTeco / node-zklib convention.
pub fn create_tcp_header(command: u16, session_id: u16, reply_id: u16, data: &[u8]) -> Vec<u8> {
    // Build the inner 8+data portion (same as UDP header)
    let mut inner = vec![0u8; 8 + data.len()];
    inner[0..2].copy_from_slice(&command.to_le_bytes());
    inner[4..6].copy_from_slice(&session_id.to_le_bytes());
    // Write reply_id + 1 first, so checksum covers the actual wire value
    let next_reply = (reply_id.wrapping_add(1)) % (USHRT_MAX as u16);
    inner[6..8].copy_from_slice(&next_reply.to_le_bytes());
    inner[8..].copy_from_slice(data);

    let chksum = create_checksum(&inner);
    inner[2..4].copy_from_slice(&chksum.to_le_bytes());

    // Build the 8-byte TCP prefix
    let mut prefix = vec![0x50u8, 0x50, 0x82, 0x7d, 0x00, 0x00, 0x00, 0x00];
    let inner_len = inner.len() as u16;
    prefix[4..6].copy_from_slice(&inner_len.to_le_bytes());

    let mut result = prefix;
    result.extend_from_slice(&inner);
    result
}

/// Remove TCP prefix (first 8 bytes) if present
pub fn remove_tcp_header(buf: &[u8]) -> &[u8] {
    if buf.len() < 8 {
        return buf;
    }
    if buf[0..4] == TCP_PREFIX {
        &buf[8..]
    } else {
        buf
    }
}

/// Check if a UDP packet is a real-time event (not a command response)
pub fn check_not_event_udp(data: &[u8]) -> bool {
    if data.len() < 8 {
        return false;
    }
    let header = decode_udp_header(&data[0..8]);
    header.command_id == cmd::CMD_REG_EVENT
}

/// Check if a TCP packet is a real-time event
pub fn check_not_event_tcp(data: &[u8]) -> bool {
    let data = remove_tcp_header(data);
    if data.len() < 6 {
        return false;
    }
    let command_id = u16::from_le_bytes([data[0], data[1]]);
    let event = u16::from_le_bytes([data[4], data[5]]);
    event == 1 && command_id == cmd::CMD_REG_EVENT // EF_ATTLOG = 1
}

// ============================================================================
// Data record decoders
// ============================================================================

/// Decode a 28-byte user record (UDP format)
pub fn decode_user_data_28(data: &[u8]) -> (u16, String, String) {
    let uid = u16::from_le_bytes([data[0], data[1]]);
    let name = extract_ascii_string(&data[8..16]);
    let user_id = {
        let val = u32::from_le_bytes([data[24], data[25], data[26], data[27]]);
        val.to_string()
    };
    (uid, user_id, name)
}

/// Decode a 72-byte user record (TCP format)
pub fn decode_user_data_72(data: &[u8]) -> (u16, String, String) {
    let uid = u16::from_le_bytes([data[0], data[1]]);
    let name = extract_ascii_string(&data[11..35]);
    let user_id = extract_ascii_string(&data[48..57]);
    (uid, user_id, name)
}

/// Decode a 40-byte attendance record (TCP format)
pub fn decode_record_data_40(data: &[u8]) -> (String, String, u8, u8) {
    let device_user_id = extract_ascii_string(&data[2..11]);
    let verify_type = data[11];
    let in_out_state = data[12];
    let time_val = u32::from_le_bytes([data[27], data[28], data[29], data[30]]);
    let timestamp = parse_zk_time(time_val);
    (device_user_id, timestamp, verify_type, in_out_state)
}

/// Decode a 16-byte attendance record (UDP large-response format)
pub fn decode_record_data_16(data: &[u8]) -> (String, String, u8, u8) {
    let device_user_id = u16::from_le_bytes([data[0], data[1]]).to_string();
    let time_val = u32::from_le_bytes([data[4], data[5], data[6], data[7]]);
    let timestamp = parse_zk_time(time_val);
    (device_user_id, timestamp, 0, 0)
}

/// Decode an 8-byte attendance record (UDP small-response format)
pub fn decode_record_data_8(data: &[u8]) -> (String, String, u8, u8) {
    // Same structure as 16-byte but smaller
    let device_user_id = u16::from_le_bytes([data[0], data[1]]).to_string();
    let time_val = u32::from_le_bytes([data[4], data[5], data[6], data[7]]);
    let timestamp = parse_zk_time(time_val);
    (device_user_id, timestamp, 0, 0)
}

/// Parse ZKTeco encoded timestamp to ISO 8601 string
/// Uses chrono for date validation to avoid impossible dates (e.g., Feb 31)
pub fn parse_zk_time(mut time: u32) -> String {
    let second = (time % 60) as u32;
    time /= 60;
    let minute = (time % 60) as u32;
    time /= 60;
    let hour = (time % 24) as u32;
    time /= 24;
    let day = ((time % 31) + 1) as u32;
    time /= 31;
    let month = ((time % 12) + 1) as u32;
    time /= 12;
    let year = (time + 2000) as i32;

    // Validate date and clamp day if needed (e.g., day 31 in a 30-day month)
    if let Some(date) = chrono::NaiveDate::from_ymd_opt(year, month, day) {
        if let Some(dt) = date.and_hms_opt(hour, minute, second) {
            return dt.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
        }
    }

    // Fallback: clamp day to last valid day of the month
    let last_day = chrono::NaiveDate::from_ymd_opt(
        year,
        if month < 12 { month + 1 } else { 1 },
        1,
    )
    .unwrap_or_else(|| chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1).unwrap())
    .pred_opt()
    .unwrap()
    .day();

    let clamped_day = day.min(last_day);
    let date = chrono::NaiveDate::from_ymd_opt(year, month, clamped_day)
        .unwrap_or_else(|| chrono::NaiveDate::from_ymd_opt(2000, 1, 1).unwrap());
    let dt = date
        .and_hms_opt(hour.min(23), minute.min(59), second.min(59))
        .unwrap();
    dt.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// Extract a null-terminated ASCII string from a byte slice
pub fn extract_ascii_string(data: &[u8]) -> String {
    let end = data.iter().position(|&b| b == 0).unwrap_or(data.len());
    String::from_utf8_lossy(&data[..end]).trim().to_string()
}

/// Map command ID to error name
pub fn command_name(cmd_id: u16) -> &'static str {
    match cmd_id {
        2000 => "CMD_ACK_OK",
        2001 => "CMD_ACK_ERROR",
        2002 => "CMD_ACK_DATA",
        2003 => "CMD_ACK_RETRY",
        2004 => "CMD_ACK_REPEAT",
        2005 => "CMD_ACK_UNAUTH",
        0xFFFF => "CMD_ACK_UNKNOWN",
        0xFFFD => "CMD_ACK_ERROR_CMD",
        0xFFFC => "CMD_ACK_ERROR_INIT",
        0xFFFB => "CMD_ACK_ERROR_DATA",
        _ => "UNKNOWN_COMMAND",
    }
}
