import fs from 'node:fs';
import { Router } from 'express';
import { Op } from 'sequelize';
import { GAME_STATUS } from '../db/index.js';
import { generateDisplayName, generateDownloadFilename } from '../services/naming.js';
import { providerOf, providerIdOf } from '../services/providerIds.js';

// Bump when a field is removed or changes meaning; adding fields is fine.
export const CATALOG_VERSION = 1;

/**
 * Machine-readable catalogue for third-party clients (launcher plugins such as
 * Playnite, scripts, dashboards): every downloadable game with its full
 * metadata in one request. Public, like the library itself. URLs are relative
 * to the GameLedger origin the client is configured with.
 */
export function catalogRoutes({ models, namingSchemeProvider }) {
  const { Game, Screenshot } = models;
  const router = Router();

  router.get('/catalog', async (req, res) => {
    const namingScheme = await namingSchemeProvider();
    const games = await Game.findAll({
      where: { status: GAME_STATUS.COMPLETED, archivePath: { [Op.ne]: null } },
      include: [{ model: Screenshot, as: 'screenshots' }],
      order: [['title', 'ASC']],
    });

    const items = await Promise.all(
      games.map(async (game) => {
        const size = await fs.promises
          .stat(game.archivePath)
          .then((st) => st.size)
          .catch(() => null);
        const id = game.igdbId;
        return {
          id: String(id),
          provider: providerOf(id),
          providerId: providerIdOf(id),
          title: game.title,
          displayName: generateDisplayName(game, namingScheme),
          releaseYear: game.releaseYear,
          summary: game.summary,
          genres: game.genres ?? [],
          platforms: game.platforms ?? [],
          rating: game.rating,
          coverUrl: game.coverPath ? `/api/artwork/${id}/cover.jpg` : null,
          backgroundUrl: game.backgroundPath ? `/api/artwork/${id}/background.jpg` : null,
          screenshotUrls: (game.screenshots ?? [])
            .sort((a, b) => a.order - b.order)
            .map((s) => `/api/artwork/${id}/screenshot_${s.order}.jpg`),
          trailerYoutubeId: game.trailerYoutubeId || null,
          detailUrl: `/game/${id}`,
          downloadUrl: `/api/games/${id}/download`,
          fileName: generateDownloadFilename(game, namingScheme),
          sizeBytes: size,
          downloadCount: game.downloadCount ?? 0,
          addedAt: game.createdAt,
          updatedAt: game.updatedAt,
        };
      }),
    );

    res.json({ version: CATALOG_VERSION, generatedAt: new Date().toISOString(), total: items.length, games: items });
  });

  return router;
}

export default catalogRoutes;
