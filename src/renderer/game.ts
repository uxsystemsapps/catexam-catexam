// Game mode: the training questions as a pixel-art arcade game, with XP, ranks, combos, hearts and a hoodie cat
// that reacts to every answer (stage 1), a world map of eight islands, one per domain, each ending with a boss
// fight, with music (stage 2), and power-ups, achievements, the daily challenge and the lightning round
// (stage 3). Loaded before app.js and shares its global scope: it uses the app's helpers
// (h, show, api, questionBody, feedbackNodes…) when its screens open. Scoring, hearts, bosses and saving live in
// the service (src/engine/game.ts); this script only shows them.
//
// Effects never stand between the player and the explanation: they sit in a layer that ignores the pointer (or,
// for the boss, in the arena above the question), the explanation is part of the feedback, and the level-up,
// victory and game-over screens come after "Next".

/* exported gameCard, gameSettingsCard, creditsCard, stopGameMusic */

/** Art, font, sounds and music (assets/game, copied next to this script). */
const GAME_ASSETS = 'game/';

/** Assets of the game and where they come from; listed in Profile & settings and in assets/CREDITS.md. */
const GAME_CREDITS: { what: string; source: string; author: string; licence: string; url: string }[] = [
  { what: 'Hoodie cat mascot (adapted: hoodie, padlock print, cheering, sad, sweating and crying frames added)', source: 'Pixel cat', author: 'scofanogd', licence: 'CC0 1.0', url: 'https://opengameart.org/content/pixel-cat' },
  { what: 'Hearts, gem, coin, the islands and props of the world map, and eight achievement badges (link, lock, key, ! block, flag, lever, coin, gem)', source: 'Pixel Platformer', author: 'Kenney', licence: 'CC0 1.0', url: 'https://kenney.nl/assets/pixel-platformer' },
  { what: 'Power-up icons (double axe, wizard, red potion) and seven achievement badges (sword, shields, chests, blue potion, helmet)', source: 'Tiny Dungeon', author: 'Kenney', licence: 'CC0 1.0', url: 'https://kenney.nl/assets/tiny-dungeon' },
  { what: 'Combo flame', source: 'Simple animate fire', author: 'XenosNS', licence: 'CC0 1.0', url: 'https://opengameart.org/content/simple-animate-fire' },
  { what: 'Bosses (hydra, jelly, iron golem, kraken, lich, orb of eyes, shadow dragon, spider)', source: 'Dungeon Crawl Stone Soup tiles', author: 'the Dungeon Crawl Stone Soup tile artists', licence: 'CC0 1.0', url: 'https://github.com/crawl/tiles' },
  { what: 'Boss explosion', source: 'Pixel Shmup', author: 'Kenney', licence: 'CC0 1.0', url: 'https://kenney.nl/assets/pixel-shmup' },
  { what: 'Pixel font (Kenney Mini Square)', source: 'Kenney Fonts', author: 'Kenney', licence: 'CC0 1.0', url: 'https://kenney.nl/assets/kenney-fonts' },
  { what: 'Right-answer ding, wrong-answer buzz and the lightning round countdown tick', source: 'Interface Sounds', author: 'Kenney', licence: 'CC0 1.0', url: 'https://kenney.nl/assets/interface-sounds' },
  { what: 'Combo whoosh, power-up zap and power-up pickup', source: 'Digital Audio', author: 'Kenney', licence: 'CC0 1.0', url: 'https://kenney.nl/assets/digital-audio' },
  { what: 'Level-up fanfare and achievement jingle', source: 'Music Jingles', author: 'Kenney', licence: 'CC0 1.0', url: 'https://kenney.nl/assets/music-jingles' },
  { what: 'Coin clink', source: 'RPG Audio', author: 'Kenney', licence: 'CC0 1.0', url: 'https://kenney.nl/assets/rpg-audio' },
  { what: 'Music: map, boss fight and lightning round tracks (Level 1, 3 and 2)', source: 'Retro Game Music Pack', author: 'Juhani Junkala', licence: 'CC0 1.0', url: 'https://opengameart.org/content/5-chiptunes-action' },
];

const QUIPS = {
  right: [
    'Access granted. The auditors weep with joy.',
    'Least privilege, most points.',
    'You just patched a zero-day before lunch.',
    'The CISO nods. Slightly.',
    'Hackers hate this one weird trick: knowing things.',
    'Defence in depth? More like defence in YOU.',
    'Your password manager is proud of you.',
    'Firewall rule added: ALLOW you, ALWAYS.',
    'That answer had MFA: Massively Fine Accuracy.',
    'The red team just filed a complaint about you.',
  ],
  wrong: [
    'You just emailed the password to the whole company.',
    'Somebody plugged in the USB stick from the car park.',
    'That answer was stored in plain text.',
    'The intern clicked the phishing link. The intern was you.',
    'Congratulations, you are now the incident.',
    'Password: Password123. Again.',
    'New firewall rule: ANY ANY ALLOW.',
    'The auditors would like a word.',
    'Change management called. They are not amused.',
    'Shadow IT just got a new member.',
  ],
  timeout: [
    'Session timed out. Much like that unpatched server.',
    'Too slow! The ransomware did not wait.',
    'The SLA has left the building.',
  ],
  lives: [
    'Game over. The breach report has your name in the summary.',
    'All hearts compromised. Time to restore from backup.',
    'Your hearts were encrypted. The ransom is one more try.',
    'Kernel panic! Reboot and try again.',
  ],
  cleared: ['Round clear! Every question survived your audit.', 'Perimeter secured. For now.', 'Clean audit. Somebody frame this.'],
  quit: ['You logged off early. The attackers did not.', 'Rage-quit detected. Logged for the SIEM.'],
  hit: [
    'Critical hit! Straight through its firewall.',
    'Patched! The boss felt that one.',
    'Direct hit. The boss is filing an incident report.',
    'Boom. That is what defence in depth looks like.',
    'The boss just lost a hit point and some dignity.',
  ],
  victory: ['Write it up in the lessons-learned report.', 'Somebody update the risk register.', 'The SOC is buying pizza.'],
  time: ['Time! The packets have stopped flowing.', 'Session expired. Your score did not.', 'Rate limit reached. Nice throughput, though.'],
  daily: ['Daily stand-up done. Nobody even had to share their screen.', 'Another day, another audit passed.', 'Streak secured. The SOC salutes you.'],
};

/** The power-ups: name, what they do, and the shout when one is used. */
const POWER_UPS: Record<PowerUpId, { name: string; short: string; what: string; shout: string }> = {
  fifty: { name: '50/50', short: '50/50', what: 'removes two wrong options', shout: '50/50! TWO OPTIONS DELETED' },
  auditor: { name: 'Ask the Auditor', short: 'Auditor', what: 'rules out one wrong option and says why', shout: 'THE AUDITOR IS IN' },
  patch: { name: 'Patch Tuesday', short: 'Patch', what: 'mends a broken heart', shout: 'PATCH TUESDAY! +1 HEART' },
};
const POWER_UP_ORDER: PowerUpId[] = ['fifty', 'auditor', 'patch'];

function pick(lines: readonly string[]): string {
  return lines[Math.floor(Math.random() * lines.length)];
}

// ---------- Sound and effects ----------

type Sfx = 'ding' | 'buzz' | 'whoosh' | 'fanfare' | 'coin' | 'powerup' | 'pickup' | 'achievement' | 'tick';

/** Settings of the last `info()` call; the HUD sound and music buttons and Profile & settings change them. */
let gameSettings: GameSettings = { sound: false, volume: 70, music: false, musicVolume: 50, lite: false, difficulty: 'normal', stageQuestions: 6, bossHp: 5, hearts: 3, islandSeconds: 0 };
const sfxCache: Partial<Record<Sfx, HTMLAudioElement>> = {};

function playSfx(name: Sfx, delay = 0): void {
  if (!gameSettings.sound || gameSettings.volume === 0) return;
  let audio = sfxCache[name];
  if (!audio) {
    audio = new Audio(`${GAME_ASSETS}sounds/${name}.ogg`);
    sfxCache[name] = audio;
  }
  const sound = audio;
  setTimeout(() => {
    sound.volume = gameSettings.volume / 100;
    sound.currentTime = 0;
    // Autoplay rules or a missing codec must never break the game.
    void sound.play().catch(() => undefined);
  }, delay);
}

/** Looping music tracks: the world map (and the rounds before a boss), boss fights, and the stage 3 lightning round. */
type Track = 'map' | 'boss' | 'lightning';
const musicCache: Partial<Record<Track, HTMLAudioElement>> = {};
/** Track of the screen on show (null: no music), playing or not (music off, or the app in the background). */
let musicWanted: Track | null = null;
let musicStop: number | undefined;

/**
 * Plays `track` in a loop (null: silence), with the music settings; a track picks up where it was left. The
 * track playing is `html[data-music]` (`off` when nothing plays).
 */
function playMusic(track: Track | null): void {
  clearTimeout(musicStop);
  musicWanted = track;
  const on = track !== null && gameSettings.music && gameSettings.musicVolume > 0 && !document.hidden;
  for (const [name, audio] of Object.entries(musicCache)) if (!on || name !== track) audio.pause();
  document.documentElement.dataset.music = on ? track : 'off';
  if (!on) return;
  let audio = musicCache[track];
  if (!audio) {
    audio = new Audio(`${GAME_ASSETS}music/${track}.ogg`);
    audio.loop = true;
    musicCache[track] = audio;
  }
  audio.volume = gameSettings.musicVolume / 100;
  // Autoplay rules or a missing codec must never break the game.
  if (audio.paused) void audio.play().catch(() => undefined);
}

/** Called by `show()` for every screen: the music stops unless a game screen follows at once (see `gameScreen`). */
function stopGameMusic(): void {
  clearTimeout(musicStop);
  musicStop = window.setTimeout(() => playMusic(null), 0);
}

// The music pauses while the app is in the background (phone locked, another app or window in front).
document.addEventListener('visibilitychange', () => playMusic(musicWanted));

/**
 * How much moves: `full`; `lite` (the setting: no particles, shake or bouncing); `still` (the system asks to
 * reduce motion: nothing animates, only colours and text change).
 */
function effectLevel(): 'full' | 'lite' | 'still' {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return 'still';
  return gameSettings.lite ? 'lite' : 'full';
}

/** Full-screen layer for particles, floating numbers and banners; it never takes clicks or taps. */
function fxLayer(): HTMLElement {
  return document.getElementById('fx-layer') ?? document.body.appendChild(h('div', { id: 'fx-layer', class: 'fx-layer', 'aria-hidden': 'true' }));
}

/** Removes an effect element when its animation ends (or after `ms` when nothing animates). */
function expire(el: HTMLElement, ms: number): void {
  el.addEventListener('animationend', () => el.remove(), { once: true });
  setTimeout(() => el.remove(), ms);
}

/** Pixel sparks (right answer) or confetti (level up) from a point of the screen. */
function burst(x: number, y: number, kind: 'spark' | 'confetti'): void {
  if (effectLevel() !== 'full') return;
  const layer = fxLayer();
  const n = kind === 'spark' ? 14 : 36;
  for (let i = 0; i < n; i++) {
    const bit = h('span', { class: `fx-bit ${kind} c${i % 5}` });
    const angle = (Math.PI * 2 * i) / n + Math.random() * 0.4;
    const reach = (kind === 'spark' ? 50 : 140) + Math.random() * 70;
    bit.style.left = `${x}px`;
    bit.style.top = `${y}px`;
    bit.style.setProperty('--dx', `${Math.round(Math.cos(angle) * reach)}px`);
    bit.style.setProperty('--dy', `${Math.round(Math.sin(angle) * reach - (kind === 'confetti' ? 60 : 20))}px`);
    layer.append(bit);
    expire(bit, 1600);
  }
}

/** Text that floats up from a point ("+20 XP"), or a big banner across the screen when `x` is null. */
function floatText(text: string, x: number | null, y: number, cls = ''): void {
  const el = h('span', { class: `${x === null ? 'fx-banner' : 'fx-float'} ${cls}` }, text);
  if (x !== null) {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }
  fxLayer().append(el);
  expire(el, x === null ? 1800 : 1400);
}

function centre(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Shouts for streaks that do not start a frenzy (5 and 10 have their own banners). */
const STREAK_SHOUTS: Record<number, string> = { 3: 'NICE!', 7: 'ON FIRE!', 15: 'UNSTOPPABLE!', 20: 'ROOT ACCESS!' };

/** Coins flying from `from` into `to` (the XP bar), which pulses as they land. */
function coinsTo(from: Element, to: Element, n: number): void {
  if (effectLevel() !== 'full') return;
  const a = centre(from);
  const b = centre(to);
  for (let i = 0; i < n; i++) {
    const coin = h('span', { class: 'fx-coin px-icon coin' });
    coin.style.left = `${a.x + (i - n / 2) * 10}px`;
    coin.style.top = `${a.y}px`;
    coin.style.setProperty('--tx', `${Math.round(b.x - a.x - (i - n / 2) * 10)}px`);
    coin.style.setProperty('--ty', `${Math.round(b.y - a.y)}px`);
    coin.style.animationDelay = `${i * 70}ms`;
    fxLayer().append(coin);
    expire(coin, 1500);
  }
  setTimeout(() => {
    to.classList.remove('pulse');
    void (to as HTMLElement).offsetWidth;
    to.classList.add('pulse');
  }, 600);
}

/** A broken heart tumbling off the HUD. */
function heartFall(heart: Element): void {
  if (effectLevel() !== 'full') return;
  const r = heart.getBoundingClientRect();
  const falling = h('span', { class: 'fx-heart px-icon heart' });
  falling.style.left = `${r.left}px`;
  falling.style.top = `${r.top}px`;
  fxLayer().append(falling);
  expire(falling, 1400);
}

/** A short red flash at the screen edges after a wrong answer. */
function flash(): void {
  const el = h('span', { class: 'fx-flash' });
  fxLayer().append(el);
  expire(el, 700);
}

/** The letters of a title as spans that drop in one after the other. */
function dropLetters(text: string): HTMLElement[] {
  return [...text].map((ch, i) => {
    const s = h('span', { class: 'drop-letter', 'aria-hidden': 'true' }, ch);
    s.style.animationDelay = `${i * 60}ms`;
    return s;
  });
}

/** Counts a number up from 0 (shown at once when nothing may move). */
function countUp(el: HTMLElement, to: number, prefix: string): void {
  if (effectLevel() === 'still' || to === 0) return;
  const t0 = performance.now();
  const step = (now: number): void => {
    const k = Math.min(1, (now - t0) / 900);
    el.textContent = `${prefix}${Math.round(to * k * (2 - k))}`;
    if (k < 1 && el.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- Pixel parts ----------

type CatPose = 'idle' | 'cheer' | 'sad' | 'sweat' | 'cry';

function cat(pose: CatPose, id?: string): HTMLElement {
  return h('div', { class: 'cat', 'data-pose': pose, id: id ?? false, role: 'img', 'aria-label': `Hoodie cat (${pose})` });
}

function icon(name: 'heart' | 'heart-empty' | 'gem' | 'coin'): HTMLElement {
  return h('span', { class: `px-icon ${name}`, 'aria-hidden': 'true' });
}

function hearts(lives: number, max: number): HTMLElement {
  const row = h('span', { class: 'hearts', id: 'game-hearts', role: 'img', 'aria-label': `${lives} of ${max} hearts left` });
  for (let i = 0; i < max; i++) row.append(icon(i < lives ? 'heart' : 'heart-empty'));
  return row;
}

/** A power-up icon (16×16 tiles of game/powerups.png). */
function powerIcon(id: PowerUpId): HTMLElement {
  return h('span', { class: `pu-icon pu-${id}`, 'aria-hidden': 'true' });
}

/** The power-ups held: icon and count of each. */
function inventory(powerUps: PowerUps, id: string): HTMLElement {
  return h(
    'div',
    { class: 'inventory', id, role: 'img', 'aria-label': `Power-ups: ${POWER_UP_ORDER.map((p) => `${POWER_UPS[p].name} ${powerUps[p]}`).join(', ')}` },
    ...POWER_UP_ORDER.map((p) => h('span', { class: `inv-slot${powerUps[p] === 0 ? ' empty' : ''}`, title: `${POWER_UPS[p].name}: ${POWER_UPS[p].what}` }, powerIcon(p), h('span', { class: 'inv-count' }, `×${powerUps[p]}`))),
  );
}

/** An achievement badge: its picture (18×18 tiles of game/badges.png) on a medal, grey while locked. */
function badge(a: AchievementInfo): HTMLElement {
  return h('span', { class: `badge-medal${a.unlocked ? '' : ' locked'}`, 'aria-hidden': 'true' }, cssVars(h('span', { class: 'badge-icon' }), { b: a.badge }));
}

/**
 * Pop-ups of newly unlocked achievements, one after the other at the top of the screen, each with a jingle. They
 * sit in their own layer, which ignores the pointer and outlives a change of screen (the lightning round moves on fast).
 */
function announceAchievements(list: readonly AchievementInfo[]): void {
  list.forEach((a, i) =>
    setTimeout(() => {
      const layer = document.getElementById('pop-layer') ?? document.body.appendChild(h('div', { id: 'pop-layer', class: 'pop-layer', role: 'status' }));
      const pop = h(
        'div',
        { class: 'achievement-pop', 'data-achievement': a.id },
        badge(a),
        h('span', { class: 'pop-text' }, h('span', { class: 'pop-title' }, 'ACHIEVEMENT UNLOCKED'), h('span', { class: 'pop-name' }, a.name)),
      );
      layer.append(pop);
      playSfx('achievement');
      setTimeout(() => pop.remove(), 3400);
    }, i * 1800),
  );
}

/** Level, rank and the XP bar of the current level. */
function levelBar(level: LevelInfo, id: string): HTMLElement {
  const fill = h('span', { class: 'xp-fill' });
  fill.style.width = `${Math.min(100, ((level.xp - level.levelStart) / (level.nextLevel - level.levelStart)) * 100)}%`;
  return h(
    'div',
    { class: 'level-bar', id },
    h('div', { class: 'level-line' }, h('span', { class: 'level-num' }, `LV ${level.level}`), h('span', { class: 'rank' }, level.rank)),
    h('div', { class: 'xp-track', role: 'progressbar', 'aria-label': 'XP to the next level', 'aria-valuemin': String(level.levelStart), 'aria-valuemax': String(level.nextLevel), 'aria-valuenow': String(level.xp) }, fill),
    h('div', { class: 'xp-text' }, `${level.xp} / ${level.nextLevel} XP`),
  );
}

function rankBadge(level: LevelInfo): HTMLElement {
  return h('div', { class: 'rank-badge', id: 'rank-badge' }, icon('gem'), h('span', { class: 'badge-level' }, `LV ${level.level}`), h('span', { class: 'badge-rank' }, level.rank));
}

/** Combo counter with its flame: small from 2 in a row, bigger in a frenzy (x2 from 5, x3 from 10). */
function comboMeter(combo: number, multiplier: number): HTMLElement {
  const tier = combo >= 10 ? 3 : combo >= 5 ? 2 : combo >= 2 ? 1 : 0;
  return h(
    'span',
    { class: `combo tier-${tier}`, id: 'game-combo', 'aria-label': `Combo ${combo}${multiplier > 1 ? `, points x${multiplier}` : ''}` },
    tier > 0 && h('span', { class: 'flame', 'aria-hidden': 'true' }),
    h('span', { class: 'combo-count' }, `COMBO ${combo}`),
    multiplier > 1 && h('span', { class: 'combo-mult' }, `x${multiplier}`),
  );
}

/** Wraps a game screen: pixel look, the effect level as a data attribute for the CSS, and its music. */
function gameScreen(track: Track | null, ...nodes: Node[]): void {
  document.getElementById('fx-layer')?.remove();
  show(...nodes);
  document.documentElement.dataset.fx = effectLevel();
  playMusic(track);
}

// ---------- Home card, settings and credits (used by app.ts) ----------

/** Card of the start screen that opens the game. */
function gameCard(info: AppInfo): HTMLElement {
  gameSettings = info.game.settings;
  return h(
    'section',
    { class: 'card game-card', id: 'game-card' },
    cat('idle'),
    h(
      'div',
      { class: 'game-card-text' },
      h('h2', {}, 'Game mode'),
      h('p', { class: 'small' }, 'The same questions as an arcade game: a world map with a boss on every island, a daily challenge, a lightning round, power-ups and achievements, XP, ranks, combos and hearts. The explanation always follows each answer.'),
      levelBar(info.game.level, 'home-level'),
    ),
    h('button', { id: 'open-game', class: 'px-button', disabled: info.bank.total === 0, onclick: () => void gameHub() }, 'Play ▶'),
  );
}

/** Whole numbers from `min` to `max`, for a select. */
const choices = (min: number, max: number): [number, string][] => Array.from({ length: max - min + 1 }, (_, i): [number, string] => [min + i, String(min + i)]);

const ISLAND_DIFFICULTY_LABELS: Record<GameSettings['difficulty'], string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

/** What an island holds with these rules, for the island panel. */
function islandRulesText(s: GameSettings): string {
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
  const timer = s.islandSeconds > 0 ? ` ${s.islandSeconds} seconds per question.` : '';
  return `${plural(s.stageQuestions, 'question')} of this domain, then the boss: each right answer is a hit, ${plural(s.bossHp, 'hit')} to win, and it never heals. ${plural(s.hearts, 'heart')} for the whole island; wrong answers join your questions to retry.${timer} Change the rules in Profile & settings.`;
}

/**
 * Game settings for Profile & settings: sound effects and music, each on/off with its volume, lite effects, and the
 * game rules (island difficulty, stage length, boss hit points, hearts, island timer).
 */
function gameSettingsCard(settings: GameSettings): { node: HTMLElement; read: () => GameSettings } {
  const sound = h('input', { id: 'settings-sound', type: 'checkbox', checked: settings.sound });
  const volume = h('input', { id: 'settings-volume', type: 'range', min: '0', max: '100', step: '5', value: String(settings.volume) });
  const music = h('input', { id: 'settings-music', type: 'checkbox', checked: settings.music });
  const musicVolume = h('input', { id: 'settings-music-volume', type: 'range', min: '0', max: '100', step: '5', value: String(settings.musicVolume) });
  const lite = h('input', { id: 'settings-lite', type: 'checkbox', checked: settings.lite });
  const difficulty = select('settings-game-difficulty', Object.entries(ISLAND_DIFFICULTY_LABELS) as [GameSettings['difficulty'], string][], settings.difficulty);
  const stageQuestions = select('settings-stage-questions', choices(3, 20), settings.stageQuestions);
  const bossHp = select('settings-boss-hp', choices(1, 15), settings.bossHp);
  const hearts = select('settings-hearts', choices(1, 5), settings.hearts);
  const islandSeconds = select('settings-island-timer', [0, 15, 30, 45, 60, 90, 120].map((s): [number, string] => [s, s === 0 ? 'Off' : `${s} s per question`]), settings.islandSeconds);
  return {
    node: h(
      'section',
      { class: 'card', id: 'game-settings' },
      h('h2', {}, 'Game mode'),
      h('label', { class: 'check' }, sound, ' Sound effects'),
      h('label', { class: 'field' }, 'Volume', volume),
      h('label', { class: 'check' }, music, ' Music (world map, boss fights and lightning round)'),
      h('label', { class: 'field' }, 'Music volume', musicVolume),
      h('label', { class: 'check' }, lite, ' Lite effects (no particles, shaking or bouncing)'),
      h('p', { class: 'small' }, 'When the system asks to reduce motion, the game shows no animations at all.'),
      h('h3', {}, 'Game rules'),
      h(
        'div',
        { class: 'form-grid', id: 'game-rules' },
        h('label', { class: 'field' }, 'Island difficulty', difficulty, h('span', { class: 'field-hint' }, 'Easy: easier stage, gentler boss')),
        h('label', { class: 'field' }, 'Questions per island', stageQuestions, h('span', { class: 'field-hint' }, 'Before the boss')),
        h('label', { class: 'field' }, 'Hits to beat a boss', bossHp, h('span', { class: 'field-hint' }, 'Right answers in the boss fight')),
        h('label', { class: 'field' }, 'Hearts', hearts, h('span', { class: 'field-hint' }, 'Islands and quick rounds')),
        h('label', { class: 'field' }, 'Island timer', islandSeconds),
      ),
      h('p', { class: 'small' }, 'The rules apply from the next round. Small domains may give fewer questions or a weaker boss.'),
    ),
    read: () => ({
      sound: sound.checked,
      volume: Number(volume.value),
      music: music.checked,
      musicVolume: Number(musicVolume.value),
      lite: lite.checked,
      difficulty: difficulty.value as GameSettings['difficulty'],
      stageQuestions: Number(stageQuestions.value),
      bossHp: Number(bossHp.value),
      hearts: Number(hearts.value),
      islandSeconds: Number(islandSeconds.value),
    }),
  };
}

function creditsCard(): HTMLElement {
  return h(
    'section',
    { class: 'card', id: 'credits' },
    h('h2', {}, 'Credits'),
    h('p', { class: 'small' }, 'Game art, font, sounds and music are free assets used under their licences:'),
    h('ul', { class: 'credits' }, ...GAME_CREDITS.map((c) => h('li', {}, h('strong', {}, c.what), `: “${c.source}” by ${c.author}, ${c.licence} (${c.url})`))),
  );
}

// ---------- The world map ----------

/**
 * One island per CISSP domain (in domain order): its name, its ground (its prop is `.prop-<domain>` in the CSS),
 * its boss (sprite `n` of game/bosses.png is the boss of domain n + 1) with what it says when you miss and when
 * it wins, and where it sits on the map in % (`wide`: two rows of four; `tall`, on a phone: four rows of two).
 */
const ISLANDS: { name: string; ground: 'grass' | 'sand' | 'snow'; boss: string; taunts: [string, string]; wins: string; wide: [number, number]; tall: [number, number] }[] = [
  { name: 'Risk Reef', ground: 'grass', boss: 'The Risk Hydra', taunts: ['Cut off one risk and two more grow back!', 'Risk accepted. By me. On your behalf.'], wins: 'The Risk Hydra filed you under “residual risk”.', wide: [12, 28], tall: [27, 11] },
  { name: 'Asset Atoll', ground: 'grass', boss: 'The Data Leak Blob', taunts: ['Nobody labelled this data. Mine now!', 'Unclassified and unencrypted: delicious.'], wins: 'The Data Leak Blob oozed off with your crown jewels.', wide: [37, 22], tall: [73, 14] },
  { name: 'The Crypto Caves', ground: 'snow', boss: 'The Side-Channel Golem', taunts: ['I can hear your keys through the power line.', 'Nice cipher. Shame about the timing.'], wins: 'The Side-Channel Golem read your private key off the fan noise.', wide: [62, 30], tall: [72, 38] },
  { name: 'Packet Peninsula', ground: 'grass', boss: 'The Phishing Kraken', taunts: ['URGENT: verify your password here!', 'Click the link. All the cool admins do.'], wins: 'The Phishing Kraken says thanks for the credentials.', wide: [87, 24], tall: [28, 36] },
  { name: 'Fortress of Access Control', ground: 'sand', boss: 'The Privilege Lich', taunts: ['Least privilege? I prefer MOST privilege.', 'My account never expires. Neither do I.'], wins: 'The Privilege Lich just granted itself Domain Admin.', wide: [86, 74], tall: [27, 61] },
  { name: 'Pentest Dunes', ground: 'sand', boss: 'The Orb of a Thousand Scans', taunts: ['4,096 findings, all critical. Probably.', 'Your scope document? Never read it.'], wins: 'The Orb of a Thousand Scans marked you as a false negative.', wide: [61, 68], tall: [73, 64] },
  { name: 'SOC Glacier', ground: 'snow', boss: 'The Ransomware Dragon', taunts: ['Your files are mine. Pay in Bitcoin.', 'Backups? How quaint. Were they offline?'], wins: 'The Ransomware Dragon encrypted your hearts. Restore from backup: retry.', wide: [37, 76], tall: [72, 88] },
  { name: 'Code Cove', ground: 'grass', boss: 'The Zero-Day Bug', taunts: ['Nobody has patched me. Nobody even knows me!', 'Input validation? Never heard of her.'], wins: 'The Zero-Day Bug shipped to production. Again.', wide: [12, 70], tall: [28, 86] },
];

/** Island cleared by the last boss fight: it lights up when the map opens next. */
let justCleared: DomainId | null = null;
/** Milliseconds per island when the cat walks along the path. */
const WALK_STEP_MS = 380;

/** Sets CSS custom properties through the CSSOM: the Content-Security-Policy blocks `style` attributes. */
function cssVars<E extends HTMLElement>(el: E, vars: Record<string, number>): E {
  for (const [name, value] of Object.entries(vars)) el.style.setProperty(`--${name}`, String(value));
  return el;
}

/** A boss sprite (32×32, scaled by `--bs` in the CSS). */
function bossSprite(domain: DomainId, id?: string): HTMLElement {
  return cssVars(h('span', { class: 'boss-sprite', id: id ?? false, role: 'img', 'aria-label': ISLANDS[domain - 1].boss }), { b: domain - 1 });
}

/** The dotted path between the islands (one line per leg) in one layout; a leg is lit and marches once the island it leaves is cleared. */
function mapPath(layout: 'wide' | 'tall', world: WorldProgress): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', `map-path path-${layout}`);
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < ISLANDS.length - 1; i++) {
    const [x1, y1] = ISLANDS[i][layout];
    const [x2, y2] = ISLANDS[i + 1][layout];
    const leg = document.createElementNS(ns, 'line');
    for (const [k, v] of Object.entries({ x1, y1, x2, y2 })) leg.setAttribute(k, String(v));
    if (world.islands[i].cleared) leg.setAttribute('class', 'lit');
    svg.append(leg);
  }
  return svg;
}

/** A big button of the game hub that opens another way to play. */
function modeButton(id: string, picture: HTMLElement, title: string, sub: string, open: () => void): HTMLElement {
  return h('button', { id, class: 'mode-button', onclick: open }, h('span', { class: 'mode-pic' }, picture), h('span', { class: 'mode-text' }, h('span', { class: 'mode-title' }, title), h('span', { class: 'mode-sub' }, sub)));
}

/**
 * Game start screen: the player's rank, power-ups, the other ways to play (daily challenge, lightning round,
 * achievements) and the world map. The cat stands on the island played last; tap an island and it walks there
 * along the path, and the panel below shows the island and its boss, with Play (the domain's questions, then the
 * boss) and, once the stage has been won, a direct boss fight. Cleared islands are lit and alive, and so is the
 * path leaving them. Quick round opens the stage 1 round picker.
 */
async function gameHub(): Promise<void> {
  const info = await api.info();
  gameSettings = info.game.settings;
  const world = info.game.world;
  const cleared = world.islands.filter((i) => i.cleared).length;
  const daily = info.game.daily;
  const unlocked = info.game.achievements.filter((a) => a.unlocked).length;
  let at = world.at;
  let target = at;
  let walking = false;
  const walker = h('div', { class: 'map-walker', id: 'map-cat', 'data-at': String(at) }, h('div', { class: 'walker-flip' }, cat('idle')));
  const place = (d: DomainId): void => {
    const { wide, tall } = ISLANDS[d - 1];
    cssVars(walker, { wx: wide[0], wy: wide[1], tx: tall[0], ty: tall[1] });
    walker.dataset.at = String(d);
  };
  place(at);
  /** Walks the cat island by island to `target` (which may change on the way); it jumps when nothing may move. */
  const walk = (): void => {
    if (walking) return;
    walking = true;
    walker.classList.add('walking');
    const layout = matchMedia('(max-width: 760px)').matches ? 'tall' : 'wide';
    const step = (): void => {
      if (at === target || !walker.isConnected) {
        walker.classList.remove('walking');
        walking = false;
        return;
      }
      const next = (at + (target > at ? 1 : -1)) as DomainId;
      walker.classList.toggle('left', ISLANDS[next - 1][layout][0] < ISLANDS[at - 1][layout][0]);
      at = next;
      place(at);
      if (effectLevel() === 'still') step();
      else setTimeout(step, WALK_STEP_MS);
    };
    step();
  };
  const panel = h('section', { class: 'px-panel island-panel', id: 'island-panel', 'aria-live': 'polite' });
  const showIsland = (d: DomainId): void => {
    const island = ISLANDS[d - 1];
    const progress = world.islands[d - 1];
    const bank = info.bank.byDomain[d - 1];
    const status = progress.cleared
      ? `★ Cleared${progress.victories > 1 ? ` ×${progress.victories}` : ''}: the island is free.`
      : progress.bossReached
        ? 'Boss reached: beat it to light up the island.'
        : 'The boss is waiting at the end of the island.';
    panel.replaceChildren(
      h('div', { class: 'island-card' }, bossSprite(d, 'island-boss-sprite'), h(
        'div',
        { class: 'island-card-text' },
        h('h2', { class: 'px-title small-title', id: 'island-title' }, `${d}. ${island.name}`),
        h('p', { class: 'small' }, `Domain ${d}: ${bank.name} · ${bank.count} questions`),
        h('p', { class: 'island-boss-name' }, `Boss: ${island.boss}`),
        h('p', { class: 'small', id: 'island-status' }, status),
      )),
      h('p', { class: 'px-help', id: 'island-rules' }, islandRulesText(gameSettings)),
      h(
        'div',
        { class: 'row' },
        h('button', { id: 'island-play', class: 'px-button', disabled: bank.count === 0, onclick: () => void playRound(() => api.startIsland(d)) }, progress.cleared ? 'Play again ▶' : 'Play island ▶'),
        progress.bossReached && h('button', { id: 'island-boss', class: 'px-button ghosted', disabled: bank.count === 0, onclick: () => void playRound(() => api.startBoss(d)) }, 'Fight the boss ▶'),
      ),
    );
  };
  const islands = info.bank.byDomain.map((d) => {
    const island = ISLANDS[d.domain - 1];
    const progress = world.islands[d.domain - 1];
    const button = cssVars(
      h(
        'button',
        {
          id: `map-island-${d.domain}`,
          class: `map-island ground-${island.ground}${progress.cleared ? ' cleared' : ''}${justCleared === d.domain ? ' lights-up' : ''}`,
          'data-domain': String(d.domain),
          'aria-pressed': String(d.domain === at),
          'aria-label': `${island.name}: domain ${d.domain}, ${d.name}; ${progress.cleared ? 'cleared' : `boss ${island.boss} not beaten yet`}`,
          title: d.name,
        },
        progress.cleared && h('span', { class: 'island-glow', 'aria-hidden': 'true' }),
        h('span', { class: 'isle-top', 'aria-hidden': 'true' }, h('span', { class: `island-prop prop-${d.domain}` }), progress.cleared ? h('span', { class: 'island-flag' }) : bossSprite(d.domain)),
        h('span', { class: 'island-ground', 'aria-hidden': 'true' }),
        h('span', { class: 'island-name' }, island.name),
        progress.cleared && h('span', { class: 'sparkle s1', 'aria-hidden': 'true' }),
        progress.cleared && h('span', { class: 'sparkle s2', 'aria-hidden': 'true' }),
      ),
      { x: island.wide[0], y: island.wide[1], tx: island.tall[0], ty: island.tall[1] },
    );
    button.addEventListener('click', () => {
      for (const b of islands) b.setAttribute('aria-pressed', String(b === button));
      showIsland(d.domain);
      playSfx('coin');
      target = d.domain;
      walk();
    });
    return button;
  });
  justCleared = null;
  showIsland(at);
  gameScreen(
    'map',
    h('header', { class: 'topbar game-top' }, h('span', { class: 'brand' }, 'Game mode'), h('span', { class: 'px-text' }, `Rounds ${info.game.games} · Best combo ${info.game.bestCombo}`)),
    h(
      'main',
      { class: 'page game', id: 'game-hub' },
      h(
        'section',
        { class: 'px-panel game-hero' },
        cat('idle', 'hub-cat'),
        h('div', { class: 'game-hero-text' }, h('h1', { class: 'px-title' }, 'CISSP Quest'), rankBadge(info.game.level), levelBar(info.game.level, 'hub-level'), inventory(info.game.powerUps, 'hub-powerups')),
      ),
      h(
        'section',
        { class: 'game-modes', 'aria-label': 'More ways to play' },
        modeButton('open-daily', h('span', { class: 'flame mode-flame', 'aria-hidden': 'true' }), 'Daily challenge', daily.done ? `✔ Done today · streak ${daily.streak}` : `10 questions · streak ${daily.streak}`, () => void dailyScreen()),
        modeButton('open-lightning', h('span', { class: 'mode-bolt', 'aria-hidden': 'true' }, '60s'), 'Lightning round', `High score ${info.game.lightningBest}`, () => void lightningScreen()),
        modeButton('open-achievements', badge(info.game.achievements.find((a) => a.unlocked) ?? info.game.achievements[0]), 'Achievements', `${unlocked}/${info.game.achievements.length} badges`, () => void achievementsScreen()),
      ),
      h(
        'section',
        { class: 'world', 'aria-label': 'World map: one island per domain' },
        h('div', { class: 'world-head' }, h('h2', { class: 'px-title small-title' }, 'World map'), h('span', { class: 'px-text', id: 'world-progress' }, `★ ${cleared}/8 islands`)),
        h('p', { class: 'world-help' }, 'Tap an island: the cat walks there. Beat its boss to light it up.'),
        h('div', { class: 'quest-map', id: 'quest-map' }, mapPath('wide', world), mapPath('tall', world), ...islands, walker),
      ),
      panel,
    ),
    h(
      'footer',
      { class: 'bottombar game-bar' },
      h('button', { id: 'game-hub-home', class: 'px-button ghosted', onclick: () => void home() }, '◀ Back'),
      h('button', { id: 'game-quick', class: 'px-button ghosted', onclick: () => void quickRound() }, 'Quick round'),
    ),
    tabbar('game'),
  );
  // The island where the cat stands is in view (on a phone the map starts below the fold).
  document.getElementById(`map-island-${at}`)?.scrollIntoView({ block: 'nearest' });
  backAction = () => void home();
}

// ---------- Quick round (stage 1) ----------

/** Stars (0–3) for a domain's training accuracy, once it has a few answers. */
function islandStars(correct: number, answered: number): number {
  if (answered < 5) return 0;
  const accuracy = correct / answered;
  return accuracy >= 0.85 ? 3 : accuracy >= 0.7 ? 2 : accuracy >= 0.5 ? 1 : 0;
}

/** A row of pixel buttons of which one is chosen (difficulty, round length, timer, question pool). */
function chooser<T extends string | number>(id: string, label: string, choices: [T, string][], value: T, onPick: (v: T) => void): HTMLElement {
  const buttons = choices.map(([v, text]) => {
    const b = h('button', { id: `${id}-${v}`, class: 'px-chip', 'aria-pressed': String(v === value) }, text);
    b.addEventListener('click', () => {
      for (const other of buttons) other.setAttribute('aria-pressed', String(other === b));
      onPick(v);
    });
    return b;
  });
  return h('div', { class: 'chooser', role: 'group', 'aria-label': label }, h('span', { class: 'chooser-label' }, label), h('span', { class: 'chooser-buttons' }, ...buttons));
}

/** Settings of the last quick round. */
let lastGameOptions: PracticeOptions | null = null;

/**
 * Quick round picker: tap islands to pick the domains of the round, then pick difficulty, length, timer and
 * question pool, and press start.
 */
async function quickRound(): Promise<void> {
  const info = await api.info();
  gameSettings = info.game.settings;
  const options: PracticeOptions = { ...(lastGameOptions ?? info.profile.training), types: ['single', 'multi', 'ordering'], order: 'random' };
  if (![5, 10, 20, 30].includes(options.count)) options.count = 10;
  if (![0, 30, 60].includes(options.secondsPerQuestion)) options.secondsPerQuestion = 0;
  if (options.source === 'bookmarked') options.source = 'all';
  const chosen = new Set(options.domains);
  const islands = info.bank.byDomain.map((d) => {
    const island = ISLANDS[d.domain - 1];
    const p = info.progress.byDomain[d.domain - 1];
    const stars = islandStars(p.correct, p.answered);
    const button = h(
      'button',
      {
        id: `island-${d.domain}`,
        class: `island ground-${island.ground}`,
        'data-domain': String(d.domain),
        disabled: d.count === 0,
        'aria-pressed': String(chosen.has(d.domain) && d.count > 0),
        'aria-label': `${island.name}: domain ${d.domain}, ${d.name}, ${d.count} questions${stars ? `, ${stars} of 3 stars` : ''}`,
        title: d.name,
      },
      h('span', { class: 'island-flag', 'aria-hidden': 'true' }),
      h('span', { class: `island-prop prop-${d.domain}`, 'aria-hidden': 'true' }),
      h('span', { class: 'island-ground', 'aria-hidden': 'true' }),
      h('span', { class: 'island-name' }, `${d.domain}. ${island.name}`),
      h('span', { class: 'island-domain' }, d.name),
      h('span', { class: 'island-stars', 'aria-hidden': 'true' }, '★'.repeat(stars) + '☆'.repeat(3 - stars), ` ${d.count} Q`),
    );
    button.addEventListener('click', () => {
      if (chosen.has(d.domain)) chosen.delete(d.domain);
      else chosen.add(d.domain);
      button.setAttribute('aria-pressed', String(chosen.has(d.domain)));
      button.classList.remove('hop');
      void button.offsetWidth;
      button.classList.add('hop');
      if (chosen.has(d.domain)) playSfx('coin');
    });
    return button;
  });
  const setAll = (on: boolean): void => {
    for (const b of islands) {
      if (b.disabled) continue;
      const domain = Number(b.dataset.domain) as DomainId;
      if (on) chosen.add(domain);
      else chosen.delete(domain);
      b.setAttribute('aria-pressed', String(on));
    }
  };
  const start = (): void => {
    const domains = info.bank.byDomain.map((d) => d.domain).filter((d) => chosen.has(d));
    if (domains.length === 0) return toast('Pick at least one island on the map.');
    const picked = { ...options, domains };
    lastGameOptions = picked;
    void playRound(() => api.startGame(picked));
  };
  gameScreen(
    'map',
    h('header', { class: 'topbar game-top' }, h('span', { class: 'brand' }, 'Quick round'), h('span', { class: 'px-text' }, `Rounds ${info.game.games} · Best combo ${info.game.bestCombo}`)),
    h(
      'main',
      { class: 'page game', id: 'quick-round' },
      h(
        'section',
        { class: 'world', id: 'world-map', 'aria-label': 'Pick the islands (domains) of the round' },
        h(
          'div',
          { class: 'world-head' },
          h('h2', { class: 'px-title small-title' }, 'Quick round'),
          h(
            'span',
            { class: 'row' },
            h('button', { id: 'game-all-islands', class: 'px-button mini-px ghosted', onclick: () => setAll(true) }, 'All'),
            h('button', { id: 'game-no-islands', class: 'px-button mini-px ghosted', onclick: () => setAll(false) }, 'None'),
          ),
        ),
        h('p', { class: 'world-help' }, 'Tap islands to plant your flag: the round asks questions from those domains. Stars show your accuracy there.'),
        h('div', { class: 'islands' }, ...islands),
      ),
      h(
        'section',
        { class: 'px-panel quest-rules' },
        chooser<PracticeOptions['difficulty']>('game-diff', 'Difficulty', [['mixed', 'Mixed'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']], options.difficulty, (v) => (options.difficulty = v)),
        chooser<number>('game-len', 'Questions', [[5, '5'], [10, '10'], [20, '20'], [30, '30']], options.count, (v) => (options.count = v)),
        chooser<number>('game-timer', 'Timer', [[0, 'Off'], [30, '30 s'], [60, '60 s']], options.secondsPerQuestion, (v) => (options.secondsPerQuestion = v)),
        chooser<PracticeOptions['source']>('game-src', 'Questions from', [['all', 'Whole bank'], ['missed', 'My mistakes']], options.source, (v) => (options.source = v)),
        h('p', { class: 'px-help' }, 'Right answers earn XP: 10 easy, 20 medium, 30 hard. Five in a row starts Encryption Frenzy (x2), ten in a row x3. A wrong answer breaks a heart; three and it is game over. Wrong answers join your questions to retry.'),
      ),
    ),
    h(
      'footer',
      { class: 'bottombar game-bar' },
      h('button', { id: 'game-quick-back', class: 'px-button ghosted', onclick: () => void gameHub() }, '◀ Map'),
      h('button', { id: 'game-start', class: 'px-button', onclick: start }, 'PRESS START'),
    ),
    tabbar('game'),
  );
  backAction = () => void gameHub();
}

// ---------- Daily challenge, lightning round and achievements (stage 3) ----------

/** Days of the streak calendar: the last five weeks, today last. */
const CALENDAR_DAYS = 35;
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** The power-ups of a reward as icons with their names. */
function rewardPowerUps(ids: readonly PowerUpId[]): HTMLElement {
  return h('span', { class: 'reward-powerups' }, ...ids.map((id) => h('span', { class: 'reward-pu' }, powerIcon(id), ` ${POWER_UPS[id].name}`)));
}

/** A day (YYYY-MM-DD) as the system writes dates. */
function dayText(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString();
}

/**
 * The daily challenge: today's ten questions (the same all day), the streak with a calendar of the last five
 * weeks (a coin on every day done), what finishing today gives, and Start (once a day).
 */
async function dailyScreen(): Promise<void> {
  const info = await api.info();
  gameSettings = info.game.settings;
  const d = info.game.daily;
  const done = new Set(d.days);
  const [y, m, dd] = d.today.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, dd - (CALENDAR_DAYS - 1))).getUTCDay();
  const cells = Array.from({ length: CALENDAR_DAYS }, (_, i) => {
    const date = new Date(Date.UTC(y, m - 1, dd - (CALENDAR_DAYS - 1 - i)));
    const key = date.toISOString().slice(0, 10);
    const isDone = done.has(key);
    return h(
      'span',
      { class: `day${isDone ? ' done' : ''}${key === d.today ? ' today' : ''}`, title: dayText(key), 'aria-label': `${dayText(key)}${isDone ? ': done' : ''}` },
      isDone ? icon('coin') : String(date.getUTCDate()),
    );
  });
  gameScreen(
    'map',
    h('header', { class: 'topbar game-top' }, h('span', { class: 'brand' }, 'Daily challenge'), h('span', { class: 'px-text' }, dayText(d.today))),
    h(
      'main',
      { class: 'page game', id: 'daily' },
      h(
        'section',
        { class: 'px-panel daily-panel' },
        h('div', { class: 'daily-head' }, h('span', { class: 'flame streak-flame', 'aria-hidden': 'true' }), h('div', {}, h('h1', { class: 'px-title small-title' }, 'Daily challenge'), h('p', { class: 'px-text', id: 'daily-streak' }, `Streak: ${d.streak} day${d.streak === 1 ? '' : 's'} · best ${d.bestStreak}`))),
        h('p', { class: 'px-help' }, 'Ten questions, the same all day long. No hearts: every answer counts, the explanation follows each one, and wrong answers join your questions to retry. Finish all ten to keep your streak.'),
        h('div', { class: 'calendar', id: 'daily-calendar', role: 'group', 'aria-label': 'Daily challenges of the last five weeks' }, ...WEEKDAYS.map((_, c) => h('span', { class: 'weekday', 'aria-hidden': 'true' }, WEEKDAYS[(first + c) % 7])), ...cells),
        h(
          'p',
          { class: 'daily-reward', id: 'daily-next-reward' },
          h('strong', {}, d.done ? 'Today’s reward: ' : 'Finish today for: '),
          `+${d.reward.xp} XP and `,
          rewardPowerUps(d.reward.powerUps),
          '.',
        ),
        h('p', { class: 'small' }, 'Every day in a row adds 10 XP to the bonus; every 7th day in a row brings one of each power-up.'),
      ),
    ),
    h(
      'footer',
      { class: 'bottombar game-bar' },
      h('button', { id: 'daily-back', class: 'px-button ghosted', onclick: () => void gameHub() }, '◀ Map'),
      h('button', { id: 'daily-start', class: 'px-button', disabled: d.done || info.bank.total === 0, onclick: () => void playRound(() => api.startDaily()) }, d.done ? 'Done for today ✔' : 'Start ▶'),
    ),
    tabbar('game'),
  );
  backAction = () => void gameHub();
}

/** The lightning round's start screen: the rules, the high score, and its own music already playing. */
async function lightningScreen(): Promise<void> {
  const info = await api.info();
  gameSettings = info.game.settings;
  gameScreen(
    'lightning',
    h('header', { class: 'topbar game-top' }, h('span', { class: 'brand' }, 'Lightning round'), h('span', { class: 'px-text', id: 'lightning-best' }, `High score ${info.game.lightningBest}`)),
    h(
      'main',
      { class: 'page game', id: 'lightning' },
      h(
        'section',
        { class: 'px-panel lightning-panel' },
        h('h1', { class: 'px-title lightning-title', 'aria-label': 'Lightning round' }, ...dropLetters('LIGHTNING ROUND')),
        cat('sweat'),
        h('p', { class: 'px-help' }, `${info.game.lightningBest > 0 ? `Your high score: ${info.game.lightningBest} right answers. ` : ''}60 seconds: as many right answers as you can. No hearts and no power-ups; a wrong answer only breaks your combo. To keep the clock fair, the explanations wait for you on the review screen after the round, every one of them.`),
      ),
    ),
    h(
      'footer',
      { class: 'bottombar game-bar' },
      h('button', { id: 'lightning-back', class: 'px-button ghosted', onclick: () => void gameHub() }, '◀ Map'),
      h('button', { id: 'lightning-start', class: 'px-button', disabled: info.bank.total === 0, onclick: () => void playRound(() => api.startLightning()) }, 'START ▶'),
    ),
    tabbar('game'),
  );
  backAction = () => void gameHub();
}

/** Every badge: unlocked ones shine with the day they were won, locked ones are grey with how to win them. */
async function achievementsScreen(): Promise<void> {
  const info = await api.info();
  gameSettings = info.game.settings;
  const list = info.game.achievements;
  const won = list.filter((a) => a.unlocked).length;
  gameScreen(
    'map',
    h('header', { class: 'topbar game-top' }, h('span', { class: 'brand' }, 'Achievements'), h('span', { class: 'px-text', id: 'achievements-count' }, `${won}/${list.length}`)),
    h(
      'main',
      { class: 'page game', id: 'achievements' },
      h(
        'section',
        { class: 'badge-grid' },
        ...list.map((a) =>
          h(
            'div',
            { class: `badge-card ${a.unlocked ? 'unlocked' : 'locked'}`, id: `badge-${a.id}` },
            badge(a),
            h(
              'div',
              { class: 'badge-text' },
              h('p', { class: 'badge-name' }, a.name),
              h('p', { class: 'small' }, a.description),
              h('p', { class: 'badge-state' }, a.unlocked ? `Unlocked ${dayText(a.unlocked)}` : 'Locked'),
            ),
          ),
        ),
      ),
    ),
    h('footer', { class: 'bottombar game-bar' }, h('button', { id: 'achievements-back', class: 'px-button ghosted', onclick: () => void gameHub() }, '◀ Map')),
    tabbar('game'),
  );
  backAction = () => void gameHub();
}

// ---------- Playing ----------

let gameTimer: number | undefined;

interface GameContext {
  kind: GameKind;
  total: number;
  /** Hearts at the start (0: a round without hearts) and now. */
  maxLives: number;
  lives: number;
  seconds: number;
  combo: number;
  multiplier: number;
  level: LevelInfo;
  answered: number;
  /** Island of the round (null for the other kinds), the phase on screen, and the boss once the fight is on. */
  island: DomainId | null;
  phase: GamePhase;
  boss: BossState | null;
  powerUps: PowerUps;
  /** Lightning round: its length and end (epoch ms), right answers so far, the last second that ticked, and whether the time is up. */
  roundMs: number;
  deadline: number;
  score: number;
  ticked: number;
  over: boolean;
}

/** Lightning round: how long the verdict of an answer stays before the next question comes. */
const LIGHTNING_PAUSE_MS = 650;
/** Lightning round: the clock ticks in the last seconds. */
const LIGHTNING_TICK_FROM = 10;

/** How the last round started, for Retry. */
let lastRound: (() => Promise<GameStart>) | null = null;

/** Starts a round (any kind) with READY/GO, or a boss entrance when it opens on the boss; the lightning clock starts at once. */
async function playRound(begin: () => Promise<GameStart>): Promise<void> {
  let start: GameStart;
  try {
    start = await begin();
  } catch (err) {
    toast(errorText(err));
    return;
  }
  lastRound = begin;
  playSfx('whoosh');
  const ctx: GameContext = {
    kind: start.kind,
    total: start.total,
    maxLives: start.lives,
    lives: start.lives,
    seconds: start.secondsPerQuestion,
    combo: 0,
    multiplier: 1,
    level: start.level,
    answered: 0,
    island: start.island,
    phase: start.phase,
    boss: start.boss,
    powerUps: start.powerUps,
    roundMs: start.roundSeconds * 1000,
    deadline: Date.now() + start.roundSeconds * 1000,
    score: 0,
    ticked: 0,
    over: false,
  };
  renderGameQuestion(start.question, ctx);
  if (ctx.island !== null && ctx.phase === 'boss') {
    floatText(`${ISLANDS[ctx.island - 1].boss.toUpperCase()}!`, null, 0, 'boss-in');
    return;
  }
  if (ctx.kind === 'lightning') return floatText(`${start.roundSeconds} SECONDS! GO!`, null, 0, 'go');
  floatText(ctx.island !== null ? ISLANDS[ctx.island - 1].name.toUpperCase() : ctx.kind === 'daily' ? 'DAILY CHALLENGE' : 'READY?', null, 0, 'ready');
  setTimeout(() => floatText('GO!', null, 0, 'go'), 750);
}

/** Asks before quitting; once confirmed, nothing of the round (the lightning clock, a pending next question) goes on. */
function quitGame(ctx: GameContext): void {
  const note = ctx.kind === 'daily' ? ' The streak needs all ten answers: you can start today’s challenge again.' : ctx.kind === 'lightning' ? ' The round ends now, with the review of your answers.' : '';
  modal('Quit this round?', `Your XP so far is saved. Wrong answers are already in your questions to retry.${note}`, [
    { label: 'Keep playing', id: 'game-quit-cancel', onClick: () => undefined },
    {
      label: 'Quit',
      id: 'game-quit-confirm',
      primary: true,
      onClick: () => {
        ctx.over = true;
        void gameOver();
      },
    },
  ]);
}

/** The boss's hit points: a bar that drops (a pale ghost bar follows it down) and the count. */
function bossHpBar(boss: BossState): HTMLElement {
  const bar = h(
    'div',
    { class: 'boss-hp', id: 'boss-hp', role: 'progressbar', 'aria-label': 'Boss hit points', 'aria-valuemin': '0', 'aria-valuemax': String(boss.max) },
    h('span', { class: 'boss-hp-ghost' }),
    h('span', { class: 'boss-hp-fill' }),
    h('span', { class: 'boss-hp-text' }),
  );
  setBossHp(bar, boss);
  return bar;
}

function setBossHp(bar: HTMLElement, boss: BossState): void {
  bar.style.setProperty('--hp', String(boss.hp / boss.max));
  bar.setAttribute('aria-valuenow', String(boss.hp));
  (bar.querySelector('.boss-hp-text') as HTMLElement).textContent = `HP ${boss.hp}/${boss.max}`;
}

/** Restarts a CSS animation class on an element (hit, attack, hop…). */
function replay(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/** The boss blows up: a flash, explosions over the sprite (none when nothing may move), confetti and a banner. */
function bossDefeat(sprite: HTMLElement): void {
  sprite.classList.add('defeated');
  playSfx('fanfare', 250);
  floatText('BOSS DEFEATED!', null, 0, 'victory');
  const level = effectLevel();
  if (level === 'still') return;
  const spots = level === 'full' ? [[50, 50, 0], [25, 35, 180], [72, 30, 320], [40, 72, 470], [65, 65, 600]] : [[50, 50, 0]];
  const stage = sprite.parentElement as HTMLElement;
  for (const [x, y, delay] of spots) {
    setTimeout(() => {
      const boom = h('span', { class: 'boss-boom', 'aria-hidden': 'true' });
      boom.style.left = `${x}%`;
      boom.style.top = `${y}%`;
      stage.append(boom);
      expire(boom, 1000);
    }, delay);
  }
  const at = centre(sprite);
  burst(at.x, at.y, 'confetti');
}

/** A used power-up: its icon leaps from the button, spins and bursts (sparks only with full effects). */
function powerUpFx(id: PowerUpId, from: Element): void {
  if (effectLevel() === 'still') return;
  const at = centre(from);
  const leap = h('span', { class: 'fx-powerup' }, powerIcon(id));
  leap.style.left = `${at.x}px`;
  leap.style.top = `${at.y}px`;
  fxLayer().append(leap);
  expire(leap, 1200);
  burst(at.x, at.y, 'spark');
}

function renderGameQuestion(q: QuestionView, ctx: GameContext): void {
  clearInterval(gameTimer);
  const lightning = ctx.kind === 'lightning';
  const body = questionBody(q);
  const feedback = h('div', { id: 'feedback', 'aria-live': 'polite' });
  const feedbackPanel = h('section', { class: 'px-panel q-panel', hidden: true }, feedback);
  const mascot = cat('idle', 'game-cat');
  const bubble = h('p', { class: 'bubble', id: 'game-quip', hidden: true });
  // Between the options and the feedback: after an answer the cat's reaction and the joke sit right above the
  // verdict and the explanation, on a phone too.
  const stage = h('div', { class: 'game-stage', id: 'game-stage' }, mascot, bubble);
  let heartRow = ctx.maxLives > 0 ? hearts(ctx.lives, ctx.maxLives) : null;
  let levelNode = levelBar(ctx.level, 'game-level');
  let comboNode = comboMeter(ctx.combo, ctx.multiplier);
  const timeLeft = h('span', { id: 'game-time-left', class: 'px-text' });
  const scoreNode = lightning ? h('span', { id: 'lightning-score', class: 'px-text' }, `★ ${ctx.score}`) : null;
  const clockFill = h('span', { class: 'lightning-fill' });
  /** HUD switch for the sound effects or the music (icon only: a phone HUD is narrow); saved like Profile & settings. */
  const toggle = (id: string, label: string, symbol: string, setting: 'sound' | 'music'): HTMLButtonElement => {
    const b = h('button', { id, class: 'px-button mini-px hud-toggle', 'aria-pressed': String(gameSettings[setting]), 'aria-label': label, title: label }, symbol);
    b.addEventListener('click', async () => {
      gameSettings = await api.saveGameSettings({ ...gameSettings, [setting]: !gameSettings[setting] });
      b.setAttribute('aria-pressed', String(gameSettings[setting]));
      playMusic(musicWanted);
    });
    return b;
  };
  const soundButton = toggle('game-sound', 'Sound effects', '♪', 'sound');
  const musicButton = toggle('game-music', 'Music', '♫', 'music');
  // The boss fight: the boss above the question, idling, with its hit points.
  const boss = ctx.phase === 'boss' && ctx.island !== null && ctx.boss ? { domain: ctx.island, state: ctx.boss } : null;
  const bossNode = boss && bossSprite(boss.domain, 'boss-sprite');
  const hpNode = boss && bossHpBar(boss.state);
  const arena =
    boss &&
    h(
      'section',
      { class: 'boss-arena', id: 'boss-arena' },
      h('div', { class: 'boss-stage' }, bossNode),
      h('div', { class: 'boss-info' }, h('p', { class: 'boss-name' }, ISLANDS[boss.domain - 1].boss), hpNode),
    );
  const button = h('button', { id: 'game-check', class: 'px-button' }, 'Check');
  let go: HTMLButtonElement | null = null;
  let poseTimer: number | undefined;
  const pose = (p: CatPose, back = 0): void => {
    clearTimeout(poseTimer);
    mascot.dataset.pose = p;
    if (back > 0) poseTimer = window.setTimeout(() => (mascot.dataset.pose = 'idle'), back);
  };

  // Power-ups (not in the lightning round): one 50/50 or hint per question, Patch Tuesday while a heart is broken.
  // The service has the last word; the buttons only show what it would accept.
  const zapped = new Set<number>();
  let helped = false;
  const fits: Record<PowerUpId, boolean> = {
    fifty: q.type !== 'ordering' && q.options.length - 2 > q.selectCount,
    auditor: q.type === 'ordering' || q.options.length - 1 > q.selectCount,
    patch: true,
  };
  const hint = h('p', { class: 'auditor-hint', id: 'auditor-hint', hidden: true, 'aria-live': 'polite' });
  const puButtons: Partial<Record<PowerUpId, HTMLButtonElement>> = {};
  const refreshPowerUps = (): void => {
    for (const id of POWER_UP_ORDER) {
      const b = puButtons[id];
      if (!b) continue;
      const usable = id === 'patch' ? ctx.lives < ctx.maxLives : !helped && fits[id];
      b.disabled = go !== null || ctx.powerUps[id] === 0 || !usable;
      (b.querySelector('.pu-count') as HTMLElement).textContent = `×${ctx.powerUps[id]}`;
      b.setAttribute('aria-label', `${POWER_UPS[id].name} (${ctx.powerUps[id]} left): ${POWER_UPS[id].what}`);
    }
  };
  const usePowerUp = async (id: PowerUpId, from: HTMLElement): Promise<void> => {
    for (const b of Object.values(puButtons)) b.disabled = true;
    let effect: PowerUpEffect;
    try {
      effect = await api.usePowerUp(id, q.id);
    } catch (err) {
      toast(errorText(err));
      return refreshPowerUps();
    }
    ctx.powerUps = effect.powerUps;
    playSfx('powerup');
    powerUpFx(id, from);
    floatText(POWER_UPS[id].shout, null, 0, `pu-shout shout-${id}`);
    if (id === 'patch' && heartRow) {
      ctx.lives = effect.lives;
      const fresh = hearts(ctx.lives, ctx.maxLives);
      fresh.children[ctx.lives - 1]?.classList.add('mended');
      heartRow.replaceWith(fresh);
      heartRow = fresh;
    } else {
      helped = true;
      const rows = body.node.querySelectorAll<HTMLElement>('.option');
      for (const i of effect.removed) {
        zapped.add(i);
        rows[i]?.classList.add('zapped');
        const input = rows[i]?.querySelector('input');
        if (input) Object.assign(input, { checked: false, disabled: true });
      }
      if (effect.hint) {
        hint.replaceChildren(powerIcon('auditor'), h('span', {}, h('strong', {}, 'The Auditor: '), effect.hint));
        hint.hidden = false;
      }
    }
    announceAchievements(effect.unlocked);
    refreshPowerUps();
  };
  const powerBar = lightning
    ? null
    : h(
        'div',
        { class: 'powerup-bar', id: 'powerups', role: 'group', 'aria-label': 'Power-ups' },
        ...POWER_UP_ORDER.map((id) => {
          const b = h('button', { id: `pu-${id}`, class: 'pu-button', title: `${POWER_UPS[id].name}: ${POWER_UPS[id].what}` }, powerIcon(id), h('span', { class: 'pu-name' }, POWER_UPS[id].short), h('span', { class: 'pu-count' }));
          b.addEventListener('click', () => void usePowerUp(id, b));
          puButtons[id] = b;
          return b;
        }),
      );
  refreshPowerUps();

  /** Lightning round: a quick verdict, then the next question at once; the explanations wait for the review. */
  const quickVerdict = (r: GameAnswer): void => {
    const f = r.feedback;
    Object.assign(ctx, { combo: r.combo, multiplier: r.multiplier, level: r.level, answered: ctx.answered + 1, score: ctx.score + (f.correct ? 1 : 0) });
    if (scoreNode) scoreNode.textContent = `★ ${ctx.score}`;
    const freshCombo = comboMeter(ctx.combo, ctx.multiplier);
    comboNode.replaceWith(freshCombo);
    comboNode = freshCombo;
    const freshLevel = levelBar(ctx.level, 'game-level');
    levelNode.replaceWith(freshLevel);
    levelNode = freshLevel;
    bubble.hidden = false;
    bubble.className = `bubble ${f.correct ? 'good' : 'bad'}`;
    bubble.textContent = f.correct ? `✔ Right! +${r.xpGained} XP` : '✘ Wrong. The explanation waits for you after the round.';
    if (f.correct) {
      pose('cheer');
      playSfx('ding');
      const at = centre(mascot);
      burst(at.x, at.y, 'spark');
      floatText(`+${r.xpGained} XP`, at.x, at.y - 20, 'xp');
    } else {
      pose('sad');
      playSfx('buzz');
    }
    announceAchievements(r.unlocked);
    setTimeout(() => {
      if (ctx.over) return;
      if (r.next) renderGameQuestion(r.next, ctx);
      else void gameOver();
    }, LIGHTNING_PAUSE_MS);
  };

  const answered = (r: GameAnswer): void => {
    if (ctx.over) return;
    const f = r.feedback;
    const main = document.getElementById('game') as HTMLElement;
    for (const input of main.querySelectorAll<HTMLInputElement>('.options input')) {
      input.checked = f.response.includes(Number(input.value));
      input.disabled = true;
    }
    markOptions(q, f, main);
    if (lightning) return quickVerdict(r);
    clearInterval(gameTimer);
    bubble.hidden = false;
    const taunt = boss && !f.correct ? `${ISLANDS[boss.domain - 1].boss}: “${pick(ISLANDS[boss.domain - 1].taunts)}”` : null;
    bubble.textContent = taunt ?? pick(f.timedOut ? QUIPS.timeout : !f.correct ? QUIPS.wrong : boss ? QUIPS.hit : QUIPS.right);
    bubble.className = `bubble ${f.correct ? 'good' : 'bad'}`;
    // The real explanation follows the joke, always.
    feedback.replaceChildren(...feedbackNodes(q, f));
    feedbackPanel.hidden = false;
    stage.scrollIntoView({ block: 'start' });
    const lostHeart = r.lives < ctx.lives;
    const frenzyStarts = r.multiplier > ctx.multiplier;
    const comboGrew = r.combo > ctx.combo;
    // The boss's health rides along: the next question's arena is drawn from it (it never heals between questions).
    Object.assign(ctx, { lives: r.lives, combo: r.combo, multiplier: r.multiplier, level: r.level, answered: ctx.answered + 1, powerUps: r.powerUps, boss: r.boss ?? ctx.boss });
    const freshCombo = comboMeter(ctx.combo, ctx.multiplier);
    if (comboGrew) freshCombo.classList.add('pop');
    comboNode.replaceWith(freshCombo);
    comboNode = freshCombo;
    const freshLevel = levelBar(ctx.level, 'game-level');
    levelNode.replaceWith(freshLevel);
    levelNode = freshLevel;
    main.classList.toggle('frenzy', ctx.multiplier > 1);
    if (f.correct) {
      pose('cheer', 2600);
      playSfx('ding');
      playSfx('coin', 220);
      const at = centre(mascot);
      burst(at.x, at.y, 'spark');
      floatText(`+${r.xpGained} XP`, at.x, at.y - 20, 'xp');
      coinsTo(mascot, freshLevel.querySelector('.xp-track') ?? freshLevel, Math.min(6, 2 + Math.round(r.xpGained / 20)));
      if (frenzyStarts) {
        playSfx('whoosh', 120);
        floatText(r.multiplier === 2 ? 'ENCRYPTION FRENZY! x2' : `MEGA FRENZY! x${r.multiplier}`, null, 0, 'frenzy');
      } else if (STREAK_SHOUTS[r.combo] && !boss) {
        floatText(STREAK_SHOUTS[r.combo], null, 0, 'shout');
      }
      if (bossNode && hpNode && r.boss && r.bossHit) {
        // The hit: the boss flashes white and shakes, its health bar drops.
        replay(bossNode, 'hit');
        setBossHp(hpNode, r.boss);
        const b = centre(bossNode);
        floatText(r.multiplier > 1 ? 'CRITICAL! -1 HP' : '-1 HP', b.x, b.y, 'hit');
        playSfx('whoosh', 80);
        if (r.end === 'victory') bossDefeat(bossNode);
      }
    } else {
      // Dismay first, then the tears.
      pose('sad');
      poseTimer = window.setTimeout(() => pose('cry', 3000), 900);
      playSfx('buzz');
      if (lostHeart && heartRow) {
        const heart = heartRow.children[r.lives] as HTMLElement | undefined;
        if (heart) heartFall(heart);
        heart?.classList.replace('heart', 'heart-empty');
        heart?.classList.add('breaking');
        heartRow.setAttribute('aria-label', `${r.lives} of ${ctx.maxLives} hearts left`);
      }
      if (effectLevel() === 'full') {
        flash();
        replay(main, 'shake');
      }
      // The boss strikes back.
      if (bossNode) replay(bossNode, 'attack');
    }
    // A power-up earned (five in a row, a boss beaten) drops into the inventory.
    if (r.earned.length > 0 && powerBar) {
      playSfx('pickup', 450);
      const at = centre(powerBar);
      floatText(`+ ${r.earned.map((id) => POWER_UPS[id].name).join(' + ')}`, at.x, at.y, 'pu-earned');
    }
    announceAchievements(r.unlocked);
    const next = r.next;
    const label = r.bossStarts ? 'BOSS FIGHT ▶' : next ? 'Next ▶' : r.end === 'victory' ? 'Victory ▶' : r.end === 'lives' ? 'Game over ▶' : 'Results ▶';
    go = h('button', { id: 'game-next', class: 'px-button' }, label);
    go.addEventListener('click', () => {
      const onward = (): void => {
        if (!next) return void gameOver();
        if (!r.bossStarts || ctx.island === null) return renderGameQuestion(next, ctx);
        // The stage is won: the boss arrives, with its music.
        Object.assign(ctx, { phase: 'boss', boss: r.boss });
        renderGameQuestion(next, ctx);
        playSfx('whoosh');
        floatText(`${ISLANDS[ctx.island - 1].boss.toUpperCase()}!`, null, 0, 'boss-in');
      };
      if (r.levelUp) levelUpScreen(r.level, r.rankUp, onward);
      else onward();
    });
    button.replaceWith(go);
    refreshPowerUps();
  };

  const check = async (): Promise<void> => {
    const response = body.response();
    const needed = q.type === 'multi' ? q.selectCount : q.type === 'single' ? 1 : q.options.length;
    if (response.length !== needed) return toast(q.type === 'multi' ? `Select ${q.selectCount} options.` : 'Choose an answer.');
    button.disabled = true;
    try {
      answered(await api.answerGame(q.id, response));
    } catch (err) {
      button.disabled = false;
      toast(errorText(err));
    }
  };
  button.addEventListener('click', () => void check());

  if (lightning) {
    // One clock for the whole round: the time, a draining bar, ticks in the last seconds, and the end.
    const tick = (): void => {
      const ms = Math.max(0, ctx.deadline - Date.now());
      const left = Math.ceil(ms / 1000);
      timeLeft.textContent = `TIME ${left}`;
      timeLeft.classList.toggle('low', left <= LIGHTNING_TICK_FROM);
      clockFill.style.setProperty('--left', String(ms / ctx.roundMs));
      if (left <= LIGHTNING_TICK_FROM && left > 0 && left !== ctx.ticked) {
        ctx.ticked = left;
        playSfx('tick');
        if (mascot.dataset.pose === 'idle') pose('sweat');
      }
      if (left > 0 || ctx.over) return;
      ctx.over = true;
      clearInterval(gameTimer);
      void gameOver();
    };
    tick();
    gameTimer = window.setInterval(tick, 250);
  } else if (ctx.seconds > 0) {
    const deadline = Date.now() + ctx.seconds * 1000;
    /** The cat sweats in the last 30% of the time (at least the last 5 seconds). */
    const sweatAt = Math.max(5, Math.ceil(ctx.seconds * 0.3));
    const tick = (): void => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      timeLeft.textContent = `TIME ${left}`;
      timeLeft.classList.toggle('low', left <= sweatAt);
      if (left <= sweatAt && mascot.dataset.pose === 'idle') pose('sweat');
      if (left > 0 || go || button.disabled) return;
      button.disabled = true;
      void api.timeoutGame(q.id).then(answered, (err: unknown) => toast(errorText(err)));
    };
    tick();
    gameTimer = window.setInterval(tick, 250);
  }

  gameScreen(
    lightning ? 'lightning' : boss ? 'boss' : 'map',
    h(
      'header',
      { class: `game-hud${lightning ? ' lightning-hud' : ''}` },
      heartRow,
      levelNode,
      comboNode,
      h(
        'span',
        { class: 'hud-right' },
        (ctx.seconds > 0 || lightning) && timeLeft,
        scoreNode,
        !lightning && h('span', { id: 'game-qnum', class: 'px-text' }, boss ? 'BOSS' : `Q ${ctx.answered + 1}/${ctx.total}`),
        soundButton,
        musicButton,
      ),
      lightning && h('div', { class: 'lightning-clock', id: 'lightning-clock', 'aria-hidden': 'true' }, clockFill),
    ),
    h(
      'main',
      { class: `question game${ctx.multiplier > 1 ? ' frenzy' : ''}${boss ? ' boss-fight' : ''}${lightning ? ' lightning-round' : ''}`, id: 'game' },
      arena,
      powerBar,
      h('section', { class: 'px-panel q-panel q-enter', id: 'game-question', 'data-question': q.id }, h('p', { class: 'stem' }, q.stem), body.node, hint),
      stage,
      feedbackPanel,
    ),
    h(
      'footer',
      { class: 'bottombar game-bar' },
      h('button', { id: 'game-quit', class: 'px-button ghosted', onclick: () => quitGame(ctx) }, 'Quit'),
      button,
    ),
  );
  keyHandler = questionKeys(
    (i) => { if (!go && !zapped.has(i)) body.select(i); },
    () => { if (go) go.click(); else if (!button.disabled) void check(); },
  );
  backAction = () => quitGame(ctx);
}

/** Full-screen level-up moment with the new rank badge; shown after "Next", so it never covers an explanation. */
function levelUpScreen(level: LevelInfo, rankUp: boolean, onward: () => void): void {
  clearInterval(gameTimer);
  playSfx('fanfare');
  const overlay = h(
    'div',
    { class: 'levelup', id: 'levelup', role: 'dialog', 'aria-label': 'Level up' },
    h('span', { class: 'levelup-rays', 'aria-hidden': 'true' }),
    h('p', { class: 'px-title levelup-title' }, ...dropLetters('LEVEL UP!')),
    cat('cheer'),
    rankBadge(level),
    h('p', { class: 'px-text levelup-rank' }, rankUp ? `New rank: ${level.rank}` : `Still ${level.rank}, but shinier`),
    h('button', { id: 'levelup-continue', class: 'px-button', onclick: () => { overlay.remove(); onward(); } }, 'Continue ▶'),
  );
  root.append(overlay);
  (overlay.querySelector('button') as HTMLButtonElement).focus();
  const at = centre(overlay.querySelector('.rank-badge') as Element);
  burst(at.x, at.y, 'confetti');
  keyHandler = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      overlay.remove();
      onward();
    }
  };
  backAction = () => {
    overlay.remove();
    onward();
  };
}

/**
 * End of the round: why it ended, with a funny line, the score and a retry. After a boss fight: the victory
 * screen (the island is cleared and lights up on the map), or a game over where the boss gloats and Retry goes
 * straight back to the boss once it was reached. After the daily challenge: the streak and its reward. After
 * the lightning round: the score, the high score, and the review of every answer with its explanation.
 */
async function gameOver(): Promise<void> {
  clearInterval(gameTimer);
  let s: GameSummary;
  try {
    s = await api.gameSummary();
  } catch (err) {
    toast(errorText(err));
    return void gameHub();
  }
  const island = s.island !== null ? ISLANDS[s.island - 1] : null;
  const lightning = s.kind === 'lightning';
  const dailyDone = s.daily !== null;
  const title =
    s.end === 'victory' ? 'VICTORY!' : s.end === 'lives' ? 'GAME OVER' : s.end === 'time' ? 'TIME!' : s.end === 'cleared' ? (dailyDone ? 'DAILY DONE!' : 'ROUND CLEAR!') : 'LOGGED OFF';
  const won = s.end === 'victory' || s.end === 'cleared' || (s.end === 'time' && s.correct > 0);
  if (won) playSfx('fanfare');
  else if (s.end === 'lives') playSfx('buzz');
  if (s.end === 'victory') justCleared = s.island;
  const line =
    island && s.end === 'victory'
      ? `${island.boss} is defeated! ${island.name} is free. ${pick(QUIPS.victory)}`
      : island && s.boss && s.end === 'lives'
        ? island.wins
        : pick(dailyDone ? QUIPS.daily : QUIPS[s.end === 'victory' ? 'cleared' : s.end]);
  // Retry: the boss again once it was reached, otherwise the round as it started (the daily challenge only until it is done).
  const domain = s.island;
  const retry = domain !== null && s.boss ? () => api.startBoss(domain) : lastRound;
  const xp = h('span', { class: 'xp-count' }, `+${s.xpEarned}`);
  const wrong = s.answered - s.correct;
  const stats = lightning
    ? [
        h('div', {}, h('span', { class: 'px-big', id: 'lightning-final' }, String(s.correct)), h('span', {}, 'right answers')),
        h('div', { class: s.newBest ? 'new-best' : '' }, h('span', { class: 'px-big', id: 'lightning-high' }, String(s.best)), h('span', {}, s.newBest ? 'NEW HIGH SCORE!' : 'high score')),
        h('div', {}, h('span', { class: 'px-big', id: 'game-over-xp' }, icon('coin'), ' ', xp), h('span', {}, 'XP earned')),
      ]
    : [
        h('div', {}, h('span', { class: 'px-big', id: 'game-over-xp' }, icon('coin'), ' ', xp), h('span', {}, s.end === 'victory' ? 'XP earned (boss bonus included)' : 'XP earned')),
        h('div', {}, h('span', { class: 'px-big' }, `${s.correct}/${s.answered}`), h('span', {}, 'right answers')),
        h('div', {}, h('span', { class: 'px-big' }, String(s.bestCombo)), h('span', {}, 'best combo')),
      ];
  const reward =
    s.daily &&
    h(
      'div',
      { class: 'daily-reward-box', id: 'daily-reward' },
      h('p', { class: 'px-text reward-streak' }, h('span', { class: 'flame', 'aria-hidden': 'true' }), ` Streak: ${s.daily.streak} day${s.daily.streak === 1 ? '' : 's'}!`),
      h('p', {}, `Reward: +${s.daily.xp} bonus XP`, s.daily.powerUps.length > 0 ? h('span', {}, ' and ', rewardPowerUps(s.daily.powerUps)) : ' (your power-up inventory is full)', '.'),
    );
  const review =
    lightning &&
    h(
      'section',
      { class: 'lightning-review', id: 'lightning-review', 'aria-label': 'Review of your answers' },
      h('h2', { class: 'px-title small-title' }, 'Review: every answer, explained'),
      s.review.length === 0 && h('p', { class: 'px-help' }, 'No answers this round.'),
      ...s.review.map((item, i) => h('div', { class: 'px-panel q-panel review-item' }, h('p', { class: 'stem' }, h('strong', {}, `${i + 1}. `), item.question.stem), ...feedbackNodes(item.question, item.feedback))),
    );
  gameScreen(
    null,
    h('header', { class: 'topbar game-top' }, h('span', { class: 'brand' }, island ? island.name : lightning ? 'Lightning round' : s.kind === 'daily' ? 'Daily challenge' : 'Game mode'), h('span', { class: 'px-text' }, `${s.correct} of ${s.answered} right`)),
    h(
      'main',
      { class: 'page game', id: 'game-over' },
      h(
        'section',
        { class: `px-panel game-over end-${s.end}` },
        h('h1', { class: 'px-title', id: 'game-over-title', 'aria-label': title }, ...dropLetters(title)),
        h(
          'div',
          { class: 'over-scene' },
          cat(won ? 'cheer' : s.end === 'lives' ? 'cry' : 'sad', 'over-cat'),
          domain !== null && s.boss && h('span', { class: `over-boss${s.end === 'victory' ? ' beaten' : ''}` }, bossSprite(domain, 'over-boss')),
        ),
        h('p', { class: 'bubble', id: 'game-over-line' }, line),
        reward,
        h('div', { class: 'game-stats' }, ...stats),
        rankBadge(s.level),
        levelBar(s.level, 'over-level'),
        h(
          'p',
          { class: 'px-help' },
          wrong > 0 ? `${wrong} wrong answer${wrong === 1 ? '' : 's'} joined your questions to retry.` : 'No wrong answers this round.',
          lightning && s.answered > 0 ? ' The explanation of every answer is below.' : '',
        ),
      ),
      review,
    ),
    h(
      'footer',
      { class: 'bottombar game-bar' },
      h('button', { id: 'game-home', class: 'px-button ghosted', onclick: () => void home() }, 'Home'),
      h('button', { id: 'game-menu', class: `px-button${s.end === 'victory' || dailyDone ? '' : ' ghosted'}`, onclick: () => void gameHub() }, '◀ Map'),
      s.end !== 'victory' && !dailyDone && h('button', { id: 'game-retry', class: 'px-button', onclick: () => void (retry ? playRound(retry) : gameHub()) }, domain !== null && s.boss ? 'Retry boss ▶' : lightning ? 'Play again ▶' : 'Retry ▶'),
    ),
  );
  countUp(xp, s.xpEarned, '+');
  if (won) {
    const at = centre(document.getElementById('over-cat') as HTMLElement);
    burst(at.x, at.y, 'confetti');
  }
  if (s.newBest) floatText('NEW HIGH SCORE!', null, 0, 'victory');
  announceAchievements(s.unlocked);
  backAction = () => void gameHub();
}
