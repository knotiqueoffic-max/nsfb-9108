exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('orders', 'listing_price');
  if (!hasColumn) {
    await knex.schema.alterTable('orders', (t) => {
      t.decimal('listing_price', 10, 2).nullable().defaultTo(null);
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.dropColumn('listing_price');
  });
};
