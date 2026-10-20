import fs from 'node:fs';
import path from 'node:path';
import { GAME_STATUS } from '../db/index.js';
import { processArtwork } from './artwork.js';
import { metadataFields } from './metadata.js';

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

// Which of those fields are blank, for UI hints ("Missing: summary, genres").
export function missingMetadataFields(game) {
  const missing = [];
  if (game.releaseYear == null) missing.push('release year');
  if (!game.summary) missing.push('summary');
  if (!game.genres?.length) missing.push('genres');
  if (!game.platforms?.length) missing.push('platforms');
  if (game.rating == null) missing.push('rating');
  if (!game.coverPath) missing.push('cover');
  return missing;
}

// What "missing" mode refreshes: blank detail-page fields, plus games whose
// trailer was never looked up. A trailer isn't part of isMissingMetadata
// (plenty of games legitimately have none), but libraries catalogued before
// trailers existed should pick theirs up without a full "all" refresh. One
// removed by hand ('') stays removed.
export function needsMetadataRefresh(game) {
  return isMissingMetadata(game) || game.trailerYoutubeId == null;
}

/**
 * Bulk-refreshes catalogued games' metadata/artwork from the configured
 * metadata providers (see services/metadata.js).
 * safe to run repeatedly on a live library.
 *
 * options:
 *  - "all":     re-fetch every catalogued game, unconditionally overwriting
 *               metadata and wiping + redownloading all artwork. This is the
 *               one to reach for when a field is wrong-but-present (e.g. a
 *               title that got mangled by something upstream of IGDB), since
 *               "missing" mode only fills in blanks.
 *  - "missing": only touches games with at least one blank field (or no
 *               trailer yet), and only fills in the blanks  present,
 *               non-empty fields and existing artwork are left alone.
 */
export function createMetadataRefresher({ models, metadata, broadcaster, logger = NULL_LOGGER }) {
  const { Game, Screenshot } = models;
  let running = false;
  const isRunning = () => running;

  async function refreshOne(game, mode) {
    let data;
    try {
      data = await metadata.getGame(game.igdbId);
    } catch {
      data = null;
    }
    if (!data) return 'failed';

    const meta = metadataFields(data);

    const fields = {};
    if (mode === REFRESH_MODE.ALL) {
      Object.assign(fields, meta, {
        title: meta.title ?? game.title,
        // A hand-picked trailer survives when the provider has none to offer.
        trailerYoutubeId: meta.trailerYoutubeId ?? game.trailerYoutubeId ?? null,
      });
    } else {
      // Only fill blanks, and only with something: writing null over null
      // would count a game as "updated" without changing anything.
      if (game.releaseYear == null && meta.releaseYear != null) fields.releaseYear = meta.releaseYear;
      if (!game.summary && meta.summary) fields.summary = meta.summary;
      if (!game.genres?.length && meta.genres.length) fields.genres = meta.genres;
      if (!game.platforms?.length && meta.platforms.length) fields.platforms = meta.platforms;
      if (game.rating == null && meta.rating != null) fields.rating = meta.rating;
      if (game.trailerYoutubeId == null && meta.trailerYoutubeId) fields.trailerYoutubeId = meta.trailerYoutubeId;
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
      const targets = mode === REFRESH_MODE.ALL ? games : games.filter(needsMetadataRefresh);

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
