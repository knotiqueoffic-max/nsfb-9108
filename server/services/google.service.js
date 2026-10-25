const { OAuth2Client } = require('google-auth-library');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const isMockGoogle = !CLIENT_ID;

let client = null;
if (!isMockGoogle) {
  client = new OAuth2Client(CLIENT_ID);
  console.log('🔑 Google Auth Library initialized in Live mode.');
} else {
  console.warn('⚠️ GOOGLE_CLIENT_ID is missing from .env. Google Auth running in MOCK Mode.');
}

/**
 * Verifies a Google ID Token (credential) received from the frontend.
 *
 * Supports mock validation if environment variables are not set or if
 * the token starts with 'mock_google_token_'.
 */
async function verifyGoogleToken(token) {
  if (isMockGoogle || token.startsWith('mock_google_token_')) {
    console.log('🤖 Verifying mock Google ID token:', token);
    const mockEmail = token.replace('mock_google_token_', '');
    
    // Ensure it looks like a valid email, fallback to a default
    const email = mockEmail.includes('@') ? mockEmail : 'google_test_user@gmail.com';
    const localPart = email.split('@')[0];
    const name = localPart.charAt(0).toUpperCase() + localPart.slice(1).replace(/[^a-zA-Z]/g, ' ');

    return {
      googleId:            `g_mock_id_${localPart}`,
      email:               email.toLowerCase(),
      name:                name || 'Google Test User',
      googleProfilePhoto: `https://lh3.googleusercontent.com/a/mock_photo_id_${localPart}`,
    };
  }

  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: CLIENT_ID,
    });
    const payload = ticket.getPayload();

    return {
      googleId:            payload['sub'], // unique Google profile subject id
      email:               payload['email']?.toLowerCase(),
      name:                payload['name'],
      googleProfilePhoto: payload['picture'],
    };
  } catch (err) {
    console.error('Google ID Token verification failed:', err);
    throw new Error('Invalid Google ID token signature.');
  }
}

module.exports = {
  verifyGoogleToken,
  isMockGoogle,
};
