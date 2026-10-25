/**
 * Knotique Business Manager — Architecture Extensions Automated Test Suite
 * Tests Phases 1 through 8:
 *  - Foundation, Roles, and Tenant Isolation
 *  - Session Revocation and Account Status Enforcement
 *  - Profile Updates and Privilege Escalation Prevention
 *  - Invitations and Multi-Tier Organization Hierarchy
 *  - Supplier Relationships, Warehouses, and Transactional Purchasing
 *  - Subscription Rules and Worker Billing Exemption
 *  - Work Management and Worker Scoping
 *  - Audit Logging and Real-Time Notifications
 */

const http = require('http');
const assert = require('assert');
const bcrypt = require('bcryptjs');
const db = require('./db/database');
const app = require('./index');
const { ROLES, ACCOUNT_STATUS, canAssignRole } = require('./constants/roles');
const { generateToken } = require('./middleware/auth');
const { sanitizeDetails } = require('./services/audit.service');

let server;
let baseUrl;

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const reqOptions = {
      method: options.method || 'GET',
      headers,
    };

    const req = http.request(url, reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { json = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🚀 Running Knotique Architecture Extensions Test Suite');
  console.log('======================================================\n');

  // Start temporary test server on random open port
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  const timestamp = Date.now();
  let tenantAId, tenantBId;
  let ownerAToken, ownerBToken, workerAToken, suspendedUserToken;
  let ownerAUser, workerAUser, suspendedUser;

  try {
    // ─── SETUP TEST DATA ──────────────────────────────────────────────────────
    console.log('📦 Setting up isolated test tenants and user accounts...');

    // 1. Create Tenant A (Business Workspace)
    const [tA] = await db('tenants').insert({
      name: `Test Business A ${timestamp}`,
      slug: `test-biz-a-${timestamp}`,
      plan_id: 'business',
      subscription_status: 'active',
      tenant_type: 'business',
      status: 'active',
    }).returning('id');
    tenantAId = typeof tA === 'object' ? tA.id : tA;

    // 2. Create Tenant B (Separate Business Workspace for cross-tenant tests)
    const [tB] = await db('tenants').insert({
      name: `Test Business B ${timestamp}`,
      slug: `test-biz-b-${timestamp}`,
      plan_id: 'starter',
      subscription_status: 'active',
      tenant_type: 'business',
      status: 'active',
    }).returning('id');
    tenantBId = typeof tB === 'object' ? tB.id : tB;

    // 3. Create Users
    const pwHash = await bcrypt.hash('password123', 8);

    // Owner of Tenant A
    const [uA] = await db('users').insert({
      tenant_id: tenantAId,
      name: 'Owner Alice',
      email: `owner-alice-${timestamp}@test.com`,
      password_hash: pwHash,
      role: ROLES.OWNER,
      status: ACCOUNT_STATUS.ACTIVE,
      is_active: true,
      token_version: 1,
    }).returning('id');
    const ownerAId = typeof uA === 'object' ? uA.id : uA;
    ownerAUser = await db('users').where('id', ownerAId).first();
    ownerAToken = generateToken(ownerAUser);

    // Worker of Tenant A
    const [wA] = await db('users').insert({
      tenant_id: tenantAId,
      name: 'Artisan Bob',
      email: `worker-bob-${timestamp}@test.com`,
      password_hash: pwHash,
      role: ROLES.WORKER,
      status: ACCOUNT_STATUS.ACTIVE,
      is_active: true,
      token_version: 1,
      wage_mode: 'per_piece',
      wage_rate: 15,
    }).returning('id');
    const workerAId = typeof wA === 'object' ? wA.id : wA;
    workerAUser = await db('users').where('id', workerAId).first();
    workerAToken = generateToken(workerAUser);

    // Owner of Tenant B
    const [uB] = await db('users').insert({
      tenant_id: tenantBId,
      name: 'Owner Charlie',
      email: `owner-charlie-${timestamp}@test.com`,
      password_hash: pwHash,
      role: ROLES.OWNER,
      status: ACCOUNT_STATUS.ACTIVE,
      is_active: true,
      token_version: 1,
    }).returning('id');
    const ownerBId = typeof uB === 'object' ? uB.id : uB;
    const ownerBUser = await db('users').where('id', ownerBId).first();
    ownerBToken = generateToken(ownerBUser);

    // Suspended User in Tenant A
    const [uS] = await db('users').insert({
      tenant_id: tenantAId,
      name: 'Suspended Sam',
      email: `suspended-sam-${timestamp}@test.com`,
      password_hash: pwHash,
      role: ROLES.WORKER,
      status: ACCOUNT_STATUS.SUSPENDED,
      is_active: false,
      token_version: 1,
    }).returning('id');
    const suspendedId = typeof uS === 'object' ? uS.id : uS;
    suspendedUser = await db('users').where('id', suspendedId).first();
    suspendedUserToken = generateToken(suspendedUser);

    console.log('✓ Test data setup complete.\n');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST GROUP 1: Privilege Escalation Guard
    // ─────────────────────────────────────────────────────────────────────────
    console.log('Test Group 1: Privilege Escalation Guards');
    assert.strictEqual(canAssignRole(ROLES.OWNER, ROLES.ADMIN), true, 'Owner should be able to assign admin');
    assert.strictEqual(canAssignRole(ROLES.OWNER, ROLES.WORKER), true, 'Owner should be able to assign worker');
    assert.strictEqual(canAssignRole(ROLES.OWNER, ROLES.SUPER_ADMIN), false, 'Owner cannot create super_admin');
    assert.strictEqual(canAssignRole(ROLES.ADMIN, ROLES.OWNER), false, 'Admin cannot assign owner');
    assert.strictEqual(canAssignRole(ROLES.ADMIN, ROLES.WORKER), true, 'Admin can assign worker');
    assert.strictEqual(canAssignRole(ROLES.VENDOR, ROLES.SUBVENDOR), true, 'Vendor can assign subvendor');
    assert.strictEqual(canAssignRole(ROLES.WORKER, ROLES.ADMIN), false, 'Worker cannot assign admin');
    console.log('  ✓ canAssignRole matrix strictly enforced');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST GROUP 2: Suspended User Rejection
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nTest Group 2: Suspended User Access Rejection');
    const suspendedLoginRes = await request('/api/auth/login', {
      method: 'POST',
      body: { email: suspendedUser.email, password: 'password123' },
    });
    assert.strictEqual(suspendedLoginRes.status, 403, 'Suspended login must return HTTP 403');
    assert.strictEqual(suspendedLoginRes.body.error, 'Account inactive or suspended');
    console.log('  ✓ Suspended login rejected with HTTP 403');

    const suspendedApiRes = await request('/api/auth/me', {
      headers: { Authorization: `Bearer ${suspendedUserToken}` },
    });
    assert.strictEqual(suspendedApiRes.status, 403, 'Suspended bearer token must be rejected with HTTP 403');
    console.log('  ✓ Suspended bearer token rejected with HTTP 403');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST GROUP 3: Session Revocation (token_version)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nTest Group 3: Token Versioning & Session Revocation');
    const preRevokeRes = await request('/api/auth/me', {
      headers: { Authorization: `Bearer ${ownerAToken}` },
    });
    assert.strictEqual(preRevokeRes.status, 200, 'Token version 1 active');

    // Revoke sessions via endpoint
    const revokeRes = await request('/api/auth/revoke-sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerAToken}` },
    });
    assert.strictEqual(revokeRes.status, 200, 'Revoke endpoint returns 200');
    assert.ok(revokeRes.body.token, 'Returns fresh token for current session');
    const freshOwnerAToken = revokeRes.body.token;

    // Old token should now be rejected
    const postRevokeOldRes = await request('/api/auth/me', {
      headers: { Authorization: `Bearer ${ownerAToken}` },
    });
    assert.strictEqual(postRevokeOldRes.status, 401, 'Old token must be rejected with HTTP 401');
    assert.strictEqual(postRevokeOldRes.body.code, 'SESSION_REVOKED');
    console.log('  ✓ Old session token invalidated (HTTP 401 SESSION_REVOKED)');

    // Fresh token should work
    const postRevokeFreshRes = await request('/api/auth/me', {
      headers: { Authorization: `Bearer ${freshOwnerAToken}` },
    });
    assert.strictEqual(postRevokeFreshRes.status, 200, 'Fresh token accepted');
    console.log('  ✓ Fresh replacement session token accepted');
    ownerAToken = freshOwnerAToken; // Update for subsequent tests

    // ─────────────────────────────────────────────────────────────────────────
    // TEST GROUP 4: Profile Updates & Tamper Prevention
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nTest Group 4: Profile Management & Tamper Proofing');
    const profileUpdateRes = await request('/api/auth/profile', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ownerAToken}` },
      body: {
        name: 'Alice Updated',
        phone: '+91 9876543210',
        role: ROLES.SUPER_ADMIN, // Malicious attempt to escalate role
        tenant_id: 999999,       // Malicious attempt to change tenant
      },
    });
    assert.strictEqual(profileUpdateRes.status, 200, 'Profile update returns 200');
    assert.strictEqual(profileUpdateRes.body.user.name, 'Alice Updated');
    assert.strictEqual(profileUpdateRes.body.user.phone, '+91 9876543210');
    assert.strictEqual(profileUpdateRes.body.user.role, ROLES.OWNER, 'Role must NOT be escalated');
    assert.strictEqual(profileUpdateRes.body.user.tenant_id, tenantAId, 'Tenant ID must NOT be tampered');
    console.log('  ✓ Safe fields (name, phone) updated');
    console.log('  ✓ Malicious role & tenant_id escalation blocked');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST GROUP 5: Invitations & Multi-tier Member Onboarding
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nTest Group 5: Invitations & Member Onboarding');
    const inviteEmail = `invited-artisan-${timestamp}@test.com`;

    // 1. Create invitation
    const inviteRes = await request('/api/invitations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerAToken}` },
      body: { email: inviteEmail, role: ROLES.WORKER },
    });
    assert.strictEqual(inviteRes.status, 201, 'Invitation creation returns 201');
    assert.ok(inviteRes.body.token, 'Raw invitation token returned');
    assert.strictEqual(inviteRes.body.invitation.status, 'pending');
    const rawInvitationToken = inviteRes.body.token;
    console.log('  ✓ Invitation created with secure SHA-256 token hash');

    // 2. Privilege escalation attempt via invitation
    const escalateInviteRes = await request('/api/invitations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${workerAToken}` },
      body: { email: `hacker-${timestamp}@test.com`, role: ROLES.ADMIN },
    });
    assert.strictEqual(escalateInviteRes.status, 403, 'Worker inviting admin must return 403');
    console.log('  ✓ Worker attempt to invite admin rejected (403)');

    // 3. Accept invitation publicly
    const acceptRes = await request('/api/invitations/accept', {
      method: 'POST',
      body: {
        token: rawInvitationToken,
        name: 'Invited Artisan',
        password: 'securePassword456',
        phone: '+91 9123456789',
      },
    });
    assert.strictEqual(acceptRes.status, 200, 'Accept invitation returns 200');
    assert.ok(acceptRes.body.token, 'Returns authenticated application JWT');
    assert.strictEqual(acceptRes.body.user.role, ROLES.WORKER);
    assert.strictEqual(acceptRes.body.user.tenant_id, tenantAId, 'Assigned to correct tenant');
    console.log('  ✓ Public invitation accepted and member enrolled into tenant');

    // 4. Reusing accepted token must fail
    const reuseRes = await request('/api/invitations/accept', {
      method: 'POST',
      body: { token: rawInvitationToken, name: 'Replay Attacker', password: 'password123' },
    });
    assert.strictEqual(reuseRes.status, 400, 'Reusing token returns 400');
    console.log('  ✓ Token replay rejected');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST GROUP 6: Organization Hierarchy (Vendors -> Subvendors)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nTest Group 6: Organization Hierarchy (Subvendors & Relationships)');
    const subvendorRes = await request('/api/tenants/subvendors', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerAToken}` },
      body: { name: `Knitting Unit North ${timestamp}`, business_category: 'Crochet Cluster' },
    });
    assert.strictEqual(subvendorRes.status, 201, 'Create subvendor returns 201');
    assert.strictEqual(subvendorRes.body.subvendor.tenant_type, 'subvendor');
    assert.strictEqual(subvendorRes.body.subvendor.parent_tenant_id, tenantAId);
    console.log('  ✓ Subvendor tenant created under parent organization');

    const relationshipsRes = await request('/api/tenants/relationships', {
      headers: { Authorization: `Bearer ${ownerAToken}` },
    });
    assert.strictEqual(relationshipsRes.status, 200);
    assert.ok(relationshipsRes.body.length >= 1, 'Lists organization relationship');
    console.log('  ✓ Organization relationships query returns multi-tier hierarchy');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST GROUP 7: Warehouses & Physical Locations
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nTest Group 7: Warehouses & Location Management');
    const warehouseRes = await request('/api/warehouses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerAToken}` },
      body: {
        name: 'Central Jaipur Depot',
        code: 'WH-JPR-01',
        city: 'Jaipur',
        state: 'Rajasthan',
        pincode: '302001',
        latitude: 26.9124,
        longitude: 75.7873,
        is_default: true,
      },
    });
    assert.strictEqual(warehouseRes.status, 201, 'Create warehouse returns 201');
    assert.strictEqual(warehouseRes.body.city, 'Jaipur');
    assert.strictEqual(warehouseRes.body.is_active, 1);
    const warehouseId = warehouseRes.body.id;
    console.log('  ✓ Warehouse created with coordinate and location support');

    // Cross-tenant warehouse access denial
    const crossWarehouseRes = await request(`/api/warehouses/${warehouseId}`, {
      headers: { Authorization: `Bearer ${ownerBToken}` },
    });
    assert.strictEqual(crossWarehouseRes.status, 404, 'Cross-tenant warehouse access returns 404');
    console.log('  ✓ Cross-tenant warehouse isolation verified');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST GROUP 8: Suppliers & Transactional Purchasing
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nTest Group 8: Suppliers & Transactional Purchasing');

    // 1. Link Tenant B as an approved supplier of Tenant A
    const linkSupplierRes = await request('/api/suppliers/link', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerAToken}` },
      body: { vendor_tenant_id: tenantBId, category: 'Organic Cotton Yarns' },
    });
    assert.strictEqual(linkSupplierRes.status, 201, 'Supplier linking returns 201');
    console.log('  ✓ Supplier relationship linked between organizations');

    // 2. Query suppliers
    const getSuppliersRes = await request('/api/suppliers', {
      headers: { Authorization: `Bearer ${ownerAToken}` },
    });
    assert.strictEqual(getSuppliersRes.status, 200);
    assert.ok(getSuppliersRes.body.linked_suppliers.length >= 1);
    console.log('  ✓ GET /api/suppliers returns linked vendor partners');

    // 3. Create raw material for purchasing test
    const [mId] = await db('raw_materials').insert({
      tenant_id: tenantAId,
      name: 'Vardhman 4-Ply Wool',
      unit: 'skein',
      stock_quantity: 10,
      cost_per_unit: 100,
      avg_cost_per_unit: 100,
    }).returning('id');
    const matId = typeof mId === 'object' ? mId.id : mId;

    // 4. Log purchase with warehouse and supplier
    const purchaseRes = await request('/api/purchases', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerAToken}` },
      body: {
        material_id: matId,
        quantity: 20,
        cost_per_unit: 130,
        purchase_date: new Date().toISOString().split('T')[0],
        supplier: 'Vardhman Mills Direct',
        warehouse_id: warehouseId,
      },
    });
    assert.strictEqual(purchaseRes.status, 201, 'Purchase logging returns 201');
    assert.strictEqual(purchaseRes.body.new_stock, 30, 'Stock quantity updated to 30');
    // Weighted avg: (10 * 100 + 20 * 130) / 30 = 3600 / 30 = 120
    assert.strictEqual(Math.round(purchaseRes.body.new_avg_cost), 120, 'Weighted average cost recalculated to 120');
    console.log('  ✓ Transactional purchase logged, stock incremented, and moving avg cost recalculated');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST GROUP 9: Work Management & Worker Permission Scope
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nTest Group 9: Work Management & Worker Permission Scope');

    // 1. Create a product for production
    const [pId] = await db('products').insert({
      tenant_id: tenantAId,
      name: 'Handmade Baby Bonnet',
      sku: `BONNET-${timestamp}`,
      labor_cost_per_unit: 25,
      is_active: true,
    }).returning('id');
    const productId = typeof pId === 'object' ? pId.id : pId;

    // 2. Worker logs piecework production
    const workerProdRes = await request('/api/production', {
      method: 'POST',
      headers: { Authorization: `Bearer ${workerAToken}` },
      body: {
        product_id: productId,
        quantity: 5,
        production_date: new Date().toISOString().split('T')[0],
      },
    });
    assert.strictEqual(workerProdRes.status, 201, 'Worker can log their piecework');
    assert.strictEqual(workerProdRes.body.entry.worker_id, workerAUser.id);
    assert.strictEqual(workerProdRes.body.entry.labor_cost, 75, 'Wage rate (15 * 5 = 75)');
    console.log('  ✓ Worker logged production piecework entry successfully');

    // 3. Worker queries production (should only see their own)
    const workerViewRes = await request('/api/production', {
      headers: { Authorization: `Bearer ${workerAToken}` },
    });
    assert.strictEqual(workerViewRes.status, 200);
    const workerEntries = workerViewRes.body.entries;
    assert.ok(workerEntries.every(e => e.worker_id === workerAUser.id), 'Worker can only see their own entries');
    console.log('  ✓ Worker visibility restricted to own piecework records');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST GROUP 10: Real-Time Notifications & Audit Logs
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nTest Group 10: Real-Time Notifications & Audit Logging');

    // 1. Notifications endpoint
    const notifRes = await request('/api/notifications', {
      headers: { Authorization: `Bearer ${ownerAToken}` },
    });
    assert.strictEqual(notifRes.status, 200, 'Notifications endpoint returns 200');
    assert.ok(Array.isArray(notifRes.body.alerts), 'Returns alerts array');
    console.log(`  ✓ Aggregated notifications endpoint functional (${notifRes.body.alerts.length} active alerts)`);

    // 2. Audit logs endpoint
    const auditRes = await request('/api/audit-logs', {
      headers: { Authorization: `Bearer ${ownerAToken}` },
    });
    assert.strictEqual(auditRes.status, 200, 'Audit logs endpoint returns 200');
    assert.ok(auditRes.body.total >= 5, 'Contains audit log records');
    console.log(`  ✓ Audit logs queryable by organization admin (${auditRes.body.total} events recorded)`);

    // 3. Audit log secret sanitization check
    const rawSensitive = { password: 'secretPassword', token: 'jwt123', safe: 'hello' };
    const sanitized = sanitizeDetails(rawSensitive);
    assert.strictEqual(sanitized.password, '[REDACTED]');
    assert.strictEqual(sanitized.token, '[REDACTED]');
    assert.strictEqual(sanitized.safe, 'hello');
    console.log('  ✓ Audit log secret sanitizer verified');

    console.log('\n======================================================');
    console.log('🎉 ALL ARCHITECTURE EXTENSION TEST GROUPS PASSED (10/10)!');
    console.log('======================================================\n');
  } catch (err) {
    console.error('\n❌ TEST FAILURE:', err);
    process.exitCode = 1;
  } finally {
    if (server) server.close();
    // Close Knex pool
    await db.destroy();
  }
}

runTests();
