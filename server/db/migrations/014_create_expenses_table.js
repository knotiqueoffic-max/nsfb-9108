/**
 * Migration 014 — Create expenses table for admin expense tracking
 */
exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('expenses');
  if (!hasTable) {
    await knex.schema.createTable('expenses', (t) => {
      t.increments('id').primary();
      t.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.integer('user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
      t.decimal('amount', 12, 2).notNullable();
      t.enu('category', [
        'office', 'shipping', 'equipment', 'travel',
        'salaries', 'marketing', 'other',
      ]).notNullable().defaultTo('other');
      t.date('expense_date').notNullable();
      t.enu('payment_method', [
        'cash', 'upi', 'bank_transfer', 'card', 'cheque',
      ]).notNullable().defaultTo('cash');
      t.string('vendor').nullable();
      t.string('receipt_ref').nullable();
      t.text('notes').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());

      t.index(['tenant_id']);
      t.index(['tenant_id', 'expense_date']);
      t.index(['tenant_id', 'category']);
    });
  }
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable('expenses');
  if (hasTable) {
    await knex.schema.dropTable('expenses');
  }
};
