/**
 * Migration 022 — Attachments, Crocheter Portfolios, User Description, and Work Sessions
 *
 * Incremental, backward-compatible migration for:
 *  1. production_request_attachments: multiple reference photos and documents for production requests.
 *  2. users.description: bio / short introduction for crocheters and users.
 *  3. crocheter_portfolios: portfolio images of completed work.
 *  4. work_sessions: Pomodoro and actual working session tracking linked to requests/orders.
 */

exports.up = async function (knex) {
  // 1. Production Request Attachments table
  const hasAttachments = await knex.schema.hasTable('production_request_attachments');
  if (!hasAttachments) {
    await knex.schema.createTable('production_request_attachments', (t) => {
      t.increments('id').primary();
      t.integer('request_id').unsigned().notNullable();
      t.integer('tenant_id').unsigned().notNullable();
      t.string('file_url').notNullable();
      t.string('file_name').notNullable();
      t.string('file_type').notNullable(); // mime type or extension
      t.integer('file_size').unsigned().notNullable(); // bytes
      t.integer('created_by').unsigned().notNullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());

      t.index(['request_id']);
      t.index(['tenant_id']);
    });
  }

  // 2. Add description column to users table if missing
  const hasDescription = await knex.schema.hasColumn('users', 'description');
  if (!hasDescription) {
    await knex.schema.alterTable('users', (t) => {
      t.text('description').nullable();
    });
  }

  // 3. Crocheter Portfolios table
  const hasPortfolio = await knex.schema.hasTable('crocheter_portfolios');
  if (!hasPortfolio) {
    await knex.schema.createTable('crocheter_portfolios', (t) => {
      t.increments('id').primary();
      t.integer('user_id').unsigned().notNullable();
      t.integer('tenant_id').unsigned().notNullable();
      t.string('image_url').notNullable();
      t.string('title').nullable();
      t.text('caption').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());

      t.index(['user_id']);
      t.index(['tenant_id']);
    });
  }

  // 4. Work Sessions table
  const hasWorkSessions = await knex.schema.hasTable('work_sessions');
  if (!hasWorkSessions) {
    await knex.schema.createTable('work_sessions', (t) => {
      t.increments('id').primary();
      t.integer('tenant_id').unsigned().notNullable();
      t.integer('user_id').unsigned().notNullable();
      t.integer('request_id').unsigned().nullable();
      t.integer('order_id').unsigned().nullable();
      t.string('title').nullable();
      t.text('notes').nullable();
      t.timestamp('start_time').notNullable();
      t.timestamp('end_time').nullable();
      t.integer('duration_seconds').notNullable().defaultTo(0);
      t.string('status').notNullable().defaultTo('active'); // 'active', 'paused', 'completed', 'discarded'
      t.timestamp('last_resumed_at').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());

      t.index(['user_id', 'status']);
      t.index(['tenant_id']);
      t.index(['request_id']);
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('work_sessions');
  await knex.schema.dropTableIfExists('crocheter_portfolios');

  if (knex.client.config.client === 'pg') {
    await knex.schema.alterTable('users', (t) => {
      t.dropColumn('description');
    });
  }

  await knex.schema.dropTableIfExists('production_request_attachments');
};
