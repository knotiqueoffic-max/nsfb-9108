const assert = require('assert');
const http = require('http');
const bcrypt = require('bcryptjs');

const app = require('./index');
const db = require('./db/database');
const { ROLES, ACCOUNT_STATUS } = require('./constants/roles');
const { generateToken } = require('./middleware/auth');

let server;
let baseUrl;

async function runTests() {
  console.log('\n======================================================');
  console.log('🚀 Running Signup Roles, Role Immutability & Unified Plans Tests');
  console.log('======================================================\n');

  // Start ephemeral test server
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  let passed = 0;
  let total = 0;

  function recordAssert(condition, message) {
    total++;
    if (!condition) {
      console.error(`  ❌ FAILED: ${message}`);
      throw new Error(message);
    }
    passed++;
    console.log(`  ✓ ${message}`);
  }

  const timestamp = Date.now();

  // ─── Test 1: Public POST /api/auth/register with role 'admin' ──────────────
  console.log('\n--- 1. Public Self-Registration for Admin ---');
  const adminRegRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Admin Self Reg',
      email: `admin_self_${timestamp}@test.com`,
      password: 'password123',
      role: 'admin',
    }),
  });
  const adminRegData = await adminRegRes.json();
  recordAssert(adminRegRes.status === 201, `Admin self-registration returns 201 (got ${adminRegRes.status})`);
  recordAssert(adminRegData.user?.role === 'admin', `User created with role 'admin'`);
  recordAssert(Boolean(adminRegData.token), 'Valid JWT token returned');

  // Check tenant in database
  const adminTenant = await db('tenants').where('id', adminRegData.user.tenant_id).first();
  recordAssert(adminTenant && adminTenant.tenant_type === 'business', 'Admin tenant created with tenant_type business');

  // ─── Test 2: Public POST /api/auth/register with role 'vendor' ─────────────
  console.log('\n--- 2. Public Self-Registration for Vendor ---');
  const vendorRegRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Vendor Self Reg',
      email: `vendor_self_${timestamp}@test.com`,
      password: 'password123',
      role: 'vendor',
    }),
  });
  const vendorRegData = await vendorRegRes.json();
  recordAssert(vendorRegRes.status === 201, `Vendor self-registration returns 201 (got ${vendorRegRes.status})`);
  recordAssert(vendorRegData.user?.role === 'vendor', `User created with role 'vendor'`);

  const vendorTenant = await db('tenants').where('id', vendorRegData.user.tenant_id).first();
  recordAssert(vendorTenant && vendorTenant.tenant_type === 'vendor', 'Vendor tenant created with tenant_type vendor');

  // ─── Test 3: Public POST /api/auth/register with role 'subvendor' ──────────
  console.log('\n--- 3. Public Self-Registration for Sub-Vendor ---');
  const subvendorRegRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Subvendor Self Reg',
      email: `subvendor_self_${timestamp}@test.com`,
      password: 'password123',
      role: 'subvendor',
    }),
  });
  const subvendorRegData = await subvendorRegRes.json();
  recordAssert(subvendorRegRes.status === 201, `Subvendor self-registration returns 201 (got ${subvendorRegRes.status})`);
  recordAssert(subvendorRegData.user?.role === 'subvendor', `User created with role 'subvendor'`);

  const subvendorTenant = await db('tenants').where('id', subvendorRegData.user.tenant_id).first();
  recordAssert(subvendorTenant && subvendorTenant.tenant_type === 'subvendor', 'Subvendor tenant created with tenant_type subvendor');

  // ─── Test 4: Public POST /api/auth/register with role 'worker' (FORBIDDEN) ─
  console.log('\n--- 4. Blocking Worker Public Self-Registration ---');
  const workerRegRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Worker Self Reg Blocked',
      email: `worker_self_${timestamp}@test.com`,
      password: 'password123',
      role: 'worker',
    }),
  });
  const workerRegData = await workerRegRes.json();
  recordAssert(workerRegRes.status === 403, `Worker public registration rejected with HTTP 403 Forbidden (got ${workerRegRes.status})`);
  recordAssert(workerRegData.error && workerRegData.error.includes('Workers cannot self-register'), 'Worker rejection message mentions invitation requirement');

  // ─── Test 5: Public POST /api/auth/register with role 'crocheter' (FORBIDDEN)
  const crocheterRegRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Crocheter Self Reg Blocked',
      email: `crocheter_self_${timestamp}@test.com`,
      password: 'password123',
      role: 'crocheter',
    }),
  });
  recordAssert(crocheterRegRes.status === 403, `Crocheter alias registration rejected with HTTP 403 Forbidden (got ${crocheterRegRes.status})`);

  // ─── Test 6: Public POST /api/auth/signup with role 'worker' (FORBIDDEN) ───
  console.log('\n--- 5. Blocking Worker Self-Signup via /api/auth/signup ---');
  const workerSignupRes = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Worker Signup Form Blocked',
      email: `worker_signup_${timestamp}@test.com`,
      password: 'password123',
      company_name: 'Worker Test Workshop',
      role: 'worker',
    }),
  });
  recordAssert(workerSignupRes.status === 403, `Worker signup via /auth/signup rejected with HTTP 403 Forbidden (got ${workerSignupRes.status})`);

  // ─── Test 7: Public POST /api/auth/signup with role 'vendor' ───────────────
  console.log('\n--- 6. Successful /api/auth/signup with role vendor ---');
  const vendorSignupRes = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Vendor Partner Alpha',
      email: `vendor_alpha_${timestamp}@test.com`,
      password: 'password123',
      company_name: 'Alpha Supplies Co',
      role: 'vendor',
      business_category: 'Crochet & Knitting',
    }),
  });
  const vendorSignupData = await vendorSignupRes.json();
  recordAssert(vendorSignupRes.status === 201, `Vendor signup returns 201 (got ${vendorSignupRes.status})`);
  recordAssert(vendorSignupData.user?.role === 'vendor', `User assigned role 'vendor'`);
  recordAssert(vendorSignupData.user?.tenant_type === 'vendor', `Tenant type assigned 'vendor'`);

  // ─── Test 8: Unified Plans for Admin, Vendor, and Sub-Vendor ────────────────
  console.log('\n--- 7. Unified Plans Verification ---');
  const plansRes = await fetch(`${baseUrl}/api/billing/plans`);
  const plans = await plansRes.json();
  recordAssert(Array.isArray(plans) && plans.length === 4, `4 standard plans available (got ${plans?.length})`);
  const planIds = plans.map((p) => p.id).sort();
  recordAssert(
    JSON.stringify(planIds) === JSON.stringify(['business', 'free_trial', 'growth', 'starter']),
    'Plans include free_trial, starter, growth, business'
  );

  // ─── Test 9: Subscribing / Activating Plans for Admin, Vendor, Sub-Vendor ───
  console.log('\n--- 8. Admin, Vendor, Sub-Vendor Can Subscribe to Plans ---');
  // Admin activates Growth plan
  const adminSubRes = await fetch(`${baseUrl}/api/billing/subscribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminRegData.token}`,
    },
    body: JSON.stringify({ plan_id: 'growth' }),
  });
  const adminSubData = await adminSubRes.json();
  recordAssert(adminSubRes.status === 200, `Admin can initiate plan subscription (got ${adminSubRes.status})`);
  recordAssert(Boolean(adminSubData.subscriptionId), 'Admin received subscriptionId');

  // Vendor activates Free Trial
  const vendorSubRes = await fetch(`${baseUrl}/api/billing/subscribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${vendorRegData.token}`,
    },
    body: JSON.stringify({ plan_id: 'free_trial' }),
  });
  const vendorSubData = await vendorSubRes.json();
  recordAssert(vendorSubRes.status === 200, `Vendor can activate free trial (got ${vendorSubRes.status})`);
  recordAssert(vendorSubData.isFreeTrial === true, 'Vendor received isFreeTrial: true');

  // Sub-Vendor activates Business plan
  const subvendorSubRes = await fetch(`${baseUrl}/api/billing/subscribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${subvendorRegData.token}`,
    },
    body: JSON.stringify({ plan_id: 'business' }),
  });
  const subvendorSubData = await subvendorSubRes.json();
  recordAssert(subvendorSubRes.status === 200, `Subvendor can initiate business plan (got ${subvendorSubRes.status})`);
  recordAssert(Boolean(subvendorSubData.subscriptionId), 'Subvendor received subscriptionId');

  // ─── Test 10: Worker Blocked from Subscribing / Billing (403 Forbidden) ─────
  console.log('\n--- 9. Worker Blocked from Billing Endpoints ---');
  const [workerUser] = await db('users').insert({
    tenant_id: adminRegData.user.tenant_id,
    name: 'Worker Test Billing Block',
    email: `worker_billing_${timestamp}@test.com`,
    password_hash: await bcrypt.hash('password123', 8),
    role: ROLES.WORKER,
    status: ACCOUNT_STATUS.ACTIVE,
    is_active: true,
  }).returning('*');
  const workerToken = generateToken(workerUser);

  const workerSubRes = await fetch(`${baseUrl}/api/billing/subscribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${workerToken}`,
    },
    body: JSON.stringify({ plan_id: 'starter' }),
  });
  recordAssert(workerSubRes.status === 403, `Worker is rejected from /billing/subscribe with 403 Forbidden (got ${workerSubRes.status})`);

  const workerInvoicesRes = await fetch(`${baseUrl}/api/billing/invoices`, {
    headers: { Authorization: `Bearer ${workerToken}` },
  });
  recordAssert(workerInvoicesRes.status === 403, `Worker is rejected from /billing/invoices with 403 Forbidden (got ${workerInvoicesRes.status})`);

  // Admin and Vendor CAN access invoices
  const adminInvoicesRes = await fetch(`${baseUrl}/api/billing/invoices`, {
    headers: { Authorization: `Bearer ${adminRegData.token}` },
  });
  recordAssert(adminInvoicesRes.status === 200, `Admin can access /billing/invoices (got ${adminInvoicesRes.status})`);

  const vendorInvoicesRes = await fetch(`${baseUrl}/api/billing/invoices`, {
    headers: { Authorization: `Bearer ${vendorRegData.token}` },
  });
  recordAssert(vendorInvoicesRes.status === 200, `Vendor can access /billing/invoices (got ${vendorInvoicesRes.status})`);

  // ─── Test 11: Role Immutability on PUT /api/auth/profile ───────────────────
  console.log('\n--- 10. Role Immutability Enforcement ---');
  // Vendor attempts to elevate themselves to 'admin'
  const mutateRoleRes = await fetch(`${baseUrl}/api/auth/profile`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${vendorRegData.token}`,
    },
    body: JSON.stringify({
      name: 'Vendor Partner Updated Name',
      role: 'admin',
      tenant_id: 999999,
    }),
  });
  const mutateRoleData = await mutateRoleRes.json();
  recordAssert(mutateRoleRes.status === 200, `Profile update returns 200`);
  recordAssert(mutateRoleData.user?.role === 'vendor', `User role remains unchanged ('vendor') in response`);
  recordAssert(mutateRoleData.user?.name === 'Vendor Partner Updated Name', 'Name updated successfully');

  // Verify role and tenant remain strictly unchanged in database
  const vendorInDb = await db('users').where('id', vendorRegData.user.id).first();
  recordAssert(vendorInDb.role === 'vendor', `Vendor role remains 'vendor' in database (immutability preserved)`);
  recordAssert(vendorInDb.tenant_id === vendorRegData.user.tenant_id, `Vendor tenant_id remains unchanged in database`);

  console.log('\n======================================================');
  console.log(`🎉 ALL ${passed}/${total} SIGNUP ROLES & PLANS TESTS PASSED!`);
  console.log('======================================================\n');
}

runTests()
  .then(() => {
    if (server) server.close();
    process.exit(0);
  })
  .catch((err) => {
    if (server) server.close();
    console.error('\n❌ Test Suite Failed:', err);
    process.exit(1);
  });
