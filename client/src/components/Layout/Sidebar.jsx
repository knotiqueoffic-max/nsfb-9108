import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';

const navItems = [
  { to: '/',          icon: '📊', label: 'Dashboard',  adminOnly: false },
  { to: '/products',  icon: '🧸', label: 'Products',   adminOnly: false },
  { to: '/materials', icon: '🧶', label: 'Materials',  adminOnly: true  },
  { to: '/production',icon: '⚙️', label: 'Production', adminOnly: false },
  { to: '/orders',    icon: '📦', label: 'Orders',     adminOnly: true  },
  { to: '/workers',   icon: '👷', label: 'Workers',    adminOnly: true  },
  { to: '/reports',   icon: '📈', label: 'Reports',    adminOnly: true  },
  { to: '/payments',  icon: '💰', label: 'Payments',   adminOnly: true  },
  { to: '/expenses',  icon: '💸', label: 'Expenses',   adminOnly: true  },
  { to: '/todos',     icon: '📋', label: 'To-Do List', adminOnly: true  },
  { to: '/settings',  icon: '⚙️', label: 'Settings',  adminOnly: true  },
];

export default function Sidebar({ onClose }) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isAdmin = ['owner', 'admin', 'super_admin'].includes(user?.role);
  const isOwner = ['owner', 'super_admin'].includes(user?.role);

  const items = [...navItems];
  if (isOwner) {
    // Insert billing before settings
    const settingsIdx = items.findIndex(i => i.to === '/settings');
    if (settingsIdx !== -1) {
      items.splice(settingsIdx, 0, { to: '/billing', icon: '💳', label: 'Billing & Plan', adminOnly: false });
    } else {
      items.push({ to: '/billing', icon: '💳', label: 'Billing & Plan', adminOnly: false });
    }
  }
  if (user?.role === 'super_admin') {
    items.push({ to: '/super-admin', icon: '👑', label: 'Super Admin', adminOnly: false });
  }

  const visibleItems = items.filter(item => !item.adminOnly || isAdmin);

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-brand-900 to-brand-800 text-white w-64 flex-shrink-0">
      {/* Logo */}
      <div className="flex items-center justify-between px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center text-xl flex-shrink-0">🧶</div>
          <div className="min-w-0">
            <h1 className="font-bold text-white text-lg leading-none truncate" title={user?.tenant_name || 'Knotique'}>
              {user?.tenant_name || 'Knotique'}
            </h1>
            <p className="text-purple-300 text-xs truncate">{user?.plan_name || 'Business'} Plan</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-white/60 hover:text-white p-1 lg:hidden">✕</button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={onClose}
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
          >
            <span className="text-base">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* User section */}
      <div className="px-3 py-4 border-t border-white/10">
        <div className="flex items-center gap-3 px-2 py-2 rounded-xl mb-2">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">
            {user?.name?.[0] || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">{user?.name}</p>
            <p className="text-purple-300 text-xs capitalize">{user?.role}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full sidebar-link text-red-300 hover:text-red-200 hover:bg-red-500/20"
        >
          <span>🚪</span>
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );
}
