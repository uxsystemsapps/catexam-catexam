// Renderer: candidate-facing screens. All exam rules (timing, scoring, no going back) live in the main
// process; this script only shows what the main process hands out.

const api = window.examApi;
const root = document.getElementById('app') as HTMLElement;
const LETTERS = 'ABCDEFGH';
const NDA_SECONDS = 5 * 60;

type Child = Node | string | null | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | ((e: Event) => void)> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false) el.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== false) el.append(c);
  return el;
}

function show(...nodes: Node[]): void {
  root.replaceChildren(...nodes);
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return `${hh}:${String(mm).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function modal(title: string, text: string, buttons: { label: string; id: string; primary?: boolean; onClick: () => void }[]): void {
  const overlay = h('div', { class: 'overlay', id: 'modal' });
  const close = (): void => overlay.remove();
  overlay.append(
    h(
      'div',
      { class: 'dialog', role: 'dialog' },
      h('h2', {}, title),
      h('p', {}, text),
      h(
        'div',
        { class: 'dialog-buttons' },
        ...buttons.map((b) =>
          h('button', { id: b.id, class: b.primary ? 'primary' : '', onclick: () => { close(); b.onClick(); } }, b.label),
        ),
      ),
    ),
  );
  document.body.append(overlay);
}

function toast(message: string): void {
  const t = h('div', { class: 'toast', role: 'alert' }, message);
  document.body.append(t);
  setTimeout(() => t.remove(), 6000);
}

// ---------- Home ----------

async function home(): Promise<void> {
  const info = await api.info();
  const nameInput = h('input', { id: 'candidate', type: 'text', placeholder: 'Candidate name', maxlength: '80' });
  const domainBoxes = info.bank.byDomain.map((d) =>
    h('label', { class: 'check' }, h('input', { type: 'checkbox', value: String(d.domain), checked: true }), ` Domain ${d.domain}: ${d.name} (${d.count})`),
  );
  const countInput = h('input', { id: 'practice-count', type: 'number', min: '1', max: '200', value: '20' });
  const shortBank = info.bank.total < 150;

  show(
    h('header', { class: 'topbar' }, h('span', { class: 'brand' }, 'CATExam'), h('span', {}, 'CISSP Computerized Adaptive Testing simulator')),
    h(
      'main',
      { class: 'home', id: 'home' },
      h(
        'section',
        { class: 'card' },
        h('h2', {}, 'Exam simulation'),
        h('p', {}, '100–150 questions, 3 hours, adaptive difficulty, no going back. The screen is locked as in a test centre until the exam ends.'),
        info.displays > 1 && h('p', { class: 'warn' }, `${info.displays} displays detected. A test centre uses one; disconnect the others for a realistic session.`),
        shortBank && h('p', { class: 'warn' }, `The question bank has only ${info.bank.total} questions; the exam may end early when it runs out.`),
        nameInput,
        h('button', { id: 'start-exam', class: 'primary', onclick: () => void nda(nameInput.value.trim() || 'Candidate') }, 'Start exam simulation'),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, 'Training mode'),
        h('p', {}, 'Choose domains; see the right answer and the explanation after each question. Not locked, no clock.'),
        h('div', { class: 'domains' }, ...domainBoxes),
        h('label', {}, 'Questions: ', countInput),
        h(
          'button',
          {
            id: 'start-practice',
            onclick: () => {
              const domains = domainBoxes
                .map((l) => l.querySelector('input') as HTMLInputElement)
                .filter((i) => i.checked)
                .map((i) => Number(i.value) as DomainId);
              if (domains.length === 0) return toast('Choose at least one domain.');
              void startPractice(domains, Number(countInput.value) || 20);
            },
          },
          'Start training',
        ),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, 'Question bank'),
        h('p', {}, `${info.bank.total} questions. Imported banks: ${info.importedBanks.join(', ') || 'none'}.`),
        h('table', {}, ...info.bank.byDomain.map((d) => h('tr', {}, h('td', {}, `${d.domain}. ${d.name}`), h('td', {}, `${Math.round(d.weight * 100)}%`), h('td', {}, String(d.count))))),
        info.bankErrors.length > 0 && h('p', { class: 'warn' }, `Skipped: ${info.bankErrors.slice(0, 3).join('; ')}`),
        h(
          'button',
          {
            id: 'import-bank',
            onclick: async () => {
              const r = await api.importBank();
              if (r.errors.length > 0) toast(`Import refused: ${r.errors.slice(0, 3).join('; ')}`);
              else if (r.imported) {
                toast(`Imported ${r.imported}.`);
                void home();
              }
            },
          },
          'Import question bank (JSON)…',
        ),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, 'History'),
        info.history.length === 0
          ? h('p', {}, 'No exams taken yet.')
          : h(
              'table',
              { id: 'history' },
              h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Result'), h('th', {}, 'Score*'), h('th', {}, 'Items'), h('th', {}, 'Time')),
              ...info.history.slice(0, 10).map((e) =>
                h(
                  'tr',
                  {},
                  h('td', {}, new Date(e.date).toLocaleString()),
                  h('td', { class: e.passed ? 'pass' : 'fail' }, e.passed ? 'PASS' : 'FAIL'),
                  h('td', {}, String(e.scaledScore)),
                  h('td', {}, String(e.itemsAnswered)),
                  h('td', {}, formatClock(e.elapsedSeconds)),
                ),
              ),
            ),
        h('p', { class: 'small' }, '* Training estimate on the 0–1000 scale; 700 is the passing standard.'),
        h('button', { id: 'quit', onclick: () => void api.quit() }, 'Quit'),
      ),
    ),
  );
}

// ---------- NDA and tutorial (as at the test centre) ----------

async function nda(candidate: string): Promise<void> {
  await api.lock();
  let left = NDA_SECONDS;
  const clock = h('span', { id: 'nda-clock' }, formatClock(left));
  const timer = setInterval(() => {
    left--;
    clock.textContent = formatClock(left);
    if (left <= 0) {
      clearInterval(timer);
      void api.unlock().then(() => {
        toast('The agreement was not accepted in time. The exam has ended, as it would at the test centre.');
        void home();
      });
    }
  }, 1000);
  show(
    h('header', { class: 'topbar' }, h('span', { class: 'brand' }, 'Non-Disclosure Agreement and General Terms of Use'), h('span', {}, 'Time remaining to accept: ', clock)),
    h(
      'main',
      { class: 'page' },
      h('h2', {}, 'Non-Disclosure Agreement'),
      h('p', {}, 'This exam is confidential. You agree not to disclose, copy or share any part of it. You agree that you will not use any aid other than those provided at the test centre.'),
      h('p', {}, 'You must accept within 5 minutes. If you decline or the time runs out, the exam ends and is not delivered.'),
    ),
    h(
      'footer',
      { class: 'bottombar' },
      h('button', { id: 'nda-decline', onclick: () => { clearInterval(timer); void api.unlock().then(home); } }, 'I do not accept'),
      h('button', { id: 'nda-accept', class: 'primary', onclick: () => { clearInterval(timer); tutorial(candidate); } }, 'I accept'),
    ),
  );
}

function tutorial(candidate: string): void {
  show(
    h('header', { class: 'topbar' }, h('span', { class: 'brand' }, 'Tutorial'), h('span', {}, candidate)),
    h(
      'main',
      { class: 'page' },
      h('h2', {}, 'How this exam works'),
      h(
        'ul',
        {},
        h('li', {}, 'You have 3 hours. The exam has 100 to 150 questions and stops as soon as the result is clear with 95% confidence.'),
        h('li', {}, 'Each question adapts to your previous answers. Some questions are unscored research items; you cannot tell which.'),
        h('li', {}, 'You must answer every question. Once you select Next you cannot return to it, and you cannot mark questions for review.'),
        h('li', {}, 'Right-click an option to strike it out. For drag-and-drop questions, drag the items (or use the arrows) into the right order.'),
        h('li', {}, 'You may take a break at any time, but the clock keeps running.'),
        h('li', {}, 'The screen is locked: leaving the exam window is recorded as an incident.'),
      ),
    ),
    h(
      'footer',
      { class: 'bottombar' },
      h('span', {}),
      h('button', { id: 'tutorial-start', class: 'primary', onclick: () => void startExam(candidate) }, 'Begin the exam'),
    ),
  );
}

// ---------- Exam ----------

let clockTimer: number | undefined;
let examOver = false;

async function startExam(candidate: string): Promise<void> {
  examOver = false;
  const state = await api.startExam(candidate);
  const clock = h('span', { id: 'clock' });
  const tick = (): void => {
    const left = (state.deadline - Date.now()) / 1000;
    clock.textContent = formatClock(left);
    clock.classList.toggle('low', left < 300);
  };
  tick();
  clearInterval(clockTimer);
  clockTimer = window.setInterval(tick, 1000);
  renderExamQuestion(state, candidate, clock);
}

function finishExam(): void {
  if (examOver) return;
  examOver = true;
  clearInterval(clockTimer);
  document.getElementById('modal')?.remove();
  void api.result().then(resultScreen);
}

function questionBody(q: QuestionView): { node: HTMLElement; response: () => number[] } {
  const struck = new Set<number>();
  if (q.type === 'ordering') {
    const list = h('ol', { class: 'ordering', id: 'ordering' });
    let dragged: HTMLElement | null = null;
    const move = (li: HTMLElement, delta: number): void => {
      const sibling = delta < 0 ? li.previousElementSibling : li.nextElementSibling?.nextElementSibling ?? null;
      if (delta < 0 && !sibling) return;
      list.insertBefore(li, sibling);
    };
    q.options.forEach((text, i) => {
      const li = h(
        'li',
        { draggable: 'true', 'data-index': String(i), class: 'drag-item' },
        h('span', { class: 'grip' }, '⋮⋮'),
        h('span', { class: 'text' }, text),
        h('button', { class: 'mini', title: 'Move up', onclick: () => move(li, -1) }, '▲'),
        h('button', { class: 'mini', title: 'Move down', onclick: () => move(li, 1) }, '▼'),
      );
      li.addEventListener('dragstart', () => { dragged = li; li.classList.add('dragging'); });
      li.addEventListener('dragend', () => { dragged = null; li.classList.remove('dragging'); });
      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!dragged || dragged === li) return;
        const r = li.getBoundingClientRect();
        list.insertBefore(dragged, e.clientY < r.top + r.height / 2 ? li : li.nextElementSibling);
      });
      list.append(li);
    });
    return {
      node: h('div', {}, h('p', { class: 'hint' }, 'Drag the items into the correct order (first at the top).'), list),
      response: () => [...list.querySelectorAll('li')].map((li) => Number(li.dataset.index)),
    };
  }
  const multi = q.type === 'multi';
  const inputs: HTMLInputElement[] = [];
  const rows = q.options.map((text, i) => {
    const input = h('input', { type: multi ? 'checkbox' : 'radio', name: 'option', value: String(i), id: `opt-${i}` });
    inputs.push(input);
    const row = h('label', { class: 'option', for: `opt-${i}` }, input, h('span', { class: 'letter' }, `${LETTERS[i]}.`), h('span', { class: 'text' }, text));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (struck.has(i)) struck.delete(i);
      else struck.add(i);
      row.classList.toggle('struck', struck.has(i));
    });
    return row;
  });
  return {
    node: h('div', { class: 'options' }, ...rows),
    response: () => inputs.filter((x) => x.checked).map((x) => Number(x.value)),
  };
}

function renderExamQuestion(state: ExamState, candidate: string, clock: HTMLElement): void {
  if (state.finished || !state.question) return finishExam();
  const q = state.question;
  const body = questionBody(q);
  const next = async (): Promise<void> => {
    const response = body.response();
    const needed = q.type === 'multi' ? q.selectCount : q.type === 'single' ? 1 : q.options.length;
    if (response.length !== needed) {
      modal('Answer required', q.type === 'multi' ? `Select ${q.selectCount} options to continue.` : 'You must answer this question before continuing.', [
        { label: 'OK', id: 'modal-ok', primary: true, onClick: () => undefined },
      ]);
      return;
    }
    nextButton.disabled = true;
    try {
      renderExamQuestion(await api.answer(q.id, response), candidate, clock);
    } catch {
      finishExam();
    }
  };
  const nextButton = h('button', { id: 'next', class: 'primary', onclick: () => void next() }, 'Next ▶');
  show(
    h(
      'header',
      { class: 'topbar' },
      h('span', { class: 'brand' }, 'ISC2 CISSP – Certified Information Systems Security Professional'),
      h('span', { class: 'right' }, h('span', { id: 'candidate-name' }, candidate), h('span', {}, 'Time Remaining ', clock), h('span', { id: 'qnum' }, `Question ${q.number}`)),
    ),
    h('main', { class: 'question', id: 'exam' }, h('p', { class: 'stem' }, q.stem), body.node),
    h(
      'footer',
      { class: 'bottombar' },
      h(
        'div',
        {},
        h('button', { id: 'break', onclick: () => void takeBreak(clock) }, 'Break'),
        h(
          'button',
          {
            id: 'end-exam',
            onclick: () =>
              modal('End exam', 'Ending now scores the exam as a FAIL, as leaving early would. End the exam?', [
                { label: 'Return to exam', id: 'end-cancel', onClick: () => undefined },
                { label: 'End exam', id: 'end-confirm', primary: true, onClick: () => void api.endExam().then(finishExam) },
              ]),
          },
          'End Exam',
        ),
      ),
      nextButton,
    ),
  );
}

async function takeBreak(clock: HTMLElement): Promise<void> {
  await api.takeBreak();
  const overlay = h(
    'div',
    { class: 'overlay break', id: 'break-screen' },
    h(
      'div',
      { class: 'dialog' },
      h('h2', {}, 'Break'),
      h('p', {}, 'The exam clock keeps running during your break.'),
      h('p', { class: 'big' }, 'Time remaining: ', clock.cloneNode(true)),
      h('button', { id: 'break-return', class: 'primary', onclick: () => overlay.remove() }, 'Return to exam'),
    ),
  );
  const copy = overlay.querySelector('#clock');
  const sync = setInterval(() => {
    if (!overlay.isConnected) return clearInterval(sync);
    if (copy) copy.textContent = clock.textContent;
  }, 500);
  document.body.append(overlay);
}

// ---------- Results ----------

const REASONS: Record<string, string> = {
  'pass-confidence': 'The exam stopped early: your ability was above the passing standard with 95% confidence.',
  'fail-confidence': 'The exam stopped early: your ability was below the passing standard with 95% confidence.',
  'max-items': 'You reached the maximum of 150 questions; the final ability estimate decided the result.',
  'time-expired': 'Time ran out. With at least 100 answers, you pass only if your estimate stayed above the standard over the last 75 scored questions.',
  'bank-exhausted': 'The question bank ran out of questions; the final ability estimate decided the result.',
  'ended-by-candidate': 'You ended the exam before it finished.',
};

function resultScreen(r: ExamResult): void {
  show(
    h('header', { class: 'topbar' }, h('span', { class: 'brand' }, 'Examination Score Report'), h('span', {}, 'CISSP (simulation)')),
    h(
      'main',
      { class: 'page', id: 'result' },
      h('h1', { class: r.passed ? 'pass' : 'fail', id: 'outcome' }, r.passed ? 'Congratulations! You PASSED.' : 'You did not pass.'),
      h('p', {}, REASONS[r.reason] ?? r.reason),
      h(
        'p',
        {},
        `Questions answered: ${r.itemsAnswered} (${r.scoredItems} scored). Time used: ${formatClock(r.elapsedSeconds)}. Breaks: ${r.breaks}. `,
        `Training score estimate: ${r.scaledScore} / 1000 (pass = 700).`,
      ),
      h('h2', {}, 'Performance by domain'),
      h(
        'table',
        { id: 'domain-report' },
        h('tr', {}, h('th', {}, 'Domain'), h('th', {}, 'Weight'), h('th', {}, 'Scored items'), h('th', {}, 'Correct'), h('th', {}, 'Proficiency')),
        ...r.domains.map((d) =>
          h(
            'tr',
            {},
            h('td', {}, `${d.domain}. ${d.name}`),
            h('td', {}, `${Math.round(d.weight * 100)}%`),
            h('td', {}, String(d.answered)),
            h('td', {}, String(d.correct)),
            h('td', { class: d.band.startsWith('Below') ? 'fail' : d.band.startsWith('Above') ? 'pass' : '' }, d.band),
          ),
        ),
      ),
      r.incidents.length > 0 &&
        h('div', {}, h('h2', {}, 'Incidents recorded'), h('ul', {}, ...r.incidents.map((i) => h('li', {}, `${formatClock(i.at)} – ${i.detail}`)))),
    ),
    h(
      'footer',
      { class: 'bottombar' },
      h('button', { id: 'review', onclick: () => reviewScreen(r) }, 'Review answers'),
      h('button', { id: 'result-home', class: 'primary', onclick: () => void home() }, 'Back to start'),
    ),
  );
}

function answerText(options: string[], indices: number[], ordering: boolean): string {
  if (indices.length === 0) return '(not answered)';
  return ordering ? indices.map((i) => options[i]).join(' → ') : indices.map((i) => `${LETTERS[i]}. ${options[i]}`).join('; ');
}

function reviewScreen(r: ExamResult): void {
  show(
    h('header', { class: 'topbar' }, h('span', { class: 'brand' }, 'Answer review'), h('span', {}, `${r.review.filter((i) => i.correct).length} of ${r.review.length} correct`)),
    h(
      'main',
      { class: 'page review', id: 'review-list' },
      ...r.review.map((item) =>
        h(
          'article',
          { class: item.correct ? 'right' : 'wrong' },
          h('h3', {}, `Question ${item.number} · Domain ${item.domain}${item.pretest ? ' · unscored pretest item' : ''} · ${item.correct ? 'Correct' : 'Incorrect'}`),
          h('p', { class: 'stem' }, item.stem),
          h('p', {}, h('strong', {}, 'Your answer: '), answerText(item.options, item.response, item.type === 'ordering')),
          h('p', {}, h('strong', {}, 'Correct answer: '), answerText(item.options, item.answer, item.type === 'ordering')),
          h('p', { class: 'explanation' }, item.explanation),
        ),
      ),
    ),
    h('footer', { class: 'bottombar' }, h('button', { onclick: () => resultScreen(r) }, '◀ Score report'), h('button', { id: 'review-home', class: 'primary', onclick: () => void home() }, 'Back to start')),
  );
}

// ---------- Training mode ----------

async function startPractice(domains: DomainId[], count: number): Promise<void> {
  const { question, total } = await api.startPractice(domains, count);
  renderPractice(question, total);
}

function renderPractice(q: QuestionView, total: number): void {
  const body = questionBody(q);
  const feedback = h('div', { id: 'feedback' });
  const button = h('button', { id: 'check', class: 'primary' }, 'Check answer');
  button.addEventListener('click', async () => {
    const response = body.response();
    const needed = q.type === 'multi' ? q.selectCount : q.type === 'single' ? 1 : q.options.length;
    if (response.length !== needed) return toast(q.type === 'multi' ? `Select ${q.selectCount} options.` : 'Choose an answer.');
    button.disabled = true;
    const { feedback: f, next } = await api.answerPractice(q.id, response);
    feedback.replaceChildren(
      h('p', { class: f.correct ? 'pass' : 'fail' }, f.correct ? 'Correct.' : 'Incorrect.'),
      h('p', {}, h('strong', {}, 'Correct answer: '), answerText(q.options, f.answer, q.type === 'ordering')),
      h('p', { class: 'explanation' }, f.explanation),
    );
    const go = h('button', { id: 'practice-next', class: 'primary' }, next ? 'Next question ▶' : 'See summary');
    go.addEventListener('click', () => (next ? renderPractice(next, total) : void practiceSummary()));
    button.replaceWith(go);
  });
  show(
    h('header', { class: 'topbar' }, h('span', { class: 'brand' }, 'Training mode'), h('span', { id: 'qnum' }, `Question ${q.number} of ${total}`)),
    h('main', { class: 'question', id: 'practice' }, h('p', { class: 'stem' }, q.stem), body.node, feedback),
    h('footer', { class: 'bottombar' }, h('button', { onclick: () => void practiceSummary() }, 'Stop'), button),
  );
}

async function practiceSummary(): Promise<void> {
  const s = await api.practiceSummary();
  show(
    h('header', { class: 'topbar' }, h('span', { class: 'brand' }, 'Training summary'), h('span', {}, `${s.correct} of ${s.answered} correct`)),
    h(
      'main',
      { class: 'page', id: 'practice-summary' },
      h('table', {}, h('tr', {}, h('th', {}, 'Domain'), h('th', {}, 'Answered'), h('th', {}, 'Correct')), ...s.byDomain.map((d) => h('tr', {}, h('td', {}, String(d.domain)), h('td', {}, String(d.answered)), h('td', {}, String(d.correct))))),
      s.missed.length > 0 && h('h2', {}, 'Questions to revisit'),
      ...s.missed.map((m) => h('article', { class: 'wrong' }, h('p', { class: 'stem' }, m.stem), h('p', { class: 'explanation' }, m.explanation))),
    ),
    h('footer', { class: 'bottombar' }, h('span', {}), h('button', { class: 'primary', onclick: () => void home() }, 'Back to start')),
  );
}

// ---------- Wiring ----------

api.onTimeout(() => {
  toast('Time is up.');
  finishExam();
});
api.onIncident((message) => toast(message));
document.addEventListener('copy', (e) => e.preventDefault());
document.addEventListener('cut', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());
void home();
