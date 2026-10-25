const db = require('./db/database');

async function test() {
  const o = await db('orders').select('order_date').limit(100);
  console.log(o.map(x => x.order_date).join(', '));
  process.exit(0);
}

test();
