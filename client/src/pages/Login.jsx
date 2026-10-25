import { useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api/index.js';
import { useAuthStore } from '../store/auth';
import GoogleSignInButton from '../components/GoogleSignInButton';

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm();

  const mutation = useMutation({
    mutationFn: (data) => api.post('/auth/login', data).then(r => r.data),
    onSuccess: ({ token, user }) => {
      login(token, user);
      toast.success(`Welcome back, ${user.name}!`);
      navigate('/');
    },
    onError: (err) => {
      const msg = err?.response?.data?.error || err?.response?.data?.message || 'Invalid email or password.';
      toast.error(msg);
    },
  });

  const onSubmit = (data) => mutation.mutate(data);

  return (
    <div className="min-h-screen flex">
      {/* Left — Brand Panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-violet-700 via-purple-700 to-fuchsia-700 flex-col items-center justify-center p-12 relative overflow-hidden">
        {/* Decorative blobs */}
        <div className="absolute top-[-60px] left-[-60px] w-72 h-72 bg-white/10 rounded-full blur-2xl" />
        <div className="absolute bottom-[-80px] right-[-40px] w-96 h-96 bg-white/5 rounded-full blur-3xl" />

        {/* Crochet art */}
        <div className="relative z-10 text-center">
          <div className="text-8xl mb-6 leading-none select-none">
            🧶
            <div className="flex justify-center gap-2 mt-3 text-5xl">
              <span>🪡</span><span>✂️</span><span>🧸</span>
            </div>
          </div>

          <h1 className="text-5xl font-extrabold text-white tracking-tight mb-2">Knotique</h1>
          <p className="text-violet-200 text-lg font-medium mb-8">Business Management Portal</p>

          <div className="grid grid-cols-3 gap-4 text-center mt-6">
            {[
              { label: 'Orders', icon: '📦' },
              { label: 'Production', icon: '🏭' },
              { label: 'Analytics', icon: '📊' },
              { label: 'Materials', icon: '🪢' },
              { label: 'Workers', icon: '👥' },
              { label: 'Reports', icon: '📋' },
            ].map(item => (
              <div key={item.label} className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
                <div className="text-2xl mb-1">{item.icon}</div>
                <div className="text-xs text-violet-200 font-medium">{item.label}</div>
              </div>
            ))}
          </div>

          <p className="text-violet-300 text-xs mt-8 leading-relaxed max-w-xs mx-auto">
            Manage your handmade crochet business — from raw materials to delivered orders.
          </p>
        </div>
      </div>

      {/* Right — Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 bg-slate-50">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <span className="text-4xl">🧶</span>
            <div>
              <h1 className="text-2xl font-extrabold text-slate-800">Knotique</h1>
              <p className="text-slate-500 text-sm">Business Management Portal</p>
            </div>
          </div>

          <div className="bg-white rounded-3xl shadow-xl border border-slate-100 p-8">
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-slate-800">Sign in</h2>
              <p className="text-slate-500 text-sm mt-1">Enter your credentials to continue</p>
            </div>

            <div className="mb-5">
              <GoogleSignInButton />
            </div>

            <div className="relative flex py-3 items-center">
              <div className="flex-grow border-t border-slate-100"></div>
              <span className="flex-shrink mx-3 text-slate-400 text-[10px] font-bold uppercase tracking-wider">or sign in with email</span>
              <div className="flex-grow border-t border-slate-100"></div>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              {/* Email */}
              <div>
                <label className="label" htmlFor="email">Email address</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-base">✉️</span>
                  <input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    className={`input pl-9 ${errors.email ? 'border-rose-400 focus:ring-rose-300/30 focus:border-rose-400' : ''}`}
                    {...register('email', {
                      required: 'Email is required',
                      pattern: { value: /^\S+@\S+$/i, message: 'Enter a valid email' },
                    })}
                    autoComplete="email"
                  />
                </div>
                {errors.email && <p className="text-rose-500 text-xs mt-1">{errors.email.message}</p>}
              </div>

              {/* Password */}
              <div>
                <label className="label" htmlFor="password">Password</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-base">🔒</span>
                  <input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    className={`input pl-9 ${errors.password ? 'border-rose-400 focus:ring-rose-300/30 focus:border-rose-400' : ''}`}
                    {...register('password', {
                      required: 'Password is required',
                      minLength: { value: 4, message: 'Password must be at least 4 characters' },
                    })}
                    autoComplete="current-password"
                  />
                </div>
                {errors.password && <p className="text-rose-500 text-xs mt-1">{errors.password.message}</p>}
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={mutation.isPending}
                className="btn-primary w-full justify-center py-3 text-base mt-2"
              >
                {mutation.isPending ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Signing in…
                  </>
                ) : (
                  <>
                    <span>→</span>
                    Sign in
                  </>
                )}
              </button>
            </form>
          </div>

          <p className="text-center text-sm text-slate-600 mt-6">
            New to Knotique?{' '}
            <a href="/signup" className="text-violet-600 hover:text-violet-700 font-semibold underline">
              Create a free workspace
            </a>
          </p>

          <p className="text-center text-xs text-slate-400 mt-6">
            🧶 Knotique — Crafted for crochet businesses
          </p>
        </div>
      </div>
    </div>
  );
}