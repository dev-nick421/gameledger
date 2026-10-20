import { config } from '../config.js';
import { similarity, pickTrailer } from './igdb.js';
import { PROVIDER, isSteamGridKey, toSteamGridKey, fromSteamGridKey } from './providerIds.js';

const NO_PROVIDER =
  'No metadata provider configured. Add IGDB or SteamGridDB credentials in Settings → Providers.';

// The Game columns a provider controls, derived from its (IGDB-shaped) data.
export function metadataFields(data) {
  return {
    title: data.name ?? null,
    releaseYear: data.first_release_date
      ? new Date(data.first_release_date * 1000).getUTCFullYear()
      : null,
    summary: data.summary ?? null,
    genres: (data.genres ?? []).map((g) => g.name),
    platforms: (data.platforms ?? []).map((p) => p.name),
    rating: data.rating != null ? Math.round(data.rating) : null,
    trailerYoutubeId: pickTrailer(data.videos),
  };
}

function bestMatch(name, candidates) {
  let best = null;
  let score = 0;
  for (const candidate of candidates) {
    const s = similarity(name, candidate.name);
    if (s > score) {
      best = candidate;
      score = s;
    }
  }
  return { best, score };
}

/**
 * The single metadata source the rest of the app talks to, backed by whichever
 * providers are configured:
 *  - IGDB only: identity, metadata and artwork all come from IGDB.
 *  - SteamGridDB only: identity, title, release year and artwork come from
 *    SteamGridDB (it has no summaries, genres, platforms or screenshots).
 *  - Both: IGDB stays the identity and metadata source; SteamGridDB's cover
 *    and hero artwork are preferred, with IGDB's as the fallback.
 *
 * Results are IGDB-shaped so callers never branch on the provider. SteamGridDB
 * games use offset ids (see providerIds.js) and carry their artwork as direct
 * coverUrl/backgroundUrl fields, which processArtwork prefers.
 */
export function createMetadataService({ igdb, steamgrid }) {
  async function status() {
    const setting = await igdb.getSettings();
    return { igdb: igdb.isConfigured(setting), steamgrid: steamgrid.isConfigured(setting) };
  }

  function fromSteamGrid(game) {
    return {
      id: toSteamGridKey(game.id),
      name: game.name,
      first_release_date: game.release_date || null,
      provider: PROVIDER.STEAMGRIDDB,
    };
  }

  // Never fails the caller: missing art just means IGDB's (or none) is used.
  async function steamGridArtwork(steamGridId) {
    const [cover, hero] = await Promise.all([
      steamgrid.getCover(steamGridId).catch(() => null),
      steamgrid.getHero(steamGridId).catch(() => null),
    ]);
    return { coverUrl: cover?.url ?? null, backgroundUrl: hero?.url ?? null };
  }

  // `covers` adds a thumbnail per SteamGridDB result (one extra request each),
  // for pickers that show artwork next to every hit.
  async function search(query, limit = 10, { covers = false } = {}) {
    const available = await status();
    if (available.igdb) return igdb.search(query, limit);
    if (!available.steamgrid) throw new Error(NO_PROVIDER);

    const rows = (await steamgrid.search(query, limit)).map(fromSteamGrid);
    if (covers) {
      await Promise.all(
        rows.map(async (row) => {
          const cover = await steamgrid.getCover(fromSteamGridKey(row.id)).catch(() => null);
          row.coverUrl = cover?.thumb ?? cover?.url ?? null;
        }),
      );
    }
    return rows;
  }

  // Best hit for a scanned folder name, or match: null below the threshold so
  // the caller marks the game Unmatched instead of guessing.
  async function autoMatch(sourceName) {
    if ((await status()).igdb) return igdb.autoMatch(sourceName);
    const results = await search(sourceName, 10);
    const { best, score } = bestMatch(sourceName, results);
    if (!best || score < config.matchThreshold) return { match: null, score, results };
    return { match: best, score, results };
  }

  async function getGame(id) {
    if (isSteamGridKey(id)) {
      const steamGridId = fromSteamGridKey(id);
      const game = await steamgrid.getGame(steamGridId);
      if (!game) return null;
      return { ...fromSteamGrid(game), ...(await steamGridArtwork(steamGridId)) };
    }

    const data = await igdb.getGame(id);
    if (!data?.name || !steamgrid.isConfigured(await igdb.getSettings())) return data;

    // SteamGridDB has no IGDB cross-reference, so find the same game by title.
    // A weak match would put another game's artwork on this one, so it has to
    // clear the same bar as auto-matching does.
    try {
      const { best, score } = bestMatch(data.name, await steamgrid.search(data.name, 5));
      if (!best || score < config.matchThreshold) return data;
      return { ...data, ...(await steamGridArtwork(best.id)) };
    } catch {
      return data;
    }
  }

  return { status, search, autoMatch, getGame };
}

export default createMetadataService;
