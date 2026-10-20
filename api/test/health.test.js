import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { makeServer } from './helpers.js';

describe('health', () => {
  let ctx;
  beforeAll(async () => {
    ctx = await makeServer();
  });
  afterAll(async () => {
    await ctx.sequelize.close();
  });

  it('reports ok', async () => {
    const res = await request(ctx.app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
