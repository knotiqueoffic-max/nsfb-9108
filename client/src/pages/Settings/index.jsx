import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import api from '../../api/index.js';
import { useAuthStore } from '../../store/auth';

const PLATFORMS = ['flipkart', 'meesho', 'myntra', 'etsy', 'amazon'];

function Spinner() {
  return (
    <div className="flex items-center justify-center py-10">
      <div className="w-7 h-7 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
    </div>
  );
}

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800 text-lg">{title}</h3>
          <button onClick={onClose} className="btn-ghost btn-sm w-8 h-8 p-0 flex items-center justify-center">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ─── Platform Commissions ─────────────────────────────────────────────────────
function PlatformCommissions({ settings }) {
  const qc = useQueryClient();
  const [commissions, setCommissions] = useState(() => {
    const c = {};
    PLATFORMS.forEach(p => { c[p] = settings?.platform_commissions?.[p] ?? 0; });
    return c;
  });

  useEffect(() => {
    if (settings?.platform_commissions) {
      const c = {};
      PLATFORMS.forEach(p => { c[p] = settings.platform_commissions[p] ?? 0; });
      setCommissions(c);
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: () => api.put('/settings', { platform_commissions: commissions }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); toast.success('Commissions saved!'); },
    onError: (e) => toast.error(e?.response?.data?.error || 'Failed to save.'),
  });

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2 className="font-semibold text-slate-800">Platform Commissions</h2>
          <p className="text-slate-400 text-xs mt-0.5">Used for profit margin calculations</p>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-5">
        {PLATFORMS.map(p => (
          <div key={p}>
            <label className="label capitalize flex items-center gap-2">
              <span className={`badge platform-${p}`}>{p}</span>
            </label>
            <div className="relative">
              <input type="number" step="0.1" min="0" max="100"
                className="input pr-7"
                value={commissions[p]}
                onChange={e => setCommissions(prev => ({ ...prev, [p]: parseFloat(e.target.value) || 0 }))} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">%</span>
            </div>
          </div>
        ))}
      </div>
      <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="btn-primary">
        {mutation.isPending ? 'Saving…' : '💾 Save Commissions'}
      </button>
    </div>
  );
}

// ─── Business Settings ────────────────────────────────────────────────────────
function BusinessSettings({ settings }) {
  const qc = useQueryClient();
  const { register, handleSubmit } = useForm({
    defaultValues: {
      business_name: settings?.business_name ?? '',
      default_profit_margin_pct: settings?.default_profit_margin_pct ?? 25,
      labor_cost_per_minute: settings?.labor_cost_per_minute ?? 1,
    },
  });

  const mutation = useMutation({
    mutationFn: (data) => api.put('/settings', data).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); toast.success('Business settings saved!'); },
    onError: (e) => toast.error(e?.response?.data?.error || 'Failed to save.'),
  });

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2 className="font-semibold text-slate-800">Business Settings</h2>
          <p className="text-slate-400 text-xs mt-0.5">General business configuration</p>
        </div>
      </div>
      <form onSubmit={handleSubmit(d => mutation.mutate({
        business_name: d.business_name,
        default_profit_margin_pct: Number(d.default_profit_margin_pct),
        labor_cost_per_minute: Number(d.labor_cost_per_minute),
      }))} className="space-y-4">
        <div>
          <label className="label">Business Name</label>
          <input className="input" placeholder="Knotique Creations" {...register('business_name')} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Default Profit Margin (%)</label>
            <div className="relative">
              <input type="number" step="0.5" min="0" max="100" className="input pr-7"
                {...register('default_profit_margin_pct', { valueAsNumber: true })} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">%</span>
            </div>
          </div>
          <div>
            <label className="label">Labor Cost / Minute (₹)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">₹</span>
              <input type="number" step="0.01" min="0" className="input pl-7"
                {...register('labor_cost_per_minute', { valueAsNumber: true })} />
            </div>
          </div>
        </div>
        <button type="submit" disabled={mutation.isPending} className="btn-primary">
          {mutation.isPending ? 'Saving…' : '💾 Save Settings'}
        </button>
      </form>
    </div>
  );
}

// ─── Add User Modal ───────────────────────────────────────────────────────────
function AddUserModal({ onClose }) {
  const qc = useQueryClient();
  const { register, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: { name: '', email: '', password: '', role: 'worker', wage_mode: 'per_piece', wage_rate: 0 },
  });
  const role = watch('role');

  const mutation = useMutation({
    mutationFn: (data) => api.post('/auth/register', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workers'] });
      toast.success('User created!');
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Failed to create user.'),
  });

  return (
    <Modal title="Add User" onClose={onClose}>
      <form onSubmit={handleSubmit(d => mutation.mutate({ ...d, wage_rate: Number(d.wage_rate) }))} className="space-y-4">
        <div>
          <label className="label">Full Name *</label>
          <input className={`input ${errors.name ? 'border-rose-400' : ''}`}
            {...register('name', { required: 'Name is required' })} />
        </div>
        <div>
          <label className="label">Email *</label>
          <input type="email" className={`input ${errors.email ? 'border-rose-400' : ''}`}
            {...register('email', { required: 'Email is required' })} />
        </div>
        <div>
          <label className="label">Password *</label>
          <input type="password" className={`input ${errors.password ? 'border-rose-400' : ''}`}
            {...register('password', { required: 'Password is required', minLength: { value: 6, message: 'Min 6 chars' } })} />
          {errors.password && <p className="text-rose-500 text-xs mt-1">{errors.password.message}</p>}
        </div>
        <div>
          <label className="label">Role *</label>
          <select className="select" {...register('role', { required: true })}>
            <option value="worker">Worker</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        {role === 'worker' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Wage Mode</label>
              <select className="select" {...register('wage_mode')}>
                <option value="per_piece">Per Piece</option>
                <option value="per_hour">Per Hour</option>
                <option value="per_day">Per Day</option>
              </select>
            </div>
            <div>
              <label className="label">Wage Rate (₹)</label>
              <input type="number" step="0.01" className="input" {...register('wage_rate', { valueAsNumber: true, min: 0 })} />
            </div>
          </div>
        )}
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="submit" disabled={mutation.isPending} className="btn-primary flex-1">
            {mutation.isPending ? 'Creating…' : 'Create User'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── User Management ──────────────────────────────────────────────────────────
function UserManagement() {
  const [addModal, setAddModal] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['workers'],
    queryFn: () => api.get('/workers').then(r => r.data),
  });
  const workers = data?.workers ?? data ?? [];
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2 className="font-semibold text-slate-800">User Management</h2>
          <p className="text-slate-400 text-xs mt-0.5">All system users</p>
        </div>
        <button onClick={() => setAddModal(true)} className="btn-primary btn-sm">+ Add User</button>
      </div>
      {isLoading ? <Spinner /> : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Wage Mode</th><th>Status</th></tr>
            </thead>
            <tbody>
              {workers.length === 0
                ? <tr><td colSpan={5} className="text-center text-slate-400 py-6">No users yet.</td></tr>
                : workers.map(w => (
                  <tr key={w.id}>
                    <td className="font-medium">{w.name}</td>
                    <td className="text-slate-500">{w.email}</td>
                    <td><span className={`badge ${w.role === 'admin' ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>{w.role}</span></td>
                    <td className="text-slate-500 capitalize">{w.wage_mode?.replace('_', ' ') ?? '—'}</td>
                    <td>
                      <span className={`badge ${w.status !== 'inactive' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                        {w.status !== 'inactive' ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {addModal && <AddUserModal onClose={() => setAddModal(false)} />}
    </div>
  );
}

// ─── Change Password ──────────────────────────────────────────────────────────
function ChangePassword() {
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm();
  const mutation = useMutation({
    mutationFn: (data) => api.put('/auth/change-password', data).then(r => r.data),
    onSuccess: () => { toast.success('Password changed!'); reset(); },
    onError: (e) => toast.error(e?.response?.data?.error || 'Failed to change password.'),
  });
  const newPwd = watch('new_password');
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2 className="font-semibold text-slate-800">Change Password</h2>
          <p className="text-slate-400 text-xs mt-0.5">Update your login credentials</p>
        </div>
      </div>
      <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-4 max-w-md">
        <div>
          <label className="label">Current Password *</label>
          <input type="password" className={`input ${errors.current_password ? 'border-rose-400' : ''}`}
            {...register('current_password', { required: 'Required' })} />
        </div>
        <div>
          <label className="label">New Password *</label>
          <input type="password" className={`input ${errors.new_password ? 'border-rose-400' : ''}`}
            {...register('new_password', { required: 'Required', minLength: { value: 6, message: 'Min 6 chars' } })} />
          {errors.new_password && <p className="text-rose-500 text-xs mt-1">{errors.new_password.message}</p>}
        </div>
        <div>
          <label className="label">Confirm New Password *</label>
          <input type="password" className={`input ${errors.confirm_password ? 'border-rose-400' : ''}`}
            {...register('confirm_password', {
              required: 'Required',
              validate: v => v === newPwd || 'Passwords do not match',
            })} />
          {errors.confirm_password && <p className="text-rose-500 text-xs mt-1">{errors.confirm_password.message}</p>}
        </div>
        <button type="submit" disabled={mutation.isPending} className="btn-primary">
          {mutation.isPending ? 'Changing…' : '🔒 Change Password'}
        </button>
      </form>
    </div>
  );
}

// ─── Auto Daily Backup & Database Security ──────────────────────────────────────
function DatabaseBackup() {
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [actionFile, setActionFile] = useState(null); // track restoring/deleting filename
  const qc = useQueryClient();

  // Query backup status & snapshot history
  const { data: backupData, isLoading, refetch } = useQuery({
    queryKey: ['backupStatus'],
    queryFn: () => api.get('/settings/backups').then(r => r.data),
  });

  const backups = backupData?.backups ?? [];
  const autoBackupEnabled = backupData?.auto_backup_enabled ?? true;
  const backupRetentionDays = backupData?.backup_retention_days ?? 30;
  const lastBackupAt = backupData?.last_backup_at;

  const [autoEnabled, setAutoEnabled] = useState(autoBackupEnabled);
  const [retentionDays, setRetentionDays] = useState(backupRetentionDays);

  useEffect(() => {
    if (backupData) {
      setAutoEnabled(backupData.auto_backup_enabled ?? true);
      setRetentionDays(backupData.backup_retention_days ?? 30);
    }
  }, [backupData]);

  // Mutation to save backup preferences
  const prefMutation = useMutation({
    mutationFn: (data) => api.put('/settings', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['backupStatus'] });
      toast.success('Backup preferences updated!');
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Failed to update backup settings.'),
  });

  // Run instant manual backup
  const handleRunBackup = async () => {
    setCreating(true);
    try {
      const res = await api.post('/settings/backups/run');
      toast.success(res.data?.message || 'New backup snapshot created!');
      refetch();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to create backup.');
    } finally {
      setCreating(false);
    }
  };

  // Download specific backup snapshot
  const handleDownload = async (filename) => {
    try {
      const res = await api.get(`/settings/backups/download/${encodeURIComponent(filename)}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success(`Downloaded ${filename}`);
    } catch {
      toast.error('Download failed.');
    }
  };

  // Restore database from snapshot
  const handleRestore = async (filename) => {
    if (!window.confirm(`⚠️ Are you sure you want to restore database from '${filename}'?\n\nA safety snapshot of the current state will be saved automatically before replacing.`)) {
      return;
    }
    setActionFile(filename);
    try {
      const res = await api.post(`/settings/backups/restore/${encodeURIComponent(filename)}`);
      qc.invalidateQueries();
      refetch();
      toast.success(res.data?.message || 'Database restored successfully!');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to restore database.');
    } finally {
      setActionFile(null);
    }
  };

  // Delete backup snapshot
  const handleDelete = async (filename) => {
    if (!window.confirm(`Delete backup '${filename}' permanently?`)) return;
    setActionFile(filename);
    try {
      const res = await api.delete(`/settings/backups/${encodeURIComponent(filename)}`);
      toast.success(res.data?.message || 'Backup deleted');
      refetch();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to delete backup.');
    } finally {
      setActionFile(null);
    }
  };

  const handleManualReset = async () => {
    const confirmName = window.prompt("⚠️ WARNING: This will delete all products, raw materials, orders, production logs, and purchase records!\n\nType 'RESET' below to confirm manual database wipe:");
    if (confirmName !== 'RESET') {
      toast('Database reset cancelled.');
      return;
    }

    setResetting(true);
    try {
      await api.post('/settings/reset-database');
      qc.invalidateQueries();
      refetch();
      toast.success('🧹 Database wiped clean! Zero entries remain.');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to reset database.');
    } finally {
      setResetting(false);
    }
  };

  const formatSize = (bytes) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="card space-y-6">
      <div className="card-header">
        <div>
          <h2 className="font-semibold text-slate-800 flex items-center gap-2">
            🛡️ Auto Daily Backup & Data Security
          </h2>
          <p className="text-slate-400 text-xs mt-0.5">Automated database protection & snapshot management</p>
        </div>
        <button
          onClick={handleRunBackup}
          disabled={creating}
          className="btn-primary btn-sm flex items-center gap-1.5 shrink-0"
        >
          {creating ? 'Creating…' : '⚡ Instant Backup Now'}
        </button>
      </div>

      {/* Auto Backup Configuration Bar */}
      <div className="p-4 bg-gradient-to-r from-violet-50 via-purple-50 to-indigo-50 rounded-xl border border-violet-100 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={autoEnabled}
                onChange={(e) => setAutoEnabled(e.target.checked)}
              />
              <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-600"></div>
            </label>
            <div>
              <span className="text-sm font-semibold text-slate-800">Automated Daily Backups</span>
              <p className="text-xs text-slate-500">Automatically creates daily snapshots every 24 hours</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600 font-medium">Keep for:</span>
              <select
                className="select text-xs py-1.5 px-2.5 bg-white border-slate-200"
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value))}
              >
                <option value={7}>7 Days</option>
                <option value={14}>14 Days</option>
                <option value={30}>30 Days</option>
                <option value={60}>60 Days</option>
                <option value={90}>90 Days</option>
              </select>
            </div>
            <button
              onClick={() => prefMutation.mutate({ auto_backup_enabled: autoEnabled, backup_retention_days: retentionDays })}
              disabled={prefMutation.isPending}
              className="btn-secondary btn-sm text-xs"
            >
              {prefMutation.isPending ? 'Saving…' : 'Save Config'}
            </button>
          </div>
        </div>

        {/* Status Indicator */}
        <div className="flex flex-wrap items-center justify-between pt-2 border-t border-violet-100 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${autoEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`}></span>
            <span>Status: <strong>{autoEnabled ? 'Active (Scheduled Daily)' : 'Paused'}</strong></span>
          </div>
          <div>
            <span>Last Snapshot: <strong>{lastBackupAt ? new Date(lastBackupAt).toLocaleString() : 'No backups recorded yet'}</strong></span>
          </div>
        </div>
      </div>

      {/* Snapshots Table */}
      <div>
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Available Backup Snapshots ({backups.length})</h3>
        {isLoading ? <Spinner /> : backups.length === 0 ? (
          <div className="text-center py-6 bg-slate-50 rounded-xl text-slate-400 text-xs">
            No backup snapshots stored on server yet. Click <strong>⚡ Instant Backup Now</strong> above to create one.
          </div>
        ) : (
          <div className="table-wrapper max-h-64 overflow-y-auto border border-slate-100 rounded-xl">
            <table>
              <thead>
                <tr>
                  <th>Snapshot File</th>
                  <th>Type</th>
                  <th>Created Date & Time</th>
                  <th>Size</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.filename}>
                    <td className="font-mono text-xs text-slate-800 font-medium">
                      {b.filename}
                    </td>
                    <td>
                      <span className={`badge text-[11px] ${b.is_auto ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' : b.filename.includes('safety') ? 'bg-amber-50 text-amber-700 border border-amber-100' : 'bg-purple-50 text-purple-700 border border-purple-100'}`}>
                        {b.is_auto ? '🤖 Daily Auto' : b.filename.includes('safety') ? '🛡️ Safety' : '👤 Manual'}
                      </span>
                    </td>
                    <td className="text-xs text-slate-500">
                      {new Date(b.created_at).toLocaleString()}
                    </td>
                    <td className="text-xs text-slate-500 font-mono">
                      {formatSize(b.size)}
                    </td>
                    <td className="text-right space-x-1">
                      <button
                        onClick={() => handleDownload(b.filename)}
                        title="Download backup file"
                        className="btn-ghost btn-sm text-xs py-1 px-2 text-violet-600 hover:bg-violet-50"
                      >
                        ⬇️ Download
                      </button>
                      <button
                        onClick={() => handleRestore(b.filename)}
                        disabled={actionFile === b.filename}
                        title="Restore database from this snapshot"
                        className="btn-ghost btn-sm text-xs py-1 px-2 text-amber-600 hover:bg-amber-50"
                      >
                        {actionFile === b.filename ? 'Restoring…' : '🔄 Restore'}
                      </button>
                      <button
                        onClick={() => handleDelete(b.filename)}
                        disabled={actionFile === b.filename}
                        title="Delete snapshot file"
                        className="btn-ghost btn-sm text-xs py-1 px-2 text-rose-600 hover:bg-rose-50"
                      >
                        🗑️ Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Manual Database Reset Section */}
      <div className="flex items-center gap-4 p-4 bg-rose-50 rounded-xl border border-rose-100">
        <span className="text-3xl">🧹</span>
        <div className="flex-1">
          <p className="text-sm font-medium text-rose-900">Manual Database Reset (Clear All Business Entries)</p>
          <p className="text-xs text-rose-700">Wipe products, orders, and logs to start clean. (Will never run automatically)</p>
        </div>
        <button onClick={handleManualReset} disabled={resetting} className="btn-danger shrink-0">
          {resetting ? 'Resetting…' : '⚠️ Reset Database'}
        </button>
      </div>
    </div>
  );
}

// ─── Platform Connector Status ────────────────────────────────────────────────
function ConnectorStatus() {
  const { data, isLoading } = useQuery({
    queryKey: ['connectorStatus'],
    queryFn: () => api.get('/connectors/status').then(r => r.data),
  });

  const platforms = data?.platforms ?? [];

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2 className="font-semibold text-slate-800">Platform API Connections</h2>
          <p className="text-slate-400 text-xs mt-0.5">Status of marketplace integrations</p>
        </div>
      </div>
      {isLoading ? <Spinner /> : (
        <div className="space-y-3">
          {PLATFORMS.map(p => {
            const status = platforms.find(x => x.platform === p);
            const connected = status?.connected ?? false;
            return (
              <div key={p} className={`flex items-center gap-4 p-4 rounded-xl border
                ${connected ? 'bg-emerald-50 border-emerald-100' : 'bg-slate-50 border-slate-100'}`}>
                <span className={`badge platform-${p} text-sm`}>{p.charAt(0).toUpperCase() + p.slice(1)}</span>
                <div className="flex-1">
                  <p className={`text-sm font-medium ${connected ? 'text-emerald-700' : 'text-slate-500'}`}>
                    {connected ? '✅ Connected' : '⚠️ Not configured'}
                  </p>
                  {!connected && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      Add <code className="bg-slate-200 px-1 rounded text-xs">{p.toUpperCase()}_API_KEY</code> to your server .env file
                    </p>
                  )}
                  {status?.last_sync && (
                    <p className="text-xs text-slate-400 mt-0.5">Last sync: {status.last_sync}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
        <p className="text-xs font-medium text-slate-700 mb-2">📋 To connect a platform:</p>
        <ol className="text-xs text-slate-500 space-y-1 list-decimal list-inside">
          <li>Open your server <code className="bg-slate-200 px-1 rounded">.env</code> file</li>
          <li>Add the API key for the platform (e.g. <code className="bg-slate-200 px-1 rounded">FLIPKART_API_KEY=your_key_here</code>)</li>
          <li>Restart the server</li>
        </ol>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { user } = useAuthStore();
  const isAdmin = ['owner', 'admin', 'super_admin'].includes(user?.role);

  const { data: settingsData, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get('/settings').then(r => r.data),
    enabled: isAdmin,
  });

  const settings = settingsData?.settings ?? settingsData ?? {};

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Settings</h1>
        <p className="text-slate-500 text-sm mt-0.5">Configure your Knotique workspace</p>
      </div>

      {isAdmin && (
        <>
          {isLoading ? <Spinner /> : (
            <>
              <PlatformCommissions settings={settings} />
              <BusinessSettings settings={settings} />
            </>
          )}
          <UserManagement />
          <DatabaseBackup />
          <ConnectorStatus />
        </>
      )}

      <ChangePassword />
    </div>
  );
}
