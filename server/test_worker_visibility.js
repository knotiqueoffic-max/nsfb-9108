/**
 * Test Suite: Worker Visibility & Production Request Post-Award Execution Workflow
 * 
 * Tests and verifies:
 * 1. Admin creates broadcast and specific production requests.
 * 2. Workers across tenants and role aliases ('worker' and 'crocheter') can see broadcast requests.
 * 3. Targeted workers see specifically assigned requests; non-targeted workers do not.
 * 4. Worker submits a confidential quote/bid.
 * 5. Admin awards deal to the worker.
 * 6. Worker accepts the awarded deal.
 * 7. Worker uploads proof of work (photos and videos) unlimited times.
 * 8. Each upload appears in Admin's Production Approval Requests queue.
 * 9. Admin reviews (approves and requests changes) on submissions.
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
  console.log('🚀 Running Worker Visibility & Approval Queue Tests');
  console.log('======================================================\n');

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  const timestamp = Date.now();

  // 1. Setup Admin Org and User
  const [tAdminId] = await db('tenants').insert({
    name: `Visibility Test Org ${timestamp}`,
    slug: `vis-org-${timestamp}`,
    tenant_type: 'business',
    plan_id: 'business',
    status: ACCOUNT_STATUS.ACTIVE,
    subscription_status: 'active',
  }).returning('id');
  const adminTenantId = typeof tAdminId === 'object' ? tAdminId.id : tAdminId;

  const [uAdminId] = await db('users').insert({
    tenant_id: adminTenantId,
    name: 'Admin Boss',
    email: `admin-vis-${timestamp}@test.com`,
    password_hash: 'hash',
    role: ROLES.ADMIN,
    status: ACCOUNT_STATUS.ACTIVE,
    is_active: true,
    token_version: 1,
  }).returning('id');
  const adminUserId = typeof uAdminId === 'object' ? uAdminId.id : uAdminId;
  const adminToken = generateToken({ id: adminUserId, email: `admin-vis-${timestamp}@test.com`, role: ROLES.ADMIN, tenant_id: adminTenantId, token_version: 1 });

  // 2. Setup Worker 1 (Same Tenant, role: 'worker')
  const [uWorker1Id] = await db('users').insert({
    tenant_id: adminTenantId,
    name: 'Same-Tenant Artisan',
    email: `worker1-vis-${timestamp}@test.com`,
    password_hash: 'hash',
    role: 'worker',
    status: ACCOUNT_STATUS.ACTIVE,
    is_active: true,
    token_version: 1,
  }).returning('id');
  const worker1Id = typeof uWorker1Id === 'object' ? uWorker1Id.id : uWorker1Id;
  const worker1Token = generateToken({ id: worker1Id, email: `worker1-vis-${timestamp}@test.com`, role: 'worker', tenant_id: adminTenantId, token_version: 1 });

  // 3. Setup Worker 2 (Different Tenant, role: 'crocheter')
  const [tWorker2Id] = await db('tenants').insert({
    name: `Crocheter Guild ${timestamp}`,
    slug: `crocheter-guild-${timestamp}`,
    tenant_type: 'business',
    plan_id: 'starter',
    status: ACCOUNT_STATUS.ACTIVE,
    subscription_status: 'active',
  }).returning('id');
  const worker2TenantId = typeof tWorker2Id === 'object' ? tWorker2Id.id : tWorker2Id;

  const [uWorker2Id] = await db('users').insert({
    tenant_id: worker2TenantId,
    name: 'External Crocheter',
    email: `crocheter-vis-${timestamp}@test.com`,
    password_hash: 'hash',
    role: 'crocheter',
    status: ACCOUNT_STATUS.ACTIVE,
    is_active: true,
    token_version: 1,
  }).returning('id');
  const worker2Id = typeof uWorker2Id === 'object' ? uWorker2Id.id : uWorker2Id;
  const worker2Token = generateToken({ id: worker2Id, email: `crocheter-vis-${timestamp}@test.com`, role: 'crocheter', tenant_id: worker2TenantId, token_version: 1 });

  console.log('✓ Test fixtures set up successfully');

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 1: Admin Creates Broadcast Production Request
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\nTest 1: Admin creates broadcast production request for all workers');
  const broadcastDeadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const deliveryDeadline = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const createBroadcastRes = await fetch(`${baseUrl}/api/production-requests`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Broadcast 100 Amigurumi Dolls',
      target_role: 'worker',
      scope_type: 'all_eligible',
      quantity: 100,
      unit: 'pieces',
      target_price: 250,
      submission_deadline: broadcastDeadline,
      completion_deadline: deliveryDeadline,
    }),
  });

  assert.strictEqual(createBroadcastRes.status, 201, 'Broadcast request creation failed');
  const broadcastData = await createBroadcastRes.json();
  const broadcastRequestId = broadcastData.request.id;
  console.log(`  ✓ Broadcast request created (ID: ${broadcastRequestId})`);

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 2: Admin Creates Specific Production Request targeted at Worker 2
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\nTest 2: Admin creates specific production request targeted at Worker 2');
  const createSpecificRes = await fetch(`${baseUrl}/api/production-requests`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Custom 20 Crochet Shawls (Targeted)',
      target_role: 'worker',
      scope_type: 'specific',
      recipient_ids: [worker2Id],
      quantity: 20,
      unit: 'shawls',
      target_price: 1500,
      submission_deadline: broadcastDeadline,
      completion_deadline: deliveryDeadline,
    }),
  });

  assert.strictEqual(createSpecificRes.status, 201, 'Specific request creation failed');
  const specificData = await createSpecificRes.json();
  const specificRequestId = specificData.request.id;
  console.log(`  ✓ Specific request created for Worker 2 (ID: ${specificRequestId})`);

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 3: Worker 1 (same tenant, role 'worker') checks incoming requests
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\nTest 3: Worker 1 views received requests');
  const w1Res = await fetch(`${baseUrl}/api/production-requests?view=received`, {
    headers: { Authorization: `Bearer ${worker1Token}` },
  });
  assert.strictEqual(w1Res.status, 200);
  const w1Data = await w1Res.json();
  const w1ReqIds = (w1Data.requests || []).map((r) => r.id);

  assert.ok(w1ReqIds.includes(broadcastRequestId), 'Worker 1 should see the broadcast request');
  assert.ok(!w1ReqIds.includes(specificRequestId), 'Worker 1 should NOT see specific request targeted at Worker 2');
  console.log('  ✓ Worker 1 can see broadcast request but not targeted request for Worker 2');

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 4: Worker 2 (different tenant, role 'crocheter') checks incoming requests
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\nTest 4: Worker 2 (cross-tenant crocheter) views received requests');
  const w2Res = await fetch(`${baseUrl}/api/production-requests?view=received`, {
    headers: { Authorization: `Bearer ${worker2Token}` },
  });
  assert.strictEqual(w2Res.status, 200);
  const w2Data = await w2Res.json();
  const w2ReqIds = (w2Data.requests || []).map((r) => r.id);

  assert.ok(w2ReqIds.includes(broadcastRequestId), 'Worker 2 should see the broadcast request across tenants');
  assert.ok(w2ReqIds.includes(specificRequestId), 'Worker 2 should see the specific request targeted at them');
  console.log('  ✓ Worker 2 sees BOTH broadcast request and specifically targeted request');

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 5: Worker 2 submits confidential quote/bid on the specific request
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\nTest 5: Worker 2 submits confidential bid');
  const bidRes = await fetch(`${baseUrl}/api/production-requests/${specificRequestId}/bids`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${worker2Token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      proposed_price: 1400,
      quantity: 20,
      estimated_completion_date: deliveryDeadline.split('T')[0],
      notes: 'Can complete with premium hand-spun wool',
    }),
  });

  assert.strictEqual(bidRes.status, 201, 'Bid submission failed');
  const bidData = await bidRes.json();
  const bidId = bidData.bid.id;
  console.log(`  ✓ Worker 2 bid submitted successfully (Bid ID: ${bidId})`);

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 6: Admin awards request to Worker 2
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\nTest 6: Admin awards request to Worker 2');
  const awardRes = await fetch(`${baseUrl}/api/production-requests/${specificRequestId}/award`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bid_id: bidId }),
  });

  assert.strictEqual(awardRes.status, 200, 'Admin award failed');
  const awardData = await awardRes.json();
  assert.strictEqual(awardData.request.status, 'awarded');
  console.log('  ✓ Request awarded to Worker 2 (status -> awarded)');

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 7: Worker 2 accepts the award
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\nTest 7: Worker 2 accepts the award');
  const acceptRes = await fetch(`${baseUrl}/api/production-requests/${specificRequestId}/respond-award`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${worker2Token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'accept' }),
  });

  assert.strictEqual(acceptRes.status, 200, 'Award acceptance failed');
  console.log('  ✓ Worker 2 accepted award (status -> accepted)');

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 8: Worker 2 uploads work submissions multiple times (unlimited)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\nTest 8: Worker 2 uploads work proof multiple times (unlimited uploads)');

  async function uploadProof(files, notes, qty) {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(16).slice(2);
    let bodyBuffer = Buffer.alloc(0);

    for (const f of files) {
      const partHead = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="files"; filename="${f.name}"\r\n` +
        `Content-Type: ${f.type}\r\n\r\n`
      );
      const partFoot = Buffer.from('\r\n');
      bodyBuffer = Buffer.concat([bodyBuffer, partHead, f.content, partFoot]);
    }

    if (notes) {
      bodyBuffer = Buffer.concat([
        bodyBuffer,
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="notes"\r\n\r\n${notes}\r\n`),
      ]);
    }
    if (qty) {
      bodyBuffer = Buffer.concat([
        bodyBuffer,
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="quantity_completed"\r\n\r\n${qty}\r\n`),
      ]);
    }
    bodyBuffer = Buffer.concat([bodyBuffer, Buffer.from(`--${boundary}--\r\n`)]);

    const res = await fetch(`${baseUrl}/api/production-requests/${specificRequestId}/submissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${worker2Token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: bodyBuffer,
    });
    return res;
  }

  // Upload Batch 1: WIP photos
  const upload1 = await uploadProof(
    [
      { name: 'wip_first_batch.jpg', type: 'image/jpeg', content: Buffer.from('photo-bytes-1') },
      { name: 'technique_demo.mp4', type: 'video/mp4', content: Buffer.from('video-bytes-demo') },
    ],
    'Initial 5 shawls bordered and stitched',
    5
  );
  assert.strictEqual(upload1.status, 201, 'Batch 1 upload failed');
  const sub1Data = await upload1.json();
  const sub1Id = sub1Data.submission_id;
  console.log(`  ✓ Batch 1 uploaded with photo + video (Submission ID: ${sub1Id})`);

  // Upload Batch 2: Progress update
  const upload2 = await uploadProof(
    [
      { name: 'wip_second_batch.png', type: 'image/png', content: Buffer.from('photo-bytes-2') },
    ],
    'Completed next 10 shawls',
    10
  );
  assert.strictEqual(upload2.status, 201, 'Batch 2 upload failed');
  const sub2Data = await upload2.json();
  const sub2Id = sub2Data.submission_id;
  console.log(`  ✓ Batch 2 uploaded as separate approval request (Submission ID: ${sub2Id})`);

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 9: Admin fetches Production Approvals Queue
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\nTest 9: Admin fetches approval queue and verifies submissions');
  const queueRes = await fetch(`${baseUrl}/api/production-requests/approvals/queue`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(queueRes.status, 200);
  const queueData = await queueRes.json();
  const pendingQueue = queueData.queue || [];

  const foundSub1 = pendingQueue.find((s) => s.id === sub1Id);
  const foundSub2 = pendingQueue.find((s) => s.id === sub2Id);

  assert.ok(foundSub1, 'Submission 1 must appear in Admin approval queue');
  assert.ok(foundSub2, 'Submission 2 must appear in Admin approval queue');
  assert.strictEqual(foundSub1.media.length, 2, 'Submission 1 should have 2 media files');
  assert.strictEqual(foundSub2.media.length, 1, 'Submission 2 should have 1 media file');
  console.log(`  ✓ Admin approval queue contains both worker submissions with media`);

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 10: Admin Reviews Submissions (Approve Batch 1, Request Changes on Batch 2)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\nTest 10: Admin reviews submissions');
  const review1Res = await fetch(`${baseUrl}/api/production-requests/${specificRequestId}/submissions/${sub1Id}/review`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      status: 'approved',
      reviewer_notes: 'Stitching and tension are pristine. Approved!',
    }),
  });
  assert.strictEqual(review1Res.status, 200);
  console.log('  ✓ Admin approved Submission 1');

  const review2Res = await fetch(`${baseUrl}/api/production-requests/${specificRequestId}/submissions/${sub2Id}/review`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      status: 'rejected',
      reviewer_notes: 'Please check edge tassels on 2 of the shawls before final pressing.',
    }),
  });
  assert.strictEqual(review2Res.status, 200);
  console.log('  ✓ Admin requested changes on Submission 2');

  // Verify cleared queue
  const queueVerifyRes = await fetch(`${baseUrl}/api/production-requests/approvals/queue`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const queueVerifyData = await queueVerifyRes.json();
  const remainingPending = (queueVerifyData.queue || []).filter(
    (s) => s.id === sub1Id || s.id === sub2Id
  );
  assert.strictEqual(remainingPending.length, 0, 'Reviewed submissions must be cleared from pending queue');
  console.log('  ✓ Reviewed submissions cleanly cleared from pending queue');

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 11: Worker checks submission history to see review decisions & notes
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\nTest 11: Worker views submission history and admin review notes');
  const histRes = await fetch(`${baseUrl}/api/production-requests/${specificRequestId}/submissions`, {
    headers: { Authorization: `Bearer ${worker2Token}` },
  });
  assert.strictEqual(histRes.status, 200);
  const histData = await histRes.json();
  const subs = histData.submissions || [];

  const h1 = subs.find((s) => s.id === sub1Id);
  const h2 = subs.find((s) => s.id === sub2Id);

  assert.strictEqual(h1.status, 'approved');
  assert.strictEqual(h2.status, 'rejected');
  assert.ok(h2.reviewer_notes.includes('edge tassels'));
  console.log('  ✓ Worker sees review status and Admin notes in real-time');

  console.log('\n======================================================');
  console.log('🎉 ALL 11 WORKER VISIBILITY & EXECUTION TESTS PASSED!');
  console.log('======================================================\n');

  server.close();
  process.exit(0);
}

runTests().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  if (server) server.close();
  process.exit(1);
});
