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

// Global response error handler
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;

    // 401 — token expired or invalid: force re-login
    if (status === 401) {
      localStorage.removeItem('knotique_token');
      localStorage.removeItem('knotique_user');
      window.location.href = '/login';
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
