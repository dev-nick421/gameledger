import axios from 'axios';
import { config } from '../config.js';

const SGDB_BASE = 'https://www.steamgriddb.com/api/v2';

// Portrait grids are the only ones that fit the library's 3:4 cover cards.
const COVER_DIMENSIONS = '600x900,660x930,342x482';
// Covers/heroes are saved as .jpg and colour-extracted, so skip animated and
// WebP assets; NSFW/humor art never belongs in a library.
const IMAGE_FILTERS = { types: 'static', mimes: 'image/jpeg,image/png', nsfw: 'false', humor: 'false' };

// Effective API key: the admin UI (DB) wins, with the env var as a fallback so
// a deployment can preconfigure SteamGridDB without touching the database.
export function resolveSteamGridKey(setting) {
  if (setting?.steamGridDbApiKey) return { key: setting.steamGridDbApiKey, source: 'settings' };
  if (config.steamGridDbApiKey) return { key: config.steamGridDbApiKey, source: 'environment' };
  return { key: null, source: null };
}

function bestByScore(images) {
  if (!Array.isArray(images) || !images.length) return null;
  return [...images].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
}

/**
 * Thin SteamGridDB API v2 client. SteamGridDB knows a game's name, release
 * date and community artwork  no summary, genres, platforms or screenshots.
 */
export function createSteamGridClient({ models }) {
  const { Setting } = models;

  // A plain read, not findOrCreate: artwork lookups run concurrently and
  // SQLite can't run the transactions findOrCreate opens side by side.
  async function getSettings() {
    return Setting.findByPk(1);
  }

  function isConfigured(setting) {
    return Boolean(resolveSteamGridKey(setting).key);
  }

  // GET a SteamGridDB endpoint and unwrap its { success, data } envelope.
  // A 404 means "no such game", which callers treat as an empty result.
  async function request(pathname, params) {
    const { key } = resolveSteamGridKey(await getSettings());
    if (!key) throw new Error('SteamGridDB API key is not configured');
    try {
      const res = await axios.get(`${SGDB_BASE}${pathname}`, {
        timeout: config.igdbTimeoutMs,
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        params,
      });
      if (!res.data?.success) {
        throw new Error(res.data?.errors?.join(', ') || 'Unknown SteamGridDB error');
      }
      return res.data.data;
    } catch (err) {
      if (err.response?.status === 404) return null;
      const detail = err.response?.data?.errors?.join(', ');
      throw new Error(detail ? `SteamGridDB: ${detail}` : err.message);
    }
  }

  async function search(query, limit = 10) {
    const rows = await request(`/search/autocomplete/${encodeURIComponent(String(query))}`);
    return (rows ?? []).slice(0, limit);
  }

  async function getGame(id) {
    return request(`/games/id/${Number(id)}`);
  }

  async function getCover(id) {
    return bestByScore(await request(`/grids/game/${Number(id)}`, { dimensions: COVER_DIMENSIONS, ...IMAGE_FILTERS }));
  }

  async function getHero(id) {
    return bestByScore(await request(`/heroes/game/${Number(id)}`, IMAGE_FILTERS));
  }

  return { isConfigured, search, getGame, getCover, getHero };
}

export default createSteamGridClient;
