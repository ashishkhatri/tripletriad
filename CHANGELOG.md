# Changelog

All notable changes are listed here. Versions follow [Semantic Versioning](https://semver.org/):
major for breaking changes, minor for new features, patch for fixes.

## v2.2.0 — 2026-11-01
### Added
- 3D cards: tilt toward the pointer with a moving shadow; the dragged card lifts and swings with your motion;
  captured cards flip over in 3D (showing their back) in the direction they were hit from; placed cards drop in.
- Foil lighting on every card: pointer-as-light Blinn-Phong glare, a Fresnel-driven holographic foil layer
  with grain over the art, and a gilt frame that catches the light. Slow drifting light on touch screens.
- Per-set themes: each card set restyles the whole site (colours, backgrounds, board, buttons, frames,
  card backs, fonts). Follows the set chosen in the menu or Collection screen and is remembered.
- Sealed card packs with original foil art for each set: click to tear open, then click each card to reveal it.
  Packs aren't used until they're torn open.
### Changed
- Cards use real trading-card proportions (63 × 88 mm) and scale up to 240 × 336 px on desktop.
  On desktop both hands show as two-column blocks the same size as the board cards.
- Bigger cards on the Collection screen, hand builder and pack reveal.
- All fonts are now sans-serif.

## v2.1.1 — 2026-11-01
### Changed
- Rule tooltips appear after 0.5 seconds of hovering the ⓘ (was 1 second).

## v2.1.0 — 2026-11-01
### Added
- Sound effects (original, stored as MP3s in `public/sfx/`): card pick-up, placement, flips, putting a card back,
  Same / Plus / Combo chimes, your-turn bell, win / lose / draw stings, XP gained, pack unlocked, wager won / lost,
  button clicks and errors.
- Pack opening sounds: a tear-and-shimmer when the pack opens, and a reveal for each card that gets grander
  with the card's level.
- Sound-effects toggle (🔔) and volume slider beside the music control, remembered per browser.
- `tools/gensfx.py`, which synthesizes the effects.

## v2.0.3 — 2026-11-01
### Added
- Right-click puts a card back: mid-drag it returns the card to your hand without placing it,
  and after clicking a card to select it, it deselects. Escape does the same.
  Right-clicking with nothing selected still shows the browser's normal menu.

## v2.0.2 — 2026-11-01
### Changed
- Rule tooltips now appear only when the pointer rests on the ⓘ itself, after a 1-second delay,
  and hide as soon as it moves away. Tapping the ⓘ on phones still opens them instantly.
### Fixed
- The Wager tooltip was faint while the rule was greyed out; only the checkbox and label are dimmed now.
- Removed the tooltip instructions from "How to play".

## v2.0.1 — 2026-11-01
### Fixed
- Rule tooltips stayed open after clicking a checkbox or the Hands dropdown until you clicked again.
  They now close on the first click or tap; keyboard users still see a tip while tabbing to its ⓘ.

## v2.0.0 — 2026-11-01
### Added
- Accounts: sign up / sign in with a name and password; progress is stored on the server.
- Card collections per set, with a 7-card starter collection.
- XP per set (10 per game, +25 for a win, +5 for a draw) and a 3-card pack for every 100 XP,
  with level-weighted rarity. Pack opening with card-flip reveals.
- Collection screen: every card in a set, which you own (and how many), XP and win record.
- **Hands** rule: Balanced, Random from collection, Build from collection, Build with a level budget of 15.
  Hand builder screen with auto-pick.
- **Wager** rule: the winner takes one of the loser's cards.
- XP, unlocked packs and wager results on the result screen.
### Changed
- Games against the computer now run on the server (needed so XP and wagers can't be faked).
- Player data is stored in `/var/lib/triad`; `update` refreshes the service file and backs up the data before restarting.
### Notes
- Upgrading from 1.x: just run `update`. Existing games keep working; accounts start empty.

## v1.5.0 — 2026-11-01
### Added
- Tooltips for each rule in the Rules box: hover on desktop, or tap the ⓘ on phones.
### Changed
- Rule explanations moved out of "How to play" and into the tooltips.
- Tagline no longer wraps on narrow phones.

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
