import express from 'express';
import cors from 'cors';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { settingsRoutes } from './routes/settings.js';
import { libraryRoutes } from './routes/libraries.js';
import { scanRoutes } from './routes/scan.js';
import multer from 'multer';
import { gameRoutes } from './routes/games.js';
import { igdbRoutes } from './routes/igdb.js';
import { artworkRoutes } from './routes/artwork.js';
import { logRoutes } from './routes/logs.js';

/**
 * Build the Express app from already-constructed dependencies. Keeping wiring
 * out of this factory lets tests inject an in-memory DB and fake services and
 * exercise the whole stack over HTTP.
 */
export function createApp({ models, igdb, scanner, scheduler, logger, namingSchemeProvider }) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use('/api', healthRoutes());
  app.use('/api', authRoutes({ logger }));
  app.use('/api', settingsRoutes({ models, igdb, scheduler, logger }));
  app.use('/api', libraryRoutes({ models, logger }));
  app.use('/api', scanRoutes({ models, scanner, logger }));
  app.use('/api', gameRoutes({ models, igdb, namingSchemeProvider, logger }));
  app.use('/api', igdbRoutes({ igdb }));
  app.use('/api', artworkRoutes({ models }));
  app.use('/api', logRoutes({ models, logger }));

  app.use((err, req, res, _next) => {
    // Rejected uploads (too large, too many files) are client errors, not 500s.
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: `Upload rejected: ${err.message}` });
    }
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

export default createApp;
