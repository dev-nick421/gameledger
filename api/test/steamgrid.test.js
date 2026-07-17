import { describe, it, expect, afterEach } from 'vitest';
import nock from 'nock';
import { createDatabase } from '../src/db/index.js';
import { createSteamGridClient } from '../src/services/steamgrid.js';

async function freshClient(apiKey) {
  const { sequelize, models } = createDatabase({ storage: ':memory:' });
  await sequelize.sync();
  if (apiKey) await models.Setting.upsert({ id: 1, steamgridApiKey: apiKey });
  return { sequelize, models, steamgrid: createSteamGridClient({ models }) };
}

describe('steamgrid client', () => {
  afterEach(() => nock.cleanAll());

  it('is unconfigured with no key in DB or env', async () => {
    const { sequelize, steamgrid } = await freshClient();
    expect(await steamgrid.isConfigured()).toBe(false);
    await sequelize.close();
  });

  it('finds a cover url via search + grids', async () => {
    const { sequelize, steamgrid } = await freshClient('sg-key');
    nock('https://www.steamgriddb.com')
      .get('/api/v2/search/autocomplete/Halo')
      .reply(200, { success: true, data: [{ id: 42, name: 'Halo' }] });
    nock('https://www.steamgriddb.com')
      .get('/api/v2/grids/game/42')
      .reply(200, { success: true, data: [{ url: 'https://example.com/cover.png' }] });

    const url = await steamgrid.findCoverUrl('Halo');
    expect(url).toBe('https://example.com/cover.png');
    await sequelize.close();
  });

  it('returns null (never throws) when the search has no hits', async () => {
    const { sequelize, steamgrid } = await freshClient('sg-key');
    nock('https://www.steamgriddb.com')
      .get('/api/v2/search/autocomplete/Nonexistent')
      .reply(200, { success: true, data: [] });

    expect(await steamgrid.findCoverUrl('Nonexistent')).toBeNull();
    await sequelize.close();
  });

  it('returns null (never throws) when not configured', async () => {
    const { sequelize, steamgrid } = await freshClient();
    expect(await steamgrid.findCoverUrl('Halo')).toBeNull();
    expect(await steamgrid.findHeroUrl('Halo')).toBeNull();
    await sequelize.close();
  });

  it('surfaces a request failure from testConnection', async () => {
    const { sequelize, steamgrid } = await freshClient('bad-key');
    nock('https://www.steamgriddb.com').get('/api/v2/search/autocomplete/Half-Life').reply(401);

    await expect(steamgrid.testConnection()).rejects.toThrow();
    await sequelize.close();
  });
});
