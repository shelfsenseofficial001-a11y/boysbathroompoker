// Checking the Supabase access token a socket connects with.
//
// The browser signs itself in anonymously and hands the resulting JWT to the
// handshake. None of it is taken on trust: the token is verified here, and
// only the `sub` claim that survives verification is allowed to name a
// player. Nothing the client says about its own chips is read at all - the
// stack comes from this server's own users row.
//
// Two ways to verify, in order of preference:
//   SUPABASE_JWT_SECRET  - HS256, checked locally, no network call.
//   SUPABASE_URL + _ANON_KEY - asks the auth server, for projects on
//                              asymmetric signing keys where no shared
//                              secret exists.
// With neither set, Supabase is simply not in use and the caller falls back
// to the existing guest naming.
const crypto = require('crypto');

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const localVerify = Boolean(JWT_SECRET);
const remoteVerify = Boolean(SUPABASE_URL && ANON_KEY);

exports.supabaseAuthEnabled = localVerify || remoteVerify;

// Timing-safe because this is a signature comparison: a plain === leaks,
// byte by byte, how much of a forged signature was right.
function signatureMatches(expected, actual) {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyLocally(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  // Only the algorithm we hold a key for. Taking the token's word for this is
  // the classic JWT hole: "alg": "none" would otherwise verify itself.
  if (header.alg !== 'HS256') return null;

  const expected = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  if (!signatureMatches(expected, signatureB64)) return null;

  // An expired token is no token. 30 seconds of slack for clock drift
  // between this machine and Supabase's.
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + 30 < now) return null;
  if (payload.aud !== 'authenticated') return null;
  if (typeof payload.sub !== 'string' || !payload.sub) return null;

  return { id: payload.sub, isAnonymous: payload.is_anonymous === true };
}

async function verifyRemotely(token) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = await res.json();
    if (!user || typeof user.id !== 'string') return null;
    return { id: user.id, isAnonymous: user.is_anonymous === true };
  } catch {
    // Auth server unreachable. Refusing is the right answer: letting a
    // handshake through unverified because the network blinked is how an
    // unverified handshake becomes the normal case.
    return null;
  }
}

// Resolves to { id, isAnonymous } for a good token, or null for anything
// else. `id` is the Supabase auth user id (a uuid).
exports.verifyAccessToken = async function verifyAccessToken(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  if (localVerify) return verifyLocally(token);
  if (remoteVerify) return verifyRemotely(token);
  return null;
};
