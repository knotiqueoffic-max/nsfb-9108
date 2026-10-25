import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { format, parseISO } from 'date-fns';
import api from '../../api/index.js';
import { useAuthStore } from '../../store/auth';
import { usePlan } from '../../hooks/usePlan';
import UpgradePrompt from '../../components/UpgradePrompt';

const formatINR = (v) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(v ?? 0);

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
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
          <button onClick={onClose} className="btn-ghost btn-sm rounded-full w-8 h-8 p-0 flex items-center justify-center">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ─── Worker Form Modal ────────────────────────────────────────────────────────
function WorkerModal({ worker, onClose }) {
  const qc = useQueryClient();
  const isEdit = !!worker;

  const { register, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: {
      name: worker?.name ?? '',
      email: worker?.email ?? '',
      password: '',
      wage_mode: worker?.wage_mode ?? 'per_piece',
      wage_rate: worker?.wage_rate ?? 0,
      status: worker?.status ?? 'active',
    },
  });

  const wageMode = watch('wage_mode');

  const wageModeLabel = {
    per_piece: '₹ per piece',
    per_hour: '₹ per hour',
    per_day: '₹ per day',
  };

  const mutation = useMutation({
    mutationFn: (data) => isEdit
      ? api.put(`/workers/${worker.id}`, data).then(r => r.data)
      : api.post('/workers', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workers'] });
      toast.success(isEdit ? 'Worker updated!' : 'Worker added!');
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Failed to save worker.'),
  });

  const onSubmit = (data) => {
    const payload = {
      ...data,
      wage_rate: Number(data.wage_rate),
    };
    if (isEdit && !data.password) delete payload.password;
    mutation.mutate(payload);
  };

  return (
    <Modal title={isEdit ? `Edit — ${worker.name}` : 'Add Worker'} onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="label">Full Name *</label>
          <input className={`input ${errors.name ? 'border-rose-400' : ''}`}
            {...register('name', { required: 'Name is required' })} />
          {errors.name && <p className="text-rose-500 text-xs mt-1">{errors.name.message}</p>}
        </div>
        <div>
          <label className="label">Email *</label>
          <input type="email" className={`input ${errors.email ? 'border-rose-400' : ''}`}
            {...register('email', { required: 'Email is required' })} />
          {errors.email && <p className="text-rose-500 text-xs mt-1">{errors.email.message}</p>}
        </div>
        <div>
          <label className="label">{isEdit ? 'New Password (leave blank to keep)' : 'Password *'}</label>
          <input type="password" className={`input ${errors.password ? 'border-rose-400' : ''}`}
            {...register('password', isEdit ? {} : { required: 'Password is required', minLength: { value: 6, message: 'Min 6 chars' } })} />
          {errors.password && <p className="text-rose-500 text-xs mt-1">{errors.password.message}</p>}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Wage Mode *</label>
            <select className="select" {...register('wage_mode', { required: true })}>
              <option value="per_piece">Per Piece</option>
              <option value="per_hour">Per Hour</option>
              <option value="per_day">Per Day</option>
            </select>
          </div>
          <div>
            <label className="label">Rate ({wageModeLabel[wageMode] ?? '₹'}) *</label>
            <input type="number" step="0.01" className="input"
              {...register('wage_rate', { required: true, min: { value: 0, message: 'Must be ≥ 0' }, valueAsNumber: true })} />
          </div>
        </div>
        {isEdit && (
          <div>
            <label className="label">Status</label>
            <select className="select" {...register('status')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        )}
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="submit" disabled={mutation.isPending} className="btn-primary flex-1">
            {mutation.isPending ? 'Saving…' : isEdit ? 'Update' : 'Add Worker'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Worker Card ─────────────────────────────────────────────────────────────
function WorkerCard({ worker, onEdit, onToggle, onDelete }) {
  const isActive = Boolean(worker.is_active);
  return (
    <div className={`card border-2 transition-all ${isActive ? 'border-slate-100' : 'border-dashed border-slate-200 opacity-70'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 font-bold text-lg shrink-0">
            {worker.name?.[0]?.toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-slate-800">{worker.name}</p>
            <p className="text-xs text-slate-400">{worker.email}</p>
          </div>
        </div>
        <span className={`badge ${isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
          {isActive ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div className="p-2 bg-slate-50 rounded-lg">
          <p className="text-slate-400">Wage Mode</p>
          <p className="font-semibold capitalize text-slate-700">{worker.wage_mode?.replace('_', ' ') || '—'}</p>
        </div>
        <div className="p-2 bg-slate-50 rounded-lg">
          <p className="text-slate-400">Rate</p>
          <p className="font-semibold text-slate-700">{formatINR(worker.wage_rate)}</p>
        </div>
        <div className="p-2 bg-purple-50 rounded-lg">
          <p className="text-purple-400">30d Pieces</p>
          <p className="font-bold text-purple-700">{worker.stats?.total_pieces ?? worker.pieces_30d ?? 0}</p>
        </div>
        <div className="p-2 bg-emerald-50 rounded-lg">
          <p className="text-emerald-400">30d Earnings</p>
          <p className="font-bold text-emerald-700">{formatINR(worker.stats?.total_earnings ?? worker.earnings_30d)}</p>
        </div>
      </div>

      <div className="flex gap-2 mt-4">
        <button onClick={() => onEdit(worker)} className="btn-secondary btn-sm flex-1">✏️ Edit</button>
        <button onClick={() => onToggle(worker)} className={`btn-sm flex-1 ${isActive ? 'btn-ghost' : 'btn-secondary'}`}>
          {isActive ? '⏸ Deactivate' : '▶ Reactivate'}
        </button>
        <button onClick={() => onDelete(worker)} className="btn-danger btn-sm shrink-0" title="Delete worker">
          🗑️
        </button>
      </div>
    </div>
  );
}

// ─── Payouts Section ──────────────────────────────────────────────────────────
function PayoutsSection({ workers }) {
  const qc = useQueryClient();
  const [periodStart, setPeriodStart] = useState(format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'));
  const [periodEnd, setPeriodEnd] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [showPreview, setShowPreview] = useState(false);
  const [selectedPayoutIds, setSelectedPayoutIds] = useState([]);

  const { data: previewData, isLoading: previewLoading, refetch: fetchPreview } = useQuery({
    queryKey: ['payoutsPreview', periodStart, periodEnd],
    queryFn: () => api.get('/payouts/preview', { params: { period_start: periodStart, period_end: periodEnd } }).then(r => r.data),
    enabled: false,
  });

  const { data: payoutsData, isLoading: payoutsLoading } = useQuery({
    queryKey: ['payouts'],
    queryFn: () => api.get('/payouts').then(r => r.data),
  });

  const generateMutation = useMutation({
    mutationFn: () => api.post('/payouts', { period_start: periodStart, period_end: periodEnd }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payouts'] });
      toast.success('Payouts generated!');
      setShowPreview(false);
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Failed to generate payouts.'),
  });

  const updatePayoutStatusMutation = useMutation({
    mutationFn: ({ id, status }) => api.put(`/payouts/${id}/mark-paid`, { status }).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['payouts'] });
      qc.invalidateQueries({ queryKey: ['production'] });
      toast.success(`Payout status updated to ${data.status}!`);
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Failed to update payout status.'),
  });

  const bulkPayoutStatusMutation = useMutation({
    mutationFn: ({ ids, status }) => api.post('/payouts/bulk-update-status', { ids, status }).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['payouts'] });
      qc.invalidateQueries({ queryKey: ['production'] });
      setSelectedPayoutIds([]);
      toast.success(data?.message || 'Updated selected payouts!');
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Bulk update failed.'),
  });

  const handleSelectAllPayouts = (e) => {
    if (e.target.checked) {
      setSelectedPayoutIds(payouts.map(p => p.id));
    } else {
      setSelectedPayoutIds([]);
    }
  };

  const handleSelectOnePayout = (id) => {
    setSelectedPayoutIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const preview = previewData?.preview ?? previewData ?? [];
  const payouts = payoutsData?.payouts ?? payoutsData ?? [];

  const handleExportCSV = () => {
    if (!payouts || payouts.length === 0) return;
    const csvRows = [];
    csvRows.push(['Worker Name', 'Period Start', 'Period End', 'Amount', 'Status']);
    payouts.forEach(p => {
      csvRows.push([
        `"${(p.worker_name || '').replace(/"/g, '""')}"`,
        p.period_start ? format(parseISO(p.period_start), 'yyyy-MM-dd') : '',
        p.period_end ? format(parseISO(p.period_end), 'yyyy-MM-dd') : '',
        p.amount || 0,
        p.status || ''
      ]);
    });
    const csvString = csvRows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `payouts_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-5">
      {/* Period Picker */}
      <div className="card">
        <div className="card-header">
          <h2 className="font-semibold text-slate-800 text-lg">💸 Payouts</h2>
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="label">Period Start</label>
            <input type="date" className="input" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
          </div>
          <div>
            <label className="label">Period End</label>
            <input type="date" className="input" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
          </div>
          <button onClick={() => { setShowPreview(true); fetchPreview(); }} className="btn-secondary">
            🔍 Preview Payouts
          </button>
        </div>

        {showPreview && (
          <div className="mt-5">
            {previewLoading ? <Spinner /> : (
              <>
                <div className="table-wrapper mb-4">
                  <table>
                    <thead>
                      <tr><th>Worker</th><th>Pieces</th><th>Hours</th><th>Days</th><th>Amount</th></tr>
                    </thead>
                    <tbody>
                      {preview.length === 0 ? (
                        <tr><td colSpan={5} className="text-center text-slate-400 py-6">No production data for this period.</td></tr>
                      ) : preview.map((p, i) => (
                        <tr key={i}>
                          <td className="font-medium">{p.worker_name}</td>
                          <td>{p.pieces ?? 0}</td>
                          <td>{p.hours ?? 0}</td>
                          <td>{p.days ?? 0}</td>
                          <td className="font-bold text-emerald-700">{formatINR(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setShowPreview(false)} className="btn-secondary flex-1">Cancel</button>
                  <button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending || preview.length === 0}
                    className="btn-primary flex-1">
                    {generateMutation.isPending ? 'Generating…' : '✅ Generate Payouts'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Payouts History */}
      <div className="card">
        <div className="card-header flex justify-between items-center">
          <h2 className="font-semibold text-slate-800">Payout History</h2>
          <button
            onClick={handleExportCSV}
            className="btn-secondary btn-sm py-1.5 px-3"
            disabled={payouts.length === 0}
          >
            ⬇️ Export CSV
          </button>
        </div>

        {/* Payout Bulk Actions Floating Bar */}
        {selectedPayoutIds.length > 0 && (
          <div className="p-3 bg-purple-900 text-white rounded-xl shadow-lg flex flex-wrap items-center justify-between gap-3 animate-fade-in mb-4">
            <span className="font-semibold text-sm">
              Selected {selectedPayoutIds.length} {selectedPayoutIds.length === 1 ? 'payout' : 'payouts'}
            </span>
            <div className="flex gap-2 items-center flex-wrap">
              <span className="text-xs text-purple-200">Bulk Update Status:</span>
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    bulkPayoutStatusMutation.mutate({ ids: selectedPayoutIds, status: e.target.value });
                    e.target.value = "";
                  }
                }}
                className="select select-sm bg-purple-800 text-white border-purple-700 rounded-lg text-xs"
                defaultValue=""
              >
                <option value="" disabled>Choose status...</option>
                <option value="ordered">📦 Ordered</option>
                <option value="received">📥 Received</option>
                <option value="paid">✅ Paid</option>
              </select>
              <button
                onClick={() => setSelectedPayoutIds([])}
                className="btn-sm bg-slate-700 hover:bg-slate-800 text-white rounded-lg text-xs"
              >
                ✖️ Clear Selection
              </button>
            </div>
          </div>
        )}

        {payoutsLoading ? <Spinner /> : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th className="w-10">
                    <input
                      type="checkbox"
                      checked={selectedPayoutIds.length === payouts.length && payouts.length > 0}
                      onChange={handleSelectAllPayouts}
                      className="rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                    />
                  </th>
                  <th>Worker</th>
                  <th>Period</th>
                  <th>Amount</th>
                  <th>Payout Status</th>
                </tr>
              </thead>
              <tbody>
                {payouts.length === 0 ? (
                  <tr><td colSpan={5} className="text-center text-slate-400 py-8">No payouts generated yet.</td></tr>
                ) : payouts.map(p => (
                  <tr key={p.id} className={selectedPayoutIds.includes(p.id) ? 'bg-purple-50' : (p.status !== 'paid' ? 'bg-amber-50/20' : '')}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedPayoutIds.includes(p.id)}
                        onChange={() => handleSelectOnePayout(p.id)}
                        className="rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                      />
                    </td>
                    <td className="font-medium">{p.worker_name}</td>
                    <td className="text-xs text-slate-500">
                      {format(parseISO(p.period_start), 'dd MMM')} – {format(parseISO(p.period_end), 'dd MMM yyyy')}
                    </td>
                    <td className="font-bold text-emerald-700">{formatINR(p.amount)}</td>
                    <td>
                      <select
                        value={p.status || 'ordered'}
                        onChange={(evt) => updatePayoutStatusMutation.mutate({ id: p.id, status: evt.target.value })}
                        className={`select-sm rounded-lg text-xs font-semibold ${
                          p.status === 'paid'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : p.status === 'received'
                            ? 'bg-amber-50 border-amber-200 text-amber-800'
                            : 'bg-blue-50 border-blue-200 text-blue-800'
                        }`}
                      >
                        <option value="ordered">📦 Ordered</option>
                        <option value="received">📥 Received</option>
                        <option value="paid">✅ Paid</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function WorkersPage() {
  const { user: authUser } = useAuthStore();
  const qc = useQueryClient();
  const [workerModal, setWorkerModal] = useState(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const { plan, usage, isLimitReached } = usePlan();

  const { data: workersData, isLoading } = useQuery({
    queryKey: ['workers'],
    queryFn: () => api.get('/workers').then(r => r.data),
  });

  const toggleMutation = useMutation({
    mutationFn: (worker) => api.put(`/workers/${worker.id}`, {
      is_active: !worker.is_active,
    }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workers'] });
      qc.invalidateQueries({ queryKey: ['tenant-usage'] });
      toast.success('Worker status updated!');
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Failed.'),
  });

  const deleteWorkerMutation = useMutation({
    mutationFn: (id) => api.delete(`/workers/${id}`).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['workers'] });
      qc.invalidateQueries({ queryKey: ['tenant-usage'] });
      toast.success(data?.message || 'Worker deleted.');
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Failed to delete worker.'),
  });

  const workers = workersData?.workers ?? workersData ?? [];

  const isAdmin = ['owner', 'admin', 'super_admin'].includes(authUser?.role);

  if (!isAdmin) {
    return (
      <div className="card text-center py-16">
        <p className="text-4xl mb-3">🔒</p>
        <p className="text-slate-600 font-medium">Admin access required.</p>
        <p className="text-slate-400 text-sm mt-1">You do not have permission to view this page.</p>
      </div>
    );
  }

  const handleAddWorker = () => {
    if (isLimitReached('workers')) {
      setShowUpgrade(true);
    } else {
      setWorkerModal('add');
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Workers</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage team members and payouts</p>
        </div>
        <button onClick={handleAddWorker} className="btn-primary">+ Add Worker</button>
      </div>

      {isLoading ? <Spinner /> : workers.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-4xl mb-3">👥</p>
          <p className="text-slate-500">No workers yet. Add your first team member!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {workers.map(w => (
            <WorkerCard
              key={w.id}
              worker={w}
              onEdit={(wk) => setWorkerModal(wk)}
              onToggle={(wk) => toggleMutation.mutate(wk)}
              onDelete={(wk) => {
                if (window.confirm(`Delete worker "${wk.name}"?`)) {
                  deleteWorkerMutation.mutate(wk.id);
                }
              }}
            />
          ))}
        </div>
      )}

      <PayoutsSection workers={workers} />

      {workerModal && (
        <WorkerModal
          worker={workerModal === 'add' ? null : workerModal}
          onClose={() => {
            setWorkerModal(null);
            qc.invalidateQueries({ queryKey: ['tenant-usage'] });
          }}
        />
      )}

      {showUpgrade && (
        <UpgradePrompt
          onClose={() => setShowUpgrade(false)}
          title="Worker Limit Reached"
          message={`Your current plan allows up to ${plan?.max_workers} active workers. Upgrade toGrowth or Business to expand your production team.`}
          limitKey="workers"
          currentLimit={plan?.max_workers}
        />
      )}
    </div>
  );
}
