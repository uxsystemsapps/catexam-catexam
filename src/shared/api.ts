import type { GameAnswer, GameEnd, GameSettings, GameSummary, LevelInfo } from '../engine/game';
import type { PracticeFeedback, PracticeItemState, PracticeSummary } from '../engine/practice';
import type { DifficultyFilter, PracticeOptions, PracticeSource, Profile, ProgressSummary } from '../engine/profile';
import type { DomainId, DomainReport, ExamResult, FinishReason, QuestionType, QuestionView, ReviewItem } from '../engine/types';

export type {
  GameAnswer,
  GameEnd,
  GameSettings,
  GameSummary,
  LevelInfo,
  PracticeFeedback,
  PracticeItemState,
  PracticeSummary,
  PracticeOptions,
  Profile,
  ProgressSummary,
  DomainId,
  DomainReport,
  ExamResult,
  QuestionType,
  QuestionView,
  ReviewItem,
};

export interface HistoryEntry {
  date: string;
  candidate: string;
  passed: boolean;
  reason: FinishReason;
  scaledScore: number;
  itemsAnswered: number;
  elapsedSeconds: number;
  domains: DomainReport[];
  /** Every answered question was saved with the entry, so it can be reviewed (not for exams of older versions). */
  hasReview?: boolean;
}

/** One finished training session. */
export interface TrainingEntry {
  date: string;
  answered: number;
  correct: number;
  timedOut: number;
  difficulty: DifficultyFilter;
  source: PracticeSource;
  byDomain: { domain: DomainId; answered: number; correct: number }[];
}

export type HistoryKind = 'exam' | 'training';

/** A training session paused to be resumed later, as listed on the paused sessions page. */
export interface PausedTraining {
  id: string;
  /** When the session was started and when it was last paused (ISO). */
  startedAt: string;
  pausedAt: string;
  total: number;
  answered: number;
  correct: number;
  options: PracticeOptions;
}

/** A bank the user imported into the profile folder. */
export interface ImportedBank {
  file: string;
  name: string;
  questions: number;
}

/** Outcome of one file of a folder import. */
export interface BankImportFile {
  file: string;
  /** `skipped`: a bank with the same name is already loaded. */
  status: 'added' | 'skipped' | 'failed';
  /** Bank name from the file, or empty when it has none. */
  bank: string;
  questions: number;
  /** Validator errors of a failed file. */
  errors: string[];
}

export interface BankImportSummary {
  folder: string;
  files: BankImportFile[];
  /** Files and questions actually added. */
  added: number;
  questions: number;
  /** Set when the folder itself could not be read. */
  error?: string;
}

export interface AppInfo {
  version: string;
  /** `mobile`: the Android app (touch screen, no folders, no window to lock). */
  platform: 'desktop' | 'mobile';
  bank: { total: number; byDomain: { domain: DomainId; name: string; weight: number; count: number }[] };
  bankErrors: string[];
  importedBanks: ImportedBank[];
  displays: number;
  history: HistoryEntry[];
  trainingHistory: TrainingEntry[];
  /** Paused training sessions, last paused first. */
  paused: PausedTraining[];
  profile: Profile;
  progress: ProgressSummary;
  game: GameStatus;
}

/** The player's game progress, as the game screens show it. */
export interface GameStatus {
  level: LevelInfo;
  bestCombo: number;
  games: number;
  settings: GameSettings;
}

export interface GameStart {
  question: QuestionView;
  total: number;
  lives: number;
  secondsPerQuestion: number;
  level: LevelInfo;
}

export interface ExamState {
  question: QuestionView | null;
  /** Epoch ms when the exam started and when its time runs out (the main process enforces it). */
  startedAt: number;
  deadline: number;
  /** Item limits of the exam rules, for the progress bar. */
  minItems: number;
  maxItems: number;
  finished: boolean;
}

export interface PracticeStart {
  question: QuestionView;
  /** Set when a resumed session opens on a question that was already answered. */
  feedback: PracticeFeedback | null;
  total: number;
  secondsPerQuestion: number;
  /** Bookmarked question ids, so the screen can show the bookmark state of each question. */
  bookmarks: string[];
  /** Question ids and states, in order, for the question navigator. */
  ids: string[];
  states: PracticeItemState[];
}

/** After an answer or a time-out: the feedback and the state of every question (`feedback.finished` once all are answered). */
export interface PracticeAnswer {
  feedback: PracticeFeedback;
  states: PracticeItemState[];
}

/** A question opened by Skip, Back or the navigator; `feedback` is set when it was already answered. */
export interface PracticeVisit {
  question: QuestionView;
  feedback: PracticeFeedback | null;
  states: PracticeItemState[];
}

/** Exposed by the preload script as `window.examApi`. */
export interface ExamApi {
  info(): Promise<AppInfo>;
  /** Lets the user pick a folder (desktop) or bank files (Android) and imports every bank file; null when the picker was cancelled. */
  importBanks(): Promise<BankImportSummary | null>;
  /** Deletes an imported bank (by its file name in `importedBanks`) and reloads the questions. */
  removeBank(file: string): Promise<void>;
  /** Saves the profile (invalid fields fall back to defaults) and applies the text size; returns what was saved. */
  saveProfile(profile: Profile): Promise<Profile>;
  /** Deletes history entries by date, or the whole history of that kind when `dates` is null. */
  deleteHistory(kind: HistoryKind, dates: string[] | null): Promise<void>;
  /** Every answered question of a past exam (by its history date), with the correct answers and explanations. */
  examReview(date: string): Promise<ReviewItem[]>;
  /** Forgets training progress: per-question results, bookmarks and daily counts. */
  resetProgress(): Promise<void>;
  /** Enters the locked exam environment (before the NDA and tutorial screens). */
  lock(): Promise<void>;
  /** Leaves the locked environment when the candidate declines the NDA. */
  unlock(): Promise<void>;
  startExam(candidate: string): Promise<ExamState>;
  answer(questionId: string, response: number[]): Promise<ExamState>;
  takeBreak(): Promise<void>;
  endExam(): Promise<void>;
  /** Result of the finished exam; also leaves the locked environment. */
  result(): Promise<ExamResult>;
  onTimeout(callback: () => void): void;
  onIncident(callback: (message: string) => void): void;
  /** Android back button: `callback` returns whether the screen handled it; otherwise the app goes to the background. Never fires on the desktop. */
  onBack(callback: () => boolean): void;
  startPractice(options: PracticeOptions): Promise<PracticeStart>;
  answerPractice(questionId: string, response: number[]): Promise<PracticeAnswer>;
  /** The time limit of the current training question ran out. */
  timeoutPractice(questionId: string): Promise<PracticeAnswer>;
  /** Leaves the current training question unanswered and opens the next unanswered one. */
  skipPractice(questionId: string): Promise<PracticeVisit>;
  /** Opens training question `number` (1-based), answered or not. */
  gotoPractice(number: number): Promise<PracticeVisit>;
  /** Returns whether the question is now bookmarked. */
  toggleBookmark(questionId: string): Promise<boolean>;
  /** Summary of the training session; the first call also saves it to the training history. */
  practiceSummary(): Promise<PracticeSummary>;
  /** Saves the training session as it stands, to be resumed later from the paused sessions page. */
  pausePractice(): Promise<void>;
  /** Continues a paused training session where it was left. */
  resumePractice(id: string): Promise<PracticeStart>;
  /** Forgets a paused training session. */
  deletePaused(id: string): Promise<void>;
  /** Starts a game round with questions chosen as for training. */
  startGame(options: PracticeOptions): Promise<GameStart>;
  answerGame(questionId: string, response: number[]): Promise<GameAnswer>;
  /** The time limit of the current game question ran out (a wrong answer). */
  timeoutGame(questionId: string): Promise<GameAnswer>;
  /** Ends the round if it is still running and returns its summary. */
  gameSummary(): Promise<GameSummary>;
  /** Saves the game's sound and effect settings (invalid fields fall back to defaults); returns what was saved. */
  saveGameSettings(settings: GameSettings): Promise<GameSettings>;
  quit(): Promise<void>;
}
