# Changelog

All notable changes are listed here. Versions follow [Semantic Versioning](https://semver.org/):
major for breaking changes, minor for new features, patch for fixes.

## v0.4.3 — 2026-11-02
### Changed
- After a storm hits, the computer now waits as long as it does when choosing a storm response (4.5–6 seconds) before
  playing its next card, so you can see what the storm did first.

## v0.4.2 — 2026-11-02
### Changed
- Cards in a match only show their element icon when the Elemental rule is on. The Collection, packs and hand
  builder still show it.

## v0.4.1 — 2026-11-02
### Fixed
- The card detail popup in the Collection no longer changes size when you switch between Normal and Foil. The Craft and
  Scrap buttons keep the same labels (the switch shows which version they act on), the popup has a fixed width, and
  the info and note lines reserve their space.

## v0.4.0 — 2026-11-02
### Changed
- **Version numbers restart at 0.4.0**, since the game isn't in production yet. From here, each minor version gets
  up to ten patch releases (0.4.0 … 0.4.9, then 0.5.0). Everything below this entry was released as 1.0.0–3.9.2.
### Added
- Bigger sounds for the big moments, in every set's own sound kit:
  - **Rare, Epic and Legendary reveals** now build up, hit with an impact and bloom into a chord with a shower of
    sparkles; each tier is longer and grander, and Legendary ends with a short fanfare.
  - **Foils** add a rainbow shimmer that sweeps up and sparkles out, on top of the reveal.
  - **Crafting** sounds like magic gathering and a ringing strike forging the card; crafting a Rare or better, or a
    foil, gets a bigger version with a low boom (plus the foil shimmer for foils).
  - **Pack charge:** a rising rumble and shimmer under the pack's charge-up, cut off by the tear.

## v3.9.2 — 2026-11-02
### Changed
- Set ornaments (the ❦ flourish, Arcane's ✧, Bloomwild's ❀, Tidebound's waves, Hollow's lanterns) no longer sit in
  the corners of every box. Each set's ornament now appears once: on both sides of the big TRIAD title, and before
  TRIAD in the phone header. Starfall keeps its HUD edge lines on panels, and Starfall gets a ✦.
### Fixed
- In the Starfall and Tidebound themes, v3.9.1's new dropdown arrow filled the whole dropdown and hid its text.

## v3.9.1 — 2026-11-02
### Fixed
- The sealed pack sat to the left on the pack screen (it was placed in the first column of the six-card layout).
  It's centred again; the cards still use one row of six or two rows of three once they're out.
### Changed
- Removed the "<Set> pack" title above the pack (still read out by screen readers).
- The end-of-match popup can be closed (✕, clicking outside it, or Escape) to look at the final board; a **Result**
  button under the board brings it back. It reopens by itself if a wager needs your pick.
- Every popup closes when you click or tap outside it: sign-in, card details, the pack screen (except while a pack is
  being torn open) and the move history panel. Escape closes them too.
- Dropdowns have their own arrow, set in from the right edge instead of pressed against the border.
- Placeholder hints like CODE are much lighter, so they read as hints rather than filled-in text.

## v3.9.0 — 2026-11-02
### Added
- Pack opening is now a full sequence:
  1. **Charge:** the pack shakes harder and harder while light leaks out along the tear seal.
  2. **Burst:** the top tears off in a flash of light, with spinning light rays and a spray of sparks; the pack falls away.
  3. **Fly-out:** the six cards fly out of the pack, spinning, and land in their places one after another.
  4. **Reveal:** each card lifts as it turns over, with a burst of light behind it in its rarity's colour
     (light rays for Rare and up, rainbow rays for foils).
### Changed
- Cards everywhere have real thickness: a solid layered edge in the card's rarity metal, which shifts to whichever side
  you'd see as the card tilts (mouse, drag, or phone tilt). It scales with the card, so small cards get a thinner edge.

## v3.8.6 — 2026-11-02
### Fixed
- The version number was missing on phones (it lived in the desktop top bar, which phones hide). It now sits next
  to the TRIAD logo at the top of the phone layout, linking to the releases page.

## v3.8.5 — 2026-11-02
### Fixed
- Opening packs was slow and could show glitches, especially on phones. The pack's lighting layers were cut to shape
  with the full pack artwork as a mask, which browsers redrew every frame; they now use small bitmap outline masks.
  In testing the sealed pack went from about 44 to 60 frames per second on desktop.
- The card lighting loop measured and restyled cards in an order that forced the browser to redo layout once per card
  every frame. It now measures everything first, only writes values that changed, and skips the hidden face of
  pack-reveal cards. On a slowed-down phone the pack reveal and the game board both went from about 40–45 to 60 fps.
- On phones without the motion sensor, ordinary cards now have a steady light (foils and packs still shimmer), and
  shadows move in whole pixels, which saves a lot of redrawing.
- Pack art said "3 cards"; it now says 6 cards with 1 foil.

## v3.8.4 — 2026-11-02
### Changed
- A card you drag is now exactly the size of a square on the board (it grows from hand size the moment you pick it
  up, keeping the same spot under your finger or pointer), on phones and desktop.

## v3.8.3 — 2026-11-02
### Fixed
- Browsers, installed apps and Cloudflare could keep using an old cached copy of the game's scripts after an update
  (so new features like Card tilt showed up in the page but didn't run). Script and stylesheet links now carry the
  version number, so every update loads matching files; unchanged files are still cached for speed.
- The Card tilt panel says so if the tilt code failed to load or hit an error, instead of staying blank.

## v3.8.2 — 2026-11-02
### Fixed
- Card tilt now also works from the gravity sensor (`devicemotion`) when a browser doesn't deliver orientation angles,
  and keeps working with reduced motion if you turn it on yourself.
### Added
- **Card tilt** panel on the Account page: shows whether tilt is working and why not (no https, sensor blocked by the
  browser, permission refused, reduced motion), a live tilt meter, and a Turn on / Turn off button (remembered).

## v3.8.1 — 2026-11-02
### Fixed
- Tapping a card to select it and then dragging a different card left the first card selected. Starting a drag now
  clears any tapped selection.
- On phones, the last card you touched stayed lifted (a "sticky" hover), which looked like a second selection.
  The hover lift now only happens with a real mouse.
- Dragging or tapping onto a frozen square (Storms) is no longer offered as a drop target.
### Changed
- The selected card is much more prominent: it grows (about 25% on phones, 14% on desktop), lifts, and gets a pulsing
  gold ring, while the rest of your hand dims.

## v3.8.0 — 2026-11-02
### Added
- Phones and tablets: cards now move with the device. The motion sensor tilts every card as you tilt the phone, and
  the light stays fixed in the room, so the glare and the foil shine sweep across the cards like a real card in your
  hand. Works in portrait and landscape, and the neutral angle follows however you're holding the phone.
  iPhones and iPads ask for motion access on your first tap. Without a sensor (or with reduced motion on) the
  slow drifting light is used as before.

## v3.7.0 — 2026-11-02
### Changed
- Card packs now hold **6 cards**: 5 random cards plus 1 guaranteed foil, revealed last. Each of the 5 random cards
  can also be a foil, which works out to a bonus foil in about one pack in six. The reveal shows one row of six on
  wide screens and two rows of three elsewhere.
- Foil shine is one smooth, continuous rainbow sheen. The old repeating bands left hard lines in the shine while it
  moved, and the drift could jump; the light now glides smoothly and never shows an edge. Same for the rainbow frame.
### Fixed
- The music auto-start described under v3.6.5 actually ships in this release (its file was missing from v3.6.5).

## v3.6.5 — 2026-11-02
### Changed
- The music control no longer shows the song title.
- Music starts on its own unless you've turned it off: right away where the browser allows autoplay, otherwise on your
  very first click, tap or key press anywhere on the page. Turning music back on starts the track immediately, and
  nothing plays (or downloads) while music is off.

## v3.6.2 — 2026-11-02
### Changed
- A draw now earns 23 XP, halfway between a loss (10) and a win (35), rounded up. It was 15.

## v3.6.1 — 2026-11-02
### Changed
- The computer takes 4–6 seconds to weigh its storm response cards instead of about 3, so you can read what it was dealt.
- Every storm pick (yours, the computer's or an online opponent's) is now shown for about two seconds before it
  resolves: the chosen card glows and the others dim. This replaces the quick "Name: Response" banner.
- The turn line says who is facing a storm while one is pending.

## v3.6.0 — 2026-11-02
### Added
- Move history animations:
  - Hovering a line makes its numbers flash with light and settle into a glow, while the cards involved get a sweep of
    light and a pulse of the frame.
  - Captured cards turn over in the mini board and fade from their old colour to their new one.
  - Storm lines flash in the storm's style (fire burst, lightning, frost, spin, shake).
  - A ▶ button replays a move step by step: the placed card drops in, then each line lights up in turn.
  - The newest move replays automatically when you open the panel and whenever a new move arrives while it's open.
  - Turned off when the system asks for reduced motion.

## v3.5.0 — 2026-11-01
### Added
- **Storms** rule: between moves, elemental storms may strike the board — Wildfire (scorch −1), Tidal Surge (push a
  row/column), Cyclone (spin a card), Thunderbolt (flip a card), Blizzard (freeze a square for two turns),
  Earthquake (swap two cards) and a **Dragon** that flies across a line flipping everything beneath it.
  Moved and spun cards attack their new neighbours; cards of the storm's element are immune.
- Roguelike responses: the player about to move is dealt 2–3 cards — Ward, Deflect, Brace, Harness, Weather it,
  Defy fate — and picks one within 25 seconds. Wards (2 each, max 3) and Harness boosts show next to the score.
- Storm animations (fire bursts, lightning flashes, waves, whirlwinds, frost, board shake, a flying dragon),
  sliding and spinning cards, scorched and frozen markings, and storm sounds in every set's sound kit.
- Storms in the move history, with what each response did and every capture the storm caused.
### Fixed
- Game updates are now applied strictly in order, so an animation can never let an older board overwrite a newer one.

## v3.4.0 — 2026-11-01
### Added
- **Move history:** a panel you open from the **History** button under the board (or **Move history** on the result
  screen). Every move is listed newest first, with:
  - a mini board showing the position after the move, with the placed card outlined and flipped cards marked ↻;
  - each check that mattered, explained in words, with the numbers highlighted on the mini cards: which side beat
    which (green / red), which held (grey), Same pairs (gold), Plus sums (blue) and each Combo step (pink);
  - element-square bonuses and penalties shown next to the printed number.
  Hover or tap a line to pick out just its numbers. Works against the computer and online, and survives reconnects.

## v3.3.0 — 2026-11-01
### Added
- Every card set has its own sound effects, matching its theme:
  - **Wilds:** wood, bells and plucked strings (unchanged).
  - **Arcane Order:** glass chimes, crystal taps and shimmering air in a big hall.
  - **Starfall:** synth bleeps, laser-zap flips, servo whirs and a space echo.
  - **Tidebound:** water drops, bubbles, wave swells and vibraphone.
  - **Bloomwild:** kalimba, leaf rustles and birdsong.
  - **Hollow Lanterns:** temple bells, gongs, a music box and ghostly wind, in a minor key.
- Sounds switch with the set's theme; a set without its own sounds uses the Wilds ones.
### Changed
- Foil cards are now unmistakable: rainbow holographic bands over the whole card that sweep slowly on their own and
  swing with the pointer, glitter sparkles, a prismatic rainbow frame with a glow, and a brighter glare.
  Normal cards keep just the gloss and glare.

## v3.2.0 — 2026-11-01
### Changed
- New menu system with separate sections: **Play**, **Collection**, **Challenges**, **How to play** and **Account**.
  - Desktop: a navigation bar across the top with the logo, the sections, your shards and the version.
  - Phones: a tab bar along the bottom and a slim header.
  - The navigation hides during matches, the lobby and the hand builder, and the last section is remembered.
- Play section: the card set with its XP and pack button, then two cards — *Vs Computer* (Easy / Normal / Hard + Play)
  and *Online* (create a room or join with a code). Match rules fold away under a one-line summary.
- Daily challenges, How to play and Account each have their own section; the Challenges tab shows how many are left.

## v3.1.1 — 2026-11-01
### Fixed
- Rule tooltips sometimes didn't appear or showed up far above their ⓘ. Cause: a stray brace in the stylesheet
  (from v2.2.0) made browsers drop the rule that anchors each tooltip to its row. Tooltips are now a single
  floating element placed next to the ⓘ by script — above it, or below if there's no room, always inside the
  window — so no theme's panel shape can clip or shift them.
- Right-clicking to put a card back also opened the browser's menu; it no longer does (right-click with nothing
  selected still shows the normal menu).
### Changed
- Card frames show only rarity (iron, bronze, silver, gold, prismatic); the element colour rim is gone and the
  element icon is back, in a small badge in the top-right corner.

## v3.1.0 — 2026-11-01
### Changed
- Themes now differ in shape and material, not just colour:
  - **Arcane Order:** frosted-glass panels over a star field with a faint rune circle, pill buttons, a glowing rune-ringed board.
  - **Starfall:** a starship HUD — cut-corner panels and buttons, uppercase labels, grid and scanline background,
    corner brackets on the board, hexagonal score badges.
  - **Tidebound:** sea glass and bubbles — very rounded glassy panels, glossy bubble buttons, waves along the bottom,
    a sandy board with tide-pool slots.
  - **Bloomwild:** a storybook garden — organic lopsided paper panels with stitched borders, leaf-shaped buttons,
    a hedge-framed board with soil beds, leafy background.
  - **Hollow Lanterns:** lantern-lit night — dark paper panels with thin glowing lines and a hanging lantern,
    outlined buttons, a lacquered paper-screen board.
  - Card corners are shaped per theme too.

## v3.0.0 — 2026-11-01
### Added
- Normal and foil versions of every card. About 1 in 10 pack cards is a foil; only foils get the holographic
  layer. Foil copies are played first in your hands, and a wager transfers the exact version that was played.
- **Shards** currency (account-wide): earn it from daily challenges and by scrapping cards; spend it to craft any card.
  Scrap 5/10/25/60/150 and craft 40/80/200/500/1200 by rarity; foils are worth 4×.
- Scrapping from the pack reveal (with NEW / DUPLICATE / FOIL tags), per card on the Collection screen,
  and **Scrap extras** to keep one normal and one foil of each card.
- Card detail view on the Collection screen: switch between normal and foil, craft or scrap.
- **Daily challenges:** three a day from a pool of 16, with progress bars on the menu, completion notices
  on the result screen and after opening packs, and a countdown to the next set.
- A card back for each set.
### Changed
- The Collection screen shows every card in the set — nothing is hidden — with crafting costs on the ones you don't own.
- Card frames: the outer border shows rarity (iron, bronze, silver, gold, prismatic) and the inner border shows the
  element, replacing the L1–L5 labels and element icons. Ownership is shown on the name plate (blue / red).
- Element squares on the board use the same element colours.
- New containers use the Proxmox host's time zone (for the daily reset).
### Upgrading
- Just run `update`. Existing collections keep all their cards (as normal copies) and start with 0 shards.

## v2.2.1 — 2026-11-01
### Changed
- Card packs are real 3D objects: front and back faces with thickness between them, foil side walls,
  pillow-shaped shading, crinkles at the crimped seals, a gentle floating sway, a stronger tilt toward the
  pointer, and a 3D tear where the top flies off and the pack drops away.
- Each set's pack has its own back design (centre fin seal, set name, contents, barcode).

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
