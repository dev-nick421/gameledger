import axios from 'axios';
import { config } from '../config.js';

const STEAMGRID_BASE = 'https://www.steamgriddb.com/api/v2';

/**
 * SteamGridDB client: an art-only provider (issue #8). Unlike IGDB it has no
 * concept of summary/genres/platforms it only supplies grid covers and hero
 * (background) art, searched by name. Configured independently of IGDB so
 * either provider (or both) can be in use at once.
 */
export function createSteamGridClient({ models }) {
  const { Setting } = models;

  async function getSettings() {
    const [setting] = await Setting.findOrCreate({ where: { id: 1 }, defaults: { id: 1 } });
    return setting;
  }

  // DB (admin UI) wins over the env var, same precedence as IGDB.
  async function resolveApiKey(setting) {
    const s = setting ?? (await getSettings());
    return s.steamgridApiKey || config.steamgridApiKey || null;
  }

  async function isConfigured() {
    return Boolean(await resolveApiKey());
  }

  async function request(endpoint) {
    const apiKey = await resolveApiKey();
    if (!apiKey) throw new Error('SteamGridDB API key is not configured');
    const res = await axios.get(`${STEAMGRID_BASE}${endpoint}`, {
      timeout: config.steamgridTimeoutMs,
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.data?.success) throw new Error('SteamGridDB request failed');
    return res.data.data;
  }

  // Fuzzy name search -> candidate SteamGridDB game ids.
  async function searchGame(term) {
    const safe = encodeURIComponent(String(term));
    return request(`/search/autocomplete/${safe}`);
  }

  async function getGrids(gameId) {
    return request(`/grids/game/${gameId}`);
  }

  async function getHeroes(gameId) {
    return request(`/heroes/game/${gameId}`);
  }

  // Best-effort cover/hero URL for a title: search, take the top hit, take its
  // first available image. Any failure (not configured, no match, network)
  // resolves to null rather than throwing, so callers can always treat this as
  // an optional fallback.
  async function findArt(term, fetcher) {
    try {
      const games = await searchGame(term);
      const gameId = games?.[0]?.id;
      if (!gameId) return null;
      const images = await fetcher(gameId);
      return images?.[0]?.url ?? null;
    } catch {
      return null;
    }
  }

  async function findCoverUrl(term) {
    return findArt(term, getGrids);
  }

  async function findHeroUrl(term) {
    return findArt(term, getHeroes);
  }

  // Verify the credentials end-to-end for the admin UI's "Test connection".
  async function testConnection() {
    const results = await searchGame('Half-Life');
    return { ok: true, sample: results?.[0]?.name ?? null };
  }

  return { searchGame, getGrids, getHeroes, findCoverUrl, findHeroUrl, isConfigured, testConnection, getSettings };
}

export default createSteamGridClient;
