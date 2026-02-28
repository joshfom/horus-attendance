#!/usr/bin/env npx tsx
/**
 * Diagnostic script: Connect to ZKTeco device, fetch ALL data, and analyze
 * Usage: cd sidecar && npx tsx src/diagnose.ts [device-ip]
 */

const DEVICE_IP = process.argv[2] || '10.255.254.43';
const DEVICE_PORT = 4370;
const TIMEOUT = 60000; // 60 seconds

async function main() {
  console.log('='.repeat(60));
  console.log(`ZKTeco Device Diagnostic`);
  console.log(`Device: ${DEVICE_IP}:${DEVICE_PORT}`);
  console.log(`Timeout: ${TIMEOUT}ms`);
  console.log('='.repeat(60));

  // Dynamic import
  let ZKLib: any;
  try {
    const module = await import('node-zklib');
    ZKLib = module.default || module;
  } catch (e) {
    // Fallback: require
    ZKLib = require('node-zklib');
  }

  const zk = new ZKLib(DEVICE_IP, DEVICE_PORT, TIMEOUT, 4000);

  try {
    // Step 1: Connect
    console.log('\n[1] Connecting to device...');
    await zk.createSocket();
    console.log('    Connected successfully!');

    // Step 2: Get device info
    console.log('\n[2] Getting device info...');
    try {
      const info = await zk.getInfo();
      console.log(`    User count: ${info.userCounts}`);
      console.log(`    Log count:  ${info.logCounts}`);
      console.log(`    Log capacity: ${info.logCapacity}`);
    } catch (e: any) {
      console.log(`    Could not get info: ${e.message}`);
    }

    // Step 3: Get users
    console.log('\n[3] Fetching users...');
    const usersResult = await zk.getUsers();
    const users = usersResult?.data || [];
    console.log(`    Found ${users.length} users:`);
    for (const u of users) {
      console.log(`      uid=${u.uid}, userId="${u.userId}", name="${u.name}"`);
    }

    // Step 4: Disconnect and reconnect for attendance logs
    console.log('\n[4] Reconnecting for attendance logs...');
    await zk.disconnect();
    await new Promise(r => setTimeout(r, 1000));

    const zk2 = new ZKLib(DEVICE_IP, DEVICE_PORT, TIMEOUT, 4000);
    await zk2.createSocket();
    console.log('    Reconnected.');

    // Step 5: Get ALL attendance logs
    console.log('\n[5] Fetching ALL attendance logs (this may take a while)...');
    const startTime = Date.now();
    const logsResult = await zk2.getAttendances();
    const elapsed = Date.now() - startTime;
    const logs = logsResult?.data || [];
    const logErr = logsResult?.err;

    console.log(`    Fetch took: ${elapsed}ms`);
    console.log(`    Total records: ${logs.length}`);
    
    if (logErr) {
      console.log(`    ⚠️  TRANSFER ERROR: ${logErr.message}`);
      console.log(`    This means data may be TRUNCATED - not all records were received!`);
    } else {
      console.log(`    ✅ All data received successfully (no truncation)`);
    }

    // Step 6: Analyze date distribution
    if (logs.length > 0) {
      console.log('\n[6] Analyzing record date distribution...');
      
      const dateCount: Record<string, number> = {};
      const userIds = new Set<string>();
      let minDate: Date | null = null;
      let maxDate: Date | null = null;

      for (const log of logs) {
        const t = log.recordTime;
        if (t && !isNaN(t.getTime())) {
          const dateKey = t.toISOString().slice(0, 10);
          dateCount[dateKey] = (dateCount[dateKey] || 0) + 1;
          if (!minDate || t < minDate) minDate = t;
          if (!maxDate || t > maxDate) maxDate = t;
        }
        if (log.deviceUserId) userIds.add(log.deviceUserId);
      }

      console.log(`    Earliest record: ${minDate?.toISOString()}`);
      console.log(`    Latest record:   ${maxDate?.toISOString()}`);
      console.log(`    Unique user IDs: ${userIds.size} => [${[...userIds].join(', ')}]`);

      // Show records per day (sorted)
      const sortedDates = Object.keys(dateCount).sort();
      console.log(`\n    Records per day:`);
      for (const date of sortedDates) {
        console.log(`      ${date}: ${dateCount[date]} records`);
      }

      // Check for Feb 16 cutoff specifically
      const feb16Or17 = sortedDates.filter(d => d >= '2026-02-16' && d <= '2026-02-17');
      const afterFeb17 = sortedDates.filter(d => d > '2026-02-17');
      
      console.log(`\n    Records around Feb 16-17: ${feb16Or17.length > 0 ? feb16Or17.join(', ') : 'NONE'}`);
      console.log(`    Records after Feb 17:     ${afterFeb17.length > 0 ? afterFeb17.join(', ') : 'NONE'}`);
      
      if (afterFeb17.length === 0 && logErr) {
        console.log(`\n    ❌ DIAGNOSIS: Records after Feb 16/17 are missing because the data transfer`);
        console.log(`       TIMED OUT before all records could be downloaded from the device.`);
        console.log(`       The timeout has been increased from 10s to 60s - try syncing again.`);
      } else if (afterFeb17.length > 0) {
        console.log(`\n    ✅ Records after Feb 17 ARE present - the timeout fix is working!`);
      }

      // Show first 5 and last 5 records
      console.log('\n    First 5 records:');
      for (let i = 0; i < Math.min(5, logs.length); i++) {
        const l = logs[i];
        console.log(`      ${JSON.stringify({ userId: l.deviceUserId, time: l.recordTime?.toISOString(), verify: l.verifyType, inOut: l.inOutState })}`);
      }
      console.log('\n    Last 5 records:');
      for (let i = Math.max(0, logs.length - 5); i < logs.length; i++) {
        const l = logs[i];
        console.log(`      ${JSON.stringify({ userId: l.deviceUserId, time: l.recordTime?.toISOString(), verify: l.verifyType, inOut: l.inOutState })}`);
      }
    }

    await zk2.disconnect();

  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message || JSON.stringify(error)}`);
    
    if (error.code === 'EHOSTUNREACH' || error.errno === -65) {
      console.error('\nThe device is not reachable on the network.');
      console.error('Please check:');
      console.error('  1. The device is powered on');
      console.error('  2. The Ethernet cable is connected');
      console.error('  3. You are on the same network (10.255.254.x)');
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Diagnostic complete.');
}

main().catch(console.error);
