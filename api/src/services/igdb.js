import axios from 'axios';
import { config } from '../config.js';

const TWITCH_OAUTH_URL = 'https://id.twitch.tv/oauth2/token';
const IGDB_BASE = 'https://api.igdb.com/v4';
export const IGDB_IMAGE_BASE = 'https://images.igdb.com/igdb/image/upload';

// Normalise a title for comparison: lowercase, strip punctuation, collapse space.
function normalise(s) {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Dice coefficient over character bigrams robust to minor naming differences
// like "Helldivers2" vs "HELLDIVERS 2". Returns 0..1.
export function similarity(a, b) {
  const x = normalise(a);
  const y = normalise(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;

  const bigrams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ax = bigrams(x);
  const bx = bigrams(y);
  let overlap = 0;
  let total = 0;
  for (const n of ax.values()) total += n;
  for (const [g, n] of bx) {
    total += n;
    overlap += Math.min(n, ax.get(g) ?? 0);
  }
  return (2 * overlap) / total;
}

export function imageUrl(imageId, size = 't_cover_big') {
  return `${IGDB_IMAGE_BASE}/${size}/${imageId}.jpg`;
}

export function createIgdbClient({ models }) {
  const { Setting } = models;

  async function getSettings() {
    const [setting] = await Setting.findOrCreate({ where: { id: 1 }, defaults: { id: 1 } });
    return setting;
  }

  // Effective credentials: the admin UI (DB) wins, with env vars as a fallback
  // so a deployment can preconfigure IGDB without touching the database.
  function resolveCredentials(setting) {
    return {
      clientId: setting.igdbClientId || config.igdbClientId,
      clientSecret: setting.igdbClientSecret || config.igdbClientSecret,
    };
  }

  // Obtain a valid OAuth token, refreshing via Twitch when missing or within the
  // refresh window. The token + expiry are persisted so they survive restarts.
  async function getToken(setting) {
    const s = setting ?? (await getSettings());
    const { clientId, clientSecret } = resolveCredentials(s);
    if (!clientId || !clientSecret) {
      throw new Error('IGDB credentials are not configured');
    }
    const now = Date.now();
    const expiresAt = s.igdbTokenExpiresAt ? new Date(s.igdbTokenExpiresAt).getTime() : 0;
    if (s.igdbToken && expiresAt - now > config.tokenRefreshWindowMs) {
      return s.igdbToken;
    }

    const res = await axios.post(TWITCH_OAUTH_URL, null, {
      timeout: config.igdbTimeoutMs,
      params: {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      },
    });
    const { access_token: token, expires_in: expiresIn } = res.data;
    s.igdbToken = token;
    s.igdbTokenExpiresAt = new Date(now + expiresIn * 1000);
    await s.save();
    return token;
  }

  async function request(endpoint, body) {
    const setting = await getSettings();
    const token = await getToken(setting);
    const { clientId } = resolveCredentials(setting);
    const res = await axios.post(`${IGDB_BASE}/${endpoint}`, body, {
      timeout: config.igdbTimeoutMs,
      headers: {
        'Client-ID': clientId,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
    return res.data;
  }

  const GAME_FIELDS =
    'fields name, summary, first_release_date, rating, genres.name, platforms.name, ' +
    'cover.image_id, screenshots.image_id, artworks.image_id;';

  async function search(query, limit = 10) {
    const safe = String(query).replace(/"/g, '');
    return request('games', `search "${safe}"; ${GAME_FIELDS} limit ${limit};`);
  }

  async function getGame(igdbId) {
    const rows = await request('games', `where id = ${Number(igdbId)}; ${GAME_FIELDS} limit 1;`);
    return rows[0] ?? null;
  }

  // Pick the best search hit for an auto-match, returning null when nothing
  // clears the confidence threshold so the caller can mark the game Unmatched.
  async function autoMatch(sourceName) {
    const results = await search(sourceName, 10);
    if (!results.length) return { match: null, score: 0, results };
    let best = null;
    let bestScore = 0;
    for (const r of results) {
      const score = similarity(sourceName, r.name);
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    if (bestScore < config.matchThreshold) {
      return { match: null, score: bestScore, results };
    }
    return { match: best, score: bestScore, results };
  }

  return { getToken, search, getGame, autoMatch, getSettings };
}

export default createIgdbClient;
