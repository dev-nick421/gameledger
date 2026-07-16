import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { createDatabase, GAME_STATUS } from '../src/db/index.js';
import { createIgdbClient } from '../src/services/igdb.js';
import { createMetadataRefresher } from '../src/services/metadataRefresh.js';

function stubIgdb() {
  nock('https://id.twitch.tv')
    .persist()
    .post('/oauth2/token')
    .query(true)
    .reply(200, { access_token: 'tok', expires_in: 5000000 });

  nock('https://api.igdb.com')
    .persist()
    .post('/v4/games')
    .reply((uri, body) => {
      const text = String(body);
      if (text.includes('where id = 305152')) {
        return [
          200,
          [
            {
              id: 305152,
              name: 'Clair Obscur: Expedition 33',
              first_release_date: 1735689600,
              summary: 'A turn-based RPG.',
              rating: 92.3,
              genres: [{ name: 'RPG' }],
              platforms: [{ name: 'PC' }],
            },
          ],
        ];
      }
      if (text.includes('where id = 999999')) {
        return [200, []];
      }
      return [200, []];
    });
}

async function makeCtx() {
  const { sequelize, models } = createDatabase({ storage: ':memory:' });
  await sequelize.sync();
  await models.Setting.upsert({ id: 1, igdbClientId: 'cid', igdbClientSecret: 'csecret' });
  const events = [];
  const broadcaster = { broadcast: (e) => events.push(e) };
  const igdb = createIgdbClient({ models });
  const refresher = createMetadataRefresher({ models, igdb, broadcaster });
  return { sequelize, models, refresher, events };
}

function makeGameRow(root, overrides = {}) {
  const gamePath = path.join(root, 'Clair Obscur Expedition 33 - 2025 [305152]');
  const artworkDir = path.join(gamePath, 'artwork');
  const dataDir = path.join(gamePath, 'data');
  fs.mkdirSync(artworkDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(artworkDir, 'cover.jpg'), 'fake cover');
  const archivePath = path.join(dataDir, 'Clair Obscur Expedition 33 - 2025 [305152].zip');
  fs.writeFileSync(archivePath, 'fake archive');
  return {
    igdbId: 305152,
    // Exactly the bug from before this fix: the whole scheme-shaped folder
    // name ended up as the title.
    title: 'Clair Obscur Expedition 33 - 2025 [305152]',
    releaseYear: null,
    summary: null,
    genres: [],
    platforms: [],
    rating: null,
    coverPath: path.join(artworkDir, 'cover.jpg'),
    backgroundPath: null,
    status: GAME_STATUS.COMPLETED,
    custom: false,
    gamePath,
    archivePath,
    libraryPath: root,
    ...overrides,
  };
}

describe('metadata refresher', () => {
  let ctx;
  let libRoot;

  beforeEach(async () => {
    ctx = await makeCtx();
    libRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-meta-'));
    stubIgdb();
  });

  afterEach(async () => {
    nock.cleanAll();
    await ctx.sequelize.close();
  });

  it('"all" mode overwrites a wrong-but-present title and other fields', async () => {
    await ctx.models.Game.create(makeGameRow(libRoot));

    const { total, updated, failed } = await ctx.refresher.refreshAll('all');
    expect(total).toBe(1);
    expect(updated).toBe(1);
    expect(failed).toBe(0);

    const game = await ctx.models.Game.findByPk(305152);
    expect(game.title).toBe('Clair Obscur: Expedition 33');
    expect(game.releaseYear).toBe(2025);
    expect(game.summary).toBe('A turn-based RPG.');
    expect(game.genres).toEqual(['RPG']);
    expect(game.platforms).toEqual(['PC']);
    expect(game.rating).toBe(92);

    // gamePath/archivePath are never touched by a metadata correction.
    expect(game.gamePath).toBe(path.join(libRoot, 'Clair Obscur Expedition 33 - 2025 [305152]'));
  });

  it('"missing" mode fills blanks but never touches an already-wrong title', async () => {
    await ctx.models.Game.create(makeGameRow(libRoot));

    const { total, updated } = await ctx.refresher.refreshAll('missing');
    expect(total).toBe(1);
    expect(updated).toBe(1);

    const game = await ctx.models.Game.findByPk(305152);
    // Title was present (if wrong), so "missing" mode must leave it as-is.
    expect(game.title).toBe('Clair Obscur Expedition 33 - 2025 [305152]');
    // But blank fields get filled in.
    expect(game.releaseYear).toBe(2025);
    expect(game.summary).toBe('A turn-based RPG.');
    expect(game.genres).toEqual(['RPG']);
  });

  it('"missing" mode skips a game with no blank fields', async () => {
    await ctx.models.Game.create(
      makeGameRow(libRoot, {
        releaseYear: 2024,
        summary: 'already there',
        genres: ['RPG'],
        platforms: ['PC'],
        rating: 90,
      }),
    );

    const { total, updated, skipped } = await ctx.refresher.refreshAll('missing');
    expect(total).toBe(0);
    expect(updated).toBe(0);
    expect(skipped).toBe(0);
  });

  it('never touches custom (hand-authored) games', async () => {
    await ctx.models.Game.create(makeGameRow(libRoot, { custom: true, igdbId: 1 }));

    const { total } = await ctx.refresher.refreshAll('all');
    expect(total).toBe(0);
  });

  it('counts a game as failed when IGDB has no match for its id', async () => {
    await ctx.models.Game.create(makeGameRow(libRoot, { igdbId: 999999 }));

    const { total, failed } = await ctx.refresher.refreshAll('all');
    expect(total).toBe(1);
    expect(failed).toBe(1);
  });

  it('broadcasts a completion summary event', async () => {
    await ctx.models.Game.create(makeGameRow(libRoot));

    await ctx.refresher.refreshAll('all');

    const summary = ctx.events.find((e) => e.type === 'metadataRefresh');
    expect(summary).toBeTruthy();
    expect(summary.mode).toBe('all');
    expect(summary.total).toBe(1);
    expect(summary.updated).toBe(1);
  });

  it('rejects a concurrent run while one is in progress', async () => {
    await ctx.models.Game.create(makeGameRow(libRoot));
    const first = ctx.refresher.refreshAll('all');
    await expect(ctx.refresher.refreshAll('all')).rejects.toThrow(/already in progress/);
    await first;
  });
});
