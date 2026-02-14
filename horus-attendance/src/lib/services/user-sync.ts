/**
 * User Sync Service
 * 
 * Handles synchronization of users from ZKTeco devices to the local database.
 * Transforms device user format to app user format.
 */

import type { DeviceConfig, CreateUserInput } from '../../types/models';
import type { SidecarUser } from './sidecar-client';
import { getDeviceCommunicationService } from './device-communication';

/**
 * Result of user sync operation
 */
export interface UserSyncResult {
  success: boolean;
  usersAdded: number;
  usersUpdated: number;
  totalUsers: number;
  errors: string[];
}

/**
 * Transform a device user to app user input format
 */
export function transformDeviceUserToAppUser(
  deviceUser: SidecarUser,
  _deviceId: string
): CreateUserInput {
  return {
    deviceUserId: deviceUser.deviceUserId,
    deviceName: deviceUser.deviceName,
    displayName: deviceUser.deviceName || `User ${deviceUser.deviceUserId}`,
    status: 'active',
  };
}

/**
 * Transform multiple device users to app user format
 */
export function transformDeviceUsersToAppUsers(
  deviceUsers: SidecarUser[],
  deviceId: string
): CreateUserInput[] {
  return deviceUsers.map((user) => transformDeviceUserToAppUser(user, deviceId));
}

/**
 * User Sync Service class
 */
export class UserSyncService {
  private deviceCommunication = getDeviceCommunicationService();

  /**
   * Pull all users from a device
   * Returns the raw device users in app format
   */
  async pullUsersFromDevice(config: DeviceConfig): Promise<{
    success: boolean;
    users: CreateUserInput[];
    error?: string;
  }> {
    try {
      const deviceUsers = await this.deviceCommunication.getUsers(config);
      const appUsers = transformDeviceUsersToAppUsers(deviceUsers, config.id);
      
      return {
        success: true,
        users: appUsers,
      };
    } catch (error) {
      return {
        success: false,
        users: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Sync users from device to database
   * This method pulls users from the device and returns them for database insertion
   * The actual database operations should be handled by the caller (Sync Engine)
   */
  async syncUsersFromDevice(
    config: DeviceConfig,
    existingDeviceUserIds: Set<string>
  ): Promise<{
    newUsers: CreateUserInput[];
    existingUsers: CreateUserInput[];
    error?: string | undefined;
  }> {
    const result = await this.pullUsersFromDevice(config);
    
    if (!result.success) {
      return {
        newUsers: [],
        existingUsers: [],
        error: result.error,
      };
    }

    const newUsers: CreateUserInput[] = [];
    const existingUsers: CreateUserInput[] = [];

    for (const user of result.users) {
      if (user.deviceUserId && existingDeviceUserIds.has(user.deviceUserId)) {
        existingUsers.push(user);
      } else {
        newUsers.push(user);
      }
    }

    return {
      newUsers,
      existingUsers,
    };
  }
}

// Export singleton instance
let userSyncService: UserSyncService | null = null;

export function getUserSyncService(): UserSyncService {
  if (!userSyncService) {
    userSyncService = new UserSyncService();
  }
  return userSyncService;
}
