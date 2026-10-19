import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Lockdown } from './lockdown';

/** Desktop run: the app window and its lockdown. Phone run: the Android web app (www/) in a phone-sized window. */
export type SmokeTarget = { lockdown: Lockdown; mobile?: undefined } | { lockdown?: undefined; mobile: true };

/**
 * Headless end-to-end run (CATEXAM_SMOKE=1 for the desktop app, CATEXAM_SMOKE=mobile for the Android web app;
 * `npm run smoke` runs both in the gates): drives the real screens through a full exam and a short training
 * session, checking the lockdown (desktop) or the phone layout (Android) along the way.
 * With CATEXAM_SMOKE_SHOTS=<dir>, it also saves PNG screenshots of the main screens there (`phone-*` for Android).
 */
export async function runSmoke(win: BrowserWindow, target: SmokeTarget): Promise<boolean> {
  const { lockdown, mobile } = target;
  const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code, true) as Promise<T>;
  const waitFor = (selector: string): Promise<void> =>
    js(`new Promise((resolve, reject) => {
      const t0 = Date.now();
      const poll = () => document.querySelector(${JSON.stringify(selector)}) ? resolve()
        : Date.now() - t0 > 10000 ? reject(new Error('timeout waiting for ${selector}')) : setTimeout(poll, 20);
      poll();
    })`);
  const click = (selector: string): Promise<void> => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const check = (ok: boolean, what: string): void => {
    if (!ok) throw new Error(`check failed: ${what}`);
    console.log(`ok - ${what}`);
  };
  const shot = async (name: string): Promise<void> => {
    const dir = process.env.CATEXAM_SMOKE_SHOTS;
    if (!dir) return;
    await js(`(() => { const { promise, resolve } = Promise.withResolvers(); requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 200))); return promise; })()`);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${mobile ? 'phone-' : ''}${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  const text = (selector: string): Promise<string> => js<string>(`document.querySelector(${JSON.stringify(selector)}).textContent`);
  /** Whether `selector` sits in the middle of its `main` (within a scroll bar's width), and `main` spans the window. */
  const centred = (selector: string): Promise<boolean> =>
    js<boolean>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      const main = document.querySelector('main');
      const m = main.getBoundingClientRect();
      const scrollbar = main.offsetWidth - main.clientWidth;
      const fullWidth = main.closest('.workspace') ? true : Math.abs(m.width - window.innerWidth) < 1;
      return fullWidth && Math.abs((el.left - m.left) - (m.right - scrollbar - el.right)) <= 2;
    })()`);
  /**
   * Phone layout: nothing sticks out sideways (wide tables scroll inside themselves), and the screen fills the
   * window without spilling below it.
   */
  const fitsPhone = async (screen: string): Promise<void> => {
    if (!mobile) return;
    const problem = await js<string>(`(() => {
      const wide = [...document.querySelectorAll('main, header, footer, nav, .progress, .card, .dialog')].find((el) => el.scrollWidth > el.clientWidth + 1);
      if (wide) {
        // Name the element that sticks out furthest, to make the failure actionable.
        const right = (el) => el.getBoundingClientRect().right;
        const culprit = [...wide.querySelectorAll('*')].reduce((far, el) => (!far || right(el) > right(far) ? el : far), null);
        const name = (el) => el ? el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).replace(/ /g, '.') : '') : '?';
        return 'too wide: ' + name(wide) + ' ' + wide.scrollWidth + ' > ' + wide.clientWidth + ', because of ' + name(culprit) + ' "' + (culprit?.textContent ?? '').slice(0, 60) + '"';
      }
      if (document.documentElement.scrollWidth > window.innerWidth) return 'page scrolls sideways';
      const app = document.querySelector('#app').getBoundingClientRect();
      if (app.bottom > window.innerHeight + 1) return 'screen taller than the window: ' + app.bottom + ' > ' + window.innerHeight;
      return '';
    })()`);
    check(problem === '', `${screen} fits the phone screen${problem ? ` (${problem})` : ''}`);
  };
  /** Height in CSS pixels of every element matching `selector`, for the touch target checks. */
  const heights = (selector: string): Promise<number[]> =>
    js<number[]>(`[...document.querySelectorAll(${JSON.stringify(selector)})].filter((el) => el.offsetParent).map((el) => el.getBoundingClientRect().height)`);
  const visible = (selector: string): Promise<boolean> => js<boolean>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return !!el && el.offsetParent !== null; })()`);

  try {
    // First start: the setup wizard asks for the names, the exam plan, training preferences and appearance.
    await waitFor('#setup-step-1');
    check(!(await js<boolean>(`!!document.querySelector('#home')`)), 'first start opens the setup wizard, not the home screen');
    await fitsPhone('setup wizard: names');
    await shot('setup-names');
    await click('#setup-next');
    check((await text('#setup-step')) === 'Step 1 of 4', 'the wizard needs a first name to go on');
    await js(`(() => {
      const set = (id, v) => { const el = document.querySelector(id); el.value = v; el.dispatchEvent(new Event('input')); };
      set('#setup-first-name', 'Smoke');
      set('#setup-last-name', 'Test');
    })()`);
    await click('#setup-next');
    await waitFor('#setup-step-2');
    await js(`document.querySelector('#setup-goal').value = '7'`);
    await fitsPhone('setup wizard: exam plan');
    await click('#setup-next');
    await waitFor('#setup-step-3');
    await js(`document.querySelector('#setup-count').value = '4'`);
    await fitsPhone('setup wizard: training preferences');
    await shot('setup-training');
    await click('#setup-back');
    await waitFor('#setup-step-2');
    check((await js<string>(`document.querySelector('#setup-goal').value`)) === '7', 'Back in the wizard keeps the answers');
    await click('#setup-next');
    await waitFor('#setup-step-3');
    await click('#setup-next');
    await waitFor('#setup-finish');
    await fitsPhone('setup wizard: appearance');
    await click('#setup-finish');
    await waitFor('#start-exam');
    const setup = await js<{ first: string; last: string; goal: number; count: number; done: boolean }>(
      `window.examApi.info().then((i) => ({ first: i.profile.firstName, last: i.profile.lastName, goal: i.profile.dailyGoal, count: i.profile.training.count, done: i.profile.setupDone }))`,
    );
    check(setup.first === 'Smoke' && setup.last === 'Test' && setup.goal === 7 && setup.count === 4 && setup.done, 'the wizard saves the profile and is done');
    check(!(await js<boolean>(`!!document.querySelector('#candidate')`)) && (await text('#candidate-label')) === 'Candidate: Smoke Test', 'home shows the profile name instead of a name box');
    check((await js<number>(`document.querySelectorAll('#home .stat').length`)) === 4, 'home shows the progress summary');
    check((await js<number>(`document.querySelector('#bank-card').compareDocumentPosition(document.querySelector('#study-card'))`)) === 4, 'question bank card comes before the study plan');
    await fitsPhone('home');
    await shot('home');
    const total = await js<number>(`window.examApi.info().then((i) => i.bank.total)`);
    check(total >= 150, `question bank loaded (${total} questions)`);
    if (mobile) {
      check(
        (await visible('.tabbar #tab-settings')) && !(await visible('#open-settings')) && !(await visible('#quit')),
        'phone: bottom tab bar instead of the top buttons, no Quit button',
      );
      check((await heights('#home button')).every((hgt) => hgt >= 36), 'phone: buttons are large enough to tap');
      await click('#tab-train');
      await waitFor('#tab-train.active');
      check(!(await js<boolean>(`!!document.querySelector('#tab-home.active')`)), 'phone: Train tab is marked as the current section');
      await click('#tab-home');
      await waitFor('#tab-home.active');
    }

    // Profile & settings: saved, applied and used as training defaults.
    await click(mobile ? '#tab-settings' : '#open-settings');
    await waitFor('#settings-save');
    check(await centred('#settings .card'), 'settings are centred and scroll at the window edge');
    if (!mobile)
      check(
        await js<boolean>(`(() => {
          const r = ['#settings-first-name', '#settings-last-name', '#settings-exam-date', '#settings-goal'].map((id) => document.querySelector(id).getBoundingClientRect());
          return r.every((x) => x.top === r[0].top && x.height === r[0].height);
        })()`),
        'profile fields line up',
      );
    await fitsPhone('settings');
    await shot('settings');
    await js(`(() => {
      const set = (id, v) => { const el = document.querySelector(id); el.value = v; el.dispatchEvent(new Event('change')); };
      set('#settings-last-name', 'Tester');
      set('#settings-exam-date', '2099-01-01');
      set('#settings-goal', '5');
      set('#settings-theme', 'dark');
      set('#settings-text', 'large');
      set('#default-count', '3');
      set('#default-difficulty', 'easy');
    })()`);
    await click('#settings-save');
    await waitFor('#home');
    const saved = await js<{ name: string; theme: string; count: number; difficulty: string }>(
      `window.examApi.info().then((i) => ({ name: i.profile.firstName + ' ' + i.profile.lastName, theme: i.profile.theme, count: i.profile.training.count, difficulty: i.profile.training.difficulty }))`,
    );
    check(saved.name === 'Smoke Tester' && saved.theme === 'dark' && saved.count === 3 && saved.difficulty === 'easy', 'settings saved to the profile');
    const zoomed = mobile
      ? (await js<string>(`getComputedStyle(document.body).zoom`)) === '1.15'
      : win.webContents.getZoomFactor() === 1.15;
    check((await js<string>(`document.documentElement.dataset.theme`)) === 'dark' && zoomed, 'dark theme and large text applied');
    await fitsPhone('home with large text');
    check(
      (await text('#candidate-label')) === 'Candidate: Smoke Tester' &&
        (await js<string>(`document.querySelector('#practice-count').value`)) === '3' &&
        (await js<string>(`document.querySelector('#practice-difficulty').value`)) === 'easy',
      'home uses the profile name and training defaults',
    );
    check(/Your exam is in \d+ days/.test(await text('#exam-countdown')), 'study plan counts down to the exam date');
    await shot('home-dark');
    await js(`document.querySelector('#practice-difficulty').value = 'mixed'`);
    await click('#start-exam');
    await waitFor('#nda-accept');
    if (lockdown) check(lockdown.isLocked && win.isKiosk() && win.isAlwaysOnTop(), 'locked from the NDA screen: kiosk, always on top');
    await fitsPhone('NDA');
    await click('#nda-accept');
    await waitFor('#tutorial-start');
    await fitsPhone('tutorial');
    await click('#tutorial-start');
    await waitFor('#exam');
    check((await text('#question-progress')).startsWith('0 answered'), 'question progress bar starts at 0 answered');
    check(/^0:00:0\d of 3:00:00$/.test(await text('#time-progress')), `time progress bar shows elapsed of 3 hours (${await text('#time-progress')})`);
    check((await text('#pace')) === 'On pace', 'pace hint shows On pace at the start');
    check(await centred('#exam .stem') && await centred('#exam .options, #exam #ordering'), 'exam question is centred');
    check(
      (await js<number>(`document.querySelectorAll('#navigator .nav-box:not(.nav-legend *)').length`)) === 150 &&
        (await js<number>(`document.querySelectorAll('#navigator button').length`)) === 0 &&
        (await js<string>(`document.querySelector('#navigator .current').textContent`)) === '1',
      'exam navigator shows every question, read-only',
    );
    await fitsPhone('exam question');
    await shot('exam');
    if (mobile) {
      check(!(await visible('#navigator')) && (await visible('#nav-toggle')), 'phone: the question list is hidden behind the Questions button');
      await click('#nav-toggle');
      check((await visible('#navigator')) && (await js<string>(`document.querySelector('#nav-toggle').getAttribute('aria-expanded')`)) === 'true', 'phone: Questions opens the question list');
      await shot('exam-questions');
      await click('.nav-backdrop');
      check(!(await visible('#navigator')), 'phone: tapping outside closes the question list');
      check((await heights('#exam .option, #exam .drag-item, footer button')).every((hgt) => hgt >= 44), 'phone: options and buttons are at least 44 px high');
      if (await js<boolean>(`!!document.querySelector('#exam .option')`)) {
        // Touch and hold strikes an option out without selecting it.
        await js(`(() => {
          const row = document.querySelector('#exam .option');
          const r = row.getBoundingClientRect();
          row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: r.left + 20, clientY: r.top + 10 }));
        })()`);
        await js(`new Promise((resolve) => setTimeout(resolve, 700))`);
        await js(`(() => {
          const row = document.querySelector('#exam .option');
          row.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
          row.click();
        })()`);
        check(
          await js<boolean>(`document.querySelector('#exam .option').classList.contains('struck') && !document.querySelector('#exam .option input').checked`),
          'phone: touch and hold strikes an option out without selecting it',
        );
      }
    } else {
      win.close();
      check(!win.isDestroyed(), 'window cannot be closed during the exam');
    }
    check((await js<boolean>(`document.querySelector('#prev, #back, #review-later') === null`)), 'no back or mark-for-review control');

    // An empty answer is refused.
    await click('#next');
    await waitFor('#modal-ok');
    await click('#modal-ok');
    check((await js<string>(`document.querySelector('#qnum').textContent`)) === 'Question 1', 'an answer is required to move on');

    const firstId = await js<string>(`window.examApi.answer('no-such-id', [0]).then(() => 'accepted', (e) => 'refused')`);
    check(firstId === 'refused', 'answering a question other than the current one is refused');

    let answered = 0;
    while (answered < 200) {
      const screen = await js<string>(`new Promise((resolve) => {
        const poll = () => document.querySelector('#result') ? resolve('result')
          : document.querySelector('#exam') && !document.querySelector('#next').disabled ? resolve('exam') : setTimeout(poll, 10);
        poll();
      })`);
      if (screen === 'result') break;
      // Strategy: choose the first option(s); ordering items keep their shown order.
      await js(`(() => {
        const boxes = [...document.querySelectorAll('#exam input')];
        if (boxes.length === 0) return;
        if (boxes[0].type === 'radio') boxes[0].click();
        else boxes.slice(0, 2).forEach((b) => b.click());
      })()`);
      const before = await js<string>(`document.querySelector('#qnum').textContent`);
      await click('#next');
      const moved = await js<boolean>(`new Promise((resolve) => {
        const t0 = Date.now();
        const poll = () => document.querySelector('#result') || (document.querySelector('#qnum') && document.querySelector('#qnum').textContent !== ${JSON.stringify(before)}) ? resolve(true)
          : document.querySelector('#modal-ok') ? (document.querySelector('#modal-ok').click(), resolve(false))
          : Date.now() - t0 > 5000 ? resolve(false) : setTimeout(poll, 10);
        poll();
      })`);
      if (!moved) {
        // Multi-select with an unexpected count: pick all boxes one by one until accepted.
        await js(`[...document.querySelectorAll('#exam input')].forEach((b) => { if (b.checked) b.click(); })`);
        const n = await js<number>(`document.querySelectorAll('#exam input').length`);
        let ok = false;
        for (let k = 1; k <= n && !ok; k++) {
          await js(`[...document.querySelectorAll('#exam input')].forEach((b, i) => { if ((i < ${k}) !== b.checked) b.click(); })`);
          await click('#next');
          ok = await js<boolean>(`new Promise((r) => setTimeout(() => { const m = document.querySelector('#modal-ok'); if (m) { m.click(); r(false); } else r(true); }, 100))`);
        }
        check(ok, `question ${before} accepted an answer`);
      }
      answered++;
      if (answered === 10) {
        const shown = await text('#question-progress');
        const width = await js<string>(`document.querySelector('#question-bar .bar-fill').style.width`);
        check(shown.startsWith('10 answered') && width === `${Math.round((10 / 150) * 1000) / 10}%`, `question progress bar follows the answers (${shown}, ${width})`);
        check((await js<number>(`document.querySelectorAll('#navigator .nav-box.answered:not(.nav-legend *)').length`)) === 10, 'exam navigator marks the answered questions');
        await shot('exam-question-11');
      }
    }
    await waitFor('#outcome');
    await fitsPhone('score report');
    await shot('score-report');
    check(answered >= 100 && answered <= 150, `exam ended between 100 and 150 questions (${answered})`);
    const outcome = await js<string>(`document.querySelector('#outcome').textContent`);
    const rows = await js<number>(`document.querySelectorAll('#domain-report tr').length`);
    check(rows === 9, `score report shows ${outcome.trim()} with all 8 domains`);
    if (lockdown) check(!lockdown.isLocked && !win.isKiosk(), 'lockdown released after the exam');

    await click('#review');
    await waitFor('#review-list');
    const reviewed = await js<number>(`document.querySelectorAll('#review-list article').length`);
    check(reviewed === answered, `review lists every answered question (${reviewed})`);
    await js(`(() => { const b = document.querySelector('#review-wrong'); b.click(); })()`);
    const wrongShown = await js<number>(`document.querySelectorAll('#review-list article:not([hidden])').length`);
    const wrongTotal = await js<number>(`document.querySelectorAll('#review-list article.wrong').length`);
    check(wrongShown === wrongTotal, `review filter shows only incorrect answers (${wrongShown})`);
    await shot('answer-review');
    await fitsPhone('answer review');

    await click('#review-home');
    await waitFor('#history');
    check((await js<number>(`document.querySelectorAll('#history tr').length`)) === 2, 'result saved to history');
    check((await text('#stat-exams')).startsWith('1'), 'home summary counts the exam');
    await shot('home-after-exam');

    await js(`document.querySelector('#practice-count').value = '3'`);
    await click('#start-practice');
    await waitFor('#practice');
    check(await centred('#practice .stem'), 'training question is centred');
    const box = (n: number): Promise<string> => js<string>(`document.querySelector('#navigator .nav-box[data-number="${n}"]').className`);
    check((await js<number>(`document.querySelectorAll('#navigator button.nav-box').length`)) === 3 && (await js<boolean>(`document.querySelector('#practice-back').disabled`)), 'training navigator has a box per question; Back is off on the first');
    await click('#practice-skip');
    await waitFor('#navigator .nav-box.current[data-number="2"]');
    check((await box(1)).includes('skipped') && (await text('#qnum')) === 'Question 2 of 3', 'Skip moves on and marks the question skipped');
    const key = (k: string): Promise<void> => js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)} }))`);
    await key('a');
    await key('b');
    await key('Enter');
    await waitFor('#feedback .explanation');
    check(true, 'training mode answers by keyboard and shows the explanation');
    const verdict = await text('#feedback .verdict');
    const marked = await js<number>(`document.querySelectorAll('#practice .is-answer').length`);
    check(/^(✔ Correct!|✘ Incorrect\.)/.test(verdict) && marked > 0, `answer marked right or wrong at once, correct option highlighted (${verdict.slice(0, 12)})`);
    const state = verdict.startsWith('✔') ? 'correct' : 'wrong';
    check((await box(2)).includes(state), `navigator marks the answer ${state}`);
    await click('#bookmark');
    await waitFor('#bookmark[aria-pressed="true"]');
    check((await box(2)).includes('marked'), 'a training question can be bookmarked and shows as marked');
    await fitsPhone('training feedback');
    await shot('training-feedback');
    await key('Enter');
    await waitFor('#practice:not(:has(#feedback .explanation))');
    check((await js<string>(`document.querySelector('#qnum').textContent`)) === 'Question 3 of 3', 'Enter moves to the next unanswered question');
    await click('#practice-back');
    await waitFor('#feedback .explanation');
    check(
      (await js<string>(`document.querySelector('#qnum').textContent`)) === 'Question 2 of 3' &&
        (await js<boolean>(`!document.querySelector('#check') && [...document.querySelectorAll('#practice .options input')].every((i) => i.disabled)`)),
      'Back reopens the answered question, locked with its feedback',
    );
    if (mobile) await click('#nav-toggle');
    await click('#navigator .nav-box[data-number="1"]');
    await waitFor('#practice:not(:has(#feedback .explanation))');
    check((await js<string>(`document.querySelector('#qnum').textContent`)) === 'Question 1 of 3' && (await box(1)).includes('current'), 'a navigator box opens its question');
    await shot('training-navigator');
    await click('#practice-stop');
    await waitFor('#practice-domains');
    await fitsPhone('training summary');
    check(true, 'training summary shows accuracy by domain');

    await click('#practice-home');
    await waitFor('#study-card');
    check((await text('#coverage')).startsWith('Questions practised: 1 of'), `study plan counts practised questions (${await text('#coverage')})`);
    check((await text('#train-bookmarks')) === 'Bookmarked (1)', 'study plan offers the bookmarked question');

    // A per-question timer that runs out marks the question incorrect.
    await js(`startPractice({ ...profile.training, count: 1, secondsPerQuestion: 1 })`);
    await waitFor('#practice-time-left');
    await waitFor('#feedback .verdict');
    check((await text('#feedback .verdict')).startsWith('⏱ Time ran out'), 'training timer runs out and counts the question as incorrect');
    await click('#practice-next');
    await waitFor('#practice-domains');

    await click('#practice-home');
    await waitFor('#home');
    // Pause a training session and resume it later from the paused sessions page.
    await js(`startPractice({ ...profile.training, count: 3, secondsPerQuestion: 0 })`);
    await waitFor('#practice');
    await click('#practice-skip');
    await waitFor('#navigator .nav-box.current[data-number="2"]');
    await fitsPhone('training with Pause');
    await click('#practice-pause');
    await waitFor('#open-paused');
    check((await text('#open-paused')) === 'Paused sessions (1)', 'Pause saves the session and goes back to the start');
    await click('#open-paused');
    await waitFor('#paused-screen');
    check((await js<number>(`document.querySelectorAll('#paused-list tr.entry').length`)) === 1 && (await text('#paused-list tr.entry td:nth-child(2)')) === '0 of 3', 'the paused session is listed with its progress');
    await fitsPhone('paused sessions');
    await shot('paused-sessions');
    await click('#paused-list .resume-paused');
    await waitFor('#practice');
    check((await text('#qnum')) === 'Question 2 of 3' && (await box(1)).includes('skipped'), 'a resumed session opens where it was paused, with its skipped question');
    await click('#practice-stop');
    await waitFor('#practice-summary');
    check((await js<number>(`window.examApi.info().then((i) => i.paused.length)`)) === 0, 'a resumed session that ends leaves the paused list');
    await click('#practice-home');
    await waitFor('#home');
    await click(mobile ? '#tab-history' : '#open-history');
    await waitFor('#history-screen');
    check(await centred('#history-screen .card'), 'history is centred and scrolls at the window edge');
    const sessions = await js<number>(`document.querySelectorAll('#training-history tr.entry').length`);
    check(sessions === 2, `history lists both training sessions (${sessions})`);
    check((await js<number>(`document.querySelectorAll('#domain-progress tr').length`)) === 9, 'history shows training accuracy for all 8 domains');
    await fitsPhone('history');
    await shot('history');
    // A past exam can be reviewed: questions, answers, correct answers and explanations.
    await click('#exam-history .review-entry');
    await waitFor('#review-list');
    check((await js<number>(`document.querySelectorAll('#review-list article').length`)) === answered && (await js<number>(`document.querySelectorAll('#review-list .explanation').length`)) === answered, `a past exam reopens with every answered question and its explanation (${answered})`);
    await fitsPhone('past exam review');
    await click('#review-back');
    await waitFor('#history-screen');
    await click('#exam-history .delete-entry');
    await waitFor('#history-screen:not(:has(#exam-history))');
    check((await js<number>(`window.examApi.info().then((i) => i.history.length)`)) === 0, 'an exam can be deleted from the history');

    // Folder import: one summary for added, already imported and invalid files; an imported bank can be removed.
    await click(mobile ? '#tab-home' : '#history-home');
    await waitFor('#import-bank');
    const folder = await mkdtemp(path.join(os.tmpdir(), 'catexam-smoke-banks-'));
    const q = (id: string): object => ({ id, domain: 3, type: 'single', difficulty: 0, stem: `Smoke ${id}?`, options: ['a', 'b', 'c', 'd'], answer: [1], explanation: 'e' });
    await writeFile(path.join(folder, 'new.json'), JSON.stringify({ name: 'Smoke bank', questions: [q('SMK-1'), q('SMK-2')] }));
    await writeFile(path.join(folder, 'dup.json'), JSON.stringify({ name: 'CISSP Domain 1 – Security and Risk Management', questions: [q('SMK-3')] }));
    await writeFile(path.join(folder, 'bad.json'), JSON.stringify({ name: 'Bad', questions: [{ ...q('SMK-4'), domain: 12 }] }));
    if (mobile) {
      // The phone picks files with the system picker: answer it through the DevTools protocol.
      const files = ['new.json', 'dup.json', 'bad.json'].map((n) => path.join(folder, n));
      const devtools = win.webContents.debugger;
      devtools.attach('1.3');
      await devtools.sendCommand('Page.enable');
      await devtools.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });
      devtools.on('message', (_event, method, params: { backendNodeId: number }) => {
        if (method === 'Page.fileChooserOpened') void devtools.sendCommand('DOM.setFileInputFiles', { files, backendNodeId: params.backendNodeId });
      });
    } else process.env.CATEXAM_SMOKE_IMPORT = folder;
    const before = await js<number>(`window.examApi.info().then((i) => i.bank.total)`);
    await click('#import-bank');
    await waitFor('#import-summary');
    await fitsPhone('import summary');
    await shot('import-summary');
    check((await text('#import-totals')) === '3 files found: 1 file added with 2 questions, 1 skipped, 1 failed.', `import summary totals (${await text('#import-totals')})`);
    check((await text('#import-skipped')).includes('dup.json: bank "CISSP Domain 1 – Security and Risk Management" is already imported.'), 'import summary names the skipped bank');
    check((await text('#import-failed')).includes('bad.json') && (await text('#import-failed')).includes('domain'), `import summary shows the validator error (${await text('#import-failed')})`);
    await click('#import-ok');
    await waitFor('#imported-banks .remove-bank');
    check((await js<number>(`window.examApi.info().then((i) => i.bank.total)`)) === before + 2, 'imported questions join the bank');
    await click('#imported-banks .remove-bank');
    await waitFor('#remove-confirm');
    await click('#remove-confirm');
    await waitFor('#bank-card:not(:has(#imported-banks))');
    check((await js<number>(`window.examApi.info().then((i) => i.bank.total)`)) === before, 'an imported bank can be removed');
    await rm(folder, { recursive: true, force: true });

    console.log('SMOKE OK');
    return true;
  } catch (err) {
    console.error(`SMOKE FAILED: ${(err as Error).message}`);
    return false;
  }
}
