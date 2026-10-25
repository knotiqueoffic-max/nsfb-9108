import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useAuthStore } from '../../store/auth';

const pageTitles = {
  '/':           'Dashboard',
  '/products':   'Products',
  '/materials':  'Materials',
  '/production': 'Production',
  '/orders':     'Orders',
  '/workers':    'Workers',
  '/reports':    'Reports',
  '/expenses':   'Expenses',
  '/todos':      'To-Do List',
  '/settings':   'Settings',
  '/billing':    'Billing & Plan',
};

export default function Layout({ children }) {
  const { user } = useAuthStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const title = pageTitles[location.pathname] || 'Knotique';
  const isLocked = user?.subscription_status === 'locked';

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <div className="relative z-10 animate-slide-in">
            <Sidebar onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-4 flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h2 className="font-semibold text-slate-800 text-lg">{title}</h2>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-slate-400">Knotique v1.0</span>
          </div>
        </header>

        {isLocked && (
          <div className="bg-rose-50 text-rose-800 border-b border-rose-200 px-4 py-3 flex items-center justify-between text-sm shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-base">⚠️</span>
              <span>
                <strong>Workspace Locked:</strong> Your trial has expired or payment failed. Database write operations are locked.
              </span>
            </div>
            <a href="/billing" className="bg-rose-600 hover:bg-rose-700 text-white font-semibold px-3 py-1.5 rounded-xl text-xs transition-colors shrink-0">
              Subscribe & Unlock
            </a>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="animate-fade-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
