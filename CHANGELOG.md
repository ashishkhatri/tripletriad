# Changelog

All notable changes are listed here. Versions follow [Semantic Versioning](https://semver.org/):
major for breaking changes, minor for new features, patch for fixes.

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
