import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateNamingScheme } from '../services/naming.js';
import { isValidSchedule } from '../services/scheduler.js';
import { resolveIgdbCredentials } from '../services/igdb.js';
import { resolveSteamGridKey } from '../services/steamgriddb.js';

// Secrets are never returned to the client only whether each provider is
// configured, and where from ("settings" = admin UI, "environment" = env vars)
// so the UI can explain why an env-provided key can't be removed there.
function serialize(setting) {
  const igdb = resolveIgdbCredentials(setting);
  const steamGrid = resolveSteamGridKey(setting);
  return {
    igdbConfigured: Boolean(igdb.clientId && igdb.clientSecret),
    igdbSource: igdb.source,
    steamGridConfigured: Boolean(steamGrid.key),
    steamGridSource: steamGrid.source,
    namingScheme: setting.namingScheme,
    scanSchedule: setting.scanSchedule,
    refreshSchedule: setting.refreshSchedule,
    syncSchedules: setting.syncSchedules,
    showRecentlyAdded: setting.showRecentlyAdded,
    librarySections: normaliseSections(setting.librarySections),
    compressionLevel: setting.compressionLevel,
  };
}

// The set of library rails the user can show/hide/reorder. Adding a new
// rail here makes it available everywhere; the stored config is reconciled
// against this list so unknown ids are dropped and new ones appended (hidden).
export const SECTION_IDS = ['recently-added', 'most-downloaded', 'newest-releases'];

// Coerce a stored sections array into a clean, complete, de-duplicated list:
// keep known ids in their saved order, then append any sections the user has
// never seen (default hidden). Guards against older/garbled rows.
export function normaliseSections(stored) {
  const seen = new Set();
  const out = [];
  for (const entry of Array.isArray(stored) ? stored : []) {
    const id = entry?.id;
    if (SECTION_IDS.includes(id) && !seen.has(id)) {
      seen.add(id);
      out.push({ id, visible: Boolean(entry.visible) });
    }
  }
  for (const id of SECTION_IDS) {
    if (!seen.has(id)) out.push({ id, visible: false });
  }
  return out;
}

export function settingsRoutes({ models, providers, scheduler, logger }) {
  const { Setting } = models;
  const router = Router();

  async function getSetting() {
    const [setting] = await Setting.findOrCreate({ where: { id: 1 }, defaults: { id: 1 } });
    return setting;
  }

  router.get('/settings', requireAuth, async (req, res) => {
    const setting = await getSetting();
    res.json(serialize(setting));
  });

  // Public, non-sensitive display preferences the library page needs before a
  // user logs in (e.g. whether to show the "Recently added" rail).
  router.get('/settings/public', async (req, res) => {
    const setting = await getSetting();
    res.json({
      showRecentlyAdded: setting.showRecentlyAdded,
      librarySections: normaliseSections(setting.librarySections),
    });
  });

  router.put('/settings', requireAuth, async (req, res) => {
    const setting = await getSetting();
    const {
      igdbClientId,
      igdbClientSecret,
      steamGridDbApiKey,
      namingScheme,
      scanSchedule,
      refreshSchedule,
      syncSchedules,
      showRecentlyAdded,
      librarySections,
      compressionLevel,
    } = req.body ?? {};

    if (namingScheme !== undefined) {
      const check = validateNamingScheme(namingScheme);
      if (!check.valid) return res.status(400).json({ error: check.error });
      setting.namingScheme = namingScheme;
    }
    if (scanSchedule !== undefined) {
      if (!isValidSchedule(scanSchedule)) return res.status(400).json({ error: 'Invalid scan schedule.' });
      setting.scanSchedule = scanSchedule;
    }
    if (refreshSchedule !== undefined) {
      if (!isValidSchedule(refreshSchedule)) {
        return res.status(400).json({ error: 'Invalid refresh schedule.' });
      }
      setting.refreshSchedule = refreshSchedule;
    }
    if (syncSchedules !== undefined) setting.syncSchedules = Boolean(syncSchedules);

    if (igdbClientId !== undefined) setting.igdbClientId = igdbClientId || null;
    if (igdbClientSecret !== undefined) setting.igdbClientSecret = igdbClientSecret || null;
    if (steamGridDbApiKey !== undefined) setting.steamGridDbApiKey = steamGridDbApiKey || null;
    if (showRecentlyAdded !== undefined) setting.showRecentlyAdded = Boolean(showRecentlyAdded);

    if (librarySections !== undefined) {
      if (!Array.isArray(librarySections)) {
        return res.status(400).json({ error: 'librarySections must be an array.' });
      }
      setting.librarySections = normaliseSections(librarySections);
    }
    if (compressionLevel !== undefined) {
      const lvl = Number(compressionLevel);
      if (!Number.isInteger(lvl) || lvl < 0 || lvl > 9) {
        return res.status(400).json({ error: 'compressionLevel must be an integer from 0 to 9.' });
      }
      setting.compressionLevel = lvl;
    }

    // Changing credentials invalidates any cached token.
    if (igdbClientId !== undefined || igdbClientSecret !== undefined) {
      setting.igdbToken = null;
      setting.igdbTokenExpiresAt = null;
    }
    await setting.save();

    // Re-arm timers if any schedule field changed.
    const scheduleTouched =
      scanSchedule !== undefined || refreshSchedule !== undefined || syncSchedules !== undefined;
    if (scheduleTouched && scheduler) {
      scheduler.reschedule({
        scanSchedule: setting.scanSchedule,
        refreshSchedule: setting.refreshSchedule,
        syncSchedules: setting.syncSchedules,
      });
    }

    // Record which fields were edited for the audit log (never values, since
    // they may include secrets).
    const edited = Object.keys(req.body ?? {});
    if (edited.length) logger?.user(`updated settings (${edited.join(', ')})`, { meta: { fields: edited } });

    res.json(serialize(setting));
  });

  // Verify IGDB credentials end-to-end: fetch a token and run a probe search.
  router.post('/settings/test-igdb', requireAuth, async (req, res) => {
    try {
      const results = await providers.igdb.search('the witcher', 1);
      res.json({ ok: true, sample: results[0]?.name ?? null });
    } catch (err) {
      res.status(400).json({ ok: false, error: err?.message ?? 'IGDB request failed' });
    }
  });

  // Same probe for the SteamGridDB API key.
  router.post('/settings/test-steamgrid', requireAuth, async (req, res) => {
    try {
      const results = await providers.steamgrid.search('the witcher', 1);
      res.json({ ok: true, sample: results[0]?.name ?? null });
    } catch (err) {
      res.status(400).json({ ok: false, error: err?.message ?? 'SteamGridDB request failed' });
    }
  });

  return router;
}

export default settingsRoutes;
