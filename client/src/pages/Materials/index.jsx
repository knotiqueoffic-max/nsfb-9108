import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { format, parseISO } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import api from '../../api/index.js';
import { useAuthStore } from '../../store/auth';

const formatINR = (v) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(v ?? 0);

// ─── CSV Export Helper ────────────────────────────────────────────────────────
function exportToCsv(filename, rows, headers) {
  const escape = (val) => {
    const str = val == null ? '' : String(val);
    return str.includes(',') || str.includes('"') || str.includes('\n')
      ? `"${str.replace(/"/g, '""')}"`
      : str;
  };
  const csvContent = [
    headers.map(escape).join(','),
    ...rows.map(row => row.map(escape).join(',')),
  ].join('\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// ─── Profit Update Info Banner ─────────────────────────────────────────────────────
// Shown inside the Material modal when "update avg cost" is toggled on.
// Explains that dashboard profit auto-updates from the new avg_cost_per_unit,
// and lets the user pick a date to quickly jump to the Dashboard to verify.
function ProfitUpdateInfo({ materialName }) {
  const navigate = useNavigate();
  const [verifyDate, setVerifyDate] = useState(format(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'));

  const handleVerify = () => {
    const end = format(new Date(), 'yyyy-MM-dd');
    navigate(`/?start_date=${verifyDate}&end_date=${end}`);
  };

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 space-y-2.5">
      <div className="flex items-start gap-2">
        <span className="text-emerald-600 text-lg leading-none mt-0.5">📊</span>
        <div>
          <p className="text-sm font-semibold text-emerald-800">
            Dashboard profit will update automatically
          </p>
          <p className="text-xs text-emerald-700 mt-0.5 leading-relaxed">
            The new average cost for <strong>{materialName}</strong> will be used immediately
            in all profit calculations on the Dashboard. No extra action needed.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 pt-0.5">
        <label className="text-xs text-emerald-700 font-medium shrink-0">Verify from:</label>
        <input
          type="date"
          value={verifyDate}
          onChange={e => setVerifyDate(e.target.value)}
          className="input input-sm text-xs h-8 py-1 flex-1"
          max={format(new Date(), 'yyyy-MM-dd')}
        />
        <button
          type="button"
          onClick={handleVerify}
          className="btn-secondary btn-sm text-xs px-3 h-8 shrink-0"
        >
          Go to Dashboard →
        </button>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-7 h-7 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
    </div>
  );
}

// ─── Modal Wrapper ───────────────────────────────────────────────────────────
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
          <button onClick={onClose} className="btn-ghost btn-sm rounded-full w-8 h-8 p-0 flex items-center justify-center text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ─── Material Form Modal ─────────────────────────────────────────────────────
function MaterialModal({ material, categories, onClose }) {
  const qc = useQueryClient();
  const isEdit = !!material;
  const [updateAvgCost, setUpdateAvgCost] = useState(false);

  const { register, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: material ? {
      name: material.name, category: material.category, unit: material.unit,
      stock_quantity: material.stock_quantity, cost_per_unit: material.cost_per_unit,
      supplier: material.supplier, reorder_threshold: material.reorder_threshold,
    } : { stock_quantity: 0, cost_per_unit: 0, reorder_threshold: 0 },
  });

  const watchedCost = watch('cost_per_unit');
  const priceChanged = isEdit && Number(watchedCost) !== Number(material?.cost_per_unit);

  const mutation = useMutation({
    mutationFn: (data) => isEdit
      ? api.put(`/materials/${material.id}`, data).then(r => r.data)
      : api.post('/materials', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['materials'] });
      qc.invalidateQueries({ queryKey: ['materialCategories'] });
      toast.success(isEdit ? 'Material updated!' : 'Material added!');
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || e?.response?.data?.errors?.[0]?.msg || 'Failed to save material.'),
  });

  const onSubmit = (data) => {
    mutation.mutate({
      ...data,
      stock_quantity: Number(data.stock_quantity) || 0,
      cost_per_unit: Number(data.cost_per_unit) || 0,
      reorder_threshold: Number(data.reorder_threshold) || 0,
      ...(isEdit && priceChanged ? { update_avg_cost: updateAvgCost } : {}),
    });
  };

  return (
    <Modal title={isEdit ? 'Edit Material' : 'Add Material'} onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">Name *</label>
            <input className={`input ${errors.name ? 'border-rose-400' : ''}`} placeholder="e.g. Cotton Yarn 4mm"
              {...register('name', { required: 'Name is required' })} />
            {errors.name && <p className="text-rose-500 text-xs mt-1">{errors.name.message}</p>}
          </div>
          <div>
            <label className="label">Category *</label>
            <input className={`input ${errors.category ? 'border-rose-400' : ''}`} placeholder="e.g. Yarn"
              list="cat-list" {...register('category', { required: 'Category is required' })} />
            <datalist id="cat-list">{categories.map(c => <option key={c} value={c} />)}</datalist>
            {errors.category && <p className="text-rose-500 text-xs mt-1">{errors.category.message}</p>}
          </div>
          <div>
            <label className="label">Unit *</label>
            <input className={`input ${errors.unit ? 'border-rose-400' : ''}`} placeholder="e.g. grams, meters"
              {...register('unit', { required: 'Unit is required' })} />
            {errors.unit && <p className="text-rose-500 text-xs mt-1">{errors.unit.message}</p>}
          </div>
          <div>
            <label className="label">Stock Quantity</label>
            <input type="number" step="0.01" className="input"
              {...register('stock_quantity', { valueAsNumber: true, min: { value: 0, message: 'Must be ≥ 0' } })} />
          </div>
          <div>
            <label className="label">Cost / Unit (₹)</label>
            <input type="number" step="0.01" className="input"
              {...register('cost_per_unit', { valueAsNumber: true, min: { value: 0, message: 'Must be ≥ 0' } })} />
          </div>
          <div>
            <label className="label">Supplier</label>
            <input className="input" placeholder="Supplier name" {...register('supplier')} />
          </div>
          <div>
            <label className="label">Reorder Threshold</label>
            <input type="number" step="0.01" className="input"
              {...register('reorder_threshold', { valueAsNumber: true, min: 0 })} />
          </div>
        </div>

        {/* ── Propagate price toggle — only shown when editing and price has changed ── */}
        {isEdit && priceChanged && (
          <div className={`rounded-xl border p-3.5 transition-all ${updateAvgCost ? 'bg-violet-50 border-violet-200' : 'bg-amber-50 border-amber-200'}`}>
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <div className="relative mt-0.5 flex-shrink-0">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={updateAvgCost}
                  onChange={e => setUpdateAvgCost(e.target.checked)}
                />
                <div className={`w-10 h-5 rounded-full transition-colors ${updateAvgCost ? 'bg-violet-600' : 'bg-amber-300'}`} />
                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${updateAvgCost ? 'translate-x-5' : ''}`} />
              </div>
              <div>
                <p className={`text-sm font-semibold ${updateAvgCost ? 'text-violet-800' : 'text-amber-800'}`}>
                  {updateAvgCost ? '✅ Updating COGS calculations' : '⚠️ Also update product COGS calculations?'}
                </p>
                <p className={`text-xs mt-0.5 ${updateAvgCost ? 'text-violet-600' : 'text-amber-700'}`}>
                  {updateAvgCost
                    ? 'The new price will be used as the average cost for all products that include this material.'
                    : 'The new price will be stored but won\'t affect product cost/price suggestions until the next purchase.'}
                </p>
              </div>
            </label>
          </div>
        )}

        {/* ── Profit recalculation info — shown when avg cost will update ── */}
        {isEdit && priceChanged && updateAvgCost && (
          <ProfitUpdateInfo materialName={material?.name} />
        )}

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="submit" disabled={mutation.isPending} className="btn-primary flex-1">
            {mutation.isPending ? 'Saving…' : isEdit ? 'Update' : 'Add Material'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Adjust Stock Modal ───────────────────────────────────────────────────────

function AdjustModal({ material, onClose }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm({ defaultValues: { quantity_delta: 0, reason: '' } });
  const mutation = useMutation({
    mutationFn: (data) => api.post(`/materials/${material.id}/adjust`, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['materials'] });
      toast.success('Stock adjusted!');
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Failed to adjust stock.'),
  });
  return (
    <Modal title={`Adjust Stock — ${material.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-4">
        <div>
          <label className="label">Quantity Delta *</label>
          <input type="number" step="0.01" className={`input ${errors.quantity_delta ? 'border-rose-400' : ''}`}
            placeholder="Use negative to reduce stock"
            {...register('quantity_delta', { required: 'Required', valueAsNumber: true })} />
          <p className="text-xs text-slate-400 mt-1">Current stock: {material.stock_quantity} {material.unit}</p>
          {errors.quantity_delta && <p className="text-rose-500 text-xs mt-1">{errors.quantity_delta.message}</p>}
        </div>
        <div>
          <label className="label">Reason</label>
          <input className="input" placeholder="e.g. Manual correction, wastage" {...register('reason')} />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="submit" disabled={mutation.isPending} className="btn-primary flex-1">
            {mutation.isPending ? 'Saving…' : 'Adjust Stock'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Purchase Modal ───────────────────────────────────────────────────────────
function PurchaseModal({ materials, onClose }) {
  const qc = useQueryClient();
  const { register, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: { material_id: '', quantity: 1, cost_per_unit: 0, supplier: '', purchase_date: format(new Date(), 'yyyy-MM-dd'), notes: '' },
  });
  const qty = watch('quantity', 1);
  const cpu = watch('cost_per_unit', 0);
  const total = (Number(qty) || 0) * (Number(cpu) || 0);

  const mutation = useMutation({
    mutationFn: (data) => api.post('/purchases', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['materials'] });
      toast.success('Purchase recorded & stock updated!');
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Failed to record purchase.'),
  });

  return (
    <Modal title="Add Purchase" onClose={onClose}>
      <form onSubmit={handleSubmit(d => mutation.mutate({ ...d, quantity: Number(d.quantity), cost_per_unit: Number(d.cost_per_unit) }))} className="space-y-4">
        <div>
          <label className="label">Material *</label>
          <select className={`select ${errors.material_id ? 'border-rose-400' : ''}`}
            {...register('material_id', { required: 'Select a material' })}>
            <option value="">— Select material —</option>
            {materials.map(m => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
          </select>
          {errors.material_id && <p className="text-rose-500 text-xs mt-1">{errors.material_id.message}</p>}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Quantity *</label>
            <input type="number" step="0.01" className={`input ${errors.quantity ? 'border-rose-400' : ''}`}
              {...register('quantity', { required: true, min: { value: 0.01, message: 'Must be > 0' }, valueAsNumber: true })} />
          </div>
          <div>
            <label className="label">Cost / Unit (₹) *</label>
            <input type="number" step="0.01" className={`input ${errors.cost_per_unit ? 'border-rose-400' : ''}`}
              {...register('cost_per_unit', { required: true, min: 0, valueAsNumber: true })} />
          </div>
        </div>
        <div className="p-3 bg-violet-50 rounded-xl text-sm">
          <span className="text-slate-600">Calculated Total: </span>
          <span className="font-bold text-violet-700">{formatINR(total)}</span>
        </div>
        <div>
          <label className="label">Supplier</label>
          <input className="input" placeholder="Supplier name" {...register('supplier')} />
        </div>
        <div>
          <label className="label">Purchase Date *</label>
          <input type="date" className={`input ${errors.purchase_date ? 'border-rose-400' : ''}`}
            {...register('purchase_date', { required: 'Date is required' })} />
        </div>
        <div>
          <label className="label">Notes</label>
          <input className="input" placeholder="Optional notes" {...register('notes')} />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="submit" disabled={mutation.isPending} className="btn-primary flex-1">
            {mutation.isPending ? 'Saving…' : 'Add Purchase'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MaterialsPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const isAdmin = ['owner', 'admin', 'super_admin'].includes(user?.role);

  const [tab, setTab] = useState('inventory');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [matModal, setMatModal] = useState(null);   // null | 'add' | {material}
  const [adjModal, setAdjModal] = useState(null);   // null | {material}
  const [purchaseModal, setPurchaseModal] = useState(false);

  const { data: categories = [] } = useQuery({
    queryKey: ['materialCategories'],
    queryFn: () => api.get('/materials/categories').then(r => r.data),
  });

  const { data: materialsData, isLoading: matLoading } = useQuery({
    queryKey: ['materials', search, category, lowStock],
    queryFn: () => api.get('/materials', {
      params: { search: search || undefined, category: category || undefined, low_stock: lowStock || undefined },
    }).then(r => r.data),
  });

  const { data: purchasesData, isLoading: purLoading } = useQuery({
    queryKey: ['purchases'],
    queryFn: () => api.get('/purchases').then(r => r.data),
    enabled: tab === 'purchases',
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/materials/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['materials'] }); toast.success('Material deleted.'); },
    onError: (e) => toast.error(e?.response?.data?.error || 'Delete failed.'),
  });

  const deletePurchaseMutation = useMutation({
    mutationFn: (id) => api.delete(`/purchases/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['materials'] });
      toast.success('Purchase entry deleted & stock reverted!');
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Delete failed.'),
  });

  const materials = materialsData?.materials ?? materialsData ?? [];
  const purchases = purchasesData?.purchases ?? purchasesData ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Materials</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage raw material inventory and purchases</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit">
        {['inventory', 'purchases'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${tab === t ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
            {t === 'inventory' ? '📦 Inventory' : '🧾 Purchase Log'}
          </button>
        ))}
      </div>

      {/* ── Inventory Tab ── */}
      {tab === 'inventory' && (
        <div className="card">
          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-5">
            <input className="input max-w-xs" placeholder="🔍 Search materials…"
              value={search} onChange={e => setSearch(e.target.value)} />
            <select className="select w-44" value={category} onChange={e => setCategory(e.target.value)}>
              <option value="">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={() => setLowStock(x => !x)}
              className={`btn-sm rounded-xl ${lowStock ? 'btn-danger' : 'btn-secondary'}`}>
              {lowStock ? '⚠️ Low Stock Only' : '⚠️ Show Low Stock'}
            </button>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => {
                  exportToCsv(
                    `materials_inventory_${new Date().toISOString().slice(0, 10)}.csv`,
                    materials.map(m => [
                      m.name,
                      m.category || '',
                      m.unit,
                      m.stock_quantity,
                      m.cost_per_unit,
                      m.avg_cost_per_unit ?? '',
                      m.supplier || '',
                      m.reorder_threshold,
                      m.stock_quantity <= m.reorder_threshold ? 'Low Stock' : 'OK',
                    ]),
                    ['Name', 'Category', 'Unit', 'Stock Quantity', 'Cost/Unit (₹)', 'Avg Cost/Unit (₹)', 'Supplier', 'Reorder Threshold', 'Status'],
                  );
                }}
                className="btn-secondary btn-sm"
                title="Export current list as CSV"
              >
                ⬇️ Export CSV
              </button>
              {isAdmin ? (
                <button onClick={() => setMatModal('add')} className="btn-primary btn-sm">+ Add Material</button>
              ) : (
                <button disabled title="Admin/Owner access required to add materials" className="btn-primary btn-sm opacity-50 cursor-not-allowed">
                  🔒 + Add Material
                </button>
              )}
            </div>
          </div>

          {matLoading ? <Spinner /> : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Name</th><th>Category</th><th>Unit</th><th>Stock</th>
                    <th>Avg Cost/Unit</th><th>Supplier</th><th>Threshold</th><th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {materials.length === 0 ? (
                    <tr><td colSpan={9} className="text-center text-slate-400 py-10">No materials found.</td></tr>
                  ) : materials.map(m => {
                    const isLow = m.stock_quantity <= m.reorder_threshold;
                    return (
                      <tr key={m.id}>
                        <td className="font-medium">{m.name}</td>
                        <td><span className="badge bg-slate-100 text-slate-600">{m.category}</span></td>
                        <td>{m.unit}</td>
                        <td className={isLow ? 'text-rose-600 font-semibold' : ''}>{m.stock_quantity}</td>
                        <td>{formatINR(m.cost_per_unit)}</td>
                        <td className="text-slate-500">{m.supplier || '—'}</td>
                        <td>{m.reorder_threshold}</td>
                        <td>
                          {isLow
                            ? <span className="badge bg-rose-50 text-rose-600">Low Stock</span>
                            : <span className="badge bg-emerald-50 text-emerald-600">OK</span>}
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            <button onClick={() => setMatModal(m)} className="btn-ghost btn-sm">✏️</button>
                            <button onClick={() => setAdjModal(m)} className="btn-ghost btn-sm">📊</button>
                            {isAdmin && (
                              <button onClick={() => {
                                if (window.confirm(`Delete "${m.name}"?`)) deleteMutation.mutate(m.id);
                              }} className="btn-danger btn-sm">🗑️</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Purchase Log Tab ── */}
      {tab === 'purchases' && (
        <div className="card">
          <div className="flex justify-between items-center mb-5">
            <p className="text-sm text-slate-500">{purchases.length} purchase record(s)</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  exportToCsv(
                    `materials_purchases_${new Date().toISOString().slice(0, 10)}.csv`,
                    purchases.map(p => [
                      p.purchase_date ? format(parseISO(p.purchase_date), 'dd MMM yyyy') : '',
                      p.material_name || '',
                      p.quantity,
                      p.unit || '',
                      p.cost_per_unit,
                      (p.quantity * p.cost_per_unit).toFixed(2),
                      p.supplier || '',
                      p.notes || '',
                    ]),
                    ['Date', 'Material', 'Quantity', 'Unit', 'Cost/Unit (₹)', 'Total (₹)', 'Supplier', 'Notes'],
                  );
                }}
                className="btn-secondary btn-sm"
                title="Export purchase log as CSV"
              >
                ⬇️ Export CSV
              </button>
              <button onClick={() => setPurchaseModal(true)} className="btn-primary btn-sm">+ Add Purchase</button>
            </div>
          </div>
          {purLoading ? <Spinner /> : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr><th>Date</th><th>Material</th><th>Qty</th><th>Cost/Unit</th><th>Total</th><th>Supplier</th><th>Notes</th>{isAdmin && <th>Action</th>}</tr>
                </thead>
                <tbody>
                  {purchases.length === 0 ? (
                    <tr><td colSpan={8} className="text-center text-slate-400 py-10">No purchase records yet.</td></tr>
                  ) : purchases.map(p => (
                    <tr key={p.id}>
                      <td>{p.purchase_date ? format(parseISO(p.purchase_date), 'dd MMM yyyy') : '—'}</td>
                      <td className="font-medium">{p.material_name}</td>
                      <td>{p.quantity} {p.unit}</td>
                      <td>{formatINR(p.cost_per_unit)}</td>
                      <td className="font-semibold text-emerald-700">{formatINR(p.quantity * p.cost_per_unit)}</td>
                      <td className="text-slate-500">{p.supplier || '—'}</td>
                      <td className="text-slate-400">{p.notes || '—'}</td>
                      {isAdmin && (
                        <td>
                          <button
                            onClick={() => {
                              if (window.confirm(`Delete purchase record for "${p.material_name}"?`)) {
                                deletePurchaseMutation.mutate(p.id);
                              }
                            }}
                            className="btn-danger btn-sm p-1.5"
                            title="Delete purchase entry"
                          >
                            🗑️
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {matModal && (
        <MaterialModal
          material={matModal === 'add' ? null : matModal}
          categories={categories}
          onClose={() => setMatModal(null)}
        />
      )}
      {adjModal && <AdjustModal material={adjModal} onClose={() => setAdjModal(null)} />}
      {purchaseModal && <PurchaseModal materials={materials} onClose={() => setPurchaseModal(false)} />}
    </div>
  );
}
