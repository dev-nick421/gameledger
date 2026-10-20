import { buildServer } from '../src/server.js';
import { issueToken } from '../src/middleware/auth.js';

// Spin up a fully-wired server backed by an isolated in-memory database.
export async function makeServer() {
  const ctx = await buildServer({ storage: ':memory:' });
  return ctx;
}

export function authHeader() {
  return { Authorization: `Bearer ${issueToken()}` };
}

// Seed valid-looking IGDB credentials so token/search flows can run.
export async function configureIgdb(models) {
  await models.Setting.upsert({
    id: 1,
    igdbClientId: 'client-id',
    igdbClientSecret: 'client-secret',
  });
}
