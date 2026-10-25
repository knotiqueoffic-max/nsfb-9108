import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api/index';
import { useAuthStore } from '../store/auth';

export default function GoogleSignInButton({ planId = 'starter' }) {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const googleBtnRef = useRef(null);
  const [googleClientId, setGoogleClientId] = useState('');
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [useMock, setUseMock] = useState(true);

  const mutation = useMutation({
    mutationFn: (token) => api.post('/auth/google-login', { token, plan_id: planId }).then(r => r.data),
    onSuccess: (data) => {
      login(data.token, data.user);
      if (data.message) {
        toast.success(data.message);
      } else {
        toast.success(`Welcome, ${data.user.name}!`);
      }
      navigate('/');
    },
    onError: (err) => {
      const msg = err?.response?.data?.error || 'Google Sign-in failed. Please try again.';
      toast.error(msg);
    },
  });

  useEffect(() => {
    api.get('/auth/config')
      .then(res => {
        if (res.data.googleClientId) {
          setGoogleClientId(res.data.googleClientId);
          setUseMock(false);
        } else {
          setUseMock(true);
        }
        setLoadingConfig(false);
      })
      .catch(err => {
        console.error('Failed to load Google config, fallback to mock', err);
        setUseMock(true);
        setLoadingConfig(false);
      });
  }, []);

  useEffect(() => {
    if (!loadingConfig && googleClientId && window.google) {
      try {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: (response) => {
            mutation.mutate(response.credential);
          },
        });
        window.google.accounts.id.renderButton(
          googleBtnRef.current,
          { theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', width: '380' }
        );
      } catch (err) {
        console.error('Google ID load failed, fallback to mock mode', err);
        setUseMock(true);
      }
    }
  }, [googleClientId, loadingConfig]);

  const handleMockClick = () => {
    // Check query params first for automation ease
    const urlParams = new URLSearchParams(window.location.search);
    const queryEmail = urlParams.get('sandbox_email');
    if (queryEmail) {
      mutation.mutate(`mock_google_token_${queryEmail.trim()}`);
      return;
    }

    const testEmail = prompt(
      "Google Sign-In Sandbox Mock Mode:\n\nEnter a test email to simulate Google authentication.\n\n- To test NEW USER: enter a new email.\n- To test ACCOUNT LINKING: enter an email of an existing account.",
      "google_tester@gmail.com"
    );
    
    // If the prompt is dismissed (null) due to automation, use the default google_tester@gmail.com
    const emailToUse = testEmail !== null ? testEmail.trim() : "google_tester@gmail.com";
    if (!emailToUse) return;

    mutation.mutate(`mock_google_token_${emailToUse}`);
  };

  if (useMock) {
    return (
      <button
        type="button"
        onClick={handleMockClick}
        className="w-full py-2.5 px-4 border border-slate-200 rounded-2xl flex items-center justify-center gap-3 text-sm font-semibold text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-xs cursor-pointer"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" width="20" height="20">
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
        Continue with Google <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full font-bold ml-1">Sandbox</span>
      </button>
    );
  }

  return (
    <div className="flex justify-center w-full">
      <div ref={googleBtnRef} className="w-full max-w-[380px]" />
    </div>
  );
}
