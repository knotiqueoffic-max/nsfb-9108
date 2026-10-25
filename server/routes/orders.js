const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const PDFDocument = require('pdfkit');
const db = require('../db/database');
const { authenticate, adminOnly } = require('../middleware/auth');
const { uploadCsv } = require('../middleware/upload');
const { parseOrderFile, matchOrdersToProducts } = require('../services/csv.service');
const { calculateCOGS } = require('../services/cost.service');

router.use(authenticate, adminOnly);



// GET /api/orders — filterable unified dashboard
router.get('/', async (req, res) => {
  const { platform, status, start, end, search, worker_id, limit = 50, offset = 0, stock_flagged, is_from_returned, label } = req.query;

  // Auto-rematch any unlinked orders whose SKU now exists in products
  try {
    await db.raw(`
      UPDATE orders
      SET product_id = (
        SELECT p.id FROM products p
        WHERE LOWER(TRIM(p.sku)) = LOWER(TRIM(orders.sku))
          AND p.tenant_id = orders.tenant_id
          AND p.is_active = 1
        LIMIT 1
      ),
      unmatched_sku = 0
      WHERE tenant_id = ?
        AND (product_id IS NULL OR unmatched_sku = 1)
        AND sku IS NOT NULL AND sku != ''
        AND EXISTS (
          SELECT 1 FROM products p
          WHERE LOWER(TRIM(p.sku)) = LOWER(TRIM(orders.sku))
            AND p.tenant_id = orders.tenant_id
            AND p.is_active = 1
        )
    `, [req.tenant_id]);
  } catch (e) { /* ignore silently */ }

  let query = db('orders as o')
    .leftJoin('products as p', 'o.product_id', 'p.id')
    .leftJoin('users as w', 'o.worker_id', 'w.id')
    .where('o.tenant_id', req.tenant_id) // Tenant scope
    .select('o.*', 'p.name as product_name_resolved', 'p.photo_url', 'w.name as worker_name_resolved')
    .orderBy('o.imported_at', 'desc');

  if (worker_id) query = query.where('o.worker_id', worker_id);
  if (platform) query = query.where('o.platform', platform);
  if (status) query = query.where('o.status', status);
  if (start) query = query.where('o.order_date', '>=', start);
  if (end) query = query.where('o.order_date', '<=', end);
  if (stock_flagged === 'true') query = query.where('o.stock_flagged', true);
  if (is_from_returned === 'true') query = query.where('o.is_from_returned', true);
  if (label) query = query.where('o.label', label);
  if (search) query = query.where(function () {
    this.whereILike('o.external_order_id', `%${search}%`)
        .orWhereILike('o.product_name', `%${search}%`)
        .orWhereILike('o.sku', `%${search}%`)
        .orWhereILike('o.worker_name', `%${search}%`)
        .orWhereILike('o.label', `%${search}%`);
  });

  const totalQuery = query.clone().clearSelect().clearOrder().count('o.id as count');
  const [{ count }] = await totalQuery;
  const orders = await query.limit(parseInt(limit)).offset(parseInt(offset));

  // Compute profit (using tenant-scoped products)
  const productsList = await db('products').where('tenant_id', req.tenant_id).select('id');
  const cogsMap = {};
  for (const product of productsList) {
    try {
      const cogs = await calculateCOGS(product.id, req.tenant_id);
      cogsMap[product.id] = cogs.total_cogs || 0;
    } catch (e) {
      cogsMap[product.id] = 0;
    }
  }

  const ordersWithProfit = orders.map(o => {
    if (!o.product_id) {
      return { ...o, cogs_per_unit: null, profit: null };
    }
    const cogsPerUnit  = cogsMap[o.product_id] || 0;
    const totalCost    = cogsPerUnit * (o.quantity || 0);
    const sellingPrice = o.unit_price || 0;
    const profitRevenue = sellingPrice * (o.quantity || 0);
    return { ...o, cogs_per_unit: cogsPerUnit, profit: profitRevenue - totalCost };
  });

  res.json({ orders: ordersWithProfit, total: parseInt(count) });
});

// GET /api/orders/stats
router.get('/stats', async (req, res) => {
  const [byStatus, byPlatform, flagged] = await Promise.all([
    db('orders').where('tenant_id', req.tenant_id)
      .select('status', db.raw('COUNT(*) as count')).groupBy('status'),
    db('orders').where('tenant_id', req.tenant_id)
      .whereNotNull('product_id')
      .select('platform', db.raw('COUNT(*) as count'), db.raw('SUM(COALESCE(listing_price, unit_price) * quantity) as revenue'))
      .groupBy('platform'),
    db('orders').where('tenant_id', req.tenant_id)
      .where('stock_flagged', true).where('status', 'pending').count('id as count').first(),
  ]);

  res.json({ by_status: byStatus, by_platform: byPlatform, stock_flagged_count: flagged.count });
});

// GET /api/orders/:id
router.get('/:id', async (req, res) => {
  const order = await db('orders as o')
    .leftJoin('products as p', 'o.product_id', 'p.id')
    .leftJoin('users as w', 'o.worker_id', 'w.id')
    .where('o.id', req.params.id)
    .where('o.tenant_id', req.tenant_id)
    .select('o.*', 'p.name as product_name_resolved', 'p.photo_url', 'w.name as worker_name_resolved')
    .first();
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

// POST /api/orders — manual order entry
router.post('/', [
  body('platform').isIn(['flipkart', 'meesho', 'myntra', 'etsy', 'amazon', 'manual']),
  body('quantity').isInt({ min: 1 }),
  body('unit_price').isFloat({ min: 0 }),
  body('listing_price').optional({ nullable: true }).isFloat({ min: 0 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const {
    platform, external_order_id, product_id, sku, product_name,
    quantity, unit_price, listing_price, order_date, status, customer_city, customer_state,
    shipping_deadline, notes, worker_id, worker_name,
  } = req.body;

  let resolvedWorkerId = worker_id ? parseInt(worker_id) : null;
  let resolvedWorkerName = worker_name || null;

  if (!resolvedWorkerId && resolvedWorkerName) {
    const matchedWorker = await db('users')
      .where('tenant_id', req.tenant_id)
      .where('role', 'worker')
      .whereILike('name', resolvedWorkerName.trim())
      .first();
    if (matchedWorker) { resolvedWorkerId = matchedWorker.id; resolvedWorkerName = matchedWorker.name; }
  } else if (resolvedWorkerId && !resolvedWorkerName) {
    const w = await db('users').where('id', resolvedWorkerId).where('tenant_id', req.tenant_id).first();
    if (w) resolvedWorkerName = w.name;
  }

  let stock_flagged = false;
  if (product_id) {
    const stock = await db('finished_goods_stock').where('product_id', product_id).first();
    if (!stock || stock.quantity < quantity) stock_flagged = true;
  }

  const isFromReturned = Boolean(req.body.is_from_returned || req.body.label === 'from the returned');
  const labelStr = req.body.label || (isFromReturned ? 'from the returned' : null);

  const [id] = await db('orders').insert({
    tenant_id: req.tenant_id,
    platform, external_order_id, product_id, sku, product_name,
    quantity: parseInt(quantity), unit_price: parseFloat(unit_price),
    listing_price: listing_price !== undefined && listing_price !== null ? parseFloat(listing_price) : null,
    order_date: order_date || new Date().toISOString().split('T')[0],
    status: status || 'pending',
    customer_city, customer_state, shipping_deadline, notes, stock_flagged,
    worker_id: resolvedWorkerId, worker_name: resolvedWorkerName,
    is_from_returned: isFromReturned,
    label: labelStr,
  }).returning('id');
  const orderId = typeof id === 'object' ? id.id : id;

  const order = await db('orders').where('id', orderId).first();

  res.status(201).json({ order });
});

// PUT /api/orders/:id/assign-worker
router.put('/:id/assign-worker', async (req, res) => {
  const order = await db('orders')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const { worker_id, worker_name } = req.body;
  let resolvedWorkerId = worker_id ? parseInt(worker_id) : null;
  let resolvedWorkerName = worker_name || null;

  if (!resolvedWorkerId && resolvedWorkerName) {
    const matchedWorker = await db('users')
      .where('tenant_id', req.tenant_id)
      .where('role', 'worker')
      .whereILike('name', resolvedWorkerName.trim())
      .first();
    if (matchedWorker) { resolvedWorkerId = matchedWorker.id; resolvedWorkerName = matchedWorker.name; }
  } else if (resolvedWorkerId && !resolvedWorkerName) {
    const w = await db('users').where('id', resolvedWorkerId).where('tenant_id', req.tenant_id).first();
    if (w) resolvedWorkerName = w.name;
  }

  await db('orders').where('id', req.params.id).where('tenant_id', req.tenant_id).update({
    worker_id: resolvedWorkerId, worker_name: resolvedWorkerName,
  });

  const updatedOrder = await db('orders').where('id', req.params.id).first();
  res.json({ order: updatedOrder });
});

// PUT /api/orders/:id/status
router.put('/:id/status', [
  body('status').isIn(['pending', 'packed', 'shipped', 'delivered', 'returned', 'cancelled']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const order = await db('orders')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const { status, notes } = req.body;
  const wasNotPacked = order.status !== 'packed';
  const isNowPacked  = status === 'packed';

  await db('orders').where('id', req.params.id).update({ status, notes: notes || order.notes });

  let stockDeduction = null;
  if (isNowPacked && wasNotPacked && order.product_id) {
    const stock = await db('finished_goods_stock').where('product_id', order.product_id).first();
    if (stock) {
      const newQty = Math.max(0, stock.quantity - order.quantity);
      await db('finished_goods_stock').where('product_id', order.product_id).update({
        quantity: newQty, updated_at: db.fn.now(),
      });
      await db('stock_adjustments').insert({
        tenant_id:      req.tenant_id,
        type:           'finished_good',
        reference_id:   order.product_id,
        quantity_delta: -order.quantity,
        reason:         `Order ${order.external_order_id || order.id} packed`,
        adjusted_by:    req.user.id,
      });
      stockDeduction = { product_id: order.product_id, deducted: order.quantity, new_stock: newQty };
    }
    await db('orders').where('id', req.params.id).update({ stock_flagged: false });
  }

  if ((status === 'returned' || status === 'cancelled') && order.status === 'packed' && order.product_id) {
    const stock = await db('finished_goods_stock').where('product_id', order.product_id).first();
    if (stock) {
      await db('finished_goods_stock').where('product_id', order.product_id).update({
        quantity: stock.quantity + order.quantity, updated_at: db.fn.now(),
      });
    }
  }

  const updated = await db('orders').where('id', req.params.id).first();
  res.json({ order: updated, stock_deduction: stockDeduction });
});

// PUT /api/orders/:id/label — update or toggle order label (e.g. 'from the returned')
router.put('/:id/label', async (req, res) => {
  const order = await db('orders')
    .where('id', req.params.id)
    .where('tenant_id', req.tenant_id)
    .first();
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const { label, is_from_returned } = req.body;
  const newIsFromReturned = is_from_returned !== undefined 
    ? Boolean(is_from_returned) 
    : (label === 'from the returned' ? !order.is_from_returned : Boolean(label));
  
  const newLabel = label !== undefined 
    ? label 
    : (newIsFromReturned ? 'from the returned' : null);

  await db('orders').where('id', req.params.id).update({
    label: newLabel,
    is_from_returned: newIsFromReturned,
  });

  const updated = await db('orders').where('id', req.params.id).first();
  res.json({ order: updated });
});

// POST /api/orders/import-preview — parse and preview CSV/Excel file before committing
router.post('/import-preview', uploadCsv.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { platform } = req.body;

  try {
    const { platform: detectedPlatform, rows, count } = await parseOrderFile(req.file.path, platform || null);
    const matchedRows = await matchOrdersToProducts(rows, req.tenant_id);

    // Compute COGS for matched products
    const productsList = await db('products').where('tenant_id', req.tenant_id).select('id');
    const cogsMap = {};
    for (const product of productsList) {
      try {
        const cogs = await calculateCOGS(product.id, req.tenant_id);
        cogsMap[product.id] = cogs.total_cogs || 0;
      } catch (e) {
        cogsMap[product.id] = 0;
      }
    }

    // Check existing order IDs in DB for duplicates
    const existingOrders = await db('orders')
      .where('tenant_id', req.tenant_id)
      .select('external_order_id', 'order_item_id');
    const existingIdSet = new Set();
    existingOrders.forEach(o => {
      if (o.external_order_id) existingIdSet.add(String(o.external_order_id).trim());
      if (o.order_item_id) existingIdSet.add(String(o.order_item_id).trim());
    });

    let matchedCount = 0;
    let unmatchedCount = 0;
    let duplicateCount = 0;
    const unmatchedSkuMap = {};

    const previewRows = matchedRows.map(row => {
      const isDuplicate = existingIdSet.has(String(row.external_order_id).trim()) ||
        (row.order_item_id && existingIdSet.has(String(row.order_item_id).trim()));

      if (isDuplicate) duplicateCount++;

      let cogs_per_unit = null;
      let estimated_profit = null;

      if (row.product_id) {
        matchedCount++;
        cogs_per_unit = cogsMap[row.product_id] || 0;
        estimated_profit = (row.unit_price - cogs_per_unit) * (row.quantity || 1);
      } else {
        unmatchedCount++;
        const skuKey = (row.sku || 'UNKNOWN').trim();
        if (!unmatchedSkuMap[skuKey]) {
          unmatchedSkuMap[skuKey] = {
            sku: row.sku || 'No SKU',
            product_name: row.product_name || 'Unmatched Product',
            count: 0,
          };
        }
        unmatchedSkuMap[skuKey].count += 1;
      }

      return {
        ...row,
        is_duplicate: isDuplicate,
        is_matched: Boolean(row.product_id),
        cogs_per_unit,
        estimated_profit,
      };
    });

    fs.unlink(req.file.path, () => {});

    res.json({
      platform: detectedPlatform,
      total_rows: count,
      matched_count: matchedCount,
      unmatched_count: unmatchedCount,
      duplicate_count: duplicateCount,
      unmatched_skus: Object.values(unmatchedSkuMap),
      preview_rows: previewRows.slice(0, 100), // return sample preview rows for UI
    });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(400).json({ error: err.message });
  }
});

// POST /api/orders/import — CSV/Excel commit upload
router.post('/import', uploadCsv.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { platform, skip_duplicates = 'true' } = req.body;
  const shouldSkipDuplicates = skip_duplicates === 'true' || skip_duplicates === true;

  try {
    const { platform: detectedPlatform, rows, count } = await parseOrderFile(req.file.path, platform || null);
    const matched = await matchOrdersToProducts(rows, req.tenant_id);

    // Compute COGS map
    const productsList = await db('products').where('tenant_id', req.tenant_id).select('id');
    const cogsMap = {};
    for (const product of productsList) {
      try {
        const cogs = await calculateCOGS(product.id, req.tenant_id);
        cogsMap[product.id] = cogs.total_cogs || 0;
      } catch (e) {
        cogsMap[product.id] = 0;
      }
    }

    const workers = await db('users').where('tenant_id', req.tenant_id).where('role', 'worker');
    const workerMap = {};
    workers.forEach(w => { workerMap[w.name.toLowerCase().trim()] = w; });

    let inserted = 0, updated = 0, skippedDuplicates = 0;
    let totalRevenue = 0;
    let totalProfit = 0;
    let unmatchedCount = 0;
    const unmatchedSkuMap = {};

    for (const orderRow of matched) {
      const exists = await db('orders')
        .where('tenant_id', req.tenant_id)
        .where('platform', detectedPlatform)
        .where('external_order_id', orderRow.external_order_id)
        .first();

      if (exists) {
        if (shouldSkipDuplicates) {
          skippedDuplicates++;
          continue;
        }

        const updatePayload = {};
        if (orderRow.status && orderRow.status !== exists.status) updatePayload.status = orderRow.status;
        if (orderRow.order_date && orderRow.order_date !== exists.order_date) updatePayload.order_date = orderRow.order_date;
        if (orderRow.unit_price !== undefined && orderRow.unit_price !== null) updatePayload.unit_price = orderRow.unit_price;
        if (orderRow.listing_price !== undefined && orderRow.listing_price !== null) updatePayload.listing_price = orderRow.listing_price;
        if (orderRow.product_id && orderRow.product_id !== exists.product_id) updatePayload.product_id = orderRow.product_id;
        if (orderRow.tracking_id) updatePayload.tracking_id = orderRow.tracking_id;

        if (Object.keys(updatePayload).length > 0) {
          await db('orders').where('id', exists.id).update(updatePayload);
          updated++;
        } else {
          skippedDuplicates++;
        }
        continue;
      }

      let worker_id = null;
      let worker_name = orderRow.worker_name || null;
      if (worker_name && workerMap[worker_name.toLowerCase().trim()]) {
        const w = workerMap[worker_name.toLowerCase().trim()];
        worker_id = w.id; worker_name = w.name;
      }

      let stock_flagged = false;
      if (orderRow.product_id) {
        const stock = await db('finished_goods_stock').where('product_id', orderRow.product_id).first();
        if (!stock || stock.quantity < orderRow.quantity) stock_flagged = true;

        const cogsPerUnit = cogsMap[orderRow.product_id] || 0;
        const lineProfit = (orderRow.unit_price - cogsPerUnit) * (orderRow.quantity || 1);
        totalProfit += lineProfit;
      } else {
        unmatchedCount++;
        const skuKey = (orderRow.sku || 'UNKNOWN').trim();
        if (!unmatchedSkuMap[skuKey]) {
          unmatchedSkuMap[skuKey] = {
            sku: orderRow.sku || 'No SKU',
            product_name: orderRow.product_name || 'Unmatched Product',
            count: 0,
          };
        }
        unmatchedSkuMap[skuKey].count += 1;
      }

      totalRevenue += (orderRow.unit_price || 0) * (orderRow.quantity || 1);

      await db('orders').insert({
        ...orderRow,
        tenant_id: req.tenant_id,
        worker_id, worker_name, stock_flagged,
      });
      inserted++;
    }

    fs.unlink(req.file.path, () => {});
    res.json({
      platform: detectedPlatform,
      total_rows: count,
      imported_count: inserted,
      updated_count: updated,
      skipped_duplicates: skippedDuplicates,
      total_revenue: totalRevenue,
      total_profit: totalProfit,
      unmatched_count: unmatchedCount,
      unmatched_skus: Object.values(unmatchedSkuMap),
    });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(400).json({ error: err.message });
  }
});

// GET /api/orders/:id/packing-slip — generate PDF
router.get('/:id/packing-slip', async (req, res) => {
  const order = await db('orders as o')
    .leftJoin('products as p', 'o.product_id', 'p.id')
    .leftJoin('users as w', 'o.worker_id', 'w.id')
    .where('o.id', req.params.id)
    .where('o.tenant_id', req.tenant_id)
    .select('o.*', 'p.name as product_name_resolved', 'w.name as worker_name_resolved')
    .first();
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const tenant = await db('tenants').where('id', req.tenant_id).first();
  const businessName = tenant?.name || 'Knotique';

  const doc = new PDFDocument({ margin: 40, size: 'A5' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=packing-slip-${order.id}.pdf`);
  doc.pipe(res);

  doc.fontSize(20).fillColor('#7c3aed').text(businessName.toUpperCase(), { align: 'center' });
  doc.fontSize(10).fillColor('#666').text('Handmade Products', { align: 'center' });
  doc.moveDown(0.5);
  doc.moveTo(40, doc.y).lineTo(400, doc.y).stroke('#7c3aed');
  doc.moveDown(0.5);

  doc.fontSize(14).fillColor('#111').text('PACKING SLIP', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#333');
  doc.text(`Order ID: ${order.external_order_id || order.id}`);
  doc.text(`Platform: ${order.platform.toUpperCase()}`);
  doc.text(`Order Date: ${order.order_date || 'N/A'}`);
  if (order.worker_name || order.worker_name_resolved) {
    doc.text(`Worker Assigned: ${order.worker_name || order.worker_name_resolved}`);
  }
  if (order.shipping_deadline) doc.text(`Ship By: ${order.shipping_deadline}`, { color: 'red' });
  doc.moveDown(0.5);

  doc.fontSize(11).fillColor('#111').text('Product Details', { underline: true });
  doc.fontSize(10).fillColor('#333');
  doc.text(`Product: ${order.product_name || order.product_name_resolved || 'N/A'}`);
  doc.text(`SKU: ${order.sku || 'N/A'}`);
  doc.text(`Quantity: ${order.quantity}`);
  doc.text(`Unit Price: ₹${order.unit_price}`);
  doc.text(`Total: ₹${(order.unit_price * order.quantity).toFixed(2)}`);
  doc.moveDown(0.5);

  if (order.customer_city || order.customer_state) {
    doc.fontSize(11).fillColor('#111').text('Ship To', { underline: true });
    doc.fontSize(10).fillColor('#333');
    doc.text(`${order.customer_city || ''}${order.customer_state ? ', ' + order.customer_state : ''}`);
  }

  doc.moveDown(1);
  doc.fontSize(9).fillColor('#999').text('Thank you for your purchase! 🧶', { align: 'center' });
  doc.end();
});

// POST /api/orders/bulk — bulk operations
router.post('/bulk', [
  body('ids').isArray({ min: 1 }),
  body('action').isIn(['status', 'assign_worker', 'delete', 'label']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { ids, action, status, worker_id, label, is_from_returned } = req.body;
  let updated = 0;
  const errs = [];

  for (const rawId of ids) {
    const id = parseInt(rawId);
    try {
      const order = await db('orders').where('id', id).where('tenant_id', req.tenant_id).first();
      if (!order) { errs.push({ id, error: 'Not found' }); continue; }

      if (action === 'label') {
        const targetIsReturned = is_from_returned !== undefined 
          ? Boolean(is_from_returned) 
          : (label === 'from the returned' ? true : Boolean(label));
        const targetLabel = label !== undefined 
          ? label 
          : (targetIsReturned ? 'from the returned' : null);

        await db('orders').where('id', id).update({
          label: targetLabel,
          is_from_returned: targetIsReturned,
        });
      } else if (action === 'status') {
        if (!status) { errs.push({ id, error: 'status required' }); continue; }
        const wasNotPacked = order.status !== 'packed';
        const isNowPacked  = status === 'packed';

        await db('orders').where('id', id).update({ status });

        if (isNowPacked && wasNotPacked && order.product_id) {
          const stock = await db('finished_goods_stock').where('product_id', order.product_id).first();
          if (stock) {
            const newQty = Math.max(0, stock.quantity - order.quantity);
            await db('finished_goods_stock').where('product_id', order.product_id).update({
              quantity: newQty, updated_at: db.fn.now(),
            });
            await db('stock_adjustments').insert({
              tenant_id: req.tenant_id, type: 'finished_good',
              reference_id: order.product_id, quantity_delta: -order.quantity,
              reason: `Bulk pack — Order ${order.external_order_id || order.id}`, adjusted_by: req.user.id,
            });
          }
          await db('orders').where('id', id).update({ stock_flagged: false });
        }

        if ((status === 'returned' || status === 'cancelled') && order.status === 'packed' && order.product_id) {
          const stock = await db('finished_goods_stock').where('product_id', order.product_id).first();
          if (stock) {
            await db('finished_goods_stock').where('product_id', order.product_id).update({
              quantity: stock.quantity + order.quantity, updated_at: db.fn.now(),
            });
          }
        }

      } else if (action === 'assign_worker') {
        const resolvedWorkerId = worker_id ? parseInt(worker_id) : null;
        let resolvedWorkerName = null;
        if (resolvedWorkerId) {
          const w = await db('users').where('id', resolvedWorkerId).where('tenant_id', req.tenant_id).first();
          if (w) resolvedWorkerName = w.name;
        }
        await db('orders').where('id', id).update({ worker_id: resolvedWorkerId, worker_name: resolvedWorkerName });

      } else if (action === 'delete') {
        if (order.status === 'packed' && order.product_id) {
          const stock = await db('finished_goods_stock').where('product_id', order.product_id).first();
          if (stock) {
            await db('finished_goods_stock').where('product_id', order.product_id).update({
              quantity: stock.quantity + order.quantity, updated_at: db.fn.now(),
            });
          }
        }
        const orderRefNote = `Order ${order.external_order_id || order.id}`;
        await db('production_entries').where('tenant_id', req.tenant_id).whereILike('notes', `%${orderRefNote}%`).del();
        await db('orders').where('id', id).where('tenant_id', req.tenant_id).del();
      }

      updated++;
    } catch (err) {
      errs.push({ id, error: err.message });
    }
  }

  res.json({ updated, errors: errs });
});

// DELETE /api/orders/:id
router.delete('/:id', async (req, res) => {
  const orderId = req.params.id;
  const order = await db('orders').where('id', orderId).where('tenant_id', req.tenant_id).first();
  if (!order) return res.status(404).json({ error: 'Order not found' });

  if (order.status === 'packed' && order.product_id) {
    const stock = await db('finished_goods_stock').where('product_id', order.product_id).first();
    if (stock) {
      await db('finished_goods_stock').where('product_id', order.product_id).update({
        quantity: stock.quantity + order.quantity, updated_at: db.fn.now(),
      });
    }
  }

  const orderRefNote = `Order ${order.external_order_id || order.id}`;
  await db('production_entries').where('tenant_id', req.tenant_id).whereILike('notes', `%${orderRefNote}%`).del();
  await db('orders').where('id', orderId).where('tenant_id', req.tenant_id).del();
  res.json({ message: 'Order deleted successfully' });
});

module.exports = router;
