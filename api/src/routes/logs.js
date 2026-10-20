import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

// Audit log feed backing the Logs settings page. Admin-only.
export function logRoutes({ models, logger }) {
  const { Log } = models;
  const router = Router();

  router.get('/logs', requireAuth, async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const where = {};
    if (req.query.source) where.source = String(req.query.source);
    if (req.query.level) where.level = String(req.query.level);

    const { rows, count } = await Log.findAndCountAll({
      where,
      order: [['id', 'DESC']],
      offset: (page - 1) * limit,
      limit,
    });

    res.json({
      items: rows.map((l) => ({
        id: l.id,
        source: l.source,
        level: l.level,
        message: l.message,
        meta: l.meta,
        createdAt: l.createdAt,
      })),
      total: count,
      page,
      limit,
    });
  });

  // Clear the audit log. The clear itself is recorded as the first new entry.
  router.delete('/logs', requireAuth, async (req, res) => {
    const removed = await Log.destroy({ where: {}, truncate: false });
    await logger?.user('cleared the audit log', { meta: { removed } });
    res.json({ removed });
  });

  return router;
}

export default logRoutes;
