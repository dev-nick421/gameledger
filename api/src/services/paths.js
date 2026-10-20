import fs from 'node:fs';
import path from 'node:path';

// Path comparisons that don't care how a path was spelled ('/games/x/',
// '/games//x', relative vs absolute). Stored paths come from whatever library
// path the admin typed, so exact string equality is not good enough.

export function samePath(a, b) {
  return Boolean(a && b) && path.resolve(a) === path.resolve(b);
}

// `child` is `parent` itself or somewhere inside it.
export function isWithin(child, parent) {
  if (!child || !parent) return false;
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Removing or overwriting `p` would touch `q` (or the other way round).
export function overlaps(p, q) {
  return isWithin(p, q) || isWithin(q, p);
}

// Folders/files other catalogued games depend on: their game folder, or the
// untouched source an Unmatched game is waiting on.
export function ownedPaths(games, exceptId) {
  return games
    .filter((g) => g.igdbId !== exceptId)
    .flatMap((g) => [g.gamePath, g.sourcePath])
    .filter(Boolean);
}

export function touchesAny(p, owned) {
  return Boolean(p) && owned.some((o) => overlaps(p, o));
}

export async function exists(p) {
  if (!p) return false;
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

// The archive inside a game folder ({gamePath}/data/*.zip), or null.
export async function findArchive(gamePath) {
  const dataDir = path.join(gamePath, 'data');
  const files = await fs.promises.readdir(dataDir).catch(() => []);
  const zip = files.find((f) => f.toLowerCase().endsWith('.zip'));
  return zip ? path.join(dataDir, zip) : null;
}
