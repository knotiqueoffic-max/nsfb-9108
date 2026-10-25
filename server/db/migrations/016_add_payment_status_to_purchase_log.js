/**
 * Migration 016 — Add payment-status tracking to purchase_log
 *
 * Adds two columns to `purchase_log`:
 *   payment_status — 'paid' | 'pending'  (existing rows default to 'paid')
 *   payment_date   — date payment was made (existing rows left null)
 *
 * SAFE: existing purchase rows are defaulted to 'paid' (per user confirmation —
 * those purchases were already settled). No data is removed or modified.
 */
exports.up = async function (knex) {
  const hasCol = await knex.schema.hasColumn('purchase_log', 'payment_status');
  if (!hasCol) {
    await knex.schema.alterTable('purchase_log', (t) => {
      t.string('payment_status').notNullable().defaultTo('paid'); // 'paid' | 'pending'
      t.date('payment_date').nullable();
    });
    // Explicitly set existing rows to 'paid' (matches the column default, but be explicit)
    await knex('purchase_log').whereNull('payment_status').update({ payment_status: 'paid' });
  }
};

exports.down = async function (knex) {
  const hasCol = await knex.schema.hasColumn('purchase_log', 'payment_status');
  if (hasCol) {
    await knex.schema.alterTable('purchase_log', (t) => {
      t.dropColumn('payment_status');
      t.dropColumn('payment_date');
    });
  }
};
