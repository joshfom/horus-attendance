import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback } from 'react';
import type { Device, DeviceConfig, DeviceInfo } from '../types/models';
import type { SyncOptions, SyncResult, SyncProgress } from '../types/services';
import { listDevices, saveDevice, deleteDevice } from '../lib/repositories/device.repository';
import { getSyncEngine } from '../lib/services/sync-engine';
import { useApp, useSync } from '../contexts';
import { ConfirmDialog } from '../components/ui';

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

// Timezone options
const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai',
  'Asia/Dubai', 'Asia/Kolkata', 'Australia/Sydney', 'Pacific/Auckland',
];

// Sync mode options
type SyncMode = 'latest' | 'days' | 'range';

interface ConnectionStatus {
  testing: boolean;
  success: boolean | null;
  deviceInfo: DeviceInfo | null;
  error: string | null;
  latency: number;
}

interface DeviceFormData {
  name: string;
  ip: string;
  port: string;
  commKey: string;
  timezone: string;
  syncMode: 'auto' | 'manual';
}

const defaultFormData: DeviceFormData = {
  name: '',
  ip: '',
  port: '4370',
  commKey: '',
  timezone: 'UTC',
  syncMode: 'manual',
};

function validateIp(ip: string): boolean {
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipRegex.test(ip)) return false;
  const parts = ip.split('.').map(Number);
  return parts.every(p => p >= 0 && p <= 255);
}

function validatePort(port: string): boolean {
  const portNum = parseInt(port, 10);
  return !isNaN(portNum) && portNum >= 1 && portNum <= 65535;
}

// Status Badge Component
function StatusBadge({ status }: { status: 'success' | 'error' | 'warning' | 'info' }) {
  const colors = {
    success: 'bg-success-600/20 text-success-500 border-success-600/30',
    error: 'bg-danger-600/20 text-danger-500 border-danger-600/30',
    warning: 'bg-warning-600/20 text-warning-500 border-warning-600/30',
    info: 'bg-primary-600/20 text-primary-400 border-primary-600/30',
  };
  const labels = { success: 'Connected', error: 'Failed', warning: 'Warning', info: 'Info' };
  return (
    <span className={`px-2 py-1 text-xs font-medium rounded border ${colors[status]}`}>
      {labels[status]}
    </span>
  );
}

// Progress Bar Component
function ProgressBar({ progress }: { progress: SyncProgress }) {
  const percentage = Math.round((progress.current / progress.total) * 100);
  const phaseLabels: Record<SyncProgress['phase'], string> = {
    connecting: 'Connecting...',
    fetching: 'Fetching from device...',
    users: 'Syncing Users',
    logs: 'Inserting Logs',
    processing: 'Processing Summaries',
    complete: 'Complete',
  };

  const details = progress.details;

  return (
    <div className="space-y-3">
      <div className="flex justify-between text-sm">
        <span className="text-secondary-300">{phaseLabels[progress.phase]}</span>
        <span className="text-secondary-400">{percentage}%</span>
      </div>
      <div className="h-2 bg-secondary-700 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-primary-500"
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>
      <p className="text-xs text-secondary-400">{progress.message}</p>

      {/* Detailed record counts */}
      {details && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
          {details.totalRecordsFetched != null && details.totalRecordsFetched > 0 && (
            <div className="bg-secondary-700/50 rounded-lg p-2 text-center">
              <p className="text-xs text-secondary-400">Fetched</p>
              <p className="text-sm font-semibold text-white">{details.totalRecordsFetched.toLocaleString()}</p>
            </div>
          )}
          {details.usersTotal != null && details.usersTotal > 0 && (
            <div className="bg-secondary-700/50 rounded-lg p-2 text-center">
              <p className="text-xs text-secondary-400">Users</p>
              <p className="text-sm font-semibold text-white">{details.usersProcessed ?? 0} / {details.usersTotal}</p>
            </div>
          )}
          {details.logsTotal != null && details.logsTotal > 0 && (
            <div className="bg-secondary-700/50 rounded-lg p-2 text-center">
              <p className="text-xs text-secondary-400">Logs</p>
              <p className="text-sm font-semibold text-white">{(details.logsProcessed ?? 0).toLocaleString()} / {details.logsTotal.toLocaleString()}</p>
            </div>
          )}
          {details.summariesTotal != null && details.summariesTotal > 0 && (
            <div className="bg-secondary-700/50 rounded-lg p-2 text-center">
              <p className="text-xs text-secondary-400">Summaries</p>
              <p className="text-sm font-semibold text-white">{(details.summariesProcessed ?? 0).toLocaleString()} / {details.summariesTotal.toLocaleString()}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Device Info Display Component
function DeviceInfoDisplay({ info, latency }: { info: DeviceInfo; latency: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 text-sm">
      <div>
        <p className="text-secondary-400">Serial Number</p>
        <p className="text-white font-medium">{info.serialNumber}</p>
      </div>
      <div>
        <p className="text-secondary-400">Firmware</p>
        <p className="text-white font-medium">{info.firmwareVersion}</p>
      </div>
      <div>
        <p className="text-secondary-400">Users on Device</p>
        <p className="text-white font-medium">{info.userCount}</p>
      </div>
      <div>
        <p className="text-secondary-400">Logs on Device</p>
        <p className="text-white font-medium">{info.logCount}</p>
      </div>
      <div>
        <p className="text-secondary-400">Latency</p>
        <p className="text-white font-medium">{latency}ms</p>
      </div>
      <div>
        <p className="text-secondary-400">Last Activity</p>
        <p className="text-white font-medium">{info.lastActivity || 'N/A'}</p>
      </div>
    </div>
  );
}

// Sync Result Display Component
function SyncResultDisplay({ result }: { result: SyncResult }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {result.success ? (
          <>
            <svg className="w-5 h-5 text-success-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-success-500 font-medium">Sync Completed Successfully</span>
          </>
        ) : (
          <>
            <svg className="w-5 h-5 text-danger-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-danger-500 font-medium">Sync Completed with Errors</span>
          </>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div className="bg-secondary-700/50 rounded-lg p-3">
          <p className="text-secondary-400">Users Added</p>
          <p className="text-2xl font-bold text-white">{result.usersAdded}</p>
        </div>
        <div className="bg-secondary-700/50 rounded-lg p-3">
          <p className="text-secondary-400">Users Synced</p>
          <p className="text-2xl font-bold text-white">{result.usersSynced}</p>
        </div>
        <div className="bg-secondary-700/50 rounded-lg p-3">
          <p className="text-secondary-400">Logs Added</p>
          <p className="text-2xl font-bold text-white">{result.logsAdded}</p>
        </div>
        <div className="bg-secondary-700/50 rounded-lg p-3">
          <p className="text-secondary-400">Duplicates Skipped</p>
          <p className="text-2xl font-bold text-white">{result.logsDeduplicated}</p>
        </div>
      </div>
      {result.errors.length > 0 && (
        <div className="bg-danger-600/10 border border-danger-600/30 rounded-lg p-4">
          <p className="text-danger-500 font-medium mb-2">Errors:</p>
          <ul className="text-sm text-danger-400 space-y-1">
            {result.errors.map((error, i) => (
              <li key={i}>• {error}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Device Configuration Form Component
interface DeviceFormProps {
  formData: DeviceFormData;
  onChange: (data: DeviceFormData) => void;
  onSave: () => void;
  onDelete?: (() => void) | undefined;
  saving: boolean;
  isEditing: boolean;
  errors: Record<string, string>;
}

function DeviceForm({ formData, onChange, onSave, onDelete, saving, isEditing, errors }: DeviceFormProps) {
  const handleChange = (field: keyof DeviceFormData, value: string) => {
    onChange({ ...formData, [field]: value });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-secondary-300 mb-1">Device Name</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => handleChange('name', e.target.value)}
            placeholder="Office Device"
            className={`input w-full ${errors.name ? 'border-danger-500' : ''}`}
          />
          {errors.name && <p className="text-danger-500 text-xs mt-1">{errors.name}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-secondary-300 mb-1">IP Address</label>
          <input
            type="text"
            value={formData.ip}
            onChange={(e) => handleChange('ip', e.target.value)}
            placeholder="192.168.1.100"
            className={`input w-full ${errors.ip ? 'border-danger-500' : ''}`}
          />
          {errors.ip && <p className="text-danger-500 text-xs mt-1">{errors.ip}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-secondary-300 mb-1">Port</label>
          <input
            type="text"
            value={formData.port}
            onChange={(e) => handleChange('port', e.target.value)}
            placeholder="4370"
            className={`input w-full ${errors.port ? 'border-danger-500' : ''}`}
          />
          {errors.port && <p className="text-danger-500 text-xs mt-1">{errors.port}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-secondary-300 mb-1">Communication Key</label>
          <input
            type="password"
            value={formData.commKey}
            onChange={(e) => handleChange('commKey', e.target.value)}
            placeholder="Optional"
            className="input w-full"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-secondary-300 mb-1">Timezone</label>
          <select
            value={formData.timezone}
            onChange={(e) => handleChange('timezone', e.target.value)}
            className="input w-full"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-secondary-300 mb-1">Sync Mode</label>
          <select
            value={formData.syncMode}
            onChange={(e) => handleChange('syncMode', e.target.value as 'auto' | 'manual')}
            className="input w-full"
          >
            <option value="manual">Manual</option>
            <option value="auto">Automatic</option>
          </select>
        </div>
      </div>
      <div className="flex gap-3 pt-2">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onSave}
          disabled={saving}
          className="btn-primary flex items-center gap-2"
        >
          {saving ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
            />
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          {isEditing ? 'Update Device' : 'Save Device'}
        </motion.button>
        {isEditing && onDelete && (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onDelete}
            className="bg-danger-600 hover:bg-danger-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
          >
            Delete
          </motion.button>
        )}
      </div>
    </div>
  );
}

// Sync Options Component
interface SyncOptionsProps {
  mode: SyncMode;
  days: number;
  startDate: string;
  endDate: string;
  onModeChange: (mode: SyncMode) => void;
  onDaysChange: (days: number) => void;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
}

function SyncOptionsForm({
  mode, days, startDate, endDate,
  onModeChange, onDaysChange, onStartDateChange, onEndDateChange,
}: SyncOptionsProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-secondary-300 mb-2">Sync Range</label>
        <div className="flex flex-wrap gap-2">
          {(['latest', 'days', 'range'] as SyncMode[]).map((m) => (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                mode === m
                  ? 'bg-primary-600 text-white'
                  : 'bg-secondary-700 text-secondary-300 hover:bg-secondary-600'
              }`}
            >
              {m === 'latest' ? 'Latest Only' : m === 'days' ? 'Last N Days' : 'Date Range'}
            </button>
          ))}
        </div>
      </div>
      <AnimatePresence mode="wait">
        {mode === 'days' && (
          <motion.div
            key="days"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <label className="block text-sm font-medium text-secondary-300 mb-1">Number of Days</label>
            <input
              type="number"
              min="1"
              max="365"
              value={days}
              onChange={(e) => onDaysChange(parseInt(e.target.value, 10) || 7)}
              className="input w-32"
            />
          </motion.div>
        )}
        {mode === 'range' && (
          <motion.div
            key="range"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="grid grid-cols-2 gap-4"
          >
            <div>
              <label className="block text-sm font-medium text-secondary-300 mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => onStartDateChange(e.target.value)}
                className="input w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-secondary-300 mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => onEndDateChange(e.target.value)}
                className="input w-full"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Main Sync Page Component
export function SyncPage() {
  const { showNotification } = useApp();
  const { activeSync, lastResult, isSyncing, startSync, cancelSync, clearResult } = useSync();
  
  // Device state
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [formData, setFormData] = useState<DeviceFormData>(defaultFormData);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // Connection test state
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    testing: false,
    success: null,
    deviceInfo: null,
    error: null,
    latency: 0,
  });

  // Sync options state
  const [syncMode, setSyncMode] = useState<SyncMode>('latest');
  const [syncDays, setSyncDays] = useState(7);
  const [syncStartDate, setSyncStartDate] = useState('');
  const [syncEndDate, setSyncEndDate] = useState('');

  const syncEngine = getSyncEngine();

  // Load devices on mount
  useEffect(() => {
    loadDevices();
  }, []);

  const loadDevices = async () => {
    try {
      setLoading(true);
      const deviceList = await listDevices();
      setDevices(deviceList);
      if (deviceList.length > 0 && !selectedDeviceId) {
        const firstDevice = deviceList[0];
        if (firstDevice) {
          selectDevice(firstDevice);
        }
      }
    } catch (error) {
      console.error('Failed to load devices:', error);
      showNotification('Failed to load devices', 'error');
    } finally {
      setLoading(false);
    }
  };

  const selectDevice = (device: Device | null) => {
    if (device) {
      setSelectedDeviceId(device.id);
      setFormData({
        name: device.name,
        ip: device.ip,
        port: device.port.toString(),
        commKey: device.commKey,
        timezone: device.timezone,
        syncMode: device.syncMode,
      });
    } else {
      setSelectedDeviceId(null);
      setFormData(defaultFormData);
    }
    setConnectionStatus({ testing: false, success: null, deviceInfo: null, error: null, latency: 0 });
    clearResult();
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!formData.name.trim()) errors.name = 'Device name is required';
    if (!formData.ip.trim()) errors.ip = 'IP address is required';
    else if (!validateIp(formData.ip)) errors.ip = 'Invalid IP address format';
    if (!formData.port.trim()) errors.port = 'Port is required';
    else if (!validatePort(formData.port)) errors.port = 'Port must be between 1 and 65535';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveDevice = async () => {
    if (!validateForm()) return;
    try {
      setSaving(true);
      const config: DeviceConfig = {
        id: selectedDeviceId || crypto.randomUUID(),
        name: formData.name,
        ip: formData.ip,
        port: parseInt(formData.port, 10),
        commKey: formData.commKey,
        timezone: formData.timezone,
        syncMode: formData.syncMode,
      };
      const saved = await saveDevice(config);
      await loadDevices();
      selectDevice(saved);
    } catch (error) {
      console.error('Failed to save device:', error);
      showNotification('Failed to save device', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDevice = async () => {
    if (!selectedDeviceId) return;
    setConfirmDeleteOpen(false);
    try {
      await deleteDevice(selectedDeviceId);
      await loadDevices();
      selectDevice(null);
    } catch (error) {
      console.error('Failed to delete device:', error);
      showNotification('Failed to delete device', 'error');
    }
  };

  const handleTestConnection = useCallback(async () => {
    if (!validateForm()) return;
    setConnectionStatus({ testing: true, success: null, deviceInfo: null, error: null, latency: 0 });
    try {
      const config: DeviceConfig = {
        id: selectedDeviceId || '',
        name: formData.name,
        ip: formData.ip,
        port: parseInt(formData.port, 10),
        commKey: formData.commKey,
        timezone: formData.timezone,
        syncMode: formData.syncMode,
      };
      const result = await syncEngine.testConnection(config);
      setConnectionStatus({
        testing: false,
        success: result.success,
        deviceInfo: result.deviceInfo || null,
        error: result.error?.message || null,
        latency: result.latency,
      });
    } catch (error) {
      setConnectionStatus({
        testing: false,
        success: false,
        deviceInfo: null,
        error: error instanceof Error ? error.message : 'Connection test failed',
        latency: 0,
      });
    }
  }, [formData, selectedDeviceId, syncEngine]);

  const handleSync = useCallback(async () => {
    if (!selectedDeviceId) return;
    const selectedDev = devices.find((d) => d.id === selectedDeviceId);
    if (!selectedDev) return;
    
    const options: SyncOptions = { mode: syncMode };
    if (syncMode === 'days') options.days = syncDays;
    if (syncMode === 'range') {
      options.startDate = syncStartDate;
      options.endDate = syncEndDate;
    }
    
    await startSync(selectedDeviceId, selectedDev.name, options);
    await loadDevices(); // Refresh to get updated lastSyncAt
  }, [selectedDeviceId, devices, syncMode, syncDays, syncStartDate, syncEndDate, startSync]);

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="p-8">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-2xl font-bold text-white">Sync</h1>
        <p className="text-secondary-400 mt-1">Configure and sync your ZKTeco devices</p>
      </motion.div>

      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Device List */}
        <motion.div variants={cardVariants} className="card lg:col-span-1">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Devices</h2>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => selectDevice(null)}
              className="p-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </motion.button>
          </div>
          <div className="space-y-2">
            {devices.length === 0 ? (
              <p className="text-secondary-400 text-sm">No devices configured. Add one to get started.</p>
            ) : (
              devices.map((device) => (
                <motion.button
                  key={device.id}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => selectDevice(device)}
                  className={`w-full text-left p-3 rounded-lg transition-colors ${
                    selectedDeviceId === device.id
                      ? 'bg-primary-600/20 border border-primary-600/30'
                      : 'bg-secondary-700/50 hover:bg-secondary-700'
                  }`}
                >
                  <p className="font-medium text-white">{device.name}</p>
                  <p className="text-sm text-secondary-400">{device.ip}:{device.port}</p>
                  {device.lastSyncAt && (
                    <p className="text-xs text-secondary-500 mt-1">
                      Last sync: {new Date(device.lastSyncAt).toLocaleString()}
                    </p>
                  )}
                </motion.button>
              ))
            )}
          </div>
        </motion.div>

        {/* Device Configuration */}
        <motion.div variants={cardVariants} className="card lg:col-span-2">
          <h2 className="text-lg font-semibold text-white mb-4">
            {selectedDeviceId ? 'Edit Device' : 'Add New Device'}
          </h2>
          <DeviceForm
            formData={formData}
            onChange={setFormData}
            onSave={handleSaveDevice}
            onDelete={selectedDeviceId ? () => setConfirmDeleteOpen(true) : undefined}
            saving={saving}
            isEditing={!!selectedDeviceId}
            errors={formErrors}
          />

          {/* Connection Test Section */}
          <div className="mt-6 pt-6 border-t border-secondary-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-md font-medium text-white">Connection Test</h3>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleTestConnection}
                disabled={connectionStatus.testing}
                className="btn-secondary flex items-center gap-2"
              >
                {connectionStatus.testing ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                  />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                )}
                Test Connection
              </motion.button>
            </div>
            <AnimatePresence mode="wait">
              {connectionStatus.success !== null && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className={`p-4 rounded-lg ${
                    connectionStatus.success
                      ? 'bg-success-600/10 border border-success-600/30'
                      : 'bg-danger-600/10 border border-danger-600/30'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <StatusBadge status={connectionStatus.success ? 'success' : 'error'} />
                    {connectionStatus.error && (
                      <span className="text-sm text-danger-400">{connectionStatus.error}</span>
                    )}
                  </div>
                  {connectionStatus.deviceInfo && (
                    <DeviceInfoDisplay info={connectionStatus.deviceInfo} latency={connectionStatus.latency} />
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Sync Section - Only show when a device is selected */}
        {selectedDevice && (
          <motion.div variants={cardVariants} className="card lg:col-span-3">
            <h2 className="text-lg font-semibold text-white mb-4">Sync Attendance Data</h2>
            
            <SyncOptionsForm
              mode={syncMode}
              days={syncDays}
              startDate={syncStartDate}
              endDate={syncEndDate}
              onModeChange={setSyncMode}
              onDaysChange={setSyncDays}
              onStartDateChange={setSyncStartDate}
              onEndDateChange={setSyncEndDate}
            />

            <div className="mt-6 flex items-center gap-4">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleSync}
                disabled={isSyncing}
                className="btn-primary flex items-center gap-2"
              >
                {isSyncing ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                  />
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                {isSyncing ? 'Syncing...' : 'Sync Now'}
              </motion.button>
              {isSyncing && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={cancelSync}
                  className="btn-secondary flex items-center gap-2 text-danger-400 border-danger-600/30 hover:bg-danger-600/10"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Cancel
                </motion.button>
              )}
              {selectedDevice.lastSyncAt && !isSyncing && (
                <span className="text-sm text-secondary-400">
                  Last synced: {new Date(selectedDevice.lastSyncAt).toLocaleString()}
                </span>
              )}
            </div>

            {/* Sync Progress */}
            <AnimatePresence mode="wait">
              {isSyncing && activeSync?.progress && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="mt-6"
                >
                  <ProgressBar progress={activeSync.progress} />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Sync Result */}
            <AnimatePresence mode="wait">
              {lastResult && !isSyncing && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="mt-6 pt-6 border-t border-secondary-700"
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-secondary-300">Last Sync Result</h3>
                    <button onClick={clearResult} className="text-xs text-secondary-500 hover:text-secondary-300">
                      Dismiss
                    </button>
                  </div>
                  <SyncResultDisplay result={lastResult} />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </motion.div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete Device"
        message="Are you sure you want to delete this device? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDeleteDevice}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </div>
  );
}
