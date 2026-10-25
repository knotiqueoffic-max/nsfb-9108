const db = require('./db/database');

async function test() {
  const counts = await db('orders')
    .select('order_date')
    .count('* as count')
    .groupBy('order_date')
    .orderBy('count', 'desc')
    .limit(10);
  console.log('Order dates summary:', counts);
  process.exit(0);
}

test();
