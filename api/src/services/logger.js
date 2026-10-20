import { Op } from 'sequelize';
import { LOG_LEVEL, LOG_SOURCE } from '../db/index.js';

// Keep the audit table bounded so a long-running instance never grows the
// SQLite file without limit. Oldest rows are trimmed past this count.
const MAX_LOG_ROWS = 2000;
// Trim in batches so we're not deleting one row per insert.
const TRIM_SLACK = 200;

const CONSOLE_FOR_LEVEL = {
  [LOG_LEVEL.INFO]: console.log,
  [LOG_LEVEL.WARN]: console.warn,
  [LOG_LEVEL.ERROR]: console.error,
};

/**
 * Structured logger:
 *   1. echoes "[source] message" to the console (tagged, level-aware)
 *   2. persists a row in the `logs` table for the Logs page
 *
 * Persistence failures are swallowed and reported to the console only
 */
export function createLogger({ models }) {
  const { Log } = models;
  let sinceLastTrim = 0;

  async function maybeTrim() {
    sinceLastTrim += 1;
    if (sinceLastTrim < TRIM_SLACK) return;
    sinceLastTrim = 0;
    const count = await Log.count();
    if (count <= MAX_LOG_ROWS) return;
    const rows = await Log.findAll({
      attributes: ['id'],
      order: [['id', 'DESC']],
      offset: MAX_LOG_ROWS,
      limit: 1,
    });
    const cutoffId = rows[0]?.id;
    if (cutoffId) await Log.destroy({ where: { id: { [Op.lte]: cutoffId } } });
  }

  async function log(source, message, { level = LOG_LEVEL.INFO, meta = null } = {}) {
    const out = CONSOLE_FOR_LEVEL[level] ?? console.log;
    const suffix = meta ? ` ${JSON.stringify(meta)}` : '';
    // eslint-disable-next-line no-console
    out(`[${source}] ${message}${suffix}`);
    try {
      await Log.create({ source, level, message, meta });
      await maybeTrim();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[system] failed to persist log entry', err?.message ?? err);
    }
  }

  // Convenience wrappers so callers read naturally: logger.scheduler('...').
  const forSource = (source) => (message, opts) => log(source, message, opts);

  return {
    log,
    scheduler: forSource(LOG_SOURCE.SCHEDULER),
    user: forSource(LOG_SOURCE.USER),
    system: forSource(LOG_SOURCE.SYSTEM),
    scanner: forSource(LOG_SOURCE.SCANNER),
  };
}

export default createLogger;
