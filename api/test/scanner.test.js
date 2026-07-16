import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { createDatabase, GAME_STATUS } from '../src/db/index.js';
import { createBroadcaster } from '../src/ws/broadcaster.js';
import { createIgdbClient } from '../src/services/igdb.js';
import { createScanner } from '../src/services/scanner.js';

function makeGameFolder(root, name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'game.bin'), 'binary game data');
  return dir;
}

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
      if (text.includes('where id = 250616')) {
        return [200, [{ id: 250616, name: 'HELLDIVERS 2', first_release_date: 1707350400 }]];
      }
      if (text.includes('search "Helldivers 2"')) {
        return [200, [{ id: 250616, name: 'HELLDIVERS 2' }]];
      }
      if (text.includes('search "Zzzqqq Mystery"')) {
        return [200, [{ id: 1, name: 'Totally Unrelated Game' }]];
      }
      return [200, []];
    });
}

async function makeScanner() {
  const { sequelize, models } = createDatabase({ storage: ':memory:' });
  await sequelize.sync();
  await models.Setting.upsert({ id: 1, igdbClientId: 'cid', igdbClientSecret: 'csecret' });
  const broadcaster = createBroadcaster();
  const igdb = createIgdbClient({ models });
  const scanner = createScanner({ models, igdb, broadcaster });
  return { sequelize, models, scanner };
}

describe('scan pipeline', () => {
  let ctx;
  let libRoot;

  beforeEach(async () => {
    ctx = await makeScanner();
    libRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-scan-'));
    stubIgdb();
  });

  afterEach(async () => {
    nock.cleanAll();
    await ctx.sequelize.close();
  });

  it('processes a matched folder to Completed, writes archive in library, deletes the source', async () => {
    const source = makeGameFolder(libRoot, 'Helldivers 2');
    await ctx.models.Library.create({ path: libRoot });

    await ctx.scanner.scanAll();

    const game = await ctx.models.Game.findByPk(250616);
    expect(game).toBeTruthy();
    expect(game.status).toBe(GAME_STATUS.COMPLETED);
    expect(game.releaseYear).toBe(2024);

    // Archive must exist at the library-relative path stored in the DB.
    expect(game.archivePath).toBeTruthy();
    expect(fs.existsSync(game.archivePath)).toBe(true);

    // Game folder must be inside the library path.
    expect(game.gamePath).toBeTruthy();
    expect(game.gamePath.startsWith(libRoot)).toBe(true);
    expect(fs.existsSync(game.gamePath)).toBe(true);

    // Subdirs created.
    expect(fs.existsSync(path.join(game.gamePath, 'artwork'))).toBe(true);
    expect(fs.existsSync(path.join(game.gamePath, 'data'))).toBe(true);

    // Source folder removed after success.
    expect(fs.existsSync(source)).toBe(false);
  });

  it('does not re-scan the output game folder on a second scan', async () => {
    makeGameFolder(libRoot, 'Helldivers 2');
    await ctx.models.Library.create({ path: libRoot });

    await ctx.scanner.scanAll();
    const { queued } = await ctx.scanner.scanAll();

    // Second scan should find zero new inputs.
    expect(queued).toBe(0);
  });

  it('holds a low-confidence match as Unmatched and preserves the source', async () => {
    const source = makeGameFolder(libRoot, 'Zzzqqq Mystery');
    await ctx.models.Library.create({ path: libRoot });

    await ctx.scanner.scanAll();

    const unmatched = await ctx.models.Game.findOne({
      where: { status: GAME_STATUS.UNMATCHED },
    });
    expect(unmatched).toBeTruthy();
    expect(unmatched.sourcePath).toBe(source);
    expect(fs.existsSync(source)).toBe(true); // preserved for later correction
  });

  it('refreshLibrary prunes a completed game whose archive was deleted', async () => {
    makeGameFolder(libRoot, 'Helldivers 2');
    await ctx.models.Library.create({ path: libRoot });
    await ctx.scanner.scanAll();

    const game = await ctx.models.Game.findByPk(250616);
    expect(fs.existsSync(game.archivePath)).toBe(true);

    // Simulate the user deleting the game folder from disk.
    fs.rmSync(game.gamePath, { recursive: true, force: true });

    const { removed } = await ctx.scanner.refreshLibrary();
    expect(removed).toBe(1);
    expect(await ctx.models.Game.findByPk(250616)).toBeNull();
  });

  it('refreshLibrary keeps games whose files still exist', async () => {
    makeGameFolder(libRoot, 'Helldivers 2');
    await ctx.models.Library.create({ path: libRoot });
    await ctx.scanner.scanAll();

    const { removed } = await ctx.scanner.refreshLibrary();
    expect(removed).toBe(0);
    expect(await ctx.models.Game.findByPk(250616)).toBeTruthy();
  });

  it('cancelScan marks pending and running jobs as failed', async () => {
    const pending = await ctx.models.Job.create({
      sourceName: 'Queued Game',
      sourcePath: path.join(libRoot, 'Queued Game'),
      status: 'pending',
      stage: GAME_STATUS.PENDING,
    });
    const runningJob = await ctx.models.Job.create({
      sourceName: 'Active Game',
      sourcePath: path.join(libRoot, 'Active Game'),
      status: 'running',
      stage: GAME_STATUS.COMPRESSING,
    });

    const { cancelled } = await ctx.scanner.cancelScan();
    expect(cancelled).toBe(2);

    await pending.reload();
    await runningJob.reload();
    expect(pending.status).toBe('failed');
    expect(pending.error).toBe('Cancelled');
    expect(runningJob.status).toBe('failed');
  });

  it('marks a job Failed and preserves the source when matching errors', async () => {
    nock.cleanAll();
    // No IGDB stubs -> the matching request fails -> job fails.
    nock('https://id.twitch.tv')
      .persist()
      .post('/oauth2/token')
      .query(true)
      .reply(500, 'boom');

    const source = makeGameFolder(libRoot, 'Helldivers 2');
    await ctx.models.Library.create({ path: libRoot });

    await ctx.scanner.scanAll();

    const job = await ctx.models.Job.findOne({ order: [['id', 'DESC']] });
    expect(job.status).toBe('failed');
    expect(fs.existsSync(source)).toBe(true);
  });
});
