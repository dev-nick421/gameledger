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

  it('clears a failed job', async () => {
    const job = await ctx.models.Job.create({
      sourceName: 'Broken Game',
      sourcePath: '/tmp/broken',
      status: 'failed',
      stage: 'Failed',
      error: 'kaboom',
    });
    const res = await request(ctx.app).delete(`/api/queue/${job.id}`).set(authHeader());
    expect(res.status).toBe(200);
    expect(await ctx.models.Job.findByPk(job.id)).toBeNull();
  });

  it('404s clearing an unknown job', async () => {
    const res = await request(ctx.app).delete('/api/queue/9999').set(authHeader());
    expect(res.status).toBe(404);
  });

  it('refuses to clear a non-failed job', async () => {
    const job = await ctx.models.Job.create({
      sourceName: 'In Progress',
      sourcePath: '/tmp/inprogress',
      status: 'pending',
      stage: 'Pending',
    });
    const res = await request(ctx.app).delete(`/api/queue/${job.id}`).set(authHeader());
    expect(res.status).toBe(409);
  });

  it('requires auth to clear a job', async () => {
    const res = await request(ctx.app).delete('/api/queue/1');
    expect(res.status).toBe(401);
  });

  it('requires auth to trigger a scan', async () => {
    const res = await request(ctx.app).post('/api/scan');
    expect(res.status).toBe(401);
  });
});
