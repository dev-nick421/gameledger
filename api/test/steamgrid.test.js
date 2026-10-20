import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import nock from 'nock';
import { createDatabase, GAME_STATUS } from '../src/db/index.js';
import { createBroadcaster } from '../src/ws/broadcaster.js';
import { createIgdbClient } from '../src/services/igdb.js';
import { createSteamGridClient } from '../src/services/steamgriddb.js';
import { createMetadataService } from '../src/services/metadata.js';
import { createScanner } from '../src/services/scanner.js';
import { createMetadataRefresher } from '../src/services/metadataRefresh.js';
import { toSteamGridKey } from '../src/services/providerIds.js';
import { config } from '../src/config.js';
import { makeServer, authHeader } from './helpers.js';

const SGDB = 'https://www.steamgriddb.com';
const CDN = 'https://cdn2.steamgriddb.com';

function stubSteamGrid() {
  nock(SGDB)
    .persist()
    .get(/\/api\/v2\/search\/autocomplete\/.*/)
    .reply((uri) => {
      const term = decodeURIComponent(uri.split('/').pop());
      if (/celeste/i.test(term)) {
        return [200, { success: true, data: [{ id: 2590, name: 'Celeste', release_date: 1516665600 }] }];
      }
      if (/witcher 3/i.test(term)) {
        return [200, { success: true, data: [{ id: 3730, name: 'The Witcher 3: Wild Hunt', release_date: 1431993600 }] }];
      }
      return [200, { success: true, data: [] }];
    });
  nock(SGDB)
    .persist()
    .get('/api/v2/games/id/2590')
    .reply(200, { success: true, data: { id: 2590, name: 'Celeste', release_date: 1516665600 } });
  nock(SGDB)
    .persist()
    .get(/\/api\/v2\/grids\/game\/\d+/)
    .query(true)
    .reply(200, {
      success: true,
      data: [
        { id: 1, score: 2, url: `${CDN}/grid/low.png`, thumb: `${CDN}/thumb/low.png` },
        { id: 2, score: 9, url: `${CDN}/grid/best.png`, thumb: `${CDN}/thumb/best.png` },
      ],
    });
  nock(SGDB)
    .persist()
    .get(/\/api\/v2\/heroes\/game\/\d+/)
    .query(true)
    .reply(200, { success: true, data: [{ id: 3, score: 5, url: `${CDN}/hero/hero.png` }] });
  nock(CDN).persist().get(/.*/).reply(200, Buffer.from('fake image bytes'));
}

function stubIgdb() {
  nock('https://id.twitch.tv').persist().post('/oauth2/token').query(true).reply(200, { access_token: 'tok', expires_in: 5000000 });
  nock('https://api.igdb.com')
    .persist()
    .post('/v4/games')
    .reply((uri, body) => {
      const text = String(body);
      if (text.includes('where id = 1942')) {
        return [200, [{
          id: 1942,
          name: 'The Witcher 3: Wild Hunt',
          first_release_date: 1431993600,
          summary: 'Geralt again.',
          cover: { image_id: 'igdbcover' },
          videos: [{ name: 'Launch Trailer', video_id: 'c0i88t0Kacs' }],
        }]];
      }
      return [200, []];
    });
}

async function makeCtx(setting) {
  const { sequelize, models } = createDatabase({ storage: ':memory:' });
  await sequelize.sync();
  await models.Setting.upsert({ id: 1, ...setting });
  const providers = { igdb: createIgdbClient({ models }), steamgrid: createSteamGridClient({ models }) };
  const metadata = createMetadataService(providers);
  const scanner = createScanner({ models, metadata, broadcaster: createBroadcaster() });
  return { sequelize, models, metadata, scanner };
}

describe('SteamGridDB as the only provider', () => {
  let ctx;
  let libRoot;

  beforeEach(async () => {
    ctx = await makeCtx({ steamGridDbApiKey: 'sgdb-key' });
    libRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-sgdb-'));
    stubSteamGrid();
  });

  afterEach(async () => {
    nock.cleanAll();
    await ctx.sequelize.close();
  });

  it('matches by name and returns an offset id', async () => {
    const { match } = await ctx.metadata.autoMatch('Celeste');
    expect(match.id).toBe(toSteamGridKey(2590));
    expect(match.name).toBe('Celeste');
  });

  it('leaves weak matches unmatched', async () => {
    const { match } = await ctx.metadata.autoMatch('Zzzqqq Mystery');
    expect(match).toBeNull();
  });

  it('returns title, year and the best-scored artwork', async () => {
    const data = await ctx.metadata.getGame(toSteamGridKey(2590));
    expect(data.name).toBe('Celeste');
    expect(data.coverUrl).toBe(`${CDN}/grid/best.png`);
    expect(data.backgroundUrl).toBe(`${CDN}/hero/hero.png`);
  });

  it('scans a folder end to end into an sgdb-tagged game folder', async () => {
    const source = path.join(libRoot, 'Celeste');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'game.bin'), 'binary');
    await ctx.models.Library.create({ path: libRoot });

    const summary = await ctx.scanner.scanAll();
    expect(summary.completed).toBe(1);

    const game = await ctx.models.Game.findByPk(toSteamGridKey(2590));
    expect(game.status).toBe(GAME_STATUS.COMPLETED);
    expect(game.title).toBe('Celeste');
    expect(game.releaseYear).toBe(2018);
    expect(path.basename(game.gamePath)).toBe('Celeste - 2018 [sgdb-2590]');
    expect(fs.existsSync(game.coverPath)).toBe(true);
    expect(fs.existsSync(game.archivePath)).toBe(true);
    expect(fs.existsSync(source)).toBe(false);
  });

  it('re-adopts its own sgdb-tagged folder after a database reset', async () => {
    const folder = path.join(libRoot, 'Celeste - 2018 [sgdb-2590]');
    fs.mkdirSync(path.join(folder, 'artwork'), { recursive: true });
    fs.mkdirSync(path.join(folder, 'data'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'data', 'Celeste - 2018 [sgdb-2590].zip'), 'zip');
    await ctx.models.Library.create({ path: libRoot });

    const summary = await ctx.scanner.scanAll();
    expect(summary.adopted).toBe(1);
    const game = await ctx.models.Game.findByPk(toSteamGridKey(2590));
    expect(game.title).toBe('Celeste');
    expect(game.gamePath).toBe(folder);
  });
});

describe('SteamGridDB outages', () => {
  let ctx;
  let libRoot;

  beforeEach(async () => {
    ctx = await makeCtx({ steamGridDbApiKey: 'sgdb-key' });
    libRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-sgdb-down-'));
    nock(SGDB).persist().get('/api/v2/games/id/2590').reply(200, { success: true, data: { id: 2590, name: 'Celeste', release_date: 1516665600 } });
    nock(SGDB).persist().get(/\/api\/v2\/(grids|heroes)\/game\/\d+/).query(true).reply(503, { success: false, errors: ['Service Unavailable'] });
  });

  afterEach(async () => {
    nock.cleanAll();
    await ctx.sequelize.close();
  });

  it('fails an "all" refresh instead of wiping a SteamGridDB-only game\'s artwork', async () => {
    const artwork = path.join(libRoot, 'Celeste - 2018 [sgdb-2590]', 'artwork');
    fs.mkdirSync(artwork, { recursive: true });
    fs.writeFileSync(path.join(artwork, 'cover.jpg'), 'existing cover');
    await ctx.models.Game.create({
      igdbId: toSteamGridKey(2590),
      title: 'Celeste',
      status: GAME_STATUS.COMPLETED,
      coverPath: path.join(artwork, 'cover.jpg'),
      gamePath: path.dirname(artwork),
      archivePath: path.join(path.dirname(artwork), 'data', 'x.zip'),
    });
    const refresher = createMetadataRefresher({ models: ctx.models, metadata: ctx.metadata, broadcaster: { broadcast() {} } });

    const { failed, updated } = await refresher.refreshAll('all');
    expect(failed).toBe(1);
    expect(updated).toBe(0);
    expect(fs.existsSync(path.join(artwork, 'cover.jpg'))).toBe(true);
    expect((await ctx.models.Game.findByPk(toSteamGridKey(2590))).coverPath).toBeTruthy();
  });
});

describe('IGDB and SteamGridDB together', () => {
  let ctx;

  beforeEach(async () => {
    ctx = await makeCtx({ igdbClientId: 'cid', igdbClientSecret: 'csecret', steamGridDbApiKey: 'sgdb-key' });
    stubIgdb();
    stubSteamGrid();
  });

  afterEach(async () => {
    nock.cleanAll();
    await ctx.sequelize.close();
  });

  it('keeps IGDB metadata and prefers SteamGridDB artwork', async () => {
    const data = await ctx.metadata.getGame(1942);
    expect(data.id).toBe(1942);
    expect(data.summary).toBe('Geralt again.');
    expect(data.cover.image_id).toBe('igdbcover');
    expect(data.coverUrl).toBe(`${CDN}/grid/best.png`);
    expect(data.backgroundUrl).toBe(`${CDN}/hero/hero.png`);
  });
});

describe('no provider configured', () => {
  let ctx;

  beforeEach(async () => {
    ctx = await makeCtx({});
  });

  afterEach(async () => {
    await ctx.sequelize.close();
  });

  it('fails the job with a pointer to the Providers settings', async () => {
    const libRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-none-'));
    fs.mkdirSync(path.join(libRoot, 'Celeste'));
    await ctx.models.Library.create({ path: libRoot });

    await ctx.scanner.scanAll();
    const job = await ctx.models.Job.findOne();
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/Settings → Providers/);
  });
});

describe('providers settings API', () => {
  let ctx;
  const original = { ...config };

  beforeEach(async () => {
    ctx = await makeServer();
  });

  afterEach(async () => {
    Object.assign(config, original);
    nock.cleanAll();
    await ctx.sequelize.close();
  });

  it('reports each provider and where its credentials come from', async () => {
    config.igdbClientId = 'env-id';
    config.igdbClientSecret = 'env-secret';
    await request(ctx.app).put('/api/settings').set(authHeader()).send({ steamGridDbApiKey: 'ui-key' });

    const res = await request(ctx.app).get('/api/settings').set(authHeader());
    expect(res.body.igdbConfigured).toBe(true);
    expect(res.body.igdbSource).toBe('environment');
    expect(res.body.steamGridConfigured).toBe(true);
    expect(res.body.steamGridSource).toBe('settings');
    expect(JSON.stringify(res.body)).not.toContain('ui-key');
    expect(JSON.stringify(res.body)).not.toContain('env-secret');
  });

  it('removes a SteamGridDB key saved in the UI', async () => {
    await request(ctx.app).put('/api/settings').set(authHeader()).send({ steamGridDbApiKey: 'ui-key' });
    const res = await request(ctx.app).put('/api/settings').set(authHeader()).send({ steamGridDbApiKey: '' });
    expect(res.body.steamGridConfigured).toBe(false);
    expect(res.body.steamGridSource).toBeNull();
  });

  it('tests the SteamGridDB key with a live probe', async () => {
    stubSteamGrid();
    await request(ctx.app).put('/api/settings').set(authHeader()).send({ steamGridDbApiKey: 'ui-key' });
    nock(SGDB).get(/\/api\/v2\/search\/autocomplete\/the%20witcher/).reply(200, {
      success: true,
      data: [{ id: 1, name: 'The Witcher' }],
    });
    const res = await request(ctx.app).post('/api/settings/test-steamgrid').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('surfaces SteamGridDB errors from the probe', async () => {
    await request(ctx.app).put('/api/settings').set(authHeader()).send({ steamGridDbApiKey: 'bad-key' });
    nock(SGDB).get(/\/api\/v2\/search\/autocomplete\/.*/).reply(401, { success: false, errors: ['Unauthorized'] });
    const res = await request(ctx.app).post('/api/settings/test-steamgrid').set(authHeader());
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unauthorized/);
  });

  it('searches SteamGridDB for the correction modal when IGDB is not set up', async () => {
    stubSteamGrid();
    await request(ctx.app).put('/api/settings').set(authHeader()).send({ steamGridDbApiKey: 'ui-key' });
    const res = await request(ctx.app).get('/api/providers/search?q=Celeste').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      igdbId: toSteamGridKey(2590),
      provider: 'steamgriddb',
      providerId: 2590,
      name: 'Celeste',
      releaseYear: 2018,
      coverUrl: `${CDN}/thumb/best.png`,
    });
  });
});
