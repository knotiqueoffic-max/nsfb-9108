exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('orders', 'is_from_returned');
  if (!hasColumn) {
    return knex.schema.table('orders', (t) => {
      t.string('label').nullable();
      t.boolean('is_from_returned').defaultTo(false);
    });
  }
};

exports.down = function(knex) {
  return knex.schema.table('orders', (t) => {
    t.dropColumn('label');
    t.dropColumn('is_from_returned');
  });
};
