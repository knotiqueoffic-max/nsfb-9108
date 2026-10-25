import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../api/index';
import { useAuthStore } from '../store/auth';

const PLANS = [
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
      // Redirect public guests to signup with preselected plan
      navigate(`/signup?plan=${planId}`);
      return;
    }

    // Gated actions for logged in tenants
    if (planId === 'starter') {
      toast.error('Free starter plan does not require checkout.');
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch mb-20">
          {PLANS.map((plan) => {
            const price = billingCycle === 'monthly' ? plan.price_monthly : plan.price_yearly;
            const isCurrent = currentPlanId === plan.id;
            return (
              <div
                key={plan.id}
                className={`bg-white rounded-3xl p-8 border-2 flex flex-col justify-between relative shadow-sm transition-all duration-300 hover:shadow-md ${
                  plan.popular
                    ? 'border-violet-600 ring-4 ring-violet-500/10 scale-105 z-10'
                    : 'border-slate-100'
                }`}
              >
                {plan.popular && (
                  <span className="absolute -top-4 left-1/2 -translate-x-1/2 bg-violet-600 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider shadow-sm">
                    Most Popular
                  </span>
                )}

                <div>
                  <h3 className="text-xl font-bold text-slate-800">{plan.name}</h3>
                  <p className="text-slate-400 text-xs mt-1 leading-normal">{plan.description}</p>
                  
                  <div className="mt-6 flex items-baseline">
                    <span className="text-4xl font-extrabold text-slate-800">₹{price}</span>
                    <span className="text-slate-400 text-xs ml-1.5">/mo</span>
                  </div>
                  {billingCycle === 'yearly' && (
                    <p className="text-[10px] text-slate-400 font-medium mt-1">Billed ₹{price * 12} annually</p>
                  )}

                  <ul className="mt-8 space-y-3.5 border-t border-slate-100 pt-6">
                    {plan.features.map((f, i) => (
                      <li key={i} className={`flex items-start gap-3.5 text-sm ${f.included ? 'text-slate-600' : 'text-slate-300 line-through'}`}>
                        <span className={`text-xs mt-0.5 ${f.included ? 'text-emerald-500' : 'text-slate-300'}`}>
                          {f.included ? '✓' : '✕'}
                        </span>
                        {f.text}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-8 pt-4">
                  {isCurrent ? (
                    <span className="w-full text-center py-3 text-slate-500 text-sm font-semibold rounded-2xl bg-slate-100 block">
                      Your Current Plan
                    </span>
                  ) : (
                    <button
                      onClick={() => handleAction(plan.id)}
                      disabled={submittingPlan !== null}
                      className={`w-full py-3 rounded-2xl text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${
                        plan.popular
                          ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-md shadow-violet-500/20'
                          : 'bg-slate-800 hover:bg-slate-900 text-white'
                      }`}
                    >
                      {submittingPlan === plan.id ? (
                        <>
                          <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                          Processing…
                        </>
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
