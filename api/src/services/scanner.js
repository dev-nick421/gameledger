import fs from 'node:fs';
import path from 'node:path';
import { GAME_STATUS, JOB_STATUS } from '../db/index.js';
import { processArtwork, extractColors } from './artwork.js';
import { createArchive } from './compression.js';
import { generateFolderName, parseFolderName } from './naming.js';
import { metadataFields } from './metadata.js';
import { exists, findArchive, overlaps, samePath } from './paths.js';

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
// as a "source" once done. The archive is what counts: artwork/ can be
// missing (older builds, failed downloads), so a data/*.zip under a name that
// fits the naming scheme is recognised too.
async function isStructuredGameFolder(fullPath, namingScheme) {
  if (!(await findArchive(fullPath))) return false;
  if (parseFolderName(path.basename(fullPath), namingScheme)) return true;
  try {
    return (await fs.promises.stat(path.join(fullPath, 'artwork'))).isDirectory();
  } catch {
    return false;
  }
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

// `metadata` is the provider-agnostic metadata service (services/metadata.js);
// a bare IGDB client satisfies the same interface.
export function createScanner({ models, metadata, broadcaster, logger = NULL_LOGGER }) {
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
  // input; the caller adopts them instead (see adoptFolder). And `known`:
  // folders whose name carries the id of a game the catalogue already has,
  // found at a path other than the stored one (see relinkFolder).
  async function detectInputs(libraryPath, namingSchemeArg) {
    const namingScheme = namingSchemeArg ?? (await getNamingScheme());
    const knownGames = await Game.findAll({
      attributes: ['gamePath', 'sourcePath', 'igdbId', 'title', 'releaseYear', 'libraryPath'],
    });
    const catalogued = new Set(knownGames.filter((g) => g.igdbId > 0).map((g) => g.igdbId));

    // Resolved, so a path spelled differently from the stored one still matches.
    const excluded = new Set();
    const exclude = (p) => excluded.add(path.resolve(p));
    for (const g of knownGames) {
      if (g.sourcePath) exclude(g.sourcePath);
      if (g.gamePath) {
        exclude(g.gamePath);
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
        if (reconstructed) exclude(reconstructed);
      }
    }

    let entries;
    try {
      entries = await fs.promises.readdir(libraryPath, { withFileTypes: true });
    } catch {
      return { inputs: [], structured: [], known: [] };
    }
    const inputs = [];
    const structured = [];
    const known = [];
    for (const entry of entries) {
      const full = path.join(libraryPath, entry.name);
      if (excluded.has(path.resolve(full))) continue;
      const isDir = entry.isDirectory();
      const isZip = !isDir && entry.isFile() && entry.name.toLowerCase().endsWith('.zip');
      if (!isDir && !isZip) continue;

      // A name in the naming scheme that carries the id of a game already in
      // the catalogue *is* that game, whatever its stored path says (library
      // remounted or moved, path typed differently). It must never become raw
      // input: the scheme-shaped name matches badly, so it would be parked as
      // an Unmatched duplicate whose "source" is the real game folder.
      const parsed = parseFolderName(isZip ? entry.name.replace(/\.zip$/i, '') : entry.name, namingScheme);
      if (parsed && catalogued.has(parsed.igdbId)) {
        if (isDir) known.push({ name: entry.name, path: full, igdbId: parsed.igdbId });
        else logger.system(`skipped "${entry.name}": that game is already in the library`, { level: 'warn' });
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      if (isDir && (await isStructuredGameFolder(full, namingScheme))) {
        structured.push({ name: entry.name, path: full });
      } else {
        inputs.push({ name: entry.name, path: full });
      }
    }
    return { inputs, structured, known };
  }

  // Point a catalogued game at a folder found under a different path than the
  // stored one, when the stored folder no longer exists (library moved or
  // remounted). If the stored folder is still there, the found one is a second
  // copy: it's left alone and reported. Nothing on disk is moved or deleted.
  async function relinkFolder(entry, libraryPath) {
    const game = await Game.findByPk(entry.igdbId);
    if (!game || game.status !== GAME_STATUS.COMPLETED || samePath(game.gamePath, entry.path)) return false;
    if (await exists(game.gamePath)) {
      logger.system(
        `skipped "${entry.name}": "${game.title}" is already in the library at ${game.gamePath}`,
        { level: 'warn', meta: { igdbId: game.igdbId } },
      );
      return false;
    }
    const archivePath = await findArchive(entry.path);
    if (!archivePath) return false;

    const art = await readArtworkAssets(path.join(entry.path, 'artwork'));
    const keep = async (p) => ((await exists(p)) ? p : null);
    const fields = {
      gamePath: entry.path,
      archivePath,
      libraryPath,
      sourcePath: null,
      coverPath: art.coverPath ?? (await keep(game.coverPath)),
      backgroundPath: art.backgroundPath ?? (await keep(game.backgroundPath)),
    };
    await sequelize.transaction(async (t) => {
      await game.update(fields, { transaction: t });
      if (art.screenshots.length) {
        await Screenshot.destroy({ where: { igdbId: game.igdbId }, transaction: t });
        await Screenshot.bulkCreate(
          art.screenshots.map((s) => ({ igdbId: game.igdbId, path: s.path, order: s.order })),
          { transaction: t },
        );
      }
    });
    logger.system(`relinked "${game.title}" to ${entry.path} (its stored folder no longer exists)`, {
      meta: { igdbId: game.igdbId },
    });
    return true;
  }

  /**
   * Remove Unmatched entries that are really a catalogued game seen twice:
   * their "source" is that game's own folder, or a name in the naming scheme
   * carrying its id (a scan that didn't recognise the folder queued it as raw
   * input). Database only: the files belong to the catalogued game and are
   * never touched. If that game's stored folder is gone, it's relinked to the
   * duplicate's folder first.
   */
  async function removeDuplicateEntries() {
    const namingScheme = await getNamingScheme();
    const games = await Game.findAll();
    const byId = new Map(games.map((g) => [g.igdbId, g]));
    let removed = 0;
    for (const dup of games) {
      if (dup.status !== GAME_STATUS.UNMATCHED || !dup.sourcePath) continue;
      const name = path.basename(dup.sourcePath).replace(/\.zip$/i, '');
      const owner =
        games.find((g) => g !== dup && g.gamePath && overlaps(dup.sourcePath, g.gamePath)) ??
        byId.get(parseFolderName(name, namingScheme)?.igdbId);
      if (!owner || owner === dup || owner.status !== GAME_STATUS.COMPLETED) continue;

      // eslint-disable-next-line no-await-in-loop
      if (!(await exists(owner.gamePath)) && (await findArchive(dup.sourcePath))) {
        // eslint-disable-next-line no-await-in-loop
        await relinkFolder(
          { name, path: dup.sourcePath, igdbId: owner.igdbId },
          dup.libraryPath ?? path.dirname(dup.sourcePath),
        );
      }
      // eslint-disable-next-line no-await-in-loop
      await Screenshot.destroy({ where: { igdbId: dup.igdbId } });
      // eslint-disable-next-line no-await-in-loop
      await Game.destroy({ where: { igdbId: dup.igdbId } });
      logger.system(`removed duplicate entry "${dup.title}": its folder belongs to "${owner.title}"`, {
        level: 'warn',
        meta: { igdbId: owner.igdbId, duplicateId: dup.igdbId },
      });
      removed += 1;
    }
    return { removed };
  }

  // Create or update the catalogued Game row + screenshots for a matched game.
  // Transaction so the game record and its screenshots are always written together
  async function upsertGame(igdbId, data, art, sourceName, { gamePath, archivePath, libraryPath: libPath }) {
    const meta = metadataFields(data);
    const fields = {
      igdbId,
      ...meta,
      title: meta.title ?? cleanSourceName(sourceName),
      coverPath: art.coverPath,
      backgroundPath: art.backgroundPath,
      accentColorPrimary: art.accentPrimary,
      accentColorSecondary: art.accentSecondary,
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
      data = await metadata.getGame(igdbId);
    } catch {
      data = null;
    }
    // Provider unreachable (offline, credentials not yet re-entered after a
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
    let tmpDest = null;
    try {
      throwIfCancelled();
      job.status = JOB_STATUS.RUNNING;
      await setStage(job, GAME_STATUS.SCANNING, 5);

      const query = cleanSourceName(job.sourceName);
      throwIfCancelled();
      await setStage(job, GAME_STATUS.MATCHING, 15);
      const { match } = await metadata.autoMatch(query);

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
      const data = (await metadata.getGame(match.id)) ?? match;

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

      // The source already has the target folder's name: building the game
      // folder there would archive it into itself and then delete it.
      if (overlaps(gamePath, job.sourcePath)) {
        throw new Error(`"${job.sourceName}" already has the name its game folder needs; rename it and retry`);
      }
      // The folder may already exist: re-processing a new copy of a game that's
      // already catalogued replaces its archive in place. Anything else living
      // there (another game, or files the library doesn't know) is off limits.
      const occupant = await Game.findOne({ where: { gamePath } });
      const preexisting = await exists(gamePath);
      if (occupant && occupant.igdbId !== match.id) {
        throw new Error(`${gamePath} already belongs to "${occupant.title}"`);
      }
      if (!occupant && preexisting) {
        throw new Error(`${gamePath} already exists and isn't part of the library; move it aside and retry`);
      }

      await fs.promises.mkdir(artworkDir, { recursive: true });
      await fs.promises.mkdir(dataDir, { recursive: true });
      // Only roll back a folder this run created; never an existing game's.
      createdGamePath = preexisting ? null : gamePath;

      throwIfCancelled();
      const art = await processArtwork(match.id, data, artworkDir, abortController?.signal);

      throwIfCancelled();
      await setStage(job, GAME_STATUS.COMPRESSING, 60);
      const level = (await getSetting()).compressionLevel;
      logger.system(`compressing "${folderName}" to .zip`, { meta: { level } });
      const archiveName = `${folderName}.zip`;
      const archivePath = path.join(dataDir, archiveName);
      tmpDest = `${archivePath}.tmp`;

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
      } else if (tmpDest) {
        await fs.promises.rm(tmpDest, { force: true }).catch(() => {});
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
      await removeDuplicateEntries();
      const libraries = await Library.findAll();
      const namingScheme = await getNamingScheme();
      const queued = [];
      let adopted = 0;
      for (const lib of libraries) {
        // eslint-disable-next-line no-await-in-loop
        const { inputs, structured, known } = await detectInputs(lib.path, namingScheme);
        for (const folder of known) {
          // eslint-disable-next-line no-await-in-loop
          await relinkFolder(folder, lib.path);
        }
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
    // A moved/remounted library looks exactly like deleted games; relink what
    // can be found under the library paths before pruning anything.
    await removeDuplicateEntries();
    const namingScheme = await getNamingScheme();
    for (const lib of await Library.findAll()) {
      // eslint-disable-next-line no-await-in-loop
      const { known } = await detectInputs(lib.path, namingScheme);
      for (const folder of known) {
        // eslint-disable-next-line no-await-in-loop
        await relinkFolder(folder, lib.path);
      }
    }
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
    removeDuplicateEntries,
    isRunning,
    detectInputs,
  };
}

export default createScanner;
