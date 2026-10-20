import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { makeServer, authHeader } from './helpers.js';

describe('auth', () => {
  let ctx;
  beforeAll(async () => {
    ctx = await makeServer();
  });
  afterAll(async () => {
    await ctx.sequelize.close();
  });

  it('rejects a wrong password', async () => {
    const res = await request(ctx.app).post('/api/auth/login').send({ password: 'nope' });
    expect(res.status).toBe(401);
  });

  it('issues a token for the correct password', async () => {
    const res = await request(ctx.app)
      .post('/api/auth/login')
      .send({ password: 'test-secret' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('blocks a protected route without a token', async () => {
    const res = await request(ctx.app).get('/api/settings');
    expect(res.status).toBe(401);
  });

  it('admits a protected route with a valid token', async () => {
    const res = await request(ctx.app).get('/api/settings').set(authHeader());
    expect(res.status).toBe(200);
  });
});
