import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import archiver from 'archiver';

// Streaming compression so multi-gigabyte games never load into memory.
// `onProgress(percent)` is called as bytes are processed (best-effort).
// An optional AbortSignal lets a cancelled scan tear the operation down
// mid-flight; the half-written destination is cleaned up by the caller.

function isZip(sourcePath) {
  return sourcePath.toLowerCase().endsWith('.zip');
}

function abortError() {
  const err = new Error('Cancelled');
  err.code = 'ABORT_ERR';
  return err;
}

async function totalSize(dir) {
  let total = 0;
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await totalSize(full);
    else total += (await fs.promises.stat(full)).size;
  }
  return total;
}

async function archiveDirectory(sourcePath, destPath, onProgress, signal, level) {
  if (signal?.aborted) throw abortError();
  const expected = await totalSize(sourcePath).catch(() => 0);
  const output = fs.createWriteStream(destPath);
  const archive = archiver('zip', { zlib: { level } });

  // Report against the total bytes archiver discovers once it has stat'd every
  // entry (data.fs.totalBytes); fall back to our pre-walk size until then. Using
  // the source byte count not the compressed output keeps the bar honest and
  // monotonic instead of lurching when a large already-compressed file flushes.
  let lastPct = 0;
  archive.on('progress', (data) => {
    if (!onProgress) return;
    const denom = data.fs.totalBytes || expected;
    if (denom <= 0) return;
    const pct = Math.min(99, Math.floor((data.fs.processedBytes / denom) * 100));
    if (pct > lastPct) {
      lastPct = pct;
      onProgress(pct);
    }
  });

  let onAbort;
  const done = new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
    output.on('error', reject);
    if (signal) {
      onAbort = () => {
        archive.abort();
        output.destroy();
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });

  archive.pipe(output);
  archive.directory(sourcePath, false);
  // finalize() rejects are surfaced through the 'error' event handled above.
  archive.finalize().catch(() => {});
  try {
    await done;
  } finally {
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
  if (onProgress) onProgress(100);
}

async function copyZip(sourcePath, destPath, onProgress, signal) {
  const { size } = await fs.promises.stat(sourcePath);
  let copied = 0;
  const read = fs.createReadStream(sourcePath);
  read.on('data', (chunk) => {
    copied += chunk.length;
    if (size > 0 && onProgress) {
      onProgress(Math.min(99, Math.floor((copied / size) * 100)));
    }
  });
  // pipeline honours the AbortSignal natively, destroying both streams on abort.
  await pipeline(read, fs.createWriteStream(destPath), { signal });
  if (onProgress) onProgress(100);
}

// Clamp a configured compression level into zlib's valid 0..9 range, defaulting
// to a fast level when unset. Game data is typically already compressed, so a
// low level trades a little size for a large speed win.
export function normaliseLevel(level) {
  const n = Number(level);
  if (!Number.isFinite(n)) return 1;
  return Math.min(9, Math.max(0, Math.round(n)));
}

/**
 * Normalise a source (folder or existing zip) into a single zip at destPath.
 * Streams throughout; safe for arbitrarily large inputs. Pass an AbortSignal
 * to make a cancelled scan abort the in-flight compression, and an optional
 * zlib `level` (0..9) to trade speed against size.
 */
export async function createArchive(sourcePath, destPath, onProgress, signal, level) {
  if (isZip(sourcePath)) {
    // Existing zips are copied verbatim, so the compression level is moot.
    await copyZip(sourcePath, destPath, onProgress, signal);
  } else {
    await archiveDirectory(sourcePath, destPath, onProgress, signal, normaliseLevel(level));
  }
}

export default { createArchive };
