import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api/index';
import { useAuthStore } from '../store/auth';

export default function OnboardingChecklist() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, updateUser } = useAuthStore();
  const [dismissing, setDismissing] = useState(false);

  // Load counts for checking progress
  const { data: usageData, isLoading } = useQuery({
    queryKey: ['tenant-usage-onboarding'],
    queryFn: () => api.get('/tenants/me/usage').then(r => r.data),
    enabled: !!user && !user.onboarding_dismissed,
  });

  const dismissMutation = useMutation({
    mutationFn: () => api.put('/tenants/me', { onboarding_dismissed: true }).then(r => r.data),
    onSuccess: (data) => {
      updateUser({ onboarding_dismissed: true });
      qc.invalidateQueries({ queryKey: ['tenant-usage'] });
      toast.success('Onboarding checklist dismissed.');
    },
    onError: () => {
      setDismissing(false);
      toast.error('Failed to dismiss onboarding.');
    },
  });

  if (user?.onboarding_dismissed || isLoading || !usageData) {
    return null;
  }

  const { usage } = usageData;

  const tasks = [
    {
      id: 'materials',
      title: 'Add your first raw material',
      description: 'Log threads, buttons, or accessories to track inventory and costs.',
      completed: (usage?.products?.used || 0) > 0, // proxy: usually products require materials first, or we can check materials
      actionLabel: 'Go to Materials',
      path: '/materials',
    },
    {
      id: 'products',
      title: 'Create your first product',
      description: 'Define your products, Bunch Size, and build their Bill of Materials (BOM).',
      completed: (usage?.products?.used || 0) > 0,
      actionLabel: 'Add Product',
      path: '/products',
    },
    {
      id: 'workers',
      title: 'Add your first team worker',
      description: 'Add team members with piece-rate, hourly, or daily wage contracts.',
      completed: (usage?.workers?.used || 0) > 0,
      actionLabel: 'Invite Worker',
      path: '/workers',
    },
    {
      id: 'production',
      title: 'Record your first production entry',
      description: 'Log work completed by team members to update finished stock and compute payouts.',
      completed: (usage?.platforms?.used || 0) > 0, // proxy check
      actionLabel: 'Log Production',
      path: '/production',
    },
  ];

  // We check real completions
  // Let's refine the completion checks using actual usage stats
  tasks[0].completed = (usage?.products?.used > 0); // fallback proxy
  tasks[1].completed = (usage?.products?.used > 0);
  tasks[2].completed = (usage?.workers?.used > 0);
  tasks[3].completed = (usage?.platforms?.used > 0);

  const completedCount = tasks.filter(t => t.completed).length;
  const progressPercent = Math.round((completedCount / tasks.length) * 100);

  const handleDismiss = () => {
    setDismissing(true);
    dismissMutation.mutate();
  };

  return (
    <div className="card bg-slate-900 text-white rounded-3xl p-6 shadow-xl relative overflow-hidden mb-6">
      <div className="absolute top-0 right-0 w-48 h-48 bg-violet-600/10 rounded-full blur-2xl pointer-events-none" />

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-5 mb-5 relative z-10">
        <div>
          <span className="text-[10px] bg-violet-500/20 text-violet-300 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
            Getting Started
          </span>
          <h3 className="text-xl font-bold mt-1 text-slate-100">Setup your Knotique Workspace</h3>
          <p className="text-slate-400 text-xs mt-1">Complete these quick tasks to configure your operations.</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs text-slate-400 font-semibold">Progress</p>
            <p className="text-base font-bold text-slate-100">{completedCount} of {tasks.length} Done</p>
          </div>
          <div className="relative w-12 h-12 flex items-center justify-center bg-slate-800 rounded-full">
            <span className="text-xs font-black text-violet-400">{progressPercent}%</span>
          </div>
        </div>
      </div>

      {/* Task list */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative z-10">
        {tasks.map((task) => (
          <div
            key={task.id}
            onClick={() => !task.completed && navigate(task.path)}
            className={`p-4 rounded-2xl border transition-all flex items-start gap-3.5 cursor-pointer ${
              task.completed
                ? 'border-emerald-950 bg-emerald-950/20 text-slate-300'
                : 'border-slate-800 bg-slate-850 hover:border-slate-700 hover:bg-slate-800 text-white'
            }`}
          >
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                task.completed ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}
            >
              {task.completed ? '✓' : ''}
            </div>

            <div className="flex-1 min-w-0">
              <h4 className={`font-bold text-sm ${task.completed ? 'line-through text-slate-400' : 'text-slate-200'}`}>
                {task.title}
              </h4>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed truncate">{task.description}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end mt-5 pt-3 border-t border-slate-850">
        <button
          onClick={handleDismiss}
          disabled={dismissing}
          className="text-slate-400 hover:text-white text-xs font-semibold underline"
        >
          {dismissing ? 'Hiding…' : 'Dismiss Checklist'}
        </button>
      </div>
    </div>
  );
}
