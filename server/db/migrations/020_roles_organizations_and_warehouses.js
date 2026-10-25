/**
 * Migration 020 — Roles, Organizations, Hierarchy, Warehouses, and Audit Logs
 *
 * Incremental, backward-compatible migration that introduces:
 *  1. User status ('active', 'pending', 'suspended', 'rejected') and token_version for session revocation.
 *  2. Tenant type ('business', 'vendor', 'subvendor'), tenant status, and optional parent_tenant_id.
 *  3. organization_relationships for hierarchical Vendor -> Subvendor -> Worker management.
 *  4. supplier_relationships for Admin Business <-> Vendor commercial connections.
 *  5. invitations table for secure, auditable role and organization onboarding.
 *  6. warehouses table for physical locations, inventory association, and future map integration.
 *  7. audit_logs table for security and compliance tracking.
 */

exports.up = async function (knex) {
  // 1. Users table updates
  const hasStatus = await knex.schema.hasColumn('users', 'status');
  if (!hasStatus) {
    await knex.schema.alterTable('users', (t) => {
      t.string('status').notNullable().defaultTo('active');
    });
  }

  const hasTokenVersion = await knex.schema.hasColumn('users', 'token_version');
  if (!hasTokenVersion) {
    await knex.schema.alterTable('users', (t) => {
      t.integer('token_version').notNullable().defaultTo(1);
    });
  }

  const hasPhone = await knex.schema.hasColumn('users', 'phone');
  if (!hasPhone) {
    await knex.schema.alterTable('users', (t) => {
      t.string('phone').nullable();
      t.text('notes').nullable();
    });
  }

  // Sync existing is_active flag to status column
  await knex('users')
    .where('is_active', false)
    .update({ status: 'suspended' });

  // 2. Tenants table updates
  const hasTenantType = await knex.schema.hasColumn('tenants', 'tenant_type');
  if (!hasTenantType) {
    await knex.schema.alterTable('tenants', (t) => {
      t.string('tenant_type').notNullable().defaultTo('business');
      t.string('status').notNullable().defaultTo('active');
      t.integer('parent_tenant_id').unsigned().nullable();
    });
  }

  // 3. Organization relationships table (Vendor -> Subvendor -> Worker hierarchy)
  const hasOrgRel = await knex.schema.hasTable('organization_relationships');
  if (!hasOrgRel) {
    await knex.schema.createTable('organization_relationships', (t) => {
      t.increments('id').primary();
      t.integer('parent_tenant_id').unsigned().notNullable();
      t.integer('child_tenant_id').unsigned().notNullable();
      t.string('relationship_type').notNullable().defaultTo('vendor_subvendor');
      t.string('status').notNullable().defaultTo('active'); // 'pending', 'active', 'suspended', 'terminated'
      t.integer('created_by').unsigned().nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());

      t.index(['parent_tenant_id']);
      t.index(['child_tenant_id']);
      t.index(['status']);
    });
  }

  // 4. Invitations table
  const hasInvitations = await knex.schema.hasTable('invitations');
  if (!hasInvitations) {
    await knex.schema.createTable('invitations', (t) => {
      t.increments('id').primary();
      t.integer('tenant_id').unsigned().notNullable();
      t.string('email').notNullable();
      t.string('role').notNullable(); // 'admin' | 'vendor' | 'subvendor' | 'worker'
      t.integer('invited_by').unsigned().notNullable();
      t.string('token_hash').notNullable().unique();
      t.string('status').notNullable().defaultTo('pending'); // 'pending' | 'accepted' | 'expired' | 'revoked'
      t.timestamp('expires_at').notNullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());

      t.index(['tenant_id']);
      t.index(['email']);
      t.index(['token_hash']);
      t.index(['status']);
    });
  }

  // 5. Supplier relationships table (Admin Business <-> Vendor Supplier)
  const hasSupplierRel = await knex.schema.hasTable('supplier_relationships');
  if (!hasSupplierRel) {
    await knex.schema.createTable('supplier_relationships', (t) => {
      t.increments('id').primary();
      t.integer('admin_tenant_id').unsigned().notNullable();
      t.integer('vendor_tenant_id').unsigned().notNullable();
      t.string('category').nullable();
      t.string('status').notNullable().defaultTo('active'); // 'pending' | 'active' | 'suspended' | 'rejected'
      t.text('notes').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());

      t.index(['admin_tenant_id']);
      t.index(['vendor_tenant_id']);
      t.index(['status']);
    });
  }

  // 6. Warehouses table (structured physical locations)
  const hasWarehouses = await knex.schema.hasTable('warehouses');
  if (!hasWarehouses) {
    await knex.schema.createTable('warehouses', (t) => {
      t.increments('id').primary();
      t.integer('tenant_id').unsigned().notNullable();
      t.string('name').notNullable();
      t.string('code').nullable();
      t.string('address_line1').nullable();
      t.string('address_line2').nullable();
      t.string('city').nullable();
      t.string('state').nullable();
      t.string('postal_code').nullable();
      t.string('country').defaultTo('India');
      t.decimal('latitude', 10, 7).nullable();
      t.decimal('longitude', 10, 7).nullable();
      t.boolean('is_active').defaultTo(true);
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());

      t.index(['tenant_id']);
      t.index(['is_active']);
    });
  }

  // 7. Audit logs table
  const hasAuditLogs = await knex.schema.hasTable('audit_logs');
  if (!hasAuditLogs) {
    await knex.schema.createTable('audit_logs', (t) => {
      t.increments('id').primary();
      t.integer('tenant_id').unsigned().nullable();
      t.integer('user_id').unsigned().nullable();
      t.string('action').notNullable();
      t.string('target_type').nullable();
      t.string('target_id').nullable();
      t.string('ip_address').nullable();
      t.text('details').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());

      t.index(['tenant_id']);
      t.index(['user_id']);
      t.index(['action']);
      t.index(['created_at']);
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('audit_logs');
  await knex.schema.dropTableIfExists('warehouses');
  await knex.schema.dropTableIfExists('supplier_relationships');
  await knex.schema.dropTableIfExists('invitations');
  await knex.schema.dropTableIfExists('organization_relationships');

  // SQLite does not support dropColumn easily without table recreation in older knex versions,
  // but if postgres is used, drop columns:
  if (knex.client.config.client === 'pg') {
    await knex.schema.alterTable('tenants', (t) => {
      t.dropColumn('parent_tenant_id');
      t.dropColumn('status');
      t.dropColumn('tenant_type');
    });
    await knex.schema.alterTable('users', (t) => {
      t.dropColumn('notes');
      t.dropColumn('phone');
      t.dropColumn('token_version');
      t.dropColumn('status');
    });
  }
};
