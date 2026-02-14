/**
 * Dashboard Service
 * Provides aggregated statistics for the dashboard
 * Requirements: 12.1, 12.2
 */

import { listDevices } from '../repositories/device.repository';
import { getActiveUserCount } from '../repositories/user.repository';
import { getSummariesForDate } from '../repositories/attendance-summary.repository';
import type { DailySummary } from '../../types';

export interface DashboardStats {
  lastSyncAt: string | null;
  totalActiveUsers: number;
  todayStats: TodayAttendanceStats;
}

export interface TodayAttendanceStats {
  date: string;
  checkedIn: number;
  notCheckedIn: number;
  late: number;
  onLeave: number;
  incomplete: number;
}

/**
 * Get the last sync time from all devices
 */
export async function getLastSyncTime(): Promise<string | null> {
  const devices = await listDevices();
  if (devices.length === 0) return null;
  
  // Find the most recent sync time across all devices
  let lastSync: string | null = null;
  for (const device of devices) {
    if (device.lastSyncAt) {
      if (!lastSync || device.lastSyncAt > lastSync) {
        lastSync = device.lastSyncAt;
      }
    }
  }
  return lastSync;
}

/**
 * Get today's attendance statistics
 */
export async function getTodayAttendanceStats(): Promise<TodayAttendanceStats> {
  const today = new Date().toISOString().split('T')[0] ?? '';
  const totalActiveUsers = await getActiveUserCount();
  const summaries = await getSummariesForDate(today);
  
  // Count users by status
  let checkedIn = 0;
  let late = 0;
  let incomplete = 0;
  
  for (const summary of summaries) {
    if (summary.checkInTime) {
      checkedIn++;
    }
    if (summary.status === 'late') {
      late++;
    }
    if (summary.isIncomplete) {
      incomplete++;
    }
  }
  
  // Users not checked in = total active users - users with check-in
  const notCheckedIn = Math.max(0, totalActiveUsers - checkedIn);
  
  return {
    date: today,
    checkedIn,
    notCheckedIn,
    late,
    onLeave: 0, // Leave tracking not implemented yet
    incomplete,
  };
}

/**
 * Get all dashboard statistics
 */
export async function getDashboardStats(): Promise<DashboardStats> {
  const [lastSyncAt, totalActiveUsers, todayStats] = await Promise.all([
    getLastSyncTime(),
    getActiveUserCount(),
    getTodayAttendanceStats(),
  ]);
  
  return {
    lastSyncAt,
    totalActiveUsers,
    todayStats,
  } as DashboardStats;
}

/**
 * Calculate dashboard statistics from provided data (for testing)
 */
export function calculateTodayStats(
  summaries: DailySummary[],
  totalActiveUsers: number,
  date: string
): TodayAttendanceStats {
  let checkedIn = 0;
  let late = 0;
  let incomplete = 0;
  
  for (const summary of summaries) {
    if (summary.checkInTime) {
      checkedIn++;
    }
    if (summary.status === 'late') {
      late++;
    }
    if (summary.isIncomplete) {
      incomplete++;
    }
  }
  
  const notCheckedIn = Math.max(0, totalActiveUsers - checkedIn);
  
  return {
    date,
    checkedIn,
    notCheckedIn,
    late,
    onLeave: 0,
    incomplete,
  };
}

export const dashboardService = {
  getLastSyncTime,
  getTodayAttendanceStats,
  getDashboardStats,
  calculateTodayStats,
};
