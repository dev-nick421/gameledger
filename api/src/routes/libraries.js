import fs from 'node:fs';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

export function libraryRoutes({ models, logger }) {
  const { Library } = models;
  const router = Router();

  router.get('/libraries', requireAuth, async (req, res) => {
    const libraries = await Library.findAll({ order: [['id', 'ASC']] });
    res.json(libraries.map((l) => ({ id: l.id, path: l.path })));
  });

  router.post('/libraries', requireAuth, async (req, res) => {
    const { path: dirPath } = req.body ?? {};
    if (!dirPath || typeof dirPath !== 'string') {
      return res.status(400).json({ error: 'A library path is required' });
    }
    let stat;
    try {
      stat = await fs.promises.stat(dirPath);
    } catch {
      return res.status(400).json({ error: 'Path does not exist or is not accessible' });
    }
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }
    try {
      const library = await Library.create({ path: dirPath });
      logger?.user(`added library path ${library.path}`, { meta: { path: library.path } });
      return res.status(201).json({ id: library.id, path: library.path });
    } catch {
      return res.status(409).json({ error: 'Library path already configured' });
    }
  });

  router.delete('/libraries/:id', requireAuth, async (req, res) => {
    const library = await Library.findByPk(req.params.id);
    const removed = await Library.destroy({ where: { id: req.params.id } });
    if (!removed) return res.status(404).json({ error: 'Library not found' });
    logger?.user(`removed library path ${library?.path ?? req.params.id}`, {
      meta: { path: library?.path },
    });
    return res.status(204).end();
  });

  return router;
}

export default libraryRoutes;
