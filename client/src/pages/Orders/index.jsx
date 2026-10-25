import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import api from '../../api/index.js';
import { useAuthStore } from '../../store/auth';
import { usePlan } from '../../hooks/usePlan';
import UpgradePrompt from '../../components/UpgradePrompt';
import { formatCurrency, formatDate, today, PLATFORMS, PLATFORM_NAMES, ORDER_STATUSES, capitalize } from '../../utils/index';

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-7 h-7 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
    </div>
  );
}

function Modal({ title, onClose, children }) {
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

// ─── Stats Row ────────────────────────────────────────────────────────────────
function StatsRow({ stats }) {
  const items = [
    { key: 'pending', label: 'Pending', icon: '⏳', color: 'bg-amber-50 border-amber-100 text-amber-700' },
    { key: 'packed', label: 'Packed', icon: '📦', color: 'bg-blue-50 border-blue-100 text-blue-700' },
    { key: 'shipped', label: 'Shipped', icon: '🚚', color: 'bg-purple-50 border-purple-100 text-purple-700' },
    { key: 'delivered', label: 'Delivered', icon: '✅', color: 'bg-emerald-50 border-emerald-100 text-emerald-700' },
    { key: 'stock_flagged', label: 'Stock Flagged', icon: '⚠️', color: 'bg-rose-50 border-rose-100 text-rose-700' },
  ];

  const statusMap = {};
  (stats?.by_status || []).forEach(s => { statusMap[s.status] = s.count; });

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {items.map(item => (
        <div key={item.key} className={`card border-2 ${item.color} py-4 text-center`}>
          <p className="text-2xl mb-1">{item.icon}</p>
          <p className="text-2xl font-bold">{item.key === 'stock_flagged' ? (stats?.stock_flagged_count || 0) : (statusMap[item.key] || 0)}</p>
          <p className="text-xs mt-0.5 opacity-80">{item.label}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Import CSV/Excel Modal (Preview & Summary Flow) ──────────────────────────
function ImportModal({ onClose }) {
  const qc = useQueryClient();
  const [platform, setPlatform] = useState('flipkart');
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [step, setStep] = useState('upload'); // 'upload' | 'preview' | 'summary'
  const [previewData, setPreviewData] = useState(null);
  const [summaryData, setSummaryData] = useState(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const inputRef = useRef();

  // Mutation for preview
  const previewMutation = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', file);
      if (platform) fd.append('platform', platform);
      return api.post('/orders/import-preview', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
    },
    onSuccess: (data) => {
      setPreviewData(data);
      setStep('preview');
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Failed to generate preview.'),
  });

  // Mutation for commit import
  const commitMutation = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', file);
      if (platform) fd.append('platform', platform);
      fd.append('skip_duplicates', skipDuplicates ? 'true' : 'false');
      return api.post('/orders/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['orderStats'] });
      qc.invalidateQueries({ queryKey: ['production'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      setSummaryData(res);
      setStep('summary');
      toast.success(`Import complete! ${res.imported_count} orders created.`);
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Import commit failed.'),
  });

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  }, []);

  return (
    <Modal title={step === 'preview' ? 'Import Preview' : step === 'summary' ? 'Import Complete Summary' : 'Import Orders from CSV / Excel'} onClose={onClose}>
      {step === 'upload' && (
        <div className="space-y-4">
          <div>
            <label className="label">Platform</label>
            <select className="select" value={platform} onChange={e => setPlatform(e.target.value)}>
              {PLATFORMS.map(p => <option key={p} value={p} className="capitalize">{PLATFORM_NAMES[p] || p}</option>)}
            </select>
          </div>
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
              ${dragging ? 'border-purple-400 bg-purple-50' : 'border-slate-200 hover:border-purple-300 hover:bg-slate-50'}`}>
            <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
              onChange={e => setFile(e.target.files?.[0])} />
            <p className="text-3xl mb-2">📄</p>
            {file
              ? <p className="text-sm font-medium text-purple-700">{file.name}</p>
              : <><p className="text-sm text-slate-600 font-medium">Drop Flipkart CSV / Excel here or click to browse</p>
                <p className="text-xs text-slate-400 mt-1">Parses exact export headers: Ordered On, SKU, Selling Price Per Item, Order State, etc.</p></>
            }
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button disabled={!file || previewMutation.isPending} onClick={() => previewMutation.mutate()}
              className="btn-primary flex-1">
              {previewMutation.isPending ? 'Analyzing File…' : '🔍 Preview Import'}
            </button>
          </div>
        </div>
      )}

      {step === 'preview' && previewData && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <p className="text-xs text-slate-500">Total Rows</p>
              <p className="text-lg font-bold text-slate-800">{previewData.total_rows}</p>
            </div>
            <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
              <p className="text-xs text-emerald-600">Matched SKUs</p>
              <p className="text-lg font-bold text-emerald-700">{previewData.matched_count}</p>
            </div>
            <div className="p-3 bg-amber-50 rounded-xl border border-amber-100">
              <p className="text-xs text-amber-600">Unmatched SKUs</p>
              <p className="text-lg font-bold text-amber-700">{previewData.unmatched_count}</p>
            </div>
          </div>

          {previewData.unmatched_count > 0 && (
            <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 space-y-2">
              <div className="flex items-center gap-1.5 font-semibold">
                <span>⚠️ Unmatched SKU Warning ({previewData.unmatched_skus.length} unique SKUs)</span>
              </div>
              <p className="text-amber-800">
                These order rows do not match any existing SKU in your Products module. They will be imported, but <strong>profit will NOT be calculated (₹0 COGS ignored)</strong> until you add or link the product recipes.
              </p>
              <div className="max-h-24 overflow-y-auto space-y-1 bg-white/70 p-2 rounded border border-amber-200 font-mono">
                {previewData.unmatched_skus.map((u) => (
                  <div key={u.sku} className="flex justify-between text-[11px]">
                    <span className="font-bold">{u.sku}</span>
                    <span className="text-slate-500 truncate max-w-[200px]">{u.product_name}</span>
                    <span className="bg-amber-200 text-amber-800 px-1 rounded">{u.count} orders</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {previewData.duplicate_count > 0 && (
            <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 flex items-center justify-between text-xs text-blue-900">
              <span>ℹ️ <strong>{previewData.duplicate_count}</strong> duplicate order IDs detected.</span>
              <label className="flex items-center gap-1.5 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={skipDuplicates}
                  onChange={e => setSkipDuplicates(e.target.checked)}
                  className="rounded text-purple-600"
                />
                Skip Duplicates (Recommended)
              </label>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button onClick={() => setStep('upload')} className="btn-secondary flex-1">Back</button>
            <button
              disabled={commitMutation.isPending}
              onClick={() => commitMutation.mutate()}
              className="btn-primary flex-1"
            >
              {commitMutation.isPending ? 'Importing Orders…' : `Confirm & Import (${previewData.total_rows} Rows)`}
            </button>
          </div>
        </div>
      )}

      {step === 'summary' && summaryData && (
        <div className="space-y-4 text-center py-2">
          <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-2xl mx-auto">
            🎉
          </div>
          <h3 className="font-bold text-slate-800 text-lg">Import Processed Successfully!</h3>

          <div className="grid grid-cols-2 gap-3 text-left">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <p className="text-xs text-slate-400">Imported Orders</p>
              <p className="text-xl font-bold text-slate-800">{summaryData.imported_count}</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <p className="text-xs text-slate-400">Skipped Duplicates</p>
              <p className="text-xl font-bold text-slate-800">{summaryData.skipped_duplicates}</p>
            </div>
            <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
              <p className="text-xs text-emerald-600">Total Net Revenue</p>
              <p className="text-xl font-bold text-emerald-700">{formatCurrency(summaryData.total_revenue || 0)}</p>
            </div>
            <div className="p-3 bg-purple-50 rounded-xl border border-purple-100">
              <p className="text-xs text-purple-600">Total Net Profit (COGS-based)</p>
              <p className="text-xl font-bold text-purple-700">{formatCurrency(summaryData.total_profit || 0)}</p>
            </div>
          </div>

          {summaryData.unmatched_count > 0 && (
            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 text-left space-y-1">
              <p className="font-bold">⚠️ {summaryData.unmatched_count} orders have unmatched SKUs</p>
              <p className="text-amber-700">Profit for these orders is excluded until you add the matching SKUs in Products.</p>
            </div>
          )}

          <button onClick={onClose} className="btn-primary w-full mt-2">
            Close & Refresh Dashboard
          </button>
        </div>
      )}
    </Modal>
  );
}

// ─── Manual Add Modal ─────────────────────────────────────────────────────────
function ManualOrderModal({ workers = [], onClose }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: {
      external_order_id: '', platform: 'manual', product_name: '', sku: '',
      quantity: 1, unit_price: 0, listing_price: '', order_date: today(),
      shipping_deadline: '', status: 'pending', worker_id: '', notes: '',
    },
  });

  const mutation = useMutation({
    mutationFn: (data) => {
      const isReturned = data.worker_id === '__returned__';
      return api.post('/orders', {
        ...data,
        quantity: Number(data.quantity),
        unit_price: Number(data.unit_price),
        listing_price: data.listing_price ? Number(data.listing_price) : null,
        worker_id: isReturned ? null : (data.worker_id ? Number(data.worker_id) : null),
        is_from_returned: isReturned,
        label: isReturned ? 'from the returned' : null,
      }).then(r => r.data);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['orderStats'] });
      qc.invalidateQueries({ queryKey: ['production'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      if (data.production_entry) {
        toast.success(`Order created & production logged for worker!`);
      } else {
        toast.success('Order added!');
      }
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Failed to add order.'),
  });

  return (
    <Modal title="Add Order" onClose={onClose}>
      <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Platform *</label>
            <select className="select" {...register('platform', { required: true })}>
              {PLATFORMS.map(p => <option key={p} value={p} className="capitalize">{PLATFORM_NAMES[p] || p}</option>)}
            </select>
          </div>
          <div>
            <label className="label">External Order ID</label>
            <input className="input" placeholder="e.g. FK-99120" {...register('external_order_id')} />
          </div>
          <div className="col-span-2">
            <label className="label">Product Name *</label>
            <input className={`input ${errors.product_name ? 'border-rose-400' : ''}`}
              {...register('product_name', { required: 'Required' })} />
          </div>
          <div>
            <label className="label">SKU</label>
            <input className="input" placeholder="e.g. KC-BEAR-01" {...register('sku')} />
          </div>
          <div>
            <label className="label">Fulfilled By</label>
            <select className="select" {...register('worker_id')}>
              <option value="">— Unassigned —</option>
              <option value="__returned__">♻️ Returned Parcel</option>
              {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Quantity *</label>
            <input type="number" min="1" className="input"
              {...register('quantity', { required: true, min: 1, valueAsNumber: true })} />
          </div>
          <div>
            <label className="label">Listing Price (₹)</label>
            <input type="number" step="0.01" className="input"
              {...register('listing_price', { min: 0, valueAsNumber: true })} />
          </div>
          <div>
            <label className="label">Selling Price (₹) *</label>
            <input type="number" step="0.01" className="input"
              {...register('unit_price', { required: true, min: 0, valueAsNumber: true })} />
          </div>
          <div>
            <label className="label">Order Date *</label>
            <input type="date" className="input" {...register('order_date', { required: true })} />
          </div>
          <div>
            <label className="label">Ship By Date</label>
            <input type="date" className="input" {...register('shipping_deadline')} />
          </div>
          <div className="col-span-2">
            <label className="label">Customer City & State</label>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="City" {...register('customer_city')} />
              <input className="input" placeholder="State" {...register('customer_state')} />
            </div>
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="submit" disabled={mutation.isPending} className="btn-primary flex-1">
            {mutation.isPending ? 'Adding…' : 'Add Order'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Bulk Action Bar ─────────────────────────────────────────────────────────
function BulkActionBar({ selectedIds, orders, workers, onClear, onBulkAction, isPending }) {
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkWorker, setBulkWorker] = useState('');
  const count = selectedIds.size;
  if (count === 0) return null;

  return (
    <div className="sticky bottom-4 z-40 mx-auto animate-in slide-in-from-bottom-3 duration-200">
      <div className="bg-slate-900 text-white rounded-2xl shadow-2xl px-5 py-3.5 flex flex-wrap items-center gap-3">
        {/* Count + clear */}
        <div className="flex items-center gap-2 mr-2">
          <span className="w-7 h-7 bg-violet-500 rounded-full flex items-center justify-center text-xs font-bold shrink-0">{count}</span>
          <span className="text-sm font-medium text-slate-200">{count === 1 ? 'order' : 'orders'} selected</span>
          <button onClick={onClear} className="text-slate-400 hover:text-white text-xs underline ml-1">Clear</button>
        </div>

        <div className="h-5 w-px bg-slate-700 hidden sm:block" />

        {/* Status bulk apply */}
        <div className="flex items-center gap-2">
          <select
            className="bg-slate-800 text-white text-xs rounded-lg px-2 py-1.5 border border-slate-700 focus:outline-none focus:border-violet-500"
            value={bulkStatus}
            onChange={e => setBulkStatus(e.target.value)}
          >
            <option value="">Set status…</option>
            {ORDER_STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
          </select>
          <button
            disabled={!bulkStatus || isPending}
            onClick={() => { onBulkAction('status', { status: bulkStatus }); setBulkStatus(''); }}
            className="bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            {isPending ? '…' : 'Apply'}
          </button>
        </div>

        <div className="h-5 w-px bg-slate-700 hidden sm:block" />

        {/* Worker / Fulfillment bulk assign */}
        <div className="flex items-center gap-2">
          <select
            className="bg-slate-800 text-white text-xs rounded-lg px-2 py-1.5 border border-slate-700 focus:outline-none focus:border-violet-500"
            value={bulkWorker}
            onChange={e => setBulkWorker(e.target.value)}
          >
            <option value="">Fulfilled by…</option>
            <option value="__returned__">♻️ Returned Parcel</option>
            <option value="__unassign__">— Unassign —</option>
            {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <button
            disabled={!bulkWorker || isPending}
            onClick={() => {
              if (bulkWorker === '__returned__') {
                onBulkAction('label', { label: 'from the returned', is_from_returned: true });
                onBulkAction('assign_worker', { worker_id: null });
              } else {
                onBulkAction('assign_worker', { worker_id: bulkWorker === '__unassign__' ? null : Number(bulkWorker) });
              }
              setBulkWorker('');
            }}
            className="bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            {isPending ? '…' : 'Apply'}
          </button>
        </div>

        <div className="h-5 w-px bg-slate-700 hidden sm:block" />

        {/* Label From Returned */}
        <button
          disabled={isPending}
          onClick={() => onBulkAction('label', { label: 'from the returned', is_from_returned: true })}
          className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
          title="Mark selected orders as fulfilled from returned parcel"
        >
          ♻️ Label 'From Returned'
        </button>

        <div className="ml-auto" />

        {/* Delete */}
        <button
          disabled={isPending}
          onClick={() => {
            if (window.confirm(`Delete ${count} selected order${count > 1 ? 's' : ''}? This cannot be undone.`)) {
              onBulkAction('delete', {});
            }
          }}
          className="bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
        >
          🗑️ Delete {count > 1 ? `${count} orders` : 'order'}
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function OrdersPage() {
  const { user } = useAuthStore();
  const isAdmin = ['owner', 'admin', 'super_admin'].includes(user?.role);
  const qc = useQueryClient();

  const [platformFilter, setPlatformFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [workerFilter, setWorkerFilter] = useState('');
  const [fromReturnedFilter, setFromReturnedFilter] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [importModal, setImportModal] = useState(false);
  const [addModal, setAddModal] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const { plan, hasFeature } = usePlan();

  // ── Bulk selection ──
  const [selectedIds, setSelectedIds] = useState(new Set());

  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleSelectAll = (orders) => {
    if (selectedIds.size === orders.length && orders.every(o => selectedIds.has(o.id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(orders.map(o => o.id)));
    }
  };

  // Clear selection and reset page to 1 when filters or limit change
  useEffect(() => {
    setSelectedIds(new Set());
    setPage(1);
  }, [platformFilter, statusFilter, workerFilter, fromReturnedFilter, startDate, endDate, search, limit]);

  const { data: statsData } = useQuery({
    queryKey: ['orderStats'],
    queryFn: () => api.get('/orders/stats').then(r => r.data),
  });

  const { data: workersData } = useQuery({
    queryKey: ['workers'],
    queryFn: () => api.get('/workers').then(r => r.data),
    enabled: isAdmin,
  });

  const { data: ordersData, isLoading } = useQuery({
    queryKey: ['orders', platformFilter, statusFilter, workerFilter, fromReturnedFilter, startDate, endDate, search, page, limit],
    queryFn: () => api.get('/orders', {
      params: {
        platform: platformFilter || undefined,
        status: statusFilter || undefined,
        worker_id: workerFilter || undefined,
        is_from_returned: fromReturnedFilter ? 'true' : undefined,
        start: startDate || undefined,
        end: endDate || undefined,
        search: search || undefined,
        limit: limit === 'all' ? 10000 : limit,
        offset: limit === 'all' ? 0 : (page - 1) * limit,
      },
    }).then(r => r.data),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }) => api.put(`/orders/${id}/status`, { status }).then(r => r.data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['orderStats'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      toast.success('Order status updated!');
      if (res.stock_deduction) {
        toast.success(`📦 Deducted ${res.stock_deduction.deducted} finished goods from stock`);
      }
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Failed to update status.'),
  });

  const toggleLabelMutation = useMutation({
    mutationFn: ({ id, is_from_returned }) => api.put(`/orders/${id}/label`, { is_from_returned }).then(r => r.data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      toast.success(res.order?.is_from_returned ? "Labeled as 'From Returned'!" : "Removed 'From Returned' label.");
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Failed to update label.'),
  });

  const assignWorkerMutation = useMutation({
    mutationFn: ({ id, worker_id }) => api.put(`/orders/${id}/assign-worker`, { worker_id }).then(r => r.data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['production'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      if (res.production_entry) {
        toast.success(`Worker assigned & production entry logged!`);
      } else {
        toast.success('Worker assigned to order!');
      }
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Failed to assign worker.'),
  });

  const deleteOrderMutation = useMutation({
    mutationFn: (id) => api.delete(`/orders/${id}`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['orderStats'] });
      qc.invalidateQueries({ queryKey: ['production'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      toast.success('Order deleted!');
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Failed to delete order.'),
  });

  // ── Bulk mutation ──
  const bulkMutation = useMutation({
    mutationFn: (payload) => api.post('/orders/bulk', payload).then(r => r.data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['orderStats'] });
      qc.invalidateQueries({ queryKey: ['production'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      setSelectedIds(new Set());
      toast.success(`Done! ${res.updated} order${res.updated !== 1 ? 's' : ''} updated.`);
      if (res.errors?.length) toast.error(`${res.errors.length} order(s) had errors.`);
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Bulk action failed.'),
  });

  const handleBulkAction = (action, extra) => {
    bulkMutation.mutate({ ids: [...selectedIds], action, ...extra });
  };

  const openPackingSlip = (id) => {
    if (!hasFeature('packing_slip')) {
      setShowUpgrade(true);
    } else {
      window.open(`/api/orders/${id}/packing-slip`, '_blank');
    }
  };

  const orders = ordersData?.orders ?? ordersData ?? [];
  const totalOrders = ordersData?.total ?? orders.length;
  const stats = statsData ?? {};
  const workers = workersData?.workers ?? workersData ?? [];

  const totalPages = limit === 'all' ? 1 : Math.max(1, Math.ceil(totalOrders / limit));
  const startItem = totalOrders === 0 ? 0 : (limit === 'all' ? 1 : (page - 1) * limit + 1);
  const endItem = limit === 'all' ? totalOrders : Math.min(totalOrders, page * limit);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Orders</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage multi-platform orders and worker assignments</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (hasFeature('csv_import')) {
                  setImportModal(true);
                } else {
                  setShowUpgrade(true);
                }
              }}
              className="btn-secondary flex items-center gap-1"
            >
              ⬆ Import CSV
              {!hasFeature('csv_import') && <span className="text-[10px] bg-amber-100 text-amber-800 px-1 rounded">🔒</span>}
            </button>
            <button onClick={() => setAddModal(true)} className="btn-primary">+ Manual Order</button>
          </div>
        )}
      </div>

      <StatsRow stats={stats} />

      {/* Platform Filter Pills */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setPlatformFilter('')}
          className={`btn-sm rounded-full ${!platformFilter ? 'btn-primary' : 'btn-secondary'}`}>All Platforms</button>
        {PLATFORMS.map(p => (
          <button key={p} onClick={() => setPlatformFilter(p === platformFilter ? '' : p)}
            className={`btn-sm rounded-full capitalize ${platformFilter === p ? `badge platform-${p} border border-current` : 'btn-secondary'}`}>
            {PLATFORM_NAMES[p] || p}
          </button>
        ))}
      </div>

      {/* Status & Worker Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <select className="select w-40" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          {ORDER_STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
        </select>

        <button
          onClick={() => setFromReturnedFilter(!fromReturnedFilter)}
          className={`btn-sm rounded-xl font-medium text-xs border transition-all flex items-center gap-1.5 ${
            fromReturnedFilter
              ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
              : 'bg-white text-amber-800 border-amber-200 hover:bg-amber-50'
          }`}
          title="Filter orders fulfilled from returned parcels"
        >
          ♻️ From Returned {fromReturnedFilter ? '✓' : ''}
        </button>

        {isAdmin && (
          <select className="select w-44" value={workerFilter} onChange={e => setWorkerFilter(e.target.value)}>
            <option value="">All Workers</option>
            {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        )}

        <input className="input max-w-xs" placeholder="🔍 Search ID, SKU, product, worker…"
          value={search} onChange={e => setSearch(e.target.value)} />

        <div className="flex items-center gap-2">
          <input type="date" className="input w-36" value={startDate} onChange={e => setStartDate(e.target.value)} />
          <span className="text-slate-400 text-sm">to</span>
          <input type="date" className="input w-36" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
      </div>

      {/* Orders Table */}
      <div className="card">
        {isLoading ? <Spinner /> : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  {isAdmin && (
                    <th className="w-8">
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-violet-600 cursor-pointer"
                        checked={orders.length > 0 && orders.every(o => selectedIds.has(o.id))}
                        onChange={() => toggleSelectAll(orders)}
                        title="Select all"
                      />
                    </th>
                  )}
                  <th>Order ID</th>
                  <th>Platform</th>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Listing Price</th>
                  <th>Selling Price</th>
                  <th>Profit</th>
                  <th>Order Date</th>
                  <th>Fulfilled By</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 12 : 11} className="text-center text-slate-400 py-12">
                      <p className="text-3xl mb-2">📦</p>
                      No orders found.
                    </td>
                  </tr>
                ) : orders.map(o => (
                  <tr key={o.id} className={`${o.stock_flagged ? 'bg-rose-50/30' : ''} ${selectedIds.has(o.id) ? 'bg-violet-50/60' : ''}`}>
                    {isAdmin && (
                      <td className="w-8">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-violet-600 cursor-pointer"
                          checked={selectedIds.has(o.id)}
                          onChange={() => toggleSelect(o.id)}
                        />
                      </td>
                    )}
                    <td className="font-mono text-xs text-slate-600">
                      {o.stock_flagged && <span className="mr-1" title="Stock insufficient">⚠️</span>}
                      <span>{o.external_order_id || `#${o.id}`}</span>
                      {(o.is_from_returned || o.label === 'from the returned') && (
                        <span className="block mt-0.5 text-[10px] font-semibold text-amber-800 bg-amber-100 border border-amber-300 rounded px-1 py-0.2 max-w-fit" title="Fulfilled from returned parcel">
                          ♻️ From Returned
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`badge platform-${o.platform}`}>
                        {PLATFORM_NAMES[o.platform] || o.platform}
                      </span>
                    </td>
                    <td>
                      <p className="font-medium text-slate-800 max-w-[180px] truncate">{o.product_name || o.product_name_resolved}</p>
                      {o.sku && <p className="text-xs text-slate-400 font-mono">{o.sku}</p>}
                    </td>
                    <td className="font-semibold">{o.quantity}</td>
                    <td className="font-semibold text-slate-500">{o.listing_price !== null && o.listing_price !== undefined ? formatCurrency(o.listing_price) : '—'}</td>
                    <td className="font-semibold text-slate-700">{formatCurrency(o.unit_price)}</td>
                    <td className={`font-semibold ${o.product_id && o.profit > 0 ? 'text-emerald-600' : o.product_id && o.profit < 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                      {o.product_id && o.profit !== null && o.profit !== undefined ? (
                        formatCurrency(o.profit)
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5" title="Unmatched SKU — profit not calculated until product recipe is added in Products">
                          ⚠️ Unmatched SKU (No COGS)
                        </span>
                      )}
                    </td>
                    <td className="text-xs">{formatDate(o.order_date)}</td>
                    <td>
                      {isAdmin ? (
                        <select
                          className={`select py-1 px-2 text-xs w-36 font-medium ${
                            o.is_from_returned || o.label === 'from the returned'
                              ? 'bg-amber-50 text-amber-900 border-amber-300 font-semibold'
                              : ''
                          }`}
                          value={o.is_from_returned || o.label === 'from the returned' ? '__returned__' : (o.worker_id || '')}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '__returned__') {
                              assignWorkerMutation.mutate({ id: o.id, worker_id: null });
                              toggleLabelMutation.mutate({ id: o.id, is_from_returned: true });
                            } else {
                              if (o.is_from_returned || o.label === 'from the returned') {
                                toggleLabelMutation.mutate({ id: o.id, is_from_returned: false });
                              }
                              assignWorkerMutation.mutate({ id: o.id, worker_id: val ? Number(val) : null });
                            }
                          }}
                        >
                          <option value="">— Unassigned —</option>
                          <option value="__returned__">♻️ Returned Parcel</option>
                          {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                      ) : (
                        o.is_from_returned || o.label === 'from the returned' ? (
                          <span className="badge bg-amber-100 text-amber-800 border border-amber-300 font-medium">
                            ♻️ Returned Parcel
                          </span>
                        ) : (
                          <span className="badge bg-purple-50 text-purple-700 font-medium">
                            👷 {o.worker_name_resolved || o.worker_name || 'Unassigned'}
                          </span>
                        )
                      )}
                    </td>
                    <td>
                      <span className={`badge status-${o.status}`}>
                        {capitalize(o.status)}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        {isAdmin && (
                          <select
                            className="select py-1 px-2 text-xs w-28"
                            value={o.status}
                            onChange={(e) => statusMutation.mutate({ id: o.id, status: e.target.value })}
                          >
                            {ORDER_STATUSES.map(s => (
                              <option key={s} value={s}>{capitalize(s)}</option>
                            ))}
                          </select>
                        )}
                        <button
                          onClick={() => toggleLabelMutation.mutate({ id: o.id, is_from_returned: !o.is_from_returned })}
                          className={`btn-sm p-1.5 rounded transition-colors ${
                            o.is_from_returned || o.label === 'from the returned'
                              ? 'bg-amber-100 text-amber-800 border border-amber-300'
                              : 'btn-ghost text-slate-500 hover:text-amber-700 hover:bg-amber-50'
                          }`}
                          title={o.is_from_returned || o.label === 'from the returned' ? "Remove 'From Returned' label" : "Mark as 'From Returned'"}
                        >
                          ♻️
                        </button>
                        <button
                          onClick={() => openPackingSlip(o.id)}
                          className="btn-ghost btn-sm flex items-center gap-0.5"
                          title={hasFeature('packing_slip') ? "View Packing Slip" : "View Packing Slip (Upgrade Required)"}
                        >
                          🖨️
                          {!hasFeature('packing_slip') && <span className="text-[9px] bg-amber-100 text-amber-800 px-0.5 rounded">🔒</span>}
                        </button>
                        {isAdmin && (
                          <button onClick={() => {
                            if (window.confirm(`Delete order "${o.external_order_id || o.id}"?`)) {
                              deleteOrderMutation.mutate(o.id);
                            }
                          }} className="btn-danger btn-sm p-1.5" title="Delete Order">🗑️</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Table Footer / Results Per Page & Pagination controls */}
        <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/50 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600">
          {/* Results per page selector */}
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-500">Results per page:</span>
            <select
              className="select py-1 px-2 text-xs w-20 bg-white font-medium border-slate-200"
              value={limit}
              onChange={(e) => {
                const val = e.target.value === 'all' ? 'all' : Number(e.target.value);
                setLimit(val);
                setPage(1);
              }}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value="all">All</option>
            </select>
          </div>

          {/* Showing X to Y of Z orders */}
          <div className="font-medium text-slate-600">
            Showing <span className="font-semibold text-slate-900">{startItem}</span> to <span className="font-semibold text-slate-900">{endItem}</span> of <span className="font-semibold text-slate-900">{totalOrders}</span> orders
          </div>

          {/* Page navigation */}
          {limit !== 'all' && totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                disabled={page === 1}
                onClick={() => setPage(1)}
                className="px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-slate-700"
                title="First Page"
              >
                ««
              </button>
              <button
                disabled={page === 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-slate-700"
                title="Previous Page"
              >
                ‹ Prev
              </button>

              <span className="px-2 font-semibold text-slate-700">
                Page {page} of {totalPages}
              </span>

              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-slate-700"
                title="Next Page"
              >
                Next ›
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(totalPages)}
                className="px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-slate-700"
                title="Last Page"
              >
                »»
              </button>
            </div>
          )}
        </div>
      </div>

      {importModal && <ImportModal onClose={() => setImportModal(false)} />}
      {addModal && <ManualOrderModal workers={workers} onClose={() => setAddModal(false)} />}

      {isAdmin && (
        <BulkActionBar
          selectedIds={selectedIds}
          orders={orders}
          workers={workers}
          onClear={() => setSelectedIds(new Set())}
          onBulkAction={handleBulkAction}
          isPending={bulkMutation.isPending}
        />
      )}

      {showUpgrade && (
        <UpgradePrompt
          onClose={() => setShowUpgrade(false)}
          title="Packing Slip Feature Locked"
          message="PDF packing slips are only available on the Business plan. Upgrade your subscription to print custom packing slips for your orders."
        />
      )}
    </div>
  );
}
