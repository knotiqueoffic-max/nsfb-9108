import axios from 'axios';

// Resolve API base URL: defaults to relative '/api' (useful with Netlify proxy or dev server),
// or points to an external hosted backend (e.g. Render/Railway) via VITE_API_URL.
const rawApiUrl = import.meta.env.VITE_API_URL;
let resolvedBaseUrl = '/api';

if (rawApiUrl && typeof rawApiUrl === 'string') {
  const trimmed = rawApiUrl.replace(/\/+$/, '');
  resolvedBaseUrl = trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

const api = axios.create({
  baseURL: resolvedBaseUrl,
  timeout: 30000,
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('knotique_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Global response handler
api.interceptors.response.use(
  (res) => {
    // Detect accidental HTML responses (e.g. Netlify SPA fallback when backend API is unreachable)
    const contentType = res.headers?.['content-type'] || '';
    if (
      typeof res.data === 'string' &&
      (contentType.includes('text/html') || res.data.trim().startsWith('<!DOCTYPE') || res.data.trim().startsWith('<html'))
    ) {
      const error = new Error('Received an HTML page instead of JSON API response. The backend server may be unreachable.');
      error.response = res;
      return Promise.reject(error);
    }
    return res;
  },
  (err) => {
    const status = err.response?.status;
    const reqUrl = err.config?.url || '';
    const isAuthRoute =
      reqUrl.includes('/auth/login') ||
      reqUrl.includes('/auth/google-login') ||
      reqUrl.includes('/auth/signup') ||
      reqUrl.includes('/auth/config');

    // 401 — token expired or invalid: force re-login only for protected application requests.
    // Never hijack authentication endpoint errors to avoid full-page redirect loops.
    if (status === 401 && !isAuthRoute) {
      localStorage.removeItem('knotique_token');
      localStorage.removeItem('knotique_user');
      if (window.location.pathname !== '/login' && window.location.pathname !== '/signup') {
        window.location.href = '/login';
      }
      return Promise.reject(err);
    }

    // 423 — account locked (trial ended / payment failed)
    // We don't redirect; let the calling component handle this gracefully.
    // The error payload will contain { error, message, code: 'ACCOUNT_LOCKED' }
    if (status === 423) {
      // Dispatch a custom event so the Layout/Sidebar can show a global banner
      window.dispatchEvent(new CustomEvent('knotique:account-locked', {
        detail: err.response.data,
      }));
    }

    // 402 — plan limit reached
    if (status === 402) {
      window.dispatchEvent(new CustomEvent('knotique:plan-limit', {
        detail: err.response.data,
      }));
    }

    return Promise.reject(err);
  }
);

export default api;
