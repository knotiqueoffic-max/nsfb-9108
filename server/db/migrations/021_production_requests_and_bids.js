/**
 * Migration 021 — Production Requests, Recipients, Bids, and Progress Tracking
 *
 * Provides a secure, private, hierarchical production-request and bidding workflow
 * across Admins, Vendors, Subvendors, and Crocheters.
 *
 * Incremental, backward-compatible migration:
 *  1. production_requests: issuing request details, target scope, deadlines, and lifecycle status.
 *  2. production_request_recipients: explicit targeted recipients when scope_type = 'specific'.
 *  3. production_bids: private bids submitted by eligible recipients.
 *  4. production_progress_logs: progress tracking, review submissions, and supervisor feedback.
 */

exports.up = async function (knex) {
  // 1. Production Requests table
  const hasRequests = await knex.schema.hasTable('production_requests');
  if (!hasRequests) {
    await knex.schema.createTable('production_requests', (t) => {
      t.increments('id').primary();
      t.integer('tenant_id').unsigned().notNullable(); // Issuing tenant
      t.string('request_code').unique().notNullable(); // e.g. PR-2026-0001
      t.integer('created_by').unsigned().notNullable(); // User ID of creator
      t.string('target_role').notNullable(); // 'vendor' | 'subvendor' | 'worker' (crocheter)
      t.string('scope_type').notNullable().defaultTo('all_eligible'); // 'specific' | 'all_eligible'
      t.integer('product_id').unsigned().nullable(); // Optional linked product
      t.string('title').notNullable();
      t.text('description').nullable();
      t.text('specifications').nullable();
      t.string('reference_image_url').nullable();
      t.integer('quantity').notNullable().defaultTo(1);
      t.string('unit').notNullable().defaultTo('pieces');
      t.text('required_materials').nullable();
      t.decimal('target_price', 10, 2).nullable();
      t.timestamp('submission_deadline').notNullable();
      t.timestamp('completion_deadline').notNullable();
      t.string('status').notNullable().defaultTo('open');
      // Statuses: 'draft', 'open', 'awarded', 'accepted', 'in_progress', 'submitted_for_review', 'approved', 'completed', 'declined', 'cancelled', 'expired'
      t.integer('awarded_bid_id').unsigned().nullable();
      t.string('awarded_to_type').nullable(); // 'tenant' | 'user'
      t.integer('awarded_to_id').unsigned().nullable(); // tenant_id or user_id
      t.timestamp('awarded_at').nullable();
      t.timestamp('accepted_at').nullable();
      t.timestamp('completed_at').nullable();
      t.text('notes').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());

      t.index(['tenant_id']);
      t.index(['created_by']);
      t.index(['target_role']);
      t.index(['status']);
      t.index(['submission_deadline']);
    });
  }

  // 2. Production Request Recipients table (for specific recipients targeting)
  const hasRecipients = await knex.schema.hasTable('production_request_recipients');
  if (!hasRecipients) {
    await knex.schema.createTable('production_request_recipients', (t) => {
      t.increments('id').primary();
      t.integer('request_id').unsigned().notNullable();
      t.string('recipient_type').notNullable(); // 'tenant' | 'user'
      t.integer('recipient_id').unsigned().notNullable(); // tenant_id or user_id
      t.timestamp('created_at').defaultTo(knex.fn.now());

      t.index(['request_id']);
      t.index(['recipient_type', 'recipient_id']);
    });
  }

  // 3. Production Bids table (private bidding)
  const hasBids = await knex.schema.hasTable('production_bids');
  if (!hasBids) {
    await knex.schema.createTable('production_bids', (t) => {
      t.increments('id').primary();
      t.integer('request_id').unsigned().notNullable();
      t.string('bidder_type').notNullable(); // 'tenant' | 'user'
      t.integer('bidder_id').unsigned().notNullable(); // tenant_id for vendor/subvendor, user_id for worker
      t.integer('bidder_user_id').unsigned().notNullable(); // Submitting user ID
      t.decimal('proposed_price', 10, 2).notNullable();
      t.integer('quantity').notNullable();
      t.date('estimated_completion_date').notNullable();
      t.text('notes').nullable();
      t.string('status').notNullable().defaultTo('submitted');
      // Statuses: 'submitted', 'revised', 'withdrawn', 'awarded', 'accepted', 'declined', 'not_selected'
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());

      t.index(['request_id']);
      t.index(['bidder_type', 'bidder_id']);
      t.index(['bidder_user_id']);
      t.index(['status']);
    });
  }

  // 4. Production Progress Logs table (progress tracking, review submissions, supervisor feedback)
  const hasProgress = await knex.schema.hasTable('production_progress_logs');
  if (!hasProgress) {
    await knex.schema.createTable('production_progress_logs', (t) => {
      t.increments('id').primary();
      t.integer('request_id').unsigned().notNullable();
      t.integer('logged_by').unsigned().notNullable(); // User ID
      t.integer('quantity_completed').notNullable().defaultTo(0);
      t.text('notes').nullable();
      t.string('status').notNullable().defaultTo('progress');
      // Statuses: 'progress', 'submitted_for_review', 'correction_requested', 'approved'
      t.text('feedback').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());

      t.index(['request_id']);
      t.index(['logged_by']);
      t.index(['status']);
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('production_progress_logs');
  await knex.schema.dropTableIfExists('production_bids');
  await knex.schema.dropTableIfExists('production_request_recipients');
  await knex.schema.dropTableIfExists('production_requests');
};
