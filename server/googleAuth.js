// Verifies a Google Sign-In ID token server-side before trusting anything in
// it — the client sends a JWT, and only google-auth-library's signature
// check against Google's rotating public keys (plus audience/issuer checks)
// turns that into something safe to read `sub`/`email`/`name` from.
import { OAuth2Client } from 'google-auth-library';
import { env } from './env.js';

let client = null;

function getClient() {
  if (!client) client = new OAuth2Client(env('GOOGLE_CLIENT_ID'));
  return client;
}

// Returns { sub, email, name } on success, or null if the token is invalid,
// expired, or wasn't issued for our GOOGLE_CLIENT_ID. Never throws — callers
// treat null as "reject the request", not a server error.
export async function verifyGoogleIdToken(idToken) {
  const clientId = env('GOOGLE_CLIENT_ID');
  if (!clientId || !idToken) return null;
  try {
    const ticket = await getClient().verifyIdToken({ idToken, audience: clientId });
    const payload = ticket.getPayload();
    if (!payload || !payload.sub) return null;
    return { sub: payload.sub, email: payload.email || null, name: payload.name || null };
  } catch {
    return null;
  }
}

export function googleSignInConfigured() {
  return Boolean(env('GOOGLE_CLIENT_ID'));
}
