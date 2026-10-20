// Search, filter and sort for the library page. Pure functions over the grid
// feed so they're easy to test; the page keeps the state in the URL query.

export const SORTS = [
  { value: 'added', label: 'Recently added' },
  { value: 'release-desc', label: 'Release date (newest)' },
  { value: 'release-asc', label: 'Release date (oldest)' },
  { value: 'name-asc', label: 'Name (A–Z)' },
  { value: 'name-desc', label: 'Name (Z–A)' },
  { value: 'downloads', label: 'Most downloaded' },
];
export const DEFAULT_SORT = 'added';

const byName = (a, b) => (a.title ?? '').localeCompare(b.title ?? '', undefined, { sensitivity: 'base', numeric: true });
const time = (iso) => (iso ? new Date(iso).getTime() : 0);

// Games without a release year sort last whichever direction is chosen.
function byYear(direction) {
  return (a, b) => {
    if (a.releaseYear == null && b.releaseYear == null) return byName(a, b);
    if (a.releaseYear == null) return 1;
    if (b.releaseYear == null) return -1;
    return (a.releaseYear - b.releaseYear) * direction || byName(a, b);
  };
}

const COMPARATORS = {
  added: (a, b) => time(b.addedAt) - time(a.addedAt) || byName(a, b),
  'release-desc': byYear(-1),
  'release-asc': byYear(1),
  'name-asc': byName,
  'name-desc': (a, b) => byName(b, a),
  downloads: (a, b) => (b.downloadCount ?? 0) - (a.downloadCount ?? 0) || byName(a, b),
};

// Distinct values of a list field across games, most common first, with counts.
function facet(games, field) {
  const counts = new Map();
  for (const g of games) {
    for (const value of g[field] ?? []) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, count }));
}

export function buildFacets(games) {
  return { genres: facet(games, 'genres'), platforms: facet(games, 'platforms') };
}

export function isFiltering({ q, genre, platform }) {
  return Boolean((q ?? '').trim() || genre || platform);
}

/**
 * Narrow and order the grid feed. In-progress job cards stay pinned to the top
 * (they're the newest things in the library) until a filter that they can't
 * satisfy is applied.
 */
export function applyFilters(items, { q = '', genre = '', platform = '', sort = DEFAULT_SORT } = {}) {
  const needle = q.trim().toLowerCase();
  const matches = (item) =>
    (!needle || `${item.title ?? ''} ${item.displayName ?? ''}`.toLowerCase().includes(needle)) &&
    (!genre || (item.genres ?? []).includes(genre)) &&
    (!platform || (item.platforms ?? []).includes(platform));

  const jobs = items.filter((i) => i.type === 'job' && matches(i));
  const games = items.filter((i) => i.type !== 'job' && matches(i));
  games.sort(COMPARATORS[sort] ?? COMPARATORS[DEFAULT_SORT]);
  return [...jobs, ...games];
}
