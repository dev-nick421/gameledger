import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

// Compose only substitutes .env values into the compose file itself; a
// container sees nothing that isn't listed under its `environment:`. Anything
// .env.example tells users to set for the API therefore has to be forwarded
// explicitly, or it is silently ignored in Docker.
describe('docker-compose.yml', () => {
  it('forwards every API setting documented in .env.example to the api container', () => {
    const readByApi = new Set(
      [...read('api/src/config.js').matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]),
    );
    const documented = [...read('.env.example').matchAll(/^#?\s*([A-Z0-9_]+)=/gm)].map((m) => m[1]);
    const compose = read('docker-compose.yml');
    const apiBlock = compose.slice(compose.indexOf('  api:'), compose.indexOf('  web:'));

    const expected = documented.filter((name) => readByApi.has(name));
    expect(expected).toEqual(expect.arrayContaining(['IGDB_CLIENT_ID', 'IGDB_CLIENT_SECRET']));
    for (const name of expected) {
      expect(apiBlock, `${name} is not passed to the api container`).toMatch(
        new RegExp(`^\\s+${name}:`, 'm'),
      );
    }
  });
});
