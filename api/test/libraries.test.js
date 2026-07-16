import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { makeServer, authHeader } from './helpers.js';

describe('libraries', () => {
  let ctx;
  let dir;
  beforeAll(async () => {
    ctx = await makeServer();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-lib-'));
  });
  afterAll(async () => {
    await ctx.sequelize.close();
  });

  it('adds a valid directory', async () => {
    const res = await request(ctx.app).post('/api/libraries').set(authHeader()).send({ path: dir });
    expect(res.status).toBe(201);
    expect(res.body.path).toBe(dir);
  });

  it('rejects a non-existent path', async () => {
    const res = await request(ctx.app)
      .post('/api/libraries')
      .set(authHeader())
      .send({ path: '/does/not/exist/anywhere' });
    expect(res.status).toBe(400);
  });

  it('lists configured libraries', async () => {
    const res = await request(ctx.app).get('/api/libraries').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('removes a library', async () => {
    const list = await request(ctx.app).get('/api/libraries').set(authHeader());
    const id = list.body[0].id;
    const res = await request(ctx.app).delete(`/api/libraries/${id}`).set(authHeader());
    expect(res.status).toBe(204);
  });
});
