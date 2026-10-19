import { app, BrowserWindow, dialog, ipcMain, net, protocol, screen, session as electronSession } from 'electron';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CatexamService } from '../core/service';
import type { Profile } from '../engine/profile';
import type { BankImportSummary } from '../shared/api';
import { folderFiles, fsDir } from './fsdir';
import { Lockdown } from './lockdown';
import { runSmoke } from './smoke';

/** `1`: smoke test of the desktop app; `mobile`: smoke test of the Android web app (www/) in a phone-sized window. */
const SMOKE = process.env.CATEXAM_SMOKE;
const MOBILE_SMOKE = SMOKE === 'mobile';
const DEV = process.env.CATEXAM_DEV === '1';
if (SMOKE) app.setPath('userData', mkdtempSync(path.join(os.tmpdir(), 'catexam-smoke-')));
// The Android app's pages are served from a secure origin, as in the Android WebView (fetch and IndexedDB need one).
if (MOBILE_SMOKE) protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let win: BrowserWindow | null = null;
let lockdown: Lockdown | null = null;
let service: CatexamService;

const TEXT_ZOOM: Record<Profile['textSize'], number> = { normal: 1, large: 1.15, larger: 1.3 };

function applyTextSize(): void {
  win?.webContents.setZoomFactor(TEXT_ZOOM[service.currentProfile.textSize]);
}

function registerIpc(): void {
  ipcMain.handle('app:info', () => service.info());
  ipcMain.handle('profile:save', async (_e, raw: unknown) => {
    const saved = await service.saveProfile(raw);
    applyTextSize();
    return saved;
  });
  ipcMain.handle('history:delete', (_e, kind: unknown, dates: unknown) => service.deleteHistory(kind, dates));
  ipcMain.handle('history:review', (_e, date: unknown) => service.examReview(date));
  ipcMain.handle('progress:reset', () => service.resetProgress());
  ipcMain.handle('bank:import', async (): Promise<BankImportSummary | null> => {
    if (!win) return null;
    // The smoke test cannot drive the native picker; it names the folder in CATEXAM_SMOKE_IMPORT instead.
    let folder = SMOKE ? process.env.CATEXAM_SMOKE_IMPORT : undefined;
    if (!folder) {
      const pick = await dialog.showOpenDialog(win, { title: 'Import a folder of question banks', properties: ['openDirectory'] });
      if (pick.canceled || pick.filePaths.length === 0) return null;
      folder = pick.filePaths[0];
    }
    const chosen = folder;
    return service.importBanks(`the folder ${chosen}`, () => folderFiles(chosen));
  });
  ipcMain.handle('bank:remove', (_e, file: unknown) => service.removeBank(file));

  ipcMain.handle('exam:lock', () => lockdown?.lock());
  ipcMain.handle('exam:unlock', () => {
    if (!service.examActive) lockdown?.unlock();
  });
  ipcMain.handle('exam:start', (_e, name: unknown) => {
    const state = service.startExam(name);
    lockdown?.lock();
    return state;
  });
  ipcMain.handle('exam:answer', (_e, questionId: string, response: number[]) => service.answer(questionId, response));
  ipcMain.handle('exam:break', () => service.takeBreak());
  ipcMain.handle('exam:end', () => service.endExam());
  ipcMain.handle('exam:result', async () => {
    const result = await service.result();
    lockdown?.unlock();
    return result;
  });

  ipcMain.handle('practice:start', (_e, raw: unknown) => service.startPractice(raw));
  ipcMain.handle('practice:answer', (_e, questionId: string, response: number[]) => service.answerPractice(questionId, response));
  ipcMain.handle('practice:timeout', (_e, questionId: string) => service.timeoutPractice(questionId));
  ipcMain.handle('practice:skip', (_e, questionId: string) => service.skipPractice(questionId));
  ipcMain.handle('practice:goto', (_e, number: number) => service.gotoPractice(number));
  ipcMain.handle('practice:bookmark', (_e, questionId: unknown) => service.toggleBookmark(questionId));
  ipcMain.handle('practice:summary', () => service.practiceSummary());
  ipcMain.handle('practice:pause', () => service.pausePractice());
  ipcMain.handle('practice:resume', (_e, id: unknown) => service.resumePractice(id));
  ipcMain.handle('practice:delete-paused', (_e, id: unknown) => service.deletePaused(id));

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
  const onIncident = (kind: string, detail: string): void => {
    if (service.recordIncident(kind, detail)) win?.webContents.send('exam:incident', detail);
  };
  lockdown = new Lockdown(win, onIncident);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.once('ready-to-show', () => win?.show());
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  applyTextSize();
  if (SMOKE) {
    const ok = await runSmoke(win, { lockdown });
    lockdown.unlock();
    app.exit(ok ? 0 : 1);
  }
}

/** Smoke test of the Android web app: www/ in a phone-sized window, with its own storage and no preload. */
async function runMobileSmoke(): Promise<void> {
  const www = path.join(app.getAppPath(), 'www');
  protocol.handle('app', (request) => net.fetch(pathToFileURL(path.join(www, decodeURIComponent(new URL(request.url).pathname))).toString()));
  const phone = new BrowserWindow({
    useContentSize: true,
    width: 412,
    height: 915,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  await phone.loadURL('app://catexam/index.html');
  const ok = await runSmoke(phone, { mobile: true });
  app.exit(ok ? 0 : 1);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => win?.focus());
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(async () => {
    electronSession.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    if (MOBILE_SMOKE) return runMobileSmoke();
    service = await CatexamService.open({
      version: app.getVersion(),
      platform: 'desktop',
      data: fsDir(app.getPath('userData')),
      builtin: fsDir(path.join(app.getAppPath(), 'questions')),
      displays: () => screen.getAllDisplays().length,
      onTimeout: () => win?.webContents.send('exam:timeout'),
    });
    registerIpc();
    await createWindow();
  }).catch((err: unknown) => {
    console.error(err);
    app.exit(1);
  });
}
