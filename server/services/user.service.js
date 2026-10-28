const db = require('../db/database');

/**
 * Safely deletes a user and cleanly nullifies or removes foreign-key references
 * across SQLite and PostgreSQL to prevent constraint violations while preserving
 * financial and order audit trails.
 *
 * @param {number|string} userId
 * @param {import('knex').Knex} [trxInstance]
 */
async function deleteUserSafely(userId, trxInstance) {
  const runInTrx = async (trx) => {
    const user = await trx('users').where('id', userId).first();
    if (!user) return false;

    // 1. Crocheter portfolios & work sessions
    if (await trx.schema.hasTable('crocheter_portfolios')) {
      await trx('crocheter_portfolios').where('user_id', userId).del();
    }
    if (await trx.schema.hasTable('work_sessions')) {
      await trx('work_sessions').where('user_id', userId).del();
    }

    // 2. Production submissions & attached media
    if (await trx.schema.hasTable('production_submissions')) {
      const userSubmissions = await trx('production_submissions')
        .where('worker_id', userId)
        .select('id');
      const subIds = userSubmissions.map((s) => s.id);
      if (subIds.length > 0 && (await trx.schema.hasTable('production_submission_media'))) {
        await trx('production_submission_media').whereIn('submission_id', subIds).del();
      }
      await trx('production_submissions').where('worker_id', userId).del();
      await trx('production_submissions').where('reviewed_by', userId).update({ reviewed_by: null });
    }

    // 3. Production bids
    if (await trx.schema.hasTable('production_bids')) {
      await trx('production_bids')
        .where('bidder_user_id', userId)
        .orWhere(function () {
          this.where('bidder_type', 'user').andWhere('bidder_id', userId);
        })
        .del();
    }

    // 4. Production request recipients
    if (await trx.schema.hasTable('production_request_recipients')) {
      await trx('production_request_recipients')
        .where('recipient_type', 'user')
        .where(function () {
          this.where('recipient_id', userId).orWhere('recipient_id', String(userId));
        })
        .del();
    }

    // 5. Production progress logs
    if (await trx.schema.hasTable('production_progress_logs')) {
      await trx('production_progress_logs').where('logged_by', userId).del();
    }

    // 6. Production requests awarded to this user
    if (await trx.schema.hasTable('production_requests')) {
      await trx('production_requests')
        .where('awarded_to_type', 'user')
        .where(function () {
          this.where('awarded_to_id', userId).orWhere('awarded_to_id', String(userId));
        })
        .update({
          awarded_to_id: null,
          awarded_to_type: null,
          awarded_bid_id: null,
          status: 'open',
        });
    }

    // 7. Todos & Expenses
    if (await trx.schema.hasTable('todos')) {
      await trx('todos').where('user_id', userId).del();
    }
    if (await trx.schema.hasTable('expenses')) {
      await trx('expenses').where('user_id', userId).update({ user_id: null });
    }

    // 8. Financial, production and order records: nullify user reference to preserve history
    if (await trx.schema.hasTable('orders')) {
      await trx('orders').where('worker_id', userId).update({ worker_id: null });
    }
    if (await trx.schema.hasTable('production_entries')) {
      await trx('production_entries').where('worker_id', userId).update({ worker_id: null });
    }
    if (await trx.schema.hasTable('payouts')) {
      await trx('payouts').where('worker_id', userId).update({ worker_id: null });
    }
    if (await trx.schema.hasTable('stock_adjustments')) {
      await trx('stock_adjustments').where('adjusted_by', userId).update({ adjusted_by: null });
    }
    if (await trx.schema.hasTable('platform_settlement_payments')) {
      await trx('platform_settlement_payments').where('created_by', userId).update({ created_by: null });
    }

    // 9. Invitations
    if (await trx.schema.hasTable('invitations')) {
      await trx('invitations').where('invited_by', userId).orWhere('email', user.email).del();
    }

    // 10. Audit logs (nullify user_id to preserve audit security trail)
    if (await trx.schema.hasTable('audit_logs')) {
      await trx('audit_logs').where('user_id', userId).update({ user_id: null });
    }

    // 11. Workers table (if separate table exists)
    if (await trx.schema.hasTable('workers')) {
      await trx('workers')
        .where('user_id', userId)
        .orWhere('id', userId)
        .orWhere('email', user.email)
        .del();
    }

    // 12. Tenant ownership (nullify if sole owner was this user)
    if (await trx.schema.hasTable('tenants')) {
      await trx('tenants').where('owner_id', userId).update({ owner_id: null });
    }

    // 13. Delete from users table
    await trx('users').where('id', userId).del();
    return true;
  };

  if (trxInstance) {
    return runInTrx(trxInstance);
  }
  return db.transaction(runInTrx);
}

module.exports = {
  deleteUserSafely,
};
