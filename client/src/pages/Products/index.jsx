import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import toast from 'react-hot-toast';
import api from '../../api/index.js';
import { useAuthStore } from '../../store/auth';
import { usePlan } from '../../hooks/usePlan';
import UpgradePrompt from '../../components/UpgradePrompt';

const formatINR = (v) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(v ?? 0);

const PLATFORMS = ['flipkart', 'meesho', 'myntra', 'etsy', 'amazon'];

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-7 h-7 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-2xl'} max-h-[92vh] overflow-y-auto`}>
        <div className="flex items-center justify-between p-6 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h3 className="font-semibold text-slate-800 text-lg">{title}</h3>
          <button onClick={onClose} className="btn-ghost btn-sm rounded-full w-8 h-8 p-0 flex items-center justify-center text-slate-400">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ─── Product Form ─────────────────────────────────────────────────────────────
function ProductFormModal({ product, materials, onClose }) {
  const qc = useQueryClient();
  const isEdit = !!product;

  // Always fetch the full product detail when editing so we get bom + platforms
  const { data: fullProduct, isLoading: detailLoading } = useQuery({
    queryKey: ['product', product?.id],
    queryFn: () => api.get(`/products/${product.id}`).then(r => r.data),
    enabled: isEdit,
  });

  // Use fetched detail when editing, otherwise use empty defaults
  const source = isEdit ? fullProduct : null;

  const buildDefaultBom = (bom) => {
    if (bom?.length) {
      return bom.map(b => ({
        material_id: String(b.material_id),
        quantity_per_unit: b.quantity_per_unit,
      }));
    }
    return [{ material_id: '', quantity_per_unit: 1 }];
  };

  const buildDefaultPrices = (platforms) => {
    const out = {};
    // platforms comes back as array of {platform, selling_price}
    const map = {};
    if (Array.isArray(platforms)) {
      platforms.forEach(p => { map[p.platform] = p.selling_price; });
    } else if (platforms && typeof platforms === 'object') {
      Object.assign(map, platforms);
    }
    PLATFORMS.forEach(p => { out[p] = map[p] ?? 0; });
    return out;
  };

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm({
    defaultValues: {
      name: '',
      sku: '',
      category: '',
      description: '',
      standard_time_minutes: 0,
      labor_cost_per_unit: 0,
      bunch_size: 1,
      reorder_threshold: 0,
      bom: [{ material_id: '', quantity_per_unit: 1 }],
      platform_prices: buildDefaultPrices(null),
    },
  });

  // Once the full detail loads, reset the form with real data
  useEffect(() => {
    if (source) {
      reset({
        name: source.name ?? '',
        sku: source.sku ?? '',
        category: source.category ?? '',
        description: source.description ?? '',
        standard_time_minutes: source.standard_time_minutes ?? 0,
        labor_cost_per_unit: source.labor_cost_per_unit ?? 0,
        bunch_size: source.bunch_size ?? 1,
        reorder_threshold: source.stock?.reorder_threshold ?? source.reorder_threshold ?? 0,
        bom: buildDefaultBom(source.bom),
        platform_prices: buildDefaultPrices(source.platforms),
      });
    }
  }, [source, reset]);

  const { fields, append, remove } = useFieldArray({ control, name: 'bom' });

  const mutation = useMutation({
    mutationFn: (data) => isEdit
      ? api.put(`/products/${product.id}`, data).then(r => r.data)
      : api.post('/products', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product', product?.id] });
      toast.success(isEdit ? 'Product updated!' : 'Product created!');
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Failed to save product.'),
  });

  const onSubmit = (data) => {
    mutation.mutate({
      ...data,
      standard_time_minutes: Number(data.standard_time_minutes),
      labor_cost_per_unit: Number(data.labor_cost_per_unit),
      bunch_size: Number(data.bunch_size),
      reorder_threshold: Number(data.reorder_threshold),
      bom: data.bom.filter(b => b.material_id).map(b => ({
        material_id: Number(b.material_id),
        quantity_per_unit: Number(b.quantity_per_unit),
      })),
      platforms: PLATFORMS.map(p => ({
        platform: p,
        selling_price: Number(data.platform_prices[p] ?? 0),
        commission_pct: 0,
      })),
    });
  };

  return (
    <Modal title={isEdit ? `Edit — ${product.name}` : 'Add New Product'} onClose={onClose} wide>
      {isEdit && detailLoading ? <Spinner /> : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Basic Info */}
          <div>
            <h4 className="font-medium text-slate-700 mb-3 text-sm uppercase tracking-wide">Basic Info</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="label">Product Name *</label>
                <input className={`input ${errors.name ? 'border-rose-400' : ''}`}
                  {...register('name', { required: 'Name is required' })} />
                {errors.name && <p className="text-rose-500 text-xs mt-1">{errors.name.message}</p>}
              </div>
              <div>
                <label className="label">SKU *</label>
                <input className={`input ${errors.sku ? 'border-rose-400' : ''}`}
                  {...register('sku', { required: 'SKU is required' })} />
              </div>
              <div>
                <label className="label">Category</label>
                <input className="input" placeholder="e.g. Toys, Bags" {...register('category')} />
              </div>
              <div className="col-span-2">
                <label className="label">Description</label>
                <textarea className="input resize-none h-20" {...register('description')} />
              </div>
              <div>
                <label className="label">Labor Cost / Piece (₹)</label>
                <input type="number" step="0.5" className="input" placeholder="e.g. 25"
                  {...register('labor_cost_per_unit', { valueAsNumber: true, min: 0 })} />
              </div>
              <div>
                <label className="label">Standard Time (min)</label>
                <input type="number" className="input" placeholder="e.g. 30"
                  {...register('standard_time_minutes', { valueAsNumber: true, min: 0 })} />
              </div>
              <div>
                <label className="label">Bunch Size</label>
                <input type="number" className="input" {...register('bunch_size', { valueAsNumber: true, min: 1 })} />
              </div>
              <div>
                <label className="label">Reorder Threshold</label>
                <input type="number" className="input" {...register('reorder_threshold', { valueAsNumber: true, min: 0 })} />
              </div>
            </div>
          </div>

          {/* BOM */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-medium text-slate-700 text-sm uppercase tracking-wide">Bill of Materials</h4>
              <button type="button" onClick={() => append({ material_id: '', quantity_per_unit: 1 })}
                className="btn-secondary btn-sm">+ Add Row</button>
            </div>
            <div className="space-y-2">
              {fields.map((field, idx) => (
                <div key={field.id} className="flex gap-2 items-center">
                  <select className="select flex-1" {...register(`bom.${idx}.material_id`)}>
                    <option value="">— Select material —</option>
                    {materials.map(m => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
                  </select>
                  <input type="number" step="0.001" className="input w-28" placeholder="Qty"
                    {...register(`bom.${idx}.quantity_per_unit`, { valueAsNumber: true, min: 0.001 })} />
                  <button type="button" onClick={() => remove(idx)} className="btn-danger btn-sm shrink-0">✕</button>
                </div>
              ))}
              {fields.length === 0 && <p className="text-slate-400 text-sm">No materials added yet.</p>}
            </div>
          </div>

          {/* Platform Prices */}
          <div>
            <h4 className="font-medium text-slate-700 mb-3 text-sm uppercase tracking-wide">Platform Selling Prices (₹)</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {PLATFORMS.map(p => (
                <div key={p}>
                  <label className="label capitalize">{p}</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">₹</span>
                    <input type="number" step="0.01" className="input pl-7"
                      {...register(`platform_prices.${p}`, { valueAsNumber: true, min: 0 })} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary flex-1">
              {mutation.isPending ? 'Saving…' : isEdit ? 'Update Product' : 'Create Product'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}


// ─── Product Detail Modal ────────────────────────────────────────────────────

function ProductDetailModal({ product, onEdit, onDelete, onClose, isAdmin }) {
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['product', product.id],
    queryFn: () => api.get(`/products/${product.id}`).then(r => r.data),
  });
  const { data: cogs, isLoading: cogsLoading } = useQuery({
    queryKey: ['productCogs', product.id],
    queryFn: () => api.get(`/products/${product.id}/cogs`).then(r => r.data),
  });

  const marginColor = (pct) => {
    if (pct >= 25) return 'text-emerald-600';
    if (pct >= 10) return 'text-amber-600';
    return 'text-rose-600';
  };

  return (
    <Modal title={product.name} onClose={onClose} wide>
      {detailLoading ? <Spinner /> : (
        <div className="space-y-6">
          {/* Basic */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="p-3 bg-slate-50 rounded-xl">
              <p className="text-slate-400 text-xs mb-0.5">SKU</p>
              <p className="font-semibold">{detail?.sku}</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl">
              <p className="text-slate-400 text-xs mb-0.5">Category</p>
              <p className="font-semibold">{detail?.category || '—'}</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl">
              <p className="text-slate-400 text-xs mb-0.5">Standard Time</p>
              <p className="font-semibold">{detail?.standard_time_minutes ?? 0} min</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl">
              <p className="text-slate-400 text-xs mb-0.5">Bunch Size</p>
              <p className="font-semibold">{detail?.bunch_size ?? 1}</p>
            </div>
          </div>
          {detail?.description && (
            <p className="text-slate-600 text-sm">{detail.description}</p>
          )}

          {/* COGS */}
          {!cogsLoading && cogs && (
            <div>
              <h4 className="font-medium text-slate-700 mb-2 text-sm uppercase tracking-wide">COGS Breakdown</h4>
              <div className="p-4 bg-purple-50 rounded-xl space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-slate-600">Material Cost</span><span className="font-semibold">{formatINR(cogs.material_cost ?? cogs.material_cost_per_unit)}</span></div>
                <div className="flex justify-between"><span className="text-slate-600">Labor Cost</span><span className="font-semibold">{formatINR(cogs.labor_cost ?? cogs.labor_cost_per_unit)}</span></div>
                <div className="flex justify-between border-t border-purple-200 pt-1 mt-1"><span className="font-medium text-purple-800">Total COGS</span><span className="font-bold text-purple-700">{formatINR(cogs.total_cogs)}</span></div>
              </div>
            </div>
          )}

          {/* BOM */}
          {detail?.bom?.length > 0 && (
            <div>
              <h4 className="font-medium text-slate-700 mb-2 text-sm uppercase tracking-wide">Bill of Materials</h4>
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>Material</th><th>Qty / Unit</th><th>Cost</th></tr></thead>
                  <tbody>
                    {detail.bom.map((b, i) => {
                      const unitCost = b.avg_cost_per_unit || b.cost_per_unit || 0;
                      const lineTotal = b.quantity_per_unit * unitCost;
                      return (
                        <tr key={i}>
                          <td className="font-medium">{b.material_name}</td>
                          <td>{b.quantity_per_unit} {b.unit || 'unit'}</td>
                          <td>{formatINR(lineTotal)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Platform Prices */}
          {detail?.platform_prices && (
            <div>
              <h4 className="font-medium text-slate-700 mb-2 text-sm uppercase tracking-wide">Platform Pricing</h4>
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>Platform</th><th>Price</th><th>Commission</th><th>Profit</th><th>Margin</th></tr></thead>
                  <tbody>
                    {PLATFORMS.filter(p => detail.platform_prices[p] > 0).map(p => {
                      const price = detail.platform_prices[p] ?? 0;
                      const commission = detail.platform_commissions?.[p] ?? 0;
                      const commAmt = price * (commission / 100);
                      const profit = price - commAmt - (cogs?.total_cogs ?? 0);
                      const margin = price > 0 ? (profit / price) * 100 : 0;
                      return (
                        <tr key={p}>
                          <td><span className={`badge platform-${p}`}>{p}</span></td>
                          <td className="font-semibold">{formatINR(price)}</td>
                          <td>{commission}% ({formatINR(commAmt)})</td>
                          <td>{formatINR(profit)}</td>
                          <td className={`font-bold ${marginColor(margin)}`}>{margin.toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {isAdmin && (
            <div className="flex gap-3 pt-2">
              <button onClick={onEdit} className="btn-secondary flex-1">✏️ Edit</button>
              <button onClick={onDelete} className="btn-danger flex-1">🗑️ Delete</button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ─── Product Card ─────────────────────────────────────────────────────────────
function ProductCard({ product, onClick }) {
  const { data: cogs } = useQuery({
    queryKey: ['productCogs', product.id],
    queryFn: () => api.get(`/products/${product.id}/cogs`).then(r => r.data),
    staleTime: 10 * 60 * 1000,
  });
  return (
    <div onClick={onClick}
      className="card cursor-pointer hover:shadow-md hover:border-violet-200 transition-all duration-200 group">
      <div className="flex items-start gap-4">
        <div className="w-16 h-16 rounded-xl bg-violet-50 flex items-center justify-center text-3xl shrink-0 group-hover:bg-violet-100 transition-colors">
          🧸
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-800 truncate">{product.name}</h3>
          <p className="text-xs text-slate-400 mt-0.5">SKU: {product.sku}</p>
          {product.category && (
            <span className="badge bg-violet-50 text-violet-600 mt-1">{product.category}</span>
          )}
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-slate-50 grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-slate-400">COGS</p>
          <p className="font-semibold text-slate-700">{cogs ? formatINR(cogs.total_cogs) : '—'}</p>
        </div>
        <div>
          <p className="text-slate-400">Stock</p>
          <p className={`font-semibold ${(product.stock_quantity ?? 0) <= (product.reorder_threshold ?? 0)
            ? 'text-rose-600' : 'text-slate-700'}`}>
            {product.stock_quantity ?? 0} pcs
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ProductsPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const isAdmin = ['owner', 'admin', 'super_admin'].includes(user?.role);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [formModal, setFormModal] = useState(null);    // null | 'add' | {product}
  const [detailProduct, setDetailProduct] = useState(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const { plan, usage, isLimitReached } = usePlan();

  const { data: productsData, isLoading } = useQuery({
    queryKey: ['products', search, category],
    queryFn: () => api.get('/products', {
      params: { search: search || undefined, category: category || undefined },
    }).then(r => r.data),
  });

  const { data: materialsData } = useQuery({
    queryKey: ['materials'],
    queryFn: () => api.get('/materials').then(r => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/products/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['tenant-usage'] });
      setDetailProduct(null);
      toast.success('Product deleted.');
    },
    onError: (e) => toast.error(e?.response?.data?.error || 'Delete failed.'),
  });

  const products = productsData?.products ?? productsData ?? [];
  const materials = materialsData?.materials ?? materialsData ?? [];
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))];

  const handleAddProduct = () => {
    if (isLimitReached('products')) {
      setShowUpgrade(true);
    } else {
      setFormModal('add');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Products</h1>
          <p className="text-slate-500 text-sm mt-0.5">Catalog, BOM, and platform pricing</p>
        </div>
        {isAdmin && (
          <button onClick={handleAddProduct} className="btn-primary">+ Add Product</button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input className="input max-w-xs" placeholder="🔍 Search products…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <select className="select w-44" value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">All Categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Main product catalog display */}
      {isLoading ? <Spinner /> : products.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-4xl mb-3">🧸</p>
          <p className="text-slate-500 font-medium">No products found.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {products.map(p => (
            <ProductCard key={p.id} product={p} onClick={() => setDetailProduct(p)} />
          ))}
        </div>
      )}

      {formModal && (
        <ProductFormModal
          product={formModal === 'add' ? null : formModal}
          materials={materials}
          onClose={() => {
            setFormModal(null);
            qc.invalidateQueries({ queryKey: ['tenant-usage'] });
          }}
        />
      )}
      {detailProduct && (
        <ProductDetailModal
          product={detailProduct}
          isAdmin={isAdmin}
          onClose={() => setDetailProduct(null)}
          onEdit={() => { setFormModal(detailProduct); setDetailProduct(null); }}
          onDelete={() => {
            if (window.confirm(`Delete "${detailProduct.name}"?`)) {
              deleteMutation.mutate(detailProduct.id);
            }
          }}
        />
      )}

      {showUpgrade && (
        <UpgradePrompt
          onClose={() => setShowUpgrade(false)}
          title="Product Limit Reached"
          message={`Your current plan allows up to ${plan?.max_products} active products in your catalog. Upgrade to Growth or Business to expand your catalog.`}
          limitKey="products"
          currentLimit={plan?.max_products}
        />
      )}
    </div>
  );
}
