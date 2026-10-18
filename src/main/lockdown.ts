import { type BrowserWindow, clipboard, globalShortcut, powerSaveBlocker } from 'electron';

/** Shortcuts swallowed system-wide while the exam is locked (registration may fail for OS-reserved keys). */
const BLOCKED_GLOBAL = [
  'Alt+F4',
  'Alt+Space',
  'Alt+Esc',
  'CommandOrControl+Esc',
  'CommandOrControl+W',
  'CommandOrControl+Q',
  'CommandOrControl+R',
  'CommandOrControl+Shift+R',
  'CommandOrControl+Shift+I',
  'CommandOrControl+P',
  'CommandOrControl+C',
  'CommandOrControl+V',
  'CommandOrControl+X',
  'CommandOrControl+A',
  'PrintScreen',
  'Alt+PrintScreen',
  'F5',
  'F11',
  'F12',
];

/**
 * Secure-browser behaviour of a test centre workstation:
 * kiosk full screen, always on top, hidden from screen capture, no close/reload/devtools/clipboard,
 * no sleep, and every loss of focus is recorded as an incident and the window is brought back.
 */
export class Lockdown {
  private sleepBlocker: number | null = null;
  private locked = false;
  private readonly onBlur = (): void => {
    if (!this.locked) return;
    this.onIncident('focus-lost', 'The exam window lost focus. This is recorded, as a proctor would.');
    setTimeout(() => {
      if (!this.locked || this.win.isDestroyed()) return;
      this.win.show();
      this.win.moveTop();
      this.win.focus();
    }, 50);
  };
  private readonly onClose = (event: Electron.Event): void => {
    if (this.locked) event.preventDefault();
  };

  constructor(
    private readonly win: BrowserWindow,
    private readonly onIncident: (kind: string, detail: string) => void,
  ) {
    win.on('blur', this.onBlur);
    win.on('close', this.onClose);
    win.webContents.on('before-input-event', (event, input) => {
      if (!this.locked) return;
      const key = input.key.toLowerCase();
      const ctrl = input.control || input.meta;
      const blocked =
        (input.alt && key === 'f4') ||
        (ctrl && ['w', 'q', 'r', 'p', 'c', 'v', 'x', 'a', 'i', 's', 'f', 'j', 'u', '+', '-', '=', '0'].includes(key)) ||
        ['f5', 'f11', 'f12', 'printscreen', 'escape'].includes(key);
      if (blocked) event.preventDefault();
    });
  }

  get isLocked(): boolean {
    return this.locked;
  }

  lock(): void {
    if (this.locked) return;
    this.locked = true;
    clipboard.clear();
    this.win.setKiosk(true);
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setContentProtection(true);
    this.win.setSkipTaskbar(true);
    this.win.setMinimizable(false);
    this.win.setClosable(false);
    for (const accelerator of BLOCKED_GLOBAL) {
      try {
        globalShortcut.register(accelerator, () => undefined);
      } catch {
        // OS-reserved combination: cannot be taken over by an application.
      }
    }
    this.sleepBlocker = powerSaveBlocker.start('prevent-display-sleep');
    this.win.focus();
  }

  unlock(): void {
    if (!this.locked) return;
    this.locked = false;
    globalShortcut.unregisterAll();
    if (this.sleepBlocker !== null) powerSaveBlocker.stop(this.sleepBlocker);
    this.sleepBlocker = null;
    clipboard.clear();
    this.win.setClosable(true);
    this.win.setMinimizable(true);
    this.win.setSkipTaskbar(false);
    this.win.setContentProtection(false);
    this.win.setAlwaysOnTop(false);
    this.win.setKiosk(false);
  }
}
