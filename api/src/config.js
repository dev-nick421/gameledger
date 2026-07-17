import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '..');

// Runtime configuration
export const config = {
  port: Number(process.env.PORT ?? 3000),

  // Single-password admin auth
  adminPassword: process.env.ADMIN_PASSWORD ?? 'changeme',

  // SQLite by default
  databasePath:
    process.env.DATABASE_PATH ?? path.join(apiRoot, 'data', 'gameledger.sqlite'),

  // Where hand-authored custom games keep their uploaded artwork. Lives
  // alongside the database so it shares the persisted data volume in Docker.
  customDir:
    process.env.CUSTOM_DIR ??
    path.join(path.dirname(process.env.DATABASE_PATH ?? path.join(apiRoot, 'data', 'gameledger.sqlite')), 'custom'),

  igdbClientId: process.env.IGDB_CLIENT_ID ?? null,
  igdbClientSecret: process.env.IGDB_CLIENT_SECRET ?? null,

  // SteamGridDB: optional, art-only provider (issue #8). Supplements/replaces
  // cover & background art independently of whether IGDB is configured.
  steamgridApiKey: process.env.STEAMGRID_API_KEY ?? null,
  steamgridTimeoutMs: Number(process.env.STEAMGRID_TIMEOUT_MS ?? 15_000),

  // IGDB auto-match: results scoring below this similarity are left Unmatched.
  matchThreshold: Number(process.env.MATCH_THRESHOLD ?? 0.6),

  // Refresh the IGDB OAuth token when fewer than this many ms remain.
  tokenRefreshWindowMs: Number(
    process.env.TOKEN_REFRESH_WINDOW_MS ?? 24 * 60 * 60 * 1000,
  ),

  // Hard ceiling on any single IGDB/Twitch HTTP request so a hung connection
  // can never leave a scan stuck at "Fetching Metadata" forever
  igdbTimeoutMs: Number(process.env.IGDB_TIMEOUT_MS ?? 30_000),

  isTest: process.env.NODE_ENV === 'test',
};

export default config;
