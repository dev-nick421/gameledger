import { Router } from 'express';
import { JOB_STATUS } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

export function scanRoutes({ models, scanner, logger }) {
  const { Job } = models;
  const router = Router();

  // Trigger a scan. Only one runs at a time a duplicate yields 409.
  router.post('/scan', requireAuth, async (req, res) => {
    if (scanner.isRunning()) {
      return res.status(409).json({ error: 'Scan already in progress' });
    }
    logger?.user('triggered a library scan');
    // Fire-and-forget: progress streams over WebSocket.
    scanner.scanAll().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Scan failed:', err);
    });
    return res.status(202).json({ started: true });
  });

  router.get('/queue', requireAuth, async (req, res) => {
    const jobs = await Job.findAll({ order: [['updatedAt', 'DESC']], limit: 200 });
    const grouped = { running: [], pending: [], failed: [], completed: [] };
    for (const job of jobs) {
      const card = {
        id: job.id,
        sourceName: job.sourceName,
        igdbId: job.igdbId,
        stage: job.stage,
        progress: job.progress,
        error: job.error,
        updatedAt: job.updatedAt,
      };
      if (job.status === JOB_STATUS.RUNNING) grouped.running.push(card);
      else if (job.status === JOB_STATUS.PENDING) grouped.pending.push(card);
      else if (job.status === JOB_STATUS.FAILED) grouped.failed.push(card);
      else grouped.completed.push(card);
    }
    res.json({ ...grouped, isRunning: scanner.isRunning() });
  });

  router.post('/queue/:jobId/retry', requireAuth, async (req, res) => {
    if (scanner.isRunning()) {
      return res.status(409).json({ error: 'Scan already in progress' });
    }
    const job = await Job.findByPk(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    scanner.retryJob(job.id).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Retry failed:', err);
    });
    return res.status(202).json({ retrying: true });
  });

  // Dismiss a failed job so it stops cluttering the queue forever. Only
  // failed jobs can be cleared this way; retry is still the path for
  // running/pending ones.
  router.delete('/queue/:jobId', requireAuth, async (req, res) => {
    const job = await Job.findByPk(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== JOB_STATUS.FAILED) {
      return res.status(409).json({ error: 'Only failed jobs can be cleared' });
    }
    await job.destroy();
    logger?.user(`cleared failed job "${job.sourceName}"`, { meta: { jobId: job.id } });
    res.json({ ok: true });
  });

  // Cancel the active scan: aborts the in-flight game (downloads/compression),
  // discards its partial folder, and clears every pending job. Source files are
  // left untouched. This is the escape hatch for a stuck scan.
  router.delete('/queue', requireAuth, async (req, res) => {
    const { cancelled } = await scanner.cancelScan();
    res.json({ cancelled });
  });

  // Reconcile the library with disk: prune games whose files were deleted from
  // the library folder
  router.post('/library/refresh', requireAuth, async (req, res) => {
    const { removed } = await scanner.refreshLibrary();
    logger?.user(`triggered a library refresh ${removed} game${removed === 1 ? '' : 's'} pruned`, {
      meta: { removed },
    });
    res.json({ removed });
  });

  return router;
}

export default scanRoutes;
