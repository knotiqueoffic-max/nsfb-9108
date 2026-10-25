import { create } from 'zustand';

const getStoredToken = () => {
  try {
    const t = localStorage.getItem('knotique_token');
    return t && t !== 'undefined' && t !== 'null' && typeof t === 'string' && t.trim().length > 0 ? t : null;
  } catch {
    return null;
  }
};

const getStoredUser = () => {
  try {
    const u = localStorage.getItem('knotique_user');
    if (!u || u === 'undefined' || u === 'null') return null;
    const parsed = JSON.parse(u);
    return parsed && typeof parsed === 'object' && parsed.id ? parsed : null;
  } catch {
    return null;
  }
};

const initialToken = getStoredToken();
const initialUser = getStoredUser();

export const useAuthStore = create((set) => ({
  user:            initialUser,
  token:           initialToken,
  isAuthenticated: !!(initialToken && initialUser),

  login: (token, user) => {
    if (!token || typeof token !== 'string' || token.trim().length === 0 || !user || typeof user !== 'object' || !user.id) {
      console.error('[AuthStore] Login rejected: invalid token or user payload', { hasToken: !!token, hasUser: !!user });
      return false;
    }
    localStorage.setItem('knotique_token', token);
    localStorage.setItem('knotique_user', JSON.stringify(user));
    set({ token, user, isAuthenticated: true });
    return true;
  },

  logout: () => {
    localStorage.removeItem('knotique_token');
    localStorage.removeItem('knotique_user');
    set({ token: null, user: null, isAuthenticated: false });
  },

  updateUser: (updatedUser) => {
    const current = getStoredUser();
    const merged  = { ...current, ...updatedUser };
    localStorage.setItem('knotique_user', JSON.stringify(merged));
    set({ user: merged });
  },

  // ── Derived helpers ────────────────────────────────────────────────────────
  get tenantId()           { return getStoredUser()?.tenant_id;           },
  get planId()             { return getStoredUser()?.plan_id;             },
  get subscriptionStatus() { return getStoredUser()?.subscription_status; },
  get trialEndsAt()        { return getStoredUser()?.trial_ends_at;        },
  get isTrialing()         { return getStoredUser()?.subscription_status === 'trialing'; },
  get isLocked()           { return getStoredUser()?.subscription_status === 'locked'; },
  get isOwner()            { return ['owner', 'super_admin'].includes(getStoredUser()?.role); },
  get isAdmin()            { return ['owner', 'admin', 'super_admin'].includes(getStoredUser()?.role); },
  get isVendor()           { return getStoredUser()?.role === 'vendor'; },
  get isSubvendor()        { return getStoredUser()?.role === 'subvendor'; },
  get isWorker()           { return getStoredUser()?.role === 'worker'; },
  get isManager()          { return ['owner', 'admin', 'vendor', 'subvendor', 'super_admin'].includes(getStoredUser()?.role); },
}));
