/**
 * Migration: add labor_cost_per_unit to products table.
 */
exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('products', 'labor_cost_per_unit');
  if (!hasColumn) {
    await knex.schema.alterTable('products', (t) => {
      t.decimal('labor_cost_per_unit', 10, 2).defaultTo(0);
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable('products', (t) => {
    t.dropColumn('labor_cost_per_unit');
  });
};
