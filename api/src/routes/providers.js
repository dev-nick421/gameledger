import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { imageUrl } from '../services/igdb.js';
import { providerOf, providerIdOf } from '../services/providerIds.js';

// Live metadata search powering the metadata-correction modal. Searches IGDB
// when it's configured, SteamGridDB otherwise. Admin-protected.
export function providerRoutes({ metadata }) {
  const router = Router();

  async function search(req, res) {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Query is required' });
    try {
      const results = await metadata.search(q, 12, { covers: true });
      return res.json(
        results.map((r) => ({
          igdbId: r.id,
          provider: providerOf(r.id),
          providerId: providerIdOf(r.id),
          name: r.name,
          releaseYear: r.first_release_date
            ? new Date(r.first_release_date * 1000).getUTCFullYear()
            : null,
          coverUrl: r.coverUrl ?? (r.cover?.image_id ? imageUrl(r.cover.image_id, 't_cover_small') : null),
        })),
      );
    } catch (err) {
      return res.status(400).json({ error: err?.message ?? 'Search failed' });
    }
  }

  router.get('/providers/search', requireAuth, search);
  // Original path, kept so existing clients keep working.
  router.get('/igdb/search', requireAuth, search);

  return router;
}

export default providerRoutes;
