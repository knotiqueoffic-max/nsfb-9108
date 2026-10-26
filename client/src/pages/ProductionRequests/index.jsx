import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import api from '../../api/index';
import { useAuthStore } from '../../store/auth';
import { formatCurrency, formatDate, today } from '../../utils/index';

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-7 h-7 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
    </div>
  );
}

function Modal({ title, onClose, children, maxWidth = 'max-w-2xl' }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${maxWidth} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between p-6 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h3 className="font-semibold text-slate-800 text-lg">{title}</h3>
          <button onClick={onClose} className="btn-ghost btn-sm rounded-full w-8 h-8 p-0 flex items-center justify-center text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

const STATUS_BADGES = {
  open:                 { label: 'Open for Bids',    bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  awarded:              { label: 'Awarded (Pending)', bg: 'bg-purple-50 text-purple-700 border-purple-200' },
  accepted:             { label: 'Award Accepted',   bg: 'bg-blue-50 text-blue-700 border-blue-200' },
  in_progress:          { label: 'In Progress',       bg: 'bg-amber-50 text-amber-700 border-amber-200' },
  submitted_for_review: { label: 'In Review',         bg: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  completed:            { label: 'Completed',         bg: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  declined:             { label: 'Award Declined',    bg: 'bg-rose-50 text-rose-700 border-rose-200' },
  cancelled:            { label: 'Cancelled',         bg: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export default function ProductionRequests() {
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const isManager = ['owner', 'admin', 'vendor', 'subvendor', 'super_admin'].includes(user?.role);
  const isCrocheter = user?.role === 'worker';
  const isVendor = user?.role === 'vendor';
  const isSubvendor = user?.role === 'subvendor';
  const isAdmin = ['owner', 'admin', 'super_admin'].includes(user?.role);

  const [activeTab, setActiveTab] = useState(isManager ? 'issued' : 'received');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState(null);
  const [bidModalRequest, setBidModalRequest] = useState(null);
  const [progressModalRequest, setProgressModalRequest] = useState(null);
  const [reviewModalRequest, setReviewModalRequest] = useState(null);

  // Queries
  const { data: issuedData, isLoading: issuedLoading } = useQuery({
    queryKey: ['production-requests', 'issued'],
    queryFn: () => api.get('/production-requests?view=issued').then(r => r.data),
    enabled: isManager,
  });

  const { data: receivedData, isLoading: receivedLoading } = useQuery({
    queryKey: ['production-requests', 'received'],
    queryFn: () => api.get('/production-requests?view=received').then(r => r.data),
  });

  const { data: singleRequestData, isLoading: singleLoading } = useQuery({
    queryKey: ['production-request', selectedRequestId],
    queryFn: () => api.get(`/production-requests/${selectedRequestId}`).then(r => r.data),
    enabled: !!selectedRequestId,
  });

  const { data: productsData } = useQuery({
    queryKey: ['products'],
    queryFn: () => api.get('/products').then(r => r.data),
    enabled: isManager,
  });

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/suppliers').then(r => r.data),
    enabled: isAdmin,
  });

  const { data: subvendorsData } = useQuery({
    queryKey: ['subvendors'],
    queryFn: () => api.get('/tenants/subvendors').then(r => r.data),
    enabled: isVendor,
  });

  const { data: crochetersData } = useQuery({
    queryKey: ['workers'],
    queryFn: () => api.get('/workers').then(r => r.data),
    enabled: isManager,
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data) => api.post('/production-requests', data).then(r => r.data),
    onSuccess: (data) => {
      toast.success(data?.message || 'Production request published!');
      qc.invalidateQueries({ queryKey: ['production-requests'] });
      setShowCreateModal(false);
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to create request'),
  });

  const submitBidMutation = useMutation({
    mutationFn: ({ requestId, data }) => api.post(`/production-requests/${requestId}/bids`, data).then(r => r.data),
    onSuccess: (data) => {
      toast.success(data?.message || 'Bid submitted privately!');
      qc.invalidateQueries({ queryKey: ['production-requests'] });
      qc.invalidateQueries({ queryKey: ['production-request', bidModalRequest?.id] });
      setBidModalRequest(null);
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to submit bid'),
  });

  const awardMutation = useMutation({
    mutationFn: ({ requestId, bidId }) => api.post(`/production-requests/${requestId}/award`, { bid_id: bidId }).then(r => r.data),
    onSuccess: (data) => {
      toast.success(data?.message || 'Request awarded! Awaiting recipient acceptance.');
      qc.invalidateQueries({ queryKey: ['production-requests'] });
      qc.invalidateQueries({ queryKey: ['production-request', selectedRequestId] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to award request'),
  });

  const respondAwardMutation = useMutation({
    mutationFn: ({ requestId, action, reason }) => api.post(`/production-requests/${requestId}/respond-award`, { action, reason }).then(r => r.data),
    onSuccess: (data) => {
      toast.success(data?.message || 'Response recorded!');
      qc.invalidateQueries({ queryKey: ['production-requests'] });
      qc.invalidateQueries({ queryKey: ['production-request', selectedRequestId] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to respond to award'),
  });

  const progressMutation = useMutation({
    mutationFn: ({ requestId, data }) => api.post(`/production-requests/${requestId}/progress`, data).then(r => r.data),
    onSuccess: (data) => {
      toast.success(data?.message || 'Progress logged successfully!');
      qc.invalidateQueries({ queryKey: ['production-requests'] });
      qc.invalidateQueries({ queryKey: ['production-request', progressModalRequest?.id] });
      setProgressModalRequest(null);
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to log progress'),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ requestId, decision, feedback }) => api.post(`/production-requests/${requestId}/review`, { decision, feedback }).then(r => r.data),
    onSuccess: (data) => {
      toast.success(data?.message || 'Review recorded!');
      qc.invalidateQueries({ queryKey: ['production-requests'] });
      qc.invalidateQueries({ queryKey: ['production-request', reviewModalRequest?.id] });
      setReviewModalRequest(null);
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to record review'),
  });

  // Forms
  const { register: regCreate, handleSubmit: handleCreateSubmit, watch: watchCreate, reset: resetCreate, formState: { errors: errorsCreate } } = useForm({
    defaultValues: {
      title: '',
      target_role: isAdmin ? 'vendor' : isVendor ? 'subvendor' : 'worker',
      scope_type: 'all_eligible',
      quantity: 10,
      unit: 'pieces',
      target_price: '',
      submission_deadline: '',
      completion_deadline: '',
      product_id: '',
      specifications: '',
      recipient_ids: [],
    },
  });

  const selectedTargetRole = watchCreate('target_role');
  const selectedScopeType = watchCreate('scope_type');

  const { register: regBid, handleSubmit: handleBidSubmit, reset: resetBid } = useForm();
  const { register: regProgress, handleSubmit: handleProgressSubmit, reset: resetProgress } = useForm();
  const { register: regReview, handleSubmit: handleReviewSubmit, reset: resetReview } = useForm();

  const issuedRequests = issuedData?.requests || [];
  const receivedRequests = receivedData?.requests || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Production Requests & Bidding</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {isManager ? 'Issue production requests, review private bids, and manage hierarchy awards' : 'Browse available production requests, submit private bids, and track assigned work'}
          </p>
        </div>
        {isManager && (
          <button onClick={() => { resetCreate(); setShowCreateModal(true); }} className="btn-primary">
            + Create Production Request
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200 pb-2">
        {isManager && (
          <button
            onClick={() => setActiveTab('issued')}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              activeTab === 'issued' ? 'bg-violet-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            📋 Issued Requests ({issuedRequests.length})
          </button>
        )}
        <button
          onClick={() => setActiveTab('received')}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
            activeTab === 'received' ? 'bg-violet-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          📥 Available Work & My Bids ({receivedRequests.length})
        </button>
      </div>

      {/* ─── ISSUED REQUESTS VIEW (Managers) ──────────────────────────────────── */}
      {activeTab === 'issued' && isManager && (
        <div>
          {issuedLoading ? (
            <Spinner />
          ) : issuedRequests.length === 0 ? (
            <div className="card text-center py-16">
              <p className="text-4xl mb-3">📝</p>
              <p className="text-slate-600 font-medium">No production requests issued yet.</p>
              <p className="text-slate-400 text-sm mt-1">Create your first request to invite competitive bids from vendors or crocheters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {issuedRequests.map((req) => {
                const badge = STATUS_BADGES[req.status] || { label: req.status, bg: 'bg-slate-100 text-slate-600' };
                return (
                  <div key={req.id} className="card hover:shadow-md transition-shadow flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span className="text-xs font-mono font-bold text-slate-400">{req.request_code}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${badge.bg}`}>
                          {badge.label}
                        </span>
                      </div>
                      <h3 className="font-bold text-slate-800 text-base line-clamp-1">{req.title}</h3>
                      {req.product_name && (
                        <p className="text-xs text-violet-700 font-medium mt-0.5">Product: {req.product_name} ({req.sku})</p>
                      )}
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
                        <div>
                          <p className="text-slate-400">Target Role</p>
                          <p className="font-semibold text-slate-700 capitalize">{req.target_role === 'worker' ? 'Crocheter' : req.target_role}</p>
                        </div>
                        <div>
                          <p className="text-slate-400">Quantity</p>
                          <p className="font-semibold text-slate-700">{req.quantity} {req.unit}</p>
                        </div>
                        <div>
                          <p className="text-slate-400">Bids Received</p>
                          <p className="font-semibold text-violet-700 font-mono text-sm">{req.bid_count} {req.bid_count === 1 ? 'quote' : 'quotes'}</p>
                        </div>
                        <div>
                          <p className="text-slate-400">Deadline</p>
                          <p className="font-semibold text-slate-700">{formatDate(req.submission_deadline)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
                      <button
                        onClick={() => setSelectedRequestId(req.id)}
                        className="btn-secondary btn-sm w-full py-2"
                      >
                        🔍 View Bids & Manage
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── RECEIVED REQUESTS VIEW (Recipients / Bidders) ────────────────────── */}
      {activeTab === 'received' && (
        <div>
          {receivedLoading ? (
            <Spinner />
          ) : receivedRequests.length === 0 ? (
            <div className="card text-center py-16">
              <p className="text-4xl mb-3">📬</p>
              <p className="text-slate-600 font-medium">No incoming production requests.</p>
              <p className="text-slate-400 text-sm mt-1">When an organization issues work targeting your role, it will appear here for private bidding.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {receivedRequests.map((req) => {
                const badge = STATUS_BADGES[req.status] || { label: req.status, bg: 'bg-slate-100 text-slate-600' };
                const hasMyBid = !!req.my_bid;
                const isAwardedToMe = req.my_bid?.status === 'awarded';
                const isAcceptedByMe = req.my_bid?.status === 'accepted';

                return (
                  <div key={req.id} className="card hover:shadow-md transition-shadow flex flex-col justify-between border-slate-200">
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span className="text-xs font-mono font-bold text-slate-400">{req.request_code}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${badge.bg}`}>
                          {badge.label}
                        </span>
                      </div>
                      <h3 className="font-bold text-slate-800 text-base">{req.title}</h3>
                      {req.product_name && (
                        <p className="text-xs text-violet-700 font-medium mt-0.5">Item: {req.product_name}</p>
                      )}

                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
                        <div>
                          <p className="text-slate-400">Required Qty</p>
                          <p className="font-semibold text-slate-800">{req.quantity} {req.unit}</p>
                        </div>
                        <div>
                          <p className="text-slate-400">Bid Deadline</p>
                          <p className="font-semibold text-slate-800">{formatDate(req.submission_deadline)}</p>
                        </div>
                        {req.target_price && (
                          <div>
                            <p className="text-slate-400">Target Budget</p>
                            <p className="font-semibold text-emerald-700">{formatCurrency(req.target_price)}</p>
                          </div>
                        )}
                        <div>
                          <p className="text-slate-400">Completion By</p>
                          <p className="font-semibold text-slate-800">{formatDate(req.completion_deadline)}</p>
                        </div>
                      </div>

                      {/* My Bid Status Pill */}
                      {hasMyBid && (
                        <div className="mt-4 p-2.5 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-between text-xs">
                          <div>
                            <span className="text-violet-600 font-semibold">Your Bid: </span>
                            <span className="font-bold text-slate-800">{formatCurrency(req.my_bid.proposed_price)}</span>
                          </div>
                          <span className="capitalize font-semibold text-violet-700 font-mono">
                            Status: {req.my_bid.status.replace('_', ' ')}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="mt-5 pt-3 border-t border-slate-100 flex flex-col gap-2">
                      {/* Bid Actions */}
                      {req.status === 'open' && !hasMyBid && (
                        <button
                          onClick={() => { resetBid({ proposed_price: req.target_price || '', quantity: req.quantity, estimated_completion_date: req.completion_deadline?.split('T')[0] }); setBidModalRequest(req); }}
                          className="btn-primary btn-sm w-full py-2"
                        >
                          💼 Submit Private Bid
                        </button>
                      )}

                      {/* Award Acceptance Actions */}
                      {isAwardedToMe && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => respondAwardMutation.mutate({ requestId: req.id, action: 'accept' })}
                            disabled={respondAwardMutation.isPending}
                            className="btn-primary btn-sm flex-1 py-2 bg-emerald-600 hover:bg-emerald-700"
                          >
                            ✅ Accept Award
                          </button>
                          <button
                            onClick={() => {
                              const reason = window.prompt('Reason for declining award:');
                              if (reason !== null) {
                                respondAwardMutation.mutate({ requestId: req.id, action: 'decline', reason });
                              }
                            }}
                            disabled={respondAwardMutation.isPending}
                            className="btn-secondary btn-sm py-2 text-rose-600 hover:bg-rose-50 border-rose-200"
                          >
                            Decline
                          </button>
                        </div>
                      )}

                      {/* Progress Reporting Actions */}
                      {isAcceptedByMe && ['accepted', 'in_progress'].includes(req.status) && (
                        <button
                          onClick={() => { resetProgress(); setProgressModalRequest(req); }}
                          className="btn-primary btn-sm w-full py-2 bg-amber-600 hover:bg-amber-700"
                        >
                          🔨 Report Progress / Submit Work
                        </button>
                      )}

                      <button
                        onClick={() => setSelectedRequestId(req.id)}
                        className="btn-secondary btn-sm w-full py-1.5 text-xs text-slate-600"
                      >
                        Inspect Specifications
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── CREATE REQUEST MODAL (Issuer only) ─────────────────────────────────── */}
      {showCreateModal && (
        <Modal title="Create Production Request" onClose={() => setShowCreateModal(false)}>
          <form onSubmit={handleCreateSubmit((d) => createMutation.mutate(d))} className="space-y-4">
            <div>
              <label className="label">Request Title *</label>
              <input
                className="input"
                placeholder="e.g. 50 Crochet Baby Cardigans"
                {...regCreate('title', { required: 'Title is required' })}
              />
              {errorsCreate.title && <p className="text-rose-500 text-xs mt-1">{errorsCreate.title.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Target Tier *</label>
                <select className="select" {...regCreate('target_role', { required: true })}>
                  {isAdmin && <option value="vendor">Vendor Suppliers</option>}
                  {isVendor && <option value="subvendor">Subcontractor Guilds</option>}
                  <option value="worker">Crocheters (Direct)</option>
                </select>
              </div>
              <div>
                <label className="label">Recipient Scope *</label>
                <select className="select" {...regCreate('scope_type', { required: true })}>
                  <option value="all_eligible">Broadcast to All Eligible in Scope</option>
                  <option value="specific">Choose Specific Recipients</option>
                </select>
              </div>
            </div>

            {/* Specific Recipient Selection */}
            {selectedScopeType === 'specific' && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <p className="text-xs font-semibold text-slate-700">Select Authorized Recipients:</p>
                {selectedTargetRole === 'vendor' && (
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {(suppliersData?.linked_suppliers || []).map(s => (
                      <label key={s.vendor_tenant_id} className="flex items-center gap-2 text-xs text-slate-700">
                        <input type="checkbox" value={s.vendor_tenant_id} {...regCreate('recipient_ids')} />
                        <span>{s.name} ({s.category || 'Vendor'})</span>
                      </label>
                    ))}
                    {(suppliersData?.linked_suppliers || []).length === 0 && (
                      <p className="text-xs text-slate-400">No linked vendor suppliers found.</p>
                    )}
                  </div>
                )}
                {selectedTargetRole === 'subvendor' && (
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {(subvendorsData || []).map(sv => (
                      <label key={sv.id} className="flex items-center gap-2 text-xs text-slate-700">
                        <input type="checkbox" value={sv.id} {...regCreate('recipient_ids')} />
                        <span>{sv.name}</span>
                      </label>
                    ))}
                    {(subvendorsData || []).length === 0 && (
                      <p className="text-xs text-slate-400">No subvendor organizations linked.</p>
                    )}
                  </div>
                )}
                {selectedTargetRole === 'worker' && (
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {(crochetersData || []).map(c => (
                      <label key={c.id} className="flex items-center gap-2 text-xs text-slate-700">
                        <input type="checkbox" value={c.id} {...regCreate('recipient_ids')} />
                        <span>{c.name} ({c.email})</span>
                      </label>
                    ))}
                    {(crochetersData || []).length === 0 && (
                      <p className="text-xs text-slate-400">No active crocheters found.</p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">Quantity *</label>
                <input type="number" min="1" className="input" {...regCreate('quantity', { required: true, min: 1 })} />
              </div>
              <div>
                <label className="label">Unit</label>
                <input className="input" placeholder="pieces" {...regCreate('unit')} />
              </div>
              <div>
                <label className="label">Target Budget (₹)</label>
                <input type="number" step="0.5" className="input" placeholder="Optional" {...regCreate('target_price')} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Bid Submission Deadline *</label>
                <input type="date" className="input" {...regCreate('submission_deadline', { required: true })} />
              </div>
              <div>
                <label className="label">Production Delivery Deadline *</label>
                <input type="date" className="input" {...regCreate('completion_deadline', { required: true })} />
              </div>
            </div>

            <div>
              <label className="label">Catalog Product (Optional)</label>
              <select className="select" {...regCreate('product_id')}>
                <option value="">No linked product (custom request)</option>
                {(productsData || []).map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Specifications & Quality Criteria</label>
              <textarea className="input" rows={3} placeholder="Stitch tension, yarn gauge, dimensions, packaging requirements..." {...regCreate('specifications')} />
            </div>

            <button type="submit" disabled={createMutation.isPending} className="btn-primary w-full py-3">
              {createMutation.isPending ? 'Publishing Request…' : '🚀 Publish Production Request'}
            </button>
          </form>
        </Modal>
      )}

      {/* ─── SUBMIT PRIVATE BID MODAL ─────────────────────────────────────────── */}
      {bidModalRequest && (
        <Modal title={`Submit Private Bid — ${bidModalRequest.request_code}`} onClose={() => setBidModalRequest(null)} maxWidth="max-w-md">
          <form onSubmit={handleBidSubmit((d) => submitBidMutation.mutate({ requestId: bidModalRequest.id, data: d }))} className="space-y-4">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
              <p className="font-semibold text-slate-800">{bidModalRequest.title}</p>
              <p className="text-slate-500">Requested Quantity: {bidModalRequest.quantity} {bidModalRequest.unit}</p>
              {bidModalRequest.target_price && (
                <p className="text-emerald-700 font-medium">Target Price: {formatCurrency(bidModalRequest.target_price)} / unit</p>
              )}
            </div>

            <div>
              <label className="label">Proposed Price Per Unit (₹) *</label>
              <input type="number" step="0.01" min="0.01" className="input font-semibold text-lg" {...regBid('proposed_price', { required: true })} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Quantity Capable *</label>
                <input type="number" min="1" className="input" {...regBid('quantity', { required: true, min: 1 })} />
              </div>
              <div>
                <label className="label">Estimated Delivery *</label>
                <input type="date" className="input" {...regBid('estimated_completion_date', { required: true })} />
              </div>
            </div>

            <div>
              <label className="label">Notes / Proposal Details</label>
              <textarea className="input" rows={2} placeholder="Yarn sourcing, lead time, or quality assurances..." {...regBid('notes')} />
            </div>

            <p className="text-[11px] text-slate-400">
              🔒 Bids are strictly confidential. Competitor bidders will never see your quote, terms, or identity.
            </p>

            <button type="submit" disabled={submitBidMutation.isPending} className="btn-primary w-full py-2.5">
              {submitBidMutation.isPending ? 'Submitting Confidential Bid…' : '💼 Submit Private Bid'}
            </button>
          </form>
        </Modal>
      )}

      {/* ─── REPORT PROGRESS MODAL ───────────────────────────────────────────── */}
      {progressModalRequest && (
        <Modal title={`Report Progress — ${progressModalRequest.request_code}`} onClose={() => setProgressModalRequest(null)} maxWidth="max-w-md">
          <form onSubmit={handleProgressSubmit((d) => progressMutation.mutate({ requestId: progressModalRequest.id, data: d }))} className="space-y-4">
            <div>
              <label className="label">Quantity Completed to Date *</label>
              <input type="number" min="1" max={progressModalRequest.quantity} className="input text-lg font-bold" {...regProgress('quantity_completed', { required: true })} />
              <p className="text-xs text-slate-400 mt-1">Total ordered quantity: {progressModalRequest.quantity} {progressModalRequest.unit}</p>
            </div>

            <div>
              <label className="label">Progress Notes</label>
              <textarea className="input" rows={2} placeholder="Batch updates, packaging progress, quality notes..." {...regProgress('notes')} />
            </div>

            <label className="flex items-center gap-2 p-3 bg-violet-50 border border-violet-200 rounded-xl cursor-pointer">
              <input type="checkbox" className="w-4 h-4 text-violet-600 rounded" {...regProgress('submit_for_review')} />
              <div className="text-xs">
                <span className="font-bold text-violet-900 block">Submit Finished Work for Review</span>
                <span className="text-violet-700">Check this box when the complete batch is finished and ready for supervisor inspection.</span>
              </div>
            </label>

            <button type="submit" disabled={progressMutation.isPending} className="btn-primary w-full py-2.5">
              {progressMutation.isPending ? 'Saving…' : '✅ Submit Progress'}
            </button>
          </form>
        </Modal>
      )}

      {/* ─── REVIEW WORK MODAL ────────────────────────────────────────────────── */}
      {reviewModalRequest && (
        <Modal title={`Review Completed Work — ${reviewModalRequest.request_code}`} onClose={() => setReviewModalRequest(null)} maxWidth="max-w-md">
          <form onSubmit={handleReviewSubmit((d) => reviewMutation.mutate({ requestId: reviewModalRequest.id, ...d }))} className="space-y-4">
            <div>
              <label className="label">Review Decision *</label>
              <select className="select font-semibold" {...regReview('decision', { required: true })}>
                <option value="approve">✅ Approve & Mark Completed (Receive Stock)</option>
                <option value="request_correction">⚠️ Request Correction / Fix Issues</option>
              </select>
            </div>

            <div>
              <label className="label">Feedback / Inspection Notes</label>
              <textarea className="input" rows={3} placeholder="Quality remarks, defect notes, or delivery verification..." {...regReview('feedback')} />
            </div>

            <button type="submit" disabled={reviewMutation.isPending} className="btn-primary w-full py-2.5">
              {reviewMutation.isPending ? 'Recording Decision…' : 'Submit Review'}
            </button>
          </form>
        </Modal>
      )}

      {/* ─── SINGLE REQUEST DETAILS & BIDS DRAWER ──────────────────────────────── */}
      {selectedRequestId && (
        <Modal title={`Request Details — ${singleRequestData?.request?.request_code || ''}`} onClose={() => setSelectedRequestId(null)}>
          {singleLoading ? (
            <Spinner />
          ) : !singleRequestData ? (
            <p className="text-center text-slate-400 py-6">Request not found.</p>
          ) : (
            <div className="space-y-6">
              {/* Request Metadata */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-800 text-lg">{singleRequestData.request.title}</h3>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_BADGES[singleRequestData.request.status]?.bg}`}>
                    {STATUS_BADGES[singleRequestData.request.status]?.label || singleRequestData.request.status}
                  </span>
                </div>
                {singleRequestData.request.product_name && (
                  <p className="text-xs text-violet-700 font-medium">Linked Product: {singleRequestData.request.product_name} ({singleRequestData.request.sku})</p>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-slate-500 pt-2 border-t border-slate-200">
                  <div>
                    <span className="text-slate-400 block">Quantity</span>
                    <span className="font-semibold text-slate-800">{singleRequestData.request.quantity} {singleRequestData.request.unit}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Bid Deadline</span>
                    <span className="font-semibold text-slate-800">{formatDate(singleRequestData.request.submission_deadline)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Delivery Deadline</span>
                    <span className="font-semibold text-slate-800">{formatDate(singleRequestData.request.completion_deadline)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Target Budget</span>
                    <span className="font-semibold text-emerald-700">{singleRequestData.request.target_price ? formatCurrency(singleRequestData.request.target_price) : 'N/A'}</span>
                  </div>
                </div>
                {singleRequestData.request.specifications && (
                  <div className="pt-2 text-xs text-slate-600">
                    <span className="font-semibold block text-slate-700">Specifications:</span>
                    <p className="whitespace-pre-wrap mt-0.5">{singleRequestData.request.specifications}</p>
                  </div>
                )}
              </div>

              {/* Issuer Actions: Review if in review state */}
              {singleRequestData.is_issuer && singleRequestData.request.status === 'submitted_for_review' && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between">
                  <div>
                    <p className="font-bold text-amber-900 text-sm">Finished Work Awaiting Inspection</p>
                    <p className="text-xs text-amber-700">The assigned recipient has submitted this order for your final approval.</p>
                  </div>
                  <button
                    onClick={() => setReviewModalRequest(singleRequestData.request)}
                    className="btn-primary btn-sm py-2 bg-emerald-600 hover:bg-emerald-700"
                  >
                    🔍 Inspect & Review
                  </button>
                </div>
              )}

              {/* Bids List (Issuer Only) */}
              {singleRequestData.is_issuer ? (
                <div>
                  <h4 className="font-semibold text-slate-800 mb-3 flex items-center justify-between">
                    <span>Submitted Private Bids ({singleRequestData.bids?.length || 0})</span>
                    <span className="text-xs text-slate-400 font-normal">Sorted by lowest proposed price</span>
                  </h4>

                  {(!singleRequestData.bids || singleRequestData.bids.length === 0) ? (
                    <div className="p-6 text-center bg-slate-50 border border-slate-100 rounded-xl text-slate-400 text-xs">
                      No bids received yet. Bidders in your authorized network have been notified.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {singleRequestData.bids.map((bid) => {
                        const isAwardedBid = bid.id === singleRequestData.request.awarded_bid_id;
                        return (
                          <div
                            key={bid.id}
                            className={`p-4 rounded-xl border transition-all ${
                              isAwardedBid ? 'border-purple-300 bg-purple-50/50' : 'border-slate-200 bg-white hover:border-slate-300'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-slate-800 text-sm">{bid.bidder_user_name || 'Artisan / Vendor'}</span>
                                  <span className="text-xs text-slate-400 font-mono">({bid.bidder_type})</span>
                                  {isAwardedBid && (
                                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">
                                      🏆 Awarded
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-slate-500 mt-1">Est. Delivery: {formatDate(bid.estimated_completion_date)}</p>
                                {bid.notes && <p className="text-xs text-slate-600 italic mt-1">"{bid.notes}"</p>}
                              </div>

                              <div className="text-right flex flex-col items-end gap-2">
                                <div>
                                  <span className="text-lg font-bold text-emerald-700">{formatCurrency(bid.proposed_price)}</span>
                                  <span className="text-xs text-slate-400 block">for {bid.quantity} units</span>
                                </div>

                                {['open', 'declined'].includes(singleRequestData.request.status) && (
                                  <button
                                    onClick={() => {
                                      if (window.confirm(`Award this request to ${bid.bidder_user_name} at ${formatCurrency(bid.proposed_price)} per unit?`)) {
                                        awardMutation.mutate({ requestId: singleRequestData.request.id, bidId: bid.id });
                                      }
                                    }}
                                    disabled={awardMutation.isPending}
                                    className="btn-primary btn-sm py-1.5 px-3 text-xs"
                                  >
                                    🏆 Award Request
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                /* Recipient / Bidder View */
                <div>
                  {singleRequestData.my_bid ? (
                    <div className="p-4 bg-violet-50 border border-violet-200 rounded-xl space-y-2">
                      <p className="text-xs font-bold text-violet-900 uppercase">Your Confidential Bid Details</p>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-slate-400 block">Quoted Unit Price:</span>
                          <span className="font-bold text-slate-800 text-sm">{formatCurrency(singleRequestData.my_bid.proposed_price)}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Offered Quantity:</span>
                          <span className="font-semibold text-slate-800">{singleRequestData.my_bid.quantity} units</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Est. Completion:</span>
                          <span className="font-semibold text-slate-800">{formatDate(singleRequestData.my_bid.estimated_completion_date)}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Bid Status:</span>
                          <span className="font-bold text-violet-700 capitalize">{singleRequestData.my_bid.status.replace('_', ' ')}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 italic">You have not submitted a bid on this request yet.</p>
                  )}
                </div>
              )}

              {/* Progress History */}
              {(singleRequestData.progress_logs?.length || 0) > 0 && (
                <div>
                  <h4 className="font-semibold text-slate-800 mb-2 text-sm">Progress & Review History</h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {singleRequestData.progress_logs.map(log => (
                      <div key={log.id} className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-700">Completed {log.quantity_completed} units</span>
                          <span className="text-slate-400 font-mono">{formatDate(log.created_at)}</span>
                        </div>
                        {log.notes && <p className="text-slate-600">Note: {log.notes}</p>}
                        {log.feedback && <p className="text-violet-700 font-medium">Supervisor Feedback: {log.feedback}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
