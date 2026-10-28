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
  // Ensure browser sets multipart/form-data boundary automatically when submitting FormData
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
    delete config.headers['content-type'];
  }
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

// ─── Production Work Submissions & Approval API Methods ──────────────────────
api.uploadSubmission = (requestId, formData) =>
  api.post(`/production-requests/${requestId}/submissions`, formData).then((r) => r.data);

api.fetchSubmissions = (requestId) =>
  api.get(`/production-requests/${requestId}/submissions`).then((r) => r.data);

api.reviewSubmission = (requestId, submissionId, data) =>
  api.patch(`/production-requests/${requestId}/submissions/${submissionId}/review`, data).then((r) => r.data);

api.fetchApprovalsQueue = () =>
  api.get('/production-requests/approvals/queue').then((r) => r.data);

// ─── Account & Subordinate Deletion API Methods ──────────────────────────────
api.deleteAccount = (confirmData) =>
  api.delete('/auth/account', { data: confirmData }).then((r) => r.data);

api.deleteWorker = (workerId) =>
  api.delete(`/workers/${workerId}`).then((r) => r.data);

api.deleteSubvendor = (subvendorId) =>
  api.delete(`/tenants/subvendors/${subvendorId}`).then((r) => r.data);

export const uploadSubmission = api.uploadSubmission;
export const fetchSubmissions = api.fetchSubmissions;
export const reviewSubmission = api.reviewSubmission;
export const fetchApprovalsQueue = api.fetchApprovalsQueue;
export const deleteAccount = api.deleteAccount;
export const deleteWorker = api.deleteWorker;
export const deleteSubvendor = api.deleteSubvendor;

export default api;
