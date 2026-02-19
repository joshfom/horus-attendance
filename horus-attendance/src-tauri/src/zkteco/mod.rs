//! ZKTeco device communication module
//!
//! Implements the ZKTeco binary protocol over both TCP and UDP.
//! Devices try TCP first (port 4370), then fall back to UDP.

pub mod protocol;
pub mod tcp;
pub mod udp;
pub mod client;
pub mod commands;
pub mod types;
