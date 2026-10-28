import { useState, useEffect, useRef } from 'react';
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
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className={`bg-white rounded-2xl shadow-2xl border border-slate-100 w-full ${maxWidth} my-8 overflow-hidden animate-scale-in`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h3 className="font-bold text-slate-800 text-lg">{title}</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            ✕
          </button>
        </div>
        <div className="p-6 max-h-[80vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

const STATUS_BADGES = {
  draft:                { label: 'Draft', bg: 'bg-slate-100 text-slate-600 border-slate-200' },
  open:                 { label: 'Open for Bids', bg: 'bg-blue-100 text-blue-700 border-blue-200' },
  awarded:              { label: 'Awarded — Awaiting Acceptance', bg: 'bg-amber-100 text-amber-800 border-amber-300' },
  accepted:             { label: 'Accepted — In Production', bg: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  in_progress:          { label: 'In Progress', bg: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  submitted_for_review: { label: 'Under Review', bg: 'bg-purple-100 text-purple-700 border-purple-200' },
  approved:             { label: 'Approved', bg: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  completed:            { label: 'Completed', bg: 'bg-emerald-200 text-emerald-900 border-emerald-300' },
  declined:             { label: 'Award Declined', bg: 'bg-rose-100 text-rose-700 border-rose-200' },
  cancelled:            { label: 'Cancelled', bg: 'bg-slate-100 text-slate-500 border-slate-200' },
  expired:              { label: 'Expired', bg: 'bg-slate-100 text-slate-500 border-slate-200' },
};

const SUBMISSION_STATUS_BADGES = {
  pending_approval: { label: '⏳ Pending Approval', bg: 'bg-amber-100 text-amber-800 border-amber-300' },
  approved:         { label: '✅ Approved', bg: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  rejected:         { label: '⚠️ Changes Requested', bg: 'bg-rose-100 text-rose-800 border-rose-300' },
};

export default function ProductionRequests() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  const isManager = ['owner', 'admin', 'vendor', 'subvendor', 'super_admin'].includes(user?.role);
  const isCrocheter = user?.role === 'worker';
  const isVendor = user?.role === 'vendor';
  const isSubvendor = user?.role === 'subvendor';
  const isAdmin = ['owner', 'admin', 'super_admin'].includes(user?.role);

  const [activeTab, setActiveTab] = useState(isManager ? 'issued' : 'received');

  // Guard: if non-manager user ever has activeTab set to 'issued' or 'approvals', reset it to 'received'
  useEffect(() => {
    if (!isManager && activeTab !== 'received') {
      setActiveTab('received');
    }
  }, [isManager, activeTab]);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState(null);
  const [bidModalRequest, setBidModalRequest] = useState(null);
  const [progressModalRequest, setProgressModalRequest] = useState(null);
  const [reviewModalRequest, setReviewModalRequest] = useState(null);

  // Work Submission Upload & Review State
  const [uploadModalRequest, setUploadModalRequest] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [filePreviews, setFilePreviews] = useState([]);
  const [submissionNotes, setSubmissionNotes] = useState('');
  const [submissionQty, setSubmissionQty] = useState('');
  const [lightboxMedia, setLightboxMedia] = useState(null);
  const [reviewNotesMap, setReviewNotesMap] = useState({});
  const fileInputRef = useRef(null);

  // Queries
  const { data: issuedData, isLoading: issuedLoading } = useQuery({
    queryKey: ['production-requests', 'issued'],
    queryFn: () => api.get('/production-requests?view=issued').then((r) => r.data),
    enabled: isManager,
  });

  const {
    data: receivedData,
    isLoading: receivedLoading,
    isError: receivedError,
    error: receivedErrorObj,
    refetch: refetchReceived,
  } = useQuery({
    queryKey: ['production-requests', 'received'],
    queryFn: () => api.get('/production-requests?view=received').then((r) => r.data),
  });

  const { data: approvalsData, isLoading: approvalsLoading } = useQuery({
    queryKey: ['production-requests', 'approvals-queue'],
    queryFn: () => api.get('/production-requests/approvals/queue').then((r) => r.data),
    enabled: isManager,
    refetchInterval: 15000,
  });
  const approvalsQueue = approvalsData?.queue || [];
  const pendingApprovalsCount = approvalsQueue.length;

  const { data: singleRequestData, isLoading: singleLoading } = useQuery({
    queryKey: ['production-request', selectedRequestId],
    queryFn: () => api.get(`/production-requests/${selectedRequestId}`).then((r) => r.data),
    enabled: !!selectedRequestId,
  });

  const { data: productsData } = useQuery({
    queryKey: ['products'],
    queryFn: () => api.get('/products').then((r) => r.data),
    enabled: isManager,
  });

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/suppliers').then((r) => r.data),
    enabled: isAdmin,
  });

  const { data: subvendorsData } = useQuery({
    queryKey: ['subvendors'],
    queryFn: () => api.get('/tenants/subvendors').then((r) => r.data),
    enabled: isVendor,
  });

  const { data: crochetersData } = useQuery({
    queryKey: ['workers'],
    queryFn: () => api.get('/workers').then((r) => r.data),
    enabled: isManager,
  });

  // Handle file selection and preview generation
  const handleFilesChosen = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    // Validate size (max 50MB per file) and formats
    const validFiles = [];
    const newPreviews = [];

    files.forEach((file) => {
      if (file.size > 50 * 1024 * 1024) {
        toast.error(`"${file.name}" exceeds the 50MB size limit`);
        return;
      }
      const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(file.name);
      const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(file.name);
      if (!isImage && !isVideo) {
        toast.error(`"${file.name}" is not a supported image or video file`);
        return;
      }
      validFiles.push(file);
      newPreviews.push({
        file,
        url: URL.createObjectURL(file),
        isVideo,
        name: file.name,
        size: (file.size / (1024 * 1024)).toFixed(1),
      });
    });

    setSelectedFiles((prev) => [...prev, ...validFiles]);
    setFilePreviews((prev) => [...prev, ...newPreviews]);
  };

  const removeSelectedFile = (index) => {
    const item = filePreviews[index];
    if (item?.url) URL.revokeObjectURL(item.url);
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setFilePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data) => api.post('/production-requests', data).then((r) => r.data),
    onSuccess: (data) => {
      toast.success(data?.message || 'Production request published!');
      qc.invalidateQueries({ queryKey: ['production-requests'] });
      setShowCreateModal(false);
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to create request'),
  });

  const submitBidMutation = useMutation({
    mutationFn: ({ requestId, data }) => api.post(`/production-requests/${requestId}/bids`, data).then((r) => r.data),
    onSuccess: (data) => {
      toast.success(data?.message || 'Bid submitted privately!');
      qc.invalidateQueries({ queryKey: ['production-requests'] });
      qc.invalidateQueries({ queryKey: ['production-request', bidModalRequest?.id] });
      setBidModalRequest(null);
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to submit bid'),
  });

  const awardMutation = useMutation({
    mutationFn: ({ requestId, bidId }) => api.post(`/production-requests/${requestId}/award`, { bid_id: bidId }).then((r) => r.data),
    onSuccess: (data) => {
      toast.success(data?.message || 'Request awarded! Awaiting recipient acceptance.');
      qc.invalidateQueries({ queryKey: ['production-requests'] });
      qc.invalidateQueries({ queryKey: ['production-request', selectedRequestId] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to award request'),
  });

  const respondAwardMutation = useMutation({
    mutationFn: ({ requestId, action, reason }) => api.post(`/production-requests/${requestId}/respond-award`, { action, reason }).then((r) => r.data),
    onSuccess: (data) => {
      toast.success(data?.message || 'Response recorded!');
      qc.invalidateQueries({ queryKey: ['production-requests'] });
      qc.invalidateQueries({ queryKey: ['production-request', selectedRequestId] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to respond to award'),
  });

  const progressMutation = useMutation({
    mutationFn: ({ requestId, data }) => api.post(`/production-requests/${requestId}/progress`, data).then((r) => r.data),
    onSuccess: (data) => {
      toast.success(data?.message || 'Progress logged successfully!');
      qc.invalidateQueries({ queryKey: ['production-requests'] });
      qc.invalidateQueries({ queryKey: ['production-request', progressModalRequest?.id] });
      setProgressModalRequest(null);
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to log progress'),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ requestId, decision, feedback }) => api.post(`/production-requests/${requestId}/review`, { decision, feedback }).then((r) => r.data),
    onSuccess: (data) => {
      toast.success(data?.message || 'Review recorded!');
      qc.invalidateQueries({ queryKey: ['production-requests'] });
      qc.invalidateQueries({ queryKey: ['production-request', reviewModalRequest?.id] });
      setReviewModalRequest(null);
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to record review'),
  });

  // Upload Work Submission (Unlimited Uploads)
  const uploadSubmissionMutation = useMutation({
    mutationFn: async ({ requestId, files, notes, quantity_completed }) => {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      if (notes) fd.append('notes', notes);
      if (quantity_completed) fd.append('quantity_completed', quantity_completed);
      return api.post(`/production-requests/${requestId}/submissions`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then((r) => r.data);
    },
    onSuccess: (data) => {
      toast.success(data?.message || 'Proof of work submitted successfully for approval!');
      qc.invalidateQueries({ queryKey: ['production-requests'] });
      qc.invalidateQueries({ queryKey: ['production-request', uploadModalRequest?.id] });
      qc.invalidateQueries({ queryKey: ['production-requests', 'approvals-queue'] });
      setUploadModalRequest(null);
      setSelectedFiles([]);
      setFilePreviews([]);
      setSubmissionNotes('');
      setSubmissionQty('');
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to upload work submission'),
  });

  // Admin Review Submission (Approve / Request Changes)
  const reviewSubmissionMutation = useMutation({
    mutationFn: ({ requestId, submissionId, status, reviewer_notes }) =>
      api.patch(`/production-requests/${requestId}/submissions/${submissionId}/review`, {
        status,
        reviewer_notes,
      }).then((r) => r.data),
    onSuccess: (data) => {
      toast.success(data?.message || 'Review recorded successfully!');
      qc.invalidateQueries({ queryKey: ['production-requests'] });
      qc.invalidateQueries({ queryKey: ['production-request', selectedRequestId] });
      qc.invalidateQueries({ queryKey: ['production-requests', 'approvals-queue'] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to review submission'),
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
      specifications: '',
      required_materials: '',
      recipient_ids: [],
    },
  });

  const { register: regBid, handleSubmit: handleBidSubmit, reset: resetBid } = useForm();
  const { register: regProgress, handleSubmit: handleProgressSubmit, reset: resetProgress } = useForm();
  const { register: regReview, handleSubmit: handleReviewSubmit, reset: resetReview } = useForm();

  const issuedRequests = issuedData?.requests || [];
  const receivedRequests = receivedData?.requests || [];
  const selectedScopeType = watchCreate('scope_type');
  const selectedTargetRole = watchCreate('target_role');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight">Production Requests & Approvals</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {isManager
              ? 'Issue production requests, review worker proof-of-work, and inspect competitive quotes.'
              : 'View assigned production work, submit proof-of-work photos & videos, and track approvals.'}
          </p>
        </div>

        {isManager && (
          <button
            onClick={() => { resetCreate(); setShowCreateModal(true); }}
            className="btn-primary flex items-center gap-2 self-start sm:self-auto shadow-sm"
          >
            <span>➕</span>
            <span>Issue Production Request</span>
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200 pb-2 flex-wrap">
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
          📥 Available Work & My Bids {receivedLoading ? '(…)' : `(${receivedRequests.length})`}
        </button>

        {isManager && (
          <button
            onClick={() => setActiveTab('approvals')}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${
              activeTab === 'approvals' ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span>🛡️ Production Approvals</span>
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                activeTab === 'approvals'
                  ? 'bg-white text-amber-700'
                  : pendingApprovalsCount > 0
                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                  : 'bg-slate-200 text-slate-700'
              }`}
            >
              {approvalsLoading ? '…' : pendingApprovalsCount}
            </span>
          </button>
        )}
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
              <p className="text-slate-400 text-sm mt-1">Click "Issue Production Request" to publish requirements to vendors, subvendors, or crocheters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {issuedRequests.map((req) => {
                const badge = STATUS_BADGES[req.status] || { label: req.status, bg: 'bg-slate-100 text-slate-600' };
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
                        <p className="text-xs text-slate-500 mt-0.5">Product: <span className="font-medium text-slate-700">{req.product_name}</span> ({req.sku})</p>
                      )}
                      <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-slate-100 text-xs">
                        <div>
                          <span className="text-slate-400 block">Quantity</span>
                          <span className="font-semibold text-slate-700">{req.quantity} {req.unit}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Target Role</span>
                          <span className="font-semibold text-slate-700 capitalize">{req.target_role}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Bids Received</span>
                          <span className="font-bold text-violet-700">{req.bids_count || 0}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Deadline</span>
                          <span className="font-semibold text-slate-700">{formatDate(req.submission_deadline)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 pt-3 border-t border-slate-100 flex gap-2">
                      <button
                        onClick={() => setSelectedRequestId(req.id)}
                        className="btn-primary btn-sm flex-1 py-1.5 text-xs text-center justify-center"
                      >
                        Inspect Details & Bids ({req.bids_count || 0})
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── RECEIVED REQUESTS VIEW (Recipients / Bidders / Crocheters) ────────── */}
      {activeTab === 'received' && (
        <div>
          {receivedLoading ? (
            <div className="py-16 flex flex-col items-center justify-center space-y-3">
              <div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
              <p className="text-sm font-medium text-slate-500">Checking for available production requests…</p>
            </div>
          ) : receivedError ? (
            <div className="card text-center py-12 border-rose-200 bg-rose-50/40">
              <p className="text-3xl mb-2">⚠️</p>
              <p className="text-rose-700 font-semibold">Unable to load production requests</p>
              <p className="text-slate-500 text-sm mt-1 max-w-md mx-auto">
                {receivedErrorObj?.response?.data?.error || receivedErrorObj?.message || 'A network error or connection timeout occurred while contacting the server.'}
              </p>
              <button
                onClick={() => refetchReceived()}
                className="mt-4 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors"
              >
                🔄 Retry
              </button>
            </div>
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
                        <p className="text-xs text-slate-500 mt-0.5">Product: <span className="font-medium text-slate-700">{req.product_name}</span> ({req.sku})</p>
                      )}
                      <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-slate-100 text-xs">
                        <div>
                          <span className="text-slate-400 block">Required Quantity</span>
                          <span className="font-semibold text-slate-700">{req.quantity} {req.unit}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Target Unit Price</span>
                          <span className="font-semibold text-emerald-700 font-mono">
                            {req.target_price ? formatCurrency(req.target_price) : 'Open'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Bidding Deadline</span>
                          <span className="font-semibold text-slate-700">{formatDate(req.submission_deadline)}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Delivery Deadline</span>
                          <span className="font-semibold text-slate-700">{formatDate(req.completion_deadline)}</span>
                        </div>
                      </div>

                      {hasMyBid && (
                        <div className="mt-3 p-3 bg-violet-50/70 border border-violet-100 rounded-xl text-xs space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-violet-900">Your Private Bid:</span>
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
                          onClick={() => {
                            resetBid({
                              proposed_price: req.target_price || '',
                              quantity: req.quantity,
                              estimated_completion_date: req.completion_deadline?.split('T')[0],
                            });
                            setBidModalRequest(req);
                          }}
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

                      {/* Post-Award Upload Work for Approval (Crocheters) */}
                      {isAcceptedByMe && ['accepted', 'in_progress'].includes(req.status) && (
                        <div className="flex flex-col gap-1.5">
                          <button
                            onClick={() => {
                              setUploadModalRequest(req);
                              setSelectedFiles([]);
                              setFilePreviews([]);
                              setSubmissionNotes('');
                              setSubmissionQty('');
                            }}
                            className="btn-primary btn-sm w-full py-2 bg-emerald-600 hover:bg-emerald-700 flex items-center justify-center gap-1.5 shadow-sm font-semibold"
                          >
                            <span>📸 Upload Work for Approval</span>
                          </button>

                          <button
                            onClick={() => {
                              resetProgress();
                              setProgressModalRequest(req);
                            }}
                            className="btn-secondary btn-sm w-full py-1.5 text-xs text-amber-700 hover:bg-amber-50 border-amber-200"
                          >
                            🔨 Log Unit Progress Only
                          </button>
                        </div>
                      )}

                      <button
                        onClick={() => setSelectedRequestId(req.id)}
                        className="btn-secondary btn-sm w-full py-1.5 text-xs text-slate-600"
                      >
                        Inspect Specifications & Submissions
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── PRODUCTION APPROVALS QUEUE VIEW (Admin / Issuer) ─────────────────── */}
      {activeTab === 'approvals' && isManager && (
        <div className="space-y-4">
          <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-xl flex items-center justify-between text-xs text-amber-900">
            <div>
              <p className="font-bold text-sm">Production Approval Requests Queue</p>
              <p className="text-amber-700 mt-0.5">
                Crocheters upload photo and video proof of their work throughout production. Review each batch below to approve work or request corrections.
              </p>
            </div>
            <span className="font-bold text-base px-3 py-1 bg-amber-200/80 rounded-lg text-amber-950">
              {pendingApprovalsCount} Pending
            </span>
          </div>

          {approvalsLoading ? (
            <Spinner />
          ) : approvalsQueue.length === 0 ? (
            <div className="card text-center py-16">
              <p className="text-4xl mb-3">🎉</p>
              <p className="text-slate-700 font-semibold text-lg">All Caught Up!</p>
              <p className="text-slate-400 text-sm mt-1">There are no pending worker submissions awaiting approval right now.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {approvalsQueue.map((item) => (
                <div key={item.id} className="card border-slate-200 hover:border-slate-300 transition-all p-5 space-y-4">
                  {/* Item Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-slate-400">{item.request_code}</span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                          ⏳ Pending Approval
                        </span>
                      </div>
                      <h3 className="font-bold text-slate-800 text-base mt-1">{item.request_title}</h3>
                      {item.product_name && (
                        <p className="text-xs text-slate-500">
                          Product: <span className="font-medium text-slate-700">{item.product_name}</span> ({item.product_sku})
                        </p>
                      )}
                    </div>

                    <div className="text-right sm:text-right">
                      <p className="text-xs text-slate-400">Crocheter / Worker</p>
                      <p className="font-bold text-slate-800 text-sm">{item.worker_name}</p>
                      <p className="text-xs text-slate-400 font-mono">{formatDate(item.created_at)}</p>
                    </div>
                  </div>

                  {/* Submission Description / Progress Note */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <div>
                      <span className="text-slate-400 block font-medium">Worker Note:</span>
                      <p className="text-slate-800 mt-0.5 font-medium">{item.notes || 'No description provided.'}</p>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-medium">Reported Completed Quantity:</span>
                      <p className="text-slate-800 mt-0.5 font-semibold">
                        {item.quantity_completed > 0 ? `${item.quantity_completed} ${item.request_unit || 'pieces'}` : 'Work-in-progress check'}
                      </p>
                    </div>
                  </div>

                  {/* Media Gallery (Photos and Videos) */}
                  <div>
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                      Uploaded Proof of Work ({item.media?.length || 0} media files)
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3">
                      {item.media?.map((m) => (
                        <div
                          key={m.id}
                          className="group relative rounded-xl overflow-hidden border border-slate-200 bg-slate-900 aspect-video flex items-center justify-center cursor-pointer shadow-sm hover:ring-2 hover:ring-violet-500 transition-all"
                          onClick={() => setLightboxMedia(m)}
                        >
                          {m.file_type === 'video' ? (
                            <div className="relative w-full h-full flex items-center justify-center bg-slate-950">
                              <video src={m.file_url} className="w-full h-full object-cover opacity-80" preload="metadata" />
                              <div className="absolute inset-0 flex items-center justify-center">
                                <span className="w-9 h-9 rounded-full bg-violet-600/90 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform text-sm">
                                  ▶
                                </span>
                              </div>
                              <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/70 text-[10px] text-white font-mono">
                                VIDEO
                              </span>
                            </div>
                          ) : (
                            <img
                              src={m.file_url}
                              alt={m.original_name}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Review Action Controls */}
                  <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row gap-3 items-end sm:items-center">
                    <div className="flex-1 w-full">
                      <input
                        type="text"
                        placeholder="Feedback or instructions for worker (optional)..."
                        value={reviewNotesMap[item.id] || ''}
                        onChange={(e) => setReviewNotesMap((prev) => ({ ...prev, [item.id]: e.target.value }))}
                        className="input text-xs w-full py-2"
                      />
                    </div>
                    <div className="flex gap-2 self-end sm:self-auto shrink-0">
                      <button
                        onClick={() =>
                          reviewSubmissionMutation.mutate({
                            requestId: item.production_request_id,
                            submissionId: item.id,
                            status: 'approved',
                            reviewer_notes: reviewNotesMap[item.id] || '',
                          })
                        }
                        disabled={reviewSubmissionMutation.isPending}
                        className="btn-primary btn-sm py-2 px-4 bg-emerald-600 hover:bg-emerald-700 flex items-center gap-1.5 shadow-sm"
                      >
                        <span>✅ Approve Work</span>
                      </button>
                      <button
                        onClick={() =>
                          reviewSubmissionMutation.mutate({
                            requestId: item.production_request_id,
                            submissionId: item.id,
                            status: 'rejected',
                            reviewer_notes: reviewNotesMap[item.id] || '',
                          })
                        }
                        disabled={reviewSubmissionMutation.isPending}
                        className="btn-secondary btn-sm py-2 px-4 text-rose-600 hover:bg-rose-50 border-rose-200"
                      >
                        <span>⚠️ Request Changes</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── MODAL: CROCHETER UPLOAD WORK FOR APPROVAL (Unlimited Uploads) ──────── */}
      {uploadModalRequest && (
        <Modal
          title={`Upload Proof of Work — ${uploadModalRequest.request_code}`}
          onClose={() => setUploadModalRequest(null)}
          maxWidth="max-w-xl"
        >
          <div className="space-y-4">
            <div className="p-3 bg-violet-50/70 border border-violet-100 rounded-xl text-xs space-y-1">
              <p className="font-bold text-violet-900">{uploadModalRequest.title}</p>
              <p className="text-slate-600">Total ordered quantity: {uploadModalRequest.quantity} {uploadModalRequest.unit}</p>
              <p className="text-emerald-700 font-medium">
                💡 You can submit photo and video updates as many times as you want throughout production.
              </p>
            </div>

            {/* File Selector */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                Photos & Videos Proof (Max 50MB per file) *
              </label>

              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 hover:border-violet-500 rounded-2xl p-6 text-center cursor-pointer transition-colors bg-slate-50/50 hover:bg-violet-50/20"
              >
                <p className="text-3xl mb-1">📸</p>
                <p className="text-sm font-semibold text-slate-700">Click to select photos or videos</p>
                <p className="text-xs text-slate-400 mt-1">Supports JPEG, PNG, WEBP images and MP4, WebM, MOV videos</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
                  onChange={handleFilesChosen}
                  className="hidden"
                />
              </div>
            </div>

            {/* Selected File Previews */}
            {filePreviews.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-slate-600">Selected Media ({filePreviews.length} files):</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1">
                  {filePreviews.map((p, idx) => (
                    <div key={idx} className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-900 aspect-video flex items-center justify-center">
                      {p.isVideo ? (
                        <video src={p.url} className="w-full h-full object-cover" />
                      ) : (
                        <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
                      )}
                      <button
                        type="button"
                        onClick={() => removeSelectedFile(idx)}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-slate-900/80 text-white flex items-center justify-center text-xs hover:bg-rose-600 transition-colors"
                        title="Remove"
                      >
                        ✕
                      </button>
                      <span className="absolute bottom-1 left-1 px-1 py-0.5 rounded bg-black/70 text-[9px] text-white truncate max-w-[80%]">
                        {p.name} ({p.size}MB)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Optional Quantity */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Units Completed in this Batch (Optional)
              </label>
              <input
                type="number"
                min="0"
                max={uploadModalRequest.quantity}
                placeholder="e.g. 10"
                value={submissionQty}
                onChange={(e) => setSubmissionQty(e.target.value)}
                className="input"
              />
              <p className="text-[11px] text-slate-400 mt-0.5">Leave blank if this upload is just a work-in-progress check.</p>
            </div>

            {/* Notes Textarea */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Worker Notes & Comments (Optional)
              </label>
              <textarea
                rows="3"
                placeholder="Describe your progress, materials used, or specific areas you want feedback on..."
                value={submissionNotes}
                onChange={(e) => setSubmissionNotes(e.target.value)}
                className="input text-xs"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2 justify-end pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setUploadModalRequest(null)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={selectedFiles.length === 0 || uploadSubmissionMutation.isPending}
                onClick={() =>
                  uploadSubmissionMutation.mutate({
                    requestId: uploadModalRequest.id,
                    files: selectedFiles,
                    notes: submissionNotes,
                    quantity_completed: submissionQty,
                  })
                }
                className="btn-primary bg-emerald-600 hover:bg-emerald-700 flex items-center gap-2"
              >
                {uploadSubmissionMutation.isPending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Uploading Media...</span>
                  </>
                ) : (
                  <>
                    <span>🚀 Submit for Approval</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ─── MODAL: LIGHTBOX / ZOOM MEDIA PREVIEW ──────────────────────────────── */}
      {lightboxMedia && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setLightboxMedia(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] flex flex-col items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setLightboxMedia(null)}
              className="absolute -top-10 right-0 text-white text-2xl font-bold hover:text-slate-300"
            >
              ✕
            </button>
            {lightboxMedia.file_type === 'video' ? (
              <video
                src={lightboxMedia.file_url}
                controls
                autoPlay
                className="max-w-full max-h-[80vh] rounded-xl shadow-2xl bg-black"
              />
            ) : (
              <img
                src={lightboxMedia.file_url}
                alt={lightboxMedia.original_name}
                className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl"
              />
            )}
            <p className="text-white text-xs mt-3 font-mono opacity-80">{lightboxMedia.original_name}</p>
          </div>
        </div>
      )}

      {/* ─── CREATE REQUEST MODAL (Issuer only) ─────────────────────────────────── */}
      {showCreateModal && (
        <Modal title="Create Production Request" onClose={() => setShowCreateModal(false)}>
          <form onSubmit={handleCreateSubmit((d) => createMutation.mutate(d))} className="space-y-4">
            <div>
              <label className="label">Request Title *</label>
              <input type="text" className="input" placeholder="e.g. 500 Crochet Amigurumi Bears" {...regCreate('title', { required: true })} />
              {errorsCreate.title && <span className="text-xs text-rose-500">Title is required</span>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Target Recipient Role *</label>
                <select className="input" {...regCreate('target_role', { required: true })}>
                  {isAdmin && <option value="vendor">Vendor (Primary Supplier)</option>}
                  {(isAdmin || isVendor) && <option value="subvendor">Subvendor (Subcontractor)</option>}
                  <option value="worker">Crocheter (Production Worker)</option>
                </select>
              </div>

              <div>
                <label className="label">Recipient Scope *</label>
                <select className="input" {...regCreate('scope_type', { required: true })}>
                  <option value="all_eligible">Broadcast to All Eligible</option>
                  <option value="specific">Target Specific Recipients</option>
                </select>
              </div>
            </div>

            {/* Linked Product Selection */}
            {isManager && (productsData?.products?.length || 0) > 0 && (
              <div>
                <label className="label">Link to Catalog Product (Optional)</label>
                <select className="input" {...regCreate('product_id')}>
                  <option value="">-- No Catalog Product Linked --</option>
                  {productsData.products.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                  ))}
                </select>
              </div>
            )}

            {/* Specific Recipient Pickers */}
            {selectedScopeType === 'specific' && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <p className="text-xs font-semibold text-slate-700 uppercase">Select Target Recipients</p>
                {selectedTargetRole === 'vendor' && isAdmin && (
                  <select multiple className="input h-24 text-xs" {...regCreate('recipient_ids')}>
                    {(suppliersData?.suppliers || []).map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.contact_person || 'Vendor'})</option>
                    ))}
                  </select>
                )}
                {selectedTargetRole === 'subvendor' && (
                  <select multiple className="input h-24 text-xs" {...regCreate('recipient_ids')}>
                    {(subvendorsData?.subvendors || []).map(sv => (
                      <option key={sv.id} value={sv.id}>{sv.name}</option>
                    ))}
                  </select>
                )}
                {selectedTargetRole === 'worker' && (
                  <select multiple className="input h-24 text-xs" {...regCreate('recipient_ids')}>
                    {(crochetersData?.workers || []).map(w => (
                      <option key={w.id} value={w.id}>{w.name} ({w.email})</option>
                    ))}
                  </select>
                )}
                <p className="text-[11px] text-slate-400">Hold Ctrl / Cmd to select multiple recipients.</p>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">Quantity *</label>
                <input type="number" min="1" className="input" {...regCreate('quantity', { required: true })} />
              </div>
              <div>
                <label className="label">Unit *</label>
                <input type="text" className="input" placeholder="pieces" {...regCreate('unit', { required: true })} />
              </div>
              <div>
                <label className="label">Target Unit Price (₹)</label>
                <input type="number" step="0.01" className="input" placeholder="e.g. 350" {...regCreate('target_price')} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Bidding Deadline *</label>
                <input type="datetime-local" className="input text-xs" {...regCreate('submission_deadline', { required: true })} />
              </div>
              <div>
                <label className="label">Production Delivery Deadline *</label>
                <input type="datetime-local" className="input text-xs" {...regCreate('completion_deadline', { required: true })} />
              </div>
            </div>

            <div>
              <label className="label">Specifications & Work Instructions</label>
              <textarea rows="3" className="input text-xs" placeholder="Dimensions, stitch counts, tension, color palette..." {...regCreate('specifications')} />
            </div>

            <div>
              <label className="label">Required Raw Materials</label>
              <textarea rows="2" className="input text-xs" placeholder="e.g. 4-ply Cotton Yarn in Pastel Pink, 3mm Crochet Hook, 12mm Safety Eyes" {...regCreate('required_materials')} />
            </div>

            <div className="flex gap-2 justify-end pt-3 border-t border-slate-100">
              <button type="button" onClick={() => setShowCreateModal(false)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={createMutation.isPending} className="btn-primary">
                {createMutation.isPending ? 'Publishing...' : 'Publish Production Request'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ─── MODAL: SUBMIT BID (Recipient only) ──────────────────────────────────── */}
      {bidModalRequest && (
        <Modal title={`Submit Private Bid — ${bidModalRequest.request_code}`} onClose={() => setBidModalRequest(null)} maxWidth="max-w-md">
          <form onSubmit={handleBidSubmit((d) => submitBidMutation.mutate({ requestId: bidModalRequest.id, data: d }))} className="space-y-4">
            <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs space-y-1">
              <p className="font-semibold text-slate-800">{bidModalRequest.title}</p>
              <p className="text-slate-500">Requested Quantity: {bidModalRequest.quantity} {bidModalRequest.unit}</p>
              {bidModalRequest.target_price && (
                <p className="text-emerald-700 font-medium">Target Price: {formatCurrency(bidModalRequest.target_price)} / unit</p>
              )}
            </div>

            <div>
              <label className="label">Your Proposed Unit Price (₹) *</label>
              <input type="number" step="0.01" min="0.01" className="input text-lg font-bold" {...regBid('proposed_price', { required: true })} />
              <p className="text-xs text-slate-400 mt-1">Your bid price is completely confidential and never visible to competitors.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Quantity *</label>
                <input type="number" min="1" className="input" {...regBid('quantity', { required: true })} />
              </div>
              <div>
                <label className="label">Est. Completion Date *</label>
                <input type="date" min={today()} className="input text-xs" {...regBid('estimated_completion_date', { required: true })} />
              </div>
            </div>

            <div>
              <label className="label">Proposal Notes / Capacity Statement</label>
              <textarea rows="2" className="input text-xs" placeholder="Delivery guarantees, artisan team size, lead times..." {...regBid('notes')} />
            </div>

            <div className="flex gap-2 justify-end pt-3 border-t border-slate-100">
              <button type="button" onClick={() => setBidModalRequest(null)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={submitBidMutation.isPending} className="btn-primary">
                {submitBidMutation.isPending ? 'Submitting...' : 'Submit Confidential Bid'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ─── MODAL: REPORT SIMPLE PROGRESS (Awardee only) ───────────────────────── */}
      {progressModalRequest && (
        <Modal title={`Report Progress — ${progressModalRequest.request_code}`} onClose={() => setProgressModalRequest(null)} maxWidth="max-w-md">
          <form onSubmit={handleProgressSubmit((d) => progressMutation.mutate({ requestId: progressModalRequest.id, data: d }))} className="space-y-4">
            <div>
              <label className="label">Pieces Completed In This Session *</label>
              <input type="number" min="1" max={progressModalRequest.quantity} className="input text-lg font-bold" {...regProgress('quantity_completed', { required: true })} />
              <p className="text-xs text-slate-400 mt-1">Total ordered quantity: {progressModalRequest.quantity} {progressModalRequest.unit}</p>
            </div>

            <div>
              <label className="label">Progress Notes</label>
              <textarea rows="2" className="input text-xs" placeholder="Batch details, quality checks, blockers..." {...regProgress('notes')} />
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-amber-900">
                <input type="checkbox" className="rounded text-amber-600" {...regProgress('submit_for_review')} />
                <span>Mark work ready for final supervisor review & approval</span>
              </label>
            </div>

            <div className="flex gap-2 justify-end pt-3 border-t border-slate-100">
              <button type="button" onClick={() => setProgressModalRequest(null)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={progressMutation.isPending} className="btn-primary bg-amber-600 hover:bg-amber-700">
                {progressMutation.isPending ? 'Logging...' : 'Save Progress Entry'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ─── MODAL: SUPERVISOR REVIEW COMPLETED WORK ────────────────────────────── */}
      {reviewModalRequest && (
        <Modal title={`Review Completed Work — ${reviewModalRequest.request_code}`} onClose={() => setReviewModalRequest(null)} maxWidth="max-w-md">
          <form onSubmit={handleReviewSubmit((d) => reviewMutation.mutate({ requestId: reviewModalRequest.id, ...d }))} className="space-y-4">
            <div>
              <label className="label">Review Decision *</label>
              <select className="input" {...regReview('decision', { required: true })}>
                <option value="approve">✅ Approve & Mark Completed (Increment Finished Goods Stock)</option>
                <option value="request_correction">⚠️ Request Corrections / Re-work</option>
              </select>
            </div>

            <div>
              <label className="label">Supervisor Feedback Notes</label>
              <textarea rows="3" className="input text-xs" placeholder="Praise quality, or detail required corrections..." {...regReview('feedback')} />
            </div>

            <div className="flex gap-2 justify-end pt-3 border-t border-slate-100">
              <button type="button" onClick={() => setReviewModalRequest(null)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={reviewMutation.isPending} className="btn-primary">
                {reviewMutation.isPending ? 'Submitting...' : 'Submit Review Decision'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ─── MODAL: INSPECT REQUEST DETAILS, BIDS, & SUBMISSIONS ───────────────── */}
      {selectedRequestId && (
        <Modal title={`Request Details — ${singleRequestData?.request?.request_code || ''}`} onClose={() => setSelectedRequestId(null)}>
          {singleLoading ? (
            <Spinner />
          ) : !singleRequestData?.request ? (
            <p className="text-slate-500">Request details not available.</p>
          ) : (
            <div className="space-y-6">
              {/* Summary Banner */}
              <div className="flex items-start justify-between gap-4 p-4 bg-slate-50 border border-slate-100 rounded-xl">
                <div>
                  <h3 className="font-bold text-slate-800 text-lg">{singleRequestData.request.title}</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Issued by: <span className="font-semibold text-slate-700">{singleRequestData.request.issuer_tenant_name || 'Organization'}</span>
                  </p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${STATUS_BADGES[singleRequestData.request.status]?.bg || 'bg-slate-100'}`}>
                  {STATUS_BADGES[singleRequestData.request.status]?.label || singleRequestData.request.status}
                </span>
              </div>

              {/* Specifications & Materials */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {singleRequestData.request.specifications && (
                  <div className="p-3 border border-slate-100 rounded-xl space-y-1">
                    <p className="font-bold text-slate-700 uppercase">Specifications</p>
                    <p className="text-slate-600 whitespace-pre-wrap">{singleRequestData.request.specifications}</p>
                  </div>
                )}
                {singleRequestData.request.required_materials && (
                  <div className="p-3 border border-slate-100 rounded-xl space-y-1">
                    <p className="font-bold text-slate-700 uppercase">Required Materials</p>
                    <p className="text-slate-600 whitespace-pre-wrap">{singleRequestData.request.required_materials}</p>
                  </div>
                )}
              </div>

              {/* 📸 WORK SUBMISSIONS & PROOF GALLERY TIMELINE */}
              {(singleRequestData.submissions?.length || 0) > 0 ? (
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                      <span>📸 Work Submissions & Proof of Work</span>
                      <span className="px-2 py-0.5 rounded-full text-xs bg-violet-100 text-violet-800 font-semibold">
                        {singleRequestData.submissions.length} batch(es)
                      </span>
                    </h4>
                  </div>

                  <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
                    {singleRequestData.submissions.map((sub, idx) => {
                      const subBadge = SUBMISSION_STATUS_BADGES[sub.status] || { label: sub.status, bg: 'bg-slate-100 text-slate-700' };
                      return (
                        <div key={sub.id} className="p-4 bg-slate-50/70 border border-slate-200 rounded-xl space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span className="text-xs font-bold text-slate-500 uppercase">
                                Batch #{singleRequestData.submissions.length - idx}
                              </span>
                              <p className="text-xs text-slate-400">
                                Submitted by <span className="font-semibold text-slate-700">{sub.worker_name}</span> on {formatDate(sub.created_at)}
                              </p>
                            </div>
                            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${subBadge.bg}`}>
                              {subBadge.label}
                            </span>
                          </div>

                          {sub.notes && (
                            <p className="text-xs text-slate-700 bg-white p-2.5 rounded-lg border border-slate-100">
                              <span className="font-semibold text-slate-500">Note: </span>
                              {sub.notes}
                            </p>
                          )}

                          {sub.quantity_completed > 0 && (
                            <p className="text-xs font-semibold text-slate-700">
                              Reported Completed: <span className="text-emerald-700 font-bold">{sub.quantity_completed}</span> {singleRequestData.request.unit}
                            </p>
                          )}

                          {/* Media attachments gallery */}
                          {sub.media?.length > 0 && (
                            <div>
                              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                Attached Photos & Videos ({sub.media.length})
                              </p>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {sub.media.map((m) => (
                                  <div
                                    key={m.id}
                                    onClick={() => setLightboxMedia(m)}
                                    className="relative rounded-lg overflow-hidden border border-slate-200 aspect-video bg-slate-900 cursor-pointer hover:ring-2 hover:ring-violet-500 transition-all flex items-center justify-center"
                                  >
                                    {m.file_type === 'video' ? (
                                      <div className="relative w-full h-full flex items-center justify-center">
                                        <video src={m.file_url} className="w-full h-full object-cover opacity-80" />
                                        <span className="absolute w-7 h-7 rounded-full bg-violet-600/90 text-white flex items-center justify-center text-xs">
                                          ▶
                                        </span>
                                      </div>
                                    ) : (
                                      <img src={m.file_url} alt={m.original_name} className="w-full h-full object-cover" />
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Supervisor Feedback Note */}
                          {sub.reviewer_notes && (
                            <div className="p-2.5 bg-violet-50/80 border border-violet-100 rounded-lg text-xs space-y-0.5">
                              <span className="font-bold text-violet-900">
                                Supervisor Feedback ({sub.reviewer_name || 'Admin'}):
                              </span>
                              <p className="text-slate-700">{sub.reviewer_notes}</p>
                            </div>
                          )}

                          {/* Inline Admin Review Actions for Pending Submissions */}
                          {singleRequestData.is_issuer && sub.status === 'pending_approval' && (
                            <div className="pt-2 border-t border-slate-200 flex flex-col sm:flex-row gap-2 items-end sm:items-center">
                              <input
                                type="text"
                                placeholder="Reviewer notes or instructions..."
                                value={reviewNotesMap[sub.id] || ''}
                                onChange={(e) => setReviewNotesMap((prev) => ({ ...prev, [sub.id]: e.target.value }))}
                                className="input text-xs flex-1 py-1.5"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() =>
                                    reviewSubmissionMutation.mutate({
                                      requestId: singleRequestData.request.id,
                                      submissionId: sub.id,
                                      status: 'approved',
                                      reviewer_notes: reviewNotesMap[sub.id] || '',
                                    })
                                  }
                                  disabled={reviewSubmissionMutation.isPending}
                                  className="btn-primary btn-sm py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-xs"
                                >
                                  ✅ Approve
                                </button>
                                <button
                                  onClick={() =>
                                    reviewSubmissionMutation.mutate({
                                      requestId: singleRequestData.request.id,
                                      submissionId: sub.id,
                                      status: 'rejected',
                                      reviewer_notes: reviewNotesMap[sub.id] || '',
                                    })
                                  }
                                  disabled={reviewSubmissionMutation.isPending}
                                  className="btn-secondary btn-sm py-1.5 px-3 text-rose-600 hover:bg-rose-50 border-rose-200 text-xs"
                                >
                                  ⚠️ Changes
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Bids Section */}
              {singleRequestData.is_issuer ? (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-bold text-slate-800 text-sm">Competitive Bids Received ({singleRequestData.bids?.length || 0})</h4>
                    {singleRequestData.request.status === 'submitted_for_review' && (
                      <button
                        onClick={() => setReviewModalRequest(singleRequestData.request)}
                        className="btn-primary btn-sm py-1.5 px-3 bg-purple-600 hover:bg-purple-700 text-xs"
                      >
                        Supervisor Review
                      </button>
                    )}
                  </div>

                  {(singleRequestData.bids?.length || 0) === 0 ? (
                    <p className="text-xs text-slate-400 italic">No bids submitted yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {singleRequestData.bids.map(bid => {
                        const isAwarded = singleRequestData.request.awarded_bid_id === bid.id;
                        return (
                          <div
                            key={bid.id}
                            className={`p-4 rounded-xl border text-xs transition-all ${
                              isAwarded
                                ? 'bg-amber-50/70 border-amber-300 ring-2 ring-amber-400/40'
                                : 'bg-slate-50 border-slate-200'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <span className="font-bold text-slate-800 text-sm">{bid.bidder_user_name || 'Artisan / Supplier'}</span>
                                <span className="text-slate-400 block">{bid.bidder_user_email}</span>
                                {bid.notes && <p className="text-slate-600 mt-1 italic">"{bid.notes}"</p>}
                              </div>

                              <div className="text-right">
                                <span className="text-base font-black text-slate-900 block">{formatCurrency(bid.proposed_price)}</span>
                                <span className="text-slate-400">for {bid.quantity} units</span>
                              </div>
                            </div>

                            <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-200">
                              <span className="text-slate-500 font-mono">
                                Est. Date: {formatDate(bid.estimated_completion_date)}
                              </span>

                              <div className="flex items-center gap-2">
                                <span className="capitalize font-semibold text-violet-700">
                                  {bid.status.replace('_', ' ')}
                                </span>
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
