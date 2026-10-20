// Game identity across metadata providers.
//
// The Game primary key is an integer that has always been the IGDB ID. Games
// matched through SteamGridDB (when IGDB isn't configured) need an identity
// too, so their SteamGridDB ID is shifted into a reserved range far above any
// real IGDB ID. That keeps every existing invariant intact: ids stay positive
// integers, unique, and stable, and only negative ids mean custom/unmatched.
export const STEAMGRID_ID_OFFSET = 1_000_000_000;

export const PROVIDER = {
  IGDB: 'igdb',
  STEAMGRIDDB: 'steamgriddb',
  CUSTOM: 'custom',
};

export function isSteamGridKey(id) {
  return Number(id) >= STEAMGRID_ID_OFFSET;
}

export function toSteamGridKey(steamGridId) {
  return STEAMGRID_ID_OFFSET + Number(steamGridId);
}

export function fromSteamGridKey(key) {
  return Number(key) - STEAMGRID_ID_OFFSET;
}

// Which provider a stored game id belongs to.
export function providerOf(id) {
  const n = Number(id);
  if (n < 0) return PROVIDER.CUSTOM;
  return isSteamGridKey(n) ? PROVIDER.STEAMGRIDDB : PROVIDER.IGDB;
}

// The id as the provider itself knows it (null for custom/unmatched games).
export function providerIdOf(id) {
  const n = Number(id);
  if (n < 0) return null;
  return isSteamGridKey(n) ? fromSteamGridKey(n) : n;
}

// How an id is written into folder and download names. SteamGridDB ids carry
// an "sgdb-" prefix so a human (and parseFolderName) can tell them apart.
export function formatProviderId(id) {
  return isSteamGridKey(id) ? `sgdb-${fromSteamGridKey(id)}` : String(id);
}

// Inverse of formatProviderId. Returns null for anything that isn't a valid id.
export function parseProviderId(text) {
  const m = /^(sgdb-)?(\d+)$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const n = Number(m[2]);
  if (!Number.isInteger(n) || n <= 0) return null;
  return m[1] ? toSteamGridKey(n) : n;
}
