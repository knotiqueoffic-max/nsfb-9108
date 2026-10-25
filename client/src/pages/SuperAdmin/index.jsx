import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import api from '../../api/index';
import { useAuthStore } from '../../store/auth';
import { formatDate } from '../../utils/index';

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
    </div>
  );
}

function OverrideModal({ tenant, onClose }) {
  const qc = useQueryClient();
  const { register, handleSubmit } = useForm({
    defaultValues: {
      plan_id:             tenant.plan_id || 'starter',
      subscription_status: tenant.subscription_status || 'active',
      trial_ends_at:       tenant.trial_ends_at ? tenant.trial_ends_at.split('T')[0] : '',
    },
  });

  const mutation = useMutation({
    mutationFn: (data) => api.put(`/super-admin/tenants/${tenant.id}`, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['super-admin-tenants'] });
      toast.success(`Override applied for ${tenant.name}`);
      onClose();
    },
    onError: (err) => {
      toast.error(err?.response?.data?.error || 'Failed to update tenant.');
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">Manual Plan Override</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">✕</button>
        </div>

        <form onSubmit={handleSubmit(d => mutation.mutate({
          ...d,
          trial_ends_at: d.trial_ends_at ? new Date(d.trial_ends_at).toISOString() : null,
        }))} className="p-6 space-y-4">
          <div>
            <label className="label">Tenant Name</label>
            <input type="text" className="input bg-slate-100 cursor-not-allowed" value={tenant.name} disabled />
          </div>

          <div>
            <label className="label">Override Plan</label>
            <select className="select font-medium" {...register('plan_id')}>
              <option value="starter">Starter Plan (₹499)</option>
              <option value="growth">Growth Plan (₹1,499)</option>
              <option value="business">Business Plan (₹3,499)</option>
            </select>
          </div>

          <div>
            <label className="label">Subscription Status</label>
            <select className="select font-medium" {...register('subscription_status')}>
              <option value="trialing">Trialing</option>
              <option value="active">Active (Paid)</option>
              <option value="past_due">Past Due (Delinquent)</option>
              <option value="canceled">Canceled</option>
              <option value="locked">Locked (Suspended)</option>
            </select>
          </div>

          <div>
            <label className="label">Trial Ending Date (Optional)</label>
            <input type="date" className="input" {...register('trial_ends_at')} />
          </div>

          <div className="flex gap-3 pt-4 border-t border-slate-100">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center py-2.5">
              Cancel
            </button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary flex-1 justify-center py-2.5">
              {mutation.isPending ? 'Saving…' : 'Apply Override'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function SuperAdminPage() {
  const { user } = useAuthStore();
  const [overrideTenant, setOverrideTenant] = useState(null);

  const { data: tenantsData, isLoading } = useQuery({
    queryKey: ['super-admin-tenants'],
    queryFn: () => api.get('/super-admin/tenants').then(r => r.data),
    enabled: user?.role === 'super_admin',
  });

  if (user?.role !== 'super_admin') {
    return (
      <div className="card text-center py-16">
        <p className="text-4xl mb-3">🔒</p>
        <p className="text-slate-600 font-medium">Access Denied: Super Admin account required.</p>
      </div>
    );
  }

  const tenants = tenantsData ?? [];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Platform Management</h1>
          <p className="text-slate-500 text-sm mt-0.5">SaaS Super-Admin Console</p>
        </div>
        <div className="bg-purple-100 border border-purple-200 text-purple-800 px-3 py-1.5 rounded-full text-xs font-semibold">
          👑 Super Admin Access
        </div>
      </div>

      {/* Overview stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Companies', value: tenants.length, icon: '🏢', color: 'text-violet-600 bg-violet-50' },
          { label: 'Active Subscriptions', value: tenants.filter(t => t.subscription_status === 'active').length, icon: '💳', color: 'text-emerald-600 bg-emerald-50' },
          { label: 'Trialing Companies', value: tenants.filter(t => t.subscription_status === 'trialing').length, icon: '⏳', color: 'text-amber-600 bg-amber-50' },
          { label: 'Locked/Suspended', value: tenants.filter(t => t.subscription_status === 'locked').length, icon: '🔒', color: 'text-rose-600 bg-rose-50' },
        ].map(card => (
          <div key={card.label} className="card p-5 flex items-center gap-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl ${card.color}`}>
              {card.icon}
            </div>
            <div>
              <p className="text-xs text-slate-400 font-semibold">{card.label}</p>
              <h3 className="text-2xl font-black text-slate-800 mt-1">{card.value}</h3>
            </div>
          </div>
        ))}
      </div>

      {/* Tenants Table */}
      <div className="card">
        <div className="card-header border-b border-slate-100 pb-4 mb-4">
          <h3 className="font-bold text-slate-800">All Registered Workspaces</h3>
        </div>

        {isLoading ? <Spinner /> : tenants.length === 0 ? (
          <p className="text-center text-slate-400 py-12">No workspaces found.</p>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Company (ID)</th>
                  <th>Slug</th>
                  <th>Owner</th>
                  <th>Active Plan</th>
                  <th>Status</th>
                  <th>Trial Ends</th>
                  <th>Usage (Workers/Products)</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map(t => (
                  <tr key={t.id}>
                    <td>
                      <p className="font-bold text-slate-800 leading-snug">{t.name}</p>
                      <p className="text-[10px] text-slate-400 font-mono">ID: {t.id} • Category: {t.business_category || 'N/A'}</p>
                    </td>
                    <td className="text-xs font-mono text-slate-500">{t.slug}</td>
                    <td>
                      <p className="font-medium text-slate-700 leading-snug">{t.owner_name || 'System Generated'}</p>
                      <p className="text-xs text-slate-400 font-mono">{t.owner_email || '—'}</p>
                    </td>
                    <td>
                      <span className="badge bg-purple-50 text-purple-700 capitalize font-semibold">
                        {t.plan_name || t.plan_id}
                      </span>
                    </td>
                    <td>
                      <span className={`badge uppercase text-[10px] font-bold ${
                        t.subscription_status === 'active'
                          ? 'bg-emerald-50 text-emerald-700'
                          : t.subscription_status === 'trialing'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-rose-50 text-rose-700'
                      }`}>
                        {t.subscription_status}
                      </span>
                    </td>
                    <td className="text-xs text-slate-500 font-mono">
                      {t.trial_ends_at ? formatDate(t.trial_ends_at) : 'Paid / Unlimited'}
                    </td>
                    <td className="text-xs font-semibold text-slate-600">
                      👷 {t.workers_count} / 🧸 {t.products_count}
                    </td>
                    <td>
                      <button
                        onClick={() => setOverrideTenant(t)}
                        className="bg-violet-50 hover:bg-violet-100 text-violet-700 text-xs font-bold px-3 py-1.5 rounded-xl border border-violet-200 transition-colors"
                      >
                        Override Plan
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {overrideTenant && (
        <OverrideModal
          tenant={overrideTenant}
          onClose={() => setOverrideTenant(null)}
        />
      )}
    </div>
  );
}
