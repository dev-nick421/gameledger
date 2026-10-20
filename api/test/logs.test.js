import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { makeServer, authHeader } from './helpers.js';

describe('logs API & logger', () => {
  let ctx;
  beforeEach(async () => {
    ctx = await makeServer();
  });
  afterEach(async () => {
    await ctx.sequelize.close();
  });

  it('persists a row and echoes for every log call', async () => {
    await ctx.logger.system('hello world', { meta: { x: 1 } });
    const count = await ctx.models.Log.count();
    expect(count).toBe(1);
    const row = await ctx.models.Log.findOne();
    expect(row.source).toBe('system');
    expect(row.level).toBe('info');
    expect(row.message).toBe('hello world');
    expect(row.meta).toEqual({ x: 1 });
  });

  it('returns logs newest-first and filters by source', async () => {
    await ctx.logger.user('user did a thing');
    await ctx.logger.scheduler('scheduler tick');
    await ctx.logger.system('system note');

    const all = await request(ctx.app).get('/api/logs').set(authHeader());
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(3);
    // Newest first.
    expect(all.body.items[0].message).toBe('system note');

    const usersOnly = await request(ctx.app).get('/api/logs?source=user').set(authHeader());
    expect(usersOnly.body.total).toBe(1);
    expect(usersOnly.body.items[0].source).toBe('user');
  });

  it('requires auth to read logs', async () => {
    const res = await request(ctx.app).get('/api/logs');
    expect(res.status).toBe(401);
  });

  it('clears the log and records the clear', async () => {
    await ctx.logger.system('one');
    await ctx.logger.system('two');
    const res = await request(ctx.app).delete('/api/logs').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(2);
    // The clear action itself is logged.
    const after = await ctx.models.Log.count();
    expect(after).toBe(1);
    const row = await ctx.models.Log.findOne();
    expect(row.message).toMatch(/cleared the audit log/);
  });
});
