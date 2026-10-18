import type { PracticeFeedback, PracticeSummary } from '../engine/practice';
import type { DifficultyFilter, PracticeOptions, PracticeSource, Profile, ProgressSummary } from '../engine/profile';
import type { DomainId, DomainReport, ExamResult, FinishReason, QuestionType, QuestionView } from '../engine/types';

export type {
  PracticeFeedback,
  PracticeSummary,
  PracticeOptions,
  Profile,
  ProgressSummary,
  DomainId,
  DomainReport,
  ExamResult,
  QuestionType,
  QuestionView,
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
  bank: { total: number; byDomain: { domain: DomainId; name: string; weight: number; count: number }[] };
  bankErrors: string[];
  importedBanks: ImportedBank[];
  displays: number;
  history: HistoryEntry[];
  trainingHistory: TrainingEntry[];
  profile: Profile;
  progress: ProgressSummary;
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
  total: number;
  secondsPerQuestion: number;
  /** Bookmarked question ids, so the screen can show the bookmark state of each question. */
  bookmarks: string[];
}

/** Exposed by the preload script as `window.examApi`. */
export interface ExamApi {
  info(): Promise<AppInfo>;
  /** Lets the user pick a folder and imports every bank file in it; null when the picker was cancelled. */
  importBanks(): Promise<BankImportSummary | null>;
  /** Deletes an imported bank (by its file name in `importedBanks`) and reloads the questions. */
  removeBank(file: string): Promise<void>;
  /** Saves the profile (invalid fields fall back to defaults) and applies the text size; returns what was saved. */
  saveProfile(profile: Profile): Promise<Profile>;
  /** Deletes history entries by date, or the whole history of that kind when `dates` is null. */
  deleteHistory(kind: HistoryKind, dates: string[] | null): Promise<void>;
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
  startPractice(options: PracticeOptions): Promise<PracticeStart>;
  answerPractice(questionId: string, response: number[]): Promise<{ feedback: PracticeFeedback; next: QuestionView | null }>;
  /** The time limit of the current training question ran out. */
  timeoutPractice(questionId: string): Promise<{ feedback: PracticeFeedback; next: QuestionView | null }>;
  /** Returns whether the question is now bookmarked. */
  toggleBookmark(questionId: string): Promise<boolean>;
  /** Summary of the training session; the first call also saves it to the training history. */
  practiceSummary(): Promise<PracticeSummary>;
  quit(): Promise<void>;
}
