import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Load .env regardless of the working directory you launch from. `npm run dev`
// runs with cwd = api/, but the project's .env lives at the repo root next to
// .env.example so we check several locations. dotenv never overrides a value
// that's already set, so the first match per key wins.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const candidates = [
  path.resolve(process.cwd(), '.env'), // wherever you launched from
  path.resolve(__dirname, '../.env'), // api/.env
  path.resolve(__dirname, '../../.env'), // repo root .env
];

for (const envPath of candidates) {
  dotenv.config({ path: envPath });
}
