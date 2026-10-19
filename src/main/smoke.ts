import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import type { Question } from '../engine/types';
import type { Lockdown } from './lockdown';

/** Every shipped question by id (questions/ of the app), so the smoke can answer right or wrong on purpose. */
function answerKey(): Map<string, Question> {
  const dir = path.join(app.getAppPath(), 'questions');
  const key = new Map<string, Question>();
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    // The shipped banks, checked by the bank validation tests.
    const bank = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as { questions: Question[] };
    for (const q of bank.questions) if (!key.has(q.id)) key.set(q.id, q);
  }
  return key;
}

/** A wrong response of the right shape: another option, one wrong pick among the right ones, or the order reversed. */
function wrongResponse(q: Question): number[] {
  if (q.type === 'ordering') return [...q.answer].reverse();
  const other = q.options.findIndex((_, i) => !q.answer.includes(i));
  return q.type === 'single' ? [other] : [...q.answer.slice(0, -1), other].sort((a, b) => a - b);
}

/** Desktop run: the app window and its lockdown. Phone run: the Android web app (www/) in a phone-sized window. */
export type SmokeTarget = { lockdown: Lockdown; mobile?: undefined } | { lockdown?: undefined; mobile: true };

/**
 * Headless end-to-end run (CATEXAM_SMOKE=1 for the desktop app, CATEXAM_SMOKE=mobile for the Android web app;
 * `npm run smoke` runs both in the gates): drives the real screens through a full exam, a short training
 * session and a short game round, checking the lockdown (desktop) or the phone layout (Android) along the way.
 * With CATEXAM_SMOKE_SHOTS=<dir>, it also saves PNG screenshots of the main screens there (`phone-*` for Android).
 */
export async function runSmoke(win: BrowserWindow, target: SmokeTarget): Promise<boolean> {
  const { lockdown, mobile } = target;
  const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code, true) as Promise<T>;
  const waitFor = (selector: string, ms = 10000): Promise<void> =>
    js(`new Promise((resolve, reject) => {
      const t0 = Date.now();
      const poll = () => document.querySelector(${JSON.stringify(selector)}) ? resolve()
        : Date.now() - t0 > ${ms} ? reject(new Error('timeout waiting for ${selector}')) : setTimeout(poll, 20);
      poll();
    })`);
  const click = (selector: string): Promise<void> => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  // Seconds since the start in every line, so that a run that runs out of time shows where the time went.
  const t0 = Date.now();
  const check = (ok: boolean, what: string): void => {
    if (!ok) throw new Error(`check failed: ${what}`);
    console.log(`ok - ${what} [${Math.round((Date.now() - t0) / 1000)} s]`);
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
      check(
        (await js<boolean>(`[...document.querySelectorAll('.tabbar .tab')].every((b) => b.querySelector('svg path') && !b.textContent.trim() && b.getAttribute('aria-label'))`)) &&
          (await js<string>(`[...document.querySelectorAll('.tabbar .tab')].map((b) => b.getAttribute('aria-label')).join()`)) === 'Home,Train,Game,History,Settings' &&
          (await heights('.tabbar .tab')).every((hgt) => hgt >= 44),
        'phone: tab bar shows icons with names for screen readers, large enough to tap',
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

    // Game mode: the settings, the world map, a quick round with its HUD, feedback and explanation, and the end
    // screen, then an island with its boss fight.
    await click(mobile ? '#tab-settings' : '#open-settings');
    await waitFor('#game-settings');
    check((await js<boolean>(`document.querySelector('#settings-sound').checked`)) === !mobile, `game sound is ${mobile ? 'off by default on the phone' : 'on by default on the desktop'}`);
    check((await js<boolean>(`document.querySelector('#settings-music').checked`)) === !mobile, `music is ${mobile ? 'off by default on the phone' : 'on by default on the desktop'}`);
    check((await js<number>(`document.querySelectorAll('#credits li').length`)) === 12, 'settings list the credits of every game asset');
    await js(`(() => {
      document.querySelector('#settings-sound').checked = false;
      document.querySelector('#settings-lite').checked = true;
      document.querySelector('#settings-volume').value = '40';
      document.querySelector('#settings-music-volume').value = '30';
    })()`);
    await fitsPhone('settings with game settings and credits');
    await click('#settings-save');
    await waitFor('#game-card');
    const settings = await js<{ sound: boolean; lite: boolean; volume: number; music: boolean; musicVolume: number }>(`window.examApi.info().then((i) => i.game.settings)`);
    check(!settings.sound && settings.lite && settings.volume === 40 && settings.music === !mobile && settings.musicVolume === 30, 'game settings are saved, music apart from the sound effects');
    await js(`window.examApi.saveGameSettings({ sound: false, volume: 40, music: ${!mobile}, musicVolume: 30, lite: false })`);
    const todayBefore = await js<number>(`window.examApi.info().then((i) => i.progress.today)`);
    await click(mobile ? '#tab-game' : '#open-game');
    await waitFor('#game-hub');
    check(await visible('#hub-cat') && (await text('#rank-badge')).includes('Intern'), 'game hub shows the cat and the rank');
    check(
      (await js<string>(`[...document.querySelectorAll('#hub-powerups .inv-count')].map((c) => c.textContent).join()`)) === '×1,×1,×1' &&
        (await visible('#open-daily')) && (await visible('#open-lightning')) && (await text('#open-achievements')).includes('0/15'),
      'the hub shows one of each power-up to start with, the daily challenge, the lightning round and the achievements',
    );
    check((await js<number>(`document.querySelectorAll('#quest-map button.map-island').length`)) === 8, 'the world map has an island per domain');
    check(
      (await js<number>(`document.querySelectorAll('#quest-map .map-island.cleared').length`)) === 0 && (await text('#world-progress')).includes('0/8'),
      'no island is cleared at first',
    );
    check((await js<string>(`document.documentElement.dataset.music`)) === (mobile ? 'off' : 'map'), `the map ${mobile ? 'is silent: music is off on the phone' : 'plays the map music'}`);
    check((await js<string>(`document.querySelector('#map-cat').dataset.at`)) === '1' && (await text('#island-title')).includes('Risk Reef'), 'the cat starts on the first island');
    await click('#map-island-3');
    await waitFor('#map-cat[data-at="3"]');
    check((await text('#island-title')).includes('The Crypto Caves') && (await text('#island-panel')).includes('The Side-Channel Golem'), 'tapping an island walks the cat there and shows the island and its boss');
    check(!(await js<boolean>(`!!document.querySelector('#island-boss')`)), 'the boss alone is offered only once the stage is won');
    await fitsPhone('world map');
    await shot('game-map');
    await click('#game-quick');
    await waitFor('#quick-round');
    check((await js<number>(`document.querySelectorAll('#world-map button.island').length`)) === 8, 'the quick round picker has an island per domain');
    await click('#game-no-islands');
    await click('#game-start');
    check(await js<boolean>(`new Promise((r) => setTimeout(() => r(!!document.querySelector('#quick-round') && !document.querySelector('#game-check')), 300))`), 'a round needs at least one island');
    await click('#island-1');
    await click('#island-3');
    check((await js<string>(`[...document.querySelectorAll('#world-map .island[aria-pressed="true"]')].map((b) => b.dataset.domain).join()`)) === '1,3', 'tapping islands picks the domains of the round');
    await click('#game-len-5');
    check((await js<string>(`document.querySelector('#game-len-5').getAttribute('aria-pressed')`)) === 'true', 'the round length is picked with pixel buttons');
    await fitsPhone('quick round picker');
    await shot('game-quick');
    await click('#game-start');
    await waitFor('#game-check');
    check((await js<number>(`document.querySelectorAll('#game-hearts .px-icon.heart').length`)) === 3 && (await text('#game-qnum')) === 'Q 1/5', 'a round starts with three hearts');
    check((await js<string>(`document.querySelector('#game-cat').dataset.pose`)) === 'idle', 'the cat idles while the question is open');
    await fitsPhone('game question');
    await shot('game-question');
    let rounds = 0;
    let wrong = 0;
    for (let screen = 'question'; screen === 'question' && rounds < 5; ) {
      // Strategy as in the exam: the first option (two for multi-select); ordering items keep their order.
      await js(`(() => {
        const boxes = [...document.querySelectorAll('#game .options input')];
        boxes.slice(0, boxes[0]?.type === 'radio' ? 1 : 2).forEach((b) => b.click());
      })()`);
      await click('#game-check');
      // A multi-select question with another count of answers: tick one more box until accepted.
      for (let k = 3; k <= 6 && !(await js<boolean>(`new Promise((r) => setTimeout(() => r(!!document.querySelector('#game-next')), 150))`)); k++) {
        await js(`[...document.querySelectorAll('#game .options input')].forEach((b, i) => { if ((i < ${k}) !== b.checked) b.click(); })`);
        await click('#game-check');
      }
      await waitFor('#game-next');
      const right = (await text('#feedback .verdict')).startsWith('✔');
      if (!right) wrong++;
      const pose = await js<string>(`document.querySelector('#game-cat').dataset.pose`);
      check(right ? pose === 'cheer' : pose === 'facepalm' || pose === 'cry', `the cat ${right ? 'cheers on a right' : 'facepalms, then cries, on a wrong'} answer`);
      check(
        (await js<number>(`document.querySelectorAll('#game-hearts .px-icon.heart').length`)) === 3 - wrong,
        `hearts: ${3 - wrong} left after ${wrong} wrong answer${wrong === 1 ? '' : 's'}`,
      );
      check((await text('#game-quip')).length > 10, 'a joke follows the answer');
      // The explanation from the question bank is shown and nothing covers it, effects included.
      check(
        await js<boolean>(`(() => {
          const ex = document.querySelector('#feedback .explanation');
          // Its first line, scrolled to the top of the screen: long explanations are taller than a phone screen.
          ex.scrollIntoView({ block: 'start' });
          const r = ex.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 12);
          return ex.textContent.length > 20 && ex.contains(hit);
        })()`),
        'the explanation follows every answer and is never covered by effects',
      );
      if (rounds === 0) {
        await fitsPhone('game feedback');
        await shot('game-feedback');
      }
      rounds++;
      await click('#game-next');
      // Next opens the level-up moment (when earned), then the next question or the end screen.
      const nextScreen = (): Promise<string> =>
        js<string>(`new Promise((resolve) => {
          const poll = () => document.querySelector('#levelup') ? resolve('levelup') : document.querySelector('#game-over') ? resolve('over')
            : document.querySelector('#game-check:not(:disabled)') ? resolve('question') : setTimeout(poll, 20);
          poll();
        })`);
      screen = await nextScreen();
      if (screen === 'levelup') {
        await click('#levelup-continue');
        screen = await nextScreen();
      }
    }
    await waitFor('#game-over-title');
    const title = await text('#game-over-title');
    check(title === (wrong === 3 ? 'GAME OVER' : 'ROUND CLEAR!'), `the round ends with ${title} after ${rounds} answers`);
    check((await js<string>(`document.querySelector('#over-cat').dataset.pose`)) === (wrong === 3 ? 'cry' : 'cheer'), `the cat ${wrong === 3 ? 'cries at game over' : 'cheers at a cleared round'}`);
    check((await text('#game-over-line')).length > 10 && (await visible('#game-retry')), 'the end screen has a funny line and a retry');
    await fitsPhone('game over');
    await shot('game-over');
    const after = await js<{ today: number; xp: number }>(`window.examApi.info().then((i) => ({ today: i.progress.today, xp: i.game.level.xp }))`);
    check(after.today === todayBefore + rounds && (after.xp > 0) === (wrong < rounds), `game answers count as training answers and earn XP (${after.xp} XP)`);
    // The level-up moment: full screen with the rank badge, after "Next", and Continue goes on.
    await js(`levelUpScreen({ xp: 120, level: 2, rank: 'Password123 Survivor', levelStart: 100, nextLevel: 300 }, true, () => void gameHub())`);
    await waitFor('#levelup-continue');
    check((await text('#levelup')).includes('New rank: Password123 Survivor'), 'level-up screen shows the new rank');
    await fitsPhone('level up');
    await shot('game-levelup');
    await click('#levelup-continue');
    await waitFor('#game-hub');

    // An island: its stage (questions of its domain), then the boss. The answers come from the shipped banks, so
    // the smoke wins and loses on purpose.
    const bank = answerKey();
    let islandAnswers = 0;
    const todayBeforeIsland = await js<number>(`window.examApi.info().then((i) => i.progress.today)`);
    const answer = async (right: boolean): Promise<Question> => {
      const q = bank.get(await js<string>(`document.querySelector('#game-question').dataset.question`)) as Question;
      islandAnswers++;
      await js(`(() => {
        const response = ${JSON.stringify(right ? q.answer : wrongResponse(q))};
        const list = document.querySelector('#game #ordering');
        if (list) return response.forEach((i) => list.append(list.querySelector('li[data-index="' + i + '"]')));
        for (const box of document.querySelectorAll('#game .options input')) if (box.checked !== response.includes(Number(box.value))) box.click();
      })()`);
      await click('#game-check');
      await waitFor('#game-next');
      return q;
    };
    /** Next: through the level-up moment when one comes, to the next question or the end screen. */
    const goOn = async (): Promise<void> => {
      await click('#game-next');
      for (;;) {
        const screen = await js<string>(`new Promise((resolve) => {
          const poll = () => document.querySelector('#levelup') ? resolve('levelup') : document.querySelector('#game-over') ? resolve('over')
            : document.querySelector('#game-check:not(:disabled)') ? resolve('question') : setTimeout(poll, 20);
          poll();
        })`);
        if (screen !== 'levelup') return;
        await click('#levelup-continue');
      }
    };
    const heartsLeft = (): Promise<number> => js<number>(`document.querySelectorAll('#game-hearts .px-icon.heart').length`);
    const explanationVisible = (): Promise<boolean> =>
      js<boolean>(`(() => {
        const ex = document.querySelector('#feedback .explanation');
        ex.scrollIntoView({ block: 'start' });
        const r = ex.getBoundingClientRect();
        return ex.textContent.length > 20 && ex.contains(document.elementFromPoint(r.left + r.width / 2, r.top + 12));
      })()`);
    await click('#map-island-7');
    await waitFor('#map-cat[data-at="7"]');
    await click('#island-play');
    await waitFor('#game-check');
    check((await text('#game-qnum')) === 'Q 1/6' && (await heartsLeft()) === 3 && !(await js<boolean>(`!!document.querySelector('#boss-arena')`)), 'an island starts with its stage: six questions, three hearts');
    check((await js<string>(`document.documentElement.dataset.music`)) === (mobile ? 'off' : 'map'), 'the stage plays the map music (when music is on)');
    const stageDomains = new Set<number>();
    stageDomains.add((await answer(false)).domain);
    check((await heartsLeft()) === 2, 'a wrong answer on an island costs a heart');
    // Power-ups: Patch Tuesday mends the broken heart, then 50/50 and Ask the Auditor help on the next questions.
    const enabled = (selector: string): Promise<boolean> => js<boolean>(`!!document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`);
    const zappedOptions = (): Promise<number[]> => js<number[]>(`[...document.querySelectorAll('#game .option')].flatMap((row, i) => row.classList.contains('zapped') ? [i] : [])`);
    const currentQuestion = async (): Promise<Question> => bank.get(await js<string>(`document.querySelector('#game-question').dataset.question`)) as Question;
    await goOn();
    check(await enabled('#pu-patch'), 'with a broken heart, Patch Tuesday can be used');
    await click('#pu-patch');
    await waitFor('#game-hearts .px-icon.mended');
    check((await heartsLeft()) === 3 && !(await enabled('#pu-patch')) && (await text('#pu-patch .pu-count')) === '×0', 'Patch Tuesday mends a heart and leaves the inventory');
    await waitFor('#pop-layer .achievement-pop[data-achievement="power-up"]');
    check((await text('#pop-layer [data-achievement="power-up"]')).includes('Turned It Off and On Again'), 'the first power-up unlocks an achievement, with a pop-up');
    let fiftyUsed = false;
    let auditorUsed = false;
    for (;;) {
      const q = await currentQuestion();
      if (!fiftyUsed && (await enabled('#pu-fifty'))) {
        // The quick round above may have earned another 50/50 (five in a row).
        const held = Number((await text('#pu-fifty .pu-count')).slice(1));
        await click('#pu-fifty');
        await waitFor('#game .option.zapped');
        const zapped = await zappedOptions();
        check(
          zapped.length === 2 && !zapped.some((i) => q.answer.includes(i)) && (await text('#pu-fifty .pu-count')) === `×${held - 1}` && !(await enabled('#pu-auditor')),
          '50/50 takes two wrong options away (never a right one); one help per question',
        );
        fiftyUsed = true;
        await fitsPhone('power-ups');
        await shot('game-powerup');
      } else if (fiftyUsed && !auditorUsed && (await enabled('#pu-auditor'))) {
        await click('#pu-auditor');
        await waitFor('#auditor-hint:not([hidden])');
        const zapped = await zappedOptions();
        check(
          (await text('#auditor-hint')).startsWith('The Auditor: ') && zapped.length === (q.type === 'ordering' ? 0 : 1) && !zapped.some((i) => q.answer.includes(i)),
          'Ask the Auditor rules out a wrong option and says why',
        );
        auditorUsed = true;
      }
      stageDomains.add((await answer(true)).domain);
      if ((await text('#game-next')) === 'BOSS FIGHT ▶') break;
      await goOn();
    }
    check(fiftyUsed && auditorUsed, 'the stage used 50/50 and Ask the Auditor');
    check([...stageDomains].join() === '7', 'the island asks questions of its domain only');
    await goOn();
    await waitFor('#boss-arena');
    check((await text('#boss-arena .boss-name')) === 'The Ransomware Dragon' && (await text('#boss-hp')) === 'HP 5/5' && (await text('#game-qnum')) === 'BOSS', 'the stage won, the boss arrives with full health');
    check((await js<string>(`getComputedStyle(document.querySelector('#boss-sprite')).animationName`)) === 'boss-idle', 'the boss idles');
    check((await js<string>(`document.documentElement.dataset.music`)) === (mobile ? 'off' : 'boss'), 'the boss fight has its own music (when music is on)');
    await fitsPhone('boss arena');
    await shot('game-boss-start');
    const firstBoss = await answer(true);
    check(firstBoss.domain === 7 && firstBoss.difficulty > 0.5, `the boss asks hard questions of its domain (${firstBoss.difficulty} logits)`);
    check(
      (await text('#boss-hp')) === 'HP 4/5' && (await js<boolean>(`document.querySelector('#boss-sprite').classList.contains('hit')`)),
      'a right answer hits the boss: it flashes and shakes, and its health drops',
    );
    check(await explanationVisible(), 'the explanation follows a boss answer and nothing covers it');
    await fitsPhone('boss fight');
    await shot('game-boss');
    await goOn();
    await answer(false);
    check(
      (await heartsLeft()) === 2 && (await js<boolean>(`document.querySelector('#boss-sprite').classList.contains('attack')`)) && (await text('#game-quip')).startsWith('The Ransomware Dragon:'),
      'a wrong answer in the boss fight costs a heart, and the boss strikes back and gloats',
    );
    check(await explanationVisible(), 'the explanation follows a wrong boss answer too');
    for (let hp = 4; hp > 0; hp--) {
      await goOn();
      await answer(true);
    }
    check(
      (await text('#game-next')) === 'Victory ▶' && (await js<boolean>(`document.querySelector('#boss-sprite').classList.contains('defeated')`)) && (await explanationVisible()),
      'the last hit defeats the boss (explosion), and the explanation still shows',
    );
    await shot('game-boss-defeat');
    await waitFor('#pop-layer .achievement-pop[data-achievement="first-boss"]');
    check((await text('#pop-layer [data-achievement="first-boss"]')).includes('Incident Closed'), 'beating the first boss unlocks “Incident Closed”');
    await goOn();
    await waitFor('#game-over-title');
    check((await text('#game-over-title')) === 'VICTORY!' && (await text('#game-over-line')).includes('The Ransomware Dragon is defeated'), 'the victory screen names the beaten boss');
    check((await js<string>(`document.querySelector('#over-cat').dataset.pose`)) === 'cheer' && !(await js<boolean>(`!!document.querySelector('#game-retry')`)), 'the cat cheers at the victory');
    await fitsPhone('victory');
    await shot('game-victory');
    await click('#game-menu');
    await waitFor('#game-hub');
    check(
      (await js<boolean>(`document.querySelector('#map-island-7').classList.contains('cleared')`)) &&
        (await js<number>(`document.querySelectorAll('.path-${mobile ? 'tall' : 'wide'} line.lit').length`)) === 1 &&
        (await text('#world-progress')).includes('1/8') &&
        (await js<string>(`document.querySelector('#map-cat').dataset.at`)) === '7',
      'the cleared island lights up, the path from it is lit, and the cat stands on it',
    );
    await fitsPhone('world map with a cleared island');
    await shot('game-map-cleared');
    // A lost boss fight: a funny game over, and Retry goes straight back to the boss.
    await click('#island-boss');
    await waitFor('#boss-arena');
    for (let miss = 0; miss < 3; miss++) {
      if (miss > 0) await goOn();
      await answer(false);
    }
    check((await text('#game-next')) === 'Game over ▶', 'three wrong answers lose the boss fight');
    await goOn();
    await waitFor('#game-over-title');
    check(
      (await text('#game-over-title')) === 'GAME OVER' && (await text('#game-over-line')).includes('Ransomware Dragon') && (await text('#game-retry')) === 'Retry boss ▶',
      'losing to the boss ends in a funny game over with a retry of the boss',
    );
    check((await js<string>(`document.querySelector('#over-cat').dataset.pose`)) === 'cry', 'the cat cries when the boss wins');
    await shot('game-boss-over');
    await click('#game-retry');
    await waitFor('#boss-arena');
    check((await text('#boss-hp')) === 'HP 5/5', 'Retry starts the boss fight again');
    await click('#game-quit');
    await waitFor('#game-quit-confirm');
    await click('#game-quit-confirm');
    await waitFor('#game-over-title');
    const todayAfterIsland = await js<number>(`window.examApi.info().then((i) => i.progress.today)`);
    check(todayAfterIsland === todayBeforeIsland + islandAnswers, `island and boss answers count as training answers (${islandAnswers})`);
    await click('#game-menu');
    await waitFor('#game-hub');

    // Achievements: every badge, the ones won so far unlocked with their day, the others locked.
    await click('#open-achievements');
    await waitFor('#achievements');
    check(
      (await js<number>(`document.querySelectorAll('#achievements .badge-card').length`)) === 15 &&
        (await js<boolean>(`['first-boss', 'power-up'].every((id) => document.querySelector('#badge-' + id).classList.contains('unlocked'))`)) &&
        (await js<number>(`document.querySelectorAll('#achievements .badge-card.locked .badge-medal.locked').length`)) > 0,
      'the achievements screen shows unlocked and locked badges',
    );
    check((await text('#badge-first-boss')).includes('Unlocked') && (await text('#badge-streak-7')).includes('Locked'), 'unlocked badges say when, locked ones how');
    await fitsPhone('achievements');
    await shot('game-achievements');
    await click('#achievements-back');
    await waitFor('#game-hub');

    // The daily challenge: ten questions with no hearts, the streak calendar, its reward, and once a day.
    await click('#open-daily');
    await waitFor('#daily');
    check(
      (await js<number>(`document.querySelectorAll('#daily-calendar .day').length`)) === 35 &&
        (await js<number>(`document.querySelectorAll('#daily-calendar .day.today:not(.done)').length`)) === 1 &&
        (await text('#daily-streak')).startsWith('Streak: 0 days') &&
        (await text('#daily-next-reward')).includes('+50 XP'),
      'the daily challenge shows the streak calendar and what finishing today gives',
    );
    await fitsPhone('daily challenge');
    await shot('game-daily');
    await click('#daily-start');
    await waitFor('#game-check');
    check(
      (await text('#game-qnum')) === 'Q 1/10' && !(await js<boolean>(`!!document.querySelector('#game-hearts')`)) && !(await enabled('#pu-patch')),
      'the daily challenge has ten questions and no hearts (so no Patch Tuesday)',
    );
    for (let i = 0; i < 10; i++) {
      if (i > 0) await goOn();
      await answer(i !== 0);
      if (i === 0) check(await explanationVisible(), 'the explanation follows every daily challenge answer');
    }
    check((await text('#game-next')) === 'Results ▶', 'a wrong answer does not end the daily challenge');
    await goOn();
    await waitFor('#game-over-title');
    check(
      (await text('#game-over-title')) === 'DAILY DONE!' && (await text('#daily-reward')).includes('Streak: 1 day!') && !(await js<boolean>(`!!document.querySelector('#game-retry')`)),
      'finishing the daily challenge starts the streak and gives its reward, once a day',
    );
    await fitsPhone('daily challenge done');
    await shot('game-daily-done');
    await click('#game-menu');
    await waitFor('#game-hub');
    check((await text('#open-daily')).includes('Done today'), 'the hub shows the daily challenge done');
    await click('#open-daily');
    await waitFor('#daily');
    check((await js<boolean>(`document.querySelector('#daily-start').disabled`)) && (await js<number>(`document.querySelectorAll('#daily-calendar .day.today.done').length`)) === 1, 'today is marked on the calendar and the challenge is done until tomorrow');
    await click('#daily-back');
    await waitFor('#game-hub');

    // The lightning round: 60 seconds on one clock, its own music, no hearts, no power-ups, the explanations on
    // the review screen after the round, and a high score.
    await click('#open-lightning');
    await waitFor('#lightning-start');
    check((await js<string>(`document.documentElement.dataset.music`)) === (mobile ? 'off' : 'lightning'), 'the lightning round has its own music (when music is on)');
    await fitsPhone('lightning round start');
    await click('#lightning-start');
    await waitFor('#game-check');
    check(
      (await text('#game-time-left')).startsWith('TIME ') && !(await js<boolean>(`!!document.querySelector('#game-hearts, #powerups, #game-qnum')`)) &&
        (await js<string>(`document.documentElement.dataset.music`)) === (mobile ? 'off' : 'lightning'),
      'the lightning round shows the clock and the score, no hearts and no power-ups',
    );
    await fitsPhone('lightning round');
    await shot('game-lightning');
    const flashAnswers = [true, false, true];
    for (const right of flashAnswers) {
      const q = await currentQuestion();
      await js(`(() => {
        const response = ${JSON.stringify(right ? q.answer : wrongResponse(q))};
        for (const box of document.querySelectorAll('#game .options input')) if (box.checked !== response.includes(Number(box.value))) box.click();
      })()`);
      await click('#game-check');
      check(await js<boolean>(`document.querySelector('#feedback').textContent === ''`), 'a lightning answer does not stop the clock for its explanation');
      // The next question comes on its own, at once.
      await js(`(() => {
        const { promise, resolve, reject } = Promise.withResolvers();
        const t0 = Date.now();
        const poll = () => document.querySelector('#game-question')?.dataset.question !== ${JSON.stringify(q.id)} ? resolve()
          : Date.now() - t0 > 5000 ? reject(new Error('no next lightning question')) : setTimeout(poll, 20);
        poll();
        return promise;
      })()`);
    }
    check((await text('#lightning-score')) === '★ 2', 'the score counts the right answers');
    // The clock ends the round by itself.
    await waitFor('#game-over-title', 75_000);
    check((await text('#game-over-title')) === 'TIME!' && (await text('#lightning-final')) === '2' && (await text('#lightning-high')) === '2', `the round ends when the time is up, with the score (${await text('#game-over-title')})`);
    check((await text('#game-over .new-best')).includes('NEW HIGH SCORE!'), 'a first score is a new high score');
    check(
      (await js<number>(`document.querySelectorAll('#lightning-review .review-item').length`)) === flashAnswers.length &&
        (await js<boolean>(`[...document.querySelectorAll('#lightning-review .review-item')].every((r) => r.querySelector('.explanation')?.textContent.length > 20)`)),
      'the review after the round explains every answer',
    );
    check((await text('#game-retry')) === 'Play again ▶', 'the lightning round can be played again');
    await fitsPhone('lightning review');
    await shot('game-lightning-review');
    await click('#game-menu');
    await waitFor('#game-hub');
    check((await text('#open-lightning')).includes('High score 2'), 'the high score is kept');

    if (!mobile) {
      // The system's reduce-motion setting turns every game animation off.
      const devtools = win.webContents.debugger;
      devtools.attach('1.3');
      await devtools.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      check((await js<string>(`getComputedStyle(document.querySelector('.path-wide line.lit')).animationName`)) === 'none', 'reduce motion: the lit path stands still');
      await click('#game-quick');
      await waitFor('#game-start');
      await click('#game-start');
      await waitFor('#game-check');
      check(
        (await js<string>(`document.documentElement.dataset.fx`)) === 'still' && (await js<string>(`getComputedStyle(document.querySelector('#game-cat')).animationName`)) === 'none',
        'reduce motion: the game shows no animations',
      );
      devtools.detach();
    }

    console.log('SMOKE OK');
    return true;
  } catch (err) {
    console.error(`SMOKE FAILED: ${(err as Error).message}`);
    return false;
  }
}
