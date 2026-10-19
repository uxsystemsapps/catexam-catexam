import { DOMAIN_IDS } from './domains';
import { PracticeSession, type PracticeFeedback } from './practice';
import { difficultyOf, type Difficulty } from './profile';
import type { DomainId, Question, QuestionView } from './types';

/**
 * Game mode: training questions played as an arcade round. Right answers earn XP (more for harder questions) and
 * build a combo that multiplies it; wrong answers break a heart; the round ends when the hearts or the questions
 * run out. XP, the best combo and the game settings are kept between sessions (`game.json`).
 *
 * Stage 2 adds the world map: one island per domain. An island is a stage of the domain's questions and then a
 * boss fight with its hardest questions: each right answer takes one hit point off the boss, a wrong one still
 * costs a heart. Beating the boss clears the island (kept in `GameProgress.world`).
 *
 * Stage 3 adds power-ups (earned by combos, beaten bosses and the daily challenge, kept in a small inventory),
 * achievements (badges unlocked by what is kept in `GameProgress`), the daily challenge (the same ten questions
 * for everyone on a day, with a streak and its reward) and the lightning round (60 seconds, no hearts, a local
 * high score; the explanations wait for the review after the round).
 */

export const GAME_LIVES = 3;
/** XP of a right answer before the combo multiplier. */
export const BASE_XP: Record<Difficulty, number> = { easy: 10, medium: 20, hard: 30 };
/** Combo (right answers in a row) at which each multiplier starts: "Encryption Frenzy". */
export const COMBO_TIERS: readonly { combo: number; multiplier: number }[] = [
  { combo: 10, multiplier: 3 },
  { combo: 5, multiplier: 2 },
];

/** Ranks by the level that unlocks them, lowest first. */
export const RANKS: readonly { level: number; title: string }[] = [
  { level: 1, title: 'Intern' },
  { level: 2, title: 'Password123 Survivor' },
  { level: 3, title: 'Phishing Bait No More' },
  { level: 4, title: 'Patch Tuesday Veteran' },
  { level: 6, title: 'Firewall Whisperer' },
  { level: 8, title: 'Zero-Trust Zealot' },
  { level: 10, title: 'Threat Hunter' },
  { level: 13, title: 'Crypto Wizard' },
  { level: 16, title: 'CISO of Doom' },
];

export interface GameSettings {
  sound: boolean;
  /** Sound effect volume, 0–100. */
  volume: number;
  /** Music (map, boss fight and, later, lightning round tracks), apart from the sound effects. */
  music: boolean;
  /** Music volume, 0–100. */
  musicVolume: number;
  /** Fewer effects (no particles, shake or bouncing), for slower phones or by taste. */
  lite: boolean;
}

/** Questions of an island before its boss. */
export const STAGE_QUESTIONS = 6;
/** Hit points of a boss: one right answer takes one. */
export const BOSS_HP = 5;
/** XP for beating a boss, on top of the XP of the answers. */
export const BOSS_BONUS_XP = 100;

/** Kinds of round: a quick round, an island (its stage and boss, or the boss alone), the daily challenge, the lightning round. */
export type GameKind = 'quick' | 'island' | 'daily' | 'lightning';

/** "50/50" removes two wrong options, "Ask the Auditor" gives a hint, "Patch Tuesday" mends a heart. */
export type PowerUpId = 'fifty' | 'auditor' | 'patch';
export const POWER_UP_IDS: readonly PowerUpId[] = ['fifty', 'auditor', 'patch'];
export type PowerUps = Record<PowerUpId, number>;
/** The inventory is small: at most this many of each power-up. */
export const POWER_UP_CAP = 3;
/** Every this many right answers in a row earn a power-up: 50/50 at 5, Ask the Auditor at 10, Patch Tuesday at 15, and round again. */
export const POWER_UP_COMBO = 5;

/**
 * Questions kept for a boss fight: one per hit point, one more per heart but the last, and a spare for each
 * Patch Tuesday the player may hold, so a fight always ends with a winner.
 */
export const BOSS_QUESTIONS = BOSS_HP + GAME_LIVES - 1 + POWER_UP_CAP;

/** Questions of the daily challenge. */
export const DAILY_QUESTIONS = 10;
/** XP for finishing the daily challenge, plus `STREAK_BONUS_XP` per day of the streak before today (at most `STREAK_BONUS_DAYS`). */
export const DAILY_BONUS_XP = 50;
export const STREAK_BONUS_XP = 10;
export const STREAK_BONUS_DAYS = 9;
/** Every 7th day of a streak the reward is one of each power-up (otherwise one, in turn). */
export const STREAK_WEEK = 7;

/** Length of the lightning round, and how late an answer sent just before the end still counts. */
export const LIGHTNING_SECONDS = 60;
export const LIGHTNING_GRACE_MS = 2000;

/** One island of the world map (one per domain, in domain order). */
export interface IslandProgress {
  domain: DomainId;
  /** The boss was beaten at least once: the island is lit and alive on the map. */
  cleared: boolean;
  /** The stage was won at least once: the boss can be fought again directly. */
  bossReached: boolean;
  /** Times the boss was beaten. */
  victories: number;
}

export interface WorldProgress {
  /** Island where the cat stands on the map (the last one played). */
  at: DomainId;
  islands: IslandProgress[];
}

/** Counters kept for the achievements. */
export interface GameStats {
  /** Right answers in game mode (every kind of round). */
  right: number;
  powerUpsUsed: number;
  /** Bosses beaten without losing a heart on the island, and with one heart left. */
  flawless: number;
  clutch: number;
  /** Longest daily challenge streak. */
  bestStreak: number;
}

/** What the game keeps between sessions. */
export interface GameProgress {
  xp: number;
  bestCombo: number;
  /** Rounds started (every kind). */
  games: number;
  settings: GameSettings;
  world: WorldProgress;
  powerUps: PowerUps;
  /** Unlocked achievements and the day (YYYY-MM-DD) each was unlocked. */
  achievements: Partial<Record<AchievementId, string>>;
  stats: GameStats;
  /** Days the daily challenge was finished (YYYY-MM-DD, oldest first, the last `DAILY_DAYS_KEPT`). */
  dailyDays: string[];
  /** Most right answers in one lightning round. */
  lightningBest: number;
}

/** Level and rank for a total XP, with the XP range of the current level for the level bar. */
export interface LevelInfo {
  xp: number;
  level: number;
  rank: string;
  /** Total XP at which the current level started and the next one starts. */
  levelStart: number;
  nextLevel: number;
}

/**
 * Why a round ended: no hearts left (also when a boss still standing has no questions left: banks too small for
 * a full fight), every question answered (quick round, daily challenge), the boss beaten (island), the time up
 * (lightning round), or the player quit.
 */
export type GameEnd = 'lives' | 'cleared' | 'victory' | 'time' | 'quit';

/** The part of an island being played. */
export type GamePhase = 'stage' | 'boss';

/** A boss's hit points; `max` is set when the fight starts. */
export interface BossState {
  hp: number;
  max: number;
}

/** After an answer: XP, combo, hearts, level, and the next question (null once the round is over). */
export interface GameAnswer {
  feedback: PracticeFeedback;
  /** XP of this answer, the boss bonus included. */
  xpGained: number;
  /** Of `xpGained`: the bonus for beating the boss. */
  bonusXp: number;
  /** Multiplier applied to this answer (1 outside a frenzy). */
  multiplier: number;
  /** Right answers in a row, this one included (0 after a wrong answer). */
  combo: number;
  lives: number;
  level: LevelInfo;
  /** This answer reached a new level (and `rankUp`: a new rank). */
  levelUp: boolean;
  rankUp: boolean;
  /** Phase this answer was given in. */
  phase: GamePhase;
  /** The boss after this answer (null outside a boss fight); `bossHit`: this answer took a hit point. */
  boss: BossState | null;
  bossHit: boolean;
  /** The stage is won: the next question is the boss's. */
  bossStarts: boolean;
  /** The next question, or null when the round is over (`end` says why). */
  next: QuestionView | null;
  end: GameEnd | null;
  /** Power-ups this answer earned (none once the inventory is full), and the inventory after it. */
  earned: PowerUpId[];
  powerUps: PowerUps;
  /** Achievements this answer unlocked. */
  unlocked: AchievementInfo[];
}

/** A lightning round answer, for the review after the round. */
export interface GameReviewItem {
  question: QuestionView;
  feedback: PracticeFeedback;
}

/** Reward for finishing the daily challenge: the streak with today, bonus XP and power-ups (those that fitted). */
export interface DailyReward {
  day: string;
  streak: number;
  xp: number;
  powerUps: PowerUpId[];
}

export interface GameSummary {
  kind: GameKind;
  answered: number;
  correct: number;
  total: number;
  xpEarned: number;
  bestCombo: number;
  end: GameEnd;
  level: LevelInfo;
  /** Island of the round (null for the other kinds), and its boss when the fight was reached. */
  island: DomainId | null;
  boss: BossState | null;
  /** Lightning round: every answer with its explanation, the high score after the round and whether it is new. */
  review: GameReviewItem[];
  best: number;
  newBest: boolean;
  /** Daily challenge: the reward, once every question is answered. */
  daily: DailyReward | null;
  /** Achievements unlocked when the round ended. */
  unlocked: AchievementInfo[];
}

/** Result of a power-up: options taken off the question, the Auditor's hint, the hearts and the inventory after it. */
export interface PowerUpEffect {
  id: PowerUpId;
  removed: number[];
  hint: string | null;
  lives: number;
  powerUps: PowerUps;
  unlocked: AchievementInfo[];
}

/** Days of the daily challenge kept in `game.json` (enough for the calendar and long streaks). */
export const DAILY_DAYS_KEPT = 400;

export function defaultGameProgress(platform: 'desktop' | 'mobile'): GameProgress {
  // Sound and music start off on phones (people play in public); on the desktop they start on.
  const desktop = platform !== 'mobile';
  const islands = DOMAIN_IDS.map((domain) => ({ domain, cleared: false, bossReached: false, victories: 0 }));
  return {
    xp: 0,
    bestCombo: 0,
    games: 0,
    settings: { sound: desktop, volume: 70, music: desktop, musicVolume: 50, lite: false },
    world: { at: 1, islands },
    // One of each power-up to start with, so that the inventory explains itself.
    powerUps: { fifty: 1, auditor: 1, patch: 1 },
    achievements: {},
    stats: { right: 0, powerUpsUsed: 0, flawless: 0, clutch: 0, bestStreak: 0 },
    dailyDays: [],
    lightningBest: 0,
  };
}

function obj(raw: unknown): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function count(value: unknown, max = Number.MAX_SAFE_INTEGER): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(0, Math.round(value))) : undefined;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeGameSettings(raw: unknown, platform: 'desktop' | 'mobile'): GameSettings {
  const r = obj(raw);
  const d = defaultGameProgress(platform).settings;
  return {
    sound: flag(r.sound, d.sound),
    volume: count(r.volume, 100) ?? d.volume,
    music: flag(r.music, d.music),
    musicVolume: count(r.musicVolume, 100) ?? d.musicVolume,
    lite: flag(r.lite, d.lite),
  };
}

function normalizeWorld(raw: unknown): WorldProgress {
  const r = obj(raw);
  const saved = Array.isArray(r.islands) ? r.islands.map(obj) : [];
  const islands = DOMAIN_IDS.map((domain): IslandProgress => {
    const s = saved.find((i) => i.domain === domain) ?? {};
    const cleared = flag(s.cleared, false);
    // A cleared island has had its boss reached, whatever the file says.
    return { domain, cleared, bossReached: cleared || flag(s.bossReached, false), victories: count(s.victories) ?? (cleared ? 1 : 0) };
  });
  return { at: DOMAIN_IDS.find((d) => d === r.at) ?? 1, islands };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Untrusted `game.json` with defaults for anything missing or invalid. */
export function normalizeGameProgress(raw: unknown, platform: 'desktop' | 'mobile'): GameProgress {
  const r = obj(raw);
  const d = defaultGameProgress(platform).powerUps;
  const owned = obj(r.powerUps);
  const saved = obj(r.achievements);
  const achievements: GameProgress['achievements'] = {};
  for (const a of ACHIEVEMENTS) {
    const day = saved[a.id];
    if (typeof day === 'string' && DAY.test(day)) achievements[a.id] = day;
  }
  const stats = obj(r.stats);
  const days = Array.isArray(r.dailyDays) ? r.dailyDays.filter((x): x is string => typeof x === 'string' && DAY.test(x)) : [];
  return {
    xp: count(r.xp) ?? 0,
    bestCombo: count(r.bestCombo) ?? 0,
    games: count(r.games) ?? 0,
    settings: normalizeGameSettings(r.settings, platform),
    world: normalizeWorld(r.world),
    powerUps: { fifty: count(owned.fifty, POWER_UP_CAP) ?? d.fifty, auditor: count(owned.auditor, POWER_UP_CAP) ?? d.auditor, patch: count(owned.patch, POWER_UP_CAP) ?? d.patch },
    achievements,
    stats: {
      right: count(stats.right) ?? 0,
      powerUpsUsed: count(stats.powerUpsUsed) ?? 0,
      flawless: count(stats.flawless) ?? 0,
      clutch: count(stats.clutch) ?? 0,
      bestStreak: count(stats.bestStreak) ?? 0,
    },
    dailyDays: [...new Set(days)].sort().slice(-DAILY_DAYS_KEPT),
    lightningBest: count(r.lightningBest) ?? 0,
  };
}

/** Questions of an island: the stage and the boss fight. */
export interface IslandItems {
  stage: Question[];
  boss: Question[];
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Questions of an island (one domain): the boss gets the hard ones (above 0.5 logits) in random order, topped up
 * with the hardest of the rest when the domain has too few; the stage gets random questions of the rest.
 */
export function selectIslandItems(bank: readonly Question[], domain: DomainId, rng: () => number = Math.random): IslandItems {
  const pool = bank.filter((q) => q.domain === domain);
  const hard = shuffled(pool.filter((q) => difficultyOf(q.difficulty) === 'hard'), rng).slice(0, BOSS_QUESTIONS);
  const chosen = new Set(hard);
  const topUp = pool.filter((q) => !chosen.has(q)).sort((a, b) => b.difficulty - a.difficulty).slice(0, BOSS_QUESTIONS - hard.length);
  const boss = shuffled([...hard, ...topUp], rng);
  for (const q of topUp) chosen.add(q);
  return { stage: shuffled(pool.filter((q) => !chosen.has(q)), rng).slice(0, STAGE_QUESTIONS), boss };
}

// ---------- Power-ups ----------

/** Adds power-ups to an inventory, up to `POWER_UP_CAP` of each; returns those that fitted. */
export function addPowerUps(inventory: PowerUps, ids: readonly PowerUpId[]): PowerUpId[] {
  return ids.filter((id) => {
    if (inventory[id] >= POWER_UP_CAP) return false;
    inventory[id]++;
    return true;
  });
}

/** 50/50 needs two wrong options to take away and must leave more options than answers to pick. */
export function fiftyFits(q: Pick<QuestionView, 'type' | 'options' | 'selectCount'>): boolean {
  return q.type !== 'ordering' && q.options.length - 2 > q.selectCount;
}

// ---------- Daily challenge ----------

/** `day` (YYYY-MM-DD) moved by `n` days. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Days in a row the daily challenge was finished, up to today (or up to yesterday while today is still open). */
export function dailyStreak(days: readonly string[], today: string): number {
  const done = new Set(days);
  let day = done.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (done.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

/** A random number generator seeded by a text (FNV-1a hash, then mulberry32): the same text, the same numbers. */
function seededRng(text: string): () => number {
  let a = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The daily challenge of `day`: ten questions of the whole bank, the same all day long (for the same bank). */
export function selectDailyItems(bank: readonly Question[], day: string): Question[] {
  const sorted = [...bank].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return shuffled(sorted, seededRng(`catexam-daily-${day}`)).slice(0, DAILY_QUESTIONS);
}

/** What finishing the daily challenge gives on the `streak`-th day in a row: bonus XP and power-ups (before the inventory cap). */
export function dailyRewardFor(streak: number): { xp: number; powerUps: PowerUpId[] } {
  return {
    xp: DAILY_BONUS_XP + STREAK_BONUS_XP * Math.min(streak - 1, STREAK_BONUS_DAYS),
    powerUps: streak % STREAK_WEEK === 0 ? [...POWER_UP_IDS] : [POWER_UP_IDS[(streak - 1) % POWER_UP_IDS.length]],
  };
}

/**
 * Finishes the daily challenge of `day`: keeps the day, and rewards the streak with bonus XP (more for a longer
 * streak) and a power-up (in turn; one of each on every 7th day in a row). Null when the day was already done.
 */
export function completeDaily(progress: GameProgress, day: string): DailyReward | null {
  if (progress.dailyDays.includes(day)) return null;
  progress.dailyDays = [...progress.dailyDays, day].sort().slice(-DAILY_DAYS_KEPT);
  const streak = dailyStreak(progress.dailyDays, day);
  progress.stats.bestStreak = Math.max(progress.stats.bestStreak, streak);
  const reward = dailyRewardFor(streak);
  progress.xp += reward.xp;
  return { day, streak, xp: reward.xp, powerUps: addPowerUps(progress.powerUps, reward.powerUps) };
}

// ---------- Lightning round ----------

/** Questions of a lightning round: every single- and multiple-answer question (quick to answer), shuffled. */
export function selectLightningItems(bank: readonly Question[], rng: () => number = Math.random): Question[] {
  return shuffled(bank.filter((q) => q.type !== 'ordering'), rng);
}

// ---------- Achievements ----------

export type AchievementId =
  | 'first-right'
  | 'combo-5'
  | 'xp-1000'
  | 'combo-10'
  | 'first-boss'
  | 'flawless'
  | 'clutch'
  | 'all-islands'
  | 'power-up'
  | 'hoarder'
  | 'daily'
  | 'streak-7'
  | 'lightning-10'
  | 'level-5'
  | 'right-100';

/** An achievement as the screens show it; `badge` is its picture in game/badges.png, `unlocked` the day or null. */
export interface AchievementInfo {
  id: AchievementId;
  name: string;
  description: string;
  badge: number;
  unlocked: string | null;
}

/** The badges, in the order of game/badges.png; each is unlocked once `test` holds for the saved progress. */
export const ACHIEVEMENTS: readonly { id: AchievementId; name: string; description: string; test: (p: GameProgress) => boolean }[] = [
  { id: 'first-right', name: "Didn't click the link", description: 'Answer your first game question right.', test: (p) => p.stats.right >= 1 },
  { id: 'combo-5', name: 'Hashed it out', description: 'Five right answers in a row.', test: (p) => p.bestCombo >= 5 },
  { id: 'xp-1000', name: 'Least Privilege, Most Points', description: 'Earn 1,000 XP.', test: (p) => p.xp >= 1000 },
  { id: 'combo-10', name: 'Full-Disk Frenzy', description: 'Ten right answers in a row.', test: (p) => p.bestCombo >= 10 },
  { id: 'first-boss', name: 'Incident Closed', description: 'Beat your first boss.', test: (p) => p.world.islands.some((i) => i.victories > 0) },
  { id: 'flawless', name: 'Clean Audit', description: 'Clear an island without losing a heart.', test: (p) => p.stats.flawless >= 1 },
  { id: 'clutch', name: 'Restored from Backup', description: 'Beat a boss with one heart left.', test: (p) => p.stats.clutch >= 1 },
  { id: 'all-islands', name: 'Zero Trust, Full Map', description: 'Clear all eight islands.', test: (p) => p.world.islands.every((i) => i.cleared) },
  { id: 'power-up', name: 'Turned It Off and On Again', description: 'Use your first power-up.', test: (p) => p.stats.powerUpsUsed >= 1 },
  { id: 'hoarder', name: 'Shadow IT Hoarder', description: `Hold ${POWER_UP_CAP} of one power-up.`, test: (p) => POWER_UP_IDS.some((id) => p.powerUps[id] >= POWER_UP_CAP) },
  { id: 'daily', name: 'Daily Stand-up', description: 'Finish a daily challenge.', test: (p) => p.dailyDays.length >= 1 },
  { id: 'streak-7', name: 'Five Nines Uptime', description: 'Keep a daily streak for 7 days.', test: (p) => p.stats.bestStreak >= STREAK_WEEK },
  { id: 'lightning-10', name: 'Race Condition', description: 'Ten right answers in one lightning round.', test: (p) => p.lightningBest >= 10 },
  { id: 'level-5', name: 'Script Kiddie No More', description: 'Reach level 5.', test: (p) => levelInfo(p.xp).level >= 5 },
  { id: 'right-100', name: 'Defence in Depth', description: 'A hundred right answers in game mode.', test: (p) => p.stats.right >= 100 },
];

/** Every achievement with its state, in badge order. */
export function achievementList(progress: GameProgress): AchievementInfo[] {
  return ACHIEVEMENTS.map((a, badge) => ({ id: a.id, name: a.name, description: a.description, badge, unlocked: progress.achievements[a.id] ?? null }));
}

/** Unlocks (on `day`) the achievements the progress now earns; returns the new ones. */
export function unlockAchievements(progress: GameProgress, day: string): AchievementInfo[] {
  const fresh = ACHIEVEMENTS.filter((a) => !progress.achievements[a.id] && a.test(progress));
  for (const a of fresh) progress.achievements[a.id] = day;
  return achievementList(progress).filter((a) => fresh.some((f) => f.id === a.id));
}

/** Total XP needed to reach `level` (level 1 at 0 XP, then 100, 300, 600… : each level needs 100 XP more than the last). */
export function xpForLevel(level: number): number {
  return 50 * level * (level - 1);
}

export function rankOf(level: number): string {
  let title = RANKS[0].title;
  for (const r of RANKS) if (level >= r.level) title = r.title;
  return title;
}

export function levelInfo(xp: number): LevelInfo {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return { xp, level, rank: rankOf(level), levelStart: xpForLevel(level), nextLevel: xpForLevel(level + 1) };
}

export function comboMultiplier(combo: number): number {
  return COMBO_TIERS.find((t) => combo >= t.combo)?.multiplier ?? 1;
}

/** An island round: its domain and the questions kept for its boss. */
export interface IslandRound {
  domain: DomainId;
  boss: readonly Question[];
}

/** Options of a round that is not an island: its kind, the inventory, and (for tests) the clock and the dice. */
export interface RunOptions {
  kind?: Exclude<GameKind, 'island'>;
  powerUps?: PowerUps;
  now?: () => number;
  rng?: () => number;
}

const LETTERS = 'ABCDEFGH';

/**
 * One round of the game over a fixed list of questions. With an `island`, winning the stage (every question
 * answered with hearts left) starts the boss fight, with the hearts that are left; with no stage questions the
 * round is the boss fight alone (a retry). The daily challenge and the lightning round have no hearts; the
 * lightning round ends when its time is up and has no power-ups.
 */
export class GameRun {
  readonly kind: GameKind;
  /** Lightning round: when the time is up (epoch ms); 0 for the other kinds. */
  readonly deadline: number;
  private practice: PracticeSession;
  private phase: GamePhase = 'stage';
  private boss: BossState | null = null;
  /** Questions of the phases already finished, for the summary. */
  private earlierTotal = 0;
  private readonly hearts: boolean;
  private lives: number;
  private livesLost = 0;
  private combo = 0;
  private bestCombo = 0;
  private xpEarned = 0;
  private answered = 0;
  private correct = 0;
  private ended: GameEnd | null = null;
  private readonly inventory: PowerUps;
  /** Question that already got a 50/50 or a hint (one per question). */
  private helped = '';
  private readonly review: GameReviewItem[] = [];
  private readonly now: () => number;
  private readonly rng: () => number;

  /** `xp`: the player's total XP before the round. */
  constructor(
    items: readonly Question[],
    private xp: number,
    private readonly island: IslandRound | null = null,
    options: RunOptions = {},
  ) {
    this.kind = island ? 'island' : options.kind ?? 'quick';
    this.hearts = this.kind === 'quick' || this.kind === 'island';
    this.lives = this.hearts ? GAME_LIVES : 0;
    this.inventory = { ...(options.powerUps ?? { fifty: 0, auditor: 0, patch: 0 }) };
    this.now = options.now ?? Date.now;
    this.rng = options.rng ?? Math.random;
    this.deadline = this.kind === 'lightning' ? this.now() + LIGHTNING_SECONDS * 1000 : 0;
    if (island && items.length === 0) {
      this.practice = this.startBoss(island);
    } else {
      this.practice = new PracticeSession(items);
    }
  }

  /** Questions of the current phase. */
  get total(): number {
    return this.practice.total;
  }

  /** Hearts left (0 in the rounds without hearts). */
  get livesLeft(): number {
    return this.lives;
  }

  /** Hearts lost in this round (a Patch Tuesday does not undo it). */
  get heartsLost(): number {
    return this.livesLost;
  }

  get totalXp(): number {
    return this.xp;
  }

  get currentPhase(): GamePhase {
    return this.phase;
  }

  get bossState(): BossState | null {
    return this.boss && { ...this.boss };
  }

  get powerUps(): PowerUps {
    return { ...this.inventory };
  }

  /** The question to answer, or null once the round is over. */
  current(): QuestionView | null {
    return this.ended ? null : this.practice.current();
  }

  answer(questionId: string, response: number[]): GameAnswer {
    this.checkOpen();
    const question = this.practice.current() as QuestionView;
    return this.score(this.practice.answer(questionId, response), question);
  }

  /** The time limit of the question ran out: a wrong answer. */
  timeout(questionId: string): GameAnswer {
    this.checkOpen();
    const question = this.practice.current() as QuestionView;
    return this.score(this.practice.timeout(questionId), question);
  }

  /**
   * Uses a power-up on the open question: 50/50 takes two wrong options away; the Auditor takes one wrong option
   * away with the reason it is wrong (the first item of an ordering question); Patch Tuesday mends a heart. One
   * 50/50 or hint per question; none in the lightning round.
   */
  usePowerUp(id: PowerUpId, questionId: string): PowerUpEffect {
    this.checkOpen();
    if (!POWER_UP_IDS.includes(id)) throw new Error(`unknown power-up ${String(id)}`);
    if (this.kind === 'lightning') throw new Error('no power-ups in the lightning round');
    if (this.inventory[id] <= 0) throw new Error('none of this power-up left');
    const q = this.practice.currentQuestion(questionId);
    let removed: number[] = [];
    let hint: string | null = null;
    if (id === 'patch') {
      if (!this.hearts) throw new Error('this round has no hearts to mend');
      if (this.lives >= GAME_LIVES) throw new Error('your hearts are already full');
      this.lives++;
    } else {
      if (this.helped === questionId) throw new Error('one 50/50 or hint per question');
      const wrong = shuffled(q.options.map((_, i) => i).filter((i) => !q.answer.includes(i)), this.rng);
      if (id === 'fifty') {
        if (!fiftyFits({ type: q.type, options: q.options, selectCount: q.answer.length })) throw new Error('50/50 does not fit this question');
        removed = wrong.slice(0, 2).sort((a, b) => a - b);
      } else if (q.type === 'ordering') {
        hint = `“${q.options[q.answer[0]]}” comes first.`;
      } else {
        if (q.options.length - 1 <= q.answer.length) throw new Error('the Auditor has nothing to rule out here');
        const out = wrong[0];
        removed = [out];
        hint = `Not ${LETTERS[out]}. ${q.optionNotes?.[out] || 'Trust me, I audit things for a living.'}`;
      }
      this.helped = questionId;
    }
    this.inventory[id]--;
    return { id, removed, hint, lives: this.lives, powerUps: this.powerUps, unlocked: [] };
  }

  /** Ends the round: the lightning round when its time is up, otherwise early. */
  quit(): void {
    this.ended ??= this.kind === 'lightning' && this.now() >= this.deadline ? 'time' : 'quit';
  }

  summary(): GameSummary {
    return {
      kind: this.kind,
      answered: this.answered,
      correct: this.correct,
      total: this.earlierTotal + this.practice.total,
      xpEarned: this.xpEarned,
      bestCombo: this.bestCombo,
      end: this.ended ?? 'quit',
      level: levelInfo(this.xp),
      island: this.island?.domain ?? null,
      boss: this.bossState,
      review: structuredClone(this.review),
      best: 0,
      newBest: false,
      daily: null,
      unlocked: [],
    };
  }

  /** Refuses answers once the round is over, and in the lightning round once the time is up (with a little grace). */
  private checkOpen(): void {
    if (!this.ended && this.kind === 'lightning' && this.now() > this.deadline + LIGHTNING_GRACE_MS) this.ended = 'time';
    if (this.ended) throw new Error(this.ended === 'time' ? 'the time is up' : 'this game is over');
  }

  /**
   * The boss fight: its hit points leave one question per heart but the last, so that the fight always ends with
   * the boss beaten or the hearts gone (fewer hit points when the domain has too few questions).
   */
  private startBoss(island: IslandRound): PracticeSession {
    const session = new PracticeSession(island.boss);
    const max = Math.min(BOSS_HP, Math.max(1, island.boss.length - (this.lives - 1)));
    this.phase = 'boss';
    this.boss = { hp: max, max };
    return session;
  }

  private score(feedback: PracticeFeedback, question: QuestionView): GameAnswer {
    const before = levelInfo(this.xp);
    const phase = this.phase;
    this.answered++;
    let xpGained = 0;
    let bonusXp = 0;
    let multiplier = 1;
    let bossHit = false;
    let bossStarts = false;
    const earned: PowerUpId[] = [];
    if (feedback.correct) {
      this.correct++;
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      multiplier = comboMultiplier(this.combo);
      xpGained = BASE_XP[feedback.difficulty] * multiplier;
      if (this.boss) {
        this.boss.hp--;
        bossHit = true;
        if (this.boss.hp === 0) bonusXp = BOSS_BONUS_XP;
      }
      xpGained += bonusXp;
      this.xp += xpGained;
      this.xpEarned += xpGained;
      if (this.kind !== 'lightning') {
        if (this.combo % POWER_UP_COMBO === 0) earned.push(POWER_UP_IDS[(this.combo / POWER_UP_COMBO - 1) % POWER_UP_IDS.length]);
        if (bonusXp > 0) earned.push('patch');
      }
    } else {
      this.combo = 0;
      if (this.hearts) {
        this.lives--;
        this.livesLost++;
      }
    }
    if (this.kind === 'lightning') this.review.push({ question, feedback });
    const added = addPowerUps(this.inventory, earned);
    if (this.hearts && this.lives <= 0) this.ended = 'lives';
    else if (this.boss?.hp === 0) this.ended = 'victory';
    else if (feedback.finished && phase === 'boss') this.ended = 'lives';
    else if (feedback.finished && this.island) {
      this.earlierTotal += this.practice.total;
      this.practice = this.startBoss(this.island);
      bossStarts = true;
    } else if (feedback.finished) this.ended = 'cleared';
    const level = levelInfo(this.xp);
    return {
      feedback,
      xpGained,
      bonusXp,
      multiplier,
      combo: this.combo,
      lives: this.lives,
      level,
      levelUp: level.level > before.level,
      rankUp: level.rank !== before.rank,
      phase,
      boss: this.bossState,
      bossHit,
      bossStarts,
      next: this.current(),
      end: this.ended,
      earned: added,
      powerUps: this.powerUps,
      unlocked: [],
    };
  }
}
