const bcrypt = require('bcryptjs');

/**
 * Seed file: Clears all sample data and initializes a clean slate with only the admin user & default settings.
 */
exports.seed = async function (knex) {
  await knex('payouts').del();
  await knex('stock_adjustments').del();
  await knex('orders').del();
  await knex('production_entries').del();
  await knex('finished_goods_stock').del();
  await knex('product_bom').del();
  await knex('product_platforms').del();
  await knex('products').del();
  await knex('purchase_log').del();
  await knex('raw_materials').del();
  await knex('users').del();
  await knex('settings').del();

  // Admin account
  const adminHash = await bcrypt.hash('admin123', 10);
  await knex('users').insert({
    name: 'Admin (Owner)',
    email: 'admin@knotique.com',
    password_hash: adminHash,
    role: 'admin',
    wage_mode: null,
    wage_rate: 0,
    is_active: true,
  });

  // Default settings
  await knex('settings').insert([
    { key: 'platform_commissions', value: JSON.stringify({ flipkart: 18, meesho: 12, myntra: 20, etsy: 6.5, amazon: 15 }) },
    { key: 'currency', value: JSON.stringify({ code: 'INR', symbol: '₹' }) },
    { key: 'business_name', value: JSON.stringify('Knotique') },
    { key: 'default_profit_margin_pct', value: JSON.stringify(30) },
    { key: 'labor_cost_per_minute', value: JSON.stringify(1) },
  ]);

  console.log('✅ Database initialized to clean state!');
  console.log('   Admin login: admin@knotique.com / admin123');
};
