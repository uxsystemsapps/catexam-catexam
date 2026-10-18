import type { PracticeFeedback, PracticeSummary } from '../engine/practice';
import type { DomainId, DomainReport, ExamResult, FinishReason, QuestionView } from '../engine/types';

export type { PracticeFeedback, PracticeSummary, DomainId, DomainReport, ExamResult, QuestionView };

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

export interface AppInfo {
  version: string;
  bank: { total: number; byDomain: { domain: DomainId; name: string; weight: number; count: number }[] };
  bankErrors: string[];
  importedBanks: string[];
  displays: number;
  history: HistoryEntry[];
}

export interface ExamState {
  question: QuestionView | null;
  /** Epoch ms when the exam time runs out (the main process enforces it). */
  deadline: number;
  finished: boolean;
}

/** Exposed by the preload script as `window.examApi`. */
export interface ExamApi {
  info(): Promise<AppInfo>;
  importBank(): Promise<{ imported: string | null; errors: string[] }>;
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
  startPractice(domains: DomainId[], count: number): Promise<{ question: QuestionView; total: number }>;
  answerPractice(questionId: string, response: number[]): Promise<{ feedback: PracticeFeedback; next: QuestionView | null }>;
  practiceSummary(): Promise<PracticeSummary>;
  quit(): Promise<void>;
}
