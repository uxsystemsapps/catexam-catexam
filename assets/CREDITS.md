# Credits and licences of the game assets

Game mode uses only free assets whose licences allow use in this app. The app lists the same credits in
**Profile & settings → Credits** (`GAME_CREDITS` in `src/renderer/game.ts`); keep both lists in step.

All files are in `assets/game/`. Everything below is CC0 1.0 (public domain dedication,
https://creativecommons.org/publicdomain/zero/1.0/): no attribution is required, it is given anyway.

| File | What | Source | Author | Licence |
| --- | --- | --- | --- | --- |
| `cat.png` | Hoodie cat mascot, 8 frames of 72×64 px (idle, blink, cheer, sad, sweat, crying ×2, cheer with a grin) | [Pixel cat](https://opengameart.org/content/pixel-cat) (`cat_5.png`) | scofanogd | CC0 1.0 |
| `icons.png` | Heart, half heart, empty heart, gem, coin (18×18 px tiles 44, 45, 46, 67, 151) | [Pixel Platformer](https://kenney.nl/assets/pixel-platformer) | Kenney (kenney.nl) | CC0 1.0 |
| `map.png` | World map: grass, sand and snow islands (tiles 21–23, 41–43, 81–83 over 141–143), props (tiles 86, 27, 28, 129, 130, 127, 145, 11) and a flag (111) | [Pixel Platformer](https://kenney.nl/assets/pixel-platformer) | Kenney (kenney.nl) | CC0 1.0 |
| `bosses.png` | The eight bosses, 32×32 px each in domain order: hydra (`mon/dragons/hydra5.png`), azure jelly, iron golem, kraken head, lich, great orb of eyes, shadow dragon, spider | [Dungeon Crawl Stone Soup tiles](https://github.com/crawl/tiles) (CC0 release `releases/Nov-2015/mon/`) | Dungeon Crawl Stone Soup tile artists (listed in the repository's `ARTISTS.md`) | CC0 1.0 |
| `explosion.png` | Boss explosion, 5 frames of 16×16 px (tiles 4–8 of `Tilemap/tiles_packed.png`) | [Pixel Shmup](https://kenney.nl/assets/pixel-shmup) | Kenney (kenney.nl) | CC0 1.0 |
| `flame.png` | Combo flame, 3 frames of 32×32 px (`sFire_strip3.png`) | [Simple animate fire](https://opengameart.org/content/simple-animate-fire) | XenosNS | CC0 1.0 |
| `kenney-mini-square.ttf` | Pixel font (Kenney Mini Square) | [Kenney Fonts](https://kenney.nl/assets/kenney-fonts) | Kenney (kenney.nl) | CC0 1.0 |
| `sounds/ding.ogg` | Right answer (`confirmation_001.ogg`) | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | Kenney (kenney.nl) | CC0 1.0 |
| `sounds/buzz.ogg` | Wrong answer (`error_006.ogg`) | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | Kenney (kenney.nl) | CC0 1.0 |
| `sounds/whoosh.ogg` | Combo and round start (`phaserUp3.ogg`) | [Digital Audio](https://kenney.nl/assets/digital-audio) | Kenney (kenney.nl) | CC0 1.0 |
| `sounds/fanfare.ogg` | Level up and cleared round (`jingles_NES03.ogg`, 8-Bit jingles) | [Music Jingles](https://kenney.nl/assets/music-jingles) | Kenney (kenney.nl) | CC0 1.0 |
| `sounds/coin.ogg` | Coin clink with the XP (`handleCoins2.ogg`) | [RPG Audio](https://kenney.nl/assets/rpg-audio) | Kenney (kenney.nl) | CC0 1.0 |
| `music/map.ogg` | World map music, looping (`Level 1.wav`) | [Retro Game Music Pack](https://opengameart.org/content/5-chiptunes-action) (“5 Action Chiptunes”) | Juhani Junkala | CC0 1.0 (stated in the pack's `INFO.txt`) |
| `music/boss.ogg` | Boss fight music, looping (`Level 3.wav`) | [Retro Game Music Pack](https://opengameart.org/content/5-chiptunes-action) | Juhani Junkala | CC0 1.0 |
| `music/lightning.ogg` | Lightning round music, looping (`Level 2.wav`) | [Retro Game Music Pack](https://opengameart.org/content/5-chiptunes-action) | Juhani Junkala | CC0 1.0 |
| `powerups.png` | Power-ups, 3 tiles of 16×16 px: 50/50 (double axe, tile 118), Ask the Auditor (wizard, tile 84), Patch Tuesday (red potion, tile 115) of `Tilemap/tilemap_packed.png` | [Tiny Dungeon](https://kenney.nl/assets/tiny-dungeon) | Kenney (kenney.nl) | CC0 1.0 |
| `badges.png` | Achievement badges, 15 cells of 18×18 px in the order of `ACHIEVEMENTS` (`src/engine/game.ts`): Pixel Platformer tiles 7, 28, 27, 10, 111, 66, 151, 67 and Tiny Dungeon tiles 104, 102, 90, 92, 116, 96, 101 | [Pixel Platformer](https://kenney.nl/assets/pixel-platformer) and [Tiny Dungeon](https://kenney.nl/assets/tiny-dungeon) | Kenney (kenney.nl) | CC0 1.0 |
| `sounds/powerup.ogg` | A power-up used (`powerUp2.ogg`) | [Digital Audio](https://kenney.nl/assets/digital-audio) | Kenney (kenney.nl) | CC0 1.0 |
| `sounds/pickup.ogg` | A power-up earned (`threeTone1.ogg`) | [Digital Audio](https://kenney.nl/assets/digital-audio) | Kenney (kenney.nl) | CC0 1.0 |
| `sounds/achievement.ogg` | Achievement unlocked (`jingles_NES14.ogg`, 8-Bit jingles) | [Music Jingles](https://kenney.nl/assets/music-jingles) | Kenney (kenney.nl) | CC0 1.0 |
| `sounds/tick.ogg` | Lightning round countdown, last ten seconds (`tick_002.ogg`) | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | Kenney (kenney.nl) | CC0 1.0 |

## Changes made to the assets

- **Hoodie cat**: no free pack has a pixel cat in a hoodie, so `cat_5.png` was adapted for this app: the
  torso is recoloured as a blue hoodie with a folded hood, drawstrings, a pocket seam and a padlock print, and
  extra frames were drawn from it (blink; cheer with closed happy eyes, an open smile and gold sparkles, and a
  second cheer frame with a grin and the sparkles moved; sad with slanted brows and a wailing mouth; sweat with
  drops and wide eyes; two crying frames with slanted brows, tear streams, falling drops and a wailing mouth).
  The cat never raises paws. The canvas grew from 57×56 to 72×64 px (room for the sparkles).
- **Icons**: five tiles of the Pixel Platformer pack copied side by side into one sprite sheet.
- **Map**: Pixel Platformer tiles composed into three 4×2-tile islands and a row of props.
- **Power-ups and badges**: Tiny Dungeon (16×16) and Pixel Platformer (18×18) tiles copied unchanged side by
  side into two sprite sheets; the 16×16 badge tiles are centred in 18×18 cells. The medal behind a badge, its
  grey locked look and the use animations are CSS.
- **Bosses**: eight Dungeon Crawl tiles copied unchanged side by side into one sprite sheet (the idle breathing,
  hit flash, shake and defeat are CSS animations).
- **Explosion**: five Pixel Shmup tiles copied side by side into one strip.
- **Music**: the WAV tracks re-encoded as Ogg Vorbis (quality 1, about 75 kbit/s) and renamed; nothing else changed.
- The flame, font and sounds are used unchanged (renamed).
