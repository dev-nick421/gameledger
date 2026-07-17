import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import nock from 'nock';
import { makeServer, authHeader } from './helpers.js';

function makeGameFolder(root, name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'game.bin'), 'binary game data '.repeat(64));
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
      if (text.includes('where id = 1942')) {
        return [200, [{ id: 1942, name: 'The Witcher 3: Wild Hunt', first_release_date: 1431993600 }]];
      }
      if (text.includes('search "Helldivers 2"')) {
        return [200, [{ id: 250616, name: 'HELLDIVERS 2' }]];
      }
      return [200, []];
    });
}

describe('games API', () => {
  let ctx;
  let libRoot;

  beforeEach(async () => {
    ctx = await makeServer();
    await ctx.models.Setting.upsert({ id: 1, igdbClientId: 'cid', igdbClientSecret: 'csecret' });
    libRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-games-'));
    stubIgdb();
    makeGameFolder(libRoot, 'Helldivers 2');
    await ctx.models.Library.create({ path: libRoot });
    await ctx.scanner.scanAll();
  });

  afterEach(async () => {
    nock.cleanAll();
    await ctx.sequelize.close();
  });

  it('lists the catalogued game in the grid feed', async () => {
    const res = await request(ctx.app).get('/api/games');
    expect(res.status).toBe(200);
    const card = res.body.items.find((i) => i.igdbId === 250616);
    expect(card).toBeTruthy();
    expect(card.status).toBe('Completed');
    expect(card.displayName).toContain('HELLDIVERS 2');
  });

  it('omits failed jobs from the grid feed', async () => {
    await ctx.models.Job.create({
      sourceName: 'Broken Game',
      sourcePath: '/tmp/broken',
      status: 'failed',
      stage: 'Failed',
      error: 'kaboom',
    });
    const res = await request(ctx.app).get('/api/games');
    expect(res.status).toBe(200);
    expect(res.body.items.some((i) => i.title === 'Broken Game')).toBe(false);
  });

  it('sorts games by release date, name, platform and genre', async () => {
    await ctx.models.Game.create({
      igdbId: -100,
      title: 'Alpha Game',
      status: 'Completed',
      custom: true,
      archivePath: '/tmp/alpha.zip',
      releaseYear: 2010,
      platforms: ['Xbox'],
      genres: ['Puzzle'],
    });
    await ctx.models.Game.create({
      igdbId: -101,
      title: 'Zeta Game',
      status: 'Completed',
      custom: true,
      archivePath: '/tmp/zeta.zip',
      releaseYear: 2020,
      platforms: ['Switch'],
      genres: ['Action'],
    });

    const byDateDesc = await request(ctx.app).get('/api/games').query({ sortBy: 'releaseYear', sortDir: 'desc' });
    const idsDesc = byDateDesc.body.items.map((i) => i.igdbId);
    expect(idsDesc.indexOf(-101)).toBeLessThan(idsDesc.indexOf(-100));

    const byNameAsc = await request(ctx.app).get('/api/games').query({ sortBy: 'title', sortDir: 'asc' });
    const idsNameAsc = byNameAsc.body.items.map((i) => i.igdbId);
    expect(idsNameAsc.indexOf(-100)).toBeLessThan(idsNameAsc.indexOf(-101));

    const byGenreAsc = await request(ctx.app).get('/api/games').query({ sortBy: 'genre', sortDir: 'asc' });
    const idsGenreAsc = byGenreAsc.body.items.map((i) => i.igdbId);
    // "Action" < "Puzzle" alphabetically
    expect(idsGenreAsc.indexOf(-101)).toBeLessThan(idsGenreAsc.indexOf(-100));
  });

  it('returns full detail for a game', async () => {
    const res = await request(ctx.app).get('/api/games/250616');
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('HELLDIVERS 2');
    expect(res.body.releaseYear).toBe(2024);
    expect(Array.isArray(res.body.screenshots)).toBe(true);
  });

  it('404s an unknown game', async () => {
    const res = await request(ctx.app).get('/api/games/999999');
    expect(res.status).toBe(404);
  });

  it('streams a download with a friendly filename', async () => {
    const res = await request(ctx.app).get('/api/games/250616/download');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toContain('HELLDIVERS 2');
    expect(res.headers['accept-ranges']).toBe('bytes');
  });

  it('honours a range request with 206', async () => {
    const res = await request(ctx.app).get('/api/games/250616/download').set('Range', 'bytes=0-3');
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toMatch(/^bytes 0-3\//);
  });

  it('reassigns a match: renames the archive and migrates the record', async () => {
    const res = await request(ctx.app)
      .patch('/api/games/250616/match')
      .set(authHeader())
      .send({ new_igdb_id: 1942 });
    expect(res.status).toBe(200);
    expect(res.body.igdbId).toBe(1942);

    // Archive lives inside the library folder at the new display-named path.
    const newGame = await ctx.models.Game.findByPk(1942);
    expect(newGame.archivePath).toBeTruthy();
    expect(fs.existsSync(newGame.archivePath)).toBe(true);
    expect(newGame.archivePath.startsWith(libRoot)).toBe(true);

    const gone = await request(ctx.app).get('/api/games/250616');
    expect(gone.status).toBe(404);
    const moved = await request(ctx.app).get('/api/games/1942');
    expect(moved.status).toBe(200);
    expect(moved.body.title).toMatch(/witcher/i);
  });

  it('counts a download once per transfer', async () => {
    await request(ctx.app).get('/api/games/250616/download').expect(200);
    // Give the fire-and-forget increment a tick to land.
    await new Promise((r) => setTimeout(r, 30));
    const game = await ctx.models.Game.findByPk(250616);
    expect(game.downloadCount).toBe(1);

    // A mid-stream range resume does not re-count.
    await request(ctx.app).get('/api/games/250616/download').set('Range', 'bytes=4-8');
    await new Promise((r) => setTimeout(r, 30));
    const again = await ctx.models.Game.findByPk(250616);
    expect(again.downloadCount).toBe(1);
  });

  it('full CRUD for a custom game', async () => {
    // Create with a cover image.
    const created = await request(ctx.app)
      .post('/api/games')
      .set(authHeader())
      .field('title', 'My Homebrew Game')
      .field('releaseYear', '1999')
      .field('genres', 'Puzzle, Indie')
      .attach('cover', Buffer.from('fake-jpeg-bytes'), 'cover.jpg');
    expect(created.status).toBe(201);
    expect(created.body.igdbId).toBeLessThan(0);
    expect(created.body.coverUrl).toBeTruthy();
    const id = created.body.igdbId;

    // Appears in the management table flagged custom.
    const manage = await request(ctx.app).get('/api/games/manage').set(authHeader());
    expect(manage.status).toBe(200);
    const row = manage.body.items.find((i) => i.igdbId === id);
    expect(row).toBeTruthy();
    expect(row.custom).toBe(true);
    expect(row.releaseYear).toBe(1999);

    // Edit the title.
    const edited = await request(ctx.app)
      .put(`/api/games/${id}`)
      .set(authHeader())
      .field('title', 'My Homebrew Game: Remastered');
    expect(edited.status).toBe(200);
    const detail = await request(ctx.app).get(`/api/games/${id}`);
    expect(detail.body.title).toBe('My Homebrew Game: Remastered');

    // Delete it.
    const del = await request(ctx.app).delete(`/api/games/${id}`).set(authHeader());
    expect(del.status).toBe(200);
    expect(await ctx.models.Game.findByPk(id)).toBeNull();
  });

  it('sets and clears a trailer, accepting a full YouTube URL or a bare id', async () => {
    const created = await request(ctx.app)
      .post('/api/games')
      .set(authHeader())
      .field('title', 'Trailer Test Game');
    const id = created.body.igdbId;

    const withUrl = await request(ctx.app)
      .put(`/api/games/${id}`)
      .set(authHeader())
      .field('trailerVideoId', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(withUrl.status).toBe(200);
    let detail = await request(ctx.app).get(`/api/games/${id}`);
    expect(detail.body.trailerVideoId).toBe('dQw4w9WgXcQ');

    // Garbage input is ignored rather than clobbering the existing value.
    await request(ctx.app).put(`/api/games/${id}`).set(authHeader()).field('trailerVideoId', 'not a url');
    detail = await request(ctx.app).get(`/api/games/${id}`);
    expect(detail.body.trailerVideoId).toBe('dQw4w9WgXcQ');

    // Empty string clears it.
    await request(ctx.app).put(`/api/games/${id}`).set(authHeader()).field('trailerVideoId', '');
    detail = await request(ctx.app).get(`/api/games/${id}`);
    expect(detail.body.trailerVideoId).toBeNull();
  });

  it('rejects a custom game without a title', async () => {
    const res = await request(ctx.app).post('/api/games').set(authHeader()).field('releaseYear', '2000');
    expect(res.status).toBe(400);
  });

  it('requires auth for the management table', async () => {
    const res = await request(ctx.app).get('/api/games/manage');
    expect(res.status).toBe(401);
  });

  it('flags a catalogued game with blank fields as missing metadata', async () => {
    // The setup scan's IGDB stub only returns id/name/first_release_date, so
    // summary/genres/platforms/rating are all still blank.
    const res = await request(ctx.app).get('/api/games/manage').set(authHeader());
    expect(res.status).toBe(200);
    const card = res.body.items.find((i) => i.igdbId === 250616);
    expect(card.missingMetadata).toBe(true);
  });

  it('requires auth to trigger a metadata refresh', async () => {
    const res = await request(ctx.app).post('/api/games/refresh-metadata');
    expect(res.status).toBe(401);
  });

  it('accepts a metadata refresh trigger and rejects a concurrent one', async () => {
    const res = await request(ctx.app)
      .post('/api/games/refresh-metadata')
      .set(authHeader())
      .send({ mode: 'missing' });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ started: true, mode: 'missing' });

    ctx.metadataRefresher.isRunning = () => true; // simulate an in-flight run
    const dup = await request(ctx.app).post('/api/games/refresh-metadata').set(authHeader());
    expect(dup.status).toBe(409);
  });

  it('lists unprocessed library folders', async () => {
    // A fresh folder that has never been scanned should surface as a source.
    makeGameFolder(libRoot, 'Brand New Folder');
    const res = await request(ctx.app).get('/api/games/unprocessed-sources').set(authHeader());
    expect(res.status).toBe(200);
    const names = res.body.sources.map((s) => s.name);
    expect(names).toContain('Brand New Folder');
    // The already-catalogued game's folder must NOT be offered as a source.
    expect(res.body.sources.some((s) => s.name.includes('HELLDIVERS'))).toBe(false);
  });

  it('requires auth to list unprocessed sources', async () => {
    const res = await request(ctx.app).get('/api/games/unprocessed-sources');
    expect(res.status).toBe(401);
  });

  it('processes a selected folder into a downloadable custom game', async () => {
    const src = makeGameFolder(libRoot, 'Indie Darling');
    const res = await request(ctx.app)
      .post('/api/games/process-custom')
      .set(authHeader())
      .field('sourcePath', src)
      .field('title', 'Indie Darling')
      .field('releaseYear', '2021');
    expect(res.status).toBe(201);
    const id = res.body.igdbId;
    expect(id).toBeLessThan(0);

    // A real archive exists on disk inside the library and the source is gone.
    const game = await ctx.models.Game.findByPk(id);
    expect(game.custom).toBe(true);
    expect(game.status).toBe('Completed');
    expect(game.archivePath).toBeTruthy();
    expect(fs.existsSync(game.archivePath)).toBe(true);
    expect(game.archivePath.startsWith(libRoot)).toBe(true);
    expect(fs.existsSync(src)).toBe(false);

    // It is downloadable like any scanned game (a real zip, not download.json).
    const dl = await request(ctx.app).get(`/api/games/${id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('application/zip');

    // And it shows up in the public grid feed.
    const feed = await request(ctx.app).get('/api/games');
    expect(feed.body.items.some((i) => i.igdbId === id)).toBe(true);
  });

  it('rejects a process-custom source outside the library', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-outside-'));
    const res = await request(ctx.app)
      .post('/api/games/process-custom')
      .set(authHeader())
      .field('sourcePath', outside)
      .field('title', 'Sneaky');
    expect(res.status).toBe(400);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('processes an unmatched game when edited manually', async () => {
    // A folder IGDB can't match becomes an Unmatched game holding its source.
    makeGameFolder(libRoot, 'Zzz Totally Unknown Game');
    await ctx.scanner.scanAll();
    const unmatched = (await ctx.models.Game.findAll()).find((g) => g.status === 'Unmatched');
    expect(unmatched).toBeTruthy();
    expect(unmatched.sourcePath).toBeTruthy();

    // Editing it manually runs the full pipeline and completes the game.
    const res = await request(ctx.app)
      .put(`/api/games/${unmatched.igdbId}`)
      .set(authHeader())
      .field('title', 'My Renamed Game')
      .field('releaseYear', '2018');
    expect(res.status).toBe(200);

    const done = await ctx.models.Game.findByPk(unmatched.igdbId);
    expect(done.status).toBe('Completed');
    expect(done.archivePath).toBeTruthy();
    expect(fs.existsSync(done.archivePath)).toBe(true);
    expect(done.sourcePath).toBeNull();
    expect(fs.existsSync(unmatched.sourcePath)).toBe(false);

    // Downloadable, and no longer flagged Unmatched in the feed.
    const dl = await request(ctx.app).get(`/api/games/${unmatched.igdbId}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('application/zip');
  });
});
