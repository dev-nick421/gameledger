import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { makeServer, authHeader } from './helpers.js';
import { mockToken, mockGames, cleanAll } from './igdbMock.js';

describe('settings', () => {
  let ctx;
  beforeAll(async () => {
    ctx = await makeServer();
  });
  afterAll(async () => {
    await ctx.sequelize.close();
  });
  afterEach(() => cleanAll());

  it('never returns secrets, only a configured flag', async () => {
    await request(ctx.app)
      .put('/api/settings')
      .set(authHeader())
      .send({ igdbClientId: 'cid', igdbClientSecret: 'csecret', namingScheme: '<Game Name> [<IGDB_ID>]' });

    const res = await request(ctx.app).get('/api/settings').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.igdbConfigured).toBe(true);
    expect(res.body.namingScheme).toBe('<Game Name> [<IGDB_ID>]');
    expect(res.body.igdbClientSecret).toBeUndefined();
  });

  it('rejects a naming scheme missing the <IGDB_ID> token', async () => {
    const res = await request(ctx.app)
      .put('/api/settings')
      .set(authHeader())
      .send({ namingScheme: '<Game Name> - <Release Year>' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/IGDB_ID/);
  });

  it('rejects an empty naming scheme', async () => {
    const res = await request(ctx.app)
      .put('/api/settings')
      .set(authHeader())
      .send({ namingScheme: '   ' });
    expect(res.status).toBe(400);
  });

  it('persists scan/refresh schedules and the sync flag', async () => {
    const res = await request(ctx.app)
      .put('/api/settings')
      .set(authHeader())
      .send({ scanSchedule: 'daily', refreshSchedule: 'weekly', syncSchedules: true });
    expect(res.status).toBe(200);
    expect(res.body.scanSchedule).toBe('daily');
    expect(res.body.refreshSchedule).toBe('weekly');
    expect(res.body.syncSchedules).toBe(true);
  });

  it('rejects an invalid schedule value', async () => {
    const res = await request(ctx.app)
      .put('/api/settings')
      .set(authHeader())
      .send({ refreshSchedule: 'fortnightly' });
    expect(res.status).toBe(400);
  });

  it('persists and normalises library sections', async () => {
    const res = await request(ctx.app)
      .put('/api/settings')
      .set(authHeader())
      .send({
        librarySections: [
          { id: 'most-downloaded', visible: true },
          { id: 'bogus', visible: true },
        ],
      });
    expect(res.status).toBe(200);
    // Known id kept first; unknown dropped; missing known ids appended hidden.
    expect(res.body.librarySections[0]).toEqual({ id: 'most-downloaded', visible: true });
    const ids = res.body.librarySections.map((s) => s.id);
    expect(ids).toContain('recently-added');
    expect(ids).toContain('newest-releases');
    expect(ids).not.toContain('bogus');

    // Exposed publicly for the (logged-out) library page.
    const pub = await request(ctx.app).get('/api/settings/public');
    expect(pub.body.librarySections.map((s) => s.id)).toContain('most-downloaded');
  });

  it('validates the compression level range', async () => {
    const ok = await request(ctx.app)
      .put('/api/settings')
      .set(authHeader())
      .send({ compressionLevel: 3 });
    expect(ok.status).toBe(200);
    expect(ok.body.compressionLevel).toBe(3);

    const bad = await request(ctx.app)
      .put('/api/settings')
      .set(authHeader())
      .send({ compressionLevel: 12 });
    expect(bad.status).toBe(400);
  });

  it('verifies IGDB credentials end-to-end', async () => {
    await request(ctx.app)
      .put('/api/settings')
      .set(authHeader())
      .send({ igdbClientId: 'cid', igdbClientSecret: 'csecret' });

    mockToken();
    mockGames(() => [{ id: 1942, name: 'The Witcher 3: Wild Hunt' }]);

    const res = await request(ctx.app).post('/api/settings/test-igdb').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.sample).toMatch(/witcher/i);
  });

  it('reports an error when IGDB credentials are missing', async () => {
    const fresh = await makeServer();
    const res = await request(fresh.app).post('/api/settings/test-igdb').set(authHeader());
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    await fresh.sequelize.close();
  });
});
