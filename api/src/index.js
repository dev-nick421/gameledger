import './loadEnv.js';
import path from 'node:path';
import http from 'node:http';
import { config } from './config.js';
import { buildServer } from './server.js';

// Surface exactly which database file this process opened
console.log(`GameLedger DB: ${path.resolve(config.databasePath)}`);

// Last-resort safety net. Express 4 does not forward errors thrown in async
// route handlers to the error middleware, so a stray rejection would otherwise
// terminate the whole API for every user. Log it and keep serving instead.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

// Guard against shipping a default admin password the session token is a
// deterministic HMAC of it, so a known password means a known admin token.
// In production this is fatal; in dev it's a loud warning so the local loop
// stays frictionless.
const WEAK_PASSWORDS = new Set(['', 'changeme', 'change-me-please']);
if (WEAK_PASSWORDS.has(config.adminPassword)) {
  if (process.env.NODE_ENV === 'production') {
    console.error(
      'FATAL: ADMIN_PASSWORD is unset or still a default value. ' +
        'Set a strong, unique ADMIN_PASSWORD before starting.',
    );
    process.exit(1);
  }
  console.warn(
    'WARNING: ADMIN_PASSWORD is a default value. This is fine for local dev but ' +
      'MUST be set to a strong, unique value before going to production.',
  );
}

const { app, broadcaster, scheduler, models } = await buildServer();

// create the server
const server = http.createServer(app);
broadcaster.attach(server);

// Restore the configured scan schedule on boot.
const [setting] = await models.Setting.findOrCreate({ where: { id: 1 }, defaults: { id: 1 } });
scheduler.reschedule({
  scanSchedule: setting.scanSchedule,
  refreshSchedule: setting.refreshSchedule,
  syncSchedules: setting.syncSchedules,
});

server.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`GameLedger API listening on :${config.port}`);
});
