import { DOMAINS } from '../engine/domains';
import { PracticeSession, type PracticeFeedback } from '../engine/practice';
import {
  normalizePracticeOptions,
  normalizeProfile,
  recordAnswer,
  selectPracticeItems,
  summarizeProgress,
  toggleBookmark,
  type PracticeOptions,
  type Profile,
  type Progress,
} from '../engine/profile';
import { ExamSession } from '../engine/session';
import type { ExamResult, Question } from '../engine/types';
import type {
  AppInfo,
  BankImportSummary,
  ExamState,
  ImportedBank,
  PracticeAnswer,
  PracticeStart,
  PracticeSummary,
  PracticeVisit,
} from '../shared/api';
import {
  appendHistory,
  appendTrainingHistory,
  deleteHistory,
  importBanks,
  loadQuestions,
  readHistory,
  readProfile,
  readProgress,
  readTrainingHistory,
  removeBank,
  saveProfile,
  saveProgress,
  type DataDir,
  type ImportFile,
} from './store';

/** What the desktop app (src/main) and the Android app (src/mobile) provide to the service. */
export interface ServiceHost {
  version: string;
  platform: AppInfo['platform'];
  /** The user's profile folder. */
  data: DataDir;
  /** The shipped question banks. */
  builtin: DataDir;
  /** Number of connected displays. */
  displays(): number;
  /** The exam time ran out. */
  onTimeout(): void;
}

/** Local calendar day (YYYY-MM-DD) for the daily training goal. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The application behind the screens: question banks, profile, history, the exam and training sessions.
 * The same code runs in the desktop main process and inside the Android app.
 */
export class CatexamService {
  private questions: Question[] = [];
  private imported: ImportedBank[] = [];
  private bankErrors: string[] = [];
  private exam: ExamSession | null = null;
  private candidate = '';
  private examTimer: ReturnType<typeof setTimeout> | undefined;
  private practice: PracticeSession | null = null;
  private practiceOptions: PracticeOptions | null = null;
  private practiceSaved = false;
  private progressWrite: Promise<void> = Promise.resolve();

  private constructor(
    private readonly host: ServiceHost,
    private profile: Profile,
    private progress: Progress,
  ) {}

  static async open(host: ServiceHost): Promise<CatexamService> {
    const service = new CatexamService(host, await readProfile(host.data), await readProgress(host.data));
    await service.reloadBank();
    return service;
  }

  get currentProfile(): Profile {
    return this.profile;
  }

  /** An exam is running (started and not finished). */
  get examActive(): boolean {
    return this.exam !== null && !this.exam.isFinished;
  }

  private async reloadBank(): Promise<void> {
    const loaded = await loadQuestions(this.host.builtin, this.host.data);
    this.questions = loaded.questions;
    this.imported = loaded.imported;
    this.bankErrors = loaded.errors;
  }

  /** Progress is saved after every training answer; writes are chained so they never overlap. */
  private persistProgress(): Promise<void> {
    this.progressWrite = this.progressWrite.then(() => saveProgress(this.host.data, this.progress)).catch((err: unknown) => console.error(err));
    return this.progressWrite;
  }

  async info(): Promise<AppInfo> {
    const { questions } = this;
    return {
      version: this.host.version,
      platform: this.host.platform,
      bank: {
        total: questions.length,
        byDomain: DOMAINS.map((d) => ({ domain: d.id, name: d.name, weight: d.weight, count: questions.filter((q) => q.domain === d.id).length })),
      },
      bankErrors: this.bankErrors,
      importedBanks: this.imported,
      displays: this.host.displays(),
      history: await readHistory(this.host.data),
      trainingHistory: await readTrainingHistory(this.host.data),
      profile: this.profile,
      progress: summarizeProgress(questions, this.progress, today()),
    };
  }

  async saveProfile(raw: unknown): Promise<Profile> {
    this.profile = normalizeProfile(raw);
    await saveProfile(this.host.data, this.profile);
    return this.profile;
  }

  deleteHistory(kind: unknown, dates: unknown): Promise<void> {
    if (kind !== 'exam' && kind !== 'training') throw new Error('unknown history');
    const list = Array.isArray(dates) ? dates.filter((d): d is string => typeof d === 'string') : null;
    return deleteHistory(this.host.data, kind, list);
  }

  resetProgress(): Promise<void> {
    this.progress = { questions: {}, bookmarks: [], daily: {} };
    return this.persistProgress();
  }

  async importBanks(source: string, files: () => Promise<ImportFile[]>): Promise<BankImportSummary> {
    const summary = await importBanks(source, files, this.host.builtin, this.host.data);
    if (summary.added > 0) await this.reloadBank();
    return summary;
  }

  async removeBank(file: unknown): Promise<void> {
    if (typeof file !== 'string' || !this.imported.some((b) => b.file === file)) throw new Error('not an imported bank');
    await removeBank(file, this.host.data);
    await this.reloadBank();
  }

  private examState(): ExamState {
    if (!this.exam) throw new Error('no exam in progress');
    const question = this.exam.current();
    return {
      question,
      startedAt: this.exam.startedAt,
      deadline: this.exam.deadline,
      minItems: this.exam.config.minItems,
      maxItems: this.exam.config.maxItems,
      finished: question === null,
    };
  }

  startExam(name: unknown): ExamState {
    if (this.examActive) throw new Error('an exam is already in progress');
    this.candidate = String(name ?? '').slice(0, 80);
    const exam = new ExamSession(this.questions);
    this.exam = exam;
    clearTimeout(this.examTimer);
    this.examTimer = setTimeout(() => {
      if (exam.checkTime()) this.host.onTimeout();
    }, Math.max(0, exam.deadline - Date.now()) + 100);
    return this.examState();
  }

  answer(questionId: string, response: number[]): ExamState {
    if (!this.exam) throw new Error('no exam in progress');
    this.exam.answer(questionId, response);
    return this.examState();
  }

  takeBreak(): void {
    this.exam?.recordBreak();
  }

  endExam(): void {
    this.exam?.endByCandidate();
  }

  /** Records an incident of the running exam; false when no exam is running. */
  recordIncident(kind: string, detail: string): boolean {
    if (!this.exam || this.exam.isFinished) return false;
    this.exam.recordIncident(kind, detail);
    return true;
  }

  async result(): Promise<ExamResult> {
    if (!this.exam) throw new Error('no exam in progress');
    this.exam.checkTime();
    const result = this.exam.result();
    clearTimeout(this.examTimer);
    this.examTimer = undefined;
    await appendHistory(this.host.data, {
      date: new Date().toISOString(),
      candidate: this.candidate,
      passed: result.passed,
      reason: result.reason,
      scaledScore: result.scaledScore,
      itemsAnswered: result.itemsAnswered,
      elapsedSeconds: result.elapsedSeconds,
      domains: result.domains,
    });
    return result;
  }

  startPractice(raw: unknown): PracticeStart {
    const options = normalizePracticeOptions(raw);
    const practice = new PracticeSession(selectPracticeItems(this.questions, options, this.progress));
    this.practice = practice;
    this.practiceOptions = options;
    this.practiceSaved = false;
    return {
      question: practice.current() as PracticeStart['question'],
      total: practice.total,
      secondsPerQuestion: options.secondsPerQuestion,
      bookmarks: [...this.progress.bookmarks],
      ids: practice.ids,
      states: practice.states(),
    };
  }

  private activePractice(): PracticeSession {
    if (!this.practice) throw new Error('no practice in progress');
    return this.practice;
  }

  private async recordPractice(session: PracticeSession, questionId: string, feedback: PracticeFeedback): Promise<PracticeAnswer> {
    recordAnswer(this.progress, questionId, feedback.correct, today(), new Date().toISOString());
    await this.persistProgress();
    return { feedback, states: session.states() };
  }

  answerPractice(questionId: string, response: number[]): Promise<PracticeAnswer> {
    const practice = this.activePractice();
    return this.recordPractice(practice, questionId, practice.answer(questionId, response));
  }

  timeoutPractice(questionId: string): Promise<PracticeAnswer> {
    const practice = this.activePractice();
    return this.recordPractice(practice, questionId, practice.timeout(questionId));
  }

  skipPractice(questionId: string): PracticeVisit {
    const practice = this.activePractice();
    return { question: practice.skip(questionId), feedback: null, states: practice.states() };
  }

  gotoPractice(number: number): PracticeVisit {
    const practice = this.activePractice();
    return { ...practice.goTo(number), states: practice.states() };
  }

  async toggleBookmark(questionId: unknown): Promise<boolean> {
    if (typeof questionId !== 'string' || !this.questions.some((q) => q.id === questionId)) throw new Error('unknown question');
    const on = toggleBookmark(this.progress, questionId);
    await this.persistProgress();
    return on;
  }

  async practiceSummary(): Promise<PracticeSummary> {
    const practice = this.activePractice();
    if (!this.practiceOptions) throw new Error('no practice in progress');
    const summary = practice.summary();
    if (!this.practiceSaved && summary.answered > 0) {
      this.practiceSaved = true;
      await appendTrainingHistory(this.host.data, {
        date: new Date().toISOString(),
        answered: summary.answered,
        correct: summary.correct,
        timedOut: summary.timedOut,
        difficulty: this.practiceOptions.difficulty,
        source: this.practiceOptions.source,
        byDomain: summary.byDomain,
      });
    }
    return summary;
  }
}
