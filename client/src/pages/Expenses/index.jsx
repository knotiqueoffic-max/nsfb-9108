import { useState, useEffect, useMemo } from 'react';
import api from '../../api';

/* ─── Constants ─────────────────────────────────────────────────────────── */
const CATEGORIES = [
  { id: 'office',     label: 'Office & Utilities',  icon: '🏢', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  { id: 'shipping',   label: 'Shipping & Packaging', icon: '📦', color: 'bg-amber-100 text-amber-800 border-amber-200' },
  { id: 'equipment',  label: 'Equipment & Tools',   icon: '🔧', color: 'bg-purple-100 text-purple-800 border-purple-200' },
  { id: 'travel',     label: 'Travel & Transport',  icon: '🚗', color: 'bg-teal-100 text-teal-800 border-teal-200' },
  { id: 'salaries',   label: 'Salaries & Wages',    icon: '💼', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  { id: 'marketing',  label: 'Marketing & Ads',     icon: '📣', color: 'bg-rose-100 text-rose-800 border-rose-200' },
  { id: 'other',      label: 'Miscellaneous',        icon: '🔖', color: 'bg-slate-100 text-slate-700 border-slate-200' },
];

const PAYMENT_METHODS = [
  { id: 'cash',          label: 'Cash',          icon: '💵' },
  { id: 'upi',           label: 'UPI',           icon: '📱' },
  { id: 'bank_transfer', label: 'Bank Transfer', icon: '🏦' },
  { id: 'card',          label: 'Card',          icon: '💳' },
  { id: 'cheque',        label: 'Cheque',        icon: '📝' },
];

function getCategoryMeta(id) {
  return CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
}
function getPaymentMeta(id) {
  return PAYMENT_METHODS.find(m => m.id === id) || { id, label: id, icon: '💰' };
}

function formatCurrency(v) {
  return '₹' + Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const today = () => new Date().toISOString().split('T')[0];
const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

/* ─── Default Form State ─────────────────────────────────────────────────── */
const EMPTY_FORM = {
  amount: '',
  category: 'other',
  expense_date: today(),
  payment_method: 'cash',
  vendor: '',
  receipt_ref: '',
  notes: '',
};

/* ═══════════════════════════════════════════════════════════════════════════ */
export default function ExpensesPage() {
  const [expenses, setExpenses]   = useState([]);
  const [stats, setStats]         = useState({ total: 0, this_month: 0, by_category: {}, by_payment_method: {}, count: 0 });
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  /* filters */
  const [filterCategory, setFilterCategory]   = useState('all');
  const [filterPayment, setFilterPayment]     = useState('all');
  const [filterStart, setFilterStart]         = useState(monthStart());
  const [filterEnd, setFilterEnd]             = useState(today());
  const [searchQuery, setSearchQuery]         = useState('');

  /* modal */
  const [isModalOpen, setIsModalOpen]   = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [form, setForm]                 = useState(EMPTY_FORM);
  const [saving, setSaving]             = useState(false);
  const [formError, setFormError]       = useState('');

  /* delete confirmation */
  const [deletingId, setDeletingId]     = useState(null);

  /* ─── Fetch ──────────────────────────────────────────────────────────── */
  const fetchAll = async () => {
    try {
      setLoading(true);
      setError(null);
      const params = {};
      if (filterCategory !== 'all') params.category = filterCategory;
      if (filterPayment !== 'all')  params.payment_method = filterPayment;
      if (filterStart) params.start_date = filterStart;
      if (filterEnd)   params.end_date   = filterEnd;

      const [expRes, statRes] = await Promise.all([
        api.get('/expenses', { params }),
        api.get('/expenses/stats', { params: { start_date: filterStart, end_date: filterEnd } }),
      ]);
      setExpenses(expRes.data);
      setStats(statRes.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load expenses');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, [filterCategory, filterPayment, filterStart, filterEnd]);

  /* ─── Client-side search filter ─────────────────────────────────────── */
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return expenses;
    const q = searchQuery.toLowerCase();
    return expenses.filter(e =>
      (e.vendor || '').toLowerCase().includes(q) ||
      (e.notes || '').toLowerCase().includes(q) ||
      (e.receipt_ref || '').toLowerCase().includes(q)
    );
  }, [expenses, searchQuery]);

  /* ─── Modal helpers ─────────────────────────────────────────────────── */
  const openCreate = () => {
    setEditingExpense(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setIsModalOpen(true);
  };

  const openEdit = (e) => {
    setEditingExpense(e);
    setForm({
      amount:         e.amount || '',
      category:       e.category || 'other',
      expense_date:   e.expense_date ? e.expense_date.substring(0, 10) : today(),
      payment_method: e.payment_method || 'cash',
      vendor:         e.vendor || '',
      receipt_ref:    e.receipt_ref || '',
      notes:          e.notes || '',
    });
    setFormError('');
    setIsModalOpen(true);
  };

  const handleSave = async (evt) => {
    evt.preventDefault();
    if (!form.amount || isNaN(parseFloat(form.amount)) || parseFloat(form.amount) <= 0) {
      setFormError('Please enter a valid amount greater than 0.');
      return;
    }
    try {
      setSaving(true);
      setFormError('');
      if (editingExpense) {
        await api.patch(`/expenses/${editingExpense.id}`, form);
      } else {
        await api.post('/expenses', form);
      }
      setIsModalOpen(false);
      await fetchAll();
    } catch (err) {
      setFormError(err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || 'Failed to save expense');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      setDeletingId(id);
      await api.delete(`/expenses/${id}`);
      await fetchAll();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  const setField = (key, val) => setForm(f => ({ ...f, [key]: val }));

  /* ─── Computed totals ────────────────────────────────────────────────── */
  const filteredTotal = filtered.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
  const topCategory = Object.entries(stats.by_category || {})
    .sort((a, b) => b[1] - a[1])
    .find(([, v]) => v > 0);

  /* ═══════════════════════════════════════════════════════════════════════ */
  return (
    <div className="space-y-6">

      {/* ── Page Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            💸 Expenses Tracker
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Record, categorize and monitor all business expenditures.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-semibold shadow-sm transition-colors flex items-center gap-2 shrink-0"
        >
          <span className="text-base leading-none">+</span> Add Expense
        </button>
      </div>

      {/* ── KPI Cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">This Month</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{formatCurrency(stats.this_month)}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-blue-200 bg-blue-50/20 shadow-sm">
          <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider">Period Total</p>
          <p className="text-2xl font-bold text-blue-800 mt-1">{formatCurrency(filteredTotal)}</p>
          <p className="text-[10px] text-blue-500 mt-0.5">{filtered.length} entries</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-purple-200 bg-purple-50/20 shadow-sm">
          <p className="text-xs font-semibold text-purple-600 uppercase tracking-wider">Top Category</p>
          {topCategory ? (
            <>
              <p className="text-base font-bold text-purple-800 mt-1">{getCategoryMeta(topCategory[0]).icon} {getCategoryMeta(topCategory[0]).label}</p>
              <p className="text-xs text-purple-500">{formatCurrency(topCategory[1])}</p>
            </>
          ) : (
            <p className="text-sm text-slate-400 mt-1">—</p>
          )}
        </div>
        <div className="bg-white p-4 rounded-xl border border-emerald-200 bg-emerald-50/20 shadow-sm">
          <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Total Records</p>
          <p className="text-2xl font-bold text-emerald-800 mt-1">{stats.count}</p>
        </div>
      </div>

      {/* ── Category Breakdown Bar ───────────────────────────────────────── */}
      {stats.total > 0 && (
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Spend by Category</p>
          <div className="flex flex-wrap gap-3">
            {CATEGORIES.map(cat => {
              const amount = stats.by_category?.[cat.id] || 0;
              if (!amount) return null;
              const pct = stats.total > 0 ? ((amount / stats.total) * 100).toFixed(0) : 0;
              return (
                <div key={cat.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium ${cat.color}`}>
                  <span>{cat.icon}</span>
                  <span>{cat.label}</span>
                  <span className="font-bold">{formatCurrency(amount)}</span>
                  <span className="opacity-60">({pct}%)</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center gap-3 flex-wrap">
        {/* Date range */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-500 whitespace-nowrap">From:</label>
          <input
            type="date"
            value={filterStart}
            onChange={e => setFilterStart(e.target.value)}
            className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <label className="text-xs font-semibold text-slate-500 whitespace-nowrap">To:</label>
          <input
            type="date"
            value={filterEnd}
            onChange={e => setFilterEnd(e.target.value)}
            className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* Quick date presets */}
        <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-xl">
          {[
            { label: 'This Month', start: monthStart(), end: today() },
            { label: 'Last 30d',   start: (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]; })(), end: today() },
            { label: 'This Year',  start: `${new Date().getFullYear()}-01-01`, end: today() },
          ].map(p => (
            <button
              key={p.label}
              onClick={() => { setFilterStart(p.start); setFilterEnd(p.end); }}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                filterStart === p.start && filterEnd === p.end
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Category */}
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="all">All Categories</option>
          {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
        </select>

        {/* Payment method */}
        <select
          value={filterPayment}
          onChange={e => setFilterPayment(e.target.value)}
          className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="all">All Payment Methods</option>
          {PAYMENT_METHODS.map(m => <option key={m.id} value={m.id}>{m.icon} {m.label}</option>)}
        </select>

        {/* Search */}
        <div className="relative flex-1 min-w-40">
          <input
            type="text"
            placeholder="Search vendor, notes, ref..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <span className="absolute left-2.5 top-1.5 text-slate-400 text-xs">🔍</span>
        </div>
      </div>

      {/* ── Expense Table ─────────────────────────────────────────────────── */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400 text-sm">
          Loading expenses...
        </div>
      ) : error ? (
        <div className="bg-red-50 text-red-700 p-4 rounded-2xl border border-red-200 text-sm">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <div className="text-4xl mb-2">🧾</div>
          <h3 className="font-bold text-slate-700 text-base">No expenses found</h3>
          <p className="text-slate-400 text-xs mt-1">
            {searchQuery || filterCategory !== 'all' || filterPayment !== 'all'
              ? 'Try adjusting your filters.'
              : 'Click "Add Expense" to log your first entry!'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Table header with total */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/60">
            <span className="text-xs font-semibold text-slate-500">{filtered.length} records</span>
            <span className="text-sm font-bold text-slate-700">Total: {formatCurrency(filteredTotal)}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Vendor</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Category</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Payment</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Ref #</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Paid By</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Amount</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((exp) => {
                  const cat = getCategoryMeta(exp.category);
                  const pay = getPaymentMeta(exp.payment_method);
                  return (
                    <tr key={exp.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-3 text-slate-700 text-xs font-medium whitespace-nowrap">
                        {new Date(exp.expense_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3 max-w-[160px]">
                        <p className="font-medium text-slate-800 truncate">{exp.vendor || <span className="text-slate-400 italic">—</span>}</p>
                        {exp.notes && <p className="text-xs text-slate-400 truncate">{exp.notes}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-xs font-medium ${cat.color}`}>
                          {cat.icon} {cat.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 text-xs font-medium">
                          {pay.icon} {pay.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 font-mono">
                        {exp.receipt_ref || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {exp.paid_by_name || '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-bold text-slate-800">{formatCurrency(exp.amount)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => openEdit(exp)}
                            className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                            title="Edit"
                          >✏️</button>
                          <button
                            onClick={() => handleDelete(exp.id)}
                            disabled={deletingId === exp.id}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                            title="Delete"
                          >🗑️</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Add / Edit Modal ─────────────────────────────────────────────── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
              <h2 className="font-bold text-slate-800 text-lg">
                {editingExpense ? '✏️ Edit Expense' : '💸 Add New Expense'}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-700 text-xl font-bold">✕</button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">

              {formError && (
                <div className="bg-red-50 text-red-700 border border-red-200 px-4 py-2 rounded-xl text-xs">
                  {formError}
                </div>
              )}

              {/* Amount + Date — side by side */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Amount (₹) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">₹</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      placeholder="0.00"
                      value={form.amount}
                      onChange={e => setField('amount', e.target.value)}
                      className="w-full pl-7 pr-3 py-2 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={form.expense_date}
                    onChange={e => setField('expense_date', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Category *
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {CATEGORIES.map(cat => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setField('category', cat.id)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all text-left ${
                        form.category === cat.id
                          ? `${cat.color} ring-2 ring-offset-1 ring-current`
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <span className="text-base">{cat.icon}</span>
                      <span>{cat.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Payment method */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Payment Method *
                </label>
                <div className="flex flex-wrap gap-2">
                  {PAYMENT_METHODS.map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setField('payment_method', m.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                        form.payment_method === m.id
                          ? 'bg-brand-600 text-white border-brand-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <span>{m.icon}</span> {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Vendor */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Vendor / Supplier
                </label>
                <input
                  type="text"
                  placeholder="e.g. Sharma Stationery, BSES Delhi"
                  value={form.vendor}
                  onChange={e => setField('vendor', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              {/* Receipt Ref */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Receipt / Reference Number
                </label>
                <input
                  type="text"
                  placeholder="e.g. INV-2024-0041, UPI Ref 3819..."
                  value={form.receipt_ref}
                  onChange={e => setField('receipt_ref', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="Add any additional details..."
                  value={form.notes}
                  onChange={e => setField('notes', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              {/* Actions */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl text-sm font-semibold bg-brand-600 hover:bg-brand-700 text-white shadow-sm transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingExpense ? 'Update Expense' : 'Save Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
