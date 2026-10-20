import { describe, it, expect } from 'vitest';
import { applyFilters, buildFacets, isFiltering } from '../src/lib/libraryFilters.js';

const games = [
  { type: 'game', igdbId: 1, title: 'Halo', releaseYear: 2001, genres: ['Shooter'], platforms: ['Xbox', 'PC'], addedAt: '2026-01-02', downloadCount: 5 },
  { type: 'game', igdbId: 2, title: 'celeste', releaseYear: 2018, genres: ['Platform', 'Indie'], platforms: ['PC'], addedAt: '2026-01-03', downloadCount: 9 },
  { type: 'game', igdbId: 3, title: 'Age of Empires', releaseYear: null, genres: ['Strategy'], platforms: ['PC'], addedAt: '2026-01-01', downloadCount: 0 },
  { type: 'job', jobId: 7, title: 'Incoming', status: 'Compressing' },
];
const titles = (items) => items.map((i) => i.title);

describe('library filters', () => {
  it('defaults to recently added with in-progress jobs first', () => {
    expect(titles(applyFilters(games))).toEqual(['Incoming', 'celeste', 'Halo', 'Age of Empires']);
  });

  it('sorts by name both ways, case-insensitively', () => {
    expect(titles(applyFilters(games, { sort: 'name-asc' })).slice(1)).toEqual(['Age of Empires', 'celeste', 'Halo']);
    expect(titles(applyFilters(games, { sort: 'name-desc' })).slice(1)).toEqual(['Halo', 'celeste', 'Age of Empires']);
  });

  it('sorts by release date and keeps unknown years last either way', () => {
    expect(titles(applyFilters(games, { sort: 'release-desc' })).slice(1)).toEqual(['celeste', 'Halo', 'Age of Empires']);
    expect(titles(applyFilters(games, { sort: 'release-asc' })).slice(1)).toEqual(['Halo', 'celeste', 'Age of Empires']);
  });

  it('filters by genre, platform and search text together', () => {
    expect(titles(applyFilters(games, { platform: 'PC', sort: 'name-asc' }))).toEqual(['Age of Empires', 'celeste', 'Halo']);
    expect(titles(applyFilters(games, { platform: 'PC', genre: 'Shooter' }))).toEqual(['Halo']);
    expect(titles(applyFilters(games, { q: 'CEL' }))).toEqual(['celeste']);
  });

  it('builds genre/platform options, most common first', () => {
    const { platforms, genres } = buildFacets(games.filter((g) => g.type === 'game'));
    expect(platforms).toEqual([{ value: 'PC', count: 3 }, { value: 'Xbox', count: 1 }]);
    expect(genres.map((g) => g.value)).toEqual(['Indie', 'Platform', 'Shooter', 'Strategy']);
  });

  it('knows when a filter (not just a sort) is active', () => {
    expect(isFiltering({ q: ' ', genre: '', platform: '' })).toBe(false);
    expect(isFiltering({ q: '', genre: 'RPG' })).toBe(true);
  });
});
