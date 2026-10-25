const assert = require('assert');
const { parseOrderFile, matchOrdersToProducts, stripLeadingApostrophe, safeDate } = require('./services/csv.service');
const db = require('./db/database');
const path = require('path');
const fs = require('fs');

console.log('🧪 Testing Flipkart 12-Row CSV Import & Database Commit...\n');

// 1. Test Leading Apostrophe Stripping
console.log('1️⃣ Testing stripLeadingApostrophe:');
assert.strictEqual(stripLeadingApostrophe("'OD123456789"), "OD123456789");
assert.strictEqual(stripLeadingApostrophe("'ITEM-9988"), "ITEM-9988");
assert.strictEqual(stripLeadingApostrophe("'400001"), "400001");
console.log('   ✅ Apostrophe stripping passed!');

// 2. Generate 12-Row Sample Flipkart CSV
console.log('\n2️⃣ Generating 12-Row Sample Flipkart CSV Export...');
const sampleRows = [
  'Ordered On,Shipment ID,ORDER ITEM ID,Order Id,HSN CODE,Order State,Order Type,FSN,SKU,Product,Invoice No.,CGST,IGST,SGST,Invoice Date (mm/dd/yy),Invoice Amount,Selling Price Per Item,Shipping and Handling Charges,Quantity,Price inc. FKMP Contribution & Subsidy,Buyer name,Ship to name,Address Line 1,Address Line 2,City,State,PIN Code,Dispatch After date,Dispatch by date,Form requirement,Tracking ID,Package Length (cm),Package Breadth (cm),Package Height (cm),Package Weight (kg),Ready to Make,With Attachment'
];

for (let i = 1; i <= 12; i++) {
  const sku = `FK-PROD-${String(i).padStart(2, '0')}`;
  const orderId = `'OD99887710${i}`;
  const itemId = `'ITEM900${i}`;
  const shipId = `'SHIP100${i}`;
  const trackId = `'TRACK440${i}`;
  const price = 500 + i * 50;
  const listingPrice = price + 200;
  sampleRows.push(`"Aug 04, 2026",${shipId},${itemId},${orderId},5612,Approved,PRE,${sku},${sku},Handmade Product ${i},INV${i},0,0,0,08/04/26,${listingPrice},"₹${price}.00",0,1,"₹${listingPrice}.00",Customer ${i},Customer ${i},Street ${i},Locality ${i},City ${i},State ${i},'40000${i},"Aug 05, 2026","Aug 06, 2026",NO,${trackId},20,20,10,0.5,YES,NO`);
}

const csvContent = sampleRows.join('\n');
const tempFilePath = path.join(__dirname, '../uploads/test_flipkart_12rows.csv');
fs.writeFileSync(tempFilePath, csvContent);

(async () => {
  try {
    const TEST_TENANT_ID = 9999;

    // Clean up test data if exists
    await db('orders').where('tenant_id', TEST_TENANT_ID).del();
    await db('products').where('tenant_id', TEST_TENANT_ID).del();

    // 3. Insert 12 matching products into test catalog
    console.log('\n3️⃣ Seeding 12 matching products into database catalog...');
    const productInserts = [];
    for (let i = 1; i <= 12; i++) {
      productInserts.push({
        tenant_id: TEST_TENANT_ID,
        name: `Handmade Product ${i}`,
        sku: `FK-PROD-${String(i).padStart(2, '0')}`,
        is_active: true,
      });
    }
    await db('products').insert(productInserts);
    console.log('   ✅ 12 test products seeded.');

    // 4. Parse file & match to products
    console.log('\n4️⃣ Parsing CSV and matching against database products...');
    const parsed = await parseOrderFile(tempFilePath, 'flipkart');
    assert.strictEqual(parsed.rows.length, 12, '12 rows parsed successfully');

    const matched = await matchOrdersToProducts(parsed.rows, TEST_TENANT_ID);

    const matchedCount = matched.filter(m => m.product_id).length;
    const unmatchedCount = matched.filter(m => m.unmatched_sku).length;
    console.log(`   Matched: ${matchedCount} / 12, Unmatched: ${unmatchedCount} / 12`);
    assert.strictEqual(matchedCount, 12, 'All 12 rows matched successfully');
    assert.strictEqual(unmatchedCount, 0, '0 unmatched SKUs');

    // 5. Commit all 12 rows to database `orders` table via Knex insert
    console.log('\n5️⃣ Committing 12 imported rows to database orders table...');
    let insertedCount = 0;
    for (const orderRow of matched) {
      await db('orders').insert({
        ...orderRow,
        tenant_id: TEST_TENANT_ID,
        stock_flagged: false,
      });
      insertedCount++;
    }

    console.log(`   ✅ Successfully committed ${insertedCount} rows to orders table with NO SQL ERRORS!`);
    assert.strictEqual(insertedCount, 12, 'All 12 orders committed to DB');

    // 6. Verify inserted DB records
    const dbOrders = await db('orders').where('tenant_id', TEST_TENANT_ID);
    assert.strictEqual(dbOrders.length, 12, '12 orders retrieved from database');

    const firstOrder = dbOrders[0];
    console.log('   Sample DB record:', {
      id: firstOrder.id,
      external_order_id: firstOrder.external_order_id,
      order_item_id: firstOrder.order_item_id,
      shipment_id: firstOrder.shipment_id,
      sku: firstOrder.sku,
      unit_price: firstOrder.unit_price,
      listing_price: firstOrder.listing_price,
      unmatched_sku: Boolean(firstOrder.unmatched_sku),
      tracking_id: firstOrder.tracking_id,
      customer_pincode: firstOrder.customer_pincode,
    });

    assert.strictEqual(firstOrder.external_order_id, 'OD998877101');
    assert.strictEqual(firstOrder.order_item_id, 'ITEM9001');
    assert.strictEqual(firstOrder.shipment_id, 'SHIP1001');
    assert.strictEqual(firstOrder.tracking_id, 'TRACK4401');
    assert.strictEqual(firstOrder.customer_pincode, '400001');
    assert.strictEqual(Boolean(firstOrder.unmatched_sku), false);

    // Clean up test data
    await db('orders').where('tenant_id', TEST_TENANT_ID).del();
    await db('products').where('tenant_id', TEST_TENANT_ID).del();
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    console.log('\n🎉 ALL 12 ROWS COMMITTED SUCCESSFULLY WITH 0 UNMATCHED SKUS AND 0 SQL ERRORS!\n');
    process.exit(0);
  } catch (err) {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    console.error('\n❌ Test failed with error:', err);
    process.exit(1);
  }
})();
