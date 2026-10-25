import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../../api/index';
import { useAuthStore } from '../../store/auth';
import { formatCurrency, formatDate } from '../../utils/index';

const PLANS = [
  {
    id: 'free_trial',
    name: '14-Day Free Trial',
    price: 0,
    description: '14 days of free access. No payment card required.',
    features: ['Up to 2 workers', 'Up to 50 products', '1 sales platform link', 'Basic reports & production tracking', 'No credit card needed'],
    badge: 'Free Trial',
  },
  {
    id: 'starter',
    name: 'Starter',
    price: 499,
    description: 'Perfect for single artisans starting out.',
    features: ['Up to 2 workers', 'Up to 50 products', '1 sales platform link', 'Basic reports', 'Manual orders'],
  },
  {
    id: 'growth',
    name: 'Growth',
    price: 1499,
    description: 'Great for growing craft workshops.',
    features: [
      'Up to 10 workers',
      'Up to 500 products',
      'Up to 3 sales platforms',
      'Full reports & export',
      'CSV order imports',
      'Payout automation',
      'Low stock alerts',
    ],
    popular: true,
  },
  {
    id: 'business',
    name: 'Business',
    price: 3499,
    description: 'Unlimited capacity for full production.',
    features: [
      'Unlimited workers',
      'Unlimited products',
      'Unlimited platforms',
      'Full reports & exports',
      'CSV order imports',
      'Payout automation',
      'Low stock alerts',
      'Bulk imports & actions',
      'Packing slip PDF generation',
      'Excel exports',
    ],
  },
];

export default function BillingPage() {
  const { user, updateUser } = useAuthStore();
  const qc = useQueryClient();
  const [submittingPlan, setSubmittingPlan] = useState(null);

  // Load Razorpay script
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  // Fetch current tenant usage & billing status
  const { data: usageData, isLoading: isUsageLoading } = useQuery({
    queryKey: ['tenant-usage'],
    queryFn: () => api.get('/tenants/me/usage').then(r => r.data),
  });

  // Fetch invoices history
  const { data: invoicesData, isLoading: isInvoicesLoading } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => api.get('/billing/invoices').then(r => r.data),
    enabled: ['owner', 'super_admin'].includes(user?.role),
  });

  // Subscribe mutation
  const subscribeMutation = useMutation({
    mutationFn: (planId) => api.post('/billing/subscribe', { plan_id: planId }).then(r => r.data),
    onSuccess: (data, planId) => {
      if (data.isFreeTrial) {
        updateUser(data.tenant);
        qc.invalidateQueries({ queryKey: ['tenant-usage'] });
        qc.invalidateQueries({ queryKey: ['invoices'] });
        setSubmittingPlan(null);
        toast.success(data.message || '14-Day Free Trial activated successfully! 🎉');
        return;
      }
      handleRazorpayCheckout(data, planId);
    },
    onError: (err) => {
      setSubmittingPlan(null);
      toast.error(err?.response?.data?.error || 'Failed to initiate checkout.');
    },
  });

  // Verify payment mutation
  const verifyMutation = useMutation({
    mutationFn: (payload) => api.post('/billing/verify-payment', payload).then(r => r.data),
    onSuccess: (data) => {
      updateUser(data.tenant); // update local state (plan, status)
      qc.invalidateQueries({ queryKey: ['tenant-usage'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      setSubmittingPlan(null);
      toast.success('Subscription activated successfully! 🎉');
    },
    onError: (err) => {
      setSubmittingPlan(null);
      toast.error(err?.response?.data?.error || 'Payment verification failed.');
    },
  });

  // Cancel subscription mutation
  const cancelMutation = useMutation({
    mutationFn: () => api.post('/billing/cancel').then(r => r.data),
    onSuccess: (data) => {
      updateUser(data.tenant);
      qc.invalidateQueries({ queryKey: ['tenant-usage'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Subscription cancelled. Reverted to Starter plan.');
    },
    onError: (err) => {
      toast.error(err?.response?.data?.error || 'Failed to cancel subscription.');
    },
  });

  const handleRazorpayCheckout = (subData, planId) => {
    // If it's a mock subscription, bypass Razorpay and verify directly
    if (subData.subscriptionId?.startsWith('sub_mock')) {
      toast.success('Mock Checkout: Simulating payment flow...');
      setTimeout(() => {
        verifyMutation.mutate({
          razorpay_payment_id:      `pay_mock_${Math.random().toString(36).substr(2, 9)}`,
          razorpay_subscription_id: subData.subscriptionId,
          plan_id:                  planId,
        });
      }, 1000);
      return;
    }

    const options = {
      key:             subData.key || 'rzp_test_mock_key',
      subscription_id: subData.subscriptionId,
      name:            'Knotique SaaS',
      description:     `${planId.toUpperCase()} Plan Subscription`,
      image:           'https://knotique.com/logo.png',
      handler: function (response) {
        verifyMutation.mutate({
          razorpay_payment_id:      response.razorpay_payment_id,
          razorpay_subscription_id: response.razorpay_subscription_id,
          razorpay_signature:       response.razorpay_signature,
          plan_id:                  planId,
        });
      },
      prefill: {
        name:  user.name,
        email: user.email,
      },
      theme: {
        color: '#7c3aed',
      },
    };

    const rzp = new window.Razorpay(options);
    rzp.open();
  };

  const handleSelectPlan = (planId) => {
    setSubmittingPlan(planId);
    subscribeMutation.mutate(planId);
  };

  const handleCancelSubscription = () => {
    if (window.confirm('Are you sure you want to cancel your subscription? Your workspace limit will downgrade to Starter.')) {
      cancelMutation.mutate();
    }
  };

  const invoices = invoicesData ?? [];
  const currentPlan = usageData?.plan;
  const subscription = usageData?.subscription;

  if (isUsageLoading) {
    return (
      <div className="flex justify-center py-24">
        <div className="w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Billing & Subscriptions</h1>
        <p className="text-slate-500 text-sm mt-0.5">Manage plan payments, invoices, and limits</p>
      </div>

      {/* Subscription Summary Card */}
      <div className="card bg-gradient-to-r from-violet-600 to-indigo-700 text-white rounded-3xl p-6 shadow-lg relative overflow-hidden">
        <div className="absolute top-[-50px] right-[-50px] w-64 h-64 bg-white/10 rounded-full blur-2xl" />
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div>
            <span className="text-xs uppercase tracking-widest text-violet-200 font-bold block mb-1">Current Plan</span>
            <h2 className="text-3xl font-extrabold">{currentPlan?.name || 'Starter'}</h2>
            <p className="text-sm text-violet-100 mt-2">
              Status:{' '}
              <span className="bg-white/20 border border-white/30 text-white capitalize px-2 py-0.5 rounded-full text-xs font-semibold inline-block ml-1">
                {subscription?.status || 'active'}
              </span>
            </p>
            {subscription?.status === 'trialing' && (
              <p className="text-xs text-amber-200 font-semibold mt-2">
                ⏳ Trial ends on {formatDate(subscription?.trial_ends_at)}
              </p>
            )}
          </div>

          <div className="flex gap-3">
            {currentPlan?.id !== 'starter' && (
              <button
                onClick={handleCancelSubscription}
                disabled={cancelMutation.isPending}
                className="bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/30 font-semibold px-5 py-2.5 rounded-2xl text-sm transition-all"
              >
                {cancelMutation.isPending ? 'Cancelling…' : 'Cancel Subscription'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Plan Selection Cards */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-slate-800">Available Plans</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {PLANS.map((plan) => {
            const isCurrent = currentPlan?.id === plan.id;
            const isFree = plan.price === 0;
            return (
              <div
                key={plan.id}
                className={`card rounded-3xl border-2 flex flex-col justify-between p-6 transition-all duration-200 ${
                  plan.id === 'free_trial'
                    ? 'border-emerald-500 ring-2 ring-emerald-500/10'
                    : isCurrent
                    ? 'border-violet-600 shadow-md shadow-violet-500/5 bg-violet-50/10'
                    : 'border-slate-100 hover:border-slate-300'
                }`}
              >
                <div>
                  {plan.popular ? (
                    <span className="bg-violet-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider inline-block mb-3">
                      Best Value
                    </span>
                  ) : plan.id === 'free_trial' ? (
                    <span className="bg-emerald-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider inline-block mb-3">
                      14 Days Free
                    </span>
                  ) : null}
                  <h4 className="text-xl font-bold text-slate-800">{plan.name}</h4>
                  <p className="text-xs text-slate-500 mt-1 leading-snug">{plan.description}</p>
                  
                  <div className="mt-4 flex items-baseline">
                    {isFree ? (
                      <>
                        <span className="text-3xl font-extrabold text-slate-800">₹0</span>
                        <span className="text-emerald-600 font-bold text-xs ml-1">/ 14 Days Free</span>
                      </>
                    ) : (
                      <>
                        <span className="text-3xl font-extrabold text-slate-800">₹{plan.price}</span>
                        <span className="text-slate-400 text-xs ml-1">/mo</span>
                      </>
                    )}
                  </div>

                  <ul className="mt-6 space-y-2 text-sm text-slate-600">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-emerald-500 text-xs mt-0.5 font-bold">✓</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100">
                  {isCurrent ? (
                    <span className="w-full text-center py-2.5 text-slate-500 text-sm font-semibold rounded-2xl bg-slate-100 inline-block">
                      Current Active Plan
                    </span>
                  ) : (
                    <button
                      onClick={() => handleSelectPlan(plan.id)}
                      disabled={submittingPlan !== null}
                      className={`w-full py-2.5 rounded-2xl text-sm font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                        plan.id === 'free_trial'
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                          : plan.popular
                          ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-md shadow-violet-500/20'
                          : 'bg-slate-800 hover:bg-slate-900 text-white'
                      }`}
                    >
                      {submittingPlan === plan.id ? (
                        <>
                          <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin mr-1" />
                          Activating…
                        </>
                      ) : plan.id === 'free_trial' ? (
                        'Activate 14-Day Free Trial'
                      ) : (
                        `Upgrade to ${plan.name}`
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Invoice History */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-slate-800">Payment History</h3>
        <div className="card">
          {isInvoicesLoading ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-3 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
            </div>
          ) : invoices.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-8">No invoice history found.</p>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Invoice Number</th>
                    <th>Date</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Payment ID</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="font-mono text-xs font-semibold">{inv.invoice_number}</td>
                      <td>{formatDate(inv.billing_date)}</td>
                      <td className="font-semibold text-slate-700">₹{(inv.amount / 100).toFixed(2)}</td>
                      <td>
                        <span className="badge bg-emerald-50 text-emerald-600 font-bold">Paid</span>
                      </td>
                      <td className="text-xs text-slate-500 font-mono">{inv.razorpay_payment_id || 'Mock Payment'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
