import { app, BrowserWindow, dialog, ipcMain, screen, session as electronSession } from 'electron';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DOMAINS } from '../engine/domains';
import { PracticeSession } from '../engine/practice';
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
import type { Question } from '../engine/types';
import type { AppInfo, BankImportSummary, ExamState, HistoryKind, ImportedBank } from '../shared/api';
import { Lockdown } from './lockdown';
import { runSmoke } from './smoke';
import {
  appendHistory,
  appendTrainingHistory,
  deleteHistory,
  importBankFolder,
  loadQuestions,
  readHistory,
  readProfile,
  readProgress,
  readTrainingHistory,
  removeBank,
  saveProfile,
  saveProgress,
} from './store';

const SMOKE = process.env.CATEXAM_SMOKE === '1';
const DEV = process.env.CATEXAM_DEV === '1';
if (SMOKE) app.setPath('userData', mkdtempSync(path.join(os.tmpdir(), 'catexam-smoke-')));

let win: BrowserWindow | null = null;
let lockdown: Lockdown | null = null;
let questions: Question[] = [];
let imported: ImportedBank[] = [];
let bankErrors: string[] = [];
let exam: ExamSession | null = null;
let candidate = '';
let examTimer: NodeJS.Timeout | null = null;
let practice: PracticeSession | null = null;
let practiceOptions: PracticeOptions | null = null;
let practiceSaved = false;
let profile: Profile;
let progress: Progress;
let progressWrite: Promise<void> = Promise.resolve();

const TEXT_ZOOM: Record<Profile['textSize'], number> = { normal: 1, large: 1.15, larger: 1.3 };

const userDir = (): string => app.getPath('userData');
const builtinDir = (): string => path.join(app.getAppPath(), 'questions');

/** Local calendar day (YYYY-MM-DD) for the daily training goal. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Progress is saved after every training answer; writes are chained so they never overlap. */
function persistProgress(): Promise<void> {
  progressWrite = progressWrite.then(() => saveProgress(userDir(), progress)).catch((err: unknown) => console.error(err));
  return progressWrite;
}

function applyTextSize(): void {
  win?.webContents.setZoomFactor(TEXT_ZOOM[profile.textSize]);
}

async function reloadBank(): Promise<void> {
  const loaded = await loadQuestions(builtinDir(), userDir());
  questions = loaded.questions;
  imported = loaded.imported;
  bankErrors = loaded.errors;
}

function examState(): ExamState {
  if (!exam) throw new Error('no exam in progress');
  const question = exam.current();
  return {
    question,
    startedAt: exam.startedAt,
    deadline: exam.deadline,
    minItems: exam.config.minItems,
    maxItems: exam.config.maxItems,
    finished: question === null,
  };
}

function onExamIncident(kind: string, detail: string): void {
  if (!exam || exam.isFinished) return;
  exam.recordIncident(kind, detail);
  win?.webContents.send('exam:incident', detail);
}

function registerIpc(): void {
  ipcMain.handle('app:info', async (): Promise<AppInfo> => ({
    version: app.getVersion(),
    bank: {
      total: questions.length,
      byDomain: DOMAINS.map((d) => ({
        domain: d.id,
        name: d.name,
        weight: d.weight,
        count: questions.filter((q) => q.domain === d.id).length,
      })),
    },
    bankErrors,
    importedBanks: imported,
    displays: screen.getAllDisplays().length,
    history: await readHistory(userDir()),
    trainingHistory: await readTrainingHistory(userDir()),
    profile,
    progress: summarizeProgress(questions, progress, today()),
  }));

  ipcMain.handle('profile:save', async (_e, raw: unknown) => {
    profile = normalizeProfile(raw);
    await saveProfile(userDir(), profile);
    applyTextSize();
    return profile;
  });

  ipcMain.handle('history:delete', (_e, kind: HistoryKind, dates: unknown) => {
    if (kind !== 'exam' && kind !== 'training') throw new Error('unknown history');
    const list = Array.isArray(dates) ? dates.filter((d): d is string => typeof d === 'string') : null;
    return deleteHistory(userDir(), kind, list);
  });

  ipcMain.handle('progress:reset', () => {
    progress = { questions: {}, bookmarks: [], daily: {} };
    return persistProgress();
  });

  ipcMain.handle('bank:import', async (): Promise<BankImportSummary | null> => {
    if (!win) return null;
    // The smoke test cannot drive the native picker; it names the folder in CATEXAM_SMOKE_IMPORT instead.
    let folder = SMOKE ? process.env.CATEXAM_SMOKE_IMPORT : undefined;
    if (!folder) {
      const pick = await dialog.showOpenDialog(win, { title: 'Import a folder of question banks', properties: ['openDirectory'] });
      if (pick.canceled || pick.filePaths.length === 0) return null;
      folder = pick.filePaths[0];
    }
    const summary = await importBankFolder(folder, builtinDir(), userDir());
    if (summary.added > 0) await reloadBank();
    return summary;
  });

  ipcMain.handle('bank:remove', async (_e, file: unknown) => {
    if (typeof file !== 'string' || !imported.some((b) => b.file === file)) throw new Error('not an imported bank');
    await removeBank(file, userDir());
    await reloadBank();
  });

  ipcMain.handle('exam:lock', () => lockdown?.lock());
  ipcMain.handle('exam:unlock', () => {
    if (!exam || exam.isFinished) lockdown?.unlock();
  });

  ipcMain.handle('exam:start', (_e, name: string) => {
    if (exam && !exam.isFinished) throw new Error('an exam is already in progress');
    candidate = String(name ?? '').slice(0, 80);
    lockdown?.lock();
    exam = new ExamSession(questions);
    clearTimeout(examTimer ?? undefined);
    const active = exam;
    examTimer = setTimeout(() => {
      if (active.checkTime()) win?.webContents.send('exam:timeout');
    }, Math.max(0, exam.deadline - Date.now()) + 100);
    return examState();
  });

  ipcMain.handle('exam:answer', (_e, questionId: string, response: number[]) => {
    if (!exam) throw new Error('no exam in progress');
    exam.answer(questionId, response);
    return examState();
  });

  ipcMain.handle('exam:break', () => exam?.recordBreak());
  ipcMain.handle('exam:end', () => exam?.endByCandidate());

  ipcMain.handle('exam:result', async () => {
    if (!exam) throw new Error('no exam in progress');
    exam.checkTime();
    const result = exam.result();
    clearTimeout(examTimer ?? undefined);
    examTimer = null;
    lockdown?.unlock();
    await appendHistory(userDir(), {
      date: new Date().toISOString(),
      candidate,
      passed: result.passed,
      reason: result.reason,
      scaledScore: result.scaledScore,
      itemsAnswered: result.itemsAnswered,
      elapsedSeconds: result.elapsedSeconds,
      domains: result.domains,
    });
    return result;
  });

  ipcMain.handle('practice:start', (_e, raw: unknown) => {
    const options = normalizePracticeOptions(raw);
    practice = new PracticeSession(selectPracticeItems(questions, options, progress));
    practiceOptions = options;
    practiceSaved = false;
    return { question: practice.current(), total: practice.total, secondsPerQuestion: options.secondsPerQuestion, bookmarks: [...progress.bookmarks] };
  });
  const recordPractice = async (session: PracticeSession, questionId: string, correct: boolean) => {
    recordAnswer(progress, questionId, correct, today(), new Date().toISOString());
    await persistProgress();
    return session.current();
  };
  ipcMain.handle('practice:answer', async (_e, questionId: string, response: number[]) => {
    if (!practice) throw new Error('no practice in progress');
    const feedback = practice.answer(questionId, response);
    return { feedback, next: await recordPractice(practice, questionId, feedback.correct) };
  });
  ipcMain.handle('practice:timeout', async (_e, questionId: string) => {
    if (!practice) throw new Error('no practice in progress');
    const feedback = practice.timeout(questionId);
    return { feedback, next: await recordPractice(practice, questionId, false) };
  });
  ipcMain.handle('practice:bookmark', async (_e, questionId: unknown) => {
    if (typeof questionId !== 'string' || !questions.some((q) => q.id === questionId)) throw new Error('unknown question');
    const on = toggleBookmark(progress, questionId);
    await persistProgress();
    return on;
  });
  ipcMain.handle('practice:summary', async () => {
    if (!practice || !practiceOptions) throw new Error('no practice in progress');
    const summary = practice.summary();
    if (!practiceSaved && summary.answered > 0) {
      practiceSaved = true;
      await appendTrainingHistory(userDir(), {
        date: new Date().toISOString(),
        answered: summary.answered,
        correct: summary.correct,
        timedOut: summary.timedOut,
        difficulty: practiceOptions.difficulty,
        source: practiceOptions.source,
        byDomain: summary.byDomain,
      });
    }
    return summary;
  });

  ipcMain.handle('app:quit', () => {
    if (!lockdown?.isLocked) app.quit();
  });
}

async function createWindow(): Promise<void> {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'CATExam – CISSP CAT Simulator',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: DEV,
      spellcheck: false,
    },
  });
  win.setMenu(null);
  lockdown = new Lockdown(win, onExamIncident);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.once('ready-to-show', () => win?.show());
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  applyTextSize();
  if (SMOKE) {
    const ok = await runSmoke(win, lockdown);
    lockdown.unlock();
    app.exit(ok ? 0 : 1);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => win?.focus());
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(async () => {
    electronSession.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    await reloadBank();
    profile = await readProfile(userDir());
    progress = await readProgress(userDir());
    registerIpc();
    await createWindow();
  }).catch((err: unknown) => {
    console.error(err);
    app.exit(1);
  });
}
