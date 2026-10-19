import type {
  AchievementInfo,
  BossState,
  DailyReward,
  GameAnswer,
  GameEnd,
  GameKind,
  GamePhase,
  GameReviewItem,
  GameSettings,
  GameSummary,
  LevelInfo,
  PowerUpEffect,
  PowerUpId,
  PowerUps,
  WorldProgress,
} from '../engine/game';
import type { PracticeFeedback, PracticeItemState, PracticeSummary } from '../engine/practice';
import type { DifficultyFilter, PracticeOptions, PracticeSource, Profile, ProgressSummary } from '../engine/profile';
import type { DomainId, DomainReport, ExamResult, FinishReason, QuestionType, QuestionView, ReviewItem } from '../engine/types';

export type {
  AchievementInfo,
  BossState,
  DailyReward,
  GameAnswer,
  GameEnd,
  GameKind,
  GamePhase,
  GameReviewItem,
  GameSettings,
  GameSummary,
  LevelInfo,
  PowerUpEffect,
  PowerUpId,
  PowerUps,
  WorldProgress,
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
  /** Islands of the world map and where the cat stands. */
  world: WorldProgress;
  powerUps: PowerUps;
  /** Every achievement, unlocked or not, in badge order. */
  achievements: AchievementInfo[];
  daily: DailyStatus;
  lightningBest: number;
}

/** The daily challenge as its screen shows it: today, whether it is done, the streak and the recent days done. */
export interface DailyStatus {
  today: string;
  done: boolean;
  streak: number;
  bestStreak: number;
  /** Days done in the last five weeks (YYYY-MM-DD). */
  days: string[];
  /** What finishing today's challenge gives (or gave): bonus XP and power-ups. */
  reward: { xp: number; powerUps: PowerUpId[] };
}

export interface GameStart {
  question: QuestionView;
  kind: GameKind;
  /** Questions of the first phase (the stage, or the boss fight of a boss retry). */
  total: number;
  /** Hearts (0 in the daily challenge and the lightning round, which have none). */
  lives: number;
  secondsPerQuestion: number;
  /** Lightning round: its length in seconds (0 for the other kinds). */
  roundSeconds: number;
  level: LevelInfo;
  /** Island being played (null for the other kinds); `boss` is set when the round opens on the boss fight. */
  island: DomainId | null;
  phase: GamePhase;
  boss: BossState | null;
  powerUps: PowerUps;
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
  /** Starts a quick game round with questions chosen as for training. */
  startGame(options: PracticeOptions): Promise<GameStart>;
  /** Starts an island of the world map (its domain's questions, then its boss). */
  startIsland(domain: DomainId): Promise<GameStart>;
  /** Fights an island's boss again, once its stage has been won. */
  startBoss(domain: DomainId): Promise<GameStart>;
  /** Starts today's daily challenge (refused once it is done for the day). */
  startDaily(): Promise<GameStart>;
  /** Starts a 60-second lightning round. */
  startLightning(): Promise<GameStart>;
  answerGame(questionId: string, response: number[]): Promise<GameAnswer>;
  /** The time limit of the current game question ran out (a wrong answer). */
  timeoutGame(questionId: string): Promise<GameAnswer>;
  /** Uses a power-up from the inventory on the open game question. */
  usePowerUp(id: PowerUpId, questionId: string): Promise<PowerUpEffect>;
  /** Ends the round if it is still running and returns its summary. */
  gameSummary(): Promise<GameSummary>;
  /** Saves the game's sound, music and effect settings (invalid fields fall back to defaults); returns what was saved. */
  saveGameSettings(settings: GameSettings): Promise<GameSettings>;
  quit(): Promise<void>;
}
