import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
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
