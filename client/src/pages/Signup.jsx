import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api/index.js';
import { useAuthStore } from '../store/auth';
import GoogleSignInButton from '../components/GoogleSignInButton';

const PLANS = [
  {
    id: 'free_trial',
    name: '14-Day Free Trial',
    price: 0,
    description: 'Full free access for 14 days. Just sign in to start.',
    features: ['14-Day free full access', 'Up to 2 workers', 'Up to 50 products', '1 sales platform link', 'Basic reports & production tracking', 'No credit card needed'],
    badge: 'Free Trial',
  },
  {
    id: 'starter',
    name: 'Starter',
    price: 499,
    description: 'Perfect for single artisans starting out.',
    features: ['Up to 2 workers', 'Up to 50 products', '1 sales platform link', 'Basic reports', 'Manual orders'],
    badge: 'Standard',
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
    badge: 'Popular',
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
    badge: 'Enterprise',
  },
];

const CATEGORIES = [
  'Crochet & Knitting',
  'Embroidery & Sewing',
  'Jewelry & Beading',
  'Woodworking & Pottery',
  'Art & Painting',
  'Home Decor & Candles',
  'Other Handmade Crafts',
];

export default function Signup() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [step, setStep] = useState(1);
  const [selectedPlan, setSelectedPlan] = useState('free_trial');
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    trigger,
    formState: { errors },
  } = useForm({
    defaultValues: {
      name: '',
      email: '',
      password: '',
      company_name: '',
      business_category: 'Crochet & Knitting',
    },
  });

  const mutation = useMutation({
    mutationFn: (data) => api.post('/auth/signup', data).then((r) => r.data),
    onSuccess: ({ token, user }) => {
      login(token, user);
      toast.success(`Welcome to Knotique, ${user.name}! Your workspace is ready.`);
      navigate('/');
    },
    onError: (err) => {
      const msg = err?.response?.data?.error || 'Registration failed. Please try again.';
      toast.error(msg);
    },
  });

  const handleNextStep = async () => {
    let fieldsToValidate = [];
    if (step === 1) {
      fieldsToValidate = ['name', 'email', 'password'];
    } else if (step === 2) {
      fieldsToValidate = ['company_name', 'business_category'];
    }

    const isValid = await trigger(fieldsToValidate);
    if (isValid) {
      setStep((prev) => prev + 1);
    }
  };

  const handlePrevStep = () => {
    setStep((prev) => Math.max(1, prev - 1));
  };

  const onSubmit = (data) => {
    mutation.mutate({
      ...data,
      plan_id: selectedPlan,
    });
  };

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Left Panel — Information & Pricing Preview */}
      <div className="hidden lg:flex lg:w-1/3 bg-gradient-to-br from-violet-800 via-purple-800 to-indigo-900 flex-col justify-between p-12 text-white relative overflow-hidden">
        {/* Background art */}
        <div className="absolute top-[-50px] right-[-50px] w-80 h-80 bg-white/10 rounded-full blur-3xl" />
        <div className="absolute bottom-[-100px] left-[-50px] w-96 h-96 bg-white/5 rounded-full blur-3xl" />

        <div className="relative z-10">
          <Link to="/" className="flex items-center gap-3 mb-12">
            <span className="text-4xl">🧶</span>
            <span className="text-2xl font-extrabold tracking-tight">Knotique SaaS</span>
          </Link>

          <h2 className="text-3xl font-bold mb-6 leading-tight">
            Scale your handmade workshop to new heights
          </h2>

          <div className="space-y-6">
            <div className="flex gap-4">
              <span className="text-2xl">⚡</span>
              <div>
                <h4 className="font-semibold text-white">Separate Tenant Workspace</h4>
                <p className="text-violet-200 text-sm mt-0.5">
                  Complete database isolation. Secure, private, and customizable settings.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <span className="text-2xl">👥</span>
              <div>
                <h4 className="font-semibold text-white">Team & Worker Roles</h4>
                <p className="text-violet-200 text-sm mt-0.5">
                  Assign work, track piece-rate production daily, and automate payroll calculations.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <span className="text-2xl">📈</span>
              <div>
                <h4 className="font-semibold text-white">COGS & Margin Analytics</h4>
                <p className="text-violet-200 text-sm mt-0.5">
                  Know exact materials costs per unit and view recommended pricing across selling channels.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 border-t border-white/20 pt-6">
          <p className="text-violet-200 text-sm italic">
            "We migrated our craft warehouse to Knotique and saved 12 hours a week on worker payouts alone!"
          </p>
          <p className="text-violet-300 text-xs font-semibold mt-2">— Handmade Studio Co.</p>
        </div>
      </div>

      {/* Right Panel — Signup Form */}
      <div className="w-full lg:w-2/3 flex flex-col justify-center items-center p-6 sm:p-12 overflow-y-auto">
        <div className="w-full max-w-2xl">
          {/* Mobile Logo */}
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <span className="text-3xl">🧶</span>
            <span className="text-xl font-bold text-slate-800">Knotique</span>
          </div>

          {/* Stepper Header */}
          <div className="mb-8">
            <div className="flex items-center justify-between max-w-md mx-auto mb-6">
              {[
                { number: 1, label: 'Account' },
                { number: 2, label: 'Company' },
                { number: 3, label: 'Choose Plan' },
              ].map((s) => (
                <div key={s.number} className="flex items-center flex-1 last:flex-none">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 ${
                        step >= s.number
                          ? 'bg-violet-600 text-white shadow-md shadow-violet-500/20'
                          : 'bg-slate-200 text-slate-500'
                      }`}
                    >
                      {step > s.number ? '✓' : s.number}
                    </div>
                    <span
                      className={`text-xs mt-2 font-medium ${
                        step >= s.number ? 'text-violet-600' : 'text-slate-400'
                      }`}
                    >
                      {s.label}
                    </span>
                  </div>
                  {s.number < 3 && (
                    <div
                      className={`flex-1 h-0.5 mx-4 transition-all duration-500 ${
                        step > s.number ? 'bg-violet-600' : 'bg-slate-200'
                      }`}
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="text-center">
              <h2 className="text-2xl font-bold text-slate-800">
                {step === 1 && 'Create your owner account'}
                {step === 2 && 'Set up your company profile'}
                {step === 3 && 'Choose your subscriptions'}
              </h2>
              <p className="text-slate-500 text-sm mt-1">
                {step === 1 && "Let's get started with your personal login details"}
                {step === 2 && 'Give your Knotique workspace a name and custom category'}
                {step === 3 && 'Pick a pricing tier. Every subscription includes a 14-day free trial.'}
              </p>
            </div>
          </div>

          {/* Form */}
          <div className="bg-white rounded-3xl shadow-lg border border-slate-100 p-8">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              {/* Step 1: User Account */}
              {step === 1 && (
                <div className="space-y-5 animate-fade-in">
                  <div className="mb-4">
                    <GoogleSignInButton planId={selectedPlan} />
                  </div>

                  <div className="relative flex py-2 items-center">
                    <div className="flex-grow border-t border-slate-100"></div>
                    <span className="flex-shrink mx-3 text-slate-400 text-[10px] font-bold uppercase tracking-wider">or sign up with email</span>
                    <div className="flex-grow border-t border-slate-100"></div>
                  </div>

                  <div>
                    <label className="label" htmlFor="name">Full Name *</label>
                    <input
                      id="name"
                      type="text"
                      placeholder="Jane Doe"
                      className={`input ${errors.name ? 'border-rose-400' : ''}`}
                      {...register('name', { required: 'Full name is required' })}
                    />
                    {errors.name && <p className="text-rose-500 text-xs mt-1">{errors.name.message}</p>}
                  </div>

                  <div>
                    <label className="label" htmlFor="email">Email address *</label>
                    <input
                      id="email"
                      type="email"
                      placeholder="jane@example.com"
                      className={`input ${errors.email ? 'border-rose-400' : ''}`}
                      {...register('email', {
                        required: 'Email is required',
                        pattern: { value: /^\S+@\S+$/i, message: 'Enter a valid email' },
                      })}
                    />
                    {errors.email && <p className="text-rose-500 text-xs mt-1">{errors.email.message}</p>}
                  </div>

                  <div>
                    <label className="label" htmlFor="password">Password *</label>
                    <div className="relative">
                      <input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Min 6 characters"
                        className={`input pr-11 ${errors.password ? 'border-rose-400' : ''}`}
                        {...register('password', {
                          required: 'Password is required',
                          minLength: { value: 6, message: 'Password must be at least 6 characters' },
                        })}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none p-1 rounded-md transition-colors cursor-pointer"
                        title={showPassword ? 'Hide password' : 'Show password'}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? (
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        )}
                      </button>
                    </div>
                    {errors.password && <p className="text-rose-500 text-xs mt-1">{errors.password.message}</p>}
                  </div>
                </div>
              )}

              {/* Step 2: Company Info */}
              {step === 2 && (
                <div className="space-y-5">
                  <div>
                    <label className="label" htmlFor="company_name">Company / Workshop Name *</label>
                    <input
                      id="company_name"
                      type="text"
                      placeholder="My Crochet Studio"
                      className={`input ${errors.company_name ? 'border-rose-400' : ''}`}
                      {...register('company_name', { required: 'Business name is required' })}
                    />
                    {errors.company_name && (
                      <p className="text-rose-500 text-xs mt-1">{errors.company_name.message}</p>
                    )}
                    <p className="text-xs text-slate-400 mt-1">
                      This is used to customize your workspace, packing slips, and public URL slug.
                    </p>
                  </div>

                  <div>
                    <label className="label" htmlFor="business_category">Business Category *</label>
                    <select
                      id="business_category"
                      className="select"
                      {...register('business_category', { required: true })}
                    >
                      {CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Step 3: Plan Selection */}
              {step === 3 && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {PLANS.map((plan) => {
                      const isSelected = selectedPlan === plan.id;
                      return (
                        <div
                          key={plan.id}
                          onClick={() => setSelectedPlan(plan.id)}
                          className={`relative cursor-pointer rounded-2xl p-5 border-2 transition-all duration-200 hover:shadow-md flex flex-col justify-between ${
                            isSelected
                              ? 'border-violet-600 bg-violet-50/30'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          {plan.popular && (
                            <span className="absolute -top-3 right-4 bg-violet-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                              Popular
                            </span>
                          )}
                          <div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">
                              {plan.badge}
                            </span>
                            <h3 className="font-bold text-slate-800 text-lg leading-tight">{plan.name}</h3>
                            <p className="text-xs text-slate-500 mt-1 leading-snug">{plan.description}</p>
                          </div>

                          <div className="mt-4 pt-4 border-t border-slate-100">
                            <div className="flex items-baseline">
                              <span className="text-2xl font-extrabold text-slate-800">₹{plan.price}</span>
                              <span className="text-slate-400 text-xs ml-1">/mo</span>
                            </div>
                            <p className="text-[10px] text-emerald-600 font-semibold mt-1">14-Day Free Trial</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Plan Features detail */}
                  <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-widest mb-3">
                      Included in the {PLANS.find((p) => p.id === selectedPlan)?.name} plan:
                    </h4>
                    <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm text-slate-600">
                      {PLANS.find((p) => p.id === selectedPlan)?.features.map((feature, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <span className="text-emerald-500 text-xs">✓</span>
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Navigation buttons */}
              <div className="flex gap-4 pt-4 border-t border-slate-100">
                {step > 1 && (
                  <button
                    type="button"
                    onClick={handlePrevStep}
                    className="btn-secondary py-3 text-base flex-1 justify-center"
                  >
                    Back
                  </button>
                )}

                {step < 3 ? (
                  <button
                    type="button"
                    onClick={handleNextStep}
                    className="btn-primary py-3 text-base flex-1 justify-center"
                  >
                    Continue
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={mutation.isPending}
                    className="btn-primary py-3 text-base flex-1 justify-center"
                  >
                    {mutation.isPending ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin mr-2" />
                        Creating Workspace…
                      </>
                    ) : (
                      'Start Free Trial'
                    )}
                  </button>
                )}
              </div>
            </form>
          </div>

          <p className="text-center text-sm text-slate-500 mt-8">
            Already have an account?{' '}
            <Link to="/login" className="text-violet-600 hover:text-violet-700 font-semibold underline">
              Sign In
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
