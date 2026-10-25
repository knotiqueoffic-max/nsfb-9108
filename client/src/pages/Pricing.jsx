import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
    description: 'Risk-free full access to Knotique. Just sign in to start.',
    features: [
      { text: '14-Day full access', included: true },
      { text: 'Up to 2 workers', included: true },
      { text: 'Up to 50 products', included: true },
      { text: '1 sales platform link', included: true },
      { text: 'Basic reports & analytics', included: true },
      { text: 'Manual orders log', included: true },
      { text: 'No credit card required', included: true },
      { text: 'CSV order imports', included: false },
      { text: 'Payout automation', included: false },
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    price_monthly: 499,
    price_yearly: 399, // ₹399/mo billed yearly
    description: 'Perfect for single artisans starting out.',
    features: [
      { text: 'Up to 2 workers', included: true },
      { text: 'Up to 50 products', included: true },
      { text: '1 sales platform link', included: true },
      { text: 'Basic reports & analytics', included: true },
      { text: 'Manual orders log', included: true },
      { text: 'CSV order imports', included: false },
      { text: 'Payout automation', included: false },
      { text: 'Low stock alerts', included: false },
      { text: 'Packing slip PDFs', included: false },
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    price_monthly: 1499,
    price_yearly: 1199, // ₹1199/mo billed yearly
    description: 'Great for growing craft workshops.',
    features: [
      { text: 'Up to 10 workers', included: true },
      { text: 'Up to 500 products', included: true },
      { text: 'Up to 3 sales platforms', included: true },
      { text: 'Full reports & analytics', included: true },
      { text: 'Manual orders log', included: true },
      { text: 'CSV order imports', included: true },
      { text: 'Payout automation', included: true },
      { text: 'Low stock alerts', included: true },
      { text: 'Packing slip PDFs', included: false },
    ],
    popular: true,
  },
  {
    id: 'business',
    name: 'Business',
    price_monthly: 3499,
    price_yearly: 2799, // ₹2799/mo billed yearly
    description: 'Unlimited capacity for full production.',
    features: [
      { text: 'Unlimited workers', included: true },
      { text: 'Unlimited products', included: true },
      { text: 'Unlimited platforms', included: true },
      { text: 'Full reports & exports', included: true },
      { text: 'Manual orders log', included: true },
      { text: 'CSV order imports', included: true },
      { text: 'Payout automation', included: true },
      { text: 'Low stock alerts', included: true },
      { text: 'Packing slip PDFs', included: true },
    ],
  },
];

export default function PricingPage() {
  const navigate = useNavigate();
  const { user, updateUser } = useAuthStore();
  const qc = useQueryClient();
  const [billingCycle, setBillingCycle] = useState('monthly'); // monthly | yearly
  const [submittingPlan, setSubmittingPlan] = useState(null);

  const { data: usageData } = useQuery({
    queryKey: ['tenant-usage'],
    queryFn: () => api.get('/tenants/me/usage').then(r => r.data),
    enabled: !!user,
  });

  const currentPlanId = usageData?.plan?.id;

  const subscribeMutation = useMutation({
    mutationFn: (planId) => api.post('/billing/subscribe', { plan_id: planId }).then(r => r.data),
    onSuccess: (data, planId) => {
      // Free trial instant activation
      if (data.isFreeTrial) {
        updateUser(data.tenant);
        qc.invalidateQueries({ queryKey: ['tenant-usage'] });
        setSubmittingPlan(null);
        toast.success(data.message || '14-Day Free Trial activated! Enjoy full access.');
        navigate('/');
        return;
      }

      // Direct payment simulation in dev mode / mock mode
      toast.success('Simulating subscription checkout...');
      setTimeout(() => {
        api.post('/billing/verify-payment', {
          razorpay_payment_id:      `pay_mock_${Math.random().toString(36).substr(2, 9)}`,
          razorpay_subscription_id: data.subscriptionId,
          plan_id:                  planId,
        }).then(res => {
          updateUser(res.data.tenant);
          qc.invalidateQueries({ queryKey: ['tenant-usage'] });
          setSubmittingPlan(null);
          toast.success('Plan activated successfully!');
          navigate('/billing');
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
      // Demands login/signup for guests: redirect to signup with preselected plan
      navigate(`/signup?plan=${planId}`);
      return;
    }

    setSubmittingPlan(planId);
    subscribeMutation.mutate(planId);
  };

  return (
    <div className="py-12 bg-slate-50 min-h-screen">
      <div className="max-w-6xl mx-auto px-6">
        {/* Header */}
        <div className="text-center space-y-4 max-w-xl mx-auto mb-16">
          <h1 className="text-4xl font-extrabold text-slate-800 tracking-tight">
            Plans built for workshops of all sizes
          </h1>
          <p className="text-slate-500 text-sm leading-relaxed">
            Choose a pricing model that fits your operations. All premium tiers start with a 14-day free trial.
          </p>

          {/* Monthly / Yearly Toggle */}
          <div className="inline-flex items-center gap-1 p-1 bg-slate-200 rounded-xl mt-6">
            <button
              onClick={() => setBillingCycle('monthly')}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
                billingCycle === 'monthly' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Billed Monthly
            </button>
            <button
              onClick={() => setBillingCycle('yearly')}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                billingCycle === 'yearly' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Billed Yearly
              <span className="text-[9px] bg-emerald-100 text-emerald-800 px-1 py-0.5 rounded-full font-black">
                Save 20%
              </span>
            </button>
          </div>
        </div>

        {/* Pricing Cards Grid */}
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
                  <p className="text-slate-400 text-xs mt-1 leading-normal min-h-[32px]">{plan.description}</p>
                  
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
                    <p className="text-[10px] text-emerald-600 font-semibold mt-1">Requires only sign in · No card needed</p>
                  ) : billingCycle === 'yearly' ? (
                    <p className="text-[10px] text-slate-400 font-medium mt-1">Billed ₹{price * 12} annually</p>
                  ) : (
                    <p className="text-[10px] text-slate-400 font-medium mt-1">Standard monthly billing</p>
                  )}

                  <ul className="mt-6 space-y-3 border-t border-slate-100 pt-5">
                    {plan.features.map((f, i) => (
                      <li key={i} className={`flex items-start gap-2.5 text-xs ${f.included ? 'text-slate-600' : 'text-slate-300 line-through'}`}>
                        <span className={`text-xs mt-0.5 ${f.included ? 'text-emerald-500 font-bold' : 'text-slate-300'}`}>
                          {f.included ? '✓' : '✕'}
                        </span>
                        {f.text}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-6 pt-3">
                  {isCurrent ? (
                    <span className="w-full text-center py-2.5 text-slate-500 text-xs font-semibold rounded-2xl bg-slate-100 block">
                      Your Current Plan
                    </span>
                  ) : (
                    <button
                      onClick={() => handleAction(plan.id)}
                      disabled={submittingPlan !== null}
                      className={`w-full py-2.5 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
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

        {/* FAQs */}
        <div className="max-w-3xl mx-auto space-y-6">
          <h2 className="text-2xl font-bold text-center text-slate-800 mb-8">Frequently Asked Questions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              { q: 'Can I cancel my subscription anytime?', a: 'Yes! You can cancel your premium subscription at any time. Your workspace limits will revert to the Starter plan cycles instantly.' },
              { q: 'Is there a free trial?', a: 'Absolutely. Growth and Business plans come with a 14-day free trial. No card is charged until the trial period expires.' },
              { q: 'How is data separation handled?', a: 'Knotique uses tenant database scoping logic to guarantee your catalog, materials, sales orders, and payouts are completely invisible to other companies.' },
              { q: 'What happens if I reach my plan limit?', a: 'If you exceed your worker or product limits, we will prompt you to upgrade. Rest assured, your existing workspace data remains intact.' },
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
