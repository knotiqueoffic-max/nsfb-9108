import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { format, subDays } from 'date-fns';
import toast from 'react-hot-toast';
import api from '../../api/index.js';
import { useAuthStore } from '../../store/auth';
import { usePlan } from '../../hooks/usePlan';
import UpgradePrompt from '../../components/UpgradePrompt';

const formatINR = (v) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v ?? 0);
const pct = (v) => `${(v ?? 0).toFixed(1)}%`;

const PLATFORM_COLORS = {
  flipkart: '#f59e0b', meesho: '#ec4899', myntra: '#f97316',
  etsy: '#d97706', amazon: '#3b82f6', manual: '#94a3b8',
};
const BAR_COLORS = ['#7c3aed', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

const TABS = ['overview', 'margins', 'bestsellers', 'materials', 'workers'];

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-7 h-7 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
    </div>
  );
}

function TabButton({ tab, active, label, onClick }) {
  return (
    <button onClick={onClick}
      className={`px-5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap
        ${active ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
      {label}
    </button>
  );
}

function ExportButton({ type, start, end }) {
  const handleExport = async () => {
    try {
      const res = await api.get(`/reports/export/${type}`, {
        params: { start, end },
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `knotique-${type}-${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Export downloaded!');
    } catch {
      toast.error('Export failed.');
    }
  };
  return (
    <button onClick={handleExport} className="btn-secondary btn-sm ml-auto">
      📊 Export to Excel
    </button>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab({ start, end }) {
  const { data, isLoading } = useQuery({
    queryKey: ['salesByPlatform', start, end],
    queryFn: () => api.get('/reports/sales-by-platform', { params: { start, end } }).then(r => r.data),
  });

  const chartData = (data?.by_platform ?? data ?? []).map(p => ({
    name: p.platform?.charAt(0).toUpperCase() + p.platform?.slice(1),
    Revenue: p.revenue,
    Orders: p.orders,
    fill: PLATFORM_COLORS[p.platform] ?? '#94a3b8',
  }));

  return isLoading ? <Spinner /> : (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {chartData.map(p => (
          <div key={p.name} className="stat-card">
            <p className="stat-label">{p.name}</p>
            <p className="stat-value">{formatINR(p.Revenue)}</p>
            <p className="text-xs text-slate-400">{p.Orders} orders</p>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-slate-800">Revenue by Platform</h3>
          <ExportButton type="sales" start={start} end={end} />
        </div>
        {chartData.length === 0
          ? <p className="text-center text-slate-400 py-10">No sales data for this period.</p>
          : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => formatINR(v)} />
                <Bar dataKey="Revenue" radius={[6, 6, 0, 0]}>
                  {chartData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
      </div>
    </div>
  );
}

// ─── Profit Margins Tab ───────────────────────────────────────────────────────
function MarginsTab({ start, end }) {
  const { data, isLoading } = useQuery({
    queryKey: ['profitMargins'],
    queryFn: () => api.get('/reports/profit-margins').then(r => r.data),
  });

  const products = data?.products ?? data ?? [];

  const marginClass = (v) =>
    v >= 25 ? 'text-emerald-600 font-bold' :
    v >= 10 ? 'text-amber-600 font-semibold' :
    'text-rose-600 font-bold';

  const marginBg = (v) =>
    v >= 25 ? 'bg-emerald-50' : v >= 10 ? 'bg-amber-50' : 'bg-rose-50';

  return isLoading ? <Spinner /> : (
    <div className="card">
      <div className="card-header">
        <h3 className="font-semibold text-slate-800">Profit Margins by Product & Platform</h3>
        <ExportButton type="margins" start={start} end={end} />
      </div>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Material Cost</th>
              <th>Labor Cost</th>
              <th>Total COGS</th>
              <th>Platform</th>
              <th>Price</th>
              <th>Commission</th>
              <th>Profit</th>
              <th>Margin</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr><td colSpan={9} className="text-center text-slate-400 py-10">No data.</td></tr>
            ) : products.flatMap(p =>
              (p.platform_margins ?? []).length > 0
                ? p.platform_margins.map((pm, pi) => (
                  <tr key={`${p.product_id}-${pm.platform}`} className={pi === 0 ? '' : 'border-l-4 border-l-transparent'}>
                    {pi === 0 ? (
                      <>
                        <td rowSpan={p.platform_margins.length} className="font-medium border-r border-slate-100 align-top py-4">
                          {p.name}
                        </td>
                        <td rowSpan={p.platform_margins.length} className="border-r border-slate-100 align-top py-4">{formatINR(p.material_cost)}</td>
                        <td rowSpan={p.platform_margins.length} className="border-r border-slate-100 align-top py-4">{formatINR(p.labor_cost)}</td>
                        <td rowSpan={p.platform_margins.length} className="font-semibold border-r border-slate-100 align-top py-4">{formatINR(p.total_cogs)}</td>
                      </>
                    ) : null}
                    <td><span className={`badge platform-${pm.platform}`}>{pm.platform}</span></td>
                    <td>{formatINR(pm.price)}</td>
                    <td className="text-xs text-slate-500">{pm.commission_pct}% ({formatINR(pm.commission_amt)})</td>
                    <td>{formatINR(pm.profit)}</td>
                    <td className={`${marginClass(pm.margin_pct)} ${marginBg(pm.margin_pct)} rounded`}>
                      {pct(pm.margin_pct)}
                    </td>
                  </tr>
                ))
                : [<tr key={p.product_id}>
                    <td className="font-medium">{p.name}</td>
                    <td>{formatINR(p.material_cost)}</td>
                    <td>{formatINR(p.labor_cost)}</td>
                    <td className="font-semibold">{formatINR(p.total_cogs)}</td>
                    <td colSpan={5} className="text-slate-400 text-center">No platform prices set</td>
                  </tr>]
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-3 mt-4 text-xs">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-emerald-200" /> ≥25% Good margin</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-amber-200" /> 10–24% Moderate</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-rose-200" /> &lt;10% Low margin</span>
      </div>
    </div>
  );
}

// ─── Best Sellers Tab ─────────────────────────────────────────────────────────
function BestSellersTab({ start, end }) {
  const { data, isLoading } = useQuery({
    queryKey: ['bestSellers', start, end],
    queryFn: () => api.get('/reports/best-sellers', { params: { start, end } }).then(r => r.data),
  });

  const products = (data?.products ?? data ?? []).slice(0, 10);

  return isLoading ? <Spinner /> : (
    <div className="space-y-5">
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-slate-800">Top Products by Units Sold</h3>
          <ExportButton type="bestsellers" start={start} end={end} />
        </div>
        {products.length === 0
          ? <p className="text-center text-slate-400 py-10">No sales data for this period.</p>
          : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={products} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                <Tooltip formatter={(v, n) => n === 'Revenue' ? formatINR(v) : v} />
                <Legend />
                <Bar dataKey="units_sold" name="Units Sold" fill="#7c3aed" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
      </div>
      <div className="card">
        <h3 className="font-semibold text-slate-800 mb-4">Revenue Breakdown</h3>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr><th>#</th><th>Product</th><th>Units Sold</th><th>Revenue</th></tr>
            </thead>
            <tbody>
              {products.map((p, i) => (
                <tr key={p.product_id ?? i}>
                  <td>
                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold
                      ${i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-slate-100 text-slate-600' : 'bg-slate-50 text-slate-400'}`}>
                      {i + 1}
                    </span>
                  </td>
                  <td className="font-medium">{p.name}</td>
                  <td>{p.units_sold}</td>
                  <td className="font-bold text-emerald-700">{formatINR(p.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Material Usage Tab ───────────────────────────────────────────────────────
function MaterialUsageTab({ start, end }) {
  const { data, isLoading } = useQuery({
    queryKey: ['materialUsage', start, end],
    queryFn: () => api.get('/reports/material-usage', { params: { start, end } }).then(r => r.data),
  });
  const items = data?.materials ?? data ?? [];
  return isLoading ? <Spinner /> : (
    <div className="card">
      <div className="card-header">
        <h3 className="font-semibold text-slate-800">Material Usage Report</h3>
        <ExportButton type="material-usage" start={start} end={end} />
      </div>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr><th>Material</th><th>Category</th><th>Total Used</th><th>Unit</th><th>Total Cost</th></tr>
          </thead>
          <tbody>
            {items.length === 0
              ? <tr><td colSpan={5} className="text-center text-slate-400 py-10">No usage data for this period.</td></tr>
              : items.map((m, i) => (
                <tr key={m.material_id ?? i}>
                  <td className="font-medium">{m.name}</td>
                  <td><span className="badge bg-slate-100 text-slate-600">{m.category}</span></td>
                  <td className="font-semibold">{m.total_used?.toFixed(2)}</td>
                  <td className="text-slate-500">{m.unit}</td>
                  <td className="font-bold text-emerald-700">{formatINR(m.total_cost)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Worker Productivity Tab ──────────────────────────────────────────────────
function WorkerProductivityTab({ start, end }) {
  const { data, isLoading } = useQuery({
    queryKey: ['workerProductivity', start, end],
    queryFn: () => api.get('/reports/worker-productivity', { params: { start, end } }).then(r => r.data),
  });
  const workers = data?.workers ?? data ?? [];
  return isLoading ? <Spinner /> : (
    <div className="space-y-5">
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-slate-800">Worker Productivity</h3>
          <ExportButton type="worker-productivity" start={start} end={end} />
        </div>
        {workers.length === 0
          ? <p className="text-center text-slate-400 py-10">No productivity data.</p>
          : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={workers} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="pieces" name="Pieces" fill="#7c3aed" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
      </div>
      <div className="card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr><th>Worker</th><th>Pieces</th><th>Defects</th><th>Defect Rate</th><th>Labor Cost</th><th>Avg/Piece</th></tr>
            </thead>
            <tbody>
              {workers.length === 0
                ? <tr><td colSpan={6} className="text-center text-slate-400 py-8">No data.</td></tr>
                : workers.map(w => {
                  const defectRate = w.pieces > 0 ? (w.defects / w.pieces * 100).toFixed(1) : 0;
                  const avgCost = w.pieces > 0 ? w.labor_cost / w.pieces : 0;
                  return (
                    <tr key={w.worker_id ?? w.name}>
                      <td className="font-medium">{w.name}</td>
                      <td>{w.pieces}</td>
                      <td className={w.defects > 0 ? 'text-rose-600' : ''}>{w.defects ?? 0}</td>
                      <td className={defectRate > 5 ? 'text-rose-600 font-semibold' : 'text-slate-500'}>{defectRate}%</td>
                      <td className="font-bold text-emerald-700">{formatINR(w.labor_cost)}</td>
                      <td className="text-slate-500">{formatINR(avgCost)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const { user } = useAuthStore();
  const [tab, setTab] = useState('overview');
  const [start, setStart] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [end, setEnd] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [showUpgrade, setShowUpgrade] = useState(false);

  const { plan, hasFeature } = usePlan();

  const isAdmin = ['owner', 'admin', 'super_admin'].includes(user?.role);
  if (!isAdmin) {
    return (
      <div className="card text-center py-16">
        <p className="text-4xl mb-3">🔒</p>
        <p className="text-slate-600 font-medium">Admin access required.</p>
      </div>
    );
  }

  const TAB_LABELS = {
    overview: '📊 Overview',
    margins: '💹 Profit Margins',
    bestsellers: '🏆 Best Sellers',
    materials: '🧵 Material Usage',
    workers: '👥 Worker Productivity',
  };

  const handleTabClick = (t) => {
    if (t !== 'overview' && !hasFeature('full_reports')) {
      setShowUpgrade(true);
    } else {
      setTab(t);
    }
  };

  const tabProps = { start, end };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Reports & Analytics</h1>
        <p className="text-slate-500 text-sm mt-0.5">Business intelligence for your crochet operations</p>
      </div>

      {/* Date Range */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-sm font-medium text-slate-700">Date Range:</span>
          <div className="flex items-center gap-2">
            <input type="date" className="input w-40" value={start} onChange={e => setStart(e.target.value)} />
            <span className="text-slate-400">to</span>
            <input type="date" className="input w-40" value={end} onChange={e => setEnd(e.target.value)} />
          </div>
          <div className="flex gap-2 ml-auto">
            {[
              { label: '7d', days: 7 }, { label: '30d', days: 30 },
              { label: '90d', days: 90 }, { label: '1y', days: 365 },
            ].map(({ label, days }) => (
              <button key={label} onClick={() => { setStart(format(subDays(new Date(), days), 'yyyy-MM-dd')); setEnd(format(new Date(), 'yyyy-MM-dd')); }}
                className="btn-secondary btn-sm">{label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto">
        {TABS.map(t => {
          const isLocked = t !== 'overview' && !hasFeature('full_reports');
          return (
            <TabButton
              key={t}
              tab={t}
              active={tab === t}
              label={
                <span className="flex items-center gap-1">
                  {TAB_LABELS[t]}
                  {isLocked && <span className="text-[10px] bg-amber-100 text-amber-800 px-1 rounded">🔒</span>}
                </span>
              }
              onClick={() => handleTabClick(t)}
            />
          );
        })}
      </div>

      {tab === 'overview' && <OverviewTab {...tabProps} />}
      {tab === 'margins' && <MarginsTab {...tabProps} />}
      {tab === 'bestsellers' && <BestSellersTab {...tabProps} />}
      {tab === 'materials' && <MaterialUsageTab {...tabProps} />}
      {tab === 'workers' && <WorkerProductivityTab {...tabProps} />}

      {showUpgrade && (
        <UpgradePrompt
          onClose={() => setShowUpgrade(false)}
          title="Full Reports Locked"
          message="Detailed analytics and reports are only available on Growth and Business plans. Upgrade now to view margins, best sellers, and team productivity."
        />
      )}
    </div>
  );
}
