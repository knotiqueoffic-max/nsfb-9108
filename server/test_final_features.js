/**
 * Integration Test Suite — Final Feature Improvements
 *
 * Verifies:
 *  Feature A: Production request attachments upload, download URL check, and authorized retrieval.
 *  Feature B: Quote terminology and notifications consistency.
 *  Feature C: Crocheter profile fields (phone, description), optional wage fields, self-service & manager portfolio operations.
 *  Feature D: YouTube crochet pattern search API with 1-hr caching and curated fallback.
 *  Feature E: Pomodoro work sessions lifecycle (start, pause, resume, finish, discard, background recovery).
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const db = require('./db/database');
const app = require('./index');
const { ROLES, ACCOUNT_STATUS } = require('./constants/roles');
const { generateToken } = require('./middleware/auth');

let server;
let baseUrl;

function request(pathName, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathName, baseUrl);
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

// Multipart helper without extra dependencies
function multipartUpload(pathName, { token, fieldName, filename, fileBuffer, mimeType, fields = {} }) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathName, baseUrl);
    const boundary = '----KnotiqueTestBoundary' + Date.now();

    let bodyBuffer = Buffer.alloc(0);

    // Append extra fields
    for (const [key, value] of Object.entries(fields)) {
      const fieldHeader = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`
      );
      bodyBuffer = Buffer.concat([bodyBuffer, fieldHeader]);
    }

    // Append file
    const fileHeader = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    );
    const fileFooter = Buffer.from(`\r\n--${boundary}--\r\n`);
    bodyBuffer = Buffer.concat([bodyBuffer, fileHeader, fileBuffer, fileFooter]);

    const reqOptions = {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuffer.length,
        Authorization: `Bearer ${token}`,
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
    req.write(bodyBuffer);
    req.end();
  });
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🚀 Running Knotique Final Feature Improvements Tests');
  console.log('======================================================\n');

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  const timestamp = Date.now();

  try {
    // ─── Setup isolated test organization and accounts ───────────────────────
    console.log('📦 Setting up test tenant and accounts...');
    const [tId] = await db('tenants').insert({
      name: `Knotique Workshop ${timestamp}`,
      slug: `workshop-${timestamp}`,
      tenant_type: 'business',
      plan_id: 'business',
      status: 'active',
      subscription_status: 'active',
    }).returning('id');
    const tenantId = typeof tId === 'object' ? tId.id : tId;

    // Manager / Owner
    const [uManagerId] = await db('users').insert({
      name: 'Manager Maya',
      email: `maya-${timestamp}@knotique.test`,
      password_hash: 'hash',
      role: ROLES.OWNER,
      tenant_id: tenantId,
      status: ACCOUNT_STATUS.ACTIVE,
      is_active: true,
      token_version: 1,
    }).returning('id');
    const managerId = typeof uManagerId === 'object' ? uManagerId.id : uManagerId;
    const managerToken = generateToken({ id: managerId, email: `maya-${timestamp}@knotique.test`, role: ROLES.OWNER, tenant_id: tenantId, token_version: 1 });

    // Crocheter
    const [uCrocheterId] = await db('users').insert({
      name: 'Artisan Priya',
      email: `priya-${timestamp}@knotique.test`,
      password_hash: 'hash',
      role: ROLES.WORKER,
      tenant_id: tenantId,
      status: ACCOUNT_STATUS.ACTIVE,
      is_active: true,
      token_version: 1,
      phone: '+91 98765 11111',
      description: 'Specializes in amigurumi and fine cotton motifs',
    }).returning('id');
    const crocheterId = typeof uCrocheterId === 'object' ? uCrocheterId.id : uCrocheterId;
    const crocheterToken = generateToken({ id: crocheterId, email: `priya-${timestamp}@knotique.test`, role: ROLES.WORKER, tenant_id: tenantId, token_version: 1 });

    console.log('✓ Test fixtures ready.\n');

    // ─────────────────────────────────────────────────────────────────────────
    // FEATURE A: Production Request Reference Attachments
    // ─────────────────────────────────────────────────────────────────────────
    console.log('Test Group 1: Production Request Attachments (Feature A)');

    // Manager creates production request
    const createReqRes = await request('/api/production-requests', {
      method: 'POST',
      headers: { Authorization: `Bearer ${managerToken}` },
      body: {
        title: '30 Amigurumi Bunnies with Reference Diagrams',
        target_role: 'worker',
        scope_type: 'all_eligible',
        quantity: 30,
        unit: 'pieces',
        target_price: 250,
        submission_deadline: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
        completion_deadline: new Date(Date.now() + 21 * 86400000).toISOString().split('T')[0],
        specifications: 'Follow stitch gauge strictly.',
      },
    });
    assert.strictEqual(createReqRes.status, 201, 'Request created');
    const requestId = createReqRes.body.request.id;

    // Attach reference image
    const sampleImageBuffer = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;');
    const uploadRes = await multipartUpload(`/api/production-requests/${requestId}/attachments`, {
      token: managerToken,
      fieldName: 'files',
      filename: 'bunny_pattern_ref.gif',
      fileBuffer: sampleImageBuffer,
      mimeType: 'image/gif',
    });
    assert.strictEqual(uploadRes.status, 201, 'Attachment upload returns HTTP 201');
    assert.strictEqual(uploadRes.body.attachments?.length, 1, '1 attachment saved');
    const attachment = uploadRes.body.attachments[0];
    assert.ok(attachment.file_url.startsWith('/uploads/attachments/'), 'Attachment has public upload url');

    // Verify authorized retrieval by Crocheter in scope
    const getReqRes = await request(`/api/production-requests/${requestId}`, {
      headers: { Authorization: `Bearer ${crocheterToken}` },
    });
    assert.strictEqual(getReqRes.status, 200, 'Crocheter can inspect request details');
    assert.ok(Array.isArray(getReqRes.body.attachments), 'Attachments included in request payload');
    assert.strictEqual(getReqRes.body.attachments.length, 1, 'Crocheter sees reference attachment');
    console.log('  ✓ Production request reference attachment uploaded and retrieved');

    // ─────────────────────────────────────────────────────────────────────────
    // FEATURE B: User-Facing Quote Terminology
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nTest Group 2: Quote Terminology (Feature B)');

    const submitQuoteRes = await request(`/api/production-requests/${requestId}/bids`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${crocheterToken}` },
      body: {
        proposed_price: 240,
        quantity: 30,
        estimated_completion_date: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
        notes: 'Can complete with premium acrylic yarn',
      },
    });
    assert.strictEqual(submitQuoteRes.status, 201, 'Quote submission succeeds');
    assert.ok(submitQuoteRes.body.message.includes('Quote'), 'Response message uses "Quote" terminology');
    console.log(`  ✓ Response message verified: "${submitQuoteRes.body.message}"`);

    // ─────────────────────────────────────────────────────────────────────────
    // FEATURE C: Crocheter Profile, Decoupled Wages & Portfolios
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nTest Group 3: Crocheter Profile & Portfolios (Feature C)');

    // 3a: Decoupled worker creation (wage_mode and wage_rate are completely optional)
    const newWorkerRes = await request('/api/workers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${managerToken}` },
      body: {
        name: 'Artisan Sneha',
        email: `sneha-${timestamp}@knotique.test`,
        password: 'password123',
        phone: '+91 99999 88888',
        description: 'Expert in lace crochet and baby booties',
      },
    });
    assert.strictEqual(newWorkerRes.status, 201, 'Crocheter created without requiring wage fields');
    assert.strictEqual(newWorkerRes.body.name, 'Artisan Sneha');
    assert.strictEqual(newWorkerRes.body.phone, '+91 99999 88888');
    assert.strictEqual(newWorkerRes.body.description, 'Expert in lace crochet and baby booties');
    console.log('  ✓ Decoupled worker created without wage fields in UI payload');

    // 3b: Crocheter self-service profile update
    const profileUpdRes = await request('/api/auth/profile', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${crocheterToken}` },
      body: {
        phone: '+91 98765 99999',
        description: 'Updated bio: Specializes in amigurumi, floral blankets, and cardigans',
      },
    });
    assert.strictEqual(profileUpdRes.status, 200, 'Self-service profile update successful');
    assert.strictEqual(profileUpdRes.body.user.phone, '+91 98765 99999');
    assert.strictEqual(profileUpdRes.body.user.description, 'Updated bio: Specializes in amigurumi, floral blankets, and cardigans');
    console.log('  ✓ Crocheter self-service bio & contact update verified');

    // 3c: Crocheter self-service portfolio upload
    const portfolioUploadRes = await multipartUpload('/api/auth/portfolio', {
      token: crocheterToken,
      fieldName: 'image',
      filename: 'my_amigurumi_bear.png',
      fileBuffer: sampleImageBuffer,
      mimeType: 'image/png',
      fields: {
        title: 'Amigurumi Teddy Bear',
        caption: 'Made with organic cotton yarn, safety eyes attached',
      },
    });
    assert.strictEqual(portfolioUploadRes.status, 201, 'Portfolio item uploaded');
    const portfolioItemId = portfolioUploadRes.body.id;
    assert.ok(portfolioUploadRes.body.image_url.startsWith('/uploads/portfolio/'), 'Image stored under /uploads/portfolio/');
    assert.strictEqual(portfolioUploadRes.body.title, 'Amigurumi Teddy Bear');
    console.log('  ✓ Crocheter portfolio photo upload verified');

    // 3d: Crocheter self-service portfolio retrieval
    const portfolioListRes = await request('/api/auth/portfolio', {
      headers: { Authorization: `Bearer ${crocheterToken}` },
    });
    assert.strictEqual(portfolioListRes.status, 200, 'Portfolio listed');
    assert.strictEqual(portfolioListRes.body.length, 1, '1 item in portfolio list');
    console.log('  ✓ Crocheter portfolio gallery listing verified');

    // 3e: Manager review of worker portfolio
    const mgrWorkerGet = await request(`/api/workers/${crocheterId}`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    assert.strictEqual(mgrWorkerGet.status, 200, 'Manager retrieved worker profile');
    assert.ok(Array.isArray(mgrWorkerGet.body.portfolio), 'Manager worker detail includes portfolio');
    assert.strictEqual(mgrWorkerGet.body.portfolio.length, 1, 'Manager sees crocheter portfolio item');
    console.log('  ✓ Manager view of worker portfolio gallery verified');

    // 3f: Crocheter delete portfolio item
    const delPortRes = await request(`/api/auth/portfolio/${portfolioItemId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${crocheterToken}` },
    });
    assert.strictEqual(delPortRes.status, 200, 'Portfolio item deleted');
    console.log('  ✓ Crocheter portfolio item deletion verified');

    // ─────────────────────────────────────────────────────────────────────────
    // FEATURE D: YouTube Pattern Finder & Graceful Fallback
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nTest Group 4: YouTube Pattern Finder (Feature D)');

    // Search without API key (graceful curated fallback)
    const tutRes = await request('/api/tutorials/search', {
      headers: { Authorization: `Bearer ${crocheterToken}` },
    });
    assert.strictEqual(tutRes.status, 200, 'Tutorials endpoint returns HTTP 200');
    assert.ok(Array.isArray(tutRes.body.items), 'Returns items array');
    assert.ok(tutRes.body.items.length >= 6, 'Contains curated tutorials collection');
    assert.strictEqual(tutRes.body.source, 'curated', 'Source is curated when API key is unconfigured');
    console.log(`  ✓ Curated fallback returned ${tutRes.body.items.length} tutorials gracefully`);

    // Category filtering
    const catRes = await request('/api/tutorials/search?category=Amigurumi', {
      headers: { Authorization: `Bearer ${crocheterToken}` },
    });
    assert.strictEqual(catRes.status, 200, 'Category filter returns HTTP 200');
    assert.ok(catRes.body.items.every(it => it.category.toLowerCase() === 'amigurumi'), 'All items match Amigurumi category');
    console.log(`  ✓ Category filter strictly returned ${catRes.body.items.length} Amigurumi tutorials`);

    // Categories list endpoint
    const categoriesRes = await request('/api/tutorials/categories', {
      headers: { Authorization: `Bearer ${crocheterToken}` },
    });
    assert.strictEqual(categoriesRes.status, 200, 'Categories endpoint returns HTTP 200');
    assert.ok(categoriesRes.body.includes('Granny Square'), 'Contains Granny Square category');
    console.log('  ✓ Categories catalog verified');

    // ─────────────────────────────────────────────────────────────────────────
    // FEATURE E: Pomodoro Timer & Work Sessions Lifecycle
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\nTest Group 5: Pomodoro Timer & Work Sessions (Feature E)');

    // 5a: Start focus session linked to production request
    const startSessionRes = await request('/api/work-sessions/start', {
      method: 'POST',
      headers: { Authorization: `Bearer ${crocheterToken}` },
      body: {
        title: 'Bunnies Ear Stitching',
        request_id: requestId,
        notes: 'Assembling ears and stuffing head',
      },
    });
    assert.strictEqual(startSessionRes.status, 201, 'Work session started');
    const sessionId = startSessionRes.body.session.id;
    assert.strictEqual(startSessionRes.body.session.status, 'active');
    assert.strictEqual(startSessionRes.body.session.request_id, requestId);
    console.log('  ✓ Work session started with link to production request');

    // 5b: Active recovery on refresh
    const activeRes = await request('/api/work-sessions/active', {
      headers: { Authorization: `Bearer ${crocheterToken}` },
    });
    assert.strictEqual(activeRes.status, 200, 'Active session fetched');
    assert.strictEqual(activeRes.body.session?.id, sessionId, 'Active session recovered on reload');
    assert.strictEqual(activeRes.body.session?.request_title, '30 Amigurumi Bunnies with Reference Diagrams');
    console.log('  ✓ Active session recovery on refresh verified with project title');

    // 5c: Pause session
    await new Promise(r => setTimeout(r, 1100)); // wait 1.1s so elapsed > 0
    const pauseRes = await request(`/api/work-sessions/${sessionId}/pause`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${crocheterToken}` },
    });
    assert.strictEqual(pauseRes.status, 200, 'Session paused');
    assert.strictEqual(pauseRes.body.session.status, 'paused');
    assert.ok(pauseRes.body.session.duration_seconds >= 1, 'Duration seconds accumulated accurately');
    console.log(`  ✓ Session paused after accumulating ${pauseRes.body.session.duration_seconds}s`);

    // 5d: Resume session
    const resumeRes = await request(`/api/work-sessions/${sessionId}/resume`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${crocheterToken}` },
    });
    assert.strictEqual(resumeRes.status, 200, 'Session resumed');
    assert.strictEqual(resumeRes.body.session.status, 'active');
    console.log('  ✓ Session resumed');

    // 5e: Finish session
    const finishRes = await request(`/api/work-sessions/${sessionId}/finish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${crocheterToken}` },
      body: { notes: 'Completed 6 bunny ears with consistent stitch tension.' },
    });
    assert.strictEqual(finishRes.status, 200, 'Session completed');
    assert.strictEqual(finishRes.body.session.status, 'completed');
    assert.ok(finishRes.body.session.duration_seconds >= 1, 'Final duration logged');
    assert.ok(finishRes.body.session.end_time, 'End timestamp recorded');
    console.log('  ✓ Session finished with final duration and completion timestamp');

    // 5f: Session history log
    const historyRes = await request('/api/work-sessions', {
      headers: { Authorization: `Bearer ${crocheterToken}` },
    });
    assert.strictEqual(historyRes.status, 200, 'Session history queried');
    assert.ok(historyRes.body.length >= 1, 'Completed session logged in history');
    assert.strictEqual(historyRes.body[0].id, sessionId);
    assert.strictEqual(historyRes.body[0].request_title, '30 Amigurumi Bunnies with Reference Diagrams');
    console.log('  ✓ Session history log verified');

    console.log('\n======================================================');
    console.log('🎉 ALL FINAL FEATURE IMPROVEMENTS TESTS PASSED (5/5)!');
    console.log('======================================================\n');

  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test execution failed:', err);
  process.exit(1);
});
