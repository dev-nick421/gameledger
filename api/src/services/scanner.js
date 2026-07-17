import fs from 'node:fs';
import path from 'node:path';
import { GAME_STATUS, JOB_STATUS } from '../db/index.js';
import { pickTrailer } from './igdb.js';
import { processArtwork, extractColors } from './artwork.js';
import { createArchive } from './compression.js';
import { generateFolderName, parseFolderName } from './naming.js';

// Derive a clean, searchable title from a folder/zip name:
//   "HELLDIVERS.2.zip" -> "HELLDIVERS 2"
export function cleanSourceName(name) {
  return name
    .replace(/\.zip$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * The scan pipeline and job queue. Only one scan runs at a time (in-process
 * guard); a second trigger throws SCAN_RUNNING so the route can return 409.
 */
// Thrown when a job is interrupted by a user cancel; treated as a clean stop
// rather than an error so the message stays friendly.
class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.cancelled = true;
  }
}

// No-op logger so the scanner works in tests/contexts without one wired in.
const NULL_LOGGER = { system: () => {}, scanner: () => {} };

// gameledger's own structured output looks like:
//   {gamePath}/artwork/...
//   {gamePath}/data/{name}.zip
// This shape only exists once a game has been fully processed, so any folder
// matching it must never be treated as raw scan input  even if this database
// has no record of it (fresh install, hand-arranged/restored library). Doing
// so would re-match, re-compress the folder into itself, and then delete it
// as a "source" once done.
async function isStructuredGameFolder(fullPath) {
  try {
    const artworkStat = await fs.promises.stat(path.join(fullPath, 'artwork'));
    if (!artworkStat.isDirectory()) return false;
  } catch {
    return false;
  }
  const dataFiles = await fs.promises.readdir(path.join(fullPath, 'data')).catch(() => []);
  return dataFiles.some((f) => f.toLowerCase().endsWith('.zip'));
}

// Read back whatever artwork already exists on disk instead of re-downloading
// it, so adopting an orphaned folder never touches the network for images.
async function readArtworkAssets(artworkDir) {
  const files = await fs.promises.readdir(artworkDir).catch(() => []);
  const has = (name) => files.includes(name);
  const screenshots = files
    .filter((f) => /^screenshot_\d+\.jpg$/i.test(f))
    .map((f) => ({ path: path.join(artworkDir, f), order: Number(f.match(/\d+/)[0]) }))
    .sort((a, b) => a.order - b.order);
  return {
    coverPath: has('cover.jpg') ? path.join(artworkDir, 'cover.jpg') : null,
    backgroundPath: has('background.jpg') ? path.join(artworkDir, 'background.jpg') : null,
    screenshots,
  };
}

export function createScanner({ models, igdb, broadcaster, logger = NULL_LOGGER, steamgrid }) {
  const { Library, Game, Screenshot, Job, Setting } = models;
  // Sequelize instance needed for transactions.
  const { sequelize } = Game;
  let running = false;
  let cancelRequested = false;
  let abortController = null;

  const isRunning = () => running;

  function throwIfCancelled() {
    if (cancelRequested) throw new CancelledError();
  }

  function emit(job) {
    broadcaster.broadcast({
      type: 'job',
      jobId: job.id,
      sourceName: job.sourceName,
      stage: job.stage,
      status: job.status,
      progress: job.progress,
      igdbId: job.igdbId,
      error: job.error,
    });
  }

  async function setStage(job, stage, progress) {
    job.stage = stage;
    if (progress != null) job.progress = progress;
    await job.save();
    emit(job);
  }

  async function getSetting() {
    const [setting] = await Setting.findOrCreate({ where: { id: 1 }, defaults: { id: 1 } });
    return setting;
  }

  async function getNamingScheme() {
    return (await getSetting()).namingScheme;
  }

  // Detect candidate inputs: top-level directories and *.zip files,
  // skipping entries that are already known game output folders or sources.
  // Also surfaces `structured`: directories that look like gameledger's own
  // output (artwork/ + data/*.zip) but aren't in the excluded set  i.e. this
  // database doesn't know about them yet. These are never queued as raw
  // input; the caller adopts them instead (see adoptFolder).
  async function detectInputs(libraryPath, namingSchemeArg) {
    const namingScheme = namingSchemeArg ?? (await getNamingScheme());
    const knownGames = await Game.findAll({
      attributes: ['gamePath', 'sourcePath', 'igdbId', 'title', 'releaseYear', 'libraryPath'],
    });

    const excluded = new Set();
    for (const g of knownGames) {
      if (g.sourcePath) excluded.add(g.sourcePath);
      if (g.gamePath) {
        excluded.add(g.gamePath);
      } else if (g.igdbId > 0 && g.libraryPath && g.title) {
        // Reconstruct the expected folder path from the stored identity so a re-scan doesn't treat the
        // already-processed game folder as a fresh source and destroy it
        const reconstructed = path.join(
          g.libraryPath,
          generateFolderName(
            { title: g.title, releaseYear: g.releaseYear, igdbId: g.igdbId },
            namingScheme,
          ),
        );
        if (reconstructed) excluded.add(reconstructed);
      }
    }

    let entries;
    try {
      entries = await fs.promises.readdir(libraryPath, { withFileTypes: true });
    } catch {
      return { inputs: [], structured: [] };
    }
    const inputs = [];
    const structured = [];
    for (const entry of entries) {
      const full = path.join(libraryPath, entry.name);
      if (excluded.has(full)) continue;
      if (entry.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        if (await isStructuredGameFolder(full)) {
          structured.push({ name: entry.name, path: full });
        } else {
          inputs.push({ name: entry.name, path: full });
        }
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.zip')) {
        inputs.push({ name: entry.name, path: full });
      }
    }
    return { inputs, structured };
  }

  // Create or update the catalogued Game row + screenshots for a matched game.
  // Transaction so the game record and its screenshots are always written together
  async function upsertGame(igdbId, data, art, sourceName, { gamePath, archivePath, libraryPath: libPath }) {
    const releaseYear = data.first_release_date
      ? new Date(data.first_release_date * 1000).getUTCFullYear()
      : null;
    const fields = {
      igdbId,
      title: data.name ?? cleanSourceName(sourceName),
      releaseYear,
      summary: data.summary ?? null,
      genres: (data.genres ?? []).map((g) => g.name),
      platforms: (data.platforms ?? []).map((p) => p.name),
      rating: data.rating != null ? Math.round(data.rating) : null,
      coverPath: art.coverPath,
      backgroundPath: art.backgroundPath,
      accentColorPrimary: art.accentPrimary,
      accentColorSecondary: art.accentSecondary,
      trailerVideoId: pickTrailer(data.videos),
      status: GAME_STATUS.COMPLETED,
      sourceName,
      sourcePath: null,
      gamePath,
      archivePath,
      libraryPath: libPath,
    };

    await sequelize.transaction(async (t) => {
      await Game.upsert(fields, { transaction: t });
      await Screenshot.destroy({ where: { igdbId }, transaction: t });
      if (art.screenshots?.length) {
        await Screenshot.bulkCreate(
          art.screenshots.map((s) => ({ igdbId, path: s.path, order: s.order })),
          { transaction: t },
        );
      }
    });
  }

  // Re-catalogue a folder gameledger recognises as its own completed output
  // (artwork/ + data/*.zip) that this database has no row for. Trusts
  // whatever is already on disk  the IGDB ID is read back out of the folder
  // name (or, failing that, the archive name) via the active naming scheme,
  // and existing artwork is reused as-is. Nothing on disk is moved, compressed,
  // or deleted; this only ever adds/updates a Game row.
  async function adoptFolder(entry, libraryPath, namingScheme) {
    const dataDir = path.join(entry.path, 'data');
    const artworkDir = path.join(entry.path, 'artwork');
    const dataFiles = await fs.promises.readdir(dataDir).catch(() => []);
    const zipName = dataFiles.find((f) => f.toLowerCase().endsWith('.zip'));
    if (!zipName) return false;

    const parsed =
      parseFolderName(entry.name, namingScheme) ??
      parseFolderName(zipName.replace(/\.zip$/i, ''), namingScheme);
    if (!parsed) {
      logger.system(
        `"${entry.name}" looks like a gameledger game folder but its IGDB ID couldn't be read from the name skipped`,
        { level: 'warn' },
      );
      return false;
    }
    const igdbId = parsed.igdbId;

    const existing = await Game.findByPk(igdbId);
    if (existing?.gamePath) {
      logger.system(
        `skipped adopting "${entry.name}": igdbId ${igdbId} is already tracked at ${existing.gamePath}`,
        { level: 'warn' },
      );
      return false;
    }

    let data = null;
    try {
      data = await igdb.getGame(igdbId);
    } catch {
      data = null;
    }
    // IGDB unreachable (offline, credentials not yet re-entered after a
    // reinstall, rate-limited, ...): fall back to what the folder name itself
    // encodes rather than cleanSourceName-ing the whole, still scheme-shaped
    // name (which would leave the year/id baked into the title).
    if (!data) {
      data = {
        name: parsed.title ?? cleanSourceName(entry.name),
        first_release_date: parsed.releaseYear ? Date.UTC(parsed.releaseYear, 0, 1) / 1000 : null,
      };
    }

    const { coverPath, backgroundPath, screenshots } = await readArtworkAssets(artworkDir);
    let accentPrimary = null;
    let accentSecondary = null;
    if (coverPath) {
      const colors = await extractColors(coverPath);
      accentPrimary = colors.primary;
      accentSecondary = colors.secondary;
    }

    await upsertGame(
      igdbId,
      data,
      { coverPath, backgroundPath, screenshots, accentPrimary, accentSecondary },
      entry.name,
      { gamePath: entry.path, archivePath: path.join(dataDir, zipName), libraryPath },
    );
    logger.system(`adopted existing folder "${entry.name}" into the library`, { meta: { igdbId } });
    return true;
  }

  async function processJob(job) {
    // Track any game folder created this run so a failed/cancelled job can be
    // rolled back to leave no half-written artifacts.
    let createdGamePath = null;
    try {
      throwIfCancelled();
      job.status = JOB_STATUS.RUNNING;
      await setStage(job, GAME_STATUS.SCANNING, 5);

      const query = cleanSourceName(job.sourceName);
      throwIfCancelled();
      await setStage(job, GAME_STATUS.MATCHING, 15);
      const { match } = await igdb.autoMatch(query);

      if (!match) {
        // Below threshold hold as Unmatched, preserve the source for later
        // correction. This is terminal-but-not-failed.
        const placeholderId = -job.id;
        await Game.upsert({
          igdbId: placeholderId,
          title: query,
          status: GAME_STATUS.UNMATCHED,
          sourceName: job.sourceName,
          sourcePath: job.sourcePath,
          gamePath: null,
          archivePath: null,
          libraryPath: job.libraryPath,
        });
        job.igdbId = placeholderId;
        job.status = JOB_STATUS.COMPLETED;
        await setStage(job, GAME_STATUS.UNMATCHED, 100);
        logger.system(`no confident match for "${query}" left unmatched`, { level: 'warn' });
        return;
      }

      throwIfCancelled();
      job.igdbId = match.id;
      await setStage(job, GAME_STATUS.FETCHING_METADATA, 35);
      logger.system(`fetching metadata for "${match.name ?? query}"`, { meta: { igdbId: match.id } });
      const data = (await igdb.getGame(match.id)) ?? match;

      // Build the named game folder structure inside the library path.
      const namingScheme = await getNamingScheme();
      const releaseYear = data.first_release_date
        ? new Date(data.first_release_date * 1000).getUTCFullYear()
        : null;
      const folderName = generateFolderName(
        { title: data.name ?? query, releaseYear, igdbId: match.id },
        namingScheme,
      );
      const gamePath = path.join(job.libraryPath, folderName);
      const artworkDir = path.join(gamePath, 'artwork');
      const dataDir = path.join(gamePath, 'data');

      await fs.promises.mkdir(artworkDir, { recursive: true });
      await fs.promises.mkdir(dataDir, { recursive: true });
      createdGamePath = gamePath;

      throwIfCancelled();
      const art = await processArtwork(match.id, data, artworkDir, abortController?.signal, steamgrid);

      throwIfCancelled();
      await setStage(job, GAME_STATUS.COMPRESSING, 60);
      const level = (await getSetting()).compressionLevel;
      logger.system(`compressing "${folderName}" to .zip`, { meta: { level } });
      const archiveName = `${folderName}.zip`;
      const archivePath = path.join(dataDir, archiveName);
      const tmpDest = `${archivePath}.tmp`;

      // Compress to a .tmp file in the same directory so the final rename is
      // always atomic (same filesystem as the destination). An abort tears the
      // compression down mid-flight and the partial folder is removed below.
      await createArchive(
        job.sourcePath,
        tmpDest,
        (pct) => {
          job.progress = 60 + Math.floor(pct * 0.39);
          emit(job);
        },
        abortController?.signal,
        level,
      );
      throwIfCancelled();
      await fs.promises.rename(tmpDest, archivePath);

      await upsertGame(match.id, data, art, job.sourceName, {
        gamePath,
        archivePath,
        libraryPath: job.libraryPath,
      });

      // Source removed only after a fully successful pipeline.
      await fs.promises.rm(job.sourcePath, { recursive: true, force: true });

      // Committed keep the folder.
      createdGamePath = null;
      job.status = JOB_STATUS.COMPLETED;
      await setStage(job, GAME_STATUS.COMPLETED, 100);
      logger.system(`catalogued "${data.name ?? folderName}"`, { meta: { igdbId: match.id } });
    } catch (err) {
      // Roll back the partial game folder so a failed/cancelled run leaves the
      // library clean. The source is never touched until the very end, so the
      // original always stays intact.
      if (createdGamePath) {
        await fs.promises.rm(createdGamePath, { recursive: true, force: true }).catch(() => {});
      }
      job.status = JOB_STATUS.FAILED;
      job.error = err?.cancelled
        ? 'Cancelled'
        : err?.message
          ? String(err.message)
          : 'Unknown error';
      await setStage(job, GAME_STATUS.FAILED, job.progress);
      if (!err?.cancelled) {
        logger.system(`failed processing "${job.sourceName}": ${job.error}`, { level: 'error' });
      }
    }
  }

  async function scanAll() {
    if (running) {
      const err = new Error('Scan already in progress');
      err.code = 'SCAN_RUNNING';
      throw err;
    }
    running = true;
    cancelRequested = false;
    abortController = new AbortController();
    try {
      const libraries = await Library.findAll();
      const namingScheme = await getNamingScheme();
      const queued = [];
      let adopted = 0;
      for (const lib of libraries) {
        // eslint-disable-next-line no-await-in-loop
        const { inputs, structured } = await detectInputs(lib.path, namingScheme);
        for (const folder of structured) {
          // eslint-disable-next-line no-await-in-loop
          if (await adoptFolder(folder, lib.path, namingScheme)) adopted += 1;
        }
        for (const input of inputs) {
          // eslint-disable-next-line no-await-in-loop
          const job = await Job.create({
            sourceName: input.name,
            sourcePath: input.path,
            libraryPath: lib.path,
            status: JOB_STATUS.PENDING,
            stage: GAME_STATUS.PENDING,
          });
          queued.push(job);
        }
      }
      logger.system(
        `scan found ${queued.length} new item${queued.length === 1 ? '' : 's'}` +
          (adopted ? `, adopted ${adopted} existing folder${adopted === 1 ? '' : 's'}` : ''),
        { meta: { found: queued.length, adopted } },
      );
      let completed = 0;
      let unmatched = 0;
      let failed = 0;
      for (const job of queued) {
        if (cancelRequested) {
          // Cancelled before this job started mark it failed and move on so
          // the queue drains immediately instead of processing the backlog.
          job.status = JOB_STATUS.FAILED;
          job.error = 'Cancelled';
          // eslint-disable-next-line no-await-in-loop
          await setStage(job, GAME_STATUS.FAILED, 0);
          failed += 1;
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        await processJob(job);
        if (job.stage === GAME_STATUS.COMPLETED) completed += 1;
        else if (job.stage === GAME_STATUS.UNMATCHED) unmatched += 1;
        else failed += 1;
      }
      // One summary event per scan so clients can surface "scan finished" as
      // more than silence  per-job "job" events already cover live progress,
      // but nothing previously told the UI the run as a whole was done.
      broadcaster.broadcast({
        type: 'scan',
        found: queued.length,
        adopted,
        completed,
        unmatched,
        failed,
        cancelled: cancelRequested,
      });
      return { queued: queued.length, adopted, completed, unmatched, failed };
    } finally {
      running = false;
      cancelRequested = false;
      abortController = null;
    }
  }

  /**
   * Request cancellation of the active scan: abort in-flight downloads and
   * compression, and mark every pending/running job failed so the queue and
   * library clear immediately. The in-process guard is released by scanAll's
   * finally block once the aborted job unwinds. Safe to call when idle
   */
  async function cancelScan() {
    cancelRequested = true;
    abortController?.abort();
    const [cancelled] = await Job.update(
      { status: JOB_STATUS.FAILED, error: 'Cancelled', stage: GAME_STATUS.FAILED },
      { where: { status: [JOB_STATUS.PENDING, JOB_STATUS.RUNNING] } },
    );
    if (cancelled) {
      logger.system(`scan cancelled ${cancelled} job${cancelled === 1 ? '' : 's'} stopped`, {
        level: 'warn',
      });
    }
    return { cancelled };
  }

  async function retryJob(jobId) {
    if (running) {
      const err = new Error('Scan already in progress');
      err.code = 'SCAN_RUNNING';
      throw err;
    }
    const job = await Job.findByPk(jobId);
    if (!job) return null;
    running = true;
    cancelRequested = false;
    abortController = new AbortController();
    try {
      job.error = null;
      job.progress = 0;
      await processJob(job);
      return job;
    } finally {
      running = false;
      cancelRequested = false;
      abortController = null;
    }
  }

  /**
   * Reconcile the catalogue with what's actually on disk
   *
   * Pruning rules:
   *  - Completed game with no archivePath  → broken/pre-migration record, prune.
   *  - Completed game whose archivePath is missing from disk → prune.
   *  - Unmatched game with no sourcePath   → source already gone, prune.
   *  - Unmatched game whose sourcePath is missing from disk → prune.
   *
   * Games in any other status (Pending/Scanning/…) are left alone they belong
   * to an active scan or will be handled by the server-restart reset.
   */
  async function refreshLibrary() {
    const games = await Game.findAll();
    let removed = 0;
    for (const game of games) {
      let shouldPrune = false;

      if (game.custom) {
        // Hand-authored games have no scanned source or archive on disk;
        // they're managed entirely through the UI -> skip
        continue;
      }

      if (game.status === GAME_STATUS.COMPLETED) {
        if (!game.archivePath) {
          // No archive path stored record predates the column or the scan
          // failed mid-way and left a stale entry. Can never be served.
          shouldPrune = true;
        } else {
          try {
            // eslint-disable-next-line no-await-in-loop
            await fs.promises.access(game.archivePath);
          } catch {
            shouldPrune = true;
          }
        }
      } else if (game.status === GAME_STATUS.UNMATCHED) {
        if (!game.sourcePath) {
          shouldPrune = true;
        } else {
          try {
            // eslint-disable-next-line no-await-in-loop
            await fs.promises.access(game.sourcePath);
          } catch {
            shouldPrune = true;
          }
        }
      }

      if (shouldPrune) {
        // eslint-disable-next-line no-await-in-loop
        await Screenshot.destroy({ where: { igdbId: game.igdbId } });
        // eslint-disable-next-line no-await-in-loop
        await Game.destroy({ where: { igdbId: game.igdbId } });
        removed += 1;
      }
    }
    return { removed };
  }

  return {
    scanAll,
    processJob,
    retryJob,
    cancelScan,
    refreshLibrary,
    isRunning,
    detectInputs,
  };
}

export default createScanner;
