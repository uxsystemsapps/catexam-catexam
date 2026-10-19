import { DOMAINS } from '../engine/domains';
import {
  achievementList,
  addDays,
  completeDaily,
  dailyRewardFor,
  dailyStreak,
  GameRun,
  levelInfo,
  LIGHTNING_SECONDS,
  normalizeGameSettings,
  selectDailyItems,
  selectIslandItems,
  selectLightningItems,
  unlockAchievements,
  type DailyReward,
  type GameAnswer,
  type GameProgress,
  type GameSettings,
  type GameSummary,
  type IslandProgress,
  type PowerUpEffect,
  type PowerUpId,
} from '../engine/game';
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
import type { ExamResult, Question, QuestionView, ReviewItem } from '../engine/types';
import type {
  AchievementInfo,
  AppInfo,
  BankImportSummary,
  ExamState,
  DailyStatus,
  GameStart,
  ImportedBank,
  PracticeAnswer,
  PracticeStart,
  PracticeSummary,
  PracticeVisit,
} from '../shared/api';
import {
  appendHistory,
  appendTrainingHistory,
  dateKey,
  deleteHistory,
  importBanks,
  listPaused,
  loadQuestions,
  readExamReview,
  readGame,
  readHistory,
  readPaused,
  readProfile,
  readProgress,
  readTrainingHistory,
  removeBank,
  removePaused,
  saveGame,
  saveProfile,
  savePaused,
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
  /** When the current training session was first started (kept across pause and resume); its paused file id derives from it. */
  private practiceStartedAt = '';
  private progressWrite: Promise<void> = Promise.resolve();
  private game: GameRun | null = null;
  private gameWrite: Promise<void> = Promise.resolve();
  /** Day the daily challenge being played was started, and its reward once finished. */
  private gameDay = '';
  private dailyReward: DailyReward | null = null;
  /** What the end of the round gave (kept at the first summary, so a second summary says the same). */
  private roundEnd: { newBest: boolean; unlocked: AchievementInfo[] } | null = null;

  private constructor(
    private readonly host: ServiceHost,
    private profile: Profile,
    private progress: Progress,
    private gameProgress: GameProgress,
  ) {}

  static async open(host: ServiceHost): Promise<CatexamService> {
    const service = new CatexamService(host, await readProfile(host.data), await readProgress(host.data), await readGame(host.data, host.platform));
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

  /** Game progress is saved after every game answer, chained like the training progress. */
  private persistGame(): Promise<void> {
    this.gameWrite = this.gameWrite.then(() => saveGame(this.host.data, this.gameProgress)).catch((err: unknown) => console.error(err));
    return this.gameWrite;
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
      paused: await listPaused(this.host.data),
      profile: this.profile,
      progress: summarizeProgress(questions, this.progress, today()),
      game: {
        level: levelInfo(this.gameProgress.xp),
        bestCombo: this.gameProgress.bestCombo,
        games: this.gameProgress.games,
        settings: this.gameProgress.settings,
        world: structuredClone(this.gameProgress.world),
        powerUps: { ...this.gameProgress.powerUps },
        achievements: achievementList(this.gameProgress),
        daily: this.dailyStatus(),
        lightningBest: this.gameProgress.lightningBest,
      },
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

  examReview(date: unknown): Promise<ReviewItem[]> {
    if (typeof date !== 'string') throw new Error('unknown exam');
    return readExamReview(this.host.data, date);
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
    await appendHistory(
      this.host.data,
      {
        date: new Date().toISOString(),
        candidate: this.candidate,
        passed: result.passed,
        reason: result.reason,
        scaledScore: result.scaledScore,
        itemsAnswered: result.itemsAnswered,
        elapsedSeconds: result.elapsedSeconds,
        domains: result.domains,
      },
      result.review,
    );
    return result;
  }

  startPractice(raw: unknown): PracticeStart {
    const options = normalizePracticeOptions(raw);
    return this.openPractice(new PracticeSession(selectPracticeItems(this.questions, options, this.progress)), options, new Date().toISOString());
  }

  private openPractice(practice: PracticeSession, options: PracticeOptions, startedAt: string): PracticeStart {
    this.practice = practice;
    this.practiceOptions = options;
    this.practiceSaved = false;
    this.practiceStartedAt = startedAt;
    const visit = practice.goTo(practice.position);
    return {
      question: visit.question,
      feedback: visit.feedback,
      total: practice.total,
      secondsPerQuestion: options.secondsPerQuestion,
      bookmarks: [...this.progress.bookmarks],
      ids: practice.ids,
      states: practice.states(),
    };
  }

  /** Saves the current training session to be resumed later; a resumed session replaces its earlier pause. */
  async pausePractice(): Promise<void> {
    const practice = this.activePractice();
    if (!this.practiceOptions) throw new Error('no practice in progress');
    const summary = practice.summary();
    await savePaused(this.host.data, {
      id: dateKey(this.practiceStartedAt),
      startedAt: this.practiceStartedAt,
      pausedAt: new Date().toISOString(),
      total: practice.total,
      answered: summary.answered,
      correct: summary.correct,
      options: this.practiceOptions,
      snapshot: practice.snapshot(),
    });
    this.practice = null;
    this.practiceOptions = null;
  }

  /** Continues a paused session. Its file stays until the session ends, so quitting the app keeps the last pause. */
  async resumePractice(id: unknown): Promise<PracticeStart> {
    if (typeof id !== 'string') throw new Error('unknown paused session');
    const paused = await readPaused(this.host.data, id);
    return this.openPractice(PracticeSession.restore(this.questions, paused.snapshot), normalizePracticeOptions(paused.options), paused.startedAt);
  }

  deletePaused(id: unknown): Promise<void> {
    if (typeof id !== 'string') throw new Error('unknown paused session');
    return removePaused(this.host.data, id);
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
    await removePaused(this.host.data, dateKey(this.practiceStartedAt));
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

  /** Starts a quick round; its questions are chosen as for a training session with these options. */
  async startGame(raw: unknown): Promise<GameStart> {
    const options = normalizePracticeOptions(raw);
    const items = selectPracticeItems(this.questions, options, this.progress);
    const { hearts } = this.gameProgress.settings;
    return this.beginGame(new GameRun(items, this.gameProgress.xp, null, { powerUps: this.gameProgress.powerUps, hearts }), options.secondsPerQuestion, null);
  }

  /** Starts an island of the world map: a stage of the domain's questions, then its boss, with the game rules of the settings. */
  async startIsland(domain: unknown): Promise<GameStart> {
    return this.islandRound(this.island(domain), true);
  }

  /** Fights the boss of an island again, without its stage; only once the stage has been won. */
  async startBoss(domain: unknown): Promise<GameStart> {
    const island = this.island(domain);
    if (!island.bossReached) throw new Error('win the stage of this island first');
    return this.islandRound(island, false);
  }

  private islandRound(island: IslandProgress, withStage: boolean): Promise<GameStart> {
    const rules = this.gameProgress.settings;
    const items = selectIslandItems(this.questions, island.domain, rules);
    if (items.boss.length === 0) throw new Error('this island has no questions in the bank');
    const round = { domain: island.domain, boss: items.boss, bossHp: rules.bossHp };
    const game = new GameRun(withStage ? items.stage : [], this.gameProgress.xp, round, { powerUps: this.gameProgress.powerUps, hearts: rules.hearts });
    return this.beginGame(game, rules.islandSeconds, island);
  }

  /** Starts today's daily challenge: the same ten questions all day; once finished, it is done until tomorrow. */
  async startDaily(): Promise<GameStart> {
    const day = today();
    if (this.gameProgress.dailyDays.includes(day)) throw new Error("today's challenge is done: come back tomorrow");
    const items = selectDailyItems(this.questions, day);
    if (items.length === 0) throw new Error('the question bank is empty');
    this.gameDay = day;
    return this.beginGame(new GameRun(items, this.gameProgress.xp, null, { kind: 'daily', powerUps: this.gameProgress.powerUps }), 0, null);
  }

  /** Starts a lightning round: 60 seconds of single- and multiple-answer questions. */
  async startLightning(): Promise<GameStart> {
    const items = selectLightningItems(this.questions);
    if (items.length === 0) throw new Error('the question bank has no questions for a lightning round');
    // The inventory rides along unused, so that saving after each answer keeps it.
    return this.beginGame(new GameRun(items, this.gameProgress.xp, null, { kind: 'lightning', powerUps: this.gameProgress.powerUps }), 0, null);
  }

  private island(domain: unknown): IslandProgress {
    const island = this.gameProgress.world.islands.find((i) => i.domain === domain);
    if (!island) throw new Error(`unknown island ${String(domain)}`);
    return island;
  }

  private dailyStatus(): DailyStatus {
    const day = today();
    const days = this.gameProgress.dailyDays;
    const from = addDays(day, -34);
    const done = days.includes(day);
    const streak = dailyStreak(days, day);
    return {
      today: day,
      done,
      streak,
      bestStreak: this.gameProgress.stats.bestStreak,
      days: days.filter((d) => d >= from),
      reward: dailyRewardFor(done ? streak : streak + 1),
    };
  }

  private async beginGame(game: GameRun, secondsPerQuestion: number, island: IslandProgress | null): Promise<GameStart> {
    this.game = game;
    this.dailyReward = null;
    this.roundEnd = null;
    this.gameProgress.games++;
    if (island) this.gameProgress.world.at = island.domain;
    await this.persistGame();
    return {
      question: game.current() as QuestionView,
      kind: game.kind,
      total: game.total,
      lives: game.livesLeft,
      secondsPerQuestion,
      roundSeconds: game.kind === 'lightning' ? LIGHTNING_SECONDS : 0,
      level: levelInfo(game.totalXp),
      island: island?.domain ?? null,
      phase: game.currentPhase,
      boss: game.bossState,
      powerUps: game.powerUps,
    };
  }

  private activeGame(): GameRun {
    if (!this.game) throw new Error('no game in progress');
    return this.game;
  }

  /**
   * A game answer counts as a training answer (daily count, questions to retry) and adds its XP and the power-ups
   * it earned. On an island, reaching the boss and beating it are kept on the world map; the last answer of the
   * daily challenge keeps the day and gives its reward. Achievements unlock as they are earned.
   */
  private async recordGame(game: GameRun, questionId: string, result: GameAnswer): Promise<GameAnswer> {
    recordAnswer(this.progress, questionId, result.feedback.correct, today(), new Date().toISOString());
    const p = this.gameProgress;
    p.xp = game.totalXp;
    p.bestCombo = Math.max(p.bestCombo, result.combo);
    p.powerUps = result.powerUps;
    if (result.feedback.correct) p.stats.right++;
    const domain = game.kind === 'island' ? game.summary().island : null;
    const island = p.world.islands.find((i) => i.domain === domain);
    if (island && result.bossStarts) island.bossReached = true;
    if (island && result.end === 'victory') {
      island.cleared = true;
      island.victories++;
      if (game.heartsLost === 0) p.stats.flawless++;
      if (result.lives === 1) p.stats.clutch++;
    }
    if (game.kind === 'daily' && result.end === 'cleared') this.dailyReward = completeDaily(p, this.gameDay);
    result.unlocked = unlockAchievements(p, today());
    await Promise.all([this.persistProgress(), this.persistGame()]);
    return result;
  }

  answerGame(questionId: string, response: number[]): Promise<GameAnswer> {
    const game = this.activeGame();
    return this.recordGame(game, questionId, game.answer(questionId, response));
  }

  timeoutGame(questionId: string): Promise<GameAnswer> {
    const game = this.activeGame();
    return this.recordGame(game, questionId, game.timeout(questionId));
  }

  async usePowerUp(id: unknown, questionId: unknown): Promise<PowerUpEffect> {
    const effect = this.activeGame().usePowerUp(id as PowerUpId, String(questionId));
    this.gameProgress.powerUps = effect.powerUps;
    this.gameProgress.stats.powerUpsUsed++;
    effect.unlocked = unlockAchievements(this.gameProgress, today());
    await this.persistGame();
    return effect;
  }

  /**
   * Ends the round if it is still running and returns its summary; the first call after a lightning round keeps
   * its high score. With the daily challenge's reward, and the achievements the end of the round unlocked.
   */
  async gameSummary(): Promise<GameSummary> {
    const game = this.activeGame();
    game.quit();
    const summary = game.summary();
    if (!this.roundEnd) {
      const newBest = game.kind === 'lightning' && summary.correct > this.gameProgress.lightningBest;
      if (newBest) this.gameProgress.lightningBest = summary.correct;
      this.roundEnd = { newBest, unlocked: unlockAchievements(this.gameProgress, today()) };
      await this.persistGame();
    }
    return {
      ...summary,
      level: levelInfo(this.gameProgress.xp),
      best: this.gameProgress.lightningBest,
      newBest: this.roundEnd.newBest,
      daily: this.dailyReward,
      unlocked: this.roundEnd.unlocked,
    };
  }

  async saveGameSettings(raw: unknown): Promise<GameSettings> {
    this.gameProgress.settings = normalizeGameSettings(raw, this.host.platform);
    await this.persistGame();
    return this.gameProgress.settings;
  }
}
