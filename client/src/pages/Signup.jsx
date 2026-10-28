import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api/index.js';
import { useAuthStore } from '../store/auth';
import GoogleSignInButton from '../components/GoogleSignInButton';

const ROLES_LIST = [
  {
    id: 'admin',
    name: 'Admin',
    tagline: 'Brand Owner & Workshop Manager',
    icon: '👑',
    description: 'Full workspace control. Manage inventory, materials, production batches, issue orders, invite vendors/workers, and process payouts.',
    colorBorder: 'border-violet-600',
    colorBg: 'bg-violet-50/50',
    colorRing: 'ring-2 ring-violet-500/20',
    badge: 'Workspace Owner',
  },
  {
    id: 'vendor',
    name: 'Vendor',
    tagline: 'Supply & Production Contractor',
    icon: '🤝',
    description: 'Receive production requests from admins, submit competitive bids, delegate to sub-vendors or worker teams, and manage invoices.',
    colorBorder: 'border-blue-600',
    colorBg: 'bg-blue-50/50',
    colorRing: 'ring-2 ring-blue-500/20',
    badge: 'B2B Partner',
  },
  {
    id: 'subvendor',
    name: 'Sub-Vendor',
    tagline: 'Regional Production Coordinator',
    icon: '🪡',
    description: 'Coordinate artisan teams and manage piece-rate crocheters. Submit quotes, monitor daily piece counts, and upload proof of work.',
    colorBorder: 'border-amber-600',
    colorBg: 'bg-amber-50/50',
    colorRing: 'ring-2 ring-amber-500/20',
    badge: 'Production Team',
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
  const [searchParams] = useSearchParams();
  const initialRoleParam = searchParams.get('role');
  const validInitialRole = ['admin', 'vendor', 'subvendor'].includes(initialRoleParam)
    ? initialRoleParam
    : 'admin';

  const { login } = useAuthStore();
  const [step, setStep] = useState(1);
  const [selectedRole, setSelectedRole] = useState(validInitialRole);
  const [roleConfirmed, setRoleConfirmed] = useState(false);
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
    mutationFn: async (data) => {
      const res = await api.post('/auth/signup', data);
      const resData = res?.data;
      if (!resData || typeof resData !== 'object' || !resData.token || !resData.user || !resData.user.id) {
        throw new Error('Server returned an invalid registration response.');
      }
      return resData;
    },
    onSuccess: ({ token, user }) => {
      const ok = login(token, user);
      if (ok) {
        toast.success(`Welcome to Knotique, ${user.name}! Your ${user.role} workspace is ready.`);
        navigate('/choose-plan');
      } else {
        toast.error('Account created, but session could not be established. Please sign in.');
        navigate('/login');
      }
    },
    onError: (err) => {
      const msg = err?.response?.data?.error || err?.message || 'Registration failed. Please try again.';
      toast.error(msg);
    },
  });

  const handleNextStep = async () => {
    if (step === 1) {
      if (!roleConfirmed) {
        toast.error('Please verify and confirm your permanent role selection before proceeding.');
        return;
      }
      const isValid = await trigger(['name', 'email', 'password']);
      if (isValid) {
        setStep(2);
      }
    }
  };

  const handlePrevStep = () => {
    setStep(1);
  };

  const onSubmit = (data) => {
    if (!roleConfirmed) {
      toast.error('Please verify and confirm your permanent role selection.');
      setStep(1);
      return;
    }

    mutation.mutate({
      ...data,
      role: selectedRole,
      plan_id: 'free_trial',
    });
  };

  const activeRoleObj = ROLES_LIST.find((r) => r.id === selectedRole) || ROLES_LIST[0];

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Left Panel — Information & Branding */}
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
                <h4 className="font-semibold text-white">Hierarchical Workspaces</h4>
                <p className="text-violet-200 text-sm mt-0.5">
                  Admins, Vendors, and Sub-Vendors coordinate private bids, requests, and piece-rate execution.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <span className="text-2xl">👥</span>
              <div>
                <h4 className="font-semibold text-white">Worker & Crocheter Management</h4>
                <p className="text-violet-200 text-sm mt-0.5">
                  Assign work batches, verify photo/video submissions, and automate piece-rate payouts.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <span className="text-2xl">📈</span>
              <div>
                <h4 className="font-semibold text-white">COGS & Margin Analytics</h4>
                <p className="text-violet-200 text-sm mt-0.5">
                  Track raw yarn and materials costs per unit, analyze real-time profit margins, and export reports.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 border-t border-white/20 pt-6">
          <p className="text-violet-200 text-sm italic">
            "Knotique unified our entire network of 40+ crocheters and vendors with complete privacy and zero payroll errors."
          </p>
          <p className="text-violet-300 text-xs font-semibold mt-2">— Artisan Craft Collective</p>
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
                { number: 1, label: 'Role & Account' },
                { number: 2, label: 'Workspace Setup' },
                { number: 3, label: 'Plan Selection' },
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
                {step === 1 && 'Create your Knotique account'}
                {step === 2 && 'Set up your workspace'}
              </h2>
              <p className="text-slate-500 text-sm mt-1">
                {step === 1 && 'Select your permanent account role and enter your personal details'}
                {step === 2 && 'Give your organization a name and business category'}
              </p>
            </div>
          </div>

          {/* Form Card */}
          <div className="bg-white rounded-3xl shadow-lg border border-slate-100 p-8">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              {/* Step 1: Role Selection & Account Info */}
              {step === 1 && (
                <div className="space-y-6 animate-fade-in">
                  {/* Role Selector Header */}
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2 block">
                      1. Select Your Account Role *
                    </label>
                    <p className="text-xs text-slate-500 mb-3">
                      Choose how you operate in Knotique. Your role determines your tools, bidding permissions, and workspace structure.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {ROLES_LIST.map((roleItem) => {
                        const isSelected = selectedRole === roleItem.id;
                        return (
                          <div
                            key={roleItem.id}
                            onClick={() => setSelectedRole(roleItem.id)}
                            className={`relative cursor-pointer rounded-2xl p-4 border-2 transition-all duration-200 flex flex-col justify-between ${
                              isSelected
                                ? `${roleItem.colorBorder} ${roleItem.colorBg} ${roleItem.colorRing} shadow-sm`
                                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50'
                            }`}
                          >
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-2xl">{roleItem.icon}</span>
                                {isSelected ? (
                                  <span className="h-5 w-5 rounded-full bg-violet-600 text-white flex items-center justify-center text-xs font-bold">
                                    ✓
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                                    {roleItem.badge}
                                  </span>
                                )}
                              </div>
                              <h4 className="font-bold text-slate-900 text-sm">{roleItem.name}</h4>
                              <p className="text-[11px] font-medium text-violet-700 mt-0.5">{roleItem.tagline}</p>
                              <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">{roleItem.description}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Role Selection Badge */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-100 border border-slate-200">
                    <span className="text-xs text-slate-600 font-medium">Selected Account Role:</span>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-violet-100 text-violet-800">
                      <span>{activeRoleObj.icon}</span>
                      <span>{activeRoleObj.name}</span>
                    </span>
                  </div>

                  {/* Warning Banner */}
                  <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-amber-800 text-sm">
                      <span>⚠️</span>
                      <span>Important — Permanent Role Selection</span>
                    </div>
                    <p className="leading-relaxed">
                      Your account role (<strong>{activeRoleObj.name}</strong>) defines your workspace permissions, access levels, and production workflows. <strong>This role is permanent and cannot be changed after you sign up.</strong> Please verify your selection before continuing.
                    </p>
                  </div>

                  {/* Required Confirmation Checkbox */}
                  <label className="flex items-start gap-3 p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-slate-50 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={roleConfirmed}
                      onChange={(e) => setRoleConfirmed(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded text-violet-600 focus:ring-violet-500 border-slate-300 cursor-pointer"
                    />
                    <span className="text-xs text-slate-700 font-medium leading-relaxed">
                      I understand and confirm that my selected account role (<strong className="uppercase text-slate-900">{activeRoleObj.name}</strong>) is permanent and cannot be altered or transferred after registration.
                    </span>
                  </label>

                  {/* Worker / Crocheter Informational Notice */}
                  <div className="p-3.5 rounded-xl bg-sky-50 border border-sky-200 text-sky-900 text-xs flex items-start gap-2.5">
                    <span className="text-base leading-none">ℹ️</span>
                    <div className="leading-relaxed">
                      <span className="font-bold text-sky-950">Are you a Crocheter or Production Worker?</span>
                      <p className="mt-0.5 text-sky-800">
                        Workers cannot self-register. Please ask your Admin, Vendor, or Sub-Vendor to create or invite your worker account directly from their dashboard.
                      </p>
                    </div>
                  </div>

                  {/* Google Sign-In with Role */}
                  <div className="pt-2">
                    <div className={!roleConfirmed ? 'opacity-50 pointer-events-none' : ''}>
                      <GoogleSignInButton role={selectedRole} redirectUrl="/choose-plan" />
                    </div>
                    {!roleConfirmed && (
                      <p className="text-[11px] text-amber-700 text-center font-medium mt-2">
                        ↑ Please check the permanent role confirmation checkbox above to proceed with Google Sign-In.
                      </p>
                    )}
                  </div>

                  {/* Divider */}
                  <div className="relative flex py-1 items-center">
                    <div className="flex-grow border-t border-slate-200"></div>
                    <span className="flex-shrink mx-3 text-slate-400 text-[10px] font-bold uppercase tracking-wider">
                      or sign up with email
                    </span>
                    <div className="flex-grow border-t border-slate-200"></div>
                  </div>

                  {/* Account Inputs */}
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

              {/* Step 2: Company Setup */}
              {step === 2 && (
                <div className="space-y-5 animate-fade-in">
                  <div className="p-4 rounded-2xl bg-violet-50/60 border border-violet-100 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-bold text-violet-700 uppercase tracking-widest block">
                        Account Configuration
                      </span>
                      <p className="text-xs text-slate-700 font-semibold mt-0.5">
                        Signing up as: <span className="font-extrabold uppercase text-violet-900">{activeRoleObj.name}</span>
                      </p>
                    </div>
                    <span className="text-2xl">{activeRoleObj.icon}</span>
                  </div>

                  <div>
                    <label className="label" htmlFor="company_name">Company / Workshop / Business Name *</label>
                    <input
                      id="company_name"
                      type="text"
                      placeholder={selectedRole === 'vendor' ? 'Apex Textile Supplies' : selectedRole === 'subvendor' ? 'Regional Crochet Hub' : 'My Artisan Studio'}
                      className={`input ${errors.company_name ? 'border-rose-400' : ''}`}
                      {...register('company_name', { required: 'Business name is required' })}
                    />
                    {errors.company_name && (
                      <p className="text-rose-500 text-xs mt-1">{errors.company_name.message}</p>
                    )}
                    <p className="text-xs text-slate-400 mt-1">
                      This is used to customize your workspace, invoices, packing slips, and public URL slug.
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

                {step === 1 ? (
                  <button
                    type="button"
                    onClick={handleNextStep}
                    className="btn-primary py-3 text-base flex-1 justify-center"
                  >
                    Continue to Workspace Setup →
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
                        Creating {activeRoleObj.name} Workspace…
                      </>
                    ) : (
                      'Create Account & Choose Plan →'
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
