import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../src/db/index.js';
import { createIgdbClient, similarity, pickTrailer } from '../src/services/igdb.js';
import { config } from '../src/config.js';
import { mockToken, mockGames, cleanAll } from './igdbMock.js';

async function freshClient() {
  const { sequelize, models } = createDatabase({ storage: ':memory:' });
  await sequelize.sync();
  await models.Setting.upsert({ id: 1, igdbClientId: 'cid', igdbClientSecret: 'csecret' });
  return { sequelize, models, igdb: createIgdbClient({ models }) };
}

describe('igdb client', () => {
  let ctx;
  beforeEach(async () => {
    ctx = await freshClient();
  });
  afterEach(async () => {
    cleanAll();
    await ctx.sequelize.close();
  });

  it('fetches and persists a token on first use', async () => {
    mockToken({ expiresIn: 5000000 });
    mockGames(() => [{ id: 1, name: 'Halo' }]);
    await ctx.igdb.search('halo');
    const setting = await ctx.models.Setting.findByPk(1);
    expect(setting.igdbToken).toBe('fake-token');
    expect(setting.igdbTokenExpiresAt).toBeTruthy();
  });

  it('refreshes a token that is within the refresh window', async () => {
    await ctx.models.Setting.upsert({
      id: 1,
      igdbToken: 'stale',
      igdbTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h inside 24h window
    });
    const tokenCall = mockToken({ expiresIn: 5000000 });
    mockGames(() => []);
    await ctx.igdb.search('halo');
    expect(tokenCall.isDone()).toBe(true);
  });

  it('reuses a token that is comfortably valid', async () => {
    await ctx.models.Setting.upsert({
      id: 1,
      igdbToken: 'good',
      igdbTokenExpiresAt: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000),
    });
    mockGames(() => []);
    const token = await ctx.igdb.getToken();
    expect(token).toBe('good');
  });

  it('auto-matches a close title above threshold', async () => {
    mockToken();
    mockGames(() => [
      { id: 250616, name: 'HELLDIVERS 2' },
      { id: 1, name: 'Some Other Game' },
    ]);
    const { match, score } = await ctx.igdb.autoMatch('Helldivers2');
    expect(match.id).toBe(250616);
    expect(score).toBeGreaterThan(0.6);
  });

  it('returns no match when nothing clears the threshold', async () => {
    mockToken();
    mockGames(() => [{ id: 99, name: 'Completely Different Title' }]);
    const { match } = await ctx.igdb.autoMatch('Helldivers2');
    expect(match).toBeNull();
  });

  it('falls back to env credentials when the DB has none', async () => {
    // No DB credentials this time only env.
    const { sequelize, models } = createDatabase({ storage: ':memory:' });
    await sequelize.sync();
    const igdb = createIgdbClient({ models });

    const prevId = config.igdbClientId;
    const prevSecret = config.igdbClientSecret;
    config.igdbClientId = 'env-id';
    config.igdbClientSecret = 'env-secret';
    try {
      mockToken();
      const token = await igdb.getToken();
      expect(token).toBe('fake-token');
    } finally {
      config.igdbClientId = prevId;
      config.igdbClientSecret = prevSecret;
      await sequelize.close();
    }
  });
});

describe('similarity', () => {
  it('scores identical titles as 1', () => {
    expect(similarity('Halo', 'halo')).toBe(1);
  });
  it('scores unrelated titles low', () => {
    expect(similarity('Halo', 'Cyberpunk 2077')).toBeLessThan(0.3);
  });
});

describe('pickTrailer', () => {
  it('picks a video explicitly named as a trailer', () => {
    const id = pickTrailer([
      { name: 'Gameplay walkthrough', video_id: 'aaaaaaaaaaa' },
      { name: 'Official Launch Trailer', video_id: 'bbbbbbbbbbb' },
    ]);
    expect(id).toBe('bbbbbbbbbbb');
  });

  it('returns null when nothing is confidently a trailer', () => {
    expect(pickTrailer([{ name: 'Developer Diary', video_id: 'ccccccccccc' }])).toBeNull();
  });

  it('returns null for missing/empty video lists', () => {
    expect(pickTrailer(undefined)).toBeNull();
    expect(pickTrailer([])).toBeNull();
  });
});
