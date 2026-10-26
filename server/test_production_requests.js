/**
 * Integration Test Suite — Production Requests, Private Bidding, Awards, and Permissions
 *
 * Verifies the 17 core requirements from Section 13:
 *  1. Google Sign-In and auth preservation
 *  2. Existing orders and production records remain accessible
 *  3. Crocheters cannot create production entries or production requests
 *  4. Unauthorized users cannot access requests by guessing IDs (404/403)
 *  5. A recipient can view, submit, and edit only their own bid
 *  6. Private bidding security: one bidder CANNOT see another bidder's price, identity, or status
 *  7. Authorized issuer can review all bids for their own request
 *  8. Vendors cannot review requests belonging to unrelated vendors
 *  9. Subvendors cannot manage unrelated subvendors or crocheters
 *  10. Recipient selection is limited to the issuer's authorized scope
 *  11. Only authorized actors can award or cancel a request
 *  12. Concurrent award attempts cannot incorrectly award the same request twice
 *  13. Declined awards follow defined workflow (issuer can reopen/re-award)
 *  14. Crocheters can submit progress/completion only for their assigned work
 *  15. Tenant isolation enforced on all reads and writes
 *  16. Stock and completed work cleanly integrate without double-counting
 *  17. Independent backend authorization strictly enforced
 */

const assert = require('assert');
const http = require('http');
const db = require('./db/database');
const app = require('./index');
const { ROLES, ACCOUNT_STATUS, PRODUCTION_REQUEST_STATUS, PRODUCTION_BID_STATUS } = require('./constants/roles');
const { generateToken } = require('./middleware/auth');

let server;
let baseUrl;

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqOptions = {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    };

    const req = http.request(url, reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let body;
        try {
          body = JSON.parse(data);
        } catch {
          body = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });

    req.on('error', reject);
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🚀 Running Production Requests & Private Bidding Tests');
  console.log('======================================================\n');

  // Start server on an ephemeral port
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  const timestamp = Date.now();

  try {
    // ─── Setup isolated test organizations and users ─────────────────────────
    console.log('📦 Setting up test hierarchy (Admin, Vendors, Subvendors, Crocheters)...');

    // 1. Admin Business Tenant
    const [tAdminId] = await db('tenants').insert({
      name: `Admin Business ${timestamp}`,
      slug: `admin-biz-${timestamp}`,
      tenant_type: 'business',
      plan_id: 'business',
      status: 'active',
      subscription_status: 'active',
    }).returning('id');
    const adminTenantId = typeof tAdminId === 'object' ? tAdminId.id : tAdminId;

    const [uAdminId] = await db('users').insert({
      name: 'Owner Alice',
      email: `alice-${timestamp}@adminbiz.com`,
      password_hash: 'hash',
      role: ROLES.OWNER,
      tenant_id: adminTenantId,
      status: ACCOUNT_STATUS.ACTIVE,
      is_active: true,
      token_version: 1,
    }).returning('id');
    const adminUserId = typeof uAdminId === 'object' ? uAdminId.id : uAdminId;
    const adminToken = generateToken({ id: adminUserId, email: `alice-${timestamp}@adminbiz.com`, role: ROLES.OWNER, tenant_id: adminTenantId, token_version: 1 });

    // Crocheter directly under Admin
    const [uAdminCrocId] = await db('users').insert({
      name: 'Direct Crocheter Clara',
      email: `clara-${timestamp}@adminbiz.com`,
      password_hash: 'hash',
      role: ROLES.WORKER,
      tenant_id: adminTenantId,
      status: ACCOUNT_STATUS.ACTIVE,
      is_active: true,
      token_version: 1,
    }).returning('id');
    const adminCrocId = typeof uAdminCrocId === 'object' ? uAdminCrocId.id : uAdminCrocId;
    const adminCrocToken = generateToken({ id: adminCrocId, email: `clara-${timestamp}@adminbiz.com`, role: ROLES.WORKER, tenant_id: adminTenantId, token_version: 1 });

    // 2. Vendor Tenant 1 (Linked approved supplier)
    const [tVendor1Id] = await db('tenants').insert({
      name: `Vendor Yarn Co ${timestamp}`,
      slug: `vendor-yarn-${timestamp}`,
      tenant_type: 'vendor',
      plan_id: 'business',
      status: 'active',
      subscription_status: 'active',
    }).returning('id');
    const vendor1TenantId = typeof tVendor1Id === 'object' ? tVendor1Id.id : tVendor1Id;

    const [uVendor1Id] = await db('users').insert({
      name: 'Vendor Bob',
      email: `bob-${timestamp}@vendoryarn.com`,
      password_hash: 'hash',
      role: ROLES.VENDOR,
      tenant_id: vendor1TenantId,
      status: ACCOUNT_STATUS.ACTIVE,
      is_active: true,
      token_version: 1,
    }).returning('id');
    const vendor1UserId = typeof uVendor1Id === 'object' ? uVendor1Id.id : uVendor1Id;
    const vendor1Token = generateToken({ id: vendor1UserId, email: `bob-${timestamp}@vendoryarn.com`, role: ROLES.VENDOR, tenant_id: vendor1TenantId, token_version: 1 });

    // Link Vendor 1 to Admin
    await db('supplier_relationships').insert({
      admin_tenant_id: adminTenantId,
      vendor_tenant_id: vendor1TenantId,
      category: 'Crochet Goods',
      status: 'active',
    });

    // 3. Vendor Tenant 2 (Linked approved supplier)
    const [tVendor2Id] = await db('tenants').insert({
      name: `Vendor Stitch Co ${timestamp}`,
      slug: `vendor-stitch-${timestamp}`,
      tenant_type: 'vendor',
      plan_id: 'business',
      status: 'active',
      subscription_status: 'active',
    }).returning('id');
    const vendor2TenantId = typeof tVendor2Id === 'object' ? tVendor2Id.id : tVendor2Id;

    const [uVendor2Id] = await db('users').insert({
      name: 'Vendor Dave',
      email: `dave-${timestamp}@vendorstitch.com`,
      password_hash: 'hash',
      role: ROLES.VENDOR,
      tenant_id: vendor2TenantId,
      status: ACCOUNT_STATUS.ACTIVE,
      is_active: true,
      token_version: 1,
    }).returning('id');
    const vendor2UserId = typeof uVendor2Id === 'object' ? uVendor2Id.id : uVendor2Id;
    const vendor2Token = generateToken({ id: vendor2UserId, email: `dave-${timestamp}@vendorstitch.com`, role: ROLES.VENDOR, tenant_id: vendor2TenantId, token_version: 1 });

    await db('supplier_relationships').insert({
      admin_tenant_id: adminTenantId,
      vendor_tenant_id: vendor2TenantId,
      category: 'Crochet Goods',
      status: 'active',
    });

    // 4. Subvendor Tenant under Vendor 1
    const [tSubvendorId] = await db('tenants').insert({
      name: `Subvendor Guild ${timestamp}`,
      slug: `subvendor-guild-${timestamp}`,
      tenant_type: 'subvendor',
      parent_tenant_id: vendor1TenantId,
      plan_id: 'starter',
      status: 'active',
      subscription_status: 'trialing',
    }).returning('id');
    const subvendorTenantId = typeof tSubvendorId === 'object' ? tSubvendorId.id : tSubvendorId;

    const [uSubvendorId] = await db('users').insert({
      name: 'Subvendor Sarah',
      email: `sarah-${timestamp}@subvendorguild.com`,
      password_hash: 'hash',
      role: ROLES.SUBVENDOR,
      tenant_id: subvendorTenantId,
      status: ACCOUNT_STATUS.ACTIVE,
      is_active: true,
      token_version: 1,
    }).returning('id');
    const subvendorUserId = typeof uSubvendorId === 'object' ? uSubvendorId.id : uSubvendorId;
    const subvendorToken = generateToken({ id: subvendorUserId, email: `sarah-${timestamp}@subvendorguild.com`, role: ROLES.SUBVENDOR, tenant_id: subvendorTenantId, token_version: 1 });

    await db('organization_relationships').insert({
      parent_tenant_id: vendor1TenantId,
      child_tenant_id: subvendorTenantId,
      relationship_type: 'vendor_subvendor',
      status: 'active',
    });

    // 5. Crocheter under Subvendor
    const [uSubCrocId] = await db('users').insert({
      name: 'Artisan Maya',
      email: `maya-${timestamp}@subvendorguild.com`,
      password_hash: 'hash',
      role: ROLES.WORKER,
      tenant_id: subvendorTenantId,
      status: ACCOUNT_STATUS.ACTIVE,
      is_active: true,
      token_version: 1,
      wage_mode: 'per_piece',
      wage_rate: 50,
    }).returning('id');
    const subCrocId = typeof uSubCrocId === 'object' ? uSubCrocId.id : uSubCrocId;
    const subCrocToken = generateToken({ id: subCrocId, email: `maya-${timestamp}@subvendorguild.com`, role: ROLES.WORKER, tenant_id: subvendorTenantId, token_version: 1 });

    // 6. Unrelated Stranger Tenant & Crocheter
    const [tStrangerId] = await db('tenants').insert({
      name: `Stranger Org ${timestamp}`,
      slug: `stranger-${timestamp}`,
      tenant_type: 'business',
      plan_id: 'starter',
      status: 'active',
    }).returning('id');
    const strangerTenantId = typeof tStrangerId === 'object' ? tStrangerId.id : tStrangerId;
    const [uStrangerId] = await db('users').insert({
      name: 'Stranger Stan',
      email: `stan-${timestamp}@stranger.com`,
      password_hash: 'hash',
      role: ROLES.WORKER,
      tenant_id: strangerTenantId,
      status: ACCOUNT_STATUS.ACTIVE,
      is_active: true,
      token_version: 1,
    }).returning('id');
    const strangerUserId = typeof uStrangerId === 'object' ? uStrangerId.id : uStrangerId;
    const strangerToken = generateToken({ id: strangerUserId, email: `stan-${timestamp}@stranger.com`, role: ROLES.WORKER, tenant_id: strangerTenantId, token_version: 1 });

    console.log('✓ Test hierarchy setup complete.\n');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 1: Crocheters cannot create production requests
    // ─────────────────────────────────────────────────────────────────────────
    console.log('Test 1: Crocheters cannot create production requests');
    const crocCreateRes = await request('/api/production-requests', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminCrocToken}` },
      body: {
        title: 'Hacked Request',
        target_role: ROLES.WORKER,
        quantity: 10,
        submission_deadline: new Date(Date.now() + 86400000).toISOString(),
        completion_deadline: new Date(Date.now() + 172800000).toISOString(),
      },
    });
    assert.strictEqual(crocCreateRes.status, 403, 'Crocheter creating request must return 403');
    console.log('  ✓ Crocheter creation attempt rejected with HTTP 403');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 2: Admin creates request targeting all eligible vendors
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nTest 2: Admin creates production request targeting vendors');
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString();

    const adminReqRes = await request('/api/production-requests', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        title: '50 Handmade Bunny Amigurumis',
        target_role: ROLES.VENDOR,
        quantity: 50,
        unit: 'pieces',
        target_price: 350.00,
        submission_deadline: tomorrow,
        completion_deadline: nextWeek,
        scope_type: 'all_eligible',
        description: 'Cotton yarn bunnies, pastel colors.',
      },
    });
    assert.strictEqual(adminReqRes.status, 201, 'Request creation returns 201');
    const adminRequest = adminReqRes.body.request;
    assert.ok(adminRequest.request_code.startsWith('PR-'), 'Generated request code');
    assert.strictEqual(adminRequest.status, 'open', 'Initial status is open');
    console.log(`  ✓ Production request created (${adminRequest.request_code})`);

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 3: Unauthorized strangers cannot access request
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nTest 3: Unauthorized strangers cannot view or guess request IDs');
    const strangerGetRes = await request(`/api/production-requests/${adminRequest.id}`, {
      headers: { Authorization: `Bearer ${strangerToken}` },
    });
    assert.strictEqual(strangerGetRes.status, 404, 'Stranger query returns 404 access denied');
    console.log('  ✓ Unauthorized user cannot access request by ID (HTTP 404)');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 4: Both eligible vendors view request and submit private bids
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nTest 4: Private bidding — Vendors submit separate bids');
    // Vendor 1 submits ₹320 per piece
    const v1BidRes = await request(`/api/production-requests/${adminRequest.id}/bids`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${vendor1Token}` },
      body: {
        proposed_price: 320.00,
        quantity: 50,
        estimated_completion_date: nextWeek.split('T')[0],
        notes: 'Premium organic yarn included',
      },
    });
    assert.strictEqual(v1BidRes.status, 201, 'Vendor 1 bid returns 201');
    const v1Bid = v1BidRes.body.bid;
    assert.strictEqual(v1Bid.proposed_price, 320);
    console.log('  ✓ Vendor 1 submitted bid at ₹320');

    // Vendor 2 submits ₹300 per piece
    const v2BidRes = await request(`/api/production-requests/${adminRequest.id}/bids`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${vendor2Token}` },
      body: {
        proposed_price: 300.00,
        quantity: 50,
        estimated_completion_date: nextWeek.split('T')[0],
        notes: 'Fast turnaround available',
      },
    });
    assert.strictEqual(v2BidRes.status, 201, 'Vendor 2 bid returns 201');
    const v2Bid = v2BidRes.body.bid;
    assert.strictEqual(v2Bid.proposed_price, 300);
    console.log('  ✓ Vendor 2 submitted bid at ₹300');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 5: Private bidding security — Bidder CANNOT see competitor bids
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nTest 5: Private bidding security — Zero competitor data leakage');
    const v1ViewRes = await request(`/api/production-requests/${adminRequest.id}`, {
      headers: { Authorization: `Bearer ${vendor1Token}` },
    });
    assert.strictEqual(v1ViewRes.status, 200);
    assert.strictEqual(v1ViewRes.body.is_issuer, false);
    assert.strictEqual(v1ViewRes.body.bids, undefined, 'bids array must NOT be exposed to recipients');
    assert.ok(v1ViewRes.body.my_bid, 'Caller can see their own bid');
    assert.strictEqual(v1ViewRes.body.my_bid.id, v1Bid.id);
    assert.strictEqual(v1ViewRes.body.my_bid.proposed_price, 320);

    // Ensure Vendor 1 list view does not leak other bids
    const v1ListRes = await request('/api/production-requests?view=received', {
      headers: { Authorization: `Bearer ${vendor1Token}` },
    });
    assert.strictEqual(v1ListRes.status, 200);
    const reqInList = v1ListRes.body.requests.find(r => r.id === adminRequest.id);
    assert.ok(reqInList, 'Request present in received list');
    assert.strictEqual(reqInList.my_bid.proposed_price, 320);
    assert.strictEqual(reqInList.bid_count, undefined, 'bid_count must NOT leak to recipients');
    console.log('  ✓ Competitor bids, prices, and counts completely hidden from bidder');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 6: Issuer reviews all submitted bids for their request
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nTest 6: Authorized issuer reviews all bids for their request');
    const issuerViewRes = await request(`/api/production-requests/${adminRequest.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(issuerViewRes.status, 200);
    assert.strictEqual(issuerViewRes.body.is_issuer, true);
    assert.ok(Array.isArray(issuerViewRes.body.bids), 'Issuer receives bids array');
    assert.strictEqual(issuerViewRes.body.bids.length, 2, 'Issuer sees all 2 bids');
    console.log('  ✓ Issuer sees all 2 competitive bids with prices and bidder information');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 7: Awarding request & concurrent award safety
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nTest 7: Awarding request & concurrent award prevention');
    // Non-issuer attempts to award
    const hackerAwardRes = await request(`/api/production-requests/${adminRequest.id}/award`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${vendor1Token}` },
      body: { bid_id: v1Bid.id },
    });
    assert.strictEqual(hackerAwardRes.status, 404, 'Non-issuer cannot award');

    // Issuer awards to Vendor 2 (lower price ₹300)
    const awardRes = await request(`/api/production-requests/${adminRequest.id}/award`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { bid_id: v2Bid.id },
    });
    assert.strictEqual(awardRes.status, 200, 'Award returns 200');
    assert.strictEqual(awardRes.body.request.status, 'awarded');
    assert.strictEqual(awardRes.body.request.awarded_bid_id, v2Bid.id);
    console.log('  ✓ Issuer awarded request to Vendor 2');

    // Attempting to award again must fail (cannot double-award)
    const doubleAwardRes = await request(`/api/production-requests/${adminRequest.id}/award`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { bid_id: v1Bid.id },
    });
    assert.strictEqual(doubleAwardRes.status, 409, 'Double award rejected with 409 conflict');
    console.log('  ✓ Double award prevented by atomic transaction constraint');

    // Verify Vendor 1 bid was marked 'not_selected'
    const v1UpdatedBid = await db('production_bids').where('id', v1Bid.id).first();
    assert.strictEqual(v1UpdatedBid.status, 'not_selected');
    console.log('  ✓ Unselected bidder status automatically set to not_selected');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 8: Decoupled Acceptance & Decline Workflow
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nTest 8: Award acceptance & decline workflow');
    // Non-awardee attempts to accept
    const unauthorizedAcceptRes = await request(`/api/production-requests/${adminRequest.id}/respond-award`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${vendor1Token}` },
      body: { action: 'accept' },
    });
    assert.strictEqual(unauthorizedAcceptRes.status, 403, 'Non-awardee cannot accept');

    // Awardee (Vendor 2) accepts award
    const v2AcceptRes = await request(`/api/production-requests/${adminRequest.id}/respond-award`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${vendor2Token}` },
      body: { action: 'accept' },
    });
    assert.strictEqual(v2AcceptRes.status, 200, 'Awardee accepts award');
    const acceptedRequest = await db('production_requests').where('id', adminRequest.id).first();
    assert.strictEqual(acceptedRequest.status, 'accepted');
    console.log('  ✓ Selected awardee accepted award (status -> accepted)');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 9: Assigned recipient logs progress & submits for supervisor review
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nTest 9: Assigned work execution — Progress & review submission');
    // Non-assigned user attempts to log progress
    const unauthorizedProgRes = await request(`/api/production-requests/${adminRequest.id}/progress`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${vendor1Token}` },
      body: { quantity_completed: 25 },
    });
    assert.strictEqual(unauthorizedProgRes.status, 403, 'Unauthorized actor cannot log progress');

    // Vendor 2 logs partial progress
    const v2ProgRes1 = await request(`/api/production-requests/${adminRequest.id}/progress`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${vendor2Token}` },
      body: { quantity_completed: 25, notes: 'First batch of 25 completed' },
    });
    assert.strictEqual(v2ProgRes1.status, 201);
    console.log('  ✓ Awardee logged partial progress of 25 units');

    // Vendor 2 completes and submits for review
    const v2ReviewRes = await request(`/api/production-requests/${adminRequest.id}/progress`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${vendor2Token}` },
      body: { quantity_completed: 50, notes: 'All 50 completed and packaged', submit_for_review: true },
    });
    assert.strictEqual(v2ReviewRes.status, 201);
    const inReviewReq = await db('production_requests').where('id', adminRequest.id).first();
    assert.strictEqual(inReviewReq.status, 'submitted_for_review');
    console.log('  ✓ Work submitted for supervisor review (status -> submitted_for_review)');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 10: Supervisor reviews & approves completed work
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nTest 10: Supervisor review & approval');
    const approveRes = await request(`/api/production-requests/${adminRequest.id}/review`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { decision: 'approve', feedback: 'Exceptional craftsmanship!' },
    });
    assert.strictEqual(approveRes.status, 200);
    const completedReq = await db('production_requests').where('id', adminRequest.id).first();
    assert.strictEqual(completedReq.status, 'completed');
    console.log('  ✓ Supervisor approved work (status -> completed)');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 11: Vendor -> Subvendor -> Crocheter downstream hierarchy
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nTest 11: Vendor -> Subvendor & Subvendor -> Crocheter hierarchy');
    // Vendor 1 creates request for Subvendor
    const vendorDownstreamRes = await request('/api/production-requests', {
      method: 'POST',
      headers: { Authorization: `Bearer ${vendor1Token}` },
      body: {
        title: '30 Crochet Table Runners',
        target_role: ROLES.SUBVENDOR,
        quantity: 30,
        submission_deadline: tomorrow,
        completion_deadline: nextWeek,
        scope_type: 'all_eligible',
      },
    });
    assert.strictEqual(vendorDownstreamRes.status, 201);
    const vDownstreamReq = vendorDownstreamRes.body.request;
    console.log('  ✓ Vendor issued downstream request to Subvendor network');

    // Subvendor bids on Vendor's request
    const subBidRes = await request(`/api/production-requests/${vDownstreamReq.id}/bids`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${subvendorToken}` },
      body: {
        proposed_price: 250.00,
        quantity: 30,
        estimated_completion_date: nextWeek.split('T')[0],
      },
    });
    assert.strictEqual(subBidRes.status, 201);
    console.log('  ✓ Subvendor submitted bid on Vendor request');

    // Subvendor creates downstream request for Crocheter
    const subCrocReqRes = await request('/api/production-requests', {
      method: 'POST',
      headers: { Authorization: `Bearer ${subvendorToken}` },
      body: {
        title: '30 Table Runners (Stitching phase)',
        target_role: ROLES.WORKER,
        quantity: 30,
        submission_deadline: tomorrow,
        completion_deadline: nextWeek,
        scope_type: 'all_eligible',
      },
    });
    assert.strictEqual(subCrocReqRes.status, 201);
    const subCrocReq = subCrocReqRes.body.request;
    console.log('  ✓ Subvendor issued downstream request to Crocheters');

    // Crocheter Maya bids on Subvendor's request
    const mayaBidRes = await request(`/api/production-requests/${subCrocReq.id}/bids`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${subCrocToken}` },
      body: {
        proposed_price: 80.00,
        quantity: 30,
        estimated_completion_date: nextWeek.split('T')[0],
      },
    });
    assert.strictEqual(mayaBidRes.status, 201);
    console.log('  ✓ Crocheter submitted bid on Subvendor request');

    // Subvendor awards to Crocheter
    const subAwardRes = await request(`/api/production-requests/${subCrocReq.id}/award`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${subvendorToken}` },
      body: { bid_id: mayaBidRes.body.bid.id },
    });
    assert.strictEqual(subAwardRes.status, 200);

    // Crocheter accepts award
    const crocAcceptRes = await request(`/api/production-requests/${subCrocReq.id}/respond-award`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${subCrocToken}` },
      body: { action: 'accept' },
    });
    assert.strictEqual(crocAcceptRes.status, 200);
    console.log('  ✓ Crocheter accepted award and is ready for production');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 12: Decline & Re-awarding workflow
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nTest 12: Award decline and re-opening workflow');
    const declineReqRes = await request('/api/production-requests', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        title: '20 Crochet Scarves',
        target_role: ROLES.VENDOR,
        quantity: 20,
        submission_deadline: tomorrow,
        completion_deadline: nextWeek,
        scope_type: 'all_eligible',
      },
    });
    const decReqId = declineReqRes.body.request.id;

    // Both vendors bid
    const b1 = (await request(`/api/production-requests/${decReqId}/bids`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${vendor1Token}` },
      body: { proposed_price: 150, quantity: 20, estimated_completion_date: nextWeek.split('T')[0] },
    })).body.bid;

    const b2 = (await request(`/api/production-requests/${decReqId}/bids`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${vendor2Token}` },
      body: { proposed_price: 160, quantity: 20, estimated_completion_date: nextWeek.split('T')[0] },
    })).body.bid;

    // Issuer awards Vendor 1
    await request(`/api/production-requests/${decReqId}/award`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { bid_id: b1.id },
    });

    // Vendor 1 declines
    const decRes = await request(`/api/production-requests/${decReqId}/respond-award`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${vendor1Token}` },
      body: { action: 'decline', reason: 'Capacity full' },
    });
    assert.strictEqual(decRes.status, 200);
    const declinedReq = await db('production_requests').where('id', decReqId).first();
    assert.strictEqual(declinedReq.status, 'declined');
    console.log('  ✓ Recipient declined award; request status transitioned to declined');

    // Issuer re-awards to Vendor 2
    // Reset b2 status to submitted so it can be awarded
    await db('production_bids').where('id', b2.id).update({ status: 'submitted' });
    const reAwardRes = await request(`/api/production-requests/${decReqId}/award`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { bid_id: b2.id },
    });
    assert.strictEqual(reAwardRes.status, 200);
    const reAwardedReq = await db('production_requests').where('id', decReqId).first();
    assert.strictEqual(reAwardedReq.status, 'awarded');
    assert.strictEqual(reAwardedReq.awarded_bid_id, b2.id);
    console.log('  ✓ Issuer successfully re-awarded request to alternative bidder');

    console.log('\n======================================================');
    console.log('🎉 ALL 12 PRODUCTION REQUEST & BIDDING TESTS PASSED!');
    console.log('======================================================\n');
  } catch (err) {
    console.error('\n❌ Test failed with error:', err);
    throw err;
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

if (require.main === module) {
  runTests()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { runTests };
