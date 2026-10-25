/**
 * Migration 017 — Add payment_status to the expenses table
 *
 * The existing `expenses` table records what payment METHOD was used (cash, UPI, etc.)
 * but does NOT track whether the expense has actually been paid yet.
 *
 * Adds one column to `expenses`:
 *   payment_status — 'paid' | 'pending'  (existing rows default to 'paid',
 *                    since they recorded a payment method, implying they were settled)
 *
 * SAFE: purely additive. No existing data is removed or modified.
 */
exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('expenses');
  if (!hasTable) return; // expenses table was created in 014; if not present, skip

  const hasCol = await knex.schema.hasColumn('expenses', 'payment_status');
  if (!hasCol) {
    await knex.schema.alterTable('expenses', (t) => {
      t.string('payment_status').notNullable().defaultTo('paid'); // 'paid' | 'pending'
    });
  }
};

exports.down = async function (knex) {
  const hasCol = await knex.schema.hasColumn('expenses', 'payment_status');
  if (hasCol) {
    await knex.schema.alterTable('expenses', (t) => {
      t.dropColumn('payment_status');
    });
  }
};
