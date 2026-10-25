/**
 * Migration: add is_paid and paid_at to production_entries table.
 */
exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('production_entries', 'is_paid');
  if (!hasColumn) {
    await knex.schema.alterTable('production_entries', (t) => {
      t.boolean('is_paid').defaultTo(false);
      t.timestamp('paid_at').nullable();
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable('production_entries', (t) => {
    t.dropColumn('is_paid');
    t.dropColumn('paid_at');
  });
};
