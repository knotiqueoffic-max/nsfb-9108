const assert = require('assert');
const http = require('http');
const bcrypt = require('bcryptjs');

const app = require('./index');
const db = require('./db/database');
const { ROLES, ACCOUNT_STATUS } = require('./constants/roles');
const { generateToken } = require('./middleware/auth');
const { deleteUserSafely } = require('./services/user.service');

let server;
let baseUrl;

async function runTests() {
  console.log('\n======================================================');
  console.log('🚀 Running Worker Uploads & Hierarchical Deletion Tests');
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

  // ─── Setup isolated test fixtures ──────────────────────────────────────────
  console.log('📦 Setting up isolated test fixtures...');
  const timestamp = Date.now();

  const [tAdminId] = await db('tenants').insert({
    name: `Upload Test Org ${timestamp}`,
    slug: `upload-org-${timestamp}`,
    tenant_type: 'business',
    plan_id: 'business',
    status: ACCOUNT_STATUS.ACTIVE,
    subscription_status: 'active',
  }).returning('id');
  const tenantId = typeof tAdminId === 'object' ? tAdminId.id : tAdminId;

  // 1. Admin
  const adminPwd = await bcrypt.hash('password123', 8);
  const [adminId] = await db('users').insert({
    tenant_id: tenantId,
    name: 'Admin Test Deletion',
    email: `admin_del_${timestamp}@test.com`,
    password_hash: adminPwd,
    role: ROLES.ADMIN,
    status: ACCOUNT_STATUS.ACTIVE,
    is_active: true,
    token_version: 1,
  }).returning('id');
  const resolvedAdminId = typeof adminId === 'object' ? adminId.id : adminId;
  const adminToken = generateToken({
    id: resolvedAdminId,
    email: `admin_del_${timestamp}@test.com`,
    role: ROLES.ADMIN,
    tenant_id: tenantId,
    token_version: 1,
  });

  // 2. Vendor
  const vendorPwd = await bcrypt.hash('password123', 8);
  const [vendorId] = await db('users').insert({
    tenant_id: tenantId,
    name: 'Vendor Test Deletion',
    email: `vendor_del_${timestamp}@test.com`,
    password_hash: vendorPwd,
    role: ROLES.VENDOR,
    status: ACCOUNT_STATUS.ACTIVE,
    is_active: true,
    token_version: 1,
  }).returning('id');
  const resolvedVendorId = typeof vendorId === 'object' ? vendorId.id : vendorId;
  const vendorToken = generateToken({
    id: resolvedVendorId,
    email: `vendor_del_${timestamp}@test.com`,
    role: ROLES.VENDOR,
    tenant_id: tenantId,
    token_version: 1,
  });

  // 3. Worker 1 (assigned crocheter)
  const workerPwd = await bcrypt.hash('password123', 8);
  const [worker1Id] = await db('users').insert({
    tenant_id: tenantId,
    name: 'Crocheter Upload Worker',
    email: `crocheter_up_${timestamp}@test.com`,
    password_hash: workerPwd,
    role: ROLES.WORKER,
    status: ACCOUNT_STATUS.ACTIVE,
    is_active: true,
    token_version: 1,
    wage_mode: 'per_piece',
    wage_rate: 45,
  }).returning('id');
  const resolvedWorker1Id = typeof worker1Id === 'object' ? worker1Id.id : worker1Id;
  const worker1Token = generateToken({
    id: resolvedWorker1Id,
    email: `crocheter_up_${timestamp}@test.com`,
    role: ROLES.WORKER,
    tenant_id: tenantId,
    token_version: 1,
  });

  // 4. Worker 2 (unassigned)
  const [worker2Id] = await db('users').insert({
    tenant_id: tenantId,
    name: 'Crocheter Unassigned Worker',
    email: `crocheter_un_${timestamp}@test.com`,
    password_hash: workerPwd,
    role: ROLES.WORKER,
    status: ACCOUNT_STATUS.ACTIVE,
    is_active: true,
    token_version: 1,
  }).returning('id');
  const resolvedWorker2Id = typeof worker2Id === 'object' ? worker2Id.id : worker2Id;
  const worker2Token = generateToken({
    id: resolvedWorker2Id,
    email: `crocheter_un_${timestamp}@test.com`,
    role: ROLES.WORKER,
    tenant_id: tenantId,
    token_version: 1,
  });

  // 5. Production request awarded to worker 1
  const [prId] = await db('production_requests').insert({
    tenant_id: tenantId,
    request_code: `PR-DEL-${timestamp.toString().slice(-4)}`,
    title: 'Testing Proof Uploads',
    quantity: 100,
    unit: 'pieces',
    target_role: 'worker',
    scope_type: 'specific_recipients',
    submission_deadline: new Date(Date.now() + 86400000).toISOString(),
    completion_deadline: new Date(Date.now() + 172800000).toISOString(),
    status: 'accepted',
    awarded_to_type: 'user',
    awarded_to_id: resolvedWorker1Id,
    created_by: resolvedAdminId,
  }).returning('id');
  const resolvedPrId = typeof prId === 'object' ? prId.id : prId;

  console.log('✓ Test fixtures ready.\n');

  // ─── PART 1: TEST WORKER MULTIPART UPLOADS & APPROVAL WORKFLOW ─────────────
  console.log('--- PART 1: WORKER UPLOADS & APPROVAL QUEUE ---');

  // Test 1: Upload media files for proof of work
  const fd1 = new FormData();
  fd1.append('notes', 'Completed first test batch of 25 pieces');
  fd1.append('quantity_completed', '25');
  fd1.append('files', new Blob(['fake gif photo data'], { type: 'image/gif' }), 'sample_crochet.gif');
  fd1.append('files', new Blob(['fake mov video data'], { type: 'video/quicktime' }), 'progress_spin.mov');

  const uploadRes1 = await fetch(`${baseUrl}/api/production-requests/${resolvedPrId}/submissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${worker1Token}` },
    body: fd1,
  });
  const data1 = await uploadRes1.json();

  recordAssert(uploadRes1.status === 201, `Worker successfully uploads batch 1 (HTTP 201). Status: ${uploadRes1.status}`);
  recordAssert(data1.submission_id > 0, 'Returns valid submission_id');
  recordAssert(data1.media_count === 2, 'Records 2 attached media files (.gif and .mov supported)');

  // Test 2: Unlimited uploads - Worker uploads a second batch
  const fd2 = new FormData();
  fd2.append('notes', 'Completed second test batch of 35 pieces with detail shots');
  fd2.append('quantity_completed', '35');
  fd2.append('media', new Blob(['fake png photo data'], { type: 'image/png' }), 'batch2_closeup.png');

  const uploadRes2 = await fetch(`${baseUrl}/api/production-requests/${resolvedPrId}/submissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${worker1Token}` },
    body: fd2,
  });
  const data2 = await uploadRes2.json();

  recordAssert(uploadRes2.status === 201, 'Worker successfully uploads batch 2 unlimited submission (HTTP 201)');
  const sub2Id = data2.submission_id;

  // Test 3: Unassigned worker rejected from uploading
  const fdForbidden = new FormData();
  fdForbidden.append('notes', 'Trying to upload to someone elses job');
  fdForbidden.append('files', new Blob(['fake png'], { type: 'image/png' }), 'unauth.png');

  const unassignedUploadRes = await fetch(`${baseUrl}/api/production-requests/${resolvedPrId}/submissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${worker2Token}` },
    body: fdForbidden,
  });

  recordAssert(unassignedUploadRes.status === 403, 'Unassigned worker upload is blocked with HTTP 403 Forbidden');

  // Test 4: Approvals queue reflects the submissions
  const queueRes = await fetch(`${baseUrl}/api/production-requests/approvals/queue`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const queueData = await queueRes.json();

  recordAssert(queueRes.status === 200, 'Admin fetches approvals queue (HTTP 200)');
  const queueItem = (queueData.queue || []).find((item) => item.id === sub2Id);
  recordAssert(queueItem !== undefined, 'Second batch submission appears in Admin Approvals Queue');
  recordAssert(queueItem.worker_id === resolvedWorker1Id, 'Queue item correctly attributes worker');

  // ─── PART 2: SELF-DELETION (GOOGLE OAUTH & EMAIL/PASSWORD) ──────────────────
  console.log('\n--- PART 2: USER SELF-DELETION ---');

  // Test 5: Google OAuth user (no password) self-deletion without confirmText fails
  const [googleUserId] = await db('users').insert({
    tenant_id: tenantId,
    name: 'Google Self Delete User',
    email: `google_delete_${timestamp}@gmail.com`,
    password_hash: null, // Google OAuth account has null password
    google_id: `g_oauth_${timestamp}`,
    role: ROLES.OWNER,
    status: ACCOUNT_STATUS.ACTIVE,
    is_active: true,
    token_version: 1,
  }).returning('id');
  const resolvedGoogleUserId = typeof googleUserId === 'object' ? googleUserId.id : googleUserId;
  const googleToken = generateToken({
    id: resolvedGoogleUserId,
    email: `google_delete_${timestamp}@gmail.com`,
    role: ROLES.OWNER,
    tenant_id: tenantId,
    token_version: 1,
  });

  const failGoogleDel = await fetch(`${baseUrl}/api/auth/account`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${googleToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  recordAssert(failGoogleDel.status === 400, 'Self-deletion without confirmation returns HTTP 400');

  // Test 6: Google OAuth user self-deletes with confirmText = 'DELETE'
  const successGoogleDel = await fetch(`${baseUrl}/api/auth/account`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${googleToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ confirmText: 'DELETE' }),
  });

  recordAssert(successGoogleDel.status === 200, 'Google OAuth user successfully self-deletes with "DELETE" confirmation (HTTP 200)');
  const googleUserInDb = await db('users').where('id', resolvedGoogleUserId).first();
  recordAssert(googleUserInDb === undefined, 'Google user permanently removed from database');

  // Test 7: Email/password user self-deletion with email confirmation
  const [pwdUserId] = await db('users').insert({
    tenant_id: tenantId,
    name: 'Password User Self Delete',
    email: `pwd_delete_${timestamp}@example.com`,
    password_hash: await bcrypt.hash('secret123', 8),
    role: ROLES.WORKER,
    status: ACCOUNT_STATUS.ACTIVE,
    is_active: true,
    token_version: 1,
  }).returning('id');
  const resolvedPwdUserId = typeof pwdUserId === 'object' ? pwdUserId.id : pwdUserId;
  const pwdUserToken = generateToken({
    id: resolvedPwdUserId,
    email: `pwd_delete_${timestamp}@example.com`,
    role: ROLES.WORKER,
    tenant_id: tenantId,
    token_version: 1,
  });

  // Insert mock orders to verify foreign key preservation
  let testOrderId = `ORD-DEL-${timestamp.toString().slice(-4)}`;
  if (await db.schema.hasTable('orders')) {
    await db('orders').insert({
      tenant_id: tenantId,
      platform: 'amazon',
      external_order_id: testOrderId,
      product_name: 'Handmade Shawl',
      quantity: 1,
      unit_price: 1500,
      order_date: new Date().toISOString().split('T')[0],
      worker_id: resolvedPwdUserId,
      status: 'pending',
    });
  }

  const successPwdDel = await fetch(`${baseUrl}/api/auth/me`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${pwdUserToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ confirmText: `pwd_delete_${timestamp}@example.com` }),
  });

  recordAssert(successPwdDel.status === 200, 'Password user self-deletes via /api/auth/me with email confirmation (HTTP 200)');
  const pwdUserInDb = await db('users').where('id', resolvedPwdUserId).first();
  recordAssert(pwdUserInDb === undefined, 'Password user permanently removed from database');

  // Verify orders preserved with worker_id nullified
  if (await db.schema.hasTable('orders')) {
    const orderRecord = await db('orders').where('external_order_id', testOrderId).first();
    if (orderRecord) {
      recordAssert(orderRecord.worker_id === null, 'Associated order record preserved and worker_id cleanly nullified');
    }
  }

  // ─── PART 3: HIERARCHICAL SUBORDINATE DELETION ───────────────────────────────
  console.log('\n--- PART 3: HIERARCHICAL SUBORDINATE DELETION ---');

  // Test 8: Admin deletes a worker
  const adminDelWorkerRes = await fetch(`${baseUrl}/api/workers/${resolvedWorker2Id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  recordAssert(adminDelWorkerRes.status === 200, 'Admin successfully deletes subordinate worker (HTTP 200)');
  const deletedWorkerInDb = await db('users').where('id', resolvedWorker2Id).first();
  recordAssert(deletedWorkerInDb === undefined, 'Worker permanently removed by Admin');

  // Test 9: Vendor creates a child subvendor organization and worker under it
  const createSubvendorRes = await fetch(`${baseUrl}/api/tenants/subvendors`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${vendorToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: `Vendor Child Hub ${timestamp}` }),
  });
  const subvendorData = await createSubvendorRes.json();

  recordAssert(createSubvendorRes.status === 201, 'Vendor creates child subvendor organization (HTTP 201)');
  const childSubvendorId = subvendorData.subvendor.id;

  // Add a worker under this child subvendor
  const [subWorkerId] = await db('users').insert({
    tenant_id: childSubvendorId,
    name: 'Subvendor Crocheter',
    email: `subcrocheter_${timestamp}@hub.com`,
    password_hash: await bcrypt.hash('secret123', 8),
    role: ROLES.WORKER,
    status: ACCOUNT_STATUS.ACTIVE,
    is_active: true,
    token_version: 1,
  }).returning('id');
  const resolvedSubWorkerId = typeof subWorkerId === 'object' ? subWorkerId.id : subWorkerId;

  // Test 10: Vendor deletes worker under their child subvendor
  const vendorDelSubWorkerRes = await fetch(`${baseUrl}/api/workers/${resolvedSubWorkerId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${vendorToken}` },
  });

  recordAssert(vendorDelSubWorkerRes.status === 200, 'Vendor can hierarchically delete worker under child subvendor (HTTP 200)');

  // Test 11: Vendor deletes child subvendor organization
  const vendorDelSubvendorRes = await fetch(`${baseUrl}/api/tenants/subvendors/${childSubvendorId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${vendorToken}` },
  });

  recordAssert(vendorDelSubvendorRes.status === 200, 'Vendor successfully deletes child subvendor organization (HTTP 200)');
  const subvendorInDb = await db('tenants').where('id', childSubvendorId).first();
  recordAssert(subvendorInDb === undefined, 'Subvendor organization permanently removed');

  // Test 12: Worker is FORBIDDEN from deleting any user
  const workerDelRes = await fetch(`${baseUrl}/api/workers/${resolvedAdminId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${worker1Token}` },
  });

  recordAssert(workerDelRes.status === 403, 'Worker attempting to delete another user is rejected with HTTP 403 Forbidden');

  // Test 13: Attempting to delete an Admin or Owner is rejected
  const vendorDelAdminRes = await fetch(`${baseUrl}/api/workers/${resolvedAdminId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${vendorToken}` },
  });

  recordAssert(vendorDelAdminRes.status === 403, 'Vendor cannot delete an Admin (HTTP 403 Forbidden)');

  console.log('\n======================================================');
  console.log(`🎉 ALL ${passed}/${total} UPLOADS & DELETION TESTS PASSED!`);
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
