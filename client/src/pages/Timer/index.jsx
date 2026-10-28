import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format, parseISO } from 'date-fns';
import api from '../../api/index';
import { useAuthStore } from '../../store/auth';

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-7 h-7 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
    </div>
  );
}

function playChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const audioCtx = new AudioCtx();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.3); // A5
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.8);
  } catch (e) {
    // Ignore autoplay restriction or lack of audio device
  }
}

function formatDuration(totalSeconds) {
  if (!totalSeconds || totalSeconds < 0) return '00:00';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

const PRESET_MODES = [
  { key: 'focus', label: '🧶 Focus Session', minutes: 25 },
  { key: 'short_break', label: '☕ Short Break', minutes: 5 },
  { key: 'long_break', label: '🌿 Long Break', minutes: 15 },
  { key: 'custom', label: '⚙️ Custom', minutes: 30 },
];

export default function Timer() {
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const [mode, setMode] = useState('focus');
  const [targetMinutes, setTargetMinutes] = useState(25);
  const [sessionTitle, setSessionTitle] = useState('Crochet Focus Session');
  const [selectedRequestId, setSelectedRequestId] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [finishNotes, setFinishNotes] = useState('');
  const [showFinishModal, setShowFinishModal] = useState(false);

  // Live timer tick state
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const intervalRef = useRef(null);

  // Queries
  const { data: activeData, isLoading: activeLoading } = useQuery({
    queryKey: ['active-work-session'],
    queryFn: () => api.get('/work-sessions/active').then((r) => r.data),
  });

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['work-sessions-history'],
    queryFn: () => api.get('/work-sessions').then((r) => r.data),
  });

  const { data: requestsData } = useQuery({
    queryKey: ['my-assigned-requests'],
    queryFn: () => api.get('/production-requests?view=received').then((r) => r.data),
  });

  const { data: ordersData } = useQuery({
    queryKey: ['orders-quick-list'],
    queryFn: () => api.get('/orders').then((r) => r.data),
  });

  const currentSession = activeData?.session;

  // Real-time tick effect: immune to tab backgrounding
  useEffect(() => {
    if (!currentSession) {
      setElapsedSeconds(0);
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    const computeCurrentElapsed = () => {
      let seconds = currentSession.duration_seconds || 0;
      if (currentSession.status === 'active' && currentSession.last_resumed_at) {
        const diff = Math.floor((Date.now() - new Date(currentSession.last_resumed_at).getTime()) / 1000);
        seconds += Math.max(0, diff);
      }
      return seconds;
    };

    setElapsedSeconds(computeCurrentElapsed());

    if (currentSession.status === 'active') {
      intervalRef.current = setInterval(() => {
        setElapsedSeconds(computeCurrentElapsed());
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [currentSession]);

  // Mutations
  const startMutation = useMutation({
    mutationFn: (payload) => api.post('/work-sessions/start', payload).then((r) => r.data),
    onSuccess: (data) => {
      toast.success(data?.message || 'Focus session started!');
      qc.invalidateQueries({ queryKey: ['active-work-session'] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to start session'),
  });

  const pauseMutation = useMutation({
    mutationFn: (id) => api.post(`/work-sessions/${id}/pause`).then((r) => r.data),
    onSuccess: () => {
      toast('Session paused ⏸️', { icon: '⏸️' });
      qc.invalidateQueries({ queryKey: ['active-work-session'] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to pause session'),
  });

  const resumeMutation = useMutation({
    mutationFn: (id) => api.post(`/work-sessions/${id}/resume`).then((r) => r.data),
    onSuccess: () => {
      toast.success('Session resumed! 🚀');
      qc.invalidateQueries({ queryKey: ['active-work-session'] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to resume session'),
  });

  const finishMutation = useMutation({
    mutationFn: ({ id, notes }) => api.post(`/work-sessions/${id}/finish`, { notes }).then((r) => r.data),
    onSuccess: (data) => {
      playChime();
      const finalSecs = data?.session?.duration_seconds || 0;
      toast.success(`Session complete! Total time: ${formatDuration(finalSecs)}`);
      setShowFinishModal(false);
      setFinishNotes('');
      qc.invalidateQueries({ queryKey: ['active-work-session'] });
      qc.invalidateQueries({ queryKey: ['work-sessions-history'] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to complete session'),
  });

  const discardMutation = useMutation({
    mutationFn: (id) => api.post(`/work-sessions/${id}/discard`).then((r) => r.data),
    onSuccess: () => {
      toast('Session cancelled', { icon: '🗑️' });
      qc.invalidateQueries({ queryKey: ['active-work-session'] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to discard session'),
  });

  // Calculate target countdown if applicable
  const targetSeconds = (targetMinutes || 25) * 60;
  const remainingSeconds = Math.max(0, targetSeconds - elapsedSeconds);
  const isOvertime = elapsedSeconds > targetSeconds;

  const handleStart = () => {
    startMutation.mutate({
      title: sessionTitle || 'Focus Session',
      request_id: selectedRequestId ? parseInt(selectedRequestId) : null,
      order_id: selectedOrderId ? parseInt(selectedOrderId) : null,
      force_new: true,
    });
  };

  const handlePresetSelect = (preset) => {
    setMode(preset.key);
    setTargetMinutes(preset.minutes);
    if (preset.key === 'focus') setSessionTitle('Crochet Focus Session');
    if (preset.key === 'short_break') setSessionTitle('Short Break');
    if (preset.key === 'long_break') setSessionTitle('Long Break');
  };

  const myRequests = requestsData?.requests || [];
  const allOrders = ordersData?.orders || ordersData || [];
  const historyList = historyData || [];

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Crochet Focus Timer & Work Tracker</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Pomodoro intervals, accurate background-immune tracking, and project session logging for artisans
        </p>
      </div>

      {/* Main Timer Display Card */}
      <div className="card p-8 text-center bg-gradient-to-b from-white to-violet-50/40 border-2 border-violet-100 shadow-xl rounded-3xl relative overflow-hidden">
        {/* Background decorative ring */}
        <div className="absolute -top-24 -right-24 w-64 h-64 bg-violet-200/30 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-fuchsia-200/30 rounded-full blur-3xl pointer-events-none" />

        {/* Preset Selector */}
        {!currentSession && (
          <div className="flex items-center justify-center gap-2 flex-wrap mb-8">
            {PRESET_MODES.map((preset) => (
              <button
                key={preset.key}
                onClick={() => handlePresetSelect(preset)}
                className={`px-4 py-2 rounded-2xl text-xs font-semibold transition-all ${
                  mode === preset.key
                    ? 'bg-violet-600 text-white shadow-md shadow-violet-200'
                    : 'bg-white text-slate-600 border border-slate-200 hover:border-violet-300 hover:bg-slate-50'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}

        {/* Active Session Badge & Title */}
        {currentSession ? (
          <div className="space-y-1 mb-4">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                currentSession.status === 'active'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 animate-pulse'
                  : 'bg-amber-50 text-amber-700 border border-amber-200'
              }`}
            >
              {currentSession.status === 'active' ? '🟢 Session Active' : '⏸️ Session Paused'}
            </span>
            <h2 className="text-xl font-bold text-slate-800">{currentSession.title}</h2>
            {currentSession.request_title && (
              <p className="text-xs text-violet-700 font-semibold">
                📌 Linked Request: {currentSession.request_title}
              </p>
            )}
            {currentSession.order_number && (
              <p className="text-xs text-indigo-700 font-semibold">
                📦 Linked Order: #{currentSession.order_number}
              </p>
            )}
          </div>
        ) : (
          <div className="mb-4">
            <h2 className="text-xl font-bold text-slate-800">{sessionTitle}</h2>
            <p className="text-xs text-slate-400">Target duration: {targetMinutes} minutes</p>
          </div>
        )}

        {/* Big Digital Clock Display */}
        <div className="py-6">
          <div className="text-6xl sm:text-7xl md:text-8xl font-black font-mono tracking-tight text-slate-800 select-none">
            {currentSession
              ? formatDuration(elapsedSeconds)
              : formatDuration(targetMinutes * 60)}
          </div>
          {currentSession && (
            <p className="text-xs text-slate-400 mt-2 font-mono">
              Target: {formatDuration(targetSeconds)} {isOvertime && '• (Overtime)'}
            </p>
          )}
        </div>

        {/* Timer Controls */}
        <div className="flex items-center justify-center gap-3 flex-wrap mt-2">
          {!currentSession ? (
            <button
              onClick={handleStart}
              disabled={startMutation.isPending}
              className="btn-primary px-8 py-3.5 text-base font-bold shadow-lg shadow-violet-200 rounded-2xl hover:scale-105 active:scale-95 transition-transform"
            >
              {startMutation.isPending ? 'Starting…' : '▶ Start Focus Session'}
            </button>
          ) : currentSession.status === 'active' ? (
            <>
              <button
                onClick={() => pauseMutation.mutate(currentSession.id)}
                disabled={pauseMutation.isPending}
                className="btn-secondary px-6 py-3 text-sm font-semibold rounded-2xl bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
              >
                ⏸ Pause
              </button>
              <button
                onClick={() => setShowFinishModal(true)}
                className="btn-primary px-7 py-3 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 shadow-md shadow-emerald-200 rounded-2xl"
              >
                ✅ Finish Session
              </button>
              <button
                onClick={() => {
                  if (window.confirm('Discard this in-progress session? (No time will be logged)')) {
                    discardMutation.mutate(currentSession.id);
                  }
                }}
                className="btn-ghost px-4 py-3 text-xs text-slate-400 hover:text-rose-600 rounded-2xl"
              >
                Discard
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => resumeMutation.mutate(currentSession.id)}
                disabled={resumeMutation.isPending}
                className="btn-primary px-8 py-3 text-sm font-bold rounded-2xl"
              >
                ▶ Resume Work
              </button>
              <button
                onClick={() => setShowFinishModal(true)}
                className="btn-primary px-6 py-3 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 rounded-2xl"
              >
                ✅ Finish Session
              </button>
              <button
                onClick={() => {
                  if (window.confirm('Discard this paused session?')) {
                    discardMutation.mutate(currentSession.id);
                  }
                }}
                className="btn-ghost px-4 py-3 text-xs text-slate-400 hover:text-rose-600 rounded-2xl"
              >
                Discard
              </button>
            </>
          )}
        </div>

        {/* Project Link Settings (when idle) */}
        {!currentSession && (
          <div className="mt-8 pt-6 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
            <div>
              <label className="label text-xs">Session Name</label>
              <input
                type="text"
                value={sessionTitle}
                onChange={(e) => setSessionTitle(e.target.value)}
                className="input text-xs"
                placeholder="e.g. Cardigan Sleeves"
              />
            </div>
            <div>
              <label className="label text-xs">Link Production Request (Optional)</label>
              <select
                value={selectedRequestId}
                onChange={(e) => setSelectedRequestId(e.target.value)}
                className="select text-xs"
              >
                <option value="">No linked request (General work)</option>
                {myRequests.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title} ({r.request_code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label text-xs">Link Order (Optional)</label>
              <select
                value={selectedOrderId}
                onChange={(e) => setSelectedOrderId(e.target.value)}
                className="select text-xs"
              >
                <option value="">No linked order</option>
                {allOrders.map((o) => (
                  <option key={o.id} value={o.id}>
                    Order #{o.order_number} ({o.customer_name || 'Customer'})
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Session History Log Card */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">Completed Work Sessions</h3>
          <span className="text-xs font-mono text-slate-400 font-semibold">
            {historyList.length} logged {historyList.length === 1 ? 'session' : 'sessions'}
          </span>
        </div>

        {historyLoading ? (
          <Spinner />
        ) : historyList.length === 0 ? (
          <div className="text-center py-12 text-slate-400 bg-slate-50 border border-slate-100 rounded-2xl text-xs">
            No completed sessions recorded yet. Start a focus session above to log your hours!
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Session Title</th>
                  <th>Associated Project / Order</th>
                  <th>Duration</th>
                  <th>Date & Time</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {historyList.map((session) => (
                  <tr key={session.id}>
                    <td className="font-semibold text-slate-800">{session.title}</td>
                    <td className="text-xs">
                      {session.request_title && (
                        <span className="inline-block px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 font-medium mr-1.5">
                          📌 {session.request_title}
                        </span>
                      )}
                      {session.order_number && (
                        <span className="inline-block px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-medium">
                          📦 #{session.order_number}
                        </span>
                      )}
                      {!session.request_title && !session.order_number && (
                        <span className="text-slate-400 italic">General Focus</span>
                      )}
                    </td>
                    <td className="font-mono font-bold text-violet-700 text-xs">
                      {formatDuration(session.duration_seconds)}
                    </td>
                    <td className="text-xs text-slate-500 font-mono">
                      {format(parseISO(session.created_at), 'dd MMM yyyy, HH:mm')}
                    </td>
                    <td className="text-xs text-slate-600 max-w-xs truncate" title={session.notes || ''}>
                      {session.notes || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Finish Session Confirmation Modal */}
      {showFinishModal && currentSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800">Finish Focus Session</h3>
            <p className="text-xs text-slate-600">
              Total logged time:{' '}
              <span className="font-bold text-emerald-700 font-mono text-sm">
                {formatDuration(elapsedSeconds)}
              </span>
            </p>

            <div>
              <label className="label text-xs">Session Notes / Work Completed</label>
              <textarea
                rows={3}
                placeholder="e.g. Crocheted 4 floral squares, assembled brim, tension consistent..."
                value={finishNotes}
                onChange={(e) => setFinishNotes(e.target.value)}
                className="input text-xs"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowFinishModal(false)}
                className="btn-secondary flex-1 py-2 text-xs"
              >
                Continue Timer
              </button>
              <button
                type="button"
                onClick={() => finishMutation.mutate({ id: currentSession.id, notes: finishNotes })}
                disabled={finishMutation.isPending}
                className="btn-primary flex-1 py-2 text-xs bg-emerald-600 hover:bg-emerald-700"
              >
                {finishMutation.isPending ? 'Logging…' : 'Save & Finish'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
