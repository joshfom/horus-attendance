import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback } from 'react';
import type { AppSettings, AttendanceRules, Holiday, CreateHolidayInput, ExportSettings } from '../types/models';
import { settingsRepository } from '../lib/repositories/settings.repository';
import { holidayRepository } from '../lib/repositories/holiday.repository';
import { exportBackup, isTauriEnvironment, formatFileSize, resetDatabase } from '../lib/tauri-commands';
import { useApp } from '../contexts';
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

const modalVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, scale: 0.95, transition: { duration: 0.15 } },
};

// Workday options
const WORKDAY_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

// Theme options
const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

// Section Header Component
function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      {description && <p className="text-secondary-400 text-sm mt-1">{description}</p>}
    </div>
  );
}

// Time Input Component
function TimeInput({
  label,
  value,
  onChange,
  description,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-secondary-300 mb-1">{label}</label>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input w-full"
      />
      {description && <p className="text-xs text-secondary-500 mt-1">{description}</p>}
    </div>
  );
}

// Number Input Component
function NumberInput({
  label,
  value,
  onChange,
  min = 0,
  max = 120,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-secondary-300 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
          min={min}
          max={max}
          className="input w-24"
        />
        {suffix && <span className="text-secondary-400 text-sm">{suffix}</span>}
      </div>
    </div>
  );
}

// Holiday Modal Component
interface HolidayModalProps {
  holiday: Holiday | null;
  onSave: (data: CreateHolidayInput) => Promise<void>;
  onClose: () => void;
}

function HolidayModal({ holiday, onSave, onClose }: HolidayModalProps) {
  const [date, setDate] = useState(holiday?.date || '');
  const [name, setName] = useState(holiday?.name || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) {
      setError('Date is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const holidayData: CreateHolidayInput = { date };
      if (name) {
        holidayData.name = name;
      }
      await onSave(holidayData);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save holiday');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <motion.div
        variants={modalVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="relative bg-secondary-800 rounded-xl p-6 w-full max-w-md"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white">
            {holiday ? 'Edit Holiday' : 'Add Holiday'}
          </h2>
          <button onClick={onClose} className="text-secondary-400 hover:text-white">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-secondary-300 mb-1">Date *</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={`input w-full ${error ? 'border-danger-500' : ''}`}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-secondary-300 mb-1">Name (optional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., New Year's Day"
              className="input w-full"
            />
          </div>
          {error && <p className="text-danger-500 text-sm">{error}</p>}

          <div className="flex gap-3 pt-4">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={saving}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
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
              {holiday ? 'Update' : 'Add'}
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={onClose}
              className="btn-secondary"
            >
              Cancel
            </motion.button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}


// Attendance Rules Section Component
interface AttendanceRulesSectionProps {
  rules: AttendanceRules;
  onChange: (rules: AttendanceRules) => void;
  onSave: () => void;
  saving: boolean;
}

function AttendanceRulesSection({ rules, onChange, onSave, saving }: AttendanceRulesSectionProps) {
  const handleChange = <K extends keyof AttendanceRules>(key: K, value: AttendanceRules[K]) => {
    onChange({ ...rules, [key]: value });
  };

  const toggleWorkday = (day: number) => {
    const newWorkdays = rules.workdays.includes(day)
      ? rules.workdays.filter((d) => d !== day)
      : [...rules.workdays, day].sort();
    handleChange('workdays', newWorkdays);
  };

  return (
    <motion.div variants={cardVariants} className="card">
      <SectionHeader
        title="Attendance Rules"
        description="Configure work schedule and grace periods"
      />

      <div className="space-y-6">
        {/* Work Schedule */}
        <div>
          <h4 className="text-sm font-medium text-secondary-300 mb-3">Work Schedule</h4>
          <div className="grid grid-cols-2 gap-4">
            <TimeInput
              label="Work Start Time"
              value={rules.workStartTime}
              onChange={(v) => handleChange('workStartTime', v)}
            />
            <TimeInput
              label="Work End Time"
              value={rules.workEndTime}
              onChange={(v) => handleChange('workEndTime', v)}
            />
          </div>
        </div>

        {/* Grace Periods */}
        <div>
          <h4 className="text-sm font-medium text-secondary-300 mb-3">Grace Periods</h4>
          <div className="grid grid-cols-2 gap-4">
            <NumberInput
              label="Late Grace Period"
              value={rules.lateGracePeriod}
              onChange={(v) => handleChange('lateGracePeriod', v)}
              suffix="minutes"
            />
            <NumberInput
              label="Early Leave Grace Period"
              value={rules.earlyLeaveGracePeriod}
              onChange={(v) => handleChange('earlyLeaveGracePeriod', v)}
              suffix="minutes"
            />
          </div>
        </div>

        {/* Check-in/Check-out Windows */}
        <div>
          <h4 className="text-sm font-medium text-secondary-300 mb-3">Punch Windows</h4>
          <div className="grid grid-cols-2 gap-4">
            <TimeInput
              label="Check-in Window Start"
              value={rules.checkInWindowStart}
              onChange={(v) => handleChange('checkInWindowStart', v)}
            />
            <TimeInput
              label="Check-in Window End"
              value={rules.checkInWindowEnd}
              onChange={(v) => handleChange('checkInWindowEnd', v)}
            />
            <TimeInput
              label="Check-out Window Start"
              value={rules.checkOutWindowStart}
              onChange={(v) => handleChange('checkOutWindowStart', v)}
            />
            <TimeInput
              label="Check-out Window End"
              value={rules.checkOutWindowEnd}
              onChange={(v) => handleChange('checkOutWindowEnd', v)}
            />
          </div>
        </div>

        {/* Workdays */}
        <div>
          <h4 className="text-sm font-medium text-secondary-300 mb-3">Workdays</h4>
          <div className="flex flex-wrap gap-2">
            {WORKDAY_OPTIONS.map((day) => (
              <button
                key={day.value}
                onClick={() => toggleWorkday(day.value)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  rules.workdays.includes(day.value)
                    ? 'bg-primary-600 text-white'
                    : 'bg-secondary-700 text-secondary-300 hover:bg-secondary-600'
                }`}
              >
                {day.label}
              </button>
            ))}
          </div>
        </div>

        {/* Save Button */}
        <div className="pt-4 border-t border-secondary-700">
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
            Save Attendance Rules
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

// Holidays Section Component
interface HolidaysSectionProps {
  holidays: Holiday[];
  onAdd: (data: CreateHolidayInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function HolidaysSection({ holidays, onAdd, onDelete }: HolidaysSectionProps) {
  const [showModal, setShowModal] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await onDelete(id);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <motion.div variants={cardVariants} className="card">
      <div className="flex items-center justify-between mb-4">
        <SectionHeader
          title="Holidays"
          description="Dates excluded from attendance calculations"
        />
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowModal(true)}
          className="p-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </motion.button>
      </div>

      {holidays.length === 0 ? (
        <p className="text-secondary-400 text-sm">No holidays configured</p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {holidays.map((holiday) => (
            <div
              key={holiday.id}
              className="flex items-center justify-between p-3 bg-secondary-700/50 rounded-lg"
            >
              <div>
                <p className="text-white font-medium">
                  {new Date(holiday.date + 'T00:00:00').toLocaleDateString(undefined, {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
                {holiday.name && (
                  <p className="text-secondary-400 text-sm">{holiday.name}</p>
                )}
              </div>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => handleDelete(holiday.id)}
                disabled={deletingId === holiday.id}
                className="p-2 rounded-lg bg-danger-600/20 hover:bg-danger-600/30 text-danger-500"
              >
                {deletingId === holiday.id ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="w-4 h-4 border-2 border-danger-500 border-t-transparent rounded-full"
                  />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                )}
              </motion.button>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {showModal && (
          <HolidayModal
            holiday={null}
            onSave={onAdd}
            onClose={() => setShowModal(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}


// Backup Section Component
interface BackupSectionProps {
  lastBackupAt: string | null;
  onExport: () => Promise<void>;
  onImport: () => Promise<void>;
  onReset: () => Promise<void>;
}

function BackupSection({ lastBackupAt, onExport, onImport, onReset }: BackupSectionProps) {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleExport = async () => {
    setExporting(true);
    setMessage(null);
    try {
      await onExport();
      setMessage({ type: 'success', text: 'Backup exported successfully' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Export failed' });
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setMessage(null);
    try {
      await onImport();
      setMessage({ type: 'success', text: 'Backup restored successfully' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Import failed' });
    } finally {
      setImporting(false);
    }
  };

  const handleReset = async () => {
    setConfirmResetOpen(false);
    setResetting(true);
    setMessage(null);
    try {
      await onReset();
      setMessage({ type: 'success', text: 'Database reset successfully. Please restart the application.' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Reset failed' });
    } finally {
      setResetting(false);
    }
  };

  return (
    <motion.div variants={cardVariants} className="card">
      <SectionHeader
        title="Data & Backup"
        description="Export and restore your attendance data"
      />

      <div className="space-y-4">
        {lastBackupAt && (
          <p className="text-secondary-400 text-sm">
            Last backup: {new Date(lastBackupAt).toLocaleString()}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleExport}
            disabled={exporting}
            className="btn-primary flex items-center gap-2"
          >
            {exporting ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
              />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            )}
            Export Backup
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleImport}
            disabled={importing}
            className="btn-secondary flex items-center gap-2"
          >
            {importing ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
              />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            )}
            Import / Restore
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setConfirmResetOpen(true)}
            disabled={resetting}
            className="bg-danger-600 hover:bg-danger-700 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center gap-2"
          >
            {resetting ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
              />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            )}
            Reset Database
          </motion.button>
        </div>

        <AnimatePresence>
          {message && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={`p-3 rounded-lg ${
                message.type === 'success'
                  ? 'bg-success-600/10 border border-success-600/30 text-success-500'
                  : 'bg-danger-600/10 border border-danger-600/30 text-danger-500'
              }`}
            >
              {message.text}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ConfirmDialog
        open={confirmResetOpen}
        title="Reset Database"
        message="Are you sure you want to reset the database? This will delete ALL data. A backup will be created first."
        confirmLabel="Reset Database"
        variant="danger"
        onConfirm={handleReset}
        onCancel={() => setConfirmResetOpen(false)}
      />
    </motion.div>
  );
}

// Appearance Section Component
interface AppearanceSectionProps {
  theme: 'light' | 'dark' | 'system';
  onChange: (theme: 'light' | 'dark' | 'system') => void;
  onSave: () => void;
  saving: boolean;
}

function AppearanceSection({ theme, onChange, onSave, saving }: AppearanceSectionProps) {
  return (
    <motion.div variants={cardVariants} className="card">
      <SectionHeader
        title="Appearance"
        description="Customize the look and feel"
      />

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-secondary-300 mb-2">Theme</label>
          <div className="flex gap-2">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => onChange(option.value as 'light' | 'dark' | 'system')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                  theme === option.value
                    ? 'bg-primary-600 text-white'
                    : 'bg-secondary-700 text-secondary-300 hover:bg-secondary-600'
                }`}
              >
                {option.value === 'light' && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                )}
                {option.value === 'dark' && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                )}
                {option.value === 'system' && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                )}
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-secondary-700">
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
            Save Appearance
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}


// Main Settings Page Component
// Export Settings Section
interface ExportSettingsSectionProps {
  settings: ExportSettings;
  onChange: (settings: ExportSettings) => void;
  onSave: () => void;
  saving: boolean;
}

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-10 h-8 rounded cursor-pointer border border-secondary-600 bg-transparent"
      />
      <div className="flex-1">
        <span className="text-sm text-secondary-300">{label}</span>
        <span className="text-xs text-secondary-500 ml-2">{value}</span>
      </div>
    </div>
  );
}

function ExportSettingsSection({ settings, onChange, onSave, saving }: ExportSettingsSectionProps) {
  const colors = settings.colors ?? {
    onTime: '#C6EFCE', between: '#FFFFCC', late: '#FCE4D6',
    absent: '#FFC7CE', weekend: '#D9E1F2', header: '#4472C4',
  };

  const updateColor = (key: keyof typeof colors, value: string) => {
    onChange({ ...settings, colors: { ...colors, [key]: value } });
  };

  return (
    <motion.div variants={cardVariants} className="card">
      <SectionHeader title="Export Settings" description="Configure color thresholds and cell colors for Excel report exports" />
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <TimeInput
            label="On-Time Threshold"
            value={settings.onTimeThreshold}
            onChange={(v) => onChange({ ...settings, onTimeThreshold: v })}
            description="Arrivals at or before this time are green"
          />
          <TimeInput
            label="Late Threshold"
            value={settings.lateThreshold}
            onChange={(v) => onChange({ ...settings, lateThreshold: v })}
            description="Arrivals after this time are orange"
          />
        </div>

        <div>
          <h4 className="text-sm font-medium text-secondary-300 mb-3">Cell Colors</h4>
          <div className="grid grid-cols-2 gap-3">
            <ColorInput label="On-Time (green)" value={colors.onTime} onChange={(v) => updateColor('onTime', v)} />
            <ColorInput label="Between (yellow)" value={colors.between} onChange={(v) => updateColor('between', v)} />
            <ColorInput label="Late (orange)" value={colors.late} onChange={(v) => updateColor('late', v)} />
            <ColorInput label="Absent (red)" value={colors.absent} onChange={(v) => updateColor('absent', v)} />
            <ColorInput label="Weekend / Holiday" value={colors.weekend} onChange={(v) => updateColor('weekend', v)} />
            <ColorInput label="Header" value={colors.header} onChange={(v) => updateColor('header', v)} />
          </div>
        </div>

        <div className="text-xs text-secondary-500 space-y-1">
          <p>🟢 Green — checked in at or before {settings.onTimeThreshold}</p>
          <p>🟡 Yellow — checked in between {settings.onTimeThreshold} and {settings.lateThreshold}</p>
          <p>🟠 Orange — checked in after {settings.lateThreshold}</p>
          <p>🔴 Red — absent (no check-in)</p>
          <p>🔵 Blue — weekend / holiday</p>
        </div>
        <div className="flex justify-end pt-2">
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
            Save Export Settings
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

export function SettingsPage() {
  const { showNotification } = useApp();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [savingRules, setSavingRules] = useState(false);
  const [savingAppearance, setSavingAppearance] = useState(false);
  const [savingExport, setSavingExport] = useState(false);

  // Load settings and holidays
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [appSettings, holidayList] = await Promise.all([
        settingsRepository.getAppSettings(),
        holidayRepository.listHolidays(),
      ]);
      setSettings(appSettings);
      setHolidays(holidayList);
    } catch (error) {
      console.error('Failed to load settings:', error);
      showNotification('Failed to load settings', 'error');
      // Use defaults if loading fails
      setSettings(settingsRepository.DEFAULT_APP_SETTINGS);
    } finally {
      setLoading(false);
    }
  }, [showNotification]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Save attendance rules
  const handleSaveRules = async () => {
    if (!settings) return;
    setSavingRules(true);
    try {
      await settingsRepository.updateAppSettings({ attendance: settings.attendance });
      showNotification('Attendance rules saved successfully', 'success');
    } catch (error) {
      console.error('Failed to save attendance rules:', error);
      showNotification('Failed to save attendance rules', 'error');
    } finally {
      setSavingRules(false);
    }
  };

  // Save appearance settings
  const handleSaveAppearance = async () => {
    if (!settings) return;
    setSavingAppearance(true);
    try {
      await settingsRepository.updateAppSettings({ appearance: settings.appearance });
      showNotification('Appearance settings saved successfully', 'success');
    } catch (error) {
      console.error('Failed to save appearance settings:', error);
      showNotification('Failed to save appearance settings', 'error');
    } finally {
      setSavingAppearance(false);
    }
  };

  // Save export settings
  const handleSaveExport = async () => {
    if (!settings) return;
    setSavingExport(true);
    try {
      await settingsRepository.updateAppSettings({ export: settings.export });
      showNotification('Export settings saved successfully', 'success');
    } catch (error) {
      console.error('Failed to save export settings:', error);
      showNotification('Failed to save export settings', 'error');
    } finally {
      setSavingExport(false);
    }
  };

  // Add holiday
  const handleAddHoliday = async (data: CreateHolidayInput) => {
    await holidayRepository.createHoliday(data);
    const updatedHolidays = await holidayRepository.listHolidays();
    setHolidays(updatedHolidays);
    showNotification('Holiday added successfully', 'success');
  };

  // Delete holiday
  const handleDeleteHoliday = async (id: string) => {
    await holidayRepository.deleteHoliday(id);
    const updatedHolidays = await holidayRepository.listHolidays();
    setHolidays(updatedHolidays);
    showNotification('Holiday deleted successfully', 'success');
  };

  // Export backup
  const handleExportBackup = async () => {
    if (!isTauriEnvironment()) {
      showNotification('Backup requires the desktop application', 'error');
      return;
    }
    
    try {
      const result = await exportBackup();
      if (result.success) {
        // Update last backup time
        if (settings) {
          const newBackupSettings = {
            ...settings.backup,
            lastBackupAt: new Date().toISOString(),
          };
          await settingsRepository.updateAppSettings({ backup: newBackupSettings });
          setSettings({ ...settings, backup: newBackupSettings });
        }
        showNotification(`Backup created: ${formatFileSize(result.file_size)}`, 'success');
      } else {
        showNotification(result.error || 'Backup failed', 'error');
      }
    } catch (error) {
      showNotification(error instanceof Error ? error.message : 'Backup failed', 'error');
    }
  };

  // Import backup
  const handleImportBackup = async () => {
    if (!isTauriEnvironment()) {
      showNotification('Restore requires the desktop application', 'error');
      return;
    }
    
    // For now, show a message that file dialog integration is needed
    showNotification('Please use the file browser to select a backup file', 'info');
  };

  // Reset database
  const handleResetDatabase = async () => {
    try {
      const result = await resetDatabase();
      if (result.success) {
        showNotification('Database reset successfully. Please restart the application.', 'success');
      } else {
        showNotification(result.error || 'Reset failed', 'error');
      }
    } catch (error) {
      showNotification(error instanceof Error ? error.message : 'Reset failed', 'error');
    }
  };

  if (loading || !settings) {
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
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-secondary-400 mt-1">Configure application settings and preferences</p>
      </motion.div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 lg:grid-cols-2 gap-6"
      >
        {/* Attendance Rules */}
        <div className="lg:col-span-2">
          <AttendanceRulesSection
            rules={settings.attendance}
            onChange={(rules) => setSettings({ ...settings, attendance: rules })}
            onSave={handleSaveRules}
            saving={savingRules}
          />
        </div>

        {/* Holidays */}
        <HolidaysSection
          holidays={holidays}
          onAdd={handleAddHoliday}
          onDelete={handleDeleteHoliday}
        />

        {/* Backup */}
        <BackupSection
          lastBackupAt={settings.backup.lastBackupAt}
          onExport={handleExportBackup}
          onImport={handleImportBackup}
          onReset={handleResetDatabase}
        />

        {/* Export Settings */}
        <ExportSettingsSection
          settings={settings.export}
          onChange={(exportSettings) => setSettings({ ...settings, export: exportSettings })}
          onSave={handleSaveExport}
          saving={savingExport}
        />

        {/* Appearance */}
        <div className="lg:col-span-2">
          <AppearanceSection
            theme={settings.appearance.theme}
            onChange={(theme) =>
              setSettings({
                ...settings,
                appearance: { ...settings.appearance, theme },
              })
            }
            onSave={handleSaveAppearance}
            saving={savingAppearance}
          />
        </div>
      </motion.div>
    </div>
  );
}
