import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Lockdown } from './lockdown';

/**
 * Headless end-to-end run (CATEXAM_SMOKE=1, used by `npm run smoke` in the gates): drives the real
 * screens through a full exam and a short training session, checking the lockdown along the way.
 * With CATEXAM_SMOKE_SHOTS=<dir>, it also saves PNG screenshots of the main screens there.
 */
export async function runSmoke(win: BrowserWindow, lockdown: Lockdown): Promise<boolean> {
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
    await writeFile(path.join(dir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  const text = (selector: string): Promise<string> => js<string>(`document.querySelector(${JSON.stringify(selector)}).textContent`);

  try {
    await waitFor('#start-exam');
    check((await js<number>(`document.querySelectorAll('#home .stat').length`)) === 4, 'home shows the progress summary');
    await shot('home');
    const total = await js<number>(`window.examApi.info().then((i) => i.bank.total)`);
    check(total >= 150, `question bank loaded (${total} questions)`);

    // Profile & settings: saved, applied and used as training defaults.
    await click('#open-settings');
    await waitFor('#settings-save');
    await js(`(() => {
      const set = (id, v) => { const el = document.querySelector(id); el.value = v; el.dispatchEvent(new Event('change')); };
      set('#settings-name', 'Smoke Test');
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
      `window.examApi.info().then((i) => ({ name: i.profile.name, theme: i.profile.theme, count: i.profile.training.count, difficulty: i.profile.training.difficulty }))`,
    );
    check(saved.name === 'Smoke Test' && saved.theme === 'dark' && saved.count === 3 && saved.difficulty === 'easy', 'settings saved to the profile');
    check((await js<string>(`document.documentElement.dataset.theme`)) === 'dark' && win.webContents.getZoomFactor() === 1.15, 'dark theme and large text applied');
    check(
      (await js<string>(`document.querySelector('#candidate').value`)) === 'Smoke Test' &&
        (await js<string>(`document.querySelector('#practice-count').value`)) === '3' &&
        (await js<string>(`document.querySelector('#practice-difficulty').value`)) === 'easy',
      'home uses the profile name and training defaults',
    );
    check(/Your exam is in \d+ days/.test(await text('#exam-countdown')), 'study plan counts down to the exam date');
    await shot('home-dark');
    await js(`document.querySelector('#practice-difficulty').value = 'mixed'`);
    await js(`document.querySelector('#candidate').value = 'Smoke Test'`);
    await click('#start-exam');
    await waitFor('#nda-accept');
    check(lockdown.isLocked && win.isKiosk() && win.isAlwaysOnTop(), 'locked from the NDA screen: kiosk, always on top');
    await click('#nda-accept');
    await waitFor('#tutorial-start');
    await click('#tutorial-start');
    await waitFor('#exam');
    check((await text('#question-progress')).startsWith('0 answered'), 'question progress bar starts at 0 answered');
    check(/^0:00:0\d of 3:00:00$/.test(await text('#time-progress')), `time progress bar shows elapsed of 3 hours (${await text('#time-progress')})`);
    check((await text('#pace')) === 'On pace', 'pace hint shows On pace at the start');
    await shot('exam');
    win.close();
    check(!win.isDestroyed(), 'window cannot be closed during the exam');
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
        await shot('exam-question-11');
      }
    }
    await waitFor('#outcome');
    check(answered >= 100 && answered <= 150, `exam ended between 100 and 150 questions (${answered})`);
    const outcome = await js<string>(`document.querySelector('#outcome').textContent`);
    const rows = await js<number>(`document.querySelectorAll('#domain-report tr').length`);
    check(rows === 9, `score report shows ${outcome.trim()} with all 8 domains`);
    check(!lockdown.isLocked && !win.isKiosk(), 'lockdown released after the exam');

    await click('#review');
    await waitFor('#review-list');
    const reviewed = await js<number>(`document.querySelectorAll('#review-list article').length`);
    check(reviewed === answered, `review lists every answered question (${reviewed})`);
    await js(`(() => { const b = document.querySelector('#review-wrong'); b.click(); })()`);
    const wrongShown = await js<number>(`document.querySelectorAll('#review-list article:not([hidden])').length`);
    const wrongTotal = await js<number>(`document.querySelectorAll('#review-list article.wrong').length`);
    check(wrongShown === wrongTotal, `review filter shows only incorrect answers (${wrongShown})`);

    await click('#review-home');
    await waitFor('#history');
    check((await js<number>(`document.querySelectorAll('#history tr').length`)) === 2, 'result saved to history');
    check((await text('#stat-exams')).startsWith('1'), 'home summary counts the exam');
    await shot('home-after-exam');

    await js(`document.querySelector('#practice-count').value = '2'`);
    await click('#start-practice');
    await waitFor('#practice');
    const key = (k: string): Promise<void> => js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)} }))`);
    await key('a');
    await key('b');
    await key('Enter');
    await waitFor('#feedback .explanation');
    check(true, 'training mode answers by keyboard and shows the explanation');
    const verdict = await text('#feedback .verdict');
    const marked = await js<number>(`document.querySelectorAll('#practice .is-answer').length`);
    check(/^(✔ Correct!|✘ Incorrect\.)/.test(verdict) && marked > 0, `answer marked right or wrong at once, correct option highlighted (${verdict.slice(0, 12)})`);
    await shot('training-feedback');
    await click('#bookmark');
    await waitFor('#bookmark[aria-pressed="true"]');
    check(true, 'a training question can be bookmarked');
    await key('Enter');
    await waitFor('#practice:not(:has(#feedback .explanation))');
    check((await js<string>(`document.querySelector('#qnum').textContent`)) === 'Question 2 of 2', 'Enter moves to the next training question');
    await click('#practice-stop');
    await waitFor('#practice-domains');
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
    await waitFor('#open-history');
    await click('#open-history');
    await waitFor('#history-screen');
    const sessions = await js<number>(`document.querySelectorAll('#training-history tr.entry').length`);
    check(sessions === 2, `history lists both training sessions (${sessions})`);
    check((await js<number>(`document.querySelectorAll('#domain-progress tr').length`)) === 9, 'history shows training accuracy for all 8 domains');
    await shot('history');
    await click('#exam-history .delete-entry');
    await waitFor('#history-screen:not(:has(#exam-history))');
    check((await js<number>(`window.examApi.info().then((i) => i.history.length)`)) === 0, 'an exam can be deleted from the history');

    // Folder import: one summary for added, already imported and invalid files; an imported bank can be removed.
    await click('#history-home');
    await waitFor('#import-bank');
    const folder = await mkdtemp(path.join(os.tmpdir(), 'catexam-smoke-banks-'));
    const q = (id: string): object => ({ id, domain: 3, type: 'single', difficulty: 0, stem: `Smoke ${id}?`, options: ['a', 'b', 'c', 'd'], answer: [1], explanation: 'e' });
    await writeFile(path.join(folder, 'new.json'), JSON.stringify({ name: 'Smoke bank', questions: [q('SMK-1'), q('SMK-2')] }));
    await writeFile(path.join(folder, 'dup.json'), JSON.stringify({ name: 'CISSP Domain 1 – Security and Risk Management', questions: [q('SMK-3')] }));
    await writeFile(path.join(folder, 'bad.json'), JSON.stringify({ name: 'Bad', questions: [{ ...q('SMK-4'), domain: 12 }] }));
    process.env.CATEXAM_SMOKE_IMPORT = folder;
    const before = await js<number>(`window.examApi.info().then((i) => i.bank.total)`);
    await click('#import-bank');
    await waitFor('#import-summary');
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
