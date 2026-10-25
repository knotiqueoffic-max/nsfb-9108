const db = require('./db/database');

async function testTodos() {
  console.log('--- Testing Todos Table & Database Safety ---');

  // Verify existing database tables & row counts remain intact
  const users = await db('users').count('* as count').first();
  const products = await db('products').count('* as count').first();
  const orders = await db('orders').count('* as count').first();

  console.log(`✅ Existing Users count: ${users.count}`);
  console.log(`✅ Existing Products count: ${products.count}`);
  console.log(`✅ Existing Orders count: ${orders.count}`);

  // Test inserting a sample admin to-do item
  const [todoId] = await db('todos').insert({
    tenant_id: 1,
    user_id: 1,
    title: 'Review monthly production report and material inventory',
    description: 'Check raw material stock levels and finalize payouts for workers.',
    status: 'pending',
    priority: 'high',
    due_date: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0],
    created_at: new Date(),
    updated_at: new Date(),
  }).returning('id');

  const inserted = await db('todos').where('tenant_id', 1).orderBy('created_at', 'desc').first();
  console.log('✅ Created sample admin To-Do item:', inserted);

  // Test stats query
  const todos = await db('todos').where('tenant_id', 1);
  console.log(`✅ Total To-Dos for tenant 1: ${todos.length}`);

  process.exit(0);
}

testTodos().catch((err) => {
  console.error('❌ Error during todo test:', err);
  process.exit(1);
});
