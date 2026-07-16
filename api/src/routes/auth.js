import { Router } from 'express';
import { verifyPassword, issueToken } from '../middleware/auth.js';

export function authRoutes({ logger } = {}) {
  const router = Router();

  // Exchange the admin password for a session token. Phase 2 replaces this.
  router.post('/auth/login', (req, res) => {
    const { password } = req.body ?? {};
    if (!verifyPassword(password)) {
      logger?.user('failed admin login attempt', { level: 'warn' });
      return res.status(401).json({ error: 'Invalid password' });
    }
    logger?.user('admin signed in');
    return res.json({ token: issueToken() });
  });

  return router;
}

export default authRoutes;
