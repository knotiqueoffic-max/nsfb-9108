import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../api/index';
import { useAuthStore } from '../store/auth';

const PLANS = [
  {
    id: 'free_trial',
    name: '14-Day Free Trial',
    price_monthly: 0,
    price_yearly: 0,
    badge: '14 Days Free',
    description: 'Risk-free full access to all Knotique tools. Start creating right away.',
    features: [
      { text: '14-Day full platform access', included: true },
      { text: 'Up to 2 workers / crocheters', included: true },
      { text: 'Up to 50 products & materials', included: true },
      { text: '1 sales platform link', included: true },
      { text: 'Production requests & bidding', included: true },
      { text: 'Worker photo/video submissions', included: true },
      { text: 'Manual orders log & basic reports', included: true },
      { text: 'No credit card required', included: true },
      { text: 'Bulk CSV imports & exports', included: false },
      { text: 'Automated piece-rate payouts', included: false },
      { text: 'Packing slip PDF generation', included: false },
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    price_monthly: 499,
    price_yearly: 399, // ₹399/mo billed yearly
    description: 'Perfect for independent artisans and single-workshop operations.',
    features: [
      { text: 'Up to 2 workers / crocheters', included: true },
      { text: 'Up to 50 products & materials', included: true },
      { text: '1 sales platform link', included: true },
      { text: 'Production requests & bidding', included: true },
      { text: 'Worker photo/video submissions', included: true },
      { text: 'Basic reports & margin tracking', included: true },
      { text: 'Manual orders log', included: true },
      { text: 'Low stock alerts', included: false },
      { text: 'Bulk CSV imports & exports', included: false },
      { text: 'Automated piece-rate payouts', included: false },
      { text: 'Packing slip PDF generation', included: false },
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    price_monthly: 1499,
    price_yearly: 1199, // ₹1199/mo billed yearly
    description: 'Best for growing craft studios, expanding supply vendors, and regional hubs.',
    features: [
      { text: 'Up to 10 workers / crocheters', included: true },
      { text: 'Up to 500 products & materials', included: true },
      { text: 'Up to 3 sales platforms', included: true },
      { text: 'Production requests & bidding', included: true },
      { text: 'Worker photo/video submissions', included: true },
      { text: 'Full reports, COGS & analytics', included: true },
      { text: 'CSV order imports', included: true },
      { text: 'Automated piece-rate payouts', included: true },
      { text: 'Low stock alerts', included: true },
      { text: 'Packing slip PDF generation', included: false },
    ],
    popular: true,
  },
  {
    id: 'business',
    name: 'Business',
    price_monthly: 3499,
    price_yearly: 2799, // ₹2799/mo billed yearly
    description: 'Unlimited capacity for full production lines, large vendor networks, and brands.',
    features: [
      { text: 'Unlimited workers / crocheters', included: true },
      { text: 'Unlimited products & materials', included: true },
      { text: 'Unlimited sales platforms', included: true },
      { text: 'Production requests & bidding', included: true },
      { text: 'Worker photo/video submissions', included: true },
      { text: 'Full reports, analytics & Excel exports', included: true },
      { text: 'CSV order imports', included: true },
      { text: 'Automated piece-rate payouts', included: true },
      { text: 'Low stock alerts', included: true },
      { text: 'Packing slip PDF generation', included: true },
    ],
  },
];

export default function PricingPage({ isPostSignup = false }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, updateUser } = useAuthStore();
  const qc = useQueryClient();

  const isPostSignupMode = isPostSignup || searchParams.get('post_signup') === 'true' || searchParams.get('welcome') === 'true';
  const [billingCycle, setBillingCycle] = useState('monthly'); // monthly | yearly
  const [submittingPlan, setSubmittingPlan] = useState(null);

  const { data: usageData, isLoading: isUsageLoading } = useQuery({
    queryKey: ['tenant-usage'],
    queryFn: () => api.get('/tenants/me/usage').then((r) => r.data),
    enabled: !!user,
  });

  const currentPlanId = usageData?.plan?.id || user?.plan_id;
  const isWorkerRole = user?.role === 'worker' || user?.role === 'crocheter';

  const subscribeMutation = useMutation({
    mutationFn: (planId) => api.post('/billing/subscribe', { plan_id: planId }).then((r) => r.data),
    onSuccess: (data, planId) => {
      // Free trial instant activation
      if (data.isFreeTrial) {
        if (data.tenant) updateUser(data.tenant);
        qc.invalidateQueries({ queryKey: ['tenant-usage'] });
        setSubmittingPlan(null);
        toast.success(data.message || '14-Day Free Trial activated! Welcome aboard.');
        navigate('/');
        return;
      }

      // Payment simulation / Razorpay checkout
      toast.success('Simulating subscription checkout...');
      setTimeout(() => {
        api
          .post('/billing/verify-payment', {
            razorpay_payment_id: `pay_mock_${Math.random().toString(36).substring(2, 11)}`,
            razorpay_subscription_id: data.subscriptionId || `sub_mock_${Date.now()}`,
            plan_id: planId,
          })
          .then((res) => {
            if (res.data?.tenant) updateUser(res.data.tenant);
            qc.invalidateQueries({ queryKey: ['tenant-usage'] });
            setSubmittingPlan(null);
            toast.success('Plan activated successfully!');
            navigate('/billing');
          })
          .catch((err) => {
            setSubmittingPlan(null);
            toast.error(err?.response?.data?.error || 'Payment verification failed.');
          });
      }, 1000);
    },
    onError: (err) => {
      setSubmittingPlan(null);
      toast.error(err?.response?.data?.error || 'Subscription initiation failed.');
    },
  });

  const handleAction = (planId) => {
    if (!user) {
      // Redirect to signup with preselected role/plan
      navigate(`/signup?plan=${planId}`);
      return;
    }

    if (isWorkerRole) {
      toast.error('Worker accounts are managed by your administrator and do not require a subscription.');
      return;
    }

    setSubmittingPlan(planId);
    subscribeMutation.mutate(planId);
  };

  return (
    <div className="py-12 bg-slate-50 min-h-screen">
      <div className="max-w-6xl mx-auto px-6">
        {/* Post-Signup Welcome Banner */}
        {isPostSignupMode && (
          <div className="mb-10 p-6 rounded-3xl bg-gradient-to-r from-violet-600 to-indigo-700 text-white shadow-xl shadow-violet-500/10 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 text-white text-xs font-bold uppercase tracking-wider mb-2">
                <span>Step 2 of 2</span>
                <span>•</span>
                <span>Workspace Created</span>
              </div>
              <h2 className="text-2xl font-bold">
                Welcome to Knotique{user?.name ? `, ${user.name}` : ''}!
              </h2>
              <p className="text-violet-100 text-sm mt-1 max-w-xl">
                Your <span className="font-bold underline uppercase">{user?.role || 'Admin'}</span> workspace is now initialized. Every account starts with a 14-day free trial on us, or you can select a plan below.
              </p>
            </div>
            <button
              onClick={() => handleAction('free_trial')}
              disabled={submittingPlan !== null}
              className="px-6 py-3 rounded-2xl bg-white text-violet-700 hover:bg-violet-50 font-bold text-sm shadow-md whitespace-nowrap transition-all cursor-pointer"
            >
              {submittingPlan === 'free_trial' ? 'Activating…' : 'Continue with Free Trial →'}
            </button>
          </div>
        )}

        {/* Worker Notice Banner */}
        {isWorkerRole && (
          <div className="mb-8 p-6 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 flex items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-amber-950">Crocheter / Worker Account Detected</h3>
              <p className="text-xs text-amber-800 mt-1">
                Your account is linked to your employer or contracting vendor workspace. You do not need to purchase or manage a subscription.
              </p>
            </div>
            <Link
              to="/production-requests"
              className="btn-primary text-xs whitespace-nowrap px-4 py-2"
            >
              Go to Production Requests →
            </Link>
          </div>
        )}

        {/* Header & Role Badge */}
        <div className="text-center space-y-4 max-w-2xl mx-auto mb-16">
          {user && (
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-violet-100 text-violet-800 text-xs font-bold uppercase tracking-wider shadow-xs">
              <span>Account Role: <strong className="font-extrabold">{user.role}</strong></span>
              <span className="text-violet-400">•</span>
              <span className="text-violet-600 font-semibold">Permanent</span>
            </div>
          )}

          <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">
            Plans built for workshops of all sizes
          </h1>
          <p className="text-slate-500 text-sm leading-relaxed">
            Transparent pricing for Admins, Vendors, and Sub-Vendors. Choose the plan that fits your production scale. All plans include our 14-day free trial.
          </p>

          {/* Monthly / Yearly Billing Toggle */}
          <div className="inline-flex items-center gap-1 p-1 bg-slate-200 rounded-xl mt-6">
            <button
              onClick={() => setBillingCycle('monthly')}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
                billingCycle === 'monthly'
                  ? 'bg-white text-slate-800 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Billed Monthly
            </button>
            <button
              onClick={() => setBillingCycle('yearly')}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                billingCycle === 'yearly'
                  ? 'bg-white text-slate-800 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Billed Yearly
              <span className="text-[9px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-full font-black">
                Save 20%
              </span>
            </button>
          </div>
        </div>

        {/* Pricing Cards Grid */}
        {user && isUsageLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch mb-20 animate-pulse">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white rounded-3xl p-7 border border-slate-200 h-96 flex flex-col justify-between">
                <div>
                  <div className="h-6 w-24 bg-slate-200 rounded-md mb-2"></div>
                  <div className="h-4 w-40 bg-slate-100 rounded-md mb-6"></div>
                  <div className="h-10 w-28 bg-slate-200 rounded-md mb-6"></div>
                  <div className="space-y-3">
                    <div className="h-3 w-full bg-slate-100 rounded"></div>
                    <div className="h-3 w-5/6 bg-slate-100 rounded"></div>
                    <div className="h-3 w-4/6 bg-slate-100 rounded"></div>
                  </div>
                </div>
                <div className="h-10 w-full bg-slate-200 rounded-2xl"></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch mb-20">
            {PLANS.map((plan) => {
              const isFree = plan.price_monthly === 0;
              const price = billingCycle === 'monthly' ? plan.price_monthly : plan.price_yearly;
              const isCurrent = currentPlanId === plan.id;

              return (
                <div
                  key={plan.id}
                  className={`bg-white rounded-3xl p-7 border-2 flex flex-col justify-between relative shadow-xs transition-all duration-300 hover:shadow-md ${
                    plan.id === 'free_trial'
                      ? 'border-emerald-500 ring-2 ring-emerald-500/10'
                      : plan.popular
                      ? 'border-violet-600 ring-4 ring-violet-500/10 scale-102 z-10'
                      : 'border-slate-100'
                  }`}
                >
                  {plan.popular ? (
                    <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-violet-600 text-white text-[11px] font-bold px-3 py-0.5 rounded-full uppercase tracking-wider shadow-sm">
                      Most Popular
                    </span>
                  ) : plan.id === 'free_trial' ? (
                    <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-emerald-600 text-white text-[11px] font-bold px-3 py-0.5 rounded-full uppercase tracking-wider shadow-sm">
                      14 Days Free
                    </span>
                  ) : null}

                  <div>
                    <h3 className="text-xl font-bold text-slate-800">{plan.name}</h3>
                    <p className="text-slate-400 text-xs mt-1 leading-normal min-h-[32px]">
                      {plan.description}
                    </p>

                    <div className="mt-5 flex items-baseline">
                      {isFree ? (
                        <>
                          <span className="text-4xl font-extrabold text-slate-800">₹0</span>
                          <span className="text-emerald-600 font-bold text-xs ml-2">/ 14 Days Free</span>
                        </>
                      ) : (
                        <>
                          <span className="text-4xl font-extrabold text-slate-800">₹{price}</span>
                          <span className="text-slate-400 text-xs ml-1.5">/mo</span>
                        </>
                      )}
                    </div>
                    {isFree ? (
                      <p className="text-[10px] text-emerald-600 font-semibold mt-1">
                        Requires only sign in · No card needed
                      </p>
                    ) : billingCycle === 'yearly' ? (
                      <p className="text-[10px] text-slate-400 font-medium mt-1">
                        Billed ₹{price * 12} annually
                      </p>
                    ) : (
                      <p className="text-[10px] text-slate-400 font-medium mt-1">
                        Standard monthly billing
                      </p>
                    )}

                    <ul className="mt-6 space-y-3 border-t border-slate-100 pt-5">
                      {plan.features.map((f, i) => (
                        <li
                          key={i}
                          className={`flex items-start gap-2.5 text-xs ${
                            f.included ? 'text-slate-600' : 'text-slate-300 line-through'
                          }`}
                        >
                          <span
                            className={`text-xs mt-0.5 ${
                              f.included ? 'text-emerald-500 font-bold' : 'text-slate-300'
                            }`}
                          >
                            {f.included ? '✓' : '✕'}
                          </span>
                          {f.text}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-6 pt-3">
                    {isCurrent ? (
                      <span className="w-full text-center py-2.5 text-emerald-700 bg-emerald-50 border border-emerald-200 text-xs font-bold rounded-2xl block">
                        ✓ Your Current Plan
                      </span>
                    ) : (
                      <button
                        onClick={() => handleAction(plan.id)}
                        disabled={submittingPlan !== null || isWorkerRole}
                        className={`w-full py-2.5 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                          plan.id === 'free_trial'
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-500/20'
                            : plan.popular
                            ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-md shadow-violet-500/20'
                            : 'bg-slate-800 hover:bg-slate-900 text-white'
                        }`}
                      >
                        {submittingPlan === plan.id ? (
                          <>
                            <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                            Activating…
                          </>
                        ) : plan.id === 'free_trial' ? (
                          user ? 'Activate 14-Day Free Trial' : 'Start 14-Day Free Trial'
                        ) : (
                          `Choose ${plan.name}`
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* FAQs */}
        <div className="max-w-3xl mx-auto space-y-6">
          <h2 className="text-2xl font-bold text-center text-slate-800 mb-8">
            Frequently Asked Questions
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              {
                q: 'Do Admins, Vendors, and Sub-Vendors get the same plans?',
                a: 'Yes! All workspace accounts (Admin, Vendor, Sub-Vendor) enjoy the exact same unified subscription tiers and pricing models.',
              },
              {
                q: 'Can I cancel my subscription anytime?',
                a: 'Yes, you can cancel your subscription at any time directly from the Billing tab. Your limits will remain active until the end of your billing cycle.',
              },
              {
                q: 'Do workers / crocheters pay for a subscription?',
                a: 'No. Crocheters and production workers are invited by their Admins, Vendors, or Sub-Vendors and never need to pay for a subscription.',
              },
              {
                q: 'How is data separation handled across organizations?',
                a: 'Knotique enforces strict database tenant isolation. Your orders, bids, worker payouts, and materials remain 100% private and protected.',
              },
            ].map((faq, i) => (
              <div key={i} className="card p-5 bg-white border border-slate-100 rounded-2xl">
                <h4 className="font-bold text-slate-800 text-sm">{faq.q}</h4>
                <p className="text-slate-500 text-xs mt-2 leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
