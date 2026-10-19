// Android app: runs the application service inside the WebView and exposes it as `window.examApi`, the API the
// desktop preload script provides. Loaded before the renderer script (src/renderer/app.ts), which is shared.
import { App } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { CatexamService } from '../core/service';
import type { ImportFile } from '../core/store';
import type { Profile } from '../engine/profile';
import type { ExamApi } from '../shared/api';
import { indexedDbDir, shippedDir } from './storage';

/** Set by the bundler (scripts/build-mobile.mjs) from package.json. */
declare const CATEXAM_VERSION: string;

declare global {
  interface Window {
    examApi: ExamApi;
  }
}

/** Native side: android/app/src/main/java/com/uxsystems/catexam/ExamLockPlugin.java. */
interface ExamLockPlugin {
  /** Pins the app to the screen, blocks screenshots and screen recording, keeps the screen on. */
  lock(): Promise<void>;
  unlock(): Promise<void>;
}

const native = Capacitor.isNativePlatform();
const examLock = registerPlugin<ExamLockPlugin>('ExamLock');
const TEXT_ZOOM: Record<Profile['textSize'], string> = { normal: '1', large: '1.15', larger: '1.3' };

let onTimeout: () => void = () => undefined;
let onIncident: (message: string) => void = () => undefined;
let locked = false;
/** Incident message to show once the candidate is back in the app. */
let pendingIncident: string | null = null;

const ready = (async () => {
  const service = await CatexamService.open({
    version: CATEXAM_VERSION,
    platform: 'mobile',
    data: await indexedDbDir('catexam'),
    builtin: shippedDir('questions'),
    displays: () => 1,
    onTimeout: () => onTimeout(),
  });
  // Text size: the desktop zooms the window; here the page is zoomed.
  document.documentElement.style.setProperty('--text-zoom', TEXT_ZOOM[service.currentProfile.textSize]);
  return service;
})();

/** Runs a service call as the desktop IPC does: always async, and the result is a copy. */
async function call<T>(run: (service: CatexamService) => T | Promise<T>): Promise<T> {
  return structuredClone(await run(await ready));
}

async function lock(): Promise<void> {
  if (locked) return;
  locked = true;
  if (native) await examLock.lock();
}

async function unlock(): Promise<void> {
  if (!locked) return;
  locked = false;
  if (native) await examLock.unlock();
}

// Leaving the app during the exam is recorded, as losing the window focus is on the desktop.
document.addEventListener('visibilitychange', () => {
  if (!locked) return;
  if (document.hidden) {
    const message = 'The exam app was left (sent to the background). This is recorded, as a proctor would.';
    void ready.then((service) => {
      if (service.recordIncident('app-left', message)) pendingIncident = message;
    });
  } else if (pendingIncident) {
    onIncident(pendingIncident);
    pendingIncident = null;
  }
});

/** Opens the system file picker for bank files; null when the candidate cancels. */
function pickFiles(): Promise<File[] | null> {
  const { promise, resolve } = Promise.withResolvers<File[] | null>();
  // No `accept` filter: Android pickers do not know a JSON type everywhere; the import skips other files.
  const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, hidden: true, id: 'bank-file-input' });
  const finish = (files: File[] | null): void => {
    input.remove();
    resolve(files);
  };
  input.addEventListener('change', () => finish(input.files && input.files.length > 0 ? [...input.files] : null));
  input.addEventListener('cancel', () => finish(null));
  document.body.append(input);
  input.click();
  return promise;
}

const api: ExamApi = {
  info: () => call((s) => s.info()),
  importBanks: async () => {
    const files = await pickFiles();
    if (!files) return null;
    const entries: ImportFile[] = files.map((f) => ({ name: f.name, read: () => f.text() }));
    return call((s) => s.importBanks('the chosen files', async () => entries));
  },
  removeBank: (file) => call((s) => s.removeBank(file)),
  saveProfile: (profile) =>
    call(async (s) => {
      const saved = await s.saveProfile(profile);
      document.documentElement.style.setProperty('--text-zoom', TEXT_ZOOM[saved.textSize]);
      return saved;
    }),
  deleteHistory: (kind, dates) => call((s) => s.deleteHistory(kind, dates)),
  examReview: (date) => call((s) => s.examReview(date)),
  resetProgress: () => call((s) => s.resetProgress()),
  lock,
  unlock: async () => {
    if (!(await ready).examActive) await unlock();
  },
  startExam: (candidate) =>
    call(async (s) => {
      const state = s.startExam(candidate);
      await lock();
      return state;
    }),
  answer: (questionId, response) => call((s) => s.answer(questionId, response)),
  takeBreak: () => call((s) => s.takeBreak()),
  endExam: () => call((s) => s.endExam()),
  result: () =>
    call(async (s) => {
      const result = await s.result();
      await unlock();
      return result;
    }),
  onTimeout: (callback) => {
    onTimeout = callback;
  },
  onIncident: (callback) => {
    onIncident = callback;
  },
  onBack: (callback) => {
    if (!native) return;
    void App.addListener('backButton', () => {
      if (!callback()) void App.minimizeApp();
    });
  },
  startPractice: (options) => call((s) => s.startPractice(options)),
  answerPractice: (questionId, response) => call((s) => s.answerPractice(questionId, response)),
  timeoutPractice: (questionId) => call((s) => s.timeoutPractice(questionId)),
  skipPractice: (questionId) => call((s) => s.skipPractice(questionId)),
  gotoPractice: (number) => call((s) => s.gotoPractice(number)),
  toggleBookmark: (questionId) => call((s) => s.toggleBookmark(questionId)),
  practiceSummary: () => call((s) => s.practiceSummary()),
  pausePractice: () => call((s) => s.pausePractice()),
  resumePractice: (id) => call((s) => s.resumePractice(id)),
  deletePaused: (id) => call((s) => s.deletePaused(id)),
  quit: async () => {
    if (native && !locked) await App.exitApp();
  },
};

window.examApi = api;
