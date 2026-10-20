import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { makeServer, authHeader } from './helpers.js';

describe('scan & queue API', () => {
  let ctx;
  beforeEach(async () => {
    ctx = await makeServer();
  });
  afterEach(async () => {
    await ctx.sequelize.close();
  });

  it('rejects a duplicate scan with 409', async () => {
    ctx.scanner.isRunning = () => true; // simulate an in-flight scan
    const res = await request(ctx.app).post('/api/scan').set(authHeader());
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already in progress/i);
  });

  it('accepts a scan trigger', async () => {
    // Stub the worker so the fire-and-forget scan doesn't race teardown.
    ctx.scanner.scanAll = async () => ({ queued: 0 });
    const res = await request(ctx.app).post('/api/scan').set(authHeader());
    expect(res.status).toBe(202);
  });

  it('returns grouped queue state', async () => {
    await ctx.models.Job.create({
      sourceName: 'Broken Game',
      sourcePath: '/tmp/broken',
      status: 'failed',
      stage: 'Failed',
      error: 'kaboom',
    });
    const res = await request(ctx.app).get('/api/queue').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.failed.length).toBe(1);
    expect(res.body.failed[0].error).toBe('kaboom');
  });

  it('404s a retry for an unknown job', async () => {
    const res = await request(ctx.app).post('/api/queue/9999/retry').set(authHeader());
    expect(res.status).toBe(404);
  });

  it('clears a single failed job', async () => {
    const job = await ctx.models.Job.create({
      sourceName: 'Broken Game',
      sourcePath: '/tmp/broken',
      status: 'failed',
      stage: 'Failed',
      error: 'kaboom',
    });
    const res = await request(ctx.app).delete(`/api/queue/${job.id}`).set(authHeader());
    expect(res.status).toBe(200);
    expect(await ctx.models.Job.count()).toBe(0);
  });

  it('refuses to clear a job that is still active', async () => {
    const job = await ctx.models.Job.create({
      sourceName: 'Busy Game',
      sourcePath: '/tmp/busy',
      status: 'running',
      stage: 'Compressing',
    });
    const res = await request(ctx.app).delete(`/api/queue/${job.id}`).set(authHeader());
    expect(res.status).toBe(409);
    expect(await ctx.models.Job.count()).toBe(1);
  });

  it('clears every failed job at once, leaving the rest', async () => {
    const base = { sourcePath: '/tmp/x', stage: 'Failed', error: 'kaboom' };
    await ctx.models.Job.bulkCreate([
      { ...base, sourceName: 'A', status: 'failed' },
      { ...base, sourceName: 'B', status: 'failed' },
      { ...base, sourceName: 'C', status: 'pending', stage: 'Pending' },
    ]);
    const res = await request(ctx.app).delete('/api/queue/failed').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.cleared).toBe(2);
    const left = await ctx.models.Job.findAll();
    expect(left.map((j) => j.sourceName)).toEqual(['C']);
  });

  it('requires auth to clear jobs', async () => {
    expect((await request(ctx.app).delete('/api/queue/failed')).status).toBe(401);
    expect((await request(ctx.app).delete('/api/queue/1')).status).toBe(401);
  });

  it('requires auth to trigger a scan', async () => {
    const res = await request(ctx.app).post('/api/scan');
    expect(res.status).toBe(401);
  });
});
