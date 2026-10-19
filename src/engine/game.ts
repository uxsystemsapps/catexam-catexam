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
 * costs a heart. Beating the boss clears the island (kept in `GameProgress.world`). Later stages (power-ups,
 * achievements, daily challenge, lightning round) build on `GameRun` and `GameProgress`.
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
/** Questions kept for a boss fight: one per hit point, and one more per heart but the last, so a fight always ends with a winner. */
export const BOSS_QUESTIONS = BOSS_HP + GAME_LIVES - 1;
/** XP for beating a boss, on top of the XP of the answers. */
export const BOSS_BONUS_XP = 100;

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

/** What the game keeps between sessions. */
export interface GameProgress {
  xp: number;
  bestCombo: number;
  /** Rounds started (quick rounds, islands and boss fights). */
  games: number;
  settings: GameSettings;
  world: WorldProgress;
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
 * a full fight), every question answered (quick round), the boss beaten (island), or the player quit.
 */
export type GameEnd = 'lives' | 'cleared' | 'victory' | 'quit';

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
}

export interface GameSummary {
  answered: number;
  correct: number;
  total: number;
  xpEarned: number;
  bestCombo: number;
  end: GameEnd;
  level: LevelInfo;
  /** Island of the round (null for a quick round), and its boss when the fight was reached. */
  island: DomainId | null;
  boss: BossState | null;
}

export function defaultGameProgress(platform: 'desktop' | 'mobile'): GameProgress {
  // Sound and music start off on phones (people play in public); on the desktop they start on.
  const desktop = platform !== 'mobile';
  const islands = DOMAIN_IDS.map((domain) => ({ domain, cleared: false, bossReached: false, victories: 0 }));
  return { xp: 0, bestCombo: 0, games: 0, settings: { sound: desktop, volume: 70, music: desktop, musicVolume: 50, lite: false }, world: { at: 1, islands } };
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

/** Untrusted `game.json` with defaults for anything missing or invalid. */
export function normalizeGameProgress(raw: unknown, platform: 'desktop' | 'mobile'): GameProgress {
  const r = obj(raw);
  return {
    xp: count(r.xp) ?? 0,
    bestCombo: count(r.bestCombo) ?? 0,
    games: count(r.games) ?? 0,
    settings: normalizeGameSettings(r.settings, platform),
    world: normalizeWorld(r.world),
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

/**
 * One round of the game over a fixed list of questions. With an `island`, winning the stage (every question
 * answered with hearts left) starts the boss fight, with the hearts that are left; with no stage questions the
 * round is the boss fight alone (a retry).
 */
export class GameRun {
  private practice: PracticeSession;
  private phase: GamePhase = 'stage';
  private boss: BossState | null = null;
  /** Questions of the phases already finished, for the summary. */
  private earlierTotal = 0;
  private lives = GAME_LIVES;
  private combo = 0;
  private bestCombo = 0;
  private xpEarned = 0;
  private answered = 0;
  private correct = 0;
  private ended: GameEnd | null = null;

  /** `xp`: the player's total XP before the round. */
  constructor(
    items: readonly Question[],
    private xp: number,
    private readonly island: IslandRound | null = null,
  ) {
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

  get livesLeft(): number {
    return this.lives;
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

  /** The question to answer, or null once the round is over. */
  current(): QuestionView | null {
    return this.ended ? null : this.practice.current();
  }

  answer(questionId: string, response: number[]): GameAnswer {
    if (this.ended) throw new Error('this game is over');
    return this.score(this.practice.answer(questionId, response));
  }

  /** The time limit of the question ran out: a wrong answer. */
  timeout(questionId: string): GameAnswer {
    if (this.ended) throw new Error('this game is over');
    return this.score(this.practice.timeout(questionId));
  }

  /** Ends the round early. */
  quit(): void {
    this.ended ??= 'quit';
  }

  summary(): GameSummary {
    return {
      answered: this.answered,
      correct: this.correct,
      total: this.earlierTotal + this.practice.total,
      xpEarned: this.xpEarned,
      bestCombo: this.bestCombo,
      end: this.ended ?? 'quit',
      level: levelInfo(this.xp),
      island: this.island?.domain ?? null,
      boss: this.bossState,
    };
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

  private score(feedback: PracticeFeedback): GameAnswer {
    const before = levelInfo(this.xp);
    const phase = this.phase;
    this.answered++;
    let xpGained = 0;
    let bonusXp = 0;
    let multiplier = 1;
    let bossHit = false;
    let bossStarts = false;
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
    } else {
      this.combo = 0;
      this.lives--;
    }
    if (this.lives <= 0) this.ended = 'lives';
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
    };
  }
}
