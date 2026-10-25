/**
 * Migration 012 — Add unmatched_sku boolean column to orders table
 */
exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('orders', 'unmatched_sku');
  if (!hasColumn) {
    await knex.schema.alterTable('orders', (t) => {
      t.boolean('unmatched_sku').defaultTo(false);
    });
  }
};

exports.down = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('orders', 'unmatched_sku');
  if (hasColumn) {
    await knex.schema.alterTable('orders', (t) => {
      t.dropColumn('unmatched_sku');
    });
  }
};
