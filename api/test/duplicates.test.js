import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import nock from 'nock';
import { makeServer, authHeader } from './helpers.js';
import { createArchive } from '../src/services/compression.js';
import { GAME_STATUS } from '../src/db/index.js';

const LAYTON = 'Professor Layton and the Phantom Thieves - 2012 [276491]';
const ARCHIVE_BYTES = 'the real game archive '.repeat(200);

function stubIgdb() {
  nock('https://id.twitch.tv').persist().post('/oauth2/token').query(true).reply(200, { access_token: 'tok', expires_in: 5000000 });
  nock('https://api.igdb.com')
    .persist()
    .post('/v4/games')
    .reply((uri, body) => {
      const text = String(body);
      if (text.includes('where id = 276491')) {
        return [200, [{ id: 276491, name: 'Professor Layton and the Phantom Thieves', first_release_date: 1350000000 }]];
      }
      if (text.includes('where id = 42')) {
        return [200, [{ id: 42, name: 'Celeste', first_release_date: 1516665600 }]];
      }
      if (text.includes('search "Celeste')) return [200, [{ id: 42, name: 'Celeste' }]];
      // A scheme-shaped folder name doesn't match anything confidently.
      if (text.includes('search "Professor Layton')) return [200, [{ id: 1, name: "Layton's Mystery Journey" }]];
      return [200, []];
    });
}

// A game folder exactly as gameledger leaves it on disk.
function makeGameFolder(root, name, { artwork = true } = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  if (artwork) {
    fs.mkdirSync(path.join(dir, 'artwork'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'artwork', 'cover.jpg'), 'cover');
  }
  fs.writeFileSync(path.join(dir, 'data', `${name}.zip`), ARCHIVE_BYTES);
  return dir;
}

function catalogued(models, { gamePath, libraryPath }) {
  return models.Game.create({
    igdbId: 276491,
    title: 'Professor Layton and the Phantom Thieves',
    releaseYear: 2012,
    status: GAME_STATUS.COMPLETED,
    gamePath,
    archivePath: path.join(gamePath, 'data', `${LAYTON}.zip`),
    libraryPath,
    downloadCount: 2,
  });
}

// What the broken upgrade left behind: an Unmatched entry whose "source" is
// the catalogued game's own folder.
function duplicate(models, sourcePath, libraryPath) {
  return models.Game.create({
    igdbId: -7,
    title: LAYTON,
    status: GAME_STATUS.UNMATCHED,
    sourceName: LAYTON,
    sourcePath,
    libraryPath,
  });
}

const archiveIntact = (dir) => fs.readFileSync(path.join(dir, 'data', `${LAYTON}.zip`), 'utf8') === ARCHIVE_BYTES;

describe('already-catalogued folders', () => {
  let ctx;
  let lib;

  beforeEach(async () => {
    ctx = await makeServer();
    await ctx.models.Setting.upsert({ id: 1, igdbClientId: 'cid', igdbClientSecret: 'csecret' });
    lib = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-dup-'));
    await ctx.models.Library.create({ path: lib });
    stubIgdb();
  });

  afterEach(async () => {
    nock.cleanAll();
    await ctx.sequelize.close();
  });

  it('are relinked, not re-queued, when the library moved since they were catalogued', async () => {
    const folder = makeGameFolder(lib, LAYTON, { artwork: false });
    await catalogued(ctx.models, { gamePath: path.join('/old/mount', LAYTON), libraryPath: '/old/mount' });

    const summary = await ctx.scanner.scanAll();

    expect(summary.queued).toBe(0);
    expect(await ctx.models.Game.count({ where: { status: GAME_STATUS.UNMATCHED } })).toBe(0);
    const game = await ctx.models.Game.findByPk(276491);
    expect(game.gamePath).toBe(folder);
    expect(game.archivePath).toBe(path.join(folder, 'data', `${LAYTON}.zip`));
    expect(game.downloadCount).toBe(2);
    expect(archiveIntact(folder)).toBe(true);
  });

  it('are relinked by "Refresh library" instead of being pruned as missing', async () => {
    const folder = makeGameFolder(lib, LAYTON);
    await catalogued(ctx.models, { gamePath: path.join('/old/mount', LAYTON), libraryPath: '/old/mount' });

    const { removed } = await ctx.scanner.refreshLibrary();

    expect(removed).toBe(0);
    expect((await ctx.models.Game.findByPk(276491)).gamePath).toBe(folder);
  });

  it('are not duplicated when a second copy turns up under the same name', async () => {
    const original = makeGameFolder(lib, LAYTON);
    await catalogued(ctx.models, { gamePath: original, libraryPath: lib });
    const otherLib = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-dup2-'));
    await ctx.models.Library.create({ path: otherLib });
    makeGameFolder(otherLib, LAYTON);

    const summary = await ctx.scanner.scanAll();

    expect(summary.queued).toBe(0);
    expect(await ctx.models.Game.count()).toBe(1);
    expect((await ctx.models.Game.findByPk(276491)).gamePath).toBe(original);
  });

  it('existing duplicates are removed without touching the files', async () => {
    const folder = makeGameFolder(lib, LAYTON);
    await catalogued(ctx.models, { gamePath: folder, libraryPath: lib });
    await duplicate(ctx.models, folder, lib);

    const { removed } = await ctx.scanner.removeDuplicateEntries();

    expect(removed).toBe(1);
    expect(await ctx.models.Game.findByPk(-7)).toBeNull();
    expect(await ctx.models.Game.findByPk(276491)).not.toBeNull();
    expect(archiveIntact(folder)).toBe(true);
  });

  it('deleting a duplicate entry keeps the folder it shares with the real game', async () => {
    const folder = makeGameFolder(lib, LAYTON);
    await catalogued(ctx.models, { gamePath: folder, libraryPath: lib });
    await duplicate(ctx.models, folder, lib);

    const res = await request(ctx.app).delete('/api/games/-7').set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.keptFiles).toEqual([folder]);
    expect(archiveIntact(folder)).toBe(true);
  });

  it('fixing a duplicate\'s match merges it into the existing game', async () => {
    const folder = makeGameFolder(lib, LAYTON);
    await catalogued(ctx.models, { gamePath: folder, libraryPath: lib });
    await duplicate(ctx.models, folder, lib);

    const res = await request(ctx.app)
      .patch('/api/games/-7/match')
      .set(authHeader())
      .send({ new_igdb_id: 276491 });

    expect(res.status).toBe(200);
    expect(res.body.merged).toBe(true);
    expect(res.body.igdbId).toBe(276491);
    expect(await ctx.models.Game.findByPk(-7)).toBeNull();
    expect(archiveIntact(folder)).toBe(true);
    expect((await ctx.models.Game.findByPk(276491)).downloadCount).toBe(2);
  });

  it('asks before merging a separate copy, then removes only that copy', async () => {
    const folder = makeGameFolder(lib, LAYTON);
    await catalogued(ctx.models, { gamePath: folder, libraryPath: lib });
    const copy = path.join(lib, 'layton_backup');
    fs.mkdirSync(copy);
    fs.writeFileSync(path.join(copy, 'game.nds'), 'rom');
    await duplicate(ctx.models, copy, lib);

    const ask = await request(ctx.app).patch('/api/games/-7/match').set(authHeader()).send({ new_igdb_id: 276491 });
    expect(ask.status).toBe(409);
    expect(ask.body.code).toBe('ALREADY_IN_LIBRARY');
    expect(ask.body.duplicatePath).toBe(copy);
    expect(fs.existsSync(copy)).toBe(true);

    const merge = await request(ctx.app)
      .patch('/api/games/-7/match')
      .set(authHeader())
      .send({ new_igdb_id: 276491, merge: true });
    expect(merge.status).toBe(200);
    expect(fs.existsSync(copy)).toBe(false);
    expect(archiveIntact(folder)).toBe(true);
  });

  it('won\'t process an entry by hand when its folder belongs to another game', async () => {
    const folder = makeGameFolder(lib, LAYTON);
    await catalogued(ctx.models, { gamePath: folder, libraryPath: lib });
    await duplicate(ctx.models, folder, lib);

    const res = await request(ctx.app).put('/api/games/-7').set(authHeader()).field('title', 'Layton');

    expect(res.status).toBe(409);
    expect(archiveIntact(folder)).toBe(true);
  });

  it('fails a scan job instead of archiving a folder into itself', async () => {
    // Raw files in a folder that already carries the name its match produces.
    const folder = path.join(lib, 'Celeste - 2018 [42]');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'game.bin'), 'binary');

    await ctx.scanner.scanAll();

    const job = await ctx.models.Job.findOne();
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/rename it/);
    expect(fs.readFileSync(path.join(folder, 'game.bin'), 'utf8')).toBe('binary');
  });
});

describe('createArchive', () => {
  it('refuses to write the archive inside the folder being archived', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-self-'));
    fs.mkdirSync(path.join(dir, 'data'));
    fs.writeFileSync(path.join(dir, 'data', 'game.zip'), ARCHIVE_BYTES);

    await expect(createArchive(dir, path.join(dir, 'data', 'game.zip'))).rejects.toThrow(/Refusing/);
    expect(fs.readFileSync(path.join(dir, 'data', 'game.zip'), 'utf8')).toBe(ARCHIVE_BYTES);
  });
});
