/**
 * Migration 022 — Production Work Submissions, Approval Requests, and Media Tracking
 *
 * Enables awarded Crocheters (workers) to upload work-in-progress and completed proof of work
 * (photos and videos) an unlimited number of times for any awarded & accepted production request.
 * Every upload submission creates a Production Approval Request for the issuing Admin/manager
 * to review, approve, or request changes on.
 */

exports.up = async function (knex) {
  // 1. Production Submissions (Approval Requests)
  const hasSubmissions = await knex.schema.hasTable('production_submissions');
  if (!hasSubmissions) {
    await knex.schema.createTable('production_submissions', (t) => {
      t.increments('id').primary();
      t.integer('production_request_id').unsigned().notNullable();
      t.integer('worker_id').unsigned().notNullable(); // Authenticated worker/crocheter
      t.integer('tenant_id').unsigned().notNullable(); // Tenant isolation (matches production_requests.tenant_id)
      t.text('notes').nullable(); // Worker's comments or updates
      t.integer('quantity_completed').nullable().defaultTo(0);
      t.string('status').notNullable().defaultTo('pending_approval');
      // Statuses: 'pending_approval', 'approved', 'rejected'
      t.text('reviewer_notes').nullable(); // Admin feedback notes
      t.integer('reviewed_by').unsigned().nullable(); // Reviewer user ID
      t.timestamp('reviewed_at').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());

      t.index(['production_request_id']);
      t.index(['worker_id']);
      t.index(['tenant_id']);
      t.index(['status']);
    });
  }

  // 2. Production Submission Media (multi-photo and video attachments per submission)
  const hasMedia = await knex.schema.hasTable('production_submission_media');
  if (!hasMedia) {
    await knex.schema.createTable('production_submission_media', (t) => {
      t.increments('id').primary();
      t.integer('submission_id').unsigned().notNullable();
      t.string('file_url').notNullable();
      t.string('file_type').notNullable(); // 'image' | 'video'
      t.string('mime_type').notNullable();
      t.string('original_name').notNullable();
      t.integer('file_size').unsigned().notNullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());

      t.index(['submission_id']);
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('production_submission_media');
  await knex.schema.dropTableIfExists('production_submissions');
};
