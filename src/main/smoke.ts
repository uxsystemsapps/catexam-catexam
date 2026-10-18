import type { BrowserWindow } from 'electron';
import type { Lockdown } from './lockdown';

/**
 * Headless end-to-end run (CATEXAM_SMOKE=1, used by `npm run smoke` in the gates): drives the real
 * screens through a full exam and a short training session, checking the lockdown along the way.
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

  try {
    await waitFor('#start-exam');
    const total = await js<number>(`window.examApi.info().then((i) => i.bank.total)`);
    check(total >= 150, `question bank loaded (${total} questions)`);
    await js(`document.querySelector('#candidate').value = 'Smoke Test'`);
    await click('#start-exam');
    await waitFor('#nda-accept');
    check(lockdown.isLocked && win.isKiosk() && win.isAlwaysOnTop(), 'locked from the NDA screen: kiosk, always on top');
    await click('#nda-accept');
    await waitFor('#tutorial-start');
    await click('#tutorial-start');
    await waitFor('#exam');
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

    await click('#review-home');
    await waitFor('#history');
    check((await js<number>(`document.querySelectorAll('#history tr').length`)) === 2, 'result saved to history');

    await js(`document.querySelector('#practice-count').value = '2'`);
    await click('#start-practice');
    await waitFor('#practice');
    await js(`(() => { const b = document.querySelector('#practice input'); if (b) b.click(); })()`);
    await click('#check');
    await waitFor('#feedback .explanation');
    check(true, 'training mode shows the explanation after answering');

    console.log('SMOKE OK');
    return true;
  } catch (err) {
    console.error(`SMOKE FAILED: ${(err as Error).message}`);
    return false;
  }
}
