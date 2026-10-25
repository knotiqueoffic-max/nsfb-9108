
/**
 * Migration 011 — Add Flipkart import reference & shipping fields to orders
 */
exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('orders', 'order_item_id');
  if (!hasColumn) {
    await knex.schema.alterTable('orders', (t) => {
      t.string('order_item_id').nullable();
      t.string('shipment_id').nullable();
      t.string('tracking_id').nullable();
      t.string('customer_name').nullable();
      t.text('customer_address').nullable();
      t.string('customer_pincode').nullable();
    });
  }
};

exports.down = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('orders', 'order_item_id');
  if (hasColumn) {
    await knex.schema.alterTable('orders', (t) => {
      t.dropColumn('order_item_id');
      t.dropColumn('shipment_id');
      t.dropColumn('tracking_id');
      t.dropColumn('customer_name');
      t.dropColumn('customer_address');
      t.dropColumn('customer_pincode');
    });
  }
};
