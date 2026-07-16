import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { Op } from 'sequelize';
import multer from 'multer';
import { GAME_STATUS, JOB_STATUS } from '../db/index.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { generateDisplayName, generateDownloadFilename, generateFolderName } from '../services/naming.js';
import { processArtwork } from '../services/artwork.js';
import { createArchive } from '../services/compression.js';
import { cleanSourceName } from '../services/scanner.js';
import { isMissingMetadata } from '../services/metadataRefresh.js';

// In-memory upload buffering for hand-authored artwork
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 30 },
});
const customUpload = upload.fields([
  { name: 'cover', maxCount: 1 },
  { name: 'background', maxCount: 1 },
  { name: 'screenshots', maxCount: 20 },
]);

function coverUrl(game) {
  return game.coverPath ? `/api/artwork/${game.igdbId}/cover.jpg` : null;
}
function backgroundUrl(game) {
  return game.backgroundPath ? `/api/artwork/${game.igdbId}/background.jpg` : null;
}

function serializeCard(game, scheme) {
  return {
    type: 'game',
    igdbId: game.igdbId,
    title: game.title,
    releaseYear: game.releaseYear,
    status: game.status,
    coverUrl: coverUrl(game),
    displayName: generateDisplayName(game, scheme),
    downloadCount: game.downloadCount ?? 0,
  };
}

// In-flight or failed jobs render as cards too, so the user always sees that a
// game exists even before processing finishes.
function serializeJobCard(job) {
  return {
    type: 'job',
    jobId: job.id,
    igdbId: null,
    title: cleanSourceName(job.sourceName),
    status: job.stage,
    progress: job.progress,
    error: job.error,
    coverUrl: null,
  };
}

export function gameRoutes({ models, igdb, namingSchemeProvider, metadataRefresher, logger }) {
  const { Game, Screenshot, Job, Setting, Library } = models;
  const router = Router();

  const scheme = async () => namingSchemeProvider();

  async function compressionLevel() {
    const [setting] = await Setting.findOrCreate({ where: { id: 1 }, defaults: { id: 1 } });
    return setting.compressionLevel;
  }

  // Where a game's artwork files live. Scanned games keep theirs beside the
  // archive (under coverPath's dir); custom games get a managed folder
  // alongside the database so it persists with the data volume.
  function artworkDirFor(game) {
    if (game.coverPath) return path.dirname(game.coverPath);
    if (game.gamePath) return path.join(game.gamePath, 'artwork');
    return path.join(config.customDir, String(game.igdbId), 'artwork');
  }

  // Persist an uploaded image buffer as <name>.jpg in dir and return its path.
  async function saveImage(dir, name, file) {
    await fs.promises.mkdir(dir, { recursive: true });
    const dest = path.join(dir, `${name}.jpg`);
    await fs.promises.writeFile(dest, file.buffer);
    return dest;
  }

  // Parse a multipart text field that may be a JSON array or a comma list.
  function parseList(value) {
    if (value == null || value === '') return [];
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim()).filter(Boolean);
    } catch {
      /* not JSON fall through to comma splitting */
    }
    return String(value)
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }

  // Library grid feed: in-flight job cards first, then catalogued games.
  // Completed jobs are omitted (the Game record is the source of truth)
  // Failures remain visible in the Scanning queue.
  router.get('/games', async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
    const namingScheme = await scheme();

    const jobs = await Job.findAll({
      where: { status: [JOB_STATUS.PENDING, JOB_STATUS.RUNNING] },
      order: [['updatedAt', 'DESC']],
    });
    // Exclude completed games with no archivePath -> these are broken/pre-migration. "Refresh Library" will clean them up.
    const games = await Game.findAll({
      where: { [Op.or]: [{ status: { [Op.ne]: GAME_STATUS.COMPLETED } }, { archivePath: { [Op.ne]: null } }] },
      order: [['updatedAt', 'DESC']],
    });

    let items = [...jobs.map(serializeJobCard), ...games.map((g) => serializeCard(g, namingScheme))];
    if (req.query.status) items = items.filter((i) => i.status === req.query.status);

    const total = items.length;
    const start = (page - 1) * limit;
    res.json({ items: items.slice(start, start + limit), total, page, limit });
  });

  // Admin management table (+ CRUD)
  router.get('/games/manage', requireAuth, async (req, res) => {
    const namingScheme = await scheme();
    const games = await Game.findAll({ order: [['title', 'ASC']] });
    const items = games.map((g) => ({
      igdbId: g.igdbId,
      title: g.title,
      releaseYear: g.releaseYear,
      status: g.status,
      custom: Boolean(g.custom),
      downloadCount: g.downloadCount ?? 0,
      hasArchive: Boolean(g.archivePath),
      coverUrl: coverUrl(g),
      displayName: generateDisplayName(g, namingScheme),
      missingMetadata:
        !g.custom && g.status === GAME_STATUS.COMPLETED ? isMissingMetadata(g) : false,
    }));
    res.json({ items, total: items.length });
  });

  // Bulk metadata refresh from IGDB (issue #6): "all" unconditionally
  // overwrites metadata + wipes/redownloads artwork for every game; "missing"
  // only touches games with a blank field, filling in just the blanks. Never
  // moves/renames gamePath/archivePath  a metadata correction is a cheap
  // DB + artwork-file update, not a relocation.
  router.post('/games/refresh-metadata', requireAuth, async (req, res) => {
    const mode = req.body?.mode === 'all' ? 'all' : 'missing';
    if (metadataRefresher.isRunning()) {
      return res.status(409).json({ error: 'Metadata refresh already in progress' });
    }
    logger?.user(`triggered a metadata refresh (${mode})`);
    // Fire-and-forget: progress streams over WebSocket, same as a scan.
    metadataRefresher.refreshAll(mode).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Metadata refresh failed:', err);
    });
    return res.status(202).json({ started: true, mode });
  });

  // List top-level folders/zips in all library paths that aren't already
  // catalogued game folders or source paths. 
  // Used by folder-picker in the for custom games
  router.get('/games/unprocessed-sources', requireAuth, async (req, res) => {
    const libraries = await Library.findAll();
    const knownGames = await Game.findAll({ attributes: ['gamePath', 'sourcePath'] });

    const excluded = new Set();
    for (const g of knownGames) {
      if (g.sourcePath) excluded.add(path.resolve(g.sourcePath));
      if (g.gamePath) excluded.add(path.resolve(g.gamePath));
    }

    const sources = [];
    for (const lib of libraries) {
      let entries;
      try {
        // eslint-disable-next-line no-await-in-loop
        entries = await fs.promises.readdir(lib.path, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.resolve(lib.path, entry.name);
        if (excluded.has(full)) continue;
        if (entry.isDirectory()) {
          sources.push({ name: entry.name, path: full, libraryPath: lib.path });
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.zip')) {
          sources.push({ name: entry.name, path: full, libraryPath: lib.path });
        }
      }
    }
    res.json({ sources });
  });

  // Process a selected library folder as a custom game: compresses contents into
  // the standard /data + /artwork structure, records a real archivePath so the
  // game appears in the library identically to a scanned game.
  router.post('/games/process-custom', requireAuth, customUpload, async (req, res) => {
    const body = req.body ?? {};
    const { sourcePath } = body;

    if (!sourcePath) return res.status(400).json({ error: 'sourcePath is required.' });
    if (!body.title || !String(body.title).trim()) {
      return res.status(400).json({ error: 'Title is required.' });
    }

    // Validate the source path is inside a known library to prevent traversal.
    const libraries = await Library.findAll();
    const normalizedSource = path.resolve(sourcePath);
    const resolvedLib = libraries.find((l) => {
      const lp = path.resolve(l.path);
      return normalizedSource.startsWith(lp + path.sep) || normalizedSource === lp;
    });
    if (!resolvedLib) {
      return res.status(400).json({ error: 'sourcePath is not within a configured library.' });
    }

    // Verify source actually exists on disk.
    try {
      await fs.promises.access(normalizedSource);
    } catch {
      return res.status(400).json({ error: 'Source folder not found on disk.' });
    }

    const min = await Game.min('igdbId');
    const igdbId = Math.min(0, Number.isFinite(min) ? min : 0) - 1;

    const namingScheme = await scheme();
    const fields = {
      igdbId,
      title: String(body.title).trim(),
      status: GAME_STATUS.COMPLETED,
      custom: true,
      sourceName: path.basename(normalizedSource),
      libraryPath: resolvedLib.path,
    };
    applyMetadata(fields, body);

    const folderName = generateFolderName(
      { title: fields.title, releaseYear: fields.releaseYear ?? null, igdbId },
      namingScheme,
    );
    const gamePath = path.join(resolvedLib.path, folderName);
    const artworkDir = path.join(gamePath, 'artwork');
    const dataDir = path.join(gamePath, 'data');

    try {
      await fs.promises.mkdir(artworkDir, { recursive: true });
      await fs.promises.mkdir(dataDir, { recursive: true });

      const level = await compressionLevel();
      const archiveName = `${folderName}.zip`;
      const archivePath = path.join(dataDir, archiveName);
      const tmpDest = `${archivePath}.tmp`;

      await createArchive(normalizedSource, tmpDest, undefined, undefined, level);
      await fs.promises.rename(tmpDest, archivePath);

      // Save any uploaded artwork into the game's artwork dir.
      const { patch, screenshots } = await applyArtwork({ igdbId, gamePath }, req.files, body);

      fields.archivePath = archivePath;
      fields.gamePath = gamePath;
      Object.assign(fields, patch);

      await Game.create(fields);
      if (screenshots?.length) {
        await Screenshot.bulkCreate(screenshots.map((s) => ({ igdbId, ...s })));
      }

      // Remove source only after a fully committed pipeline (mirrors normal scan).
      await fs.promises.rm(normalizedSource, { recursive: true, force: true });

      logger?.user(`processed custom game "${fields.title}" from "${fields.sourceName}"`, { meta: { igdbId } });
      const created = await Game.findByPk(igdbId);
      return res.status(201).json(serializeCard(created, namingScheme));
    } catch (err) {
      // Roll back the partial game folder, then return a 500 rather than
      // rethrowing Express 4 does not forward async-handler throws to the
      // error middleware, so a rethrow here would crash the whole process.
      await fs.promises.rm(gamePath, { recursive: true, force: true }).catch(() => {});
      logger?.system(`failed processing custom game "${fields.title}": ${err?.message}`, { level: 'error' });
      return res.status(500).json({ error: 'Failed to process the selected folder.' });
    }
  });

  router.get('/games/:igdbId', async (req, res) => {
    const namingScheme = await scheme();
    const game = await Game.findByPk(req.params.igdbId, {
      include: [{ model: Screenshot, as: 'screenshots' }],
    });
    if (!game) return res.status(404).json({ error: 'Game not found' });

    const screenshots = (game.screenshots ?? [])
      .sort((a, b) => a.order - b.order)
      .map((s) => `/api/artwork/${game.igdbId}/screenshot_${s.order}.jpg`);

    res.json({
      igdbId: game.igdbId,
      title: game.title,
      releaseYear: game.releaseYear,
      summary: game.summary,
      genres: game.genres ?? [],
      platforms: game.platforms ?? [],
      rating: game.rating,
      status: game.status,
      displayName: generateDisplayName(game, namingScheme),
      coverUrl: coverUrl(game),
      backgroundUrl: backgroundUrl(game),
      accentColorPrimary: game.accentColorPrimary,
      accentColorSecondary: game.accentColorSecondary,
      screenshots,
    });
  });

  // Streaming, resume-safe download with a friendly Content-Disposition name.
  router.get('/games/:igdbId/download', async (req, res) => {
    const namingScheme = await scheme();
    const game = await Game.findByPk(req.params.igdbId);
    if (!game || game.status !== GAME_STATUS.COMPLETED) {
      return res.status(404).json({ error: 'Game not available for download' });
    }

    const filePath = game.archivePath;
    if (!filePath) return res.status(404).json({ error: 'Archive missing' });

    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      return res.status(404).json({ error: 'Archive missing' });
    }

    const filename = generateDownloadFilename(game, namingScheme);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Accept-Ranges', 'bytes');

    const range = req.headers.range;
    // Count a download once per transfer: a full GET, or a ranged request that
    // starts from byte 0 (the opening chunk of a fresh download). Mid-stream
    // range requests (resumes/seeks) don't re-count.
    if (!range || /bytes=0-/.test(range)) {
      Game.increment('downloadCount', { where: { igdbId: game.igdbId } }).catch(() => {});
    }

    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : stat.size - 1;
      if (start > end || end >= stat.size) {
        res.setHeader('Content-Range', `bytes */${stat.size}`);
        return res.status(416).end();
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Content-Length', end - start + 1);
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }

    res.setHeader('Content-Length', stat.size);
    return fs.createReadStream(filePath).pipe(res);
  });

  // Reassign a game's IGDB match: refresh metadata/artwork and rebuild the
  // game folder at the new display name. Maintains the library-based structure.
  router.patch('/games/:igdbId/match', requireAuth, async (req, res) => {
    const oldId = Number(req.params.igdbId);
    const newId = Number(req.body?.new_igdb_id ?? req.body?.newIgdbId);
    if (!Number.isInteger(newId)) {
      return res.status(400).json({ error: 'new_igdb_id is required' });
    }
    const game = await Game.findByPk(oldId);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    let data;
    try {
      data = await igdb.getGame(newId);
    } catch (err) {
      return res.status(400).json({ error: err?.message ?? 'IGDB lookup failed' });
    }
    if (!data) return res.status(404).json({ error: 'No IGDB game with that id' });

    const namingScheme = await scheme();
    const releaseYear = data.first_release_date
      ? new Date(data.first_release_date * 1000).getUTCFullYear()
      : null;

    // Determine the library root to place the new game folder in.
    const libPath = game.libraryPath ?? (game.gamePath ? path.dirname(game.gamePath) : null);
    if (!libPath) {
      return res.status(422).json({ error: 'Cannot determine library path for this game' });
    }

    const folderName = generateFolderName(
      { title: data.name, releaseYear, igdbId: newId },
      namingScheme,
    );
    const newGamePath = path.join(libPath, folderName);
    const newArtworkDir = path.join(newGamePath, 'artwork');
    const newDataDir = path.join(newGamePath, 'data');

    await fs.promises.mkdir(newArtworkDir, { recursive: true });
    await fs.promises.mkdir(newDataDir, { recursive: true });

    const art = await processArtwork(newId, data, newArtworkDir);

    const archiveName = `${folderName}.zip`;
    const newArchivePath = path.join(newDataDir, archiveName);

    if (game.status === GAME_STATUS.UNMATCHED && game.sourcePath) {
      // Never compressed yet compress the preserved source now.
      await createArchive(game.sourcePath, newArchivePath, undefined, undefined, await compressionLevel());
      await fs.promises.rm(game.sourcePath, { recursive: true, force: true });
    } else if (game.archivePath) {
      // Already have an archive move it to the new location.
      try {
        await fs.promises.rename(game.archivePath, newArchivePath);
      } catch {
        try {
          await fs.promises.copyFile(game.archivePath, newArchivePath);
          await fs.promises.rm(game.archivePath, { force: true });
        } catch {
          // Missing source archive is non-fatal; metadata still corrects.
        }
      }
      // Remove old game folder if it differs from the new one.
      if (game.gamePath && game.gamePath !== newGamePath) {
        await fs.promises.rm(game.gamePath, { recursive: true, force: true });
      }
    }

    // Migrate to the new primary key.
    if (oldId !== newId) {
      await Screenshot.destroy({ where: { igdbId: oldId } });
      await Game.destroy({ where: { igdbId: oldId } });
    } else {
      await Screenshot.destroy({ where: { igdbId: newId } });
    }

    await Game.upsert({
      igdbId: newId,
      title: data.name,
      releaseYear,
      summary: data.summary ?? null,
      genres: (data.genres ?? []).map((g) => g.name),
      platforms: (data.platforms ?? []).map((p) => p.name),
      rating: data.rating != null ? Math.round(data.rating) : null,
      coverPath: art.coverPath,
      backgroundPath: art.backgroundPath,
      accentColorPrimary: art.accentPrimary,
      accentColorSecondary: art.accentSecondary,
      status: GAME_STATUS.COMPLETED,
      sourceName: game.sourceName,
      sourcePath: null,
      gamePath: newGamePath,
      archivePath: newArchivePath,
      libraryPath: libPath,
    });
    if (art.screenshots?.length) {
      await Screenshot.bulkCreate(
        art.screenshots.map((s) => ({ igdbId: newId, path: s.path, order: s.order })),
      );
    }

    const updated = await Game.findByPk(newId);
    res.json(serializeCard(updated, await scheme()));
  });

  // ---- Manual CRUD for custom games -----------------------------------
  // Apply text metadata from a multipart/JSON body onto a plain object. Only
  // fields actually present in the body are touched, so PUT can patch partially.
  function applyMetadata(target, body) {
    if (body.title !== undefined) target.title = String(body.title).trim();
    if (body.releaseYear !== undefined) {
      const y = Number(body.releaseYear);
      target.releaseYear = body.releaseYear !== '' && Number.isInteger(y) ? y : null;
    }
    if (body.summary !== undefined) target.summary = String(body.summary).trim() || null;
    if (body.genres !== undefined) target.genres = parseList(body.genres);
    if (body.platforms !== undefined) target.platforms = parseList(body.platforms);
    if (body.rating !== undefined) {
      const r = Number(body.rating);
      target.rating = body.rating !== '' && Number.isFinite(r) ? Math.round(r) : null;
    }
  }

  // Save cover/background/screenshot uploads into the game's artwork dir and
  // return the path fields to persist. Existing screenshots are replaced only
  // when new ones are uploaded (or removeScreenshots is set).
  async function applyArtwork(game, files, body) {
    const dir = artworkDirFor(game);
    const patch = {};
    if (files?.cover?.[0]) patch.coverPath = await saveImage(dir, 'cover', files.cover[0]);
    if (files?.background?.[0]) {
      patch.backgroundPath = await saveImage(dir, 'background', files.background[0]);
    }

    const shots = files?.screenshots ?? [];
    const replaceShots = shots.length > 0 || body.removeScreenshots === 'true';
    let screenshots = null;
    if (replaceShots) {
      screenshots = [];
      for (let i = 0; i < shots.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const p = await saveImage(dir, `screenshot_${i}`, shots[i]);
        screenshots.push({ order: i, path: p });
      }
    }
    return { patch, screenshots };
  }

  // Create a hand-authored game. Negative ids keep custom games from ever
  // colliding with real IGDB ids (which are always positive).
  router.post('/games', requireAuth, customUpload, async (req, res) => {
    const body = req.body ?? {};
    if (!body.title || !String(body.title).trim()) {
      return res.status(400).json({ error: 'Title is required.' });
    }
    const min = await Game.min('igdbId');
    const igdbId = Math.min(0, Number.isFinite(min) ? min : 0) - 1;

    const fields = {
      igdbId,
      title: String(body.title).trim(),
      status: GAME_STATUS.COMPLETED,
      custom: true,
    };
    applyMetadata(fields, body);

    const { patch, screenshots } = await applyArtwork({ igdbId }, req.files, body);
    Object.assign(fields, patch);

    await Game.create(fields);
    if (screenshots?.length) {
      await Screenshot.bulkCreate(screenshots.map((s) => ({ igdbId, ...s })));
    }
    logger?.user(`created custom game "${fields.title}"`, { meta: { igdbId } });
    const created = await Game.findByPk(igdbId);
    res.status(201).json(serializeCard(created, await scheme()));
  });

  // Edit any game's metadata/artwork (custom or scanned).
  // Special case: if the game is Unmatched and still has its source folder,
  // run the full compression pipeline first so the result is a proper
  // downloadable game (mirrors process-custom but reuses the existing record).
  router.put('/games/:igdbId', requireAuth, customUpload, async (req, res) => {
    const game = await Game.findByPk(Number(req.params.igdbId));
    if (!game) return res.status(404).json({ error: 'Game not found' });
    const body = req.body ?? {};

    if (body.title !== undefined && !String(body.title).trim()) {
      return res.status(400).json({ error: 'Title cannot be empty.' });
    }

    if (game.status === GAME_STATUS.UNMATCHED && game.sourcePath) {
      // Collect the metadata the user supplied, falling back to what's stored.
      const metaOverride = {};
      applyMetadata(metaOverride, body);
      const title = metaOverride.title ?? game.title;
      const releaseYear = metaOverride.releaseYear !== undefined ? metaOverride.releaseYear : game.releaseYear;

      const libPath = game.libraryPath ?? path.dirname(game.sourcePath);

      const namingScheme = await scheme();
      const folderName = generateFolderName(
        { title, releaseYear: releaseYear ?? null, igdbId: game.igdbId },
        namingScheme,
      );
      const gamePath = path.join(libPath, folderName);
      const artworkDir = path.join(gamePath, 'artwork');
      const dataDir = path.join(gamePath, 'data');

      // Snapshot before update() nulls it out on the in-memory instance.
      const originalSourcePath = game.sourcePath;

      try {
        await fs.promises.mkdir(artworkDir, { recursive: true });
        await fs.promises.mkdir(dataDir, { recursive: true });

        const level = await compressionLevel();
        const archiveName = `${folderName}.zip`;
        const archivePath = path.join(dataDir, archiveName);
        const tmpDest = `${archivePath}.tmp`;

        await createArchive(originalSourcePath, tmpDest, undefined, undefined, level);
        await fs.promises.rename(tmpDest, archivePath);

        const { patch, screenshots } = await applyArtwork({ igdbId: game.igdbId, gamePath }, req.files, body);

        const updateFields = {
          ...metaOverride,
          title,
          releaseYear,
          status: GAME_STATUS.COMPLETED,
          custom: true,
          archivePath,
          gamePath,
          sourcePath: null,
          libraryPath: libPath,
          ...patch,
        };

        await game.update(updateFields);
        if (screenshots) {
          await Screenshot.destroy({ where: { igdbId: game.igdbId } });
          if (screenshots.length) {
            await Screenshot.bulkCreate(screenshots.map((s) => ({ igdbId: game.igdbId, ...s })));
          }
        }

        await fs.promises.rm(originalSourcePath, { recursive: true, force: true });

        logger?.user(`processed unmatched game "${title}"`, { meta: { igdbId: game.igdbId } });
        const updated = await Game.findByPk(game.igdbId);
        return res.json(serializeCard(updated, namingScheme));
      } catch (err) {
        // Clean up the partial folder and return 500 never rethrow from an
        // async handler under Express 4 (it would crash the process, not 500).
        await fs.promises.rm(gamePath, { recursive: true, force: true }).catch(() => {});
        logger?.system(`failed processing unmatched game "${title}": ${err?.message}`, { level: 'error' });
        return res.status(500).json({ error: 'Failed to process the game folder.' });
      }
    }

    // Standard metadata/artwork edit for already-completed or custom games.
    const fields = {};
    applyMetadata(fields, body);
    const { patch, screenshots } = await applyArtwork(game, req.files, body);
    Object.assign(fields, patch);

    await game.update(fields);
    if (screenshots) {
      await Screenshot.destroy({ where: { igdbId: game.igdbId } });
      if (screenshots.length) {
        await Screenshot.bulkCreate(screenshots.map((s) => ({ igdbId: game.igdbId, ...s })));
      }
    }
    logger?.user(`edited game "${game.title}"`, { meta: { igdbId: game.igdbId } });
    const updated = await Game.findByPk(game.igdbId);
    return res.json(serializeCard(updated, await scheme()));
  });

  // Delete a game and its on-disk artifacts. Scanned games take their whole
  // game folder (archive + artwork); custom games take their managed dir.
  router.delete('/games/:igdbId', requireAuth, async (req, res) => {
    const game = await Game.findByPk(Number(req.params.igdbId));
    if (!game) return res.status(404).json({ error: 'Game not found' });

    if (game.gamePath) {
      await fs.promises.rm(game.gamePath, { recursive: true, force: true }).catch(() => {});
    }
    if (game.custom) {
      await fs.promises
        .rm(path.join(config.customDir, String(game.igdbId)), { recursive: true, force: true })
        .catch(() => {});
    }
    if (game.sourcePath) {
      await fs.promises.rm(game.sourcePath, { recursive: true, force: true }).catch(() => {});
    }

    await Screenshot.destroy({ where: { igdbId: game.igdbId } });
    await Game.destroy({ where: { igdbId: game.igdbId } });
    logger?.user(`deleted game "${game.title}"`, { meta: { igdbId: game.igdbId } });
    res.json({ ok: true });
  });

  return router;
}

export default gameRoutes;
