/**
 * Migration 006 — Multi-Tenancy Core Schema
 *
 * Adds multi-tenant support without losing any existing data:
 *  • Creates `tenants` and `plans` tables
 *  • Seeds 3 subscription plans (Starter / Growth / Business)
 *  • Assigns ALL existing data to tenant_id = 1 (the legacy "Knotique" tenant)
 *  • Promotes the existing admin user to the 'owner' role
 *  • Recreates `users`, `products`, and `settings` tables to relax/change constraints
 *  • Adds tenant_id column to every remaining business-data table
 *
 * SAFE: existing data is fully preserved. No seed reset needed.
 */
exports.up = async function (knex) {
  // ────────────────────────────────────────────────────────────────────────────
  // 1. Plans table (config-driven: prices/limits are data, not code)
  // ────────────────────────────────────────────────────────────────────────────
  await knex.schema.createTable('plans', (t) => {
    t.string('id').primary(); // 'starter' | 'growth' | 'business'
    t.string('name').notNullable();
    t.integer('price_monthly').defaultTo(0);   // in paise (₹499 = 49900)
    t.integer('price_yearly').defaultTo(0);    // in paise
    t.integer('max_workers').defaultTo(2);     // -1 = unlimited
    t.integer('max_products').defaultTo(50);   // -1 = unlimited
    t.integer('max_platforms').defaultTo(1);   // -1 = unlimited
    t.boolean('is_active').defaultTo(true);
    t.text('features');                         // JSON array of feature keys
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex('plans').insert([
    {
      id: 'starter',
      name: 'Starter',
      price_monthly: 49900,
      price_yearly: 399900,
      max_workers: 2,
      max_products: 50,
      max_platforms: 1,
      features: JSON.stringify([
        'basic_reports', 'manual_orders', 'production_tracking',
      ]),
    },
    {
      id: 'growth',
      name: 'Growth',
      price_monthly: 149900,
      price_yearly: 1199900,
      max_workers: 10,
      max_products: 500,
      max_platforms: 3,
      features: JSON.stringify([
        'basic_reports', 'full_reports', 'manual_orders', 'csv_import',
        'production_tracking', 'payout_automation', 'low_stock_alerts',
      ]),
    },
    {
      id: 'business',
      name: 'Business',
      price_monthly: 349900,
      price_yearly: 2799900,
      max_workers: -1,
      max_products: -1,
      max_platforms: -1,
      features: JSON.stringify([
        'basic_reports', 'full_reports', 'manual_orders', 'csv_import',
        'production_tracking', 'payout_automation', 'low_stock_alerts',
        'bulk_import', 'packing_slip', 'excel_export',
      ]),
    },
  ]);

  // ────────────────────────────────────────────────────────────────────────────
  // 2. Tenants table
  // ────────────────────────────────────────────────────────────────────────────
  await knex.schema.createTable('tenants', (t) => {
    t.increments('id').primary();
    t.string('name').notNullable();
    t.string('slug').unique().notNullable();
    t.string('logo_url').nullable();
    t.string('business_category').nullable();
    t.string('plan_id').notNullable().defaultTo('starter');
    t.timestamp('trial_ends_at').nullable();
    // subscription_status: trialing | active | past_due | canceled | locked
    t.string('subscription_status').notNullable().defaultTo('trialing');
    t.string('razorpay_subscription_id').nullable();
    t.string('razorpay_customer_id').nullable();
    t.integer('owner_id').unsigned().nullable();
    t.boolean('onboarding_dismissed').defaultTo(false);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Insert legacy tenant (represents existing Knotique business; gets Business plan, active)
  const oneYearLater = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  await knex('tenants').insert({
    id: 1,
    name: 'Knotique',
    slug: 'knotique',
    plan_id: 'business',
    trial_ends_at: oneYearLater,
    subscription_status: 'active',
    onboarding_dismissed: true, // legacy tenant doesn't need onboarding
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. Recreate `users` to extend role enum → allows 'owner' and 'super_admin'
  //    SQLite doesn't support ALTER COLUMN or DROP CONSTRAINT, so we recreate.
  // ────────────────────────────────────────────────────────────────────────────
  await knex.schema.raw('PRAGMA foreign_keys = OFF');

  await knex.schema.createTable('users_new', (t) => {
    t.increments('id').primary();
    t.integer('tenant_id').unsigned().notNullable().defaultTo(1);
    t.string('name').notNullable();
    t.string('email').unique().notNullable();
    t.string('password_hash').notNullable();
    // Extended role values: owner | admin | worker | super_admin
    t.string('role').notNullable().defaultTo('worker');
    t.string('wage_mode').nullable();
    t.decimal('wage_rate', 10, 2).defaultTo(0);
    t.boolean('is_active').defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Copy all users; map old 'admin' role → 'owner'
  const existingUsers = await knex('users').select('*');
  for (const user of existingUsers) {
    await knex('users_new').insert({
      id:            user.id,
      tenant_id:     1,
      name:          user.name,
      email:         user.email,
      password_hash: user.password_hash,
      role:          user.role === 'admin' ? 'owner' : user.role,
      wage_mode:     user.wage_mode,
      wage_rate:     user.wage_rate || 0,
      is_active:     user.is_active !== undefined ? user.is_active : true,
      created_at:    user.created_at || knex.fn.now(),
    });
  }

  await knex.schema.dropTable('users');
  await knex.schema.renameTable('users_new', 'users');

  // Link legacy tenant to its owner
  const owner = await knex('users').where('role', 'owner').first();
  if (owner) {
    await knex('tenants').where('id', 1).update({ owner_id: owner.id });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 4. Recreate `products` to change SKU unique from global → per-tenant
  // ────────────────────────────────────────────────────────────────────────────
  await knex.schema.createTable('products_new', (t) => {
    t.increments('id').primary();
    t.integer('tenant_id').unsigned().notNullable().defaultTo(1);
    t.string('name').notNullable();
    t.string('sku').notNullable();
    t.string('category').nullable();
    t.text('description').nullable();
    t.string('photo_url').nullable();
    t.integer('standard_time_minutes').defaultTo(0);
    t.decimal('labor_cost_per_unit', 10, 2).defaultTo(0);
    t.integer('bunch_size').defaultTo(1);
    t.boolean('is_active').defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.unique(['tenant_id', 'sku']); // Per-tenant SKU uniqueness (not global)
  });

  await knex.raw(`
    INSERT INTO products_new
      (id, tenant_id, name, sku, category, description, photo_url,
       standard_time_minutes, labor_cost_per_unit, bunch_size,
       is_active, created_at, updated_at)
    SELECT
      id, 1, name, sku, category, description, photo_url,
      standard_time_minutes, labor_cost_per_unit, bunch_size,
      is_active, created_at, updated_at
    FROM products
  `);

  await knex.schema.dropTable('products');
  await knex.schema.renameTable('products_new', 'products');

  // ────────────────────────────────────────────────────────────────────────────
  // 5. Recreate `settings` to change PK from `key` → composite (tenant_id, key)
  // ────────────────────────────────────────────────────────────────────────────
  await knex.schema.createTable('settings_new', (t) => {
    t.integer('tenant_id').unsigned().notNullable();
    t.string('key').notNullable();
    t.text('value').notNullable();
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.primary(['tenant_id', 'key']);
  });

  await knex.raw(`
    INSERT INTO settings_new (tenant_id, key, value, updated_at)
    SELECT 1, key, value, updated_at FROM settings
  `);

  await knex.schema.dropTable('settings');
  await knex.schema.renameTable('settings_new', 'settings');

  // ────────────────────────────────────────────────────────────────────────────
  // 6. Add tenant_id to remaining business-data tables (simple ALTER TABLE)
  // ────────────────────────────────────────────────────────────────────────────
  const simpleTables = [
    'raw_materials',
    'purchase_log',
    'finished_goods_stock',
    'production_entries',
    'orders',
    'payouts',
    'stock_adjustments',
  ];

  for (const table of simpleTables) {
    const hasCol = await knex.schema.hasColumn(table, 'tenant_id');
    if (!hasCol) {
      await knex.schema.alterTable(table, (t) => {
        t.integer('tenant_id').unsigned().defaultTo(1);
      });
    }
    await knex(table).whereNull('tenant_id').update({ tenant_id: 1 });
  }

  await knex.schema.raw('PRAGMA foreign_keys = ON');
};

exports.down = async function (knex) {
  // WARNING: Down migration is destructive. Back up data before rolling back.
  await knex.schema.raw('PRAGMA foreign_keys = OFF');

  const simpleTables = [
    'raw_materials', 'purchase_log', 'finished_goods_stock',
    'production_entries', 'orders', 'payouts', 'stock_adjustments',
  ];
  for (const table of simpleTables) {
    const hasCol = await knex.schema.hasColumn(table, 'tenant_id');
    if (hasCol) {
      await knex.schema.alterTable(table, (t) => t.dropColumn('tenant_id'));
    }
  }

  await knex.schema.dropTableIfExists('settings_new');
  await knex.schema.dropTableIfExists('plans');
  await knex.schema.dropTableIfExists('tenants');

  await knex.schema.raw('PRAGMA foreign_keys = ON');
};
