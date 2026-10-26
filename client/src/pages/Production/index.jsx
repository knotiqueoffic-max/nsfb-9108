import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import api from '../../api/index';
import { useAuthStore } from '../../store/auth';
import { formatCurrency, formatDate, today, daysAgo } from '../../utils/index';

// ─── Materials Used Popover ────────────────────────────────────────────────────────────────────────
function MaterialsPopover({ entryId, productId }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const { data, isLoading } = useQuery({
    queryKey: ['productionMaterials', entryId],
    queryFn: () => api.get(`/production/${entryId}/materials`).then(r => r.data),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const materials = data?.materials ?? [];
  const noMaterials = !isLoading && materials.length === 0;

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-all border ${
          open
            ? 'bg-violet-100 border-violet-300 text-violet-800'
            : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-violet-50 hover:border-violet-200 hover:text-violet-700'
        }`}
        title="View materials used"
      >
        🧶 {isLoading && open ? '…' : noMaterials ? 'No BOM' : `${materials.length} material${materials.length !== 1 ? 's' : ''}`}
      </button>

      {open && (
        <div className="absolute z-50 left-0 top-full mt-1.5 w-72 bg-white border border-slate-200 rounded-xl shadow-xl animate-fade-in">
          {/* Arrow */}
          <div className="absolute -top-1.5 left-4 w-3 h-3 bg-white border-t border-l border-slate-200 rotate-45" />

          <div className="p-3">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Materials Used</p>

            {isLoading ? (
              <div className="flex items-center justify-center py-4">
                <div className="w-5 h-5 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
              </div>
            ) : noMaterials ? (
              <p className="text-xs text-slate-400 py-2 text-center">No BOM configured for this product.</p>
            ) : (
              <div className="space-y-1.5">
                {materials.map(m => (
                  <div key={m.material_id} className="flex items-center justify-between gap-2 py-1 border-b border-slate-50 last:border-0">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-800 truncate">{m.material_name}</p>
                      <p className="text-[10px] text-slate-400">{m.qty_used} {m.unit} × {formatCurrency(m.avg_cost_per_unit)}</p>
                    </div>
                    <span className="text-xs font-semibold text-violet-700 shrink-0">{formatCurrency(m.line_total)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1.5 mt-1 border-t border-slate-200">
                  <span className="text-[11px] font-semibold text-slate-600">Total Material Cost</span>
                  <span className="text-xs font-bold text-violet-800">{formatCurrency(data?.total_material_cost ?? 0)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Production() {
  const { user } = useAuthStore();
  const isAdmin = ['owner', 'admin', 'super_admin'].includes(user?.role);
  const isManager = ['owner', 'admin', 'vendor', 'subvendor', 'super_admin'].includes(user?.role);
  const qc = useQueryClient();

  const [tab, setTab] = useState(isManager ? 'log' : 'history');
  const [filters, setFilters] = useState({ worker_id: '', product_id: '', status: '', start: daysAgo(30), end: today() });
  const [selectedIds, setSelectedIds] = useState([]);
  const [editingNoteEntry, setEditingNoteEntry] = useState(null);

  // Fetch products
  const { data: productsData } = useQuery({
    queryKey: ['products'],
    queryFn: () => api.get('/products').then(r => r.data),
  });
  const products = productsData || [];

  // Fetch crocheters (managers only)
  const { data: workersData } = useQuery({
    queryKey: ['workers'],
    queryFn: () => api.get('/workers').then(r => r.data),
    enabled: isManager,
  });
  const workers = workersData || [];

  // Fetch production entries
  const { data: productionData, isLoading } = useQuery({
    queryKey: ['production', filters],
    queryFn: () => api.get('/production', { params: {
      worker_id: filters.worker_id || undefined,
      product_id: filters.product_id || undefined,
      status: filters.status || undefined,
      start: filters.start || undefined,
      end: filters.end || undefined,
    } }).then(r => r.data),
  });
  const entries = productionData?.entries || [];
  const total = productionData?.total || 0;

  // Form
  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm({
    defaultValues: {
      product_id: '',
      quantity: 1,
      production_date: today(),
      defect_count: 0,
      notes: '',
      worker_id: user?.id ? String(user.id) : '',
      hours_worked: '',
      status: 'ordered',
    }
  });

  useEffect(() => {
    if (user?.id) {
      setValue('worker_id', String(user.id));
    }
  }, [user, setValue]);

  const selectedWorkerId = watch('worker_id');
  const selectedWorker = isAdmin
    ? workers.find(w => String(w.id) === String(selectedWorkerId))
    : { wage_mode: user?.wage_mode };

  const logMutation = useMutation({
    mutationFn: (data) => api.post('/production', data).then(r => r.data),
    onSuccess: (data) => {
      toast.success(`✅ Logged ${data.entry.quantity} units! Labor: ${formatCurrency(data.entry.labor_cost)}`);
      qc.invalidateQueries({ queryKey: ['production'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      reset({
        product_id: '',
        quantity: 1,
        production_date: today(),
        defect_count: 0,
        notes: '',
        worker_id: user?.id ? String(user.id) : '',
        hours_worked: '',
        status: 'ordered',
      });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to log production'),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, status }) => api.put(`/production/${id}`, { status }).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['production'] });
      toast.success(`Updated status to: ${data.status.charAt(0).toUpperCase() + data.status.slice(1)}`);
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to update status'),
  });

  const bulkStatusMutation = useMutation({
    mutationFn: ({ ids, status }) => api.post('/production/bulk-toggle-paid', { ids, status }).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['production'] });
      setSelectedIds([]);
      toast.success(data?.message || 'Updated selected entries!');
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Bulk update failed'),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids) => api.post('/production/bulk-delete', { ids }).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['production'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      setSelectedIds([]);
      toast.success(data?.message || 'Deleted selected entries!');
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Bulk delete failed'),
  });

  const deleteEntryMutation = useMutation({
    mutationFn: (id) => api.delete(`/production/${id}`).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['production'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      toast.success(data?.message || 'Production entry deleted!');
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to delete entry'),
  });

  const onSubmit = (data) => {
    const finalWorkerId = data.worker_id || user?.id;
    if (!data.product_id) {
      toast.error('Please select a product');
      return;
    }
    logMutation.mutate({
      ...data,
      worker_id: Number(finalWorkerId),
      product_id: Number(data.product_id),
      quantity: parseInt(data.quantity),
      defect_count: parseInt(data.defect_count || 0),
      hours_worked: data.hours_worked ? parseFloat(data.hours_worked) : undefined,
      status: data.status,
    });
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(entries.map(item => item.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleExportCSV = () => {
    if (!entries || entries.length === 0) return;
    const csvRows = [];
    csvRows.push(['Date', 'Worker', 'Product', 'Qty', 'Labor Cost', 'Status', 'Notes']);
    entries.forEach(e => {
      csvRows.push([
        formatDate(e.production_date) || '',
        `"${(e.worker_name || '').replace(/"/g, '""')}"`,
        `"${(e.product_name || '').replace(/"/g, '""')}"`,
        e.quantity || 0,
        e.labor_cost || 0,
        e.status || '',
        `"${(e.notes || '').replace(/"/g, '""')}"`
      ]);
    });
    const csvString = csvRows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `production_logs_${today()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const totalPieces = entries.reduce((s, e) => s + e.quantity, 0);
  const totalLabor = entries.reduce((s, e) => s + parseFloat(e.labor_cost || 0), 0);
  const unpaidLabor = entries.filter(e => e.status !== 'paid').reduce((s, e) => s + parseFloat(e.labor_cost || 0), 0);

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-2">
        {isManager && (
          <button onClick={() => setTab('log')} className={`btn ${tab === 'log' ? 'btn-primary' : 'btn-secondary'}`}>
            📝 Log Entry
          </button>
        )}
        <button onClick={() => setTab('history')} className={`btn ${tab === 'history' ? 'btn-primary' : 'btn-secondary'}`}>
          📋 History & Payouts
        </button>
      </div>

      {/* Log Entry Tab (Managers only) */}
      {isManager && tab === 'log' && (
        <div className="card max-w-xl">
          <h2 className="text-lg font-semibold text-slate-800 mb-5">Log Daily Production</h2>

          {products.length === 0 && (
            <div className="p-4 mb-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm">
              <p className="font-semibold">⚠️ No products available in catalog</p>
              <p className="mt-1">Please create a product first under the <strong>Products</strong> tab before logging production entries.</p>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {isManager && (
              <div>
                <label className="label">Crocheter *</label>
                <select {...register('worker_id', { required: 'Crocheter is required' })} className="select">
                  <option value="">Select crocheter...</option>
                  {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                {errors.worker_id && <p className="text-red-500 text-xs mt-1">{errors.worker_id.message}</p>}
              </div>
            )}
            <div>
              <label className="label">Product *</label>
              <select {...register('product_id', { required: 'Product required' })} className="select">
                <option value="">Select product...</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
              </select>
              {errors.product_id && <p className="text-red-500 text-xs mt-1">{errors.product_id.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Quantity Made *</label>
                <input type="number" min="1" {...register('quantity', { required: true, min: 1 })} className="input text-lg font-semibold" />
              </div>
              <div>
                <label className="label">Defects</label>
                <input type="number" min="0" {...register('defect_count')} className="input" />
              </div>
            </div>
            {selectedWorker?.wage_mode === 'per_hour' && (
              <div>
                <label className="label">Hours Worked</label>
                <input type="number" step="0.5" min="0" {...register('hours_worked')} className="input" />
              </div>
            )}
            <div>
              <label className="label">Status *</label>
              <select {...register('status', { required: 'Status required' })} className="select">
                <option value="ordered">📦 Ordered</option>
                <option value="received">📥 Received</option>
                <option value="paid">✅ Paid</option>
              </select>
            </div>
            <div>
              <label className="label">Date *</label>
              <input type="date" {...register('production_date', { required: true })} className="input" max={today()} />
            </div>
            <div>
              <label className="label">Notes</label>
              <textarea {...register('notes')} className="input resize-none" rows={2} placeholder="Any defects, issues, or notes..." />
            </div>
            <button type="submit" disabled={logMutation.isPending || products.length === 0} className="btn-primary w-full py-3 text-base">
              {logMutation.isPending ? 'Logging...' : '✅ Submit Production Entry'}
            </button>
          </form>
        </div>
      )}

      {/* History Tab */}
      {tab === 'history' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="card">
            <div className="flex flex-wrap gap-3">
              {isAdmin && (
                <div>
                  <label className="label text-xs">Worker</label>
                  <select className="select w-40" value={filters.worker_id} onChange={e => setFilters(f => ({ ...f, worker_id: e.target.value }))}>
                    <option value="">All Workers</option>
                    {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="label text-xs">Product</label>
                <select className="select w-44" value={filters.product_id} onChange={e => setFilters(f => ({ ...f, product_id: e.target.value }))}>
                  <option value="">All Products</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label text-xs">Status</label>
                <select className="select w-36" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
                  <option value="">All Statuses</option>
                  <option value="ordered">📦 Ordered</option>
                  <option value="received">📥 Received</option>
                  <option value="paid">✅ Paid</option>
                </select>
              </div>
              <div>
                <label className="label text-xs">From</label>
                <input type="date" className="input w-36" value={filters.start} onChange={e => setFilters(f => ({ ...f, start: e.target.value }))} />
              </div>
              <div>
                <label className="label text-xs">To</label>
                <input type="date" className="input w-36" value={filters.end} onChange={e => setFilters(f => ({ ...f, end: e.target.value }))} />
              </div>
              <div className="flex items-end pb-[1px]">
                <button
                  onClick={handleExportCSV}
                  className="btn-secondary h-[42px] px-4"
                  disabled={entries.length === 0}
                >
                  ⬇️ Export CSV
                </button>
              </div>
            </div>
          </div>

          {/* Bulk Actions Floating Bar */}
          {selectedIds.length > 0 && isAdmin && (
            <div className="p-3 bg-purple-900 text-white rounded-xl shadow-lg flex flex-wrap items-center justify-between gap-3 animate-fade-in">
              <span className="font-semibold text-sm">
                Selected {selectedIds.length} {selectedIds.length === 1 ? 'entry' : 'entries'}
              </span>
              <div className="flex gap-2 flex-wrap">
                <span className="text-xs text-purple-200">Bulk Update Status:</span>
                <select
                  onChange={(e) => {
                    if (e.target.value) {
                      bulkStatusMutation.mutate({ ids: selectedIds, status: e.target.value });
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
                  onClick={() => {
                    if (window.confirm(`Delete ${selectedIds.length} selected production entries? Stock changes will be reverted.`)) {
                      bulkDeleteMutation.mutate(selectedIds);
                    }
                  }}
                  className="btn-sm bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs"
                >
                  🗑️ Delete Selected
                </button>
                <button
                  onClick={() => setSelectedIds([])}
                  className="btn-sm bg-slate-700 hover:bg-slate-800 text-white rounded-lg text-xs"
                >
                  ✖️ Clear Selection
                </button>
              </div>
            </div>
          )}

          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="stat-card">
              <span className="stat-label">Total Pieces</span>
              <span className="stat-value">{totalPieces.toLocaleString()}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Total Labor Cost</span>
              <span className="stat-value">{formatCurrency(totalLabor)}</span>
            </div>
            <div className="stat-card border-2 border-amber-200 bg-amber-50">
              <span className="stat-label text-amber-700">Unpaid Balance</span>
              <span className="stat-value text-amber-800">{formatCurrency(unpaidLabor)}</span>
            </div>
          </div>

          {/* Table */}
          <div className="card p-0 overflow-hidden">
            <div className="table-wrapper">
              {isLoading ? (
                <div className="p-8 text-center text-slate-400">Loading...</div>
              ) : entries.length === 0 ? (
                <div className="p-8 text-center text-slate-400">No production entries found</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      {isAdmin && (
                        <th className="w-10">
                          <input
                            type="checkbox"
                            checked={selectedIds.length === entries.length && entries.length > 0}
                            onChange={handleSelectAll}
                            className="rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                          />
                        </th>
                      )}
                      <th>Date</th>
                      {isAdmin && <th>Worker</th>}
                      <th>Product</th>
                      <th>SKU</th>
                      <th>Qty</th>
                      <th>Labor Cost</th>
                      <th>Materials Used</th>
                      <th>Payout Status</th>
                      <th>Notes</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map(e => (
                      <tr key={e.id} className={selectedIds.includes(e.id) ? 'bg-purple-50' : (e.status !== 'paid' ? 'bg-amber-50/20' : '')}>
                        {isAdmin && (
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(e.id)}
                              onChange={() => handleSelectOne(e.id)}
                              className="rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                            />
                          </td>
                        )}
                        <td className="font-medium">{formatDate(e.production_date)}</td>
                        {isAdmin && <td>{e.worker_name}</td>}
                        <td>{e.product_name}</td>
                        <td className="text-xs text-slate-500 font-mono">{e.sku}</td>
                        <td className="font-semibold">{e.quantity}</td>
                        <td className="font-medium text-emerald-600">{formatCurrency(e.labor_cost)}</td>
                        <td>
                          <MaterialsPopover entryId={e.id} productId={e.product_id} />
                        </td>
                        <td>
                          {isAdmin ? (
                            <select
                              value={e.status || 'ordered'}
                              onChange={(evt) => toggleStatusMutation.mutate({ id: e.id, status: evt.target.value })}
                              className={`select-sm rounded-lg text-xs font-semibold ${
                                e.status === 'paid'
                                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                  : e.status === 'received'
                                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                                  : 'bg-blue-50 border-blue-200 text-blue-800'
                              }`}
                            >
                              <option value="ordered">📦 Ordered</option>
                              <option value="received">📥 Received</option>
                              <option value="paid">✅ Paid</option>
                            </select>
                          ) : (
                            <span className={`badge ${
                              e.status === 'paid'
                                ? 'bg-emerald-50 text-emerald-700'
                                : e.status === 'received'
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-blue-50 text-blue-700'
                            }`}>
                              {e.status === 'paid' ? '✅ Paid' : e.status === 'received' ? '📥 Received' : '📦 Ordered'}
                            </span>
                          )}
                        </td>
                        <td className="text-slate-600 text-xs max-w-xs">
                          {e.notes ? (
                            <span className="inline-flex items-center gap-1 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 px-2 py-0.5 rounded-lg transition-all" title={e.notes}>
                              <span>📝</span>
                              <span className="truncate max-w-[150px]">{e.notes}</span>
                            </span>
                          ) : (
                            <span className="text-slate-300 italic text-[11px]">No notes</span>
                          )}
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setEditingNoteEntry(e)}
                              className="btn-ghost btn-sm p-1 text-xs hover:bg-purple-100 text-purple-700 rounded-md"
                              title={e.notes ? "Edit Note" : "Add Note"}
                            >
                              📝 {e.notes ? "Edit Note" : "Add Note"}
                            </button>
                            {isAdmin && (
                              <button
                                onClick={() => {
                                  if (window.confirm(`Delete production entry #${e.id} for ${e.product_name}?`)) {
                                    deleteEntryMutation.mutate(e.id);
                                  }
                                }}
                                className="btn-danger btn-sm p-1.5"
                                title="Delete entry"
                              >
                                🗑️
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Notes Modal */}
      {editingNoteEntry && (
        <EditNotesModal entry={editingNoteEntry} onClose={() => setEditingNoteEntry(null)} />
      )}
    </div>
  );
}

// ─── Edit Notes Modal ────────────────────────────────────────────────────────
function EditNotesModal({ entry, onClose }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState(entry.notes || '');
  const [defectCount, setDefectCount] = useState(entry.defect_count || 0);

  const mutation = useMutation({
    mutationFn: () => api.put(`/production/${entry.id}`, { notes, defect_count: Number(defectCount) }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production'] });
      toast.success('Production entry notes updated!');
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to update notes'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <span>📝</span> Edit Production Entry Notes
          </h3>
          <button onClick={onClose} className="btn-ghost btn-sm rounded-full w-8 h-8 p-0 flex items-center justify-center">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="p-3 bg-purple-50/50 border border-purple-100 rounded-xl text-xs space-y-1 text-slate-700">
            <p><span className="font-semibold text-purple-900">Product:</span> {entry.product_name} <span className="font-mono text-slate-400">({entry.sku})</span></p>
            <p><span className="font-semibold text-purple-900">Worker:</span> {entry.worker_name || 'Self'}</p>
            <p><span className="font-semibold text-purple-900">Quantity Made:</span> {entry.quantity} pcs | <span className="font-semibold text-purple-900">Date:</span> {formatDate(entry.production_date)}</p>
          </div>

          <div>
            <label className="label text-xs">Defect Count</label>
            <input
              type="number"
              min="0"
              value={defectCount}
              onChange={e => setDefectCount(e.target.value)}
              className="input"
            />
          </div>

          <div>
            <label className="label text-xs">Notes / Remarks</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="input resize-none text-sm"
              rows={4}
              placeholder="Add any production notes, defects, material quality issues, or custom remarks..."
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
              className="btn-primary flex-1"
            >
              {mutation.isPending ? 'Saving...' : '💾 Save Notes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
