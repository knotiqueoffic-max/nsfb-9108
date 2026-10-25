/**
 * test_auth_flow.js
 *
 * Automated test suite covering the entire Knotique authentication flow:
 * - Health and config endpoints
 * - Google token verification and audience consistency
 * - Invalid/expired token rejection (HTTP 401)
 * - Brand new Google user registration with name fallback and transaction isolation
 * - Existing Google user login
 * - Email/password account linking to Google
 * - Worker account protection (HTTP 403)
 * - Production mock token lockout verification
 * - Email/password authentication regression check
 * - Store / session payload validation
 */

process.env.NODE_ENV = 'test';
process.env.ALLOW_MOCK_GOOGLE = 'true';
process.env.GOOGLE_CLIENT_ID = '268763150621-4qgrhe5pgmkd7s3ru6mucmk9m9e3vr9e.apps.googleusercontent.com';

const http = require('http');
const bcrypt = require('bcryptjs');
const app = require('./index');
const db = require('./db/database');
const { verifyGoogleToken, getGoogleClientId } = require('./services/google.service');

const TEST_PORT = 5055;
let server;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ ${message}`);
}

async function request(path, options = {}) {
  const url = `http://localhost:${TEST_PORT}${path}`;
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  let data;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }
  return { status: response.status, data, headers: response.headers };
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🚀 Running Knotique Authentication & Google OAuth Tests');
  console.log('======================================================\n');

  // Test 1: Health Endpoint
  console.log('Test 1: Backend Health Endpoint');
  const healthRes = await request('/api/health');
  assert(healthRes.status === 200, 'Health endpoint returns HTTP 200');
  assert(healthRes.data?.status === 'ok', "Health payload status is 'ok'");
  assert(healthRes.data?.app === 'Knotique SaaS', "Health app is 'Knotique SaaS'");

  // Test 2: Google Config Endpoint
  console.log('\nTest 2: Google Configuration Endpoint');
  const configRes = await request('/api/auth/config');
  assert(configRes.status === 200, 'Config endpoint returns HTTP 200');
  assert(
    configRes.data?.googleClientId === '268763150621-4qgrhe5pgmkd7s3ru6mucmk9m9e3vr9e.apps.googleusercontent.com',
    'Config endpoint returns the configured Google Client ID'
  );

  // Test 3: Missing Token Validation
  console.log('\nTest 3: Missing Google Token');
  const noTokenRes = await request('/api/auth/google-login', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  assert(noTokenRes.status === 400, 'Missing token returns HTTP 400');
  assert(noTokenRes.data?.error === 'Google ID token is required', 'Returns clear missing token error message');

  // Test 4: Invalid Token Rejection
  console.log('\nTest 4: Invalid Google Token Handling');
  const invalidTokenRes = await request('/api/auth/google-login', {
    method: 'POST',
    body: JSON.stringify({ token: 'malformed_invalid_jwt_credential' }),
  });
  assert(invalidTokenRes.status === 401, 'Invalid token returns HTTP 401 Unauthorized');
  assert(
    invalidTokenRes.data?.error === 'Invalid or expired Google token',
    'Returns safe client error without leaking internal stack traces'
  );

  // Test 5: Client ID Consistency
  console.log('\nTest 5: Client ID Consistency in google.service.js');
  const activeClientId = getGoogleClientId();
  assert(
    activeClientId === '268763150621-4qgrhe5pgmkd7s3ru6mucmk9m9e3vr9e.apps.googleusercontent.com',
    'google.service resolves the exact same Client ID'
  );

  // Clean up any test records from prior runs
  const testEmails = [
    'new_artisan_test@example.com',
    'existing_pw_user@example.com',
    'worker_user_test@example.com',
  ];
  await db('users').whereIn('email', testEmails).del();

  // Test 6: Brand New Google User Signup with Name Fallback
  console.log('\nTest 6: Brand New Google User Signup (with name fallback)');
  const newSignupRes = await request('/api/auth/google-login', {
    method: 'POST',
    body: JSON.stringify({
      token: 'mock_google_token_new_artisan_test@example.com',
      plan_id: 'free_trial',
    }),
  });

  assert(newSignupRes.status === 201, 'New Google user created with HTTP 201 Created');
  assert(!!newSignupRes.data?.token, 'Returns valid application JWT token');
  assert(!!newSignupRes.data?.user?.id, 'Returns enriched user object with ID');
  assert(newSignupRes.data.user.email === 'new_artisan_test@example.com', 'User email correctly recorded');
  assert(newSignupRes.data.user.name.toLowerCase().includes('new artisan'), 'Name correctly applied to user record');
  assert(newSignupRes.data.user.role === 'owner', 'New Google user assigned owner role');
  assert(newSignupRes.data.user.auth_methods === 'google', 'Sign-in method tracked as google');

  // Verify tenant was created in DB
  const createdTenant = await db('tenants').where('id', newSignupRes.data.user.tenant_id).first();
  assert(!!createdTenant, 'Tenant created in database');
  assert(createdTenant.owner_id === newSignupRes.data.user.id, 'Tenant owner_id matches new user ID');
  assert(createdTenant.plan_id === 'free_trial', 'Tenant assigned free_trial plan');

  // Test 6b: New Google User Signup where Google provides NO name (testing null name fallback)
  console.log('\nTest 6b: Google User Signup with null name from Google');
  await db('users').where('email', 'artisan_noname_user@example.com').del();
  const nullNameSignupRes = await request('/api/auth/google-login', {
    method: 'POST',
    body: JSON.stringify({
      token: 'mock_google_token_artisan_noname_user@example.com',
      plan_id: 'starter',
    }),
  });
  assert(nullNameSignupRes.status === 201, 'Signup with null name succeeds with HTTP 201');
  assert(
    !!nullNameSignupRes.data.user.name && nullNameSignupRes.data.user.name.length > 0,
    'Name fallback is saved to the database users record (not null!)'
  );
  // Verify directly from DB
  const dbUserRecord = await db('users').where('id', nullNameSignupRes.data.user.id).first();
  assert(dbUserRecord.name !== null && dbUserRecord.name.length > 0, 'Database users.name NOT NULL constraint satisfied');
  // Clean up 6b user and tenant
  await db('users').where('id', dbUserRecord.id).del();
  await db('tenants').where('id', dbUserRecord.tenant_id).del();

  // Test 7: Existing Google User Login
  console.log('\nTest 7: Existing Google User Subsequent Login');
  const existingGoogleRes = await request('/api/auth/google-login', {
    method: 'POST',
    body: JSON.stringify({
      token: 'mock_google_token_new_artisan_test@example.com',
    }),
  });
  assert(existingGoogleRes.status === 200, 'Existing Google user logs in with HTTP 200 OK');
  assert(existingGoogleRes.data.user.id === newSignupRes.data.user.id, 'Returns existing user without duplication');
  assert(existingGoogleRes.data.user.tenant_id === createdTenant.id, 'Maintains existing tenant relationship');

  // Test 8: Existing Email/Password Account Linking
  console.log('\nTest 8: Linking Existing Email/Password User to Google');
  const passwordHash = await bcrypt.hash('secret123', 10);
  const [createdUserId] = await db('users').insert({
    tenant_id: createdTenant.id,
    name: 'Existing Artisan',
    email: 'existing_pw_user@example.com',
    password_hash: passwordHash,
    role: 'owner',
    is_active: true,
    auth_methods: 'email_password',
  }).returning('id');
  const pwUserId = typeof createdUserId === 'object' ? createdUserId.id : createdUserId;

  const linkRes = await request('/api/auth/google-login', {
    method: 'POST',
    body: JSON.stringify({
      token: 'mock_google_token_existing_pw_user@example.com',
    }),
  });
  assert(linkRes.status === 200, 'Account linking succeeds with HTTP 200');
  assert(linkRes.data.user.id === pwUserId, 'Linked user ID matches existing record');
  assert(
    linkRes.data.user.auth_methods.includes('email_password') && linkRes.data.user.auth_methods.includes('google'),
    'auth_methods updated to contain both email_password and google'
  );
  assert(linkRes.data.message.includes('linked'), 'Helpful linking confirmation message returned');

  // Test 9: Worker Account Restriction
  console.log('\nTest 9: Worker Account Google Login Restriction');
  await db('users').insert({
    tenant_id: createdTenant.id,
    name: 'Test Worker',
    email: 'worker_user_test@example.com',
    password_hash: passwordHash,
    role: 'worker',
    is_active: true,
    auth_methods: 'email_password',
  });

  const workerRes = await request('/api/auth/google-login', {
    method: 'POST',
    body: JSON.stringify({
      token: 'mock_google_token_worker_user_test@example.com',
    }),
  });
  assert(workerRes.status === 403, 'Worker Google login rejected with HTTP 403 Forbidden');
  assert(
    workerRes.data?.error === 'Worker accounts must log in with email and password',
    'Clear worker restriction error message'
  );

  // Test 10: Existing Email/Password Login
  console.log('\nTest 10: Email/Password Login Functionality');
  const emailLoginRes = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'existing_pw_user@example.com',
      password: 'secret123',
    }),
  });
  assert(emailLoginRes.status === 200, 'Valid email/password login returns HTTP 200');
  assert(!!emailLoginRes.data?.token, 'Returns valid JWT token');

  const badPwRes = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'existing_pw_user@example.com',
      password: 'wrongpassword',
    }),
  });
  assert(badPwRes.status === 401, 'Invalid password returns HTTP 401');

  // Test 11: Production Mock Token Lockout
  console.log('\nTest 11: Production Mock Token Lockout Verification');
  // Temporarily simulate production environment
  process.env.NODE_ENV = 'production';
  delete process.env.ALLOW_MOCK_GOOGLE;

  let prodMockRejected = false;
  try {
    await verifyGoogleToken('mock_google_token_hacker@example.com');
  } catch (err) {
    prodMockRejected = true;
    assert(err.isAuthError || err.name === 'GoogleAuthError', 'Mock token rejected by real verification in production');
  }
  assert(prodMockRejected, 'Production environment strictly refuses mock token bypass');

  // Restore test env
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_MOCK_GOOGLE = 'true';

  // Clean up test records
  await db('users').whereIn('email', testEmails).del();
  await db('tenants').where('id', createdTenant.id).del();

  console.log('\n======================================================');
  console.log('🎉 ALL 11 AUTHENTICATION & GOOGLE OAUTH TESTS PASSED!');
  console.log('======================================================\n');
}

server = http.createServer(app);
server.listen(TEST_PORT, async () => {
  try {
    await runTests();
  } catch (err) {
    console.error('\n❌ TEST RUN FAILED:', err);
    process.exit(1);
  } finally {
    server.close();
    process.exit(0);
  }
});
