import { app, BrowserWindow, dialog, ipcMain, screen, session as electronSession } from 'electron';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DOMAINS } from '../engine/domains';
import { PracticeSession } from '../engine/practice';
import { ExamSession } from '../engine/session';
import type { DomainId, Question } from '../engine/types';
import type { AppInfo, ExamState } from '../shared/api';
import { Lockdown } from './lockdown';
import { runSmoke } from './smoke';
import { appendHistory, importBank, loadQuestions, readHistory } from './store';

const SMOKE = process.env.CATEXAM_SMOKE === '1';
const DEV = process.env.CATEXAM_DEV === '1';
if (SMOKE) app.setPath('userData', mkdtempSync(path.join(os.tmpdir(), 'catexam-smoke-')));

let win: BrowserWindow | null = null;
let lockdown: Lockdown | null = null;
let questions: Question[] = [];
let imported: string[] = [];
let bankErrors: string[] = [];
let exam: ExamSession | null = null;
let candidate = '';
let examTimer: NodeJS.Timeout | null = null;
let practice: PracticeSession | null = null;

async function reloadBank(): Promise<void> {
  const loaded = await loadQuestions(path.join(app.getAppPath(), 'questions'), app.getPath('userData'));
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
    history: await readHistory(app.getPath('userData')),
  }));

  ipcMain.handle('bank:import', async () => {
    if (!win) return { imported: null, errors: [] };
    const pick = await dialog.showOpenDialog(win, {
      title: 'Import question bank',
      filters: [{ name: 'Question bank', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (pick.canceled || pick.filePaths.length === 0) return { imported: null, errors: [] };
    const outcome = await importBank(pick.filePaths[0], app.getPath('userData'));
    if (outcome.imported) await reloadBank();
    return outcome;
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
    await appendHistory(app.getPath('userData'), {
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

  ipcMain.handle('practice:start', (_e, domains: DomainId[], count: number) => {
    practice = new PracticeSession(questions, domains, count);
    return { question: practice.current(), total: practice.total };
  });
  ipcMain.handle('practice:answer', (_e, questionId: string, response: number[]) => {
    if (!practice) throw new Error('no practice in progress');
    const feedback = practice.answer(questionId, response);
    return { feedback, next: practice.current() };
  });
  ipcMain.handle('practice:summary', () => {
    if (!practice) throw new Error('no practice in progress');
    return practice.summary();
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
    registerIpc();
    await createWindow();
  }).catch((err: unknown) => {
    console.error(err);
    app.exit(1);
  });
}
