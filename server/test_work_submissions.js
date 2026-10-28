/**
 * Test Suite: Production Work Submissions & Approval Request Workflow
 * Verifies:
 *  1. Crocheter (awarded worker) can upload work submissions (photos & videos)
 *  2. Crocheter can upload unlimited times, creating separate pending_approval requests
 *  3. Non-awarded worker / stranger is blocked with HTTP 403
 *  4. Competitors cannot view another worker's submissions (HTTP 403)
 *  5. Issuer/Admin can view all submissions and access the approval queue
 *  6. Issuer/Admin can approve or request changes on submissions
 *  7. Crocheter is blocked from self-approving submissions (HTTP 403)
 */

const assert = require('assert');
const http = require('http');
const app = require('./index');
const db = require('./db/database');
const { ROLES, ACCOUNT_STATUS } = require('./constants/roles');
const { generateToken } = require('./middleware/auth');

let server;
let baseUrl;

async function runTests() {
  console.log('\n======================================================');
  console.log('🚀 Running Work Submissions & Approval Workflow Tests');
  console.log('======================================================\n');

  // Start ephemeral server
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  // Setup fixtures
  const timestamp = Date.now();
  const [tAdminId] = await db('tenants').insert({
    name: `Approval Test Org ${timestamp}`,
    slug: `approval-org-${timestamp}`,
    tenant_type: 'business',
    plan_id: 'business',
    status: ACCOUNT_STATUS.ACTIVE,
    subscription_status: 'active',
  }).returning('id');
  const adminTenantId = typeof tAdminId === 'object' ? tAdminId.id : tAdminId;

  const [uAdminId] = await db('users').insert({
    tenant_id: adminTenantId,
    name: 'Admin Issuer',
    email: `admin-sub-${timestamp}@test.com`,
    password_hash: 'hash',
    role: ROLES.ADMIN,
    status: ACCOUNT_STATUS.ACTIVE,
    is_active: true,
    token_version: 1,
  }).returning('id');
  const adminUserId = typeof uAdminId === 'object' ? uAdminId.id : uAdminId;
  const adminToken = generateToken({ id: adminUserId, email: `admin-sub-${timestamp}@test.com`, role: ROLES.ADMIN, tenant_id: adminTenantId, token_version: 1 });

  const [uWorkerId] = await db('users').insert({
    tenant_id: adminTenantId,
    name: 'Awarded Crocheter',
    email: `worker-awarded-${timestamp}@test.com`,
    password_hash: 'hash',
    role: ROLES.WORKER,
    status: ACCOUNT_STATUS.ACTIVE,
    is_active: true,
    token_version: 1,
  }).returning('id');
  const awardedWorkerId = typeof uWorkerId === 'object' ? uWorkerId.id : uWorkerId;
  const awardedWorkerToken = generateToken({ id: awardedWorkerId, email: `worker-awarded-${timestamp}@test.com`, role: ROLES.WORKER, tenant_id: adminTenantId, token_version: 1 });

  const [uOtherId] = await db('users').insert({
    tenant_id: adminTenantId,
    name: 'Other Crocheter',
    email: `worker-other-${timestamp}@test.com`,
    password_hash: 'hash',
    role: ROLES.WORKER,
    status: ACCOUNT_STATUS.ACTIVE,
    is_active: true,
    token_version: 1,
  }).returning('id');
  const otherWorkerId = typeof uOtherId === 'object' ? uOtherId.id : uOtherId;
  const otherWorkerToken = generateToken({ id: otherWorkerId, email: `worker-other-${timestamp}@test.com`, role: ROLES.WORKER, tenant_id: adminTenantId, token_version: 1 });

  // Create awarded & accepted production request
  const [pReqId] = await db('production_requests').insert({
    tenant_id: adminTenantId,
    request_code: `PR-SUB-${timestamp}`,
    created_by: adminUserId,
    target_role: ROLES.WORKER,
    scope_type: 'all_eligible',
    title: 'Crochet Plushies Order',
    quantity: 50,
    unit: 'pieces',
    submission_deadline: new Date(Date.now() + 86400000).toISOString(),
    completion_deadline: new Date(Date.now() + 172800000).toISOString(),
    status: 'accepted',
    awarded_to_type: 'user',
    awarded_to_id: awardedWorkerId,
    awarded_at: db.fn.now(),
    accepted_at: db.fn.now(),
  }).returning('id');
  const prId = typeof pReqId === 'object' ? pReqId.id : pReqId;

  console.log('✓ Test fixtures initialized successfully.');

  // Test 1: Non-awarded worker uploading returns HTTP 403
  console.log('\nTest 1: Non-awarded worker upload rejection');
  const fdForbidden = new FormData();
  fdForbidden.append('files', new Blob(['fake image'], { type: 'image/jpeg' }), 'test1.jpg');
  fdForbidden.append('notes', 'I was not assigned this request');

  const resForbidden = await fetch(`${baseUrl}/api/production-requests/${prId}/submissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${otherWorkerToken}` },
    body: fdForbidden,
  });

  assert.strictEqual(resForbidden.status, 403, 'Unauthorized worker must be rejected with 403');
  console.log('  ✓ Non-assigned worker upload blocked with HTTP 403');

  // Test 2: Awarded worker uploads batch 1 (photos & videos)
  console.log('\nTest 2: Awarded worker uploads initial work submission batch');
  const fd1 = new FormData();
  fd1.append('files', new Blob(['fake photo bytes 1'], { type: 'image/jpeg' }), 'sample_work1.jpg');
  fd1.append('files', new Blob(['fake video bytes 1'], { type: 'video/mp4' }), 'sample_video1.mp4');
  fd1.append('notes', 'Completed first 10 plushies, here is photo & video proof');
  fd1.append('quantity_completed', '10');

  const res1 = await fetch(`${baseUrl}/api/production-requests/${prId}/submissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${awardedWorkerToken}` },
    body: fd1,
  });
  const data1 = await res1.json();

  assert.strictEqual(res1.status, 201, 'Valid submission returns HTTP 201');
  assert.strictEqual(data1.media_count, 2, '2 media files recorded');
  const sub1Id = data1.submission_id;
  assert.ok(sub1Id, 'Submission ID returned');
  console.log('  ✓ Batch 1 uploaded with 2 media files (status: 201 Created)');

  // Test 3: Awarded worker uploads batch 2 (unlimited submissions allowed!)
  console.log('\nTest 3: Awarded worker uploads subsequent work submission batch (unlimited uploads)');
  const fd2 = new FormData();
  fd2.append('files', new Blob(['fake photo bytes 2'], { type: 'image/png' }), 'sample_work2.png');
  fd2.append('notes', 'Batch 2: another 15 pieces ready for inspection');
  fd2.append('quantity_completed', '15');

  const res2 = await fetch(`${baseUrl}/api/production-requests/${prId}/submissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${awardedWorkerToken}` },
    body: fd2,
  });
  const data2 = await res2.json();

  assert.strictEqual(res2.status, 201, 'Second submission returns HTTP 201');
  const sub2Id = data2.submission_id;
  assert.notStrictEqual(sub1Id, sub2Id, 'Creates separate submission record');
  console.log('  ✓ Batch 2 uploaded as separate approval request (status: 201 Created)');

  // Test 4: Competitor/other worker viewing submissions receives HTTP 403
  console.log('\nTest 4: Competitor worker viewing submissions privacy guard');
  const resComp = await fetch(`${baseUrl}/api/production-requests/${prId}/submissions`, {
    headers: { Authorization: `Bearer ${otherWorkerToken}` },
  });

  assert.strictEqual(resComp.status, 403, 'Competitor must be blocked with HTTP 403');
  console.log('  ✓ Competitor blocked from viewing other worker proof of work (HTTP 403)');

  // Test 5: Crocheter viewing their own submissions
  console.log('\nTest 5: Crocheter views their own submission history');
  const resWorkerSubs = await fetch(`${baseUrl}/api/production-requests/${prId}/submissions`, {
    headers: { Authorization: `Bearer ${awardedWorkerToken}` },
  });
  const dataWorkerSubs = await resWorkerSubs.json();

  assert.strictEqual(resWorkerSubs.status, 200, 'Worker can view own submissions');
  assert.strictEqual(dataWorkerSubs.submissions.length, 2, 'Both submission batches returned');
  assert.strictEqual(dataWorkerSubs.submissions[0].media.length > 0, true, 'Attached media included');
  console.log('  ✓ Worker sees complete submission history and attached media');

  // Test 6: Admin approval queue contains pending submissions
  console.log('\nTest 6: Admin production approval queue');
  const resQueue = await fetch(`${baseUrl}/api/production-requests/approvals/queue`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const dataQueue = await resQueue.json();

  assert.strictEqual(resQueue.status, 200, 'Admin can fetch approval queue');
  const queueItem = dataQueue.queue.find((q) => q.id === sub1Id);
  assert.ok(queueItem, 'Submission 1 is present in pending approval queue');
  assert.strictEqual(queueItem.status, 'pending_approval');
  console.log(`  ✓ Admin sees ${dataQueue.queue.length} pending approval request(s) in queue`);

  // Test 7: Crocheter attempting to self-approve submission receives HTTP 403
  console.log('\nTest 7: Self-approval prevention');
  const resSelfApprove = await fetch(`${baseUrl}/api/production-requests/${prId}/submissions/${sub1Id}/review`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${awardedWorkerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'approved', reviewer_notes: 'Self-approved!' }),
  });

  assert.strictEqual(resSelfApprove.status, 403, 'Worker cannot approve their own submission');
  console.log('  ✓ Crocheter self-approval strictly rejected with HTTP 403');

  // Test 8: Admin reviews & approves submission 1
  console.log('\nTest 8: Admin reviews and approves submission 1');
  const resAdminApprove = await fetch(`${baseUrl}/api/production-requests/${prId}/submissions/${sub1Id}/review`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'approved', reviewer_notes: 'Stitching and tension looks flawless. Approved!' }),
  });
  const dataAdminApprove = await resAdminApprove.json();

  assert.strictEqual(resAdminApprove.status, 200, 'Admin approval returns HTTP 200');
  assert.strictEqual(dataAdminApprove.status, 'approved');

  const checkSub1 = await db('production_submissions').where('id', sub1Id).first();
  assert.strictEqual(checkSub1.status, 'approved');
  assert.strictEqual(checkSub1.reviewed_by, adminUserId);
  console.log('  ✓ Admin approved submission 1 with reviewer notes recorded');

  // Test 9: Admin reviews submission 2 and requests changes
  console.log('\nTest 9: Admin requests changes / rejects submission 2');
  const resAdminReject = await fetch(`${baseUrl}/api/production-requests/${prId}/submissions/${sub2Id}/review`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'rejected', reviewer_notes: 'Color shade in video does not match reference palette. Please adjust.' }),
  });
  const dataAdminReject = await resAdminReject.json();

  assert.strictEqual(resAdminReject.status, 200, 'Admin review returns HTTP 200');
  assert.strictEqual(dataAdminReject.status, 'rejected');

  const checkSub2 = await db('production_submissions').where('id', sub2Id).first();
  assert.strictEqual(checkSub2.status, 'rejected');
  assert.strictEqual(checkSub2.reviewed_by, adminUserId);
  console.log('  ✓ Admin rejected submission 2 with change request notes');

  // Test 10: Approval queue after reviews
  console.log('\nTest 10: Verification of updated approval queue');
  const resQueueAfter = await fetch(`${baseUrl}/api/production-requests/approvals/queue`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const dataQueueAfter = await resQueueAfter.json();

  const item1 = dataQueueAfter.queue.find((q) => q.id === sub1Id);
  const item2 = dataQueueAfter.queue.find((q) => q.id === sub2Id);
  assert.strictEqual(item1, undefined, 'Approved submission removed from pending queue');
  assert.strictEqual(item2, undefined, 'Rejected submission removed from pending queue');
  console.log('  ✓ Reviewed submissions correctly cleared from pending approval queue');

  console.log('\n======================================================');
  console.log('🎉 ALL 10 WORK SUBMISSIONS & APPROVAL TESTS PASSED!');
  console.log('======================================================\n');

  server.close();
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Test execution failed:', err);
    if (server) server.close();
    process.exit(1);
  });
