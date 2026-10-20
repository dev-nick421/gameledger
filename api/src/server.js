import { createDatabase, syncSchema } from './db/index.js';
import { createBroadcaster } from './ws/broadcaster.js';
import { createLogger } from './services/logger.js';
import { createIgdbClient } from './services/igdb.js';
import { createSteamGridClient } from './services/steamgriddb.js';
import { createMetadataService } from './services/metadata.js';
import { createScanner } from './services/scanner.js';
import { createScheduler } from './services/scheduler.js';
import { createMetadataRefresher } from './services/metadataRefresh.js';
import { createApp } from './app.js';

/**
 * Compose the full application graph. Returns the wired Express app plus the
 * pieces a host (or test) may need: the database, the WS broadcaster, and the
 * scheduler. Used by both the production entry point and the test harness.
 */
export async function buildServer({ storage } = {}) {
  const { sequelize, models } = createDatabase({ storage });
  // Creates missing tables AND backfills any columns an older DB is missing.
  await syncSchema(sequelize, models);

  // Any RUNNING jobs from before a server restart will never complete reset
  // them to FAILED so they appear in the queue as retryable rather than stuck.
  await models.Job.update(
    { status: 'failed', stage: 'Failed', error: 'Interrupted by server restart' },
    { where: { status: 'running' } },
  );

  const broadcaster = createBroadcaster();
  const logger = createLogger({ models });
  const providers = {
    igdb: createIgdbClient({ models }),
    steamgrid: createSteamGridClient({ models }),
  };
  const metadata = createMetadataService(providers);
  const scanner = createScanner({ models, metadata, broadcaster, logger });
  const scheduler = createScheduler({ scanner, logger });
  const metadataRefresher = createMetadataRefresher({ models, metadata, broadcaster, logger });

  // Heal libraries hit by an earlier scan that queued already-catalogued game
  // folders as new input (leaving Unmatched duplicates pointing at the real
  // folders). Database only, so it's safe to run on every boot.
  await scanner.removeDuplicateEntries().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Duplicate cleanup failed:', err);
  });

  const namingSchemeProvider = async () => {
    const [setting] = await models.Setting.findOrCreate({
      where: { id: 1 },
      defaults: { id: 1 },
    });
    return setting.namingScheme;
  };

  const app = createApp({
    models,
    metadata,
    providers,
    scanner,
    scheduler,
    metadataRefresher,
    logger,
    namingSchemeProvider,
  });

  return { app, sequelize, models, broadcaster, logger, metadata, providers, scanner, scheduler, metadataRefresher };
}

export default buildServer;
