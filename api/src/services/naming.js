// Generates user-facing display names from the configured naming scheme.
// Physical archives are always {igdb_id}.zip; this is presentation only.
//
// Supported tokens:
//   <Game Name>     -> title
//   <Release Year>  -> releaseYear (omitted segment collapses cleanly)
//   <IGDB_ID>       -> igdbId

export function generateDisplayName(game, scheme) {
  const tmpl = scheme ?? '<Game Name> - <Release Year> [<IGDB_ID>]';
  return tmpl
    .replaceAll('<Game Name>', game.title ?? game.sourceName ?? 'Unknown')
    .replaceAll('<Release Year>', game.releaseYear != null ? String(game.releaseYear) : '')
    .replaceAll('<IGDB_ID>', String(game.igdbId))
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+\[\s*\]/g, '')
    .replace(/-\s*$/, '')
    .trim();
}

// Strip characters unsafe in both Content-Disposition headers and filesystem paths.
export function generateDownloadFilename(game, scheme) {
  const base = generateDisplayName(game, scheme).replace(/[/\\?%*:|"<>]/g, '');
  return `${base}.zip`;
}

// Safe folder name for the filesystem (same sanitisation as filename, no .zip).
export function generateFolderName(game, scheme) {
  return generateDisplayName(game, scheme)
    .replace(/[/\\?%*:|"<>]/g, '')
    .trim();
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Turn a literal chunk of a scheme template into a regex fragment. Whitespace
// is matched loosely (\s*) rather than verbatim because generateDisplayName
// collapses/trims spacing around omitted tokens (e.g. a null release year),
// so the on-disk name never has the template's exact spacing.
function literalToPattern(literal) {
  return literal
    .split(/\s+/)
    .map(escapeRegExp)
    .join('\\s*');
}

// Reverses generateFolderName: given a name that was produced by this scheme,
// recovers the embedded IGDB ID. This lets the scanner recognise a folder as
// gameledger's own structured output even when the database has no record of
// it (fresh install pointed at a previously-arranged library, a library
// copied/restored from another instance, or a folder a user laid out by hand
// in the same scheme). Returns null if the name doesn't fit the scheme.
export function extractIgdbId(name, scheme) {
  if (typeof name !== 'string' || !name.trim()) return null;
  const tmpl = scheme ?? '<Game Name> - <Release Year> [<IGDB_ID>]';
  const tokenRe = /<Game Name>|<Release Year>|<IGDB_ID>/g;
  let pattern = '';
  let lastIndex = 0;
  let idGroup = -1;
  let groupCount = 0;
  let match;
  while ((match = tokenRe.exec(tmpl))) {
    pattern += literalToPattern(tmpl.slice(lastIndex, match.index));
    groupCount += 1;
    if (match[0] === '<IGDB_ID>') {
      idGroup = groupCount;
      pattern += '(\\d+)';
    } else if (match[0] === '<Game Name>') {
      pattern += '(.+?)';
    } else {
      pattern += '(\\d*)';
    }
    lastIndex = tokenRe.lastIndex;
  }
  pattern += literalToPattern(tmpl.slice(lastIndex));
  if (idGroup < 0) return null;

  const m = name.trim().match(new RegExp(`^\\s*${pattern}\\s*$`));
  if (!m) return null;
  const id = Number(m[idGroup]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// A scheme must contain the <IGDB_ID> token. The id is the only token guaranteed
// unique, so requiring it keeps every game folder/zip name collision-free.
export function validateNamingScheme(scheme) {
  if (typeof scheme !== 'string' || !scheme.trim()) {
    return { valid: false, error: 'Naming scheme cannot be empty.' };
  }
  if (!scheme.includes('<IGDB_ID>')) {
    return {
      valid: false,
      error: 'Naming scheme must include the <IGDB_ID> token to keep names unique.',
    };
  }
  return { valid: true };
}

export default {
  generateDisplayName,
  generateDownloadFilename,
  generateFolderName,
  extractIgdbId,
  validateNamingScheme,
};
