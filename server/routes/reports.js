const router = require('express').Router();
const db = require('../db/database');
const { authenticate, adminOnly } = require('../middleware/auth');
const { calculateCOGS } = require('../services/cost.service');
const xlsx = require('xlsx');

router.use(authenticate, adminOnly);

// GET /api/reports/dashboard
router.get('/dashboard', async (req, res) => {
  const tid = req.tenant_id;
  const { start_date, end_date } = req.query;

  const todayStr = new Date().toISOString().split('T')[0];
  const start = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const end = end_date || todayStr;

  const [
    orderStats, productionStats, lowStockMaterials,
    lowStockGoods, pendingPayouts,
  ] = await Promise.all([
    db('orders').where('tenant_id', tid)
      .whereBetween('order_date', [start, end])
      .select(
        db.raw("COUNT(*) as total_orders"),
        db.raw("SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending"),
        db.raw("SUM(CASE WHEN status = 'shipped' THEN 1 ELSE 0 END) as shipped"),
        db.raw("SUM(CASE WHEN stock_flagged = 1 THEN 1 ELSE 0 END) as flagged")
      ).first(),
    db('production_entries').where('tenant_id', tid)
      .whereBetween('production_date', [start, end])
      .select(db.raw('SUM(quantity) as pieces_7d'), db.raw('SUM(labor_cost) as labor_7d')).first(),
    db('raw_materials').where('tenant_id', tid).whereRaw('stock_quantity <= reorder_threshold').count('id as count').first(),
    db('finished_goods_stock').where('tenant_id', tid).whereRaw('quantity <= reorder_threshold').count('id as count').first(),
    db('payouts').where('tenant_id', tid).whereIn('status', ['ordered', 'received']).sum('total_amount as total').first(),
  ]);

  const productsList = await db('products').where('tenant_id', tid).where('is_active', true).select('id');
  const cogsMap = {};
  for (const product of productsList) {
    try {
      const cogs = await calculateCOGS(product.id, tid);
      cogsMap[product.id] = cogs.total_cogs || 0;
    } catch (e) { cogsMap[product.id] = 0; }
  }

  const orders30d = await db('orders')
    .where('tenant_id', tid)
    .whereBetween('order_date', [start, end])
    .where('status', 'not in', ['cancelled', 'returned'])
    .whereNotNull('product_id')
    .select('product_id', 'unit_price', 'listing_price', 'quantity');

  let revenue30d = 0, profit30d = 0;
  for (const order of orders30d) {
    if (!order.product_id) continue;
    const qty          = parseInt(order.quantity || 0);
    const listingPrice = order.listing_price !== null && order.listing_price !== undefined ? parseFloat(order.listing_price) : parseFloat(order.unit_price || 0);
    const sellingPrice = parseFloat(order.unit_price || 0);
    const rev          = listingPrice * qty;
    revenue30d += rev;
    const cogsVal   = cogsMap[order.product_id] || 0;
    profit30d      += ((sellingPrice * qty) - (cogsVal * qty));
  }

  const revenueByPlatformOrders = await db('orders')
    .where('tenant_id', tid)
    .whereBetween('order_date', [start, end])
    .where('status', 'not in', ['cancelled', 'returned'])
    .whereNotNull('product_id')
    .select('platform', 'product_id', 'unit_price', 'listing_price', 'quantity');

  const platformMap = {};
  for (const o of revenueByPlatformOrders) {
    const p = o.platform;
    if (!platformMap[p]) platformMap[p] = { platform: p, revenue: 0, profit: 0, orders: 0 };
    const qty = parseInt(o.quantity || 0);
    const rev = parseFloat(o.unit_price || 0) * qty;
    const cogsVal = cogsMap[o.product_id] || 0;
    const prof = (parseFloat(o.unit_price || 0) - cogsVal) * qty;
    platformMap[p].revenue += rev;
    platformMap[p].profit += prof;
    platformMap[p].orders += 1;
  }

  const [productionTrend, topProducts] = await Promise.all([
    db('production_entries').where('tenant_id', tid)
      .whereBetween('production_date', [start, end])
      .select('production_date', db.raw('SUM(quantity) as quantity'), db.raw('SUM(labor_cost) as labor_cost'))
      .groupBy('production_date').orderBy('production_date'),
    db('orders as o').join('products as p', 'o.product_id', 'p.id')
      .where('o.tenant_id', tid)
      .whereBetween('o.order_date', [start, end])
      .where('o.status', 'not in', ['cancelled', 'returned'])
      .select('p.name', 'p.sku', db.raw('SUM(o.quantity) as total_sold'), db.raw('SUM(o.unit_price * o.quantity) as revenue'))
      .groupBy('p.id').orderBy('total_sold', 'desc').limit(5),
  ]);

  res.json({
    order_stats:      orderStats,
    revenue_stats:    { revenue_30d: revenue30d, orders_30d: orders30d.length, profit_30d: profit30d },
    production_stats: productionStats,
    low_stock_materials: parseInt(lowStockMaterials.count),
    low_stock_goods:     parseInt(lowStockGoods.count),
    pending_payouts:     parseFloat(pendingPayouts.total || 0).toFixed(2),
    production_trend:    productionTrend,
    revenue_by_platform: Object.values(platformMap),
    top_products:        topProducts,
  });
});

// GET /api/reports/sales-by-platform
router.get('/sales-by-platform', async (req, res) => {
  const { start, end } = req.query;
  let query = db('orders').where('tenant_id', req.tenant_id)
    .where('status', 'not in', ['cancelled', 'returned'])
    .whereNotNull('product_id')
    .select(
      'platform',
      db.raw('COUNT(*) as order_count'),
      db.raw('COUNT(*) as orders'),
      db.raw('SUM(quantity) as units_sold'),
      db.raw('SUM(COALESCE(listing_price, unit_price) * quantity) as revenue')
    )
    .groupBy('platform');
  if (start) query = query.where('order_date', '>=', start);
  if (end) query = query.where('order_date', '<=', end);
  res.json(await query);
});

// GET /api/reports/profit-margins
router.get('/profit-margins', async (req, res) => {
  const tid = req.tenant_id;
  const products = await db('products').where('tenant_id', tid).where('is_active', true).select('id', 'name', 'sku', 'standard_time_minutes');

  const settingsRow = await db('settings').where({ tenant_id: tid, key: 'platform_commissions' }).first();
  const commissions = settingsRow ? JSON.parse(settingsRow.value) : {};
  const laborRow = await db('settings').where({ tenant_id: tid, key: 'labor_cost_per_minute' }).first();
  const laborCostPerMin = laborRow ? parseFloat(JSON.parse(laborRow.value)) : 1;

  const result = [];
  for (const product of products) {
    let cogs;
    try { cogs = await calculateCOGS(product.id, tid); } catch { continue; }
    const laborCostPerUnit = product.standard_time_minutes * laborCostPerMin;
    const totalCost = cogs.material_cost_per_unit + laborCostPerUnit;
    const platforms = await db('product_platforms').where('product_id', product.id);
    const platformMargins = platforms.map(pp => {
      const commPct = pp.commission_pct || commissions[pp.platform] || 0;
      const commAmt = pp.selling_price * commPct / 100;
      const profit = pp.selling_price - commAmt - totalCost;
      return {
        platform: pp.platform,
        selling_price: pp.selling_price,
        price: pp.selling_price,
        commission_pct: commPct,
        commission_amt: parseFloat(commAmt.toFixed(2)),
        total_cost: parseFloat(totalCost.toFixed(2)),
        profit: parseFloat(profit.toFixed(2)),
        margin_pct: parseFloat(parseFloat(pp.selling_price > 0 ? (profit / pp.selling_price * 100) : 0).toFixed(1)),
      };
    });
    result.push({
      product_id: product.id,
      name: product.name,
      sku: product.sku,
      material_cost: parseFloat(cogs.material_cost_per_unit.toFixed(2)),
      labor_cost: parseFloat(laborCostPerUnit.toFixed(2)),
      total_cost: parseFloat(totalCost.toFixed(2)),
      total_cogs: parseFloat(totalCost.toFixed(2)),
      platforms: platformMargins,
      platform_margins: platformMargins,
    });
  }
  res.json(result);
});

// GET /api/reports/best-sellers
router.get('/best-sellers', async (req, res) => {
  const { start, end, limit = 10 } = req.query;
  let query = db('orders as o').join('products as p', 'o.product_id', 'p.id')
    .where('o.tenant_id', req.tenant_id)
    .where('o.status', 'not in', ['cancelled', 'returned'])
    .select(
      'p.id',
      'p.id as product_id',
      'p.name',
      'p.sku',
      'p.category',
      db.raw('SUM(o.quantity) as units_sold'),
      db.raw('SUM(COALESCE(o.listing_price, o.unit_price) * o.quantity) as revenue'),
      db.raw('COUNT(o.id) as order_count')
    )
    .groupBy('p.id').orderBy('units_sold', 'desc').limit(parseInt(limit));
  if (start) query = query.where('o.order_date', '>=', start);
  if (end) query = query.where('o.order_date', '<=', end);
  res.json(await query);
});

// GET /api/reports/material-usage
router.get('/material-usage', async (req, res) => {
  const { start, end } = req.query;
  let peQuery = db('production_entries').where('tenant_id', req.tenant_id)
    .select('product_id', db.raw('SUM(quantity) as total_produced')).groupBy('product_id');
  if (start) peQuery = peQuery.where('production_date', '>=', start);
  if (end) peQuery = peQuery.where('production_date', '<=', end);
  const productionTotals = await peQuery;

  const usageMap = {};
  for (const pt of productionTotals) {
    const bom = await db('product_bom as pb').join('raw_materials as rm', 'pb.material_id', 'rm.id')
      .where('pb.product_id', pt.product_id)
      .select('pb.material_id', 'rm.name as material_name', 'rm.unit', 'rm.category', 'pb.quantity_per_unit');
    for (const item of bom) {
      const mat = await db('raw_materials').where('id', item.material_id).where('tenant_id', req.tenant_id).first();
      if (!mat) continue;
      const used = item.quantity_per_unit * pt.total_produced;
      const cost = used * mat.avg_cost_per_unit;
      if (!usageMap[item.material_id]) {
        usageMap[item.material_id] = {
          material_id: item.material_id,
          name: item.material_name,
          category: item.category,
          unit: item.unit,
          total_used: 0,
          total_cost: 0
        };
      }
      usageMap[item.material_id].total_used += used;
      usageMap[item.material_id].total_cost += cost;
    }
  }
  res.json(Object.values(usageMap).map(u => ({
    ...u, total_used: parseFloat(u.total_used.toFixed(3)), total_cost: parseFloat(u.total_cost.toFixed(2)),
  })).sort((a, b) => b.total_cost - a.total_cost));
});

// GET /api/reports/worker-productivity
router.get('/worker-productivity', async (req, res) => {
  const { start, end } = req.query;
  let query = db('production_entries as pe').join('users as u', 'pe.worker_id', 'u.id')
    .where('pe.tenant_id', req.tenant_id)
    .select(
      'u.id',
      'u.id as worker_id',
      'u.name',
      'u.wage_mode',
      'u.wage_rate',
      db.raw('SUM(pe.quantity) as total_pieces'),
      db.raw('SUM(pe.quantity) as pieces'),
      db.raw('SUM(pe.defect_count) as defects'),
      db.raw('SUM(pe.labor_cost) as total_earnings'),
      db.raw('SUM(pe.labor_cost) as labor_cost'),
      db.raw('COUNT(pe.id) as entry_count'),
      db.raw('COUNT(DISTINCT pe.production_date) as days_worked')
    )
    .groupBy('u.id').orderBy('total_pieces', 'desc');
  if (start) query = query.where('pe.production_date', '>=', start);
  if (end) query = query.where('pe.production_date', '<=', end);
  res.json(await query);
});

// GET /api/reports/export/:type
router.get('/export/:type', async (req, res) => {
  const { type } = req.params;
  const { start, end } = req.query;
  const tid = req.tenant_id;
  let data = [], sheetName = type;

  switch (type) {
    case 'orders': {
      let q = db('orders').where('tenant_id', tid);
      if (start) q = q.where('order_date', '>=', start);
      if (end) q = q.where('order_date', '<=', end);
      data = await q.orderBy('order_date', 'desc');
      sheetName = 'Orders'; break;
    }
    case 'production': {
      let q = db('production_entries as pe').join('users as u', 'pe.worker_id', 'u.id').join('products as p', 'pe.product_id', 'p.id')
        .where('pe.tenant_id', tid).select('pe.*', 'u.name as worker_name', 'p.name as product_name', 'p.sku');
      if (start) q = q.where('pe.production_date', '>=', start);
      if (end) q = q.where('pe.production_date', '<=', end);
      data = await q.orderBy('pe.production_date', 'desc');
      sheetName = 'Production'; break;
    }
    case 'payouts': {
      data = await db('payouts as py').join('users as u', 'py.worker_id', 'u.id')
        .where('py.tenant_id', tid).select('py.*', 'u.name as worker_name').orderBy('py.created_at', 'desc');
      sheetName = 'Payouts'; break;
    }
    case 'materials': {
      data = await db('raw_materials').where('tenant_id', tid).orderBy('name');
      sheetName = 'Materials'; break;
    }
    default: return res.status(400).json({ error: 'Unknown export type' });
  }

  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet(data);
  xlsx.utils.book_append_sheet(wb, ws, sheetName);
  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=knotique-${type}-export.xlsx`);
  res.send(buffer);
});

module.exports = router;
