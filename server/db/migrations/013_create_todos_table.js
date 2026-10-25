/**
 * Migration 013 — Create todos table for tenant admin task management
 */
exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('todos');
  if (!hasTable) {
    await knex.schema.createTable('todos', (t) => {
      t.increments('id').primary();
      t.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.integer('user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
      t.string('title').notNullable();
      t.text('description').nullable();
      t.enu('status', ['pending', 'in_progress', 'completed']).defaultTo('pending');
      t.enu('priority', ['low', 'medium', 'high']).defaultTo('medium');
      t.date('due_date').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());

      t.index(['tenant_id']);
      t.index(['tenant_id', 'status']);
    });
  }
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable('todos');
  if (hasTable) {
    await knex.schema.dropTable('todos');
  }
};
