import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { imageUrl } from './igdb.js';

// Downloads provider artwork (IGDB, SteamGridDB) to local disk at scan time so
// the library works fully offline afterwards, and extracts dominant accent
// colours for the hero gradient. The browser never touches a provider CDN.

async function tryDownload(url, dest, signal) {
  try {
    const res = await axios.get(url, { responseType: 'arraybuffer', signal, timeout: 30_000 });
    await fs.promises.writeFile(dest, Buffer.from(res.data));
    return dest;
  } catch {
    return null;
  }
}

// Defensive colour extraction: a failure here must never fail a scan, so we
// fall back to null and the UI uses its default gradient.
export async function extractColors(imagePath) {
  try {
    const { default: Vibrant } = await import('node-vibrant');
    const palette = await Vibrant.from(imagePath).getPalette();
    const primary =
      palette.Vibrant?.hex ?? palette.DarkVibrant?.hex ?? palette.Muted?.hex ?? null;
    const secondary =
      palette.DarkMuted?.hex ?? palette.Muted?.hex ?? palette.LightVibrant?.hex ?? null;
    return { primary, secondary };
  } catch {
    return { primary: null, secondary: null };
  }
}

// First source that downloads wins, so a provider hiccup falls back to the next.
async function downloadFirst(urls, dest, signal) {
  for (const url of urls) {
    // eslint-disable-next-line no-await-in-loop
    if (await tryDownload(url, dest, signal)) return dest;
  }
  return null;
}

/**
 * Download all artwork for a game into artworkDir and extract accent colours.
 * artworkDir is always supplied by the scanner/rematch route it is the
 * artwork/ subfolder inside the game's library folder.
 * Direct coverUrl/backgroundUrl fields (SteamGridDB) are preferred over IGDB
 * image ids when both are present. Individual download failures are swallowed
 * so one missing image never fails the whole pipeline.
 */
export async function processArtwork(igdbId, igdbData, artworkDir, signal) {
  await fs.promises.mkdir(artworkDir, { recursive: true });

  const result = {
    coverPath: null,
    backgroundPath: null,
    screenshots: [],
    accentPrimary: null,
    accentSecondary: null,
  };

  const coverSources = [
    igdbData.coverUrl,
    igdbData.cover?.image_id && imageUrl(igdbData.cover.image_id, 't_cover_big'),
  ].filter(Boolean);
  if (coverSources.length) {
    const dest = path.join(artworkDir, 'cover.jpg');
    const ok = await downloadFirst(coverSources, dest, signal);
    if (ok) {
      result.coverPath = dest;
      const colors = await extractColors(dest);
      result.accentPrimary = colors.primary;
      result.accentSecondary = colors.secondary;
    }
  }

  // Prefer a dedicated artwork as the background; fall back to first screenshot.
  const bgImageId = igdbData.artworks?.[0]?.image_id ?? igdbData.screenshots?.[0]?.image_id;
  const backgroundSources = [
    igdbData.backgroundUrl,
    bgImageId && imageUrl(bgImageId, 't_1080p'),
  ].filter(Boolean);
  if (backgroundSources.length) {
    const dest = path.join(artworkDir, 'background.jpg');
    const ok = await downloadFirst(backgroundSources, dest, signal);
    if (ok) result.backgroundPath = dest;
  }

  if (Array.isArray(igdbData.screenshots)) {
    let order = 0;
    for (const shot of igdbData.screenshots) {
      if (!shot.image_id) continue;
      const dest = path.join(artworkDir, `screenshot_${order}.jpg`);
      const ok = await tryDownload(imageUrl(shot.image_id, 't_screenshot_huge'), dest, signal);
      if (ok) result.screenshots.push({ path: dest, order });
      order += 1;
    }
  }

  return result;
}

export default { processArtwork, extractColors };
