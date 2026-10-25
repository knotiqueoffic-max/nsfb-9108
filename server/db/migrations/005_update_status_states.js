/**
 * Migration: add status column to production_entries, and update payouts status.
 */
exports.up = async function (knex) {
  // Add status column to production_entries
  const hasStatusCol = await knex.schema.hasColumn('production_entries', 'status');
  if (!hasStatusCol) {
    await knex.schema.alterTable('production_entries', (t) => {
      t.string('status').defaultTo('ordered');
    });
  }

  // Migrate is_paid data to status
  await knex('production_entries').where('is_paid', true).update({ status: 'paid' });
  await knex('production_entries').where(function() {
    this.where('is_paid', false).orWhereNull('is_paid');
  }).update({ status: 'ordered' });

  // Migrate payouts status ('pending' -> 'ordered')
  await knex('payouts').where('status', 'pending').update({ status: 'ordered' });
};

exports.down = async function (knex) {
  // Revert is_paid data from status
  await knex('production_entries').where('status', 'paid').update({ is_paid: true });
  await knex('production_entries').whereIn('status', ['ordered', 'received']).update({ is_paid: false });

  // Revert payouts status ('ordered', 'received' -> 'pending')
  await knex('payouts').whereIn('status', ['ordered', 'received']).update({ status: 'pending' });

  // Drop status column
  await knex.schema.alterTable('production_entries', (t) => {
    t.dropColumn('status');
  });
};
