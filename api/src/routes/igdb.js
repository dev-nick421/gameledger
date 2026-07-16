import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { imageUrl } from '../services/igdb.js';

// Live IGDB search powering the metadata-correction modal. Admin-protected.
export function igdbRoutes({ igdb }) {
  const router = Router();

  router.get('/igdb/search', requireAuth, async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Query is required' });
    try {
      const results = await igdb.search(q, 12);
      res.json(
        results.map((r) => ({
          igdbId: r.id,
          name: r.name,
          releaseYear: r.first_release_date
            ? new Date(r.first_release_date * 1000).getUTCFullYear()
            : null,
          coverUrl: r.cover?.image_id ? imageUrl(r.cover.image_id, 't_cover_small') : null,
        })),
      );
    } catch (err) {
      res.status(400).json({ error: err?.message ?? 'IGDB search failed' });
    }
  });

  return router;
}

export default igdbRoutes;
