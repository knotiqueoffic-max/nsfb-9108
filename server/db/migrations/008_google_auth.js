/**
 * Migration 008 — Google Auth Fields
 *
 * Recreates the `users` table to:
 *  • Make `password_hash` nullable (so Google users don't require password).
 *  • Add `google_id` (unique profile ID from Google).
 *  • Add `google_profile_photo` (profile image URL from Google).
 *  • Add `auth_methods` (tracks sign-in methods: email_password, google, or both).
 *
 * Safe for SQLite by renaming the old table first, creating the new table directly,
 * copying data, and dropping the old table.
 */
exports.up = async function (knex) {
  await knex.schema.raw('PRAGMA foreign_keys = OFF');

  // 1. Rename existing users table
  await knex.schema.renameTable('users', 'users_old');

  // 2. Create new users table with nullable password_hash and new columns
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.integer('tenant_id').unsigned().notNullable().defaultTo(1);
    t.string('name').notNullable();
    t.string('email').unique().notNullable(); // Creates index on the new table
    t.string('password_hash').nullable();    // CHANGED: Now nullable
    t.string('role').notNullable().defaultTo('worker');
    t.string('wage_mode').nullable();
    t.decimal('wage_rate', 10, 2).defaultTo(0);
    t.boolean('is_active').defaultTo(true);
    t.string('google_id').nullable(); // NEW
    t.string('google_profile_photo').nullable(); // NEW
    t.string('auth_methods').notNullable().defaultTo('email_password'); // NEW
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 3. Copy existing users into new table
  const existingUsers = await knex('users_old').select('*');
  for (const user of existingUsers) {
    await knex('users').insert({
      id:            user.id,
      tenant_id:     user.tenant_id || 1,
      name:          user.name,
      email:         user.email,
      password_hash: user.password_hash,
      role:          user.role || 'worker',
      wage_mode:     user.wage_mode || null,
      wage_rate:     user.wage_rate || 0,
      is_active:     user.is_active !== undefined ? user.is_active : true,
      google_id:     null,
      google_profile_photo: null,
      auth_methods:  'email_password',
      created_at:    user.created_at || knex.fn.now(),
    });
  }

  // 4. Drop the old table
  await knex.schema.dropTable('users_old');
  await knex.schema.raw('PRAGMA foreign_keys = ON');
};

exports.down = async function (knex) {
  await knex.schema.raw('PRAGMA foreign_keys = OFF');
  await knex.schema.renameTable('users', 'users_google');

  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.integer('tenant_id').unsigned().notNullable().defaultTo(1);
    t.string('name').notNullable();
    t.string('email').unique().notNullable();
    t.string('password_hash').notNullable(); // Back to notNullable
    t.string('role').notNullable().defaultTo('worker');
    t.string('wage_mode').nullable();
    t.decimal('wage_rate', 10, 2).defaultTo(0);
    t.boolean('is_active').defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  const existingUsers = await knex('users_google').select('*');
  for (const user of existingUsers) {
    const dummyHash = user.password_hash || '$2a$10$dummyhashplaceholder';
    await knex('users').insert({
      id:            user.id,
      tenant_id:     user.tenant_id,
      name:          user.name,
      email:         user.email,
      password_hash: dummyHash,
      role:          user.role,
      wage_mode:     user.wage_mode,
      wage_rate:     user.wage_rate,
      is_active:     user.is_active,
      created_at:    user.created_at,
    });
  }

  await knex.schema.dropTable('users_google');
  await knex.schema.raw('PRAGMA foreign_keys = ON');
};
