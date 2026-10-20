# Changelog

All notable changes to GameLedger are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **SteamGridDB** as a metadata provider, on its own or alongside IGDB. The
  IGDB settings page is now **Settings → Providers** (`/admin/igdb` redirects).
- **Trailers**: picked automatically from IGDB when one is clearly the trailer,
  editable from Manage Games, with click-to-play on the game page and a
  YouTube search button.
- **Library search, sort and filters** (release date, name, recently added,
  most downloaded; genre and platform), kept in the URL.
- **Dismiss failed scan jobs**, one at a time or all at once.
- **Tooltips** throughout Manage Games, especially on statuses.
- `GET /api/catalog` for third-party clients such as launcher plugins.
- Favicon, touch icon and web app manifest.

### Changed

- A UI polish pass across the app (typography, cards, game page, settings
  navigation, toasts, empty and loading states).
- Licence changed from AGPL-3.0-or-later to **MIT**.
- "Fill in missing metadata" also picks up trailers for games that have none.

### Fixed

- `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` (and `TOKEN_REFRESH_WINDOW_MS`) from
  `.env` were never passed to the API container by `docker-compose.yml`.
- The library only ever showed the first 100 games.
- Manage Games sorted titles case-sensitively.

## [1.0.0] - First public release

First open-source release for homelab self-hosting.

[1.0.0]: https://github.com/dev-nick421/gameledger/releases/tag/1.0.0
