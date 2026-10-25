const { OAuth2Client } = require('google-auth-library');

const DEFAULT_DEV_CLIENT_ID = '268763150621-4qgrhe5pgmkd7s3ru6mucmk9m9e3vr9e.apps.googleusercontent.com';

function getGoogleClientId() {
  if (process.env.GOOGLE_CLIENT_ID) {
    return process.env.GOOGLE_CLIENT_ID.trim();
  }
  if (process.env.NODE_ENV === 'production') {
    console.error('⚠️ [Google OAuth] GOOGLE_CLIENT_ID is not configured in production environment variables.');
    return null;
  }
  return DEFAULT_DEV_CLIENT_ID;
}

const activeClientId = getGoogleClientId();
const client = new OAuth2Client(activeClientId || undefined);

if (activeClientId) {
  console.log('🔑 Google OAuth2 Client initialized with Client ID:', activeClientId);
} else {
  console.warn('⚠️ Google OAuth2 Client initialized without a Client ID.');
}

/**
 * Custom error class for authentication failures (e.g. invalid signature, expired token)
 */
class GoogleAuthError extends Error {
  constructor(message, code = 'INVALID_TOKEN') {
    super(message);
    this.name = 'GoogleAuthError';
    this.code = code;
    this.isAuthError = true;
  }
}

/**
 * Verifies a Google ID Token (credential) received from the frontend.
 *
 * In test mode (NODE_ENV === 'test' and ALLOW_MOCK_GOOGLE === 'true'),
 * allows mock tokens starting with 'mock_google_token_'.
 * In production, real Google cryptographic verification against the configured
 * Client ID is strictly enforced.
 */
async function verifyGoogleToken(token) {
  if (!token || typeof token !== 'string') {
    throw new GoogleAuthError('Missing or invalid Google ID token', 'MISSING_TOKEN');
  }

  // Strictly gated mock verification only for local test suites
  if (process.env.NODE_ENV === 'test' && process.env.ALLOW_MOCK_GOOGLE === 'true' && token.startsWith('mock_google_token_')) {
    const mockEmail = token.replace('mock_google_token_', '');
    const isNoName = mockEmail.includes('_noname_');
    const email = mockEmail.includes('@') ? mockEmail : 'google_test_user@gmail.com';
    const localPart = email.split('@')[0].replace('_noname_', '');
    const name = isNoName ? null : (localPart.charAt(0).toUpperCase() + localPart.slice(1).replace(/[^a-zA-Z]/g, ' '));

    return {
      googleId:            `g_mock_id_${localPart}`,
      email:               email.toLowerCase(),
      name:                name,
      googleProfilePhoto: `https://lh3.googleusercontent.com/a/mock_photo_id_${localPart}`,
    };
  }

  const clientId = getGoogleClientId();
  if (!clientId) {
    console.error('[Google OAuth] Server cannot verify token because GOOGLE_CLIENT_ID is not set.');
    throw new Error('Google OAuth is not configured on the server.');
  }

  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: clientId,
    });
    const payload = ticket.getPayload();

    if (!payload || !payload['sub'] || !payload['email']) {
      throw new GoogleAuthError('Google token is missing required profile claims (sub or email).');
    }

    return {
      googleId:            payload['sub'],
      email:               payload['email']?.toLowerCase(),
      name:                payload['name'],
      googleProfilePhoto: payload['picture'] || null,
    };
  } catch (err) {
    if (err instanceof GoogleAuthError) throw err;
    console.error('[Google OAuth] Verification failed:', err.message);
    throw new GoogleAuthError('Invalid or expired Google token', 'VERIFICATION_FAILED');
  }
}

module.exports = {
  verifyGoogleToken,
  getGoogleClientId,
  GoogleAuthError,
};

