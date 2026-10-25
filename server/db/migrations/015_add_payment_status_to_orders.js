/**
 * Migration 015 — Add payment-status tracking to orders
 *
 * Adds four columns to `orders`:
 *   payment_status          — 'pending' | 'received'  (default 'pending')
 *   payment_received_amount — actual amount received (may differ from unit_price × qty)
 *   payment_received_date   — date the settlement was marked received
 *   payment_notes           — optional note (e.g. "Flipkart deducted ₹12 commission")
 *
 * SAFE: all existing rows default to 'pending'. No data is removed or modified.
 */
exports.up = async function (knex) {
  const hasCol = await knex.schema.hasColumn('orders', 'payment_status');
  if (!hasCol) {
    await knex.schema.alterTable('orders', (t) => {
      t.string('payment_status').notNullable().defaultTo('pending'); // 'pending' | 'received'
      t.decimal('payment_received_amount', 12, 2).nullable();
      t.date('payment_received_date').nullable();
      t.text('payment_notes').nullable();
    });
  }
};

exports.down = async function (knex) {
  const hasCol = await knex.schema.hasColumn('orders', 'payment_status');
  if (hasCol) {
    await knex.schema.alterTable('orders', (t) => {
      t.dropColumn('payment_status');
      t.dropColumn('payment_received_amount');
      t.dropColumn('payment_received_date');
      t.dropColumn('payment_notes');
    });
  }
};
