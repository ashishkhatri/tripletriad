# Changelog

All notable changes are listed here. Versions follow [Semantic Versioning](https://semver.org/):
major for breaking changes, minor for new features, patch for fixes.

## v1.4.0 — 2026-11-01
### Added
- Drag and drop: drag a card from your hand onto the board (mouse or touch). Click/tap to select then place still works.
- App icon (three fanned cards with a gold star) used as the browser icon, home-screen icon and Proxmox container logo.
- Web app manifest, so the game can be installed to a phone home screen or as a desktop app.
### Changed
- Desktop layout: the board and cards scale to the window (up to 200px cells), both hands show as full
  non-overlapping columns, and the scores and turn text are larger. The phone layout is unchanged.
- Music control moved to the bottom-right corner.
### Fixed
- Playing your first card while the "You start" banner was showing could start two computer turns and freeze the game.

## v1.3.0 — 2026-11-01
### Added
- Background music: an original theme for every card set, stored as MP3 files in `public/music/`
  (Over the Wild Ridge, The Archmage's Court, Lights Beyond the Sky, Song of the Tidewaters,
  Dance of the Greenwood, Lanterns in the Hollow). Gapless looping and crossfades between sets.
- Music control in the corner: mute and volume, remembered per browser.
- `music` field on card sets so custom sets can use their own track.
- `tools/genmusic.py`, which composes and renders the themes.
- Site icon.

## v1.2.2 — 2026-11-01
### Fixed
- `update` failed with git's "dubious ownership" error when run through `pct exec`; the updater and installer now mark `/opt/triad` as safe system-wide.

## v1.2.1 — 2026-11-01
### Fixed
- `pct exec <CTID> -- update` failed with "No such file or directory": the updater now installs to `/usr/bin/update`.
  Containers installed earlier need one run of `pct exec <CTID> -- /usr/local/bin/update` to move it.

## v1.2.0 — 2026-11-01
### Changed
- New fantasy look: engraved serif lettering (Cinzel Decorative, Cinzel, EB Garamond), gilded title,
  parchment menu with a gold frame and flourishes, carved-wood board with gilt inlay,
  gold-framed cards with parchment name plates and blue/red inner rims for ownership,
  medallion scores, an ornate card back, and wood/gold buttons.

## v1.1.1 — 2026-11-01
### Fixed
- Installer no longer prints perl/locale warnings inside the new container.
### Changed
- Releases are now tagged and published automatically by GitHub Actions when the version changes.

## v1.1.0 — 2026-11-01
### Added
- Version number shown on the main menu (links to the releases page).
- `/version` endpoint returning the running version.
- Installer and `update` command now report the version.
- `CHANGELOG.md` and `tools/release.sh` for tagged releases.

## v1.0.0 — 2026-11-01
### Added
- Triple Triad-style rules: Open, Same, Plus, Combo, Elemental.
- Computer opponent (Easy / Normal / Hard).
- Online rooms with codes, invite links, reconnect and rematch.
- Six original illustrated card sets (240 cards) and the SVG art generator.
- Proxmox LXC one-line installer, in-container `update`, systemd unit, Dockerfile.
### Fixed
- Installer rejected the configured repository name.
