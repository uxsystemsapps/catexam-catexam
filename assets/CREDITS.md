# Credits and licences of the game assets

Game mode uses only free assets whose licences allow use in this app. The app lists the same credits in
**Profile & settings → Credits** (`GAME_CREDITS` in `src/renderer/game.ts`); keep both lists in step.

All files are in `assets/game/`. Everything below is CC0 1.0 (public domain dedication,
https://creativecommons.org/publicdomain/zero/1.0/): no attribution is required, it is given anyway.

| File | What | Source | Author | Licence |
| --- | --- | --- | --- | --- |
| `cat.png` | Hoodie cat mascot, 5 poses of 72×64 px (idle, blink, cheer, facepalm, sweat) | [Pixel cat](https://opengameart.org/content/pixel-cat) (`cat_5.png`) | scofanogd | CC0 1.0 |
| `icons.png` | Heart, half heart, empty heart, gem, coin (18×18 px tiles 44, 45, 46, 67, 151) | [Pixel Platformer](https://kenney.nl/assets/pixel-platformer) | Kenney (kenney.nl) | CC0 1.0 |
| `flame.png` | Combo flame, 3 frames of 32×32 px (`sFire_strip3.png`) | [Simple animate fire](https://opengameart.org/content/simple-animate-fire) | XenosNS | CC0 1.0 |
| `kenney-mini-square.ttf` | Pixel font (Kenney Mini Square) | [Kenney Fonts](https://kenney.nl/assets/kenney-fonts) | Kenney (kenney.nl) | CC0 1.0 |
| `sounds/ding.ogg` | Right answer (`confirmation_001.ogg`) | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | Kenney (kenney.nl) | CC0 1.0 |
| `sounds/buzz.ogg` | Wrong answer (`error_006.ogg`) | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | Kenney (kenney.nl) | CC0 1.0 |
| `sounds/whoosh.ogg` | Combo and round start (`phaserUp3.ogg`) | [Digital Audio](https://kenney.nl/assets/digital-audio) | Kenney (kenney.nl) | CC0 1.0 |
| `sounds/fanfare.ogg` | Level up and cleared round (`jingles_NES03.ogg`, 8-Bit jingles) | [Music Jingles](https://kenney.nl/assets/music-jingles) | Kenney (kenney.nl) | CC0 1.0 |
| `sounds/coin.ogg` | Coin clink with the XP (`handleCoins2.ogg`) | [RPG Audio](https://kenney.nl/assets/rpg-audio) | Kenney (kenney.nl) | CC0 1.0 |

## Changes made to the assets

- **Hoodie cat**: no free pack has a pixel cat in a hoodie, so `cat_5.png` was adapted for this app: the
  torso is recoloured as a blue hoodie with a folded hood, drawstrings, a pocket seam and a padlock print, and
  four extra poses were drawn from it (blink; cheer with raised paws and an open smile; facepalm with a paw over
  the eyes; sweat with drops and wide eyes). The canvas grew from 57×56 to 72×64 px for the raised paws.
- **Icons**: six tiles of the Pixel Platformer pack copied side by side into one sprite sheet.
- The flame, font and sounds are used unchanged (renamed).
