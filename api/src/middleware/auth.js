import crypto from 'node:crypto';
import { config } from '../config.js';

// Phase 1 auth: a single admin password. The session token is a deterministic
// HMAC of the password, so it survives restarts and works across processes
// without a session store. Phase 2 swaps this whole module for real accounts —
// routes only depend on `requireAuth` and never reach inside it.

const TOKEN_LABEL = 'gameledger-admin-session';

export function expectedToken() {
  return crypto
    .createHmac('sha256', config.adminPassword)
    .update(TOKEN_LABEL)
    .digest('hex');
}

export function verifyPassword(password) {
  if (typeof password !== 'string' || password.length === 0) return false;
  const a = Buffer.from(password);
  const b = Buffer.from(config.adminPassword);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function issueToken() {
  return expectedToken();
}

export function requireAuth(req, res, next) {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const expected = expectedToken();

  if (
    token &&
    token.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  ) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

export default requireAuth;
