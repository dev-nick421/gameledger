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
  validateNamingScheme,
};
