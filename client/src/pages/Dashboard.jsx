import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import api from '../api/index.js';
import { useAuthStore } from '../store/auth';
import OnboardingChecklist from '../components/OnboardingChecklist';
import { formatCurrency, formatDate, today, daysAgo } from '../utils/index.js';

const PLATFORM_COLORS = {
  flipkart: '#f59e0b', meesho: '#ec4899', myntra: '#f97316',
  etsy: '#d97706', amazon: '#3b82f6', manual: '#94a3b8',
};

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
    </div>
  );
}

function KpiCard({ label, value, sub, icon, color = 'violet' }) {
  const colorMap = {
    violet: 'bg-purple-50 text-purple-600',
    amber: 'bg-amber-50 text-amber-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    rose: 'bg-rose-50 text-rose-600',
    blue: 'bg-blue-50 text-blue-600',
  };
  return (
    <div className="stat-card">
      <div className="flex items-start justify-between">
        <div>
          <p className="stat-label">{label}</p>
          <p className="stat-value mt-1">{value}</p>
          {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
        </div>
        <span className={`text-2xl p-2 rounded-xl ${colorMap[color] || colorMap.violet}`}>{icon}</span>
      </div>
    </div>
  );
}

function WorkerDashboard({ user }) {
  const { data, isLoading } = useQuery({
    queryKey: ['production', 'mine', user?.id],
    queryFn: () => api.get('/production', { params: { worker_id: user?.id, limit: 30 } }).then(r => r.data),
  });

  const { data: payouts, isLoading: payoutsLoading } = useQuery({
    queryKey: ['payouts', 'mine', user?.id],
    queryFn: () => api.get('/payouts/mine').then(r => r.data),
  });

  return (
    <div className="space-y-6">
      <div className="card bg-purple-50 border-purple-100">
        <p className="text-purple-700 font-medium">👋 Welcome back, {user?.name}!</p>
        <p className="text-slate-500 text-sm mt-1">Log your daily production under the Production section.</p>
      </div>

      {/* Earnings / Payouts Section */}
      <div className="card border-emerald-100 bg-emerald-50/20">
        <div className="card-header">
          <h2 className="font-semibold text-emerald-800 flex items-center gap-2">
            <span>💸</span> My Earnings & Payouts
          </h2>
        </div>
        {payoutsLoading ? <Spinner /> : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr><th>Period</th><th>Pieces</th><th>Hours</th><th>Days</th><th>Amount</th><th>Status</th></tr>
              </thead>
              <tbody>
                {(!payouts || payouts.length === 0)
                  ? <tr><td colSpan={6} className="text-center text-slate-400 py-8">No payouts generated yet.</td></tr>
                  : payouts.map(p => (
                    <tr key={p.id}>
                      <td className="font-medium text-slate-700">
                        {formatDate(p.period_start)} – {formatDate(p.period_end)}
                      </td>
                      <td>{p.pieces || 0}</td>
                      <td>{p.hours || 0}</td>
                      <td>{p.days || 0}</td>
                      <td className="font-bold text-emerald-700">{formatCurrency(p.amount)}</td>
                      <td>
                        <span className={`badge ${
                          p.status === 'paid' ? 'bg-emerald-100 text-emerald-700' :
                          p.status === 'ordered' ? 'bg-amber-100 text-amber-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {p.status === 'paid' ? '✅ Paid' :
                           p.status === 'ordered' ? '⏳ Pending' :
                           '📥 Received'}
                        </span>
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="font-semibold text-slate-800">My Recent Production</h2>
        </div>
        {isLoading ? <Spinner /> : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr><th>Date</th><th>Product</th><th>Qty</th><th>Defects</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {(!data?.entries || data.entries.length === 0)
                  ? <tr><td colSpan={5} className="text-center text-slate-400 py-8">No production entries logged yet.</td></tr>
                  : data.entries.map(e => (
                    <tr key={e.id}>
                      <td className="font-medium">{formatDate(e.production_date)}</td>
                      <td className="font-medium">{e.product_name}</td>
                      <td className="font-semibold">{e.quantity}</td>
                      <td>{e.defect_count ? <span className="badge bg-red-50 text-red-600">{e.defect_count}</span> : '—'}</td>
                      <td className="text-slate-400 text-xs">{e.notes || '—'}</td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AdminDashboard() {
  const [searchParams] = useSearchParams();
  const [startDate, setStartDate] = useState(() => searchParams.get('start_date') || daysAgo(30));
  const [endDate, setEndDate] = useState(() => searchParams.get('end_date') || today());

  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard', startDate, endDate],
    queryFn: () => api.get('/reports/dashboard', { params: { start_date: startDate, end_date: endDate } }).then(r => r.data),
  });

  const { data: lowStockMaterials = [] } = useQuery({
    queryKey: ['materials', 'low-stock'],
    queryFn: () => api.get('/materials/low-stock').then(r => r.data),
  });

  const { data: lowStockGoods = [] } = useQuery({
    queryKey: ['stock', 'finished-goods', 'low-stock'],
    queryFn: () => api.get('/stock/finished-goods', { params: { low_stock: 'true' } }).then(r => r.data),
  });

  if (isLoading) return <Spinner />;
  if (isError) return (
    <div className="card text-center py-12 text-rose-500 font-medium">
      Failed to load dashboard data. Please refresh the page.
    </div>
  );

  const {
    order_stats = {},
    revenue_stats = {},
    production_stats = {},
    low_stock_materials = 0,
    low_stock_goods = 0,
    pending_payouts = 0,
    production_trend = [],
    revenue_by_platform = [],
    top_products = [],
  } = data ?? {};

  const totalLowStock = (low_stock_materials || 0) + (low_stock_goods || 0);

  const platformChartData = (revenue_by_platform || []).map(p => ({
    name: p.platform.charAt(0).toUpperCase() + p.platform.slice(1),
    value: parseFloat(p.revenue || 0),
    fill: PLATFORM_COLORS[p.platform] ?? '#94a3b8',
  }));

  const trendData = (production_trend || []).map(t => ({
    date: t.production_date ? t.production_date.slice(5) : '—',
    pieces: parseInt(t.quantity || 0),
  }));

  return (
    <div className="space-y-6">
      {/* Date Selection Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-white border border-slate-100 rounded-2xl shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-700">Filter Period:</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => { setStartDate(daysAgo(7)); setEndDate(today()); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-xl border transition-all ${
                startDate === daysAgo(7) && endDate === today()
                  ? 'bg-purple-600 border-purple-600 text-white'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              7 Days
            </button>
            <button
              onClick={() => { setStartDate(daysAgo(30)); setEndDate(today()); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-xl border transition-all ${
                startDate === daysAgo(30) && endDate === today()
                  ? 'bg-purple-600 border-purple-600 text-white'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              30 Days
            </button>
            <button
              onClick={() => { setStartDate(daysAgo(90)); setEndDate(today()); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-xl border transition-all ${
                startDate === daysAgo(90) && endDate === today()
                  ? 'bg-purple-600 border-purple-600 text-white'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              90 Days
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-400 font-medium">From</span>
            <input
              type="date"
              className="input w-36 py-1 px-2.5 text-xs rounded-xl"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <span className="text-slate-400 font-medium">To</span>
            <input
              type="date"
              className="input w-36 py-1 px-2.5 text-xs rounded-xl"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard
          label="Total Orders"
          value={order_stats.total_orders || 0}
          sub={`${order_stats.pending || 0} pending`}
          icon="📦"
          color="violet"
        />
        <KpiCard
          label="Revenue"
          value={formatCurrency(revenue_stats.revenue_30d || 0)}
          sub={`${revenue_stats.orders_30d || 0} orders`}
          icon="💰"
          color="emerald"
        />
        <KpiCard
          label="Profit"
          value={formatCurrency(revenue_stats.profit_30d || 0)}
          sub={revenue_stats.revenue_30d > 0 ? `${((revenue_stats.profit_30d / revenue_stats.revenue_30d) * 100).toFixed(1)}% margin` : '0% margin'}
          icon="📈"
          color="emerald"
        />
        <KpiCard
          label="Production"
          value={`${production_stats.pieces_7d || 0} pcs`}
          sub="during period"
          icon="🧶"
          color="blue"
        />
        <KpiCard
          label="Pending Payouts"
          value={formatCurrency(pending_payouts || 0)}
          sub="unpaid balance"
          icon="💸"
          color="amber"
        />
        <KpiCard
          label="Low Stock Alerts"
          value={totalLowStock}
          sub={`${low_stock_materials} mat / ${low_stock_goods} goods`}
          icon="⚠️"
          color="rose"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="card-header">
            <h2 className="font-semibold text-slate-800">Revenue by Platform</h2>
          </div>
          {platformChartData.length === 0 ? (
            <p className="text-center text-slate-400 py-12">No platform revenue data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={platformChartData}
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {platformChartData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="font-semibold text-slate-800">Production Trend (30 days)</h2>
          </div>
          {trendData.length === 0 ? (
            <p className="text-center text-slate-400 py-12">No production data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="pieces" fill="#7c3aed" radius={[4, 4, 0, 0]} name="Pieces" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Top Products & Low Stock Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="card-header">
            <h2 className="font-semibold text-slate-800">Top 5 Selling Products</h2>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr><th>#</th><th>Product</th><th>SKU</th><th>Units Sold</th><th>Revenue</th></tr>
              </thead>
              <tbody>
                {(!top_products || top_products.length === 0) ? (
                  <tr><td colSpan={5} className="text-center text-slate-400 py-6">No data available.</td></tr>
                ) : (
                  top_products.slice(0, 5).map((p, i) => (
                    <tr key={p.sku || i}>
                      <td>
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                          i === 0 ? 'bg-amber-100 text-amber-700' :
                          i === 1 ? 'bg-slate-100 text-slate-600' :
                          i === 2 ? 'bg-orange-100 text-orange-600' :
                          'bg-slate-50 text-slate-400'
                        }`}>{i + 1}</span>
                      </td>
                      <td className="font-medium">{p.name}</td>
                      <td className="font-mono text-xs text-slate-400">{p.sku}</td>
                      <td className="font-semibold">{p.total_sold}</td>
                      <td className="font-semibold text-emerald-600">{formatCurrency(p.revenue)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="font-semibold text-slate-800">⚠️ Low Stock Alerts</h2>
            <span className="badge bg-rose-50 text-rose-600">{totalLowStock} items</span>
          </div>
          {totalLowStock === 0 ? (
            <div className="text-center py-8">
              <p className="text-3xl mb-2">✅</p>
              <p className="text-slate-500 text-sm">All stock levels are healthy!</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {lowStockMaterials.map((m) => (
                <div key={`m-${m.id}`} className="flex items-center justify-between p-3 rounded-xl bg-amber-50 border border-amber-100">
                  <div>
                    <p className="text-sm font-medium text-slate-800">🧶 {m.name}</p>
                    <p className="text-xs text-slate-500">
                      Raw Material · Stock: <span className="font-semibold text-amber-700">{m.stock_quantity} {m.unit}</span> / Reorder: {m.reorder_threshold} {m.unit}
                    </p>
                  </div>
                  <span className="badge bg-amber-100 text-amber-800">Low Material</span>
                </div>
              ))}
              {lowStockGoods.map((g) => (
                <div key={`g-${g.id}`} className="flex items-center justify-between p-3 rounded-xl bg-rose-50 border border-rose-100">
                  <div>
                    <p className="text-sm font-medium text-slate-800">🧸 {g.product_name}</p>
                    <p className="text-xs text-slate-500">
                      Finished Good · Stock: <span className="font-semibold text-rose-600">{g.quantity} units</span> / Reorder: {g.reorder_threshold} units
                    </p>
                  </div>
                  <span className="badge bg-rose-100 text-rose-700">Low Product</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick To-Do Widget */}
        <QuickTodoWidget />
      </div>
    </div>
  );
}

function QuickTodoWidget() {
  const { data: todos = [], refetch, isLoading } = useQuery({
    queryKey: ['todos', 'quick'],
    queryFn: () => api.get('/todos').then(r => r.data),
  });

  const activeTodos = todos.filter(t => t.status !== 'completed').slice(0, 4);

  const toggleTodo = async (todo) => {
    try {
      await api.patch(`/todos/${todo.id}`, { status: todo.status === 'completed' ? 'pending' : 'completed' });
      refetch();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <h2 className="font-semibold text-slate-800 flex items-center gap-2">
          <span>📋</span> Admin Tasks & To-Dos
        </h2>
        <a href="/todos" className="text-xs font-semibold text-purple-600 hover:text-purple-700">
          View All ({todos.filter(t => t.status !== 'completed').length}) →
        </a>
      </div>
      {isLoading ? (
        <div className="py-6 text-center text-slate-400 text-xs">Loading tasks...</div>
      ) : activeTodos.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-2xl mb-1">🎉</p>
          <p className="text-slate-500 text-xs">No pending admin tasks!</p>
          <a href="/todos" className="inline-block mt-2 text-xs font-semibold text-purple-600">
            + Create a task
          </a>
        </div>
      ) : (
        <div className="space-y-2">
          {activeTodos.map((t) => (
            <div key={t.id} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100 hover:bg-slate-100/80 transition-colors">
              <div className="flex items-center gap-2.5 min-w-0">
                <input
                  type="checkbox"
                  checked={t.status === 'completed'}
                  onChange={() => toggleTodo(t)}
                  className="w-4 h-4 text-purple-600 rounded cursor-pointer"
                />
                <span className="text-xs font-medium text-slate-800 truncate">{t.title}</span>
              </div>
              {t.priority === 'high' && (
                <span className="badge bg-rose-100 text-rose-700 text-[10px] shrink-0">High</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuthStore();
  const todayStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const trialEnds = user?.trial_ends_at ? new Date(user.trial_ends_at) : null;
  const trialDaysRemaining = trialEnds ? Math.ceil((trialEnds - new Date()) / (1000 * 60 * 60 * 24)) : 0;

  const showTrialBanner = user?.subscription_status === 'trialing' && trialDaysRemaining > 0 && user?.role !== 'worker';
  const showOnboarding = !user?.onboarding_dismissed && user?.role !== 'worker';

  return (
    <div className="space-y-6">
      {showTrialBanner && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-3xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <p className="text-sm font-semibold">⏳ Free Trial Active</p>
            <p className="text-xs text-amber-700 mt-0.5">Your trial ends in {trialDaysRemaining} days. Upgrade to Growth or Business to prevent lockout.</p>
          </div>
          <a href="/billing" className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-2xl text-xs font-bold transition-colors">
            Upgrade Plan
          </a>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-0.5">{todayStr}</p>
        </div>
      </div>

      {showOnboarding && <OnboardingChecklist />}

      {user?.role === 'worker' ? <WorkerDashboard user={user} /> : <AdminDashboard />}
    </div>
  );
}