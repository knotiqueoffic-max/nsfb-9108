import { create } from 'zustand';

const getStoredUser = () => {
  try {
    const u = localStorage.getItem('knotique_user');
    return u ? JSON.parse(u) : null;
  } catch { return null; }
};

export const useAuthStore = create((set) => ({
  user:            getStoredUser(),
  token:           localStorage.getItem('knotique_token'),
  isAuthenticated: !!localStorage.getItem('knotique_token'),

  login: (token, user) => {
    localStorage.setItem('knotique_token', token);
    localStorage.setItem('knotique_user', JSON.stringify(user));
    set({ token, user, isAuthenticated: true });
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
  get isWorker()           { return getStoredUser()?.role === 'worker'; },
}));
