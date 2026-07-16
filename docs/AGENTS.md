# AGENTS.md

Orientation for agents working on GameLedger. This consolidates the project's
design docs into the load-bearing facts and non-obvious decisions the things a
human absorbs by reading the whole history but an agent can easily miss. Nothing
here is invented; it is distilled from the original client brief and the
per-change design notes.

---

## What this is

GameLedger is a self-hosted game library & distribution platform "Jellyfin for
games". It scans configured library directories, identifies games via IGDB,
normalizes naming, compresses each game into a downloadable ZIP, and presents the
collection through a media-centric Vue UI. Dark-first, premium feel comparable to
Jellyfin/Plex/Steam is an explicit primary objective, not an afterthought.

## Tech stack

- **Backend:** Express.js + Node.js, Sequelize over SQLite (PostgreSQL is a
  possible later option). Models: `Setting`, `Library`, `Game`, `Screenshot`,
  `Job`, `Log`.
- **Frontend:** Vue 3, TailwindCSS (`darkMode: 'class'`), Vue Router, Pinia, Axios.
- **Infra:** Docker + Docker Compose. The API is internal-only; nginx in the web
  container proxies `/api` and `/ws` to it.

## Architecture seams (use these they exist on purpose)

- **`createApp()` (`api/src/app.js`)** builds the Express app from *injected*
  dependencies. `server.js` composes the real graph; `index.js` is the production
  entrypoint. This dependency injection is the top-level test seam: suites mount
  the real app over HTTP against an in-memory DB with IGDB stubbed by nock.
- **`createDatabase()` (`api/src/db/index.js`)** lets tests use a cheap in-memory
  SQLite DB per suite.
- **The WebSocket broadcaster (`api/src/ws/broadcaster.js`) is decoupled from the
  WS transport** so the scan pipeline is fully testable without a live socket.
- **`requireAuth` is the single auth seam.** Routes depend only on it; swapping
  the whole `middleware/auth.js` module (Phase 2 sessions/JWT) touches no route.
- Config is env-driven (`api/src/config.js`) so one image works across Docker, CI
  and local dev.

---

## THE canonical rule: IGDB ID is identity

A game's identity is its **IGDB ID**, never its display name. Downloads,
metadata, artwork, screenshots, and all future features (collections, favorites,
stats, user accounts) reference games by IGDB ID. **Display names are
presentation-only**, generated at read time from metadata + the active naming
scheme.

Consequence: changing metadata or the naming scheme must **never** move or rename
a physical file. A metadata correction is a cheap operation, not a re-download.

## Storage layout (current supersedes the brief)

⚠️ The original brief describes a flat `/storage/games/{igdb_id}.zip` layout. **That
was replaced (doc 013).** The real, current layout stores everything *inside the
library folder*, in a display-named subfolder:

```
{libraryPath}/
  {Game Name} - {Year} [{IGDB_ID}]/
    artwork/   ← cover.jpg, background.jpg, screenshot_N.jpg
    data/      ← {Game Name} - {Year} [{IGDB_ID}].zip
```

`gamePath`, `archivePath`, and `libraryPath` are persisted on the `Game` row so
the app locates/serves/moves/deletes assets without recomputing paths. After
processing, **no raw game folders remain** the library holds only these
structured entries.

## Naming system

- Default scheme: `<Game Name> - <Release Year> [<IGDB_ID>]`.
- Scheme is configurable (admin UI); other templates like `<Game Name>` or
  `<Game Name> (<Release Year>)` are intended.
- `services/naming.js` generates both the friendly download filename and the
  filesystem-safe folder name (`generateFolderName`).

---

## Scan pipeline (`api/src/services/scanner.js`)

States: `Pending → Scanning → Matching → Fetching Metadata → Compressing →
Completed`, with two branches: **`Unmatched`** (terminal holding state) and
**`Failed`**.

Critical invariants:

- **Copy/compress-then-delete-on-success.** The source is removed **only after** a
  fully successful pipeline. Any failure leaves the source intact and marks the
  job `Failed`. A crash mid-scan never loses game data.
- **Below-threshold matches become `Unmatched` games with the source preserved**
  (never compressed) so they can be corrected later they are *not* silently
  dropped or guessed.
- **Artwork download failures degrade gracefully** (per-asset) and never abort the
  job; accent-colour extraction (`node-vibrant`) degrades to null on failure.
- **Single-scan guard:** a second concurrent `scanAll()` throws `SCAN_RUNNING`
  (route returns 409).
- **`detectInputs` skips known `gamePath` folders** so the structured output
  directories are never re-queued as new inputs.
- **Structured folders are recognised on sight, independent of the database.**
  Any top-level directory containing `artwork/` + `data/*.zip` is gameledger's
  own output shape, full stop it is never queued as raw scan input even when
  no `Game` row references it (fresh DB after a reinstall, a library
  arranged/copied outside a scan, hand-built folders following the naming
  scheme). Treating it as raw input would re-match it, compress the folder
  into a zip *inside itself*, then delete it as a "source" once done, silently
  destroying an already-complete game. Instead `adoptFolder` re-derives the
  `Game` row directly from disk: it recovers title/year/IGDB ID from the
  folder or zip name via `naming.parseFolderName` (the scheme's reverse-parse),
  reuses the existing artwork/archive paths as-is, and refreshes metadata from
  IGDB on a best-effort basis. If IGDB can't be reached (offline, credentials
  not yet re-entered after a reinstall, rate-limited, ...) the title/year
  parsed from the name are used as-is rather than falling back to the raw,
  still scheme-shaped folder name (e.g. never "Foo - 2025 [12345]" as the
  title). Folders whose name doesn't fit the active scheme are left untouched
  and logged as a warning rather than guessed at.
- **On startup, any `RUNNING` jobs are reset to `FAILED`** so interrupted jobs
  become retryable instead of stuck forever.
- Compression streams via `archiver` (safe for multi-GB inputs); existing zips are
  stream-copied.
- Scheduled scans: off / hourly / 6h / daily / weekly, persisted and restored on
  boot (`services/scheduler.js`).
- Every stage transition is broadcast over `/ws` (global broadcast Phase 1 is
  single-admin, so no per-client targeting).

## IGDB integration (`api/src/services/igdb.js`)

- OAuth token (Twitch client-credentials) is **persisted on the `Setting` row**
  (value + expiry), not held in memory tokens last ~60 days and must survive
  restarts. Auto-refreshes inside `TOKEN_REFRESH_WINDOW_MS` (default 24h).
- **Credentials resolve DB-first (admin UI), env-fallback second**
  (`IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET`). Both `config.js` and the request
  headers honour this. (Doc 012 fixed a bug where env vars were documented but
  never read, and where the Settings "Test connection" button tested before
  saving the typed credentials it now saves first.)
- `autoMatch()` scores results with a bigram Dice-coefficient `similarity()`;
  nothing clearing `MATCH_THRESHOLD` ⇒ caller marks the game `Unmatched`.
- **Secrets are never serialised.** `GET /api/settings` exposes only an
  `igdbConfigured` boolean, true if either source has credentials.

## Auth (Phase 1)

- Single admin password. The session token is a **deterministic HMAC-SHA256 of
  `ADMIN_PASSWORD`**, so it survives restarts and works across processes without a
  session store. Password/token comparisons use `crypto.timingSafeEqual`.
- `POST /api/auth/login` exchanges password → token (401 on mismatch).
- **Public reads are intentional**: game list, detail, download, and artwork are
  unauthenticated so direct/shareable links work. All mutating/admin routes are
  behind `requireAuth`.

---

## Key endpoints

- `GET /api/health` → `{ status: "ok" }`.
- `POST /api/auth/login`.
- `GET/POST /api/libraries`, `DELETE /api/libraries/:id` path config only;
  validates dir exists (400), rejects duplicates (409). Never touches game rows.
- `GET/PUT /api/settings`, `POST /api/settings/test-igdb` (live probe),
  `GET /api/settings/public` (exposes only non-sensitive flags like
  `showRecentlyAdded`, readable without auth so the library page works pre-login).
- `POST /api/scan` (409 if running), `GET /api/queue` (grouped
  running/pending/failed/completed), `POST /api/queue/:id/retry`,
  `DELETE /api/queue` (cancel pending).
- `GET /api/games`, `GET /api/games/:igdbId`, `GET /api/games/:igdbId/download`.
- `PATCH /api/games/:igdbId/match` reassign IGDB match (see below).
- `GET /api/igdb/search?q=` admin-only, feeds the correction modal.
- `POST /api/games/refresh-metadata` (issue #6, `services/metadataRefresh.js`,
  admin-only, 409 if one is already running): bulk-refreshes catalogued games
  from IGDB. `{ mode: "all" }` unconditionally overwrites metadata and
  wipes+redownloads artwork for every game; `{ mode: "missing" }` (default)
  only touches games with a blank field (summary/genres/platforms/rating/
  releaseYear/cover  the same fields the detail page shows as "—"), filling in
  just the blanks. Custom games are never touched. Fire-and-forget like `/scan`
  (202, progress + a `metadataRefresh` summary over `/ws`); use "all" to fix a
  field that's wrong-but-present (e.g. a title that got mangled upstream of
  IGDB)  "missing" mode won't touch it since it isn't blank. Never
  moves/renames `gamePath`/`archivePath`: per the naming-system invariant above,
  a metadata correction is a cheap update, not a relocation. `GET
  /api/games/manage` includes a `missingMetadata` flag per game so the admin UI
  can show which ones "Find missing metadata" would affect.

### Download endpoint

Streams the physical archive via `fs.createReadStream` (never buffers). Sets
`Content-Disposition` to the friendly name from the active scheme. Honours
`Range` (206, and 416 on unsatisfiable range) for resume-safe large-file
transfers. 404 unless the game exists **and is `Completed`**. Public (no auth).

### Metadata correction / PK migration

`PATCH /api/games/:igdbId/match` refreshes metadata + artwork for the new ID, then:

- if the game was `Unmatched` (source preserved, never compressed) → it is
  **compressed now** and the source removed;
- otherwise the existing archive is **moved/renamed** into the new ID's structure.

It then **migrates the primary key** (moves screenshots, deletes the old row + old
artwork) and marks the result `Completed`. Because archives are keyed by IGDB ID,
this is a cheap rename rather than a re-download.

---

## Frontend specifics

- **Library feed merges active/failed job cards with catalogued games**, so a game
  is visible the moment it is detected. In-progress cards render at reduced opacity
  with a spinner + live progress bar; `Failed`/`Unmatched` get distinct badges.
  Completed cards link to the detail page; `Unmatched` cards open the correction
  modal. The `Completed` badge/text is suppressed for finished games.
- **Live updates come from one WebSocket connection at the app root**, fed into a
  Pinia **jobs store** (`web/src/stores/jobs.js`) so progress persists across page
  navigation (don't re-open a per-view socket).
- Grid / List / Plain view toggle, persisted in localStorage. Grid scales 2→6
  columns across breakpoints.
- Detail page hero gradient is built from `accentColorPrimary/Secondary` **computed
  once at scan time and stored in the DB** zero per-request work, no client-side
  extraction flash.
- **Dark mode is the default and is applied before mount** (the `dark` class is set
  in `index.html`) to avoid a light→dark flash. Toggle persisted in localStorage.
- Navigation is minimal (doc 014): the Library is the default landing page; chrome
  is a small top-right cluster (theme toggle, a cogwheel Settings link shown only
  when logged in, Login/Logout). There is **no standalone Scan route** the scan
  dashboard lives as a section at the top of Settings.
- A horizontal **"Recently added" rail** sits above the grid, the first of several
  planned library rails; toggled via `Setting.showRecentlyAdded` (default true).

---

## Gotchas an agent will otherwise trip on

- **The client brief is partly stale.** Where it conflicts with a later decision,
  the later decision wins most importantly the storage layout (library-folder
  structure, not flat `/storage/games/{id}.zip`).
- **`[vite] ws proxy ECONNREFUSED` in dev logs is transient and harmless**: the
  Vite dev server proxies `/ws` to the API on :3000, and `node --watch` briefly
  drops the connection when it restarts on a file change. It stops once the API is
  up it is not a bug to chase.
- Token/credential handling and secret redaction are deliberate preserve them.
  Never serialise IGDB secrets or the admin password; never log secret values.

## Roadmap (not built unless a doc says so)

- **Phase 2:** collections, user accounts, advanced filters, enhanced artwork.
- **Phase 3:** trailers, analytics, multi-library, TV-optimised UI, download stats.
- Other intended future work: duplicate detection, game statistics, advanced
  search, custom naming schemes.

## Project convention

Historically each change was documented in `/docs` as
`<change-number>-<brief-description>.md`. This file consolidates those notes; keep
it current when you make a load-bearing decision rather than letting the rationale
live only in commit messages.
