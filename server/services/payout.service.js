const db = require('../db/database');

/**
 * Calculate payout for a worker over a date range.
 * Scoped to tenantId to prevent cross-tenant data access.
 */
async function calcWorkerPayout(workerId, periodStart, periodEnd, tenantId = null) {
  const workerQuery = db('users').where('id', workerId);
  if (tenantId) workerQuery.where('tenant_id', tenantId);
  const worker = await workerQuery.first();
  if (!worker) throw new Error('Worker not found');

  const entriesQuery = db('production_entries')
    .where('worker_id', workerId)
    .whereBetween('production_date', [periodStart, periodEnd])
    .whereNot('status', 'paid');
  if (tenantId) entriesQuery.where('tenant_id', tenantId);
  const entries = await entriesQuery;

  let totalPieces = 0;
  let totalHours  = 0;
  let totalDays   = 0;
  let totalAmount = 0;

  const uniqueDates = new Set();

  for (const entry of entries) {
    totalPieces += entry.quantity;
    if (entry.hours_worked) totalHours += parseFloat(entry.hours_worked);

    let dateStr = entry.production_date;
    if (dateStr instanceof Date) {
      dateStr = dateStr.toISOString().split('T')[0];
    } else if (typeof dateStr === 'string') {
      dateStr = dateStr.split(' ')[0].split('T')[0];
    }
    uniqueDates.add(dateStr);
  }

  totalDays = uniqueDates.size;

  if (worker.wage_mode === 'per_day') {
    totalAmount = totalDays * worker.wage_rate;
  } else {
    totalAmount = entries.reduce((sum, entry) => sum + (parseFloat(entry.labor_cost) || 0), 0);
  }

  const parsedHours = parseFloat(totalHours.toFixed(2));
  const parsedAmount = parseFloat(totalAmount.toFixed(2));

  return {
    worker_id:    workerId,
    worker_name:  worker.name,
    wage_mode:    worker.wage_mode,
    wage_rate:    worker.wage_rate,
    period_start: periodStart,
    period_end:   periodEnd,
    total_pieces: totalPieces,
    pieces:       totalPieces,
    total_hours:  parsedHours,
    hours:        parsedHours,
    total_days:   totalDays,
    days:         totalDays,
    total_amount: parsedAmount,
    amount:       parsedAmount,
    entry_count:  entries.length,
  };
}

/**
 * Get payout summary for all active workers in a tenant over a period.
 */
async function calcAllWorkerPayouts(periodStart, periodEnd, tenantId = null) {
  const workersQuery = db('users').where('role', 'worker').where('is_active', true);
  if (tenantId) workersQuery.where('tenant_id', tenantId);
  const workers = await workersQuery;

  const results = await Promise.all(
    workers.map(w => calcWorkerPayout(w.id, periodStart, periodEnd, tenantId))
  );
  return results;
}

module.exports = { calcWorkerPayout, calcAllWorkerPayouts };
