const knex = require('./db/database');
const bcrypt = require('bcryptjs');

async function wipeData() {
  console.log('🧹 Wiping all sample data...');

  // Delete all rows in reverse FK order
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

  // Create single fresh admin account
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

  // Re-insert default settings
  await knex('settings').insert([
    { key: 'platform_commissions', value: JSON.stringify({ flipkart: 18, meesho: 12, myntra: 20, etsy: 6.5, amazon: 15 }) },
    { key: 'currency', value: JSON.stringify({ code: 'INR', symbol: '₹' }) },
    { key: 'business_name', value: JSON.stringify('Knotique') },
    { key: 'default_profit_margin_pct', value: JSON.stringify(30) },
    { key: 'labor_cost_per_minute', value: JSON.stringify(1) },
    { key: 'csv_column_maps', value: JSON.stringify({
      flipkart: { external_order_id: 'Order ID', sku: 'SKU', product_name: 'Product Title', quantity: 'Quantity', unit_price: 'Selling Price', order_date: 'Order Date', status: 'Order Status', customer_city: 'City', customer_state: 'State', shipping_deadline: 'Expected Ship Date' },
      meesho: { external_order_id: 'Sub Order No.', sku: 'SKU', product_name: 'Product Name', quantity: 'Quantity', unit_price: 'Customer Price', order_date: 'Order Date', status: 'Status', customer_city: 'City', customer_state: 'State' },
      amazon: { external_order_id: 'order-id', sku: 'sku', product_name: 'product-name', quantity: 'quantity-purchased', unit_price: 'item-price', order_date: 'purchase-date', status: 'order-status', customer_city: 'ship-city', customer_state: 'ship-state', shipping_deadline: 'ship-service-level' },
      etsy: { external_order_id: 'Order ID', sku: 'SKU', product_name: 'Item Name', quantity: 'Quantity', unit_price: 'Order Value', order_date: 'Sale Date', status: 'Shipment', customer_city: 'Ship City', customer_state: 'Ship State' },
      myntra: { external_order_id: 'Myntra Order No', sku: 'SKU', product_name: 'Product', quantity: 'Quantity', unit_price: 'Selling Price', order_date: 'Order Date', status: 'Current Status', customer_city: 'City', customer_state: 'State' },
    }) },
  ]);

  console.log('✅ Database wiped clean!');
  console.log('   Admin Account: admin@knotique.com / admin123');
  console.log('   Zero products, zero materials, zero orders, zero workers.');
  process.exit(0);
}

wipeData().catch(err => {
  console.error(err);
  process.exit(1);
});
