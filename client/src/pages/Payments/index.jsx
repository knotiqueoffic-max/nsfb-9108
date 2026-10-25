import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../api/index.js';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from 'recharts';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (v) =>
  '₹' + Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const today = () => new Date().toISOString().split('T')[0];
const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

const PLATFORMS = ['flipkart', 'meesho', 'myntra', 'etsy', 'amazon', 'manual'];
const PLATFORM_LABELS = {
  flipkart: 'Flipkart', meesho: 'Meesho', myntra: 'Myntra',
  etsy: 'Etsy', amazon: 'Amazon', manual: 'Manual',
};
const PLATFORM_COLORS = {
  flipkart: '#2874f0', meesho: 'rgb(250,72,131)', myntra: '#ff3f6c',
  etsy: '#f56400', amazon: '#ff9900', manual: '#64748b',
};

const EXPENSE_CATEGORIES = [
  { id: 'office', label: 'Office & Utilities' },
  { id: 'shipping', label: 'Shipping & Packaging' },
  { id: 'equipment', label: 'Equipment & Tools' },
  { id: 'travel', label: 'Travel & Transport' },
  { id: 'salaries', label: 'Salaries & Wages' },
  { id: 'marketing', label: 'Marketing & Ads' },
  { id: 'other', label: 'Miscellaneous' },
];
const PAYMENT_METHODS = ['cash', 'upi', 'bank_transfer', 'card', 'cheque'];

function Spinner({ size = 'md' }) {
  const s = size === 'sm' ? 'w-4 h-4 border-2' : 'w-7 h-7 border-4';
  return (
    <div className="flex items-center justify-center py-8">
      <div className={`${s} border-violet-200 border-t-violet-600 rounded-full animate-spin`} />
    </div>
  );
}

function Badge({ status }) {
  const cls = status === 'received' || status === 'paid'
    ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
    : 'bg-amber-100 text-amber-700 border border-amber-200';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'received' || status === 'paid' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {status === 'received' ? 'Received' : status === 'paid' ? 'Paid' : 'Pending'}
    </span>
  );
}

function SummaryCard({ label, value, sub, color = 'violet', icon }) {
  const colors = {
    violet: 'from-violet-600 to-purple-700',
    emerald: 'from-emerald-500 to-teal-600',
    amber: 'from-amber-500 to-orange-600',
    rose: 'from-rose-500 to-pink-600',
    blue: 'from-blue-500 to-indigo-600',
    slate: 'from-slate-500 to-slate-700',
  };
  return (
    <div className={`bg-gradient-to-br ${colors[color]} rounded-2xl p-5 text-white shadow-lg`}>
      <div className="flex items-start justify-between mb-3">
        <p className="text-white/80 text-xs font-medium uppercase tracking-wider">{label}</p>
        {icon && <span className="text-xl">{icon}</span>}
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-white/70 text-xs mt-1">{sub}</p>}
    </div>
  );
}

function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800 text-base">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-500 text-sm">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1 — PLATFORM SETTLEMENTS
// ─────────────────────────────────────────────────────────────────────────────
function PlatformSettlementsTab() {
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [payments, setPayments] = useState([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [showOrders, setShowOrders] = useState(false);

  const [filterPlatform, setFilterPlatform] = useState('');
  const [filterStart, setFilterStart] = useState(monthStart());
  const [filterEnd, setFilterEnd] = useState(today());

  const [addModal, setAddModal] = useState(false);
  const [editModal, setEditModal] = useState(null);
  const [form, setForm] = useState({
    platform: 'flipkart',
    amount: '',
    settlement_date: today(),
    reference_no: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const p = new URLSearchParams();
      if (filterStart) p.set('start', filterStart);
      if (filterEnd)   p.set('end', filterEnd);
      const { data } = await api.get(`/payments/settlements/summary?${p}`);
      setSummary(data);
    } catch { /* ignore */ } finally { setSummaryLoading(false); }
  }, [filterStart, filterEnd]);

  const fetchPayments = useCallback(async () => {
    setPaymentsLoading(true);
    try {
      const p = new URLSearchParams();
      if (filterPlatform) p.set('platform', filterPlatform);
      if (filterStart)    p.set('start', filterStart);
      if (filterEnd)      p.set('end', filterEnd);
      p.set('limit', '200');
      const { data } = await api.get(`/payments/settlement-payments?${p}`);
      setPayments(data.payments || []);
    } catch { /* ignore */ } finally { setPaymentsLoading(false); }
  }, [filterPlatform, filterStart, filterEnd]);

  const fetchOrders = useCallback(async () => {
    if (!showOrders) return;
    setOrdersLoading(true);
    try {
      const p = new URLSearchParams();
      if (filterPlatform) p.set('platform', filterPlatform);
      if (filterStart)    p.set('start', filterStart);
      if (filterEnd)      p.set('end', filterEnd);
      p.set('limit', '200');
      const { data } = await api.get(`/payments/settlements?${p}`);
      setOrders(data.settlements || []);
    } catch { /* ignore */ } finally { setOrdersLoading(false); }
  }, [showOrders, filterPlatform, filterStart, filterEnd]);

  useEffect(() => { fetchSummary(); fetchPayments(); }, [fetchSummary, fetchPayments]);
  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const openAdd = () => {
    setForm({ platform: filterPlatform || 'flipkart', amount: '', settlement_date: today(), reference_no: '', notes: '' });
    setAddModal(true);
  };
  const openEdit = (p) => {
    setForm({ platform: p.platform, amount: String(p.amount), settlement_date: p.settlement_date, reference_no: p.reference_no || '', notes: p.notes || '' });
    setEditModal(p);
  };

  const handleSave = async () => {
    if (!form.amount || !form.settlement_date) return;
    setSaving(true);
    try {
      if (editModal) {
        await api.put(`/payments/settlement-payments/${editModal.id}`, form);
      } else {
        await api.post('/payments/settlement-payments', form);
      }
      setAddModal(false); setEditModal(null);
      fetchSummary(); fetchPayments();
    } catch (e) {
      alert(e?.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this settlement entry?')) return;
    setDeleting(id);
    try {
      await api.delete(`/payments/settlement-payments/${id}`);
      fetchSummary(); fetchPayments();
    } catch { /* ignore */ } finally { setDeleting(null); }
  };

  const totalPaid = payments.reduce((s, p) => s + parseFloat(p.amount || 0), 0);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          label="Total Expected"
          value={summaryLoading ? '…' : fmt(summary?.total_expected)}
          sub="Selling Price × qty (per Orders page)"
          color="blue" icon="📊"
        />
        <SummaryCard
          label="Total Received"
          value={summaryLoading ? '…' : fmt(summary?.total_received)}
          sub="Sum of all settlement payments logged"
          color="emerald" icon="✅"
        />
        <SummaryCard
          label="Net Pending"
          value={summaryLoading ? '…' : fmt(summary?.total_pending)}
          sub="Expected − Received"
          color="amber" icon="⏳"
        />
      </div>

      {/* Platform Breakdown */}
      {summary && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">By Platform</h3>
          <div className="flex flex-wrap gap-3">
            {PLATFORMS.filter(p => (summary.by_platform?.[p]?.expected || 0) > 0 || (summary.by_platform?.[p]?.received || 0) > 0).map(p => (
              <div key={p} className="text-center p-3 rounded-xl bg-slate-50 border border-slate-100 min-w-28">
                <div className="text-xs font-medium text-slate-500 mb-1">{PLATFORM_LABELS[p]}</div>
                <div className="text-sm font-bold text-slate-800">{fmt(summary.by_platform?.[p]?.expected)}</div>
                <div className="text-xs text-emerald-600">{fmt(summary.by_platform?.[p]?.received)} recv'd</div>
                <div className={`text-xs font-medium ${(summary.by_platform?.[p]?.pending || 0) > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {(summary.by_platform?.[p]?.pending || 0) > 0 ? `${fmt(summary.by_platform?.[p]?.pending)} pending` : '✓ Settled'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters + Add button */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Platform</label>
            <select value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)} className="input-field text-sm py-1.5 pr-8">
              <option value="">All</option>
              {PLATFORMS.map(p => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">From</label>
            <input type="date" value={filterStart} onChange={e => setFilterStart(e.target.value)} className="input-field text-sm py-1.5" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">To</label>
            <input type="date" value={filterEnd} onChange={e => setFilterEnd(e.target.value)} className="input-field text-sm py-1.5" />
          </div>
          <button onClick={openAdd} className="btn-primary text-sm py-2 px-5 ml-auto flex items-center gap-2">
            <span className="text-base">＋</span> Log Settlement Received
          </button>
        </div>
      </div>

      {/* Settlement Payments Log */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <div>
            <h3 className="font-semibold text-slate-800 text-sm">Settlement Payments Received</h3>
            <p className="text-xs text-slate-400 mt-0.5">Each row = one bank transfer / lump-sum payment from a platform</p>
          </div>
          {payments.length > 0 && (
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
              {payments.length} entries · {fmt(totalPaid)} total
            </span>
          )}
        </div>

        {paymentsLoading ? <Spinner /> : payments.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-3 text-slate-400">
            <span className="text-4xl">💰</span>
            <p className="text-sm font-medium">No settlement payments logged yet</p>
            <p className="text-xs max-w-xs text-center">When Flipkart sends you a payment, click "Log Settlement Received" above and enter the amount</p>
            <button onClick={openAdd} className="btn-primary text-sm py-2 px-5 mt-1">Log First Settlement</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-5 py-3 text-left text-slate-600 font-medium">Platform</th>
                  <th className="px-5 py-3 text-right text-slate-600 font-medium">Amount Received</th>
                  <th className="px-5 py-3 text-left text-slate-600 font-medium">Date</th>
                  <th className="px-5 py-3 text-left text-slate-600 font-medium">Reference / UTR</th>
                  <th className="px-5 py-3 text-left text-slate-600 font-medium">Notes</th>
                  <th className="px-5 py-3 text-center text-slate-600 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
                        style={{ background: (PLATFORM_COLORS[p.platform] || '#64748b') + '20', color: PLATFORM_COLORS[p.platform] || '#64748b' }}>
                        {PLATFORM_LABELS[p.platform] || p.platform}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="text-lg font-bold text-emerald-700">{fmt(p.amount)}</span>
                    </td>
                    <td className="px-5 py-3 text-slate-700 font-medium">{p.settlement_date}</td>
                    <td className="px-5 py-3 text-slate-500 font-mono text-xs">{p.reference_no || '—'}</td>
                    <td className="px-5 py-3 text-slate-500 text-xs max-w-48">
                      <span className="truncate block">{p.notes || '—'}</span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => openEdit(p)}
                          className="text-xs bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 px-3 py-1 rounded-lg transition-colors">
                          Edit
                        </button>
                        <button onClick={() => handleDelete(p.id)} disabled={deleting === p.id}
                          className="text-xs text-rose-500 hover:text-rose-700 px-1 disabled:opacity-40">
                          {deleting === p.id ? '…' : '🗑'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-emerald-50 border-t-2 border-emerald-200">
                <tr>
                  <td className="px-5 py-3 text-sm font-semibold text-emerald-800">Total</td>
                  <td className="px-5 py-3 text-right text-xl font-bold text-emerald-700">{fmt(totalPaid)}</td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Orders Reference (collapsible) */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <button
          onClick={() => setShowOrders(v => !v)}
          className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors"
        >
          <div className="text-left">
            <h3 className="font-semibold text-slate-800 text-sm">Orders Reference</h3>
            <p className="text-xs text-slate-400 mt-0.5">See individual orders to cross-check what's outstanding</p>
          </div>
          <span className="text-slate-400 text-sm">{showOrders ? '▲ Hide' : '▼ Show'}</span>
        </button>
        {showOrders && (
          <div className="border-t border-slate-100">
            {ordersLoading ? <Spinner /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-slate-600 font-medium">Order ID</th>
                      <th className="px-4 py-3 text-left text-slate-600 font-medium">Platform</th>
                      <th className="px-4 py-3 text-left text-slate-600 font-medium">Product</th>
                      <th className="px-4 py-3 text-right text-slate-600 font-medium">Qty</th>
                      <th className="px-4 py-3 text-right text-slate-600 font-medium">Selling Price</th>
                      <th className="px-4 py-3 text-right text-slate-600 font-medium">Expected</th>
                      <th className="px-4 py-3 text-left text-slate-600 font-medium">Order Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {orders.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-8 text-slate-400">No orders in this range</td></tr>
                    ) : orders.map(o => (
                      <tr key={o.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{o.external_order_id || `#${o.id}`}</td>
                        <td className="px-4 py-2.5">
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                            style={{ background: (PLATFORM_COLORS[o.platform] || '#64748b') + '18', color: PLATFORM_COLORS[o.platform] || '#64748b' }}>
                            {PLATFORM_LABELS[o.platform] || o.platform}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 max-w-40">
                          <p className="truncate text-slate-700 text-xs">{o.product_name_resolved || o.product_name || '—'}</p>
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-600">{o.quantity}</td>
                        <td className="px-4 py-2.5 text-right text-slate-700">{fmt(o.unit_price)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{fmt(o.expected_amount)}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">{o.order_date}</td>
                      </tr>
                    ))}
                  </tbody>
                  {orders.length > 0 && (
                    <tfoot className="bg-slate-50 border-t border-slate-200">
                      <tr>
                        <td colSpan={5} className="px-4 py-2.5 text-xs font-semibold text-slate-600">Total Expected from Orders</td>
                        <td className="px-4 py-2.5 text-right font-bold text-slate-800">
                          {fmt(orders.reduce((s, o) => s + parseFloat(o.expected_amount || 0), 0))}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add / Edit Modal */}
      {(addModal || editModal) && (
        <Modal
          title={editModal ? 'Edit Settlement Entry' : 'Log Settlement Payment Received'}
          onClose={() => { setAddModal(false); setEditModal(null); }}
          wide
        >
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700">
              <strong>How this works:</strong> Enter the actual amount Flipkart (or another platform) transferred to your bank account, along with the date. You don't need to match it to individual orders — just log what came in.
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Platform *</label>
                <select value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))} className="input-field w-full">
                  {PLATFORMS.map(p => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}
                  <option value="manual">Manual / Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Date Received *</label>
                <input type="date" value={form.settlement_date}
                  onChange={e => setForm(f => ({ ...f, settlement_date: e.target.value }))}
                  className="input-field w-full" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Amount Received (₹) *</label>
              <input type="number" step="0.01" value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                className="input-field w-full text-lg font-semibold"
                placeholder="e.g. 8500.00" autoFocus />
              <p className="text-xs text-slate-400 mt-1">Enter the exact amount that hit your bank account</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Reference No / UTR (optional)</label>
              <input type="text" value={form.reference_no}
                onChange={e => setForm(f => ({ ...f, reference_no: e.target.value }))}
                className="input-field w-full font-mono"
                placeholder="e.g. Flipkart Settlement ID, bank UTR, NEFT ref…" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Notes (optional)</label>
              <textarea value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2} className="input-field w-full resize-none"
                placeholder="e.g. Week of Aug 1-7, includes returns deducted, Flipkart commission ₹200 cut…" />
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={handleSave} disabled={saving || !form.amount || !form.settlement_date}
                className="btn-primary flex-1 disabled:opacity-50">
                {saving ? 'Saving…' : editModal ? 'Save Changes' : '✅ Log Settlement'}
              </button>
              <button onClick={() => { setAddModal(false); setEditModal(null); }} className="btn-ghost flex-1">
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2 — WORKER PAYOUTS
// ─────────────────────────────────────────────────────────────────────────────
function WorkerPayoutsTab() {
  const [summary, setSummary] = useState(null);
  const [payouts, setPayouts] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterStart, setFilterStart] = useState(monthStart());
  const [filterEnd, setFilterEnd] = useState(today());
  const [page, setPage] = useState(0);
  const LIMIT = 50;
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(new Set());

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const p1 = new URLSearchParams();
      if (filterStart) p1.set('start', filterStart);
      if (filterEnd)   p1.set('end', filterEnd);

      const p2 = new URLSearchParams(p1);
      if (filterStatus) p2.set('status', filterStatus);
      p2.set('limit', LIMIT); p2.set('offset', page * LIMIT);

      const [s, r] = await Promise.all([
        api.get(`/payments/payouts/summary?${p1}`),
        api.get(`/payments/payouts?${p2}`),
      ]);
      setSummary(s.data);
      setPayouts(r.data.payouts || []);
      setTotal(r.data.total || 0);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [filterStatus, filterStart, filterEnd, page]);

  useEffect(() => { fetchAll(); setSelected(new Set()); }, [fetchAll]);

  const markPaid = async (id) => {
    setSaving(true);
    try {
      await api.put(`/payouts/${id}/mark-paid`, { status: 'paid' });
      fetchAll();
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const bulkMarkPaid = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      await api.post('/payouts/bulk-update-status', { ids: [...selected], status: 'paid' });
      setSelected(new Set());
      fetchAll();
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const toggleSelect = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => { if (selected.size === payouts.length) setSelected(new Set()); else setSelected(new Set(payouts.map(p => p.id))); };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard label="Total Earned" value={fmt(summary?.total_earned)} sub="All payouts in period" color="violet" icon="💼" />
        <SummaryCard label="Total Paid" value={fmt(summary?.total_paid)} sub="Marked as paid" color="emerald" icon="✅" />
        <SummaryCard label="Pending Payouts" value={fmt(summary?.total_pending)} sub="Not yet paid out" color="amber" icon="⏳" />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Status</label>
            <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(0); }} className="input-field text-sm py-1.5 pr-8">
              <option value="">All</option>
              <option value="ordered">Ordered</option>
              <option value="paid">Paid</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Period From</label>
            <input type="date" value={filterStart} onChange={e => { setFilterStart(e.target.value); setPage(0); }} className="input-field text-sm py-1.5" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Period To</label>
            <input type="date" value={filterEnd} onChange={e => { setFilterEnd(e.target.value); setPage(0); }} className="input-field text-sm py-1.5" />
          </div>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 flex items-center gap-3">
          <span className="text-violet-700 font-medium text-sm">{selected.size} selected</span>
          <button onClick={bulkMarkPaid} disabled={saving} className="btn-primary text-sm py-1.5 px-4 disabled:opacity-50">
            {saving ? 'Saving…' : '✅ Mark All Paid'}
          </button>
          <button onClick={() => setSelected(new Set())} className="btn-ghost text-sm py-1.5 px-3">Cancel</button>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? <Spinner /> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left w-10">
                      <input type="checkbox" checked={selected.size === payouts.length && payouts.length > 0} onChange={toggleAll} className="rounded" />
                    </th>
                    <th className="px-4 py-3 text-left text-slate-600 font-medium">Worker</th>
                    <th className="px-4 py-3 text-left text-slate-600 font-medium">Period</th>
                    <th className="px-4 py-3 text-right text-slate-600 font-medium">Pieces</th>
                    <th className="px-4 py-3 text-right text-slate-600 font-medium">Amount</th>
                    <th className="px-4 py-3 text-center text-slate-600 font-medium">Status</th>
                    <th className="px-4 py-3 text-left text-slate-600 font-medium">Paid At</th>
                    <th className="px-4 py-3 text-center text-slate-600 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payouts.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-12 text-slate-400">No payouts found for this period</td></tr>
                  ) : payouts.map(p => (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} className="rounded" />
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{p.worker_name}</p>
                        <p className="text-xs text-slate-400 capitalize">{p.wage_mode?.replace('_', ' ')}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{p.period_start} → {p.period_end}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{p.pieces || 0}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmt(p.amount)}</td>
                      <td className="px-4 py-3 text-center"><Badge status={p.status === 'paid' ? 'paid' : 'pending'} /></td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {p.paid_at ? new Date(p.paid_at).toLocaleDateString('en-IN') : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {p.status !== 'paid' && (
                          <button onClick={() => markPaid(p.id)} disabled={saving}
                            className="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-1 rounded-lg transition-colors disabled:opacity-50">
                            Mark Paid
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {total > LIMIT && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
                <span className="text-xs text-slate-500">Showing {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total}</span>
                <div className="flex gap-2">
                  <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="btn-ghost text-xs py-1 px-3 disabled:opacity-40">← Prev</button>
                  <button disabled={(page + 1) * LIMIT >= total} onClick={() => setPage(p => p + 1)} className="btn-ghost text-xs py-1 px-3 disabled:opacity-40">Next →</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3 — MATERIAL & OTHER EXPENSES
// ─────────────────────────────────────────────────────────────────────────────
function MaterialExpensesTab() {
  const [subTab, setSubTab] = useState('materials');
  const [matSummary, setMatSummary] = useState(null);
  const [expSummary, setExpSummary] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filterStart, setFilterStart] = useState(monthStart());
  const [filterEnd, setFilterEnd] = useState(today());
  const [filterStatus, setFilterStatus] = useState('');
  const [expModal, setExpModal] = useState(false);
  const [expForm, setExpForm] = useState({
    amount: '', category: 'other', expense_date: today(),
    payment_method: 'cash', vendor: '', notes: '', payment_status: 'paid',
  });
  const [deleting, setDeleting] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filterStart) p.set('start', filterStart);
      if (filterEnd)   p.set('end', filterEnd);
      if (filterStatus) p.set('payment_status', filterStatus);
      const ps = new URLSearchParams();
      if (filterStart) ps.set('start', filterStart);
      if (filterEnd)   ps.set('end', filterEnd);

      const [ms, es, mr, er] = await Promise.all([
        api.get(`/payments/material-expenses/summary?${ps}`),
        api.get(`/payments/other-expenses/summary?${ps}`),
        api.get(`/payments/material-expenses?${p}&limit=100`),
        api.get(`/payments/other-expenses?${p}&limit=100`),
      ]);
      setMatSummary(ms.data);
      setExpSummary(es.data);
      setMaterials(mr.data.purchases || []);
      setExpenses(er.data.expenses || []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [filterStart, filterEnd, filterStatus]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const toggleMatPayment = async (purchase) => {
    const action = purchase.payment_status === 'paid' ? 'mark-pending' : 'mark-paid';
    try {
      await api.put(`/payments/material-expenses/${purchase.id}/${action}`, {
        payment_date: today(),
      });
      fetchAll();
    } catch { /* ignore */ }
  };

  const toggleExpPayment = async (expense) => {
    const newStatus = expense.payment_status === 'paid' ? 'pending' : 'paid';
    try {
      await api.patch(`/payments/other-expenses/${expense.id}`, { payment_status: newStatus });
      fetchAll();
    } catch { /* ignore */ }
  };

  const saveExpense = async () => {
    if (!expForm.amount || !expForm.expense_date) return;
    setSaving(true);
    try {
      await api.post('/payments/other-expenses', expForm);
      setExpModal(false);
      setExpForm({ amount: '', category: 'other', expense_date: today(), payment_method: 'cash', vendor: '', notes: '', payment_status: 'paid' });
      fetchAll();
    } catch (e) { alert(e?.response?.data?.error || 'Failed to save'); } finally { setSaving(false); }
  };

  const deleteExpense = async (id) => {
    if (!confirm('Delete this expense?')) return;
    try {
      await api.delete(`/payments/other-expenses/${id}`);
      fetchAll();
    } catch { /* ignore */ }
  };

  const totalMaterials = (matSummary?.total_paid || 0) + (matSummary?.total_pending || 0);
  const totalOther = (expSummary?.total_paid || 0) + (expSummary?.total_pending || 0);
  const totalPending = (matSummary?.total_pending || 0) + (expSummary?.total_pending || 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard label="Total Material Spend" value={fmt(totalMaterials)} sub={`${fmt(matSummary?.total_pending)} pending`} color="blue" icon="🧶" />
        <SummaryCard label="Total Other Expenses" value={fmt(totalOther)} sub={`${fmt(expSummary?.total_pending)} pending`} color="violet" icon="📋" />
        <SummaryCard label="Total Pending to Suppliers" value={fmt(totalPending)} sub="Unpaid bills" color="amber" icon="⏳" />
      </div>

      {/* Sub-tab filter bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex rounded-xl overflow-hidden border border-slate-200">
            {['materials', 'other'].map(t => (
              <button key={t} onClick={() => setSubTab(t)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${subTab === t ? 'bg-violet-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                {t === 'materials' ? '🧶 Material Purchases' : '📋 Other Expenses'}
              </button>
            ))}
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Status</label>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="input-field text-sm py-1.5 pr-8">
              <option value="">All</option>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">From</label>
            <input type="date" value={filterStart} onChange={e => setFilterStart(e.target.value)} className="input-field text-sm py-1.5" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">To</label>
            <input type="date" value={filterEnd} onChange={e => setFilterEnd(e.target.value)} className="input-field text-sm py-1.5" />
          </div>
          {subTab === 'other' && (
            <button onClick={() => setExpModal(true)} className="btn-primary text-sm py-1.5 px-4 ml-auto">
              + Add Expense
            </button>
          )}
        </div>
      </div>

      {loading ? <Spinner /> : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          {subTab === 'materials' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-slate-600 font-medium">Material</th>
                    <th className="px-4 py-3 text-left text-slate-600 font-medium">Supplier</th>
                    <th className="px-4 py-3 text-right text-slate-600 font-medium">Qty</th>
                    <th className="px-4 py-3 text-right text-slate-600 font-medium">Total Cost</th>
                    <th className="px-4 py-3 text-left text-slate-600 font-medium">Purchase Date</th>
                    <th className="px-4 py-3 text-center text-slate-600 font-medium">Payment</th>
                    <th className="px-4 py-3 text-left text-slate-600 font-medium">Paid Date</th>
                    <th className="px-4 py-3 text-center text-slate-600 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {materials.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-12 text-slate-400">No purchases found</td></tr>
                  ) : materials.map(m => (
                    <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{m.material_name}</p>
                        <p className="text-xs text-slate-400">{m.unit}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{m.supplier || '—'}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{m.quantity}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmt(m.total_cost)}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">{m.purchase_date}</td>
                      <td className="px-4 py-3 text-center"><Badge status={m.payment_status || 'paid'} /></td>
                      <td className="px-4 py-3 text-xs text-slate-500">{m.payment_date || '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => toggleMatPayment(m)}
                          className={`text-xs px-3 py-1 rounded-lg border transition-colors ${m.payment_status === 'paid'
                            ? 'bg-slate-50 hover:bg-slate-100 text-slate-500 border-slate-200'
                            : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'}`}>
                          {m.payment_status === 'paid' ? 'Mark Pending' : 'Mark Paid'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-slate-600 font-medium">Category</th>
                    <th className="px-4 py-3 text-left text-slate-600 font-medium">Vendor</th>
                    <th className="px-4 py-3 text-left text-slate-600 font-medium">Notes</th>
                    <th className="px-4 py-3 text-right text-slate-600 font-medium">Amount</th>
                    <th className="px-4 py-3 text-left text-slate-600 font-medium">Date</th>
                    <th className="px-4 py-3 text-center text-slate-600 font-medium">Payment</th>
                    <th className="px-4 py-3 text-center text-slate-600 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {expenses.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-12 text-slate-400">No expenses found — click "+ Add Expense" to log one</td></tr>
                  ) : expenses.map(e => {
                    const catMeta = EXPENSE_CATEGORIES.find(c => c.id === e.category) || { label: e.category };
                    return (
                      <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3">
                          <span className="text-xs font-medium bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">{catMeta.label}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{e.vendor || '—'}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs max-w-40">
                          <span className="truncate block">{e.notes || '—'}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmt(e.amount)}</td>
                        <td className="px-4 py-3 text-xs text-slate-600">{e.expense_date}</td>
                        <td className="px-4 py-3 text-center"><Badge status={e.payment_status || 'paid'} /></td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button onClick={() => toggleExpPayment(e)}
                              className={`text-xs px-2 py-1 rounded-lg border transition-colors ${e.payment_status === 'paid'
                                ? 'bg-slate-50 hover:bg-slate-100 text-slate-500 border-slate-200'
                                : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'}`}>
                              {e.payment_status === 'paid' ? 'Pending' : 'Paid'}
                            </button>
                            <button onClick={() => deleteExpense(e.id)} className="text-xs text-rose-500 hover:text-rose-700 px-1">🗑</button>
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

      {/* Add Expense Modal */}
      {expModal && (
        <Modal title="Log New Expense" onClose={() => setExpModal(false)}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Amount (₹) *</label>
                <input type="number" step="0.01" value={expForm.amount}
                  onChange={e => setExpForm(f => ({ ...f, amount: e.target.value }))}
                  className="input-field w-full" placeholder="0.00" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Date *</label>
                <input type="date" value={expForm.expense_date}
                  onChange={e => setExpForm(f => ({ ...f, expense_date: e.target.value }))}
                  className="input-field w-full" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                <select value={expForm.category} onChange={e => setExpForm(f => ({ ...f, category: e.target.value }))}
                  className="input-field w-full">
                  {EXPENSE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Payment Method</label>
                <select value={expForm.payment_method} onChange={e => setExpForm(f => ({ ...f, payment_method: e.target.value }))}
                  className="input-field w-full">
                  {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Vendor / Supplier</label>
              <input type="text" value={expForm.vendor}
                onChange={e => setExpForm(f => ({ ...f, vendor: e.target.value }))}
                className="input-field w-full" placeholder="e.g. Amazon, Local market…" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Description / Notes</label>
              <textarea value={expForm.notes}
                onChange={e => setExpForm(f => ({ ...f, notes: e.target.value }))}
                rows={2} className="input-field w-full resize-none"
                placeholder="e.g. Glue gun repair, bubble wrap, shipping labels…" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Payment Status</label>
              <div className="flex gap-3">
                {['paid', 'pending'].map(s => (
                  <label key={s} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${expForm.payment_status === s ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                    <input type="radio" name="pay_status" value={s} checked={expForm.payment_status === s}
                      onChange={() => setExpForm(f => ({ ...f, payment_status: s }))} className="sr-only" />
                    <span className="text-sm font-medium capitalize">{s}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={saveExpense} disabled={saving || !expForm.amount || !expForm.expense_date}
                className="btn-primary flex-1 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save Expense'}
              </button>
              <button onClick={() => setExpModal(false)} className="btn-ghost flex-1">Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 4 — OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────
const CUSTOM_TOOLTIP = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-3 text-xs">
      <p className="font-semibold text-slate-700 mb-2">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: ₹{Number(p.value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
        </p>
      ))}
    </div>
  );
};

function OverviewTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [start, setStart] = useState(monthStart());
  const [end, setEnd] = useState(today());
  const [groupBy, setGroupBy] = useState('month');

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ start, end, group_by: groupBy });
      const { data: d } = await api.get(`/payments/overview?${p}`);
      setData(d);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [start, end, groupBy]);

  useEffect(() => { fetch(); }, [fetch]);

  const netColor = !data ? 'slate'
    : data.net_cash_position > 0 ? 'emerald'
    : data.net_cash_position < 0 ? 'rose'
    : 'slate';

  return (
    <div className="space-y-6">
      {/* Date Controls */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">From</label>
            <input type="date" value={start} onChange={e => setStart(e.target.value)} className="input-field text-sm py-1.5" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">To</label>
            <input type="date" value={end} onChange={e => setEnd(e.target.value)} className="input-field text-sm py-1.5" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Group Chart By</label>
            <select value={groupBy} onChange={e => setGroupBy(e.target.value)} className="input-field text-sm py-1.5 pr-8">
              <option value="month">Monthly</option>
              <option value="week">Weekly</option>
            </select>
          </div>
          <button onClick={fetch} className="btn-primary text-sm py-1.5 px-4">Refresh</button>
        </div>
      </div>

      {loading ? <Spinner /> : !data ? (
        <div className="text-center py-16 text-slate-400">Failed to load overview</div>
      ) : (
        <>
          {/* 6 Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <SummaryCard label="Total Received" value={fmt(data.total_received)} sub={`${fmt(data.total_pending_receivable)} still pending`} color="emerald" icon="📥" />
            <SummaryCard label="Pending Receivable" value={fmt(data.total_pending_receivable)} sub="Expected but not yet received" color="amber" icon="⏳" />
            <SummaryCard label="Paid to Workers" value={fmt(data.total_paid_workers)} sub={`${fmt(data.total_pending_workers)} pending`} color="violet" icon="👷" />
            <SummaryCard label="Pending to Workers" value={fmt(data.total_pending_workers)} sub="Payouts not yet disbursed" color="rose" icon="💸" />
            <SummaryCard label="Materials & Expenses" value={fmt(data.total_spent)} sub={`${fmt(data.total_pending_outgoing)} pending to suppliers`} color="blue" icon="🧶" />
            <SummaryCard label="Pending to Suppliers" value={fmt(data.total_pending_outgoing)} sub="Unpaid material bills" color="slate" icon="📋" />
          </div>

          {/* Net Cash Position */}
          <div className={`rounded-2xl p-6 border-2 ${netColor === 'emerald' ? 'border-emerald-300 bg-emerald-50' : netColor === 'rose' ? 'border-rose-300 bg-rose-50' : 'border-slate-300 bg-slate-50'}`}>
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-1">Net Cash Position</h3>
                <p className={`text-4xl font-bold ${netColor === 'emerald' ? 'text-emerald-700' : netColor === 'rose' ? 'text-rose-700' : 'text-slate-700'}`}>
                  {fmt(data.net_cash_position)}
                </p>
              </div>
              <div className="text-xs text-slate-500 bg-white rounded-xl border border-slate-200 p-3 max-w-xs">
                <p className="font-semibold text-slate-700 mb-2">Formula</p>
                <p>Total Received from Platforms</p>
                <p className="text-rose-500">− Total Paid to Workers</p>
                <p className="text-rose-500">− Total Materials Paid</p>
                <p className="text-rose-500">− Total Other Expenses Paid</p>
                <div className="border-t border-slate-200 mt-2 pt-2 font-semibold text-slate-700">= Net Cash Position</div>
                <p className="text-slate-400 mt-1 text-[10px]">Excludes pending/unpaid amounts on all sides.</p>
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="font-semibold text-slate-700 mb-4">Money In vs Money Out</h3>
            {data.chart_data?.length === 0 ? (
              <div className="text-center py-12 text-slate-400">No chart data for this range</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.chart_data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis tickFormatter={v => '₹' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)} tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip content={<CUSTOM_TOOLTIP />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="money_in" name="Money In" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="money_out" name="Money Out" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Breakdown Table */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="font-semibold text-slate-700 mb-4">Detailed Breakdown</h3>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {[
                  { label: 'Total Expected from Platforms', value: data.total_expected, cls: 'text-slate-800' },
                  { label: 'Total Received from Platforms', value: data.total_received, cls: 'text-emerald-700 font-semibold' },
                  { label: 'Pending Receivable (platforms)', value: data.total_pending_receivable, cls: 'text-amber-600' },
                  null,
                  { label: 'Total Paid to Workers', value: data.total_paid_workers, cls: 'text-rose-600' },
                  { label: 'Pending to Workers', value: data.total_pending_workers, cls: 'text-amber-600' },
                  null,
                  { label: 'Total Materials Paid', value: data.total_materials_paid, cls: 'text-rose-600' },
                  { label: 'Materials Pending', value: data.total_materials_pending, cls: 'text-amber-600' },
                  null,
                  { label: 'Other Expenses Paid', value: data.total_other_paid, cls: 'text-rose-600' },
                  { label: 'Other Expenses Pending', value: data.total_other_pending, cls: 'text-amber-600' },
                  null,
                  { label: '🟢 Net Cash Position', value: data.net_cash_position, cls: `font-bold text-lg ${data.net_cash_position >= 0 ? 'text-emerald-700' : 'text-rose-700'}` },
                ].map((row, i) => row === null ? (
                  <tr key={`sep-${i}`}><td colSpan={2} className="py-1" /></tr>
                ) : (
                  <tr key={row.label} className="hover:bg-slate-50">
                    <td className="py-2 pr-4 text-slate-600">{row.label}</td>
                    <td className={`py-2 text-right ${row.cls}`}>{fmt(row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'settlements', label: 'Platform Settlements', icon: '📥' },
  { id: 'payouts', label: 'Worker Payouts', icon: '👷' },
  { id: 'expenses', label: 'Material & Expenses', icon: '🧾' },
  { id: 'overview', label: 'Overview', icon: '📊' },
];

export default function PaymentsPage() {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <span className="text-3xl">💰</span> Payments
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Track all money in &amp; out — platform settlements, worker payouts, and expenses
          </p>
        </div>
        <div className="bg-amber-50 border border-amber-200 text-amber-700 text-xs px-3 py-1.5 rounded-full font-medium flex items-center gap-1.5">
          <span>🔒</span> Owner/Admin only
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === t.id
                ? 'bg-white text-violet-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-800 hover:bg-white/60'
            }`}
          >
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'settlements' && <PlatformSettlementsTab />}
      {activeTab === 'payouts' && <WorkerPayoutsTab />}
      {activeTab === 'expenses' && <MaterialExpensesTab />}
      {activeTab === 'overview' && <OverviewTab />}
    </div>
  );
}
