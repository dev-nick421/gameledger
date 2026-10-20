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

**SteamGridDB-only games** (matched when IGDB isn't configured) need an identity
too. Their SteamGridDB id is shifted into a reserved range,
`STEAMGRID_ID_OFFSET + sgdbId` (`services/providerIds.js`, offset 1e9), so the
`Game.igdbId` column stays a positive, unique, stable integer and every invariant
above keeps holding; negative ids still mean custom/unmatched. In names the
`<IGDB_ID>` token renders such ids as `sgdb-<id>`, and `parseFolderName` reads the
prefix back, so adoption works for them too. Don't add a second identity column.

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
- **A folder or zip whose name fits the naming scheme and carries the id of a
  game already in the catalogue *is* that game**, wherever the stored
  `gamePath` says it lives (library remounted/moved, path typed differently;
  path comparisons are resolved, see `services/paths.js`). It is never raw
  input: the scheme-shaped name matches badly, so it would become an Unmatched
  duplicate whose "source" is the real game folder, and deleting or rematching
  that duplicate used to destroy the game. If the stored folder no longer
  exists, the game is **relinked** to the found folder (`relinkFolder`, run by
  scans and by "Refresh library" *before* it prunes anything); if it still
  exists, the found folder is a second copy and is left alone.
- **`removeDuplicateEntries`** (on boot, at the start of every scan and refresh)
  drops Unmatched rows whose source is a catalogued game's folder. Database
  only; the files belong to the catalogued game.
- **Destructive operations never touch another game's files.** Delete, the
  manual "process" edit and rematch check `ownedPaths` first; delete keeps
  shared paths and reports them as `keptFiles`. Rematching onto an id that's
  already in the library is a **merge**: silent when it's the same folder,
  otherwise `409 ALREADY_IN_LIBRARY` until the client confirms with
  `merge: true` (which deletes only the duplicate's own copy).
- **Never build a game folder over or inside its source.** `createArchive`
  refuses a destination inside the folder it archives (writing there truncates
  the existing archive before reading a byte), the scanner and routes refuse a
  target folder that overlaps the source or already exists unowned, and a
  failed scan job only rolls back a folder that job created.
- **On startup, any `RUNNING` jobs are reset to `FAILED`** so interrupted jobs
  become retryable instead of stuck forever.
- Compression streams via `archiver` (safe for multi-GB inputs); existing zips are
  stream-copied.
- Scheduled scans: off / hourly / 6h / daily / weekly, persisted and restored on
  boot (`services/scheduler.js`).
- Every stage transition is broadcast over `/ws` (global broadcast Phase 1 is
  single-admin, so no per-client targeting).

## Metadata providers (`api/src/services/metadata.js`)

Everything that needs metadata (scanner, refresher, rematch route, correction
search) talks to the **metadata service**, not to a provider directly. It's built
from whichever providers are configured and always returns IGDB-shaped data:

- **IGDB only**: identity, metadata and artwork from IGDB (the original setup).
- **SteamGridDB only** (`services/steamgriddb.js`): identity, title, release year
  and artwork. SteamGridDB has no summaries, genres, platforms, ratings,
  screenshots or trailers, so those stay blank ("Missing info").
- **Both**: IGDB stays identity + metadata; SteamGridDB's best-scored portrait
  grid and hero are preferred as cover/background via direct
  `coverUrl`/`backgroundUrl` fields (`processArtwork` tries them first, then
  falls back to IGDB images). The SteamGridDB game is found by title and must
  clear `MATCH_THRESHOLD`, since SteamGridDB has no IGDB cross-reference.
- Neither: matching throws a message pointing at **Settings → Providers**.

`metadataFields(data)` is the single place provider data becomes Game columns,
including `trailerYoutubeId` (via `pickTrailer`, which only accepts videos named
like a trailer and rejects teasers/walkthroughs/interviews; no confident match
means no trailer). `trailerYoutubeId` is tri-state: `null` = never set (the
"missing" refresh may fill it), `''` = removed by hand (refreshes leave it alone),
otherwise a video id; serialise `''` as null. For SteamGridDB-only games a failed
artwork *lookup* propagates as an error (the art is their only data, and an
"all" refresh wipes the artwork folder first); only IGDB-enrichment lookups
degrade silently. The SteamGridDB client reads settings with `findByPk`, not
`findOrCreate`: its cover/hero lookups run concurrently and SQLite can't run
`findOrCreate`'s transactions side by side.

Credentials for both providers resolve **DB-first (admin UI), env-fallback**
(`IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET`, `STEAMGRIDDB_API_KEY`). Every env var the
API reads that `.env.example` documents must also be forwarded under the api
service in `docker-compose.yml` (compose only substitutes `.env` into the compose
file; containers see nothing that isn't listed). `api/test/compose.test.js`
enforces this.

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
- **Secrets are never serialised.** `GET /api/settings` exposes only
  `igdbConfigured`/`steamGridConfigured` booleans plus `igdbSource`/
  `steamGridSource` (`"settings"`, `"environment"` or null) so the UI can explain
  why an env-provided key can't be removed there.

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
  `DELETE /api/queue` (cancel pending), `DELETE /api/queue/:id` (dismiss one
  finished job; 409 while it's pending/running) and `DELETE /api/queue/failed`
  (dismiss all failed). Dismissing never touches disk; the source is simply
  picked up again by the next scan.
- `GET /api/games`, `GET /api/games/:igdbId`, `GET /api/games/:igdbId/download`.
- `PATCH /api/games/:igdbId/match` reassign IGDB match (see below).
- `GET /api/providers/search?q=` (alias: `/api/igdb/search`) admin-only, feeds
  the correction modal; IGDB when configured, else SteamGridDB (with thumbnails).
- `POST /api/settings/test-igdb`, `POST /api/settings/test-steamgrid` live probes.
- `GET /api/catalog` (public): every downloadable game with full metadata,
  download URL and size, for third-party clients (launcher plugins like
  Playnite). Versioned: bump `CATALOG_VERSION` only when removing or changing the
  meaning of a field.
- `POST /api/games/refresh-metadata` (`services/metadataRefresh.js`,
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
- **Search/sort/filter run client-side** over the whole feed (`lib/libraryFilters.js`;
  the page fetches every page of `/api/games`). State lives in the URL query.
  While a search or genre/platform filter is active the rails are hidden.
- **Tooltips use the `v-tooltip` directive** (`directives/tooltip.js`): one shared
  element in `<body>` with fixed positioning, so scroll containers never clip it.
  Prefer it over `title=` for anything a user needs to read.
- Trailers are a click-to-play facade (`TrailerPlayer.vue`): nothing is requested
  from YouTube until play is pressed, and the embed uses youtube-nocookie.com.
- Detail page hero gradient is built from `accentColorPrimary/Secondary` **computed
  once at scan time and stored in the DB** zero per-request work, no client-side
  extraction flash.
- **Dark mode is the default and is applied before mount** (the `dark` class is set
  in `index.html`) to avoid a light→dark flash. Toggle persisted in localStorage.
- Navigation is minimal (doc 014): the Library is the default landing page; chrome
  is a small top-right cluster (theme toggle, a cogwheel Settings link shown only
  when logged in, Login/Logout). There is **no standalone Scan route** the scan
  dashboard lives as a section at the top of Settings. Settings categories are
  grouped (Library / Metadata / System); provider credentials live under
  Providers (`/admin/providers`; `/admin/igdb` redirects there).
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
- **Phase 3:** analytics, multi-library, TV-optimised UI, download stats (trailers have shipped).
- Other intended future work: duplicate detection, game statistics, advanced
  search, custom naming schemes.

## Project convention

Historically each change was documented in `/docs` as
`<change-number>-<brief-description>.md`. This file consolidates those notes; keep
it current when you make a load-bearing decision rather than letting the rationale
live only in commit messages.

## Code comment style

Not every change needs a comment, and not every comment needs a tracker
reference. Reserve inline comments for a non-obvious invariant or a reason the
code isn't the naive version; skip them when the code already reads clearly.
Keep comments general — describe the constraint or the "why", not the ticket
that prompted it. Issue/PR numbers rot (issues close, get renumbered, live in
a tracker most readers of the code will never open); a comment tied to one
reads as noise once that context is gone. If the origin matters, it belongs in
the commit message or PR description, not baked into the source.
