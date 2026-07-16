import fs from 'node:fs';
import { Router } from 'express';

// Serves locally-cached artwork. Artwork paths are stored as absolute paths
// in the Game and Screenshot models, so this route looks them up rather than
// constructing them from a centralised directory (which is the legacy path).
const ALLOWED = /^(cover|background|screenshot_\d+)\.jpg$/;

export function artworkRoutes({ models }) {
  const { Game, Screenshot } = models;
  const router = Router();

  router.get('/artwork/:igdbId/:file', async (req, res) => {
    const { igdbId, file } = req.params;
    if (!/^-?\d+$/.test(igdbId) || !ALLOWED.test(file)) {
      return res.status(400).json({ error: 'Invalid artwork request' });
    }

    const id = Number(igdbId);
    let filePath;

    if (file === 'cover.jpg') {
      const game = await Game.findByPk(id, { attributes: ['coverPath'] });
      filePath = game?.coverPath;
    } else if (file === 'background.jpg') {
      const game = await Game.findByPk(id, { attributes: ['backgroundPath'] });
      filePath = game?.backgroundPath;
    } else {
      const m = /^screenshot_(\d+)\.jpg$/.exec(file);
      if (m) {
        const ss = await Screenshot.findOne({
          where: { igdbId: id, order: Number(m[1]) },
          attributes: ['path'],
        });
        filePath = ss?.path;
      }
    }

    if (!filePath) return res.status(404).json({ error: 'Artwork not found' });

    try {
      await fs.promises.access(filePath);
    } catch {
      return res.status(404).json({ error: 'Artwork not found' });
    }
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return fs.createReadStream(filePath).pipe(res);
  });

  return router;
}

export default artworkRoutes;
