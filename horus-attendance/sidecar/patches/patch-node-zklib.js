/**
 * Post-install patch for node-zklib
 * Fixes the hardcoded 10-second timeout in readWithBuffer that causes
 * truncated attendance data when downloading large datasets from ZKTeco devices.
 * 
 * Run: node patches/patch-node-zklib.js
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'node_modules', 'node-zklib', 'zklibtcp.js');

if (!fs.existsSync(filePath)) {
  console.log('[patch] node-zklib not found, skipping patch');
  process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf8');

// Check if already patched
if (content.includes('const timeout = 60000')) {
  console.log('[patch] node-zklib already patched');
  process.exit(0);
}

// Patch 1: Increase readWithBuffer chunk receiving timeout from 10s to 60s
const oldTimeout = 'const timeout = 10000';
const newTimeout = 'const timeout = 60000';

if (content.includes(oldTimeout)) {
  content = content.replace(oldTimeout, newTimeout);
  console.log('[patch] Increased readWithBuffer timeout from 10s to 60s');
} else {
  console.log('[patch] WARNING: Could not find timeout to patch');
}

// Patch 2: Add logging to getAttendances to detect truncation
const oldReturn = "return { data: records, err: data.err }";
const newReturn = `// Log truncation warnings
    if (data.err) {
      console.error('[node-zklib] WARNING: Data transfer error: ' + data.err.message + ' - data may be truncated!');
      console.error('[node-zklib] Received ' + data.data.length + ' bytes');
    }
    if (records.length > 0) {
      console.log('[node-zklib] Parsed ' + records.length + ' attendance records');
      console.log('[node-zklib] Date range: ' + records[0].recordTime.toISOString() + ' to ' + records[records.length-1].recordTime.toISOString());
    }
    return { data: records, err: data.err }`;

if (content.includes(oldReturn)) {
  content = content.replace(oldReturn, newReturn);
  console.log('[patch] Added truncation detection logging');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('[patch] node-zklib patched successfully!');
