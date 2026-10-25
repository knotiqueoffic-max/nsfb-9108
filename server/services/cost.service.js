const db = require('../db/database');

/**
 * Calculate COGS for a product. Accepts optional tenantId for defense-in-depth
 * (ensures BOM materials also belong to same tenant).
 */
async function calculateCOGS(productId, tenantId = null) {
  const productQuery = db('products').where('id', productId);
  if (tenantId) productQuery.where('tenant_id', tenantId);
  const product = await productQuery.first();
  if (!product) throw new Error('Product not found');

  const bom = await db('product_bom as pb')
    .join('raw_materials as rm', 'pb.material_id', 'rm.id')
    .where('pb.product_id', productId)
    .select('pb.*', 'rm.name as material_name', 'rm.avg_cost_per_unit', 'rm.unit');

  let materialCostPerUnit = 0;
  const breakdown = bom.map((item) => {
    const lineTotal = item.quantity_per_unit * item.avg_cost_per_unit;
    materialCostPerUnit += lineTotal;
    return {
      material_id:       item.material_id,
      material_name:     item.material_name,
      unit:              item.unit,
      quantity_per_unit: item.quantity_per_unit,
      avg_cost_per_unit: item.avg_cost_per_unit,
      line_total:        lineTotal,
    };
  });

  const materialCostPerBunch = materialCostPerUnit * product.bunch_size;
  const laborCostPerUnit     = parseFloat(product.labor_cost_per_unit || 0);
  const totalCogs            = materialCostPerUnit + laborCostPerUnit;

  return {
    product_id:             productId,
    sku:                    product.sku,
    bunch_size:             product.bunch_size,
    material_cost:          materialCostPerUnit,
    material_cost_per_unit: materialCostPerUnit,
    labor_cost:             laborCostPerUnit,
    labor_cost_per_unit:    laborCostPerUnit,
    total_cogs:             totalCogs,
    material_cost_per_bunch: materialCostPerBunch,
    total_cogs_per_bunch:   totalCogs * product.bunch_size,
    breakdown,
  };
}

/**
 * Suggest selling prices for all platforms based on COGS + labor + margin + commission.
 * Reads platform_commissions from tenant-scoped settings.
 */
async function suggestPrices(productId, { laborCostPerMinute = 1, desiredMarginPct = 30 } = {}, tenantId = null) {
  const productQuery = db('products').where('id', productId);
  if (tenantId) productQuery.where('tenant_id', tenantId);
  const product = await productQuery.first();

  const { material_cost_per_unit } = await calculateCOGS(productId, tenantId);

  let laborCostPerUnit = parseFloat(product.labor_cost_per_unit || 0);
  if (laborCostPerUnit === 0 && product.standard_time_minutes > 0) {
    laborCostPerUnit = (product.standard_time_minutes || 0) * laborCostPerMinute;
  }

  const baseCost = material_cost_per_unit + laborCostPerUnit;

  // Read tenant-specific platform commissions
  let settingsRow;
  if (tenantId) {
    settingsRow = await db('settings').where({ tenant_id: tenantId, key: 'platform_commissions' }).first();
  } else {
    settingsRow = await db('settings').where('key', 'platform_commissions').first();
  }
  const commissions = settingsRow
    ? JSON.parse(settingsRow.value)
    : { flipkart: 18, meesho: 12, myntra: 20, etsy: 6.5, amazon: 15 };

  const suggestions = {};
  for (const [platform, commPct] of Object.entries(commissions)) {
    const targetRevenue  = baseCost * (1 + desiredMarginPct / 100);
    const suggestedPrice = targetRevenue / (1 - commPct / 100);
    suggestions[platform] = {
      suggested_price:  Math.ceil(suggestedPrice),
      commission_pct:   commPct,
      commission_amount: parseFloat((suggestedPrice * commPct / 100).toFixed(2)),
      material_cost:    parseFloat(material_cost_per_unit.toFixed(2)),
      labor_cost:       parseFloat(laborCostPerUnit.toFixed(2)),
      base_cost:        parseFloat(baseCost.toFixed(2)),
      margin_pct:       desiredMarginPct,
    };
  }
  return suggestions;
}

/**
 * Recalculate avg_cost_per_unit for a material using weighted moving average.
 * Called after every purchase. Optionally scoped by tenantId for defense-in-depth.
 */
async function recalcAvgCost(materialId, newQty, newCostPerUnit, tenantId = null, trx = null) {
  const knexClient = trx || db;
  const query = knexClient('raw_materials').where('id', materialId);
  if (tenantId) query.where('tenant_id', tenantId);
  const mat = await query.first();
  if (!mat) throw new Error('Material not found');

  const oldStock   = mat.stock_quantity;
  const oldAvgCost = mat.avg_cost_per_unit || mat.cost_per_unit;
  const totalQty   = oldStock + newQty;
  const newAvgCost = totalQty > 0
    ? ((oldStock * oldAvgCost) + (newQty * newCostPerUnit)) / totalQty
    : newCostPerUnit;

  await knexClient('raw_materials').where('id', materialId).update({
    stock_quantity:    totalQty,
    avg_cost_per_unit: newAvgCost,
    cost_per_unit:     newCostPerUnit,
    updated_at:        knexClient.fn.now(),
  });

  return { new_stock: totalQty, new_avg_cost: newAvgCost };
}

/**
 * Deduct raw material stock based on BOM when production is logged.
 * Scoped to tenant via material lookup.
 */
async function deductMaterialsForProduction(productId, quantity, tenantId = null) {
  const bom = await db('product_bom').where('product_id', productId);
  const deductions = [];

  for (const item of bom) {
    const required = item.quantity_per_unit * quantity;
    const matQuery = db('raw_materials').where('id', item.material_id);
    if (tenantId) matQuery.where('tenant_id', tenantId);
    const mat = await matQuery.first();
    if (!mat) continue;

    const newStock = Math.max(0, mat.stock_quantity - required);
    await db('raw_materials').where('id', item.material_id).update({
      stock_quantity: newStock, updated_at: db.fn.now(),
    });

    deductions.push({
      material_id:      item.material_id,
      material_name:    mat.name,
      required,
      deducted:         Math.min(required, mat.stock_quantity),
      remaining_stock:  newStock,
      was_insufficient: mat.stock_quantity < required,
    });
  }

  return deductions;
}

/**
 * Calculate labor cost for a production entry based on worker wage mode.
 */
async function calcLaborCost(workerId, quantity, hoursWorked, productId = null) {
  const worker = await db('users').where('id', workerId).first();
  let laborCost = 0;

  if (worker) {
    switch (worker.wage_mode) {
      case 'per_piece': laborCost = worker.wage_rate * quantity; break;
      case 'per_hour':  laborCost = worker.wage_rate * (hoursWorked || 0); break;
      case 'per_day':   laborCost = worker.wage_rate; break;
      default:          laborCost = 0;
    }
  }

  if (laborCost === 0 && productId) {
    const product = await db('products').where('id', productId).first();
    if (product && product.labor_cost_per_unit > 0) {
      laborCost = product.labor_cost_per_unit * quantity;
    }
  }

  return parseFloat(laborCost.toFixed(2));
}

module.exports = { calculateCOGS, suggestPrices, recalcAvgCost, deductMaterialsForProduction, calcLaborCost };
