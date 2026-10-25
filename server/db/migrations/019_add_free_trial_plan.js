/**
 * Migration 019 — Add 14-Day Free Trial Plan
 *
 * Adds a ₹0 'free_trial' plan to the `plans` table so users can access
 * a 14-day free trial requiring only login.
 */
exports.up = async function (knex) {
  const existing = await knex('plans').where('id', 'free_trial').first();
  if (!existing) {
    await knex('plans').insert({
      id: 'free_trial',
      name: '14-Day Free Trial',
      price_monthly: 0,
      price_yearly: 0,
      max_workers: 2,
      max_products: 50,
      max_platforms: 1,
      is_active: true,
      features: JSON.stringify([
        'basic_reports',
        'manual_orders',
        'production_tracking',
        '14_day_trial',
      ]),
    });
  }
};

exports.down = async function (knex) {
  await knex('plans').where('id', 'free_trial').delete();
};
