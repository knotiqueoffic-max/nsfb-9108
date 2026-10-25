import { Link } from 'react-router-dom';

export default function UpgradePrompt({ onClose, title, message, limitKey, currentLimit }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-md w-full p-6 overflow-hidden relative">
        {/* Close Button */}
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors p-1"
          >
            ✕
          </button>
        )}

        {/* Header Icon */}
        <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center text-2xl mb-4 text-amber-500">
          🚀
        </div>

        {/* Title */}
        <h3 className="text-xl font-bold text-slate-800">
          {title || 'Upgrade Plan Required'}
        </h3>

        {/* Message */}
        <p className="text-slate-600 text-sm mt-2 leading-relaxed">
          {message || 'You have reached the limit of your current subscription tier. Upgrade your plan to unlock full capabilities.'}
        </p>

        {/* Limit Stats if applicable */}
        {limitKey && currentLimit !== undefined && (
          <div className="mt-4 p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-700">
            <span className="capitalize">{limitKey} Limit</span>
            <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold">
              {currentLimit} Max
            </span>
          </div>
        )}

        {/* Pricing options list */}
        <div className="mt-6 space-y-3">
          <Link
            to="/pricing"
            onClick={onClose}
            className="btn-primary w-full justify-center py-3 text-base text-center"
          >
            Explore Plans & Pricing
          </Link>
          {onClose && (
            <button
              onClick={onClose}
              className="btn-secondary w-full justify-center py-3 text-base text-center"
            >
              Maybe Later
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
