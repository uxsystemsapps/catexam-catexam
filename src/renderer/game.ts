// Game mode, stage 1: the training questions as a pixel-art arcade round, with XP, ranks, combos, hearts and a
// hoodie cat that reacts to every answer. Loaded before app.js and shares its global scope: it uses the app's
// helpers (h, show, api, trainingForm, questionBody, feedbackNodes…) when its screens open. Scoring, hearts and
// saving live in the service (src/engine/game.ts); this script only shows them.
//
// Effects never stand between the player and the explanation: they sit in a layer that ignores the pointer,
// the explanation is part of the feedback, and the level-up and game-over screens come after "Next".

/* exported gameCard, gameSettingsCard, creditsCard */

/** Art, font and sounds (assets/game, copied next to this script). */
const GAME_ASSETS = 'game/';

/** Assets of the game and where they come from; listed in Profile & settings and in assets/CREDITS.md. */
const GAME_CREDITS: { what: string; source: string; author: string; licence: string; url: string }[] = [
  { what: 'Hoodie cat mascot (adapted: hoodie, padlock print, cheering, facepalm, sweating and crying frames added)', source: 'Pixel cat', author: 'scofanogd', licence: 'CC0 1.0', url: 'https://opengameart.org/content/pixel-cat' },
  { what: 'Hearts, gem, coin, and the islands and props of the world map', source: 'Pixel Platformer', author: 'Kenney', licence: 'CC0 1.0', url: 'https://kenney.nl/assets/pixel-platformer' },
  { what: 'Combo flame', source: 'Simple animate fire', author: 'XenosNS', licence: 'CC0 1.0', url: 'https://opengameart.org/content/simple-animate-fire' },
  { what: 'Pixel font (Kenney Mini Square)', source: 'Kenney Fonts', author: 'Kenney', licence: 'CC0 1.0', url: 'https://kenney.nl/assets/kenney-fonts' },
  { what: 'Right-answer ding and wrong-answer buzz', source: 'Interface Sounds', author: 'Kenney', licence: 'CC0 1.0', url: 'https://kenney.nl/assets/interface-sounds' },
  { what: 'Combo whoosh', source: 'Digital Audio', author: 'Kenney', licence: 'CC0 1.0', url: 'https://kenney.nl/assets/digital-audio' },
  { what: 'Level-up fanfare', source: 'Music Jingles', author: 'Kenney', licence: 'CC0 1.0', url: 'https://kenney.nl/assets/music-jingles' },
  { what: 'Coin clink', source: 'RPG Audio', author: 'Kenney', licence: 'CC0 1.0', url: 'https://kenney.nl/assets/rpg-audio' },
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
};

function pick(lines: readonly string[]): string {
  return lines[Math.floor(Math.random() * lines.length)];
}

// ---------- Sound and effects ----------

type Sfx = 'ding' | 'buzz' | 'whoosh' | 'fanfare' | 'coin';

/** Settings of the last `info()` call; the HUD sound button and Profile & settings change them. */
let gameSettings: GameSettings = { sound: false, volume: 70, lite: false };
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

type CatPose = 'idle' | 'cheer' | 'facepalm' | 'sweat' | 'cry';

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

/** Wraps a game screen: pixel look, and the effect level as a data attribute for the CSS. */
function gameScreen(...nodes: Node[]): void {
  document.getElementById('fx-layer')?.remove();
  show(...nodes);
  document.documentElement.dataset.fx = effectLevel();
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
      h('p', { class: 'small' }, 'The same questions as an arcade game: XP, ranks, combos and three hearts. The explanation always follows each answer.'),
      levelBar(info.game.level, 'home-level'),
    ),
    h('button', { id: 'open-game', class: 'px-button', disabled: info.bank.total === 0, onclick: () => void gameHub() }, 'Play ▶'),
  );
}

/** Game settings for Profile & settings: sound on/off and volume, lite effects. */
function gameSettingsCard(settings: GameSettings): { node: HTMLElement; read: () => GameSettings } {
  const sound = h('input', { id: 'settings-sound', type: 'checkbox', checked: settings.sound });
  const volume = h('input', { id: 'settings-volume', type: 'range', min: '0', max: '100', step: '5', value: String(settings.volume) });
  const lite = h('input', { id: 'settings-lite', type: 'checkbox', checked: settings.lite });
  return {
    node: h(
      'section',
      { class: 'card', id: 'game-settings' },
      h('h2', {}, 'Game mode'),
      h('label', { class: 'check' }, sound, ' Sound effects'),
      h('label', { class: 'field' }, 'Volume', volume),
      h('label', { class: 'check' }, lite, ' Lite effects (no particles, shaking or bouncing)'),
      h('p', { class: 'small' }, 'When the system asks to reduce motion, the game shows no animations at all.'),
    ),
    read: () => ({ sound: sound.checked, volume: Number(volume.value), lite: lite.checked }),
  };
}

function creditsCard(): HTMLElement {
  return h(
    'section',
    { class: 'card', id: 'credits' },
    h('h2', {}, 'Credits'),
    h('p', { class: 'small' }, 'Game art, font and sounds are free assets used under their licences:'),
    h('ul', { class: 'credits' }, ...GAME_CREDITS.map((c) => h('li', {}, h('strong', {}, c.what), `: “${c.source}” by ${c.author}, ${c.licence} (${c.url})`))),
  );
}

// ---------- Hub: the world map ----------

/** One island per CISSP domain (in domain order): its name on the map and its ground; its prop is `.prop-<domain>` in the CSS. */
const ISLANDS: { name: string; ground: 'grass' | 'sand' | 'snow' }[] = [
  { name: 'Risk Reef', ground: 'grass' },
  { name: 'Asset Atoll', ground: 'grass' },
  { name: 'Crypto Crag', ground: 'snow' },
  { name: 'Packet Peninsula', ground: 'grass' },
  { name: 'Identity Isle', ground: 'sand' },
  { name: 'Pentest Dunes', ground: 'sand' },
  { name: 'SOC Glacier', ground: 'snow' },
  { name: 'Code Cove', ground: 'grass' },
];

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

/**
 * Game start screen: the player's rank, and a world map with one island per domain. Tap islands to pick the
 * domains of the round, then pick difficulty, length, timer and question pool, and press start.
 */
async function gameHub(): Promise<void> {
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
    void startGame({ ...options, domains });
  };
  gameScreen(
    h('header', { class: 'topbar game-top' }, h('span', { class: 'brand' }, 'Game mode'), h('span', { class: 'px-text' }, `Rounds ${info.game.games} · Best combo ${info.game.bestCombo}`)),
    h(
      'main',
      { class: 'page game', id: 'game-hub' },
      h(
        'section',
        { class: 'px-panel game-hero' },
        cat('idle', 'hub-cat'),
        h('div', { class: 'game-hero-text' }, h('h1', { class: 'px-title' }, 'CISSP Quest'), rankBadge(info.game.level), levelBar(info.game.level, 'hub-level')),
      ),
      h(
        'section',
        { class: 'world', id: 'world-map', 'aria-label': 'World map: pick the islands (domains) to play' },
        h(
          'div',
          { class: 'world-head' },
          h('h2', { class: 'px-title small-title' }, 'World map'),
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
      h('button', { id: 'game-hub-home', class: 'px-button ghosted', onclick: () => void home() }, '◀ Back'),
      h('button', { id: 'game-start', class: 'px-button', onclick: start }, 'PRESS START'),
    ),
    tabbar('game'),
  );
  backAction = () => void home();
}

// ---------- Playing ----------

let gameTimer: number | undefined;

interface GameContext {
  total: number;
  maxLives: number;
  lives: number;
  seconds: number;
  combo: number;
  multiplier: number;
  level: LevelInfo;
  answered: number;
}

/** Settings of the last round, for Retry. */
let lastGameOptions: PracticeOptions | null = null;

async function startGame(options: PracticeOptions): Promise<void> {
  let start: GameStart;
  try {
    start = await api.startGame(options);
  } catch (err) {
    toast(errorText(err));
    return;
  }
  lastGameOptions = options;
  playSfx('whoosh');
  renderGameQuestion(start.question, { total: start.total, maxLives: start.lives, lives: start.lives, seconds: start.secondsPerQuestion, combo: 0, multiplier: 1, level: start.level, answered: 0 });
  floatText('READY?', null, 0, 'ready');
  setTimeout(() => floatText('GO!', null, 0, 'go'), 750);
}

function quitGame(): void {
  modal('Quit this round?', 'Your XP so far is saved. Wrong answers are already in your questions to retry.', [
    { label: 'Keep playing', id: 'game-quit-cancel', onClick: () => undefined },
    { label: 'Quit', id: 'game-quit-confirm', primary: true, onClick: () => void gameOver() },
  ]);
}

function renderGameQuestion(q: QuestionView, ctx: GameContext): void {
  clearInterval(gameTimer);
  const body = questionBody(q);
  const feedback = h('div', { id: 'feedback', 'aria-live': 'polite' });
  const feedbackPanel = h('section', { class: 'px-panel q-panel', hidden: true }, feedback);
  const mascot = cat('idle', 'game-cat');
  const bubble = h('p', { class: 'bubble', id: 'game-quip', hidden: true });
  // Between the options and the feedback: after an answer the cat's reaction and the joke sit right above the
  // verdict and the explanation, on a phone too.
  const stage = h('div', { class: 'game-stage', id: 'game-stage' }, mascot, bubble);
  const heartRow = hearts(ctx.lives, ctx.maxLives);
  let levelNode = levelBar(ctx.level, 'game-level');
  let comboNode = comboMeter(ctx.combo, ctx.multiplier);
  const timeLeft = h('span', { id: 'game-time-left', class: 'px-text' });
  const soundButton = h('button', { id: 'game-sound', class: 'px-button mini-px', 'aria-pressed': String(gameSettings.sound), title: 'Sound effects' }, gameSettings.sound ? '♪ On' : '♪ Off');
  soundButton.addEventListener('click', async () => {
    gameSettings = await api.saveGameSettings({ ...gameSettings, sound: !gameSettings.sound });
    soundButton.textContent = gameSettings.sound ? '♪ On' : '♪ Off';
    soundButton.setAttribute('aria-pressed', String(gameSettings.sound));
  });
  const button = h('button', { id: 'game-check', class: 'px-button' }, 'Check');
  let go: HTMLButtonElement | null = null;
  let poseTimer: number | undefined;
  const pose = (p: CatPose, back = 0): void => {
    clearTimeout(poseTimer);
    mascot.dataset.pose = p;
    if (back > 0) poseTimer = window.setTimeout(() => (mascot.dataset.pose = 'idle'), back);
  };

  const answered = (r: GameAnswer): void => {
    clearInterval(gameTimer);
    const f = r.feedback;
    const main = document.getElementById('game') as HTMLElement;
    for (const input of main.querySelectorAll<HTMLInputElement>('.options input')) {
      input.checked = f.response.includes(Number(input.value));
      input.disabled = true;
    }
    markOptions(q, f, main);
    bubble.hidden = false;
    bubble.textContent = pick(f.timedOut ? QUIPS.timeout : f.correct ? QUIPS.right : QUIPS.wrong);
    bubble.className = `bubble ${f.correct ? 'good' : 'bad'}`;
    // The real explanation follows the joke, always.
    feedback.replaceChildren(...feedbackNodes(q, f));
    feedbackPanel.hidden = false;
    stage.scrollIntoView({ block: 'start' });
    const lostHeart = r.lives < ctx.lives;
    const frenzyStarts = r.multiplier > ctx.multiplier;
    const comboGrew = r.combo > ctx.combo;
    Object.assign(ctx, { lives: r.lives, combo: r.combo, multiplier: r.multiplier, level: r.level, answered: ctx.answered + 1 });
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
      } else if (STREAK_SHOUTS[r.combo]) {
        floatText(STREAK_SHOUTS[r.combo], null, 0, 'shout');
      }
    } else {
      // Facepalm first, then the tears.
      pose('facepalm');
      poseTimer = window.setTimeout(() => pose('cry', 3000), 900);
      playSfx('buzz');
      if (lostHeart) {
        const heart = heartRow.children[r.lives] as HTMLElement | undefined;
        if (heart) heartFall(heart);
        heart?.classList.replace('heart', 'heart-empty');
        heart?.classList.add('breaking');
        heartRow.setAttribute('aria-label', `${r.lives} of ${ctx.maxLives} hearts left`);
      }
      if (effectLevel() === 'full') {
        flash();
        main.classList.remove('shake');
        void main.offsetWidth;
        main.classList.add('shake');
      }
    }
    const next = r.next;
    go = h('button', { id: 'game-next', class: 'px-button' }, next ? 'Next ▶' : r.end === 'lives' ? 'Game over ▶' : 'Results ▶');
    go.addEventListener('click', () => {
      const onward = (): void => (next ? renderGameQuestion(next, ctx) : void gameOver());
      if (r.levelUp) levelUpScreen(r.level, r.rankUp, onward);
      else onward();
    });
    button.replaceWith(go);
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

  if (ctx.seconds > 0) {
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
    h(
      'header',
      { class: 'game-hud' },
      heartRow,
      levelNode,
      comboNode,
      h('span', { class: 'hud-right' }, ctx.seconds > 0 && timeLeft, h('span', { id: 'game-qnum', class: 'px-text' }, `Q ${ctx.answered + 1}/${ctx.total}`), soundButton),
    ),
    h(
      'main',
      { class: `question game${ctx.multiplier > 1 ? ' frenzy' : ''}`, id: 'game' },
      h('section', { class: 'px-panel q-panel q-enter' }, h('p', { class: 'stem' }, q.stem), body.node),
      stage,
      feedbackPanel,
    ),
    h(
      'footer',
      { class: 'bottombar game-bar' },
      h('button', { id: 'game-quit', class: 'px-button ghosted', onclick: quitGame }, 'Quit'),
      button,
    ),
  );
  keyHandler = questionKeys(
    (i) => { if (!go) body.select(i); },
    () => { if (go) go.click(); else if (!button.disabled) void check(); },
  );
  backAction = quitGame;
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

/** End of the round: why it ended, with a funny line, the score and a retry. */
async function gameOver(): Promise<void> {
  clearInterval(gameTimer);
  let s: GameSummary;
  try {
    s = await api.gameSummary();
  } catch (err) {
    toast(errorText(err));
    return void gameHub();
  }
  const title = s.end === 'lives' ? 'GAME OVER' : s.end === 'cleared' ? 'ROUND CLEAR!' : 'LOGGED OFF';
  if (s.end === 'cleared') playSfx('fanfare');
  else if (s.end === 'lives') playSfx('buzz');
  const xp = h('span', { class: 'xp-count' }, `+${s.xpEarned}`);
  gameScreen(
    h('header', { class: 'topbar game-top' }, h('span', { class: 'brand' }, 'Game mode'), h('span', { class: 'px-text' }, `${s.correct} of ${s.answered} right`)),
    h(
      'main',
      { class: 'page game', id: 'game-over' },
      h(
        'section',
        { class: `px-panel game-over end-${s.end}` },
        h('h1', { class: 'px-title', id: 'game-over-title', 'aria-label': title }, ...dropLetters(title)),
        cat(s.end === 'cleared' ? 'cheer' : s.end === 'lives' ? 'cry' : 'facepalm', 'over-cat'),
        h('p', { class: 'bubble', id: 'game-over-line' }, pick(QUIPS[s.end])),
        h(
          'div',
          { class: 'game-stats' },
          h('div', {}, h('span', { class: 'px-big', id: 'game-over-xp' }, icon('coin'), ' ', xp), h('span', {}, 'XP earned')),
          h('div', {}, h('span', { class: 'px-big' }, `${s.correct}/${s.answered}`), h('span', {}, 'right answers')),
          h('div', {}, h('span', { class: 'px-big' }, String(s.bestCombo)), h('span', {}, 'best combo')),
        ),
        rankBadge(s.level),
        levelBar(s.level, 'over-level'),
        h('p', { class: 'px-help' }, s.answered > s.correct ? `${s.answered - s.correct} wrong answer${s.answered - s.correct === 1 ? '' : 's'} joined your questions to retry.` : 'No wrong answers this round.'),
      ),
    ),
    h(
      'footer',
      { class: 'bottombar game-bar' },
      h('button', { id: 'game-home', class: 'px-button ghosted', onclick: () => void home() }, 'Home'),
      h('button', { id: 'game-menu', class: 'px-button ghosted', onclick: () => void gameHub() }, '◀ Map'),
      h('button', { id: 'game-retry', class: 'px-button', onclick: () => void (lastGameOptions ? startGame(lastGameOptions) : gameHub()) }, 'Retry ▶'),
    ),
  );
  countUp(xp, s.xpEarned, '+');
  if (s.end === 'cleared') {
    const at = centre(document.getElementById('over-cat') as HTMLElement);
    burst(at.x, at.y, 'confetti');
  }
  backAction = () => void gameHub();
}
