/**
 * Migration 007 — Billing Tables (Invoices/Payments)
 *
 * Adds an `invoices` table to track payments/subscription history.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('invoices', (t) => {
    t.increments('id').primary();
    t.integer('tenant_id').unsigned().notNullable();
    t.string('invoice_number').unique().notNullable(); // e.g. INV-2026-0001
    t.integer('amount').notNullable();                  // in paise (e.g. 149900 = ₹1,499)
    t.string('currency').notNullable().defaultTo('INR');
    t.string('status').notNullable().defaultTo('unpaid'); // unpaid | paid | void
    t.string('razorpay_payment_id').nullable();
    t.string('razorpay_signature').nullable();
    t.timestamp('billing_date').defaultTo(knex.fn.now());
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('invoices');
};
