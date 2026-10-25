/**
 * Migration: add worker_id and worker_name to orders table.
 */
exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('orders', 'worker_id');
  if (!hasColumn) {
    await knex.schema.alterTable('orders', (t) => {
      t.integer('worker_id').unsigned().nullable().references('id').inTable('users');
      t.string('worker_name').nullable();
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.dropColumn('worker_id');
    t.dropColumn('worker_name');
  });
};
