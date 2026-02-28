#!/usr/bin/env python3
"""Quick TCP connectivity test to ZKTeco device"""
import socket, time

DEVICE_IP = "10.255.254.43"
DEVICE_PORT = 4370

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.settimeout(15)
print(f"Attempting TCP connect to {DEVICE_IP}:{DEVICE_PORT} (15s timeout)...")
start = time.time()
try:
    sock.connect((DEVICE_IP, DEVICE_PORT))
    elapsed = time.time() - start
    print(f"Connected in {elapsed:.1f}s!")
    sock.close()
except Exception as e:
    elapsed = time.time() - start
    print(f"Failed after {elapsed:.1f}s: {e}")
    etype = type(e).__name__
    errno_val = getattr(e, "errno", "N/A")
    print(f"Error type: {etype}, errno: {errno_val}")
