import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
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

export default function Profile() {
  const { user, setUser } = useAuthStore();
  const qc = useQueryClient();
  const fileInputRef = useRef(null);

  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletePassword, setDeletePassword] = useState('');

  const deleteAccountMutation = useMutation({
    mutationFn: (data) => api.deleteAccount(data),
    onSuccess: () => {
      toast.success('Your account has been deleted permanently.');
      useAuthStore.getState().logout();
      window.location.href = '/login';
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to delete account'),
  });

  // Profile Form
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: {
      name: user?.name || '',
      phone: user?.phone || '',
      description: user?.description || '',
    },
  });

  // Queries
  const { data: meData, isLoading: meLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get('/auth/me').then((r) => r.data),
  });

  const { data: portfolioItems, isLoading: portfolioLoading } = useQuery({
    queryKey: ['my-portfolio'],
    queryFn: () => api.get('/auth/portfolio').then((r) => r.data),
  });

  // Profile update mutation
  const updateProfileMutation = useMutation({
    mutationFn: (data) => api.put('/auth/profile', data).then((r) => r.data),
    onSuccess: (data) => {
      toast.success(data?.message || 'Profile updated successfully!');
      if (data?.user) setUser(data.user);
      qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to update profile'),
  });

  // Upload portfolio mutation
  const uploadPortfolioMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Please select an image to upload');
      setIsUploading(true);
      const formData = new FormData();
      formData.append('image', file);
      if (title.trim()) formData.append('title', title.trim());
      if (caption.trim()) formData.append('caption', caption.trim());
      return api.post('/auth/portfolio', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then((r) => r.data);
    },
    onSuccess: () => {
      toast.success('Work sample added to your portfolio!');
      setTitle('');
      setCaption('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      qc.invalidateQueries({ queryKey: ['my-portfolio'] });
    },
    onError: (err) => toast.error(err.message || err.response?.data?.error || 'Failed to upload portfolio item'),
    onSettled: () => setIsUploading(false),
  });

  // Delete portfolio mutation
  const deletePortfolioMutation = useMutation({
    mutationFn: (id) => api.delete(`/auth/portfolio/${id}`).then((r) => r.data),
    onSuccess: () => {
      toast.success('Portfolio item removed');
      qc.invalidateQueries({ queryKey: ['my-portfolio'] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to delete portfolio item'),
  });

  const handleProfileSubmit = (formData) => {
    updateProfileMutation.mutate(formData);
  };

  const isCrocheter = user?.role === 'worker';
  const roleDisplay = isCrocheter ? 'Artisan / Crocheter' : (user?.role || 'User').replace('_', ' ');

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">My Artisan Profile</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Manage your personal details, contact information, and showcase your crochet craft portfolio
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Profile Card & Bio Form */}
        <div className="lg:col-span-1 space-y-6">
          <div className="card text-center p-6 space-y-4">
            <div className="w-20 h-20 rounded-full bg-violet-100 text-violet-700 font-bold text-3xl flex items-center justify-center mx-auto shadow-inner">
              {user?.google_profile_photo ? (
                <img src={user.google_profile_photo} alt={user.name} className="w-full h-full rounded-full object-cover" />
              ) : (
                user?.name?.[0]?.toUpperCase() || 'K'
              )}
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">{user?.name}</h2>
              <p className="text-xs text-slate-400 font-mono mt-0.5">{user?.email}</p>
              <div className="mt-2 inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-200 capitalize">
                🧶 {roleDisplay}
              </div>
            </div>

            {user?.tenant_name && (
              <p className="text-xs text-slate-500 pt-3 border-t border-slate-100">
                Workspace: <span className="font-semibold text-slate-700">{user.tenant_name}</span>
              </p>
            )}
          </div>

          {/* Edit Profile Form */}
          <div className="card p-6">
            <h3 className="text-base font-bold text-slate-800 mb-4">Edit Profile Info</h3>
            <form onSubmit={handleSubmit(handleProfileSubmit)} className="space-y-4">
              <div>
                <label className="label">Full Name *</label>
                <input
                  type="text"
                  className={`input text-sm ${errors.name ? 'border-rose-400' : ''}`}
                  {...register('name', { required: 'Name is required' })}
                />
                {errors.name && <p className="text-rose-500 text-xs mt-1">{errors.name.message}</p>}
              </div>

              <div>
                <label className="label">Phone Number</label>
                <input
                  type="tel"
                  placeholder="+91 98765 43210"
                  className="input text-sm"
                  {...register('phone')}
                />
              </div>

              <div>
                <label className="label">Artisan Bio / Description</label>
                <textarea
                  rows={4}
                  placeholder="Tell clients and workshop managers about your specialty (e.g. amigurumi, granny squares, wearables, gauge tension, years of experience)..."
                  className="input text-sm"
                  {...register('description')}
                />
              </div>

              <button
                type="submit"
                disabled={updateProfileMutation.isPending}
                className="btn-primary w-full py-2.5 text-sm"
              >
                {updateProfileMutation.isPending ? 'Saving…' : '💾 Save Profile'}
              </button>
            </form>
          </div>

          {/* Danger Zone */}
          <div className="card p-5 border-rose-200 bg-rose-50/20 space-y-3">
            <h4 className="text-xs font-bold text-rose-800 uppercase tracking-wider">⚠️ Danger Zone</h4>
            <p className="text-xs text-slate-500">
              Permanently delete your account, crochet portfolio, and personal data.
            </p>
            <button
              type="button"
              onClick={() => {
                setDeleteConfirmText('');
                setDeletePassword('');
                setShowDeleteModal(true);
              }}
              className="btn-danger w-full text-xs py-2"
            >
              🗑️ Delete My Account
            </button>
          </div>
        </div>

        {/* Right Column: Portfolio Showcase */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-6 space-y-6">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-slate-800">Craft Portfolio & Work Samples</h3>
                <span className="text-xs font-mono font-semibold px-2.5 py-1 bg-violet-50 text-violet-700 rounded-full">
                  {portfolioItems?.length || 0} pieces
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Upload photos of your completed crochet projects to showcase your stitch precision, color harmony, and versatility.
              </p>
            </div>

            {/* Upload New Piece */}
            <div className="p-4 bg-slate-50 border border-dashed border-slate-300 rounded-2xl space-y-3">
              <p className="text-xs font-bold text-slate-700">Add New Work Sample</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Project Title (e.g. Daisy Bucket Hat)"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="input text-xs"
                />
                <input
                  type="text"
                  placeholder="Notes (e.g. Mercerized cotton, 3mm hook, 6 hours)"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  className="input text-xs"
                />
              </div>

              <div className="flex items-center justify-between flex-wrap gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-violet-100 file:text-violet-700 hover:file:bg-violet-200"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                <button
                  type="button"
                  onClick={() => uploadPortfolioMutation.mutate()}
                  disabled={isUploading || !file}
                  className="btn-primary btn-sm py-1.5 px-4 text-xs font-semibold"
                >
                  {isUploading ? 'Uploading…' : '📷 Upload Piece'}
                </button>
              </div>
            </div>

            {/* Portfolio Grid */}
            {portfolioLoading ? (
              <Spinner />
            ) : (!portfolioItems || portfolioItems.length === 0) ? (
              <div className="text-center py-16 bg-slate-50 border border-slate-100 rounded-2xl">
                <p className="text-4xl mb-2">✨</p>
                <p className="font-semibold text-slate-700 text-sm">No portfolio pieces yet</p>
                <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                  Take photos of your amigurumi, cardigans, baby blankets, or motifs and upload them above to build your reputation!
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {portfolioItems.map((item) => (
                  <div
                    key={item.id}
                    className="group border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
                  >
                    <div
                      onClick={() => setPreviewImage(item.image_url)}
                      className="aspect-square bg-slate-100 overflow-hidden cursor-pointer relative"
                    >
                      <img
                        src={item.image_url}
                        alt={item.title || 'Portfolio sample'}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                      <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-semibold">
                        🔍 Enlarge
                      </div>
                    </div>

                    <div className="p-3 space-y-1">
                      <p className="font-bold text-slate-800 text-sm truncate" title={item.title || 'Untitled'}>
                        {item.title || 'Crochet Project'}
                      </p>
                      {item.caption && (
                        <p className="text-xs text-slate-500 line-clamp-2" title={item.caption}>
                          {item.caption}
                        </p>
                      )}
                      <div className="pt-2 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-100 mt-2">
                        <span>{format(parseISO(item.created_at), 'dd MMM yyyy')}</span>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm('Delete this portfolio item?')) {
                              deletePortfolioMutation.mutate(item.id);
                            }
                          }}
                          className="text-rose-500 hover:text-rose-700 font-semibold"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lightbox Modal */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md cursor-pointer animate-fade-in"
        >
          <div className="relative max-w-3xl max-h-[90vh]">
            <img src={previewImage} alt="Preview" className="max-w-full max-h-[85vh] rounded-xl shadow-2xl object-contain mx-auto" />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute top-2 right-2 bg-slate-900/80 text-white rounded-full p-2 hover:bg-black transition-colors"
            >
              ✕ Close
            </button>
          </div>
        </div>
      )}
      {/* Delete Account Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-semibold text-slate-800 text-base">Delete Account Permanently</h3>
              <button onClick={() => setShowDeleteModal(false)} className="btn-ghost btn-sm p-1">✕</button>
            </div>

            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 space-y-1">
              <p className="font-bold">⚠️ Warning: This action cannot be undone.</p>
              <p>Your profile data, active sessions, and craft portfolio pieces will be permanently erased.</p>
            </div>

            <div>
              <label className="label text-xs">
                To confirm, type <span className="font-bold text-rose-700">DELETE</span> or your email (<span className="font-mono text-slate-600">{user?.email}</span>):
              </label>
              <input
                type="text"
                placeholder='Type "DELETE" or your email'
                className="input text-sm"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                autoFocus
              />
            </div>

            <div>
              <label className="label text-xs">Password (Optional if confirmed with &quot;DELETE&quot; / Google OAuth)</label>
              <input
                type="password"
                placeholder="Enter password (optional)"
                className="input text-sm"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
              />
            </div>

            <div className="flex gap-2 justify-end pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="btn-secondary text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  (!deleteConfirmText.trim() && !deletePassword) ||
                  (deleteConfirmText.trim().toUpperCase() !== 'DELETE' &&
                    deleteConfirmText.trim().toLowerCase() !== user?.email?.toLowerCase() &&
                    !deletePassword) ||
                  deleteAccountMutation.isPending
                }
                onClick={() =>
                  deleteAccountMutation.mutate({
                    confirmText: deleteConfirmText,
                    password: deletePassword,
                  })
                }
                className="btn-danger text-xs flex items-center gap-1.5"
              >
                {deleteAccountMutation.isPending ? 'Deleting…' : 'Confirm Permanent Deletion'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
