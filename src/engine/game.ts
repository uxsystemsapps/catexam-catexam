import { PracticeSession, type PracticeFeedback } from './practice';
import type { Difficulty } from './profile';
import type { Question, QuestionView } from './types';

/**
 * Game mode, stage 1: training questions played as an arcade round. Right answers earn XP (more for harder
 * questions) and build a combo that multiplies it; wrong answers break a heart; the round ends when the hearts
 * or the questions run out. XP, the best combo and the game settings are kept between sessions (`game.json`).
 * Later stages (world map, bosses, power-ups, achievements, daily challenge, lightning round) build on
 * `GameRun` and `GameProgress`.
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
  /** Fewer effects (no particles, shake or bouncing), for slower phones or by taste. */
  lite: boolean;
}

/** What the game keeps between sessions. */
export interface GameProgress {
  xp: number;
  bestCombo: number;
  /** Rounds started. */
  games: number;
  settings: GameSettings;
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

/** Why a round ended: no hearts left, every question answered, or the player quit. */
export type GameEnd = 'lives' | 'cleared' | 'quit';

/** After an answer: XP, combo, hearts, level, and the next question (null once the round is over). */
export interface GameAnswer {
  feedback: PracticeFeedback;
  xpGained: number;
  /** Multiplier applied to this answer (1 outside a frenzy). */
  multiplier: number;
  /** Right answers in a row, this one included (0 after a wrong answer). */
  combo: number;
  lives: number;
  level: LevelInfo;
  /** This answer reached a new level (and `rankUp`: a new rank). */
  levelUp: boolean;
  rankUp: boolean;
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
}

export function defaultGameProgress(platform: 'desktop' | 'mobile'): GameProgress {
  // Sound starts off on phones (people play in public); on the desktop it starts on.
  return { xp: 0, bestCombo: 0, games: 0, settings: { sound: platform !== 'mobile', volume: 70, lite: false } };
}

function obj(raw: unknown): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function count(value: unknown, max = Number.MAX_SAFE_INTEGER): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(0, Math.round(value))) : undefined;
}

export function normalizeGameSettings(raw: unknown, platform: 'desktop' | 'mobile'): GameSettings {
  const r = obj(raw);
  const d = defaultGameProgress(platform).settings;
  return {
    sound: typeof r.sound === 'boolean' ? r.sound : d.sound,
    volume: count(r.volume, 100) ?? d.volume,
    lite: typeof r.lite === 'boolean' ? r.lite : d.lite,
  };
}

/** Untrusted `game.json` with defaults for anything missing or invalid. */
export function normalizeGameProgress(raw: unknown, platform: 'desktop' | 'mobile'): GameProgress {
  const r = obj(raw);
  return {
    xp: count(r.xp) ?? 0,
    bestCombo: count(r.bestCombo) ?? 0,
    games: count(r.games) ?? 0,
    settings: normalizeGameSettings(r.settings, platform),
  };
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

/** One round of the game over a fixed list of questions. */
export class GameRun {
  private readonly practice: PracticeSession;
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
  ) {
    this.practice = new PracticeSession(items);
  }

  get total(): number {
    return this.practice.total;
  }

  get livesLeft(): number {
    return this.lives;
  }

  get totalXp(): number {
    return this.xp;
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
      total: this.total,
      xpEarned: this.xpEarned,
      bestCombo: this.bestCombo,
      end: this.ended ?? 'quit',
      level: levelInfo(this.xp),
    };
  }

  private score(feedback: PracticeFeedback): GameAnswer {
    const before = levelInfo(this.xp);
    this.answered++;
    let xpGained = 0;
    let multiplier = 1;
    if (feedback.correct) {
      this.correct++;
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      multiplier = comboMultiplier(this.combo);
      xpGained = BASE_XP[feedback.difficulty] * multiplier;
      this.xp += xpGained;
      this.xpEarned += xpGained;
    } else {
      this.combo = 0;
      this.lives--;
    }
    if (this.lives <= 0) this.ended = 'lives';
    else if (feedback.finished) this.ended = 'cleared';
    const level = levelInfo(this.xp);
    return {
      feedback,
      xpGained,
      multiplier,
      combo: this.combo,
      lives: this.lives,
      level,
      levelUp: level.level > before.level,
      rankUp: level.rank !== before.rank,
      next: this.current(),
      end: this.ended,
    };
  }
}
