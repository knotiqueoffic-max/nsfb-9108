/**
 * Initial schema migration — PostgreSQL-compatible DDL using Knex schema builder.
 * To migrate to PostgreSQL: change KNEX_CLIENT=pg in .env and run npm run migrate.
 */
exports.up = async function (knex) {
  // Users / Auth
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('name').notNullable();
    t.string('email').unique().notNullable();
    t.string('password_hash').notNullable();
    t.enu('role', ['admin', 'worker']).notNullable().defaultTo('worker');
    t.enu('wage_mode', ['per_piece', 'per_hour', 'per_day']).nullable();
    t.decimal('wage_rate', 10, 2).defaultTo(0);
    t.boolean('is_active').defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Raw Materials
  await knex.schema.createTable('raw_materials', (t) => {
    t.increments('id').primary();
    t.string('name').notNullable();
    t.string('category').nullable();
    t.string('unit').notNullable(); // grams, meters, pieces, ml
    t.decimal('stock_quantity', 12, 3).defaultTo(0);
    t.decimal('cost_per_unit', 10, 4).defaultTo(0);
    t.decimal('avg_cost_per_unit', 10, 4).defaultTo(0);
    t.string('supplier').nullable();
    t.decimal('reorder_threshold', 12, 3).defaultTo(0);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Purchase Log
  await knex.schema.createTable('purchase_log', (t) => {
    t.increments('id').primary();
    t.integer('material_id').unsigned().notNullable().references('id').inTable('raw_materials').onDelete('RESTRICT');
    t.decimal('quantity', 12, 3).notNullable();
    t.decimal('cost_per_unit', 10, 4).notNullable();
    t.decimal('total_cost', 12, 2).notNullable();
    t.string('supplier').nullable();
    t.date('purchase_date').notNullable();
    t.text('notes').nullable();
    t.integer('created_by').unsigned().nullable().references('id').inTable('users');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Products
  await knex.schema.createTable('products', (t) => {
    t.increments('id').primary();
    t.string('name').notNullable();
    t.string('sku').unique().notNullable();
    t.string('category').nullable();
    t.text('description').nullable();
    t.string('photo_url').nullable();
    t.integer('standard_time_minutes').defaultTo(0);
    t.decimal('labor_cost_per_unit', 10, 2).defaultTo(0);
    t.integer('bunch_size').defaultTo(1); // e.g. 10 for keychains
    t.boolean('is_active').defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Product → Platform Prices
  await knex.schema.createTable('product_platforms', (t) => {
    t.increments('id').primary();
    t.integer('product_id').unsigned().notNullable().references('id').inTable('products').onDelete('CASCADE');
    t.enu('platform', ['flipkart', 'meesho', 'myntra', 'etsy', 'amazon']).notNullable();
    t.decimal('selling_price', 10, 2).defaultTo(0);
    t.decimal('commission_pct', 5, 2).defaultTo(0);
    t.unique(['product_id', 'platform']);
  });

  // Bill of Materials (recipe per unit)
  await knex.schema.createTable('product_bom', (t) => {
    t.increments('id').primary();
    t.integer('product_id').unsigned().notNullable().references('id').inTable('products').onDelete('CASCADE');
    t.integer('material_id').unsigned().notNullable().references('id').inTable('raw_materials').onDelete('RESTRICT');
    t.decimal('quantity_per_unit', 12, 4).notNullable();
    t.unique(['product_id', 'material_id']);
  });

  // Production Entries
  await knex.schema.createTable('production_entries', (t) => {
    t.increments('id').primary();
    t.integer('worker_id').unsigned().notNullable().references('id').inTable('users');
    t.integer('product_id').unsigned().notNullable().references('id').inTable('products');
    t.integer('quantity').notNullable();
    t.integer('defect_count').defaultTo(0);
    t.date('production_date').notNullable();
    t.text('notes').nullable();
    t.decimal('labor_cost', 10, 2).defaultTo(0);
    t.decimal('hours_worked', 8, 2).nullable();
    t.boolean('is_paid').defaultTo(false);
    t.timestamp('paid_at').nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Finished Goods Stock
  await knex.schema.createTable('finished_goods_stock', (t) => {
    t.increments('id').primary();
    t.integer('product_id').unsigned().unique().notNullable().references('id').inTable('products').onDelete('CASCADE');
    t.integer('quantity').defaultTo(0);
    t.integer('reorder_threshold').defaultTo(0);
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Orders (unified across platforms)
  await knex.schema.createTable('orders', (t) => {
    t.increments('id').primary();
    t.enu('platform', ['flipkart', 'meesho', 'myntra', 'etsy', 'amazon', 'manual']).notNullable();
    t.string('external_order_id').nullable();
    t.integer('product_id').unsigned().nullable().references('id').inTable('products');
    t.string('sku').nullable();
    t.string('product_name').nullable();
    t.integer('quantity').notNullable().defaultTo(1);
    t.decimal('unit_price', 10, 2).defaultTo(0);
    t.date('order_date').nullable();
    t.enu('status', ['pending', 'packed', 'shipped', 'delivered', 'returned', 'cancelled']).defaultTo('pending');
    t.string('customer_city').nullable();
    t.string('customer_state').nullable();
    t.date('shipping_deadline').nullable();
    t.text('notes').nullable();
    t.boolean('stock_flagged').defaultTo(false); // true if stock insufficient
    t.integer('worker_id').unsigned().nullable().references('id').inTable('users');
    t.string('worker_name').nullable();
    t.timestamp('imported_at').defaultTo(knex.fn.now());
  });

  // Stock Adjustments (manual corrections)
  await knex.schema.createTable('stock_adjustments', (t) => {
    t.increments('id').primary();
    t.enu('type', ['raw_material', 'finished_good']).notNullable();
    t.integer('reference_id').unsigned().notNullable(); // material_id or product_id
    t.decimal('quantity_delta', 12, 3).notNullable(); // positive = add, negative = remove
    t.string('reason').nullable();
    t.integer('adjusted_by').unsigned().nullable().references('id').inTable('users');
    t.timestamp('adjusted_at').defaultTo(knex.fn.now());
  });

  // Payouts
  await knex.schema.createTable('payouts', (t) => {
    t.increments('id').primary();
    t.integer('worker_id').unsigned().notNullable().references('id').inTable('users');
    t.date('period_start').notNullable();
    t.date('period_end').notNullable();
    t.integer('total_pieces').defaultTo(0);
    t.decimal('total_hours', 8, 2).defaultTo(0);
    t.integer('total_days').defaultTo(0);
    t.decimal('total_amount', 10, 2).defaultTo(0);
    t.enu('status', ['pending', 'paid']).defaultTo('pending');
    t.timestamp('paid_at').nullable();
    t.text('notes').nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Settings (key-value store)
  await knex.schema.createTable('settings', (t) => {
    t.string('key').primary();
    t.text('value').notNullable(); // JSON string
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  const tables = [
    'settings', 'payouts', 'stock_adjustments', 'orders',
    'finished_goods_stock', 'production_entries', 'product_bom',
    'product_platforms', 'products', 'purchase_log', 'raw_materials', 'users',
  ];
  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
};
