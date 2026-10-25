const db = require('./db/database');

async function test() {
  const start = '2026-08-01';
  const end = '2026-08-08';
  let query = db('orders as o')
    .select('o.order_date')
    .where('o.order_date', '>=', start)
    .where('o.order_date', '<=', end);
    
  const results = await query;
  console.log(`Filtered between ${start} and ${end}, got ${results.length} results.`);
  
  // Also what happens if we query with string '2026-08-01' vs Date object?
  process.exit(0);
}

test();
