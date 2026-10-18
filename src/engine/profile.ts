import { DOMAIN_IDS } from './domains';
import type { DomainId, Question, QuestionType } from './types';

/** Difficulty bands of training mode, in logits around the passing standard (0). */
export type Difficulty = 'easy' | 'medium' | 'hard';
export type DifficultyFilter = 'mixed' | Difficulty;
/** Which questions come first: any, never-answered ones, or ones last answered wrong. */
export type PracticeOrder = 'random' | 'unseen-first' | 'missed-first';
/** Pool of a training session: the whole bank, only questions last answered wrong, or bookmarks. */
export type PracticeSource = 'all' | 'missed' | 'bookmarked';

const QUESTION_TYPES: readonly QuestionType[] = ['single', 'multi', 'ordering'];
const DIFFICULTIES: readonly DifficultyFilter[] = ['mixed', 'easy', 'medium', 'hard'];
const ORDERS: readonly PracticeOrder[] = ['random', 'unseen-first', 'missed-first'];
const SOURCES: readonly PracticeSource[] = ['all', 'missed', 'bookmarked'];
const THEMES = ['light', 'dark'] as const;
const TEXT_SIZES = ['normal', 'large', 'larger'] as const;

export const MAX_PRACTICE_COUNT = 200;
export const MAX_SECONDS_PER_QUESTION = 600;
/** A domain needs this many training answers before it can be named the weakest. */
export const WEAK_DOMAIN_MIN_ANSWERS = 5;

export interface PracticeOptions {
  domains: DomainId[];
  count: number;
  difficulty: DifficultyFilter;
  types: QuestionType[];
  order: PracticeOrder;
  source: PracticeSource;
  /** Time limit per training question in seconds; 0 means no timer. */
  secondsPerQuestion: number;
}

export interface Profile {
  name: string;
  /** Planned exam date as YYYY-MM-DD, or '' when not set. */
  examDate: string;
  /** Training questions per day the student aims for; 0 hides the goal. */
  dailyGoal: number;
  theme: (typeof THEMES)[number];
  textSize: (typeof TEXT_SIZES)[number];
  /** Defaults of the training form on the home screen. */
  training: PracticeOptions;
}

export interface QuestionStat {
  seen: number;
  correct: number;
  lastCorrect: boolean;
  lastSeen: string;
}

/** What the student has done in training: per-question results, bookmarks and answers per day. */
export interface Progress {
  questions: Record<string, QuestionStat>;
  bookmarks: string[];
  /** Training answers per local day (YYYY-MM-DD). */
  daily: Record<string, number>;
}

export interface DomainProgress {
  domain: DomainId;
  /** Distinct questions of the bank answered at least once in training. */
  seen: number;
  total: number;
  answered: number;
  correct: number;
}

export interface ProgressSummary {
  seen: number;
  total: number;
  missed: number;
  bookmarks: string[];
  today: number;
  byDomain: DomainProgress[];
  /** Lowest accuracy among domains with enough answers, or null. */
  weakestDomain: DomainId | null;
}

export const DEFAULT_PROFILE: Profile = {
  name: '',
  examDate: '',
  dailyGoal: 0,
  theme: 'light',
  textSize: 'normal',
  training: {
    domains: [...DOMAIN_IDS],
    count: 20,
    difficulty: 'mixed',
    types: [...QUESTION_TYPES],
    order: 'random',
    source: 'all',
    secondsPerQuestion: 0,
  },
};

export function difficultyOf(logits: number): Difficulty {
  if (logits < -0.5) return 'easy';
  if (logits > 0.5) return 'hard';
  return 'medium';
}

function obj(raw: unknown): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function pick<T>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function int(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

function subset<T>(allowed: readonly T[], value: unknown, fallback: readonly T[]): T[] {
  if (!Array.isArray(value)) return [...fallback];
  const out = allowed.filter((a) => value.includes(a));
  return out.length > 0 ? out : [...fallback];
}

/** Untrusted practice options (from the screen or a saved profile) with every field made valid. */
export function normalizePracticeOptions(raw: unknown): PracticeOptions {
  const r = obj(raw);
  const d = DEFAULT_PROFILE.training;
  return {
    domains: subset(DOMAIN_IDS, r.domains, d.domains),
    count: int(r.count, 1, MAX_PRACTICE_COUNT, d.count),
    difficulty: pick(DIFFICULTIES, r.difficulty, d.difficulty),
    types: subset(QUESTION_TYPES, r.types, d.types),
    order: pick(ORDERS, r.order, d.order),
    source: pick(SOURCES, r.source, d.source),
    secondsPerQuestion: int(r.secondsPerQuestion, 0, MAX_SECONDS_PER_QUESTION, d.secondsPerQuestion),
  };
}

/** Untrusted profile (file or screen) with defaults for anything missing or invalid. */
export function normalizeProfile(raw: unknown): Profile {
  const r = obj(raw);
  const examDate = typeof r.examDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.examDate) && !Number.isNaN(Date.parse(r.examDate)) ? r.examDate : '';
  return {
    name: typeof r.name === 'string' ? r.name.trim().slice(0, 80) : '',
    examDate,
    dailyGoal: int(r.dailyGoal, 0, 500, DEFAULT_PROFILE.dailyGoal),
    theme: pick(THEMES, r.theme, DEFAULT_PROFILE.theme),
    textSize: pick(TEXT_SIZES, r.textSize, DEFAULT_PROFILE.textSize),
    training: normalizePracticeOptions(r.training),
  };
}

export function normalizeProgress(raw: unknown): Progress {
  const r = obj(raw);
  const questions: Record<string, QuestionStat> = {};
  for (const [id, v] of Object.entries(obj(r.questions))) {
    const s = obj(v);
    const seen = int(s.seen, 0, Number.MAX_SAFE_INTEGER, 0);
    if (seen === 0) continue;
    questions[id] = {
      seen,
      correct: int(s.correct, 0, seen, 0),
      lastCorrect: s.lastCorrect === true,
      lastSeen: typeof s.lastSeen === 'string' ? s.lastSeen : '',
    };
  }
  const daily: Record<string, number> = {};
  for (const [day, n] of Object.entries(obj(r.daily))) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) daily[day] = int(n, 0, Number.MAX_SAFE_INTEGER, 0);
  }
  const bookmarks = Array.isArray(r.bookmarks) ? [...new Set(r.bookmarks.filter((b): b is string => typeof b === 'string'))] : [];
  return { questions, bookmarks, daily };
}

/** Records one training answer; `day` is the student's local date (YYYY-MM-DD). */
export function recordAnswer(progress: Progress, questionId: string, correct: boolean, day: string, at: string): void {
  const s = progress.questions[questionId] ?? { seen: 0, correct: 0, lastCorrect: false, lastSeen: '' };
  progress.questions[questionId] = { seen: s.seen + 1, correct: s.correct + (correct ? 1 : 0), lastCorrect: correct, lastSeen: at };
  progress.daily[day] = (progress.daily[day] ?? 0) + 1;
}

/** Adds or removes a bookmark; returns whether the question is now bookmarked. */
export function toggleBookmark(progress: Progress, questionId: string): boolean {
  const i = progress.bookmarks.indexOf(questionId);
  if (i >= 0) {
    progress.bookmarks.splice(i, 1);
    return false;
  }
  progress.bookmarks.push(questionId);
  return true;
}

/** Questions of a training session, per the options and what the student has done so far. */
export function selectPracticeItems(
  bank: readonly Question[],
  options: PracticeOptions,
  progress: Progress,
  rng: () => number = Math.random,
): Question[] {
  const bookmarks = new Set(progress.bookmarks);
  const pool = bank.filter((q) => {
    const stat = progress.questions[q.id];
    return (
      options.domains.includes(q.domain) &&
      options.types.includes(q.type) &&
      (options.difficulty === 'mixed' || difficultyOf(q.difficulty) === options.difficulty) &&
      (options.source !== 'missed' || (stat !== undefined && !stat.lastCorrect)) &&
      (options.source !== 'bookmarked' || bookmarks.has(q.id))
    );
  });
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  // Stable sort after the shuffle: the chosen group first, random within each group.
  const rank = (q: Question): number => {
    const stat = progress.questions[q.id];
    if (options.order === 'unseen-first') return stat ? 1 : 0;
    if (options.order === 'missed-first') return stat && !stat.lastCorrect ? 0 : stat ? 2 : 1;
    return 0;
  };
  pool.sort((a, b) => rank(a) - rank(b));
  return pool.slice(0, options.count);
}

export function summarizeProgress(bank: readonly Question[], progress: Progress, day: string): ProgressSummary {
  const byDomain: DomainProgress[] = DOMAIN_IDS.map((domain) => ({ domain, seen: 0, total: 0, answered: 0, correct: 0 }));
  let seen = 0;
  let missed = 0;
  for (const q of bank) {
    const d = byDomain[q.domain - 1];
    d.total++;
    const s = progress.questions[q.id];
    if (!s) continue;
    seen++;
    if (!s.lastCorrect) missed++;
    d.seen++;
    d.answered += s.seen;
    d.correct += s.correct;
  }
  let weakestDomain: DomainId | null = null;
  let weakest = Infinity;
  for (const d of byDomain) {
    if (d.answered < WEAK_DOMAIN_MIN_ANSWERS) continue;
    const accuracy = d.correct / d.answered;
    if (accuracy < weakest) {
      weakest = accuracy;
      weakestDomain = d.domain;
    }
  }
  const ids = new Set(bank.map((q) => q.id));
  return {
    seen,
    total: bank.length,
    missed,
    bookmarks: progress.bookmarks.filter((b) => ids.has(b)),
    today: progress.daily[day] ?? 0,
    byDomain,
    weakestDomain,
  };
}
