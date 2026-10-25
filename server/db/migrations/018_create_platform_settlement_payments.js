/**
 * Migration 018 — Create platform_settlement_payments table
 *
 * Flipkart (and other platforms) do NOT pay per order. They send lump-sum
 * settlement payments (weekly / fortnightly / monthly). This table records
 * those actual payments received from each platform.
 *
 * Total Received = SUM of amounts in this table (per platform)
 * Net Pending    = Total Expected (sum of selling prices) − Total Received
 *
 * The per-order payment_status columns added in 015 remain in the DB
 * but are no longer used for settlement tracking — this table replaces them.
 */
exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('platform_settlement_payments');
  if (!hasTable) {
    await knex.schema.createTable('platform_settlement_payments', (t) => {
      t.increments('id').primary();
      t.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.string('platform').notNullable(); // 'flipkart' | 'meesho' | 'myntra' | 'etsy' | 'amazon' | 'manual'
      t.decimal('amount', 12, 2).notNullable();   // actual lump-sum received
      t.date('settlement_date').notNullable();     // date payment hit your account
      t.string('reference_no').nullable();         // Flipkart settlement ID / UTR / NEFT ref
      t.text('notes').nullable();                  // e.g. "Week of Aug 1-7, deducted ₹200 returns"
      t.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());

      t.index(['tenant_id']);
      t.index(['tenant_id', 'platform']);
      t.index(['tenant_id', 'settlement_date']);
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('platform_settlement_payments');
};
