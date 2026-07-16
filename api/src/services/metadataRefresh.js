import fs from 'node:fs';
import path from 'node:path';
import { GAME_STATUS } from '../db/index.js';
import { processArtwork } from './artwork.js';

// No-op logger so the refresher works in tests/contexts without one wired in.
const NULL_LOGGER = { system: () => {} };

export const REFRESH_MODE = { ALL: 'all', MISSING: 'missing' };

// A game "has missing metadata" if any field the detail page would otherwise
// render as a placeholder ("—", "No description available.") is empty. Drives
// both which games "Find missing metadata" targets and which of their fields
// get filled in.
export function isMissingMetadata(game) {
  return (
    game.releaseYear == null ||
    !game.summary ||
    !game.genres?.length ||
    !game.platforms?.length ||
    game.rating == null ||
    !game.coverPath
  );
}

/**
 * Bulk-refreshes catalogued games' metadata/artwork from IGDB (issue #6).
 * Never touches gamePath/archivePath/folder names  per the naming-system
 * invariant, metadata corrections are cheap DB + artwork-file updates, not
 * relocations, so this is safe to run repeatedly on a live library.
 *
 * Two modes:
 *  - "all":     re-fetch every catalogued game, unconditionally overwriting
 *               metadata and wiping + redownloading all artwork. This is the
 *               one to reach for when a field is wrong-but-present (e.g. a
 *               title that got mangled by something upstream of IGDB), since
 *               "missing" mode only fills in blanks.
 *  - "missing": only touches games with at least one blank field, and only
 *               fills in the blanks  present, non-empty fields and existing
 *               artwork are left alone.
 */
export function createMetadataRefresher({ models, igdb, broadcaster, logger = NULL_LOGGER }) {
  const { Game, Screenshot } = models;
  let running = false;
  const isRunning = () => running;

  async function refreshOne(game, mode) {
    let data;
    try {
      data = await igdb.getGame(game.igdbId);
    } catch {
      data = null;
    }
    if (!data) return 'failed';

    const releaseYear = data.first_release_date
      ? new Date(data.first_release_date * 1000).getUTCFullYear()
      : null;

    const fields = {};
    if (mode === REFRESH_MODE.ALL) {
      fields.title = data.name ?? game.title;
      fields.releaseYear = releaseYear;
      fields.summary = data.summary ?? null;
      fields.genres = (data.genres ?? []).map((g) => g.name);
      fields.platforms = (data.platforms ?? []).map((p) => p.name);
      fields.rating = data.rating != null ? Math.round(data.rating) : null;
    } else {
      if (game.releaseYear == null) fields.releaseYear = releaseYear;
      if (!game.summary) fields.summary = data.summary ?? null;
      if (!game.genres?.length) fields.genres = (data.genres ?? []).map((g) => g.name);
      if (!game.platforms?.length) fields.platforms = (data.platforms ?? []).map((p) => p.name);
      if (game.rating == null) fields.rating = data.rating != null ? Math.round(data.rating) : null;
    }

    const artworkDir = game.coverPath
      ? path.dirname(game.coverPath)
      : game.gamePath
        ? path.join(game.gamePath, 'artwork')
        : null;

    if (artworkDir && mode === REFRESH_MODE.ALL) {
      // "delete all artwork and metadata": wipe first so stale assets from a
      // previous IGDB match never linger alongside the fresh set.
      await fs.promises.rm(artworkDir, { recursive: true, force: true }).catch(() => {});
      const art = await processArtwork(game.igdbId, data, artworkDir);
      fields.coverPath = art.coverPath;
      fields.backgroundPath = art.backgroundPath;
      fields.accentColorPrimary = art.accentPrimary;
      fields.accentColorSecondary = art.accentSecondary;
      await Screenshot.destroy({ where: { igdbId: game.igdbId } });
      if (art.screenshots?.length) {
        await Screenshot.bulkCreate(
          art.screenshots.map((s) => ({ igdbId: game.igdbId, path: s.path, order: s.order })),
        );
      }
    } else if (artworkDir && !game.coverPath) {
      // "missing" mode: only fill in artwork that's absent entirely.
      const art = await processArtwork(game.igdbId, data, artworkDir);
      if (art.coverPath) {
        fields.coverPath = art.coverPath;
        fields.accentColorPrimary = art.accentPrimary;
        fields.accentColorSecondary = art.accentSecondary;
      }
      if (art.backgroundPath) fields.backgroundPath = art.backgroundPath;
      if (art.screenshots?.length) {
        await Screenshot.destroy({ where: { igdbId: game.igdbId } });
        await Screenshot.bulkCreate(
          art.screenshots.map((s) => ({ igdbId: game.igdbId, path: s.path, order: s.order })),
        );
      }
    }

    if (Object.keys(fields).length === 0) return 'skipped';
    await Game.update(fields, { where: { igdbId: game.igdbId } });
    return 'updated';
  }

  async function refreshAll(mode = REFRESH_MODE.MISSING) {
    if (running) {
      const err = new Error('Metadata refresh already in progress');
      err.code = 'REFRESH_RUNNING';
      throw err;
    }
    running = true;
    try {
      // Custom (hand-authored) games have no IGDB-backed metadata to refresh.
      const games = await Game.findAll({ where: { status: GAME_STATUS.COMPLETED, custom: false } });
      const targets = mode === REFRESH_MODE.ALL ? games : games.filter(isMissingMetadata);

      let updated = 0;
      let skipped = 0;
      let failed = 0;
      for (const game of targets) {
        // eslint-disable-next-line no-await-in-loop
        const result = await refreshOne(game, mode);
        if (result === 'updated') updated += 1;
        else if (result === 'failed') failed += 1;
        else skipped += 1;
        broadcaster.broadcast({
          type: 'metadataRefreshProgress',
          igdbId: game.igdbId,
          title: game.title,
          result,
          total: targets.length,
        });
      }

      logger.system(
        `metadata refresh (${mode}) finished: ${updated} updated, ${skipped} skipped, ${failed} failed`,
        { meta: { mode, updated, skipped, failed, total: targets.length } },
      );
      broadcaster.broadcast({
        type: 'metadataRefresh',
        mode,
        total: targets.length,
        updated,
        skipped,
        failed,
      });
      return { total: targets.length, updated, skipped, failed };
    } finally {
      running = false;
    }
  }

  return { refreshAll, isRunning };
}

export default createMetadataRefresher;
