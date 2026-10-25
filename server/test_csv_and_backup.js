const assert = require('assert');
const { safeDate, safeNumber, cleanHeader, normalizeRow } = require('./services/csv.service');
const { performBackup, listBackups, deleteBackup } = require('./services/backup.service');

console.log('🧪 Testing CSV Parsing & Daily Backup System...\n');

// 1. Test Date Parsing
console.log('1️⃣ Testing safeDate with diverse date formats:');
const dateTests = [
  { input: '08/08/2026', expected: '2026-08-08' },
  { input: '2026-08-08', expected: '2026-08-08' },
  { input: '08-Aug-2026', expected: '2026-08-08' },
  { input: '8 August 2026', expected: '2026-08-08' },
  { input: '08/08/2026 02:30 PM', expected: '2026-08-08' },
  { input: '2026-08-08T15:30:00.000Z', expected: '2026-08-08' },
  { input: 45123, expected: '2023-07-16' }, // Excel serial
  { input: '18/05/2026', expected: '2026-05-18' }, // DD/MM/YYYY where DD > 12
  { input: '05/18/2026', expected: '2026-05-18' }, // MM/DD/YYYY where DD > 12
];

dateTests.forEach(({ input, expected }) => {
  const result = safeDate(input);
  console.log(`   safeDate("${input}") => "${result}" [${result === expected ? '✅ PASS' : '❌ FAIL (expected ' + expected + ')'}]`);
  assert.strictEqual(result, expected, `Date mismatch for input ${input}`);
});

// 2. Test Number Parsing
console.log('\n2️⃣ Testing safeNumber with currency formats:');
const numberTests = [
  { input: '₹1,299.00', expected: 1299 },
  { input: 'Rs. 450.50', expected: 450.5 },
  { input: '$12.99', expected: 12.99 },
  { input: '1,250', expected: 1250 },
  { input: '499', expected: 499 },
  { input: null, expected: 0 },
];

numberTests.forEach(({ input, expected }) => {
  const result = safeNumber(input);
  console.log(`   safeNumber("${input}") => ${result} [${result === expected ? '✅ PASS' : '❌ FAIL (expected ' + expected + ')'}]`);
  assert.strictEqual(result, expected, `Number mismatch for input ${input}`);
});

// 3. Test Flipkart Row Normalization (no hardcoded col 16!)
console.log('\n3️⃣ Testing Flipkart row normalization:');
const sampleFlipkartRow = {
  'Order Item ID': 'OD123456789',
  'Seller SKU': 'KNOT-BAG-01',
  'Product Title': 'Handmade Macrame Bag',
  'Quantity': '2',
  'Selling Price': '₹1,499.00',
  'Listing Price': '₹1,999.00',
  'Order Date': '08/08/2026 10:15:00',
  'Item Status': 'Approved',
  'Buyer City': 'Mumbai',
  'Buyer State': 'Maharashtra',
};

const normalizedFlipkart = normalizeRow(sampleFlipkartRow, 'flipkart');
console.log('   Normalized Flipkart Order:', normalizedFlipkart);
assert.strictEqual(normalizedFlipkart.external_order_id, 'OD123456789');
assert.strictEqual(normalizedFlipkart.sku, 'KNOT-BAG-01');
assert.strictEqual(normalizedFlipkart.unit_price, 1499);
assert.strictEqual(normalizedFlipkart.listing_price, 1999);
assert.strictEqual(normalizedFlipkart.order_date, '2026-08-08');
assert.strictEqual(normalizedFlipkart.quantity, 2);
console.log('   ✅ Flipkart CSV normalization passed!');

// 4. Test Backup Service
console.log('\n4️⃣ Testing Backup Service:');
(async () => {
  try {
    const backupRes = await performBackup(false);
    console.log(`   Created manual backup: ${backupRes.filename} (${backupRes.size} bytes)`);
    assert(backupRes.filename.includes('knotique-manual-backup-'), 'Filename format correct');

    const backupsList = await listBackups();
    console.log(`   Backups list count: ${backupsList.length}`);
    assert(backupsList.some(b => b.filename === backupRes.filename), 'Backup listed in snapshot history');

    // Clean up test backup file
    await deleteBackup(backupRes.filename);
    console.log(`   Deleted test backup file: ${backupRes.filename}`);
    console.log('\n🎉 ALL DIAGNOSTIC TESTS PASSED CLEANLY!\n');
  } catch (err) {
    console.error('\n❌ Backup test failed:', err);
    process.exit(1);
  }
})();
