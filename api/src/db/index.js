import path from 'node:path';
import fs from 'node:fs';
import { Sequelize, DataTypes } from 'sequelize';
import { config } from '../config.js';

// Pipeline / job lifecycle states. Unmatched and Failed are terminal; Unmatched
// is a holding state awaiting manual correction, not an error.
export const GAME_STATUS = {
  PENDING: 'Pending',
  SCANNING: 'Scanning',
  MATCHING: 'Matching',
  FETCHING_METADATA: 'Fetching Metadata',
  COMPRESSING: 'Compressing',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  UNMATCHED: 'Unmatched',
};

export const JOB_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

// Audit log taxonomy
export const LOG_SOURCE = {
  SCHEDULER: 'scheduler',
  USER: 'user',
  SYSTEM: 'system',
  SCANNER: 'scanner',
};

export const LOG_LEVEL = {
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
};

/**
 * Build a Sequelize instance and define all models. Pass `storage: ':memory:'`
 * for tests so each suite gets an isolated database.
 */
export function createDatabase({ storage } = {}) {
  const dbStorage = storage ?? config.databasePath;

  if (dbStorage !== ':memory:') {
    fs.mkdirSync(path.dirname(dbStorage), { recursive: true });
  }

  const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: dbStorage,
    logging: false,
  });

  // Single-row table holding all app settings. Sensitive fields are never
  // serialised to clients (see settings route).
  const Setting = sequelize.define(
    'Setting',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, defaultValue: 1 },
      igdbClientId: { type: DataTypes.STRING, allowNull: true },
      igdbClientSecret: { type: DataTypes.STRING, allowNull: true },
      igdbToken: { type: DataTypes.STRING, allowNull: true },
      igdbTokenExpiresAt: { type: DataTypes.DATE, allowNull: true },
      namingScheme: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: '<Game Name> - <Release Year> [<IGDB_ID>]',
      },
      scanSchedule: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'off', // off | hourly | 6h | daily | weekly
      },
      // Independent cadence for the library refresh (disk reconciliation),
      // separate from scanning. Same vocabulary as scanSchedule.
      refreshSchedule: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'off',
      },
      // When true, a single timer on the scanning cadence runs the refresh
      // first and the scan immediately after, instead of two timers
      syncSchedules: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Library page display toggles (see #23). More rails will follow.
      showRecentlyAdded: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      // Ordered, toggleable library "rails" shown on the home page Each
      // entry is { id, visible }; order in the array is the on-page order. The
      // user reorders/hides these from the Library settings tab or the on-page
      // "arrange" mode. Defaults keep the original Recently-added rail visible.
      librarySections: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [
          { id: 'recently-added', visible: true },
          { id: 'most-downloaded', visible: false },
          { id: 'newest-releases', visible: false },
        ],
      },
      // zlib deflate level used when compressing scanned games. Game data
      // is usually already compressed
      // 0 = store (no compression), 9 = smallest.
      compressionLevel: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
    },
    { tableName: 'settings' },
  );

  const Library = sequelize.define(
    'Library',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      path: { type: DataTypes.STRING, allowNull: false, unique: true },
    },
    { tableName: 'libraries' },
  );

  const Game = sequelize.define(
    'Game',
    {
      // IGDB ID is the canonical identity. Unmatched games use a temporary
      // negative placeholder id until corrected.
      igdbId: { type: DataTypes.INTEGER, primaryKey: true },
      title: { type: DataTypes.STRING, allowNull: false },
      releaseYear: { type: DataTypes.INTEGER, allowNull: true },
      summary: { type: DataTypes.TEXT, allowNull: true },
      genres: { type: DataTypes.JSON, allowNull: true },
      platforms: { type: DataTypes.JSON, allowNull: true },
      rating: { type: DataTypes.INTEGER, allowNull: true },
      coverPath: { type: DataTypes.STRING, allowNull: true },
      backgroundPath: { type: DataTypes.STRING, allowNull: true },
      accentColorPrimary: { type: DataTypes.STRING, allowNull: true },
      accentColorSecondary: { type: DataTypes.STRING, allowNull: true },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: GAME_STATUS.PENDING,
      },
      // Original folder/zip name as found on disk used for re-matching and
      // as the display fallback for Unmatched games.
      sourceName: { type: DataTypes.STRING, allowNull: true },
      // Absolute source path, retained only for Unmatched games so a later
      // correction can compress the original and delete it. Null once Completed.
      sourcePath: { type: DataTypes.STRING, allowNull: true },
      // Absolute path to the named game folder inside the library:
      //   {libraryPath}/{displayName}/
      // Null for Unmatched games (name not yet known).
      gamePath: { type: DataTypes.STRING, allowNull: true },
      // Absolute path to the compressed archive:
      //   {gamePath}/data/{displayName}.zip
      archivePath: { type: DataTypes.STRING, allowNull: true },
      // Which library this game belongs to (needed for re-matching/moving).
      libraryPath: { type: DataTypes.STRING, allowNull: true },
      // Number of completed downloads ("Most downloaded" rail)
      downloadCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      // True for games created by hand via the management UI. Custom games
      // have no scanned source/archive, so the disk-reconciliation refresh must
      // not prune them for a missing archivePath.
      custom: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    { tableName: 'games' },
  );

  const Screenshot = sequelize.define(
    'Screenshot',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      igdbId: { type: DataTypes.INTEGER, allowNull: false },
      path: { type: DataTypes.STRING, allowNull: false },
      order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    { tableName: 'screenshots' },
  );

  const Job = sequelize.define(
    'Job',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      igdbId: { type: DataTypes.INTEGER, allowNull: true },
      sourceName: { type: DataTypes.STRING, allowNull: false },
      sourcePath: { type: DataTypes.STRING, allowNull: false },
      libraryPath: { type: DataTypes.STRING, allowNull: true },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: JOB_STATUS.PENDING,
      },
      stage: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: GAME_STATUS.PENDING,
      },
      progress: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      error: { type: DataTypes.TEXT, allowNull: true },
    },
    { tableName: 'jobs' },
  );

  // Append-only audit/event log backing the Logs page. Every notable
  // action scheduler ticks, user edits, scan/refresh lifecycle lands here
  // + echoed to the console with [source] tag
  const Log = sequelize.define(
    'Log',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      // Who/what produced the entry: scheduler | user | system | scanner.
      source: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      // info | warn | error drives colour in the UI.
      level: { type: DataTypes.STRING, allowNull: false, defaultValue: 'info' },
      message: { type: DataTypes.TEXT, allowNull: false },
      // Optional structured context (counts, ids, names).
      meta: { type: DataTypes.JSON, allowNull: true },
    },
    { tableName: 'logs', updatedAt: false },
  );

  Game.hasMany(Screenshot, { foreignKey: 'igdbId', sourceKey: 'igdbId', as: 'screenshots' });
  Screenshot.belongsTo(Game, { foreignKey: 'igdbId', targetKey: 'igdbId' });

  return {
    sequelize,
    models: { Setting, Library, Game, Screenshot, Job, Log },
  };
}

/**
 * Non-destructive schema sync. `sequelize.sync()` creates missing tables but
 * never adds columns to existing ones, so a database created by an older build
 * is missing newly-added columns (e.g. Setting.showRecentlyAdded). This walks
 * every model and ADDs any column the live table lacks, preserving all data.
 * Phase 1 stand-in until proper migrations land.
 */
export async function syncSchema(sequelize, models) {
  await sequelize.sync();
  const qi = sequelize.getQueryInterface();
  for (const model of Object.values(models)) {
    const tableName = model.getTableName();
    let existing;
    try {
      existing = await qi.describeTable(tableName);
    } catch {
      continue; // table will have been created by sync; skip on any oddity
    }
    for (const attr of Object.values(model.rawAttributes)) {
      const column = attr.field ?? attr.fieldName;
      if (column && !existing[column]) {
        // eslint-disable-next-line no-await-in-loop
        await qi.addColumn(tableName, column, attr);
      }
    }
  }
}

export default createDatabase;
