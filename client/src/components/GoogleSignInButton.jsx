import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api/index';
import { useAuthStore } from '../store/auth';

const FALLBACK_CLIENT_ID = '268763150621-4qgrhe5pgmkd7s3ru6mucmk9m9e3vr9e.apps.googleusercontent.com';

export default function GoogleSignInButton({ planId = 'free_trial' }) {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const googleBtnRef = useRef(null);
  const isSubmittingRef = useRef(false);
  const [clientId, setClientId] = useState(
    import.meta.env.VITE_GOOGLE_CLIENT_ID || FALLBACK_CLIENT_ID
  );
  const [isGsiReady, setIsGsiReady] = useState(false);

  const mutation = useMutation({
    mutationFn: async (token) => {
      if (!token || typeof token !== 'string') {
        throw new Error('Google credential was not provided.');
      }
      const res = await api.post('/auth/google-login', { token, plan_id: planId });
      const data = res?.data;
      if (!data || typeof data !== 'object' || !data.token || !data.user || !data.user.id) {
        throw new Error('Server returned an invalid authentication response.');
      }
      return data;
    },
    onSuccess: (data) => {
      isSubmittingRef.current = false;
      const ok = login(data.token, data.user);
      if (ok) {
        if (data.message) {
          toast.success(data.message);
        } else {
          toast.success(`Welcome, ${data.user.name || 'User'}!`);
        }
        navigate('/');
      } else {
        toast.error('Failed to establish session. Please try again.');
      }
    },
    onError: (err) => {
      isSubmittingRef.current = false;
      const msg =
        err?.response?.data?.error ||
        err?.message ||
        'Google Sign-in failed. Please try again.';
      toast.error(msg);
    },
  });

  // Fetch client ID from server config if available
  useEffect(() => {
    let isMounted = true;
    api.get('/auth/config')
      .then((res) => {
        if (isMounted && res.data?.googleClientId) {
          setClientId(res.data.googleClientId);
        }
      })
      .catch(() => {
        // Fallback to preconfigured client ID
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // Poll / check until window.google.accounts.id is available
  useEffect(() => {
    if (window.google?.accounts?.id) {
      setIsGsiReady(true);
      return;
    }

    const interval = setInterval(() => {
      if (window.google?.accounts?.id) {
        setIsGsiReady(true);
        clearInterval(interval);
      }
    }, 150);

    return () => clearInterval(interval);
  }, []);

  // Initialize and render official Google Identity Services button
  useEffect(() => {
    if (!isGsiReady || !clientId || !googleBtnRef.current) return;

    try {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          if (mutation.isPending || isSubmittingRef.current) return;
          const credential = response?.credential;
          if (credential && typeof credential === 'string') {
            isSubmittingRef.current = true;
            mutation.mutate(credential);
          } else {
            toast.error('Google sign-in did not return a valid credential.');
          }
        },
        error_callback: (err) => {
          console.warn('[Google Identity Services notice]:', err);
        },
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      googleBtnRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'pill',
        width: 380,
        logo_alignment: 'left',
      });
    } catch (err) {
      console.error('Google button rendering error:', err);
    }

    return () => {
      try {
        window.google?.accounts?.id?.cancel();
      } catch {}
    };
  }, [isGsiReady, clientId]);

  const handleManualClick = () => {
    if (mutation.isPending || isSubmittingRef.current) return;
    if (!window.google?.accounts?.id) {
      toast.loading('Loading Google authentication...', { duration: 1500 });
      return;
    }
    try {
      window.google.accounts.id.prompt();
    } catch (err) {
      console.error('Google prompt error:', err);
    }
  };

  return (
    <div className="w-full flex flex-col items-center justify-center">
      {mutation.isPending && (
        <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-violet-600">
          <span className="w-3.5 h-3.5 border-2 border-violet-500/30 border-t-violet-600 rounded-full animate-spin" />
          Authenticating with Google…
        </div>
      )}

      {/* Real Google Identity Services Button Container */}
      <div
        ref={googleBtnRef}
        className={`w-full max-w-[380px] flex justify-center min-h-[44px] ${
          !isGsiReady ? 'hidden' : ''
        }`}
      />

      {/* Fallback presentation while Google Identity Services script loads */}
      {!isGsiReady && (
        <button
          type="button"
          onClick={handleManualClick}
          disabled={mutation.isPending}
          className="w-full max-w-[380px] py-2.5 px-4 border border-slate-200 rounded-full flex items-center justify-center gap-3 text-sm font-semibold text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-xs cursor-pointer"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          Continue with Google
        </button>
      )}
    </div>
  );
}
