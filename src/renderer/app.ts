// Renderer: candidate-facing screens. All exam rules (timing, scoring, no going back) live in the main
// process; this script only shows what the main process hands out.

const api = window.examApi;
const root = document.getElementById('app') as HTMLElement;
const LETTERS = 'ABCDEFGH';
const NDA_SECONDS = 5 * 60;

/** Domain names from the last `info()` call, for screens that only get domain numbers. */
const domainNames = new Map<number, string>();

/** Keyboard handler of the current question screen; `show()` clears it. */
let keyHandler: ((e: KeyboardEvent) => void) | null = null;

/** What the Android back button does on the current screen (after closing a dialog or the question list); `show()` clears it. */
let backAction: (() => void) | null = null;

/** `mobile` in the Android app; set from the first `info()` call. */
let platform: AppInfo['platform'] = 'desktop';

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

/** Shows an app screen in the modern look (`html[data-look='modern']` in the CSS). */
function show(...nodes: Node[]): void {
  showLook('modern', nodes);
}

/**
 * Shows a screen of the exam simulator (NDA, tutorial, questions, score report, answer review) or of the game mode in
 * its own look (`html[data-look='classic']`): the redesign of the other screens leaves these as they are.
 */
function showClassic(...nodes: Node[]): void {
  showLook('classic', nodes);
}

function showLook(look: 'modern' | 'classic', nodes: Node[]): void {
  keyHandler = null;
  backAction = null;
  stopGameMusic();
  document.documentElement.dataset.look = look;
  root.replaceChildren(...nodes);
  root.querySelector('main')?.scrollTo(0, 0);
  root.querySelector('.navigator .current')?.scrollIntoView({ block: 'nearest' });
}

function percent(correct: number, answered: number): string {
  return answered === 0 ? '–' : `${Math.round((correct / answered) * 100)}%`;
}

function meter(correct: number, answered: number): HTMLElement {
  const bar = h('span', { class: 'meter-fill' });
  bar.style.width = answered === 0 ? '0' : `${(correct / answered) * 100}%`;
  return h('span', { class: 'meter' }, bar);
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return `${hh}:${String(mm).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function modal(title: string, body: string | Node, buttons: { label: string; id: string; primary?: boolean; onClick: () => void }[]): void {
  const overlay = h('div', { class: 'overlay', id: 'modal' });
  const close = (): void => overlay.remove();
  overlay.append(
    h(
      'div',
      { class: 'dialog', role: 'dialog' },
      h('h2', {}, title),
      typeof body === 'string' ? h('p', {}, body) : body,
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
  overlay.querySelector('button')?.focus();
}

function toast(message: string): void {
  const t = h('div', { class: 'toast', role: 'alert' }, message);
  document.body.append(t);
  setTimeout(() => t.remove(), 6000);
}

/** Opens or closes the question list; on a phone it is a sheet over the question, on a desktop it is always shown. */
function setNavOpen(open: boolean): void {
  document.querySelector('.workspace')?.classList.toggle('nav-open', open);
  document.getElementById('nav-toggle')?.setAttribute('aria-expanded', String(open));
  if (open) document.querySelector('.navigator .current')?.scrollIntoView({ block: 'nearest' });
}

/** Phone-only button of the question screens that shows the question list. */
function navToggle(): HTMLElement {
  return h(
    'button',
    { id: 'nav-toggle', class: 'nav-toggle', 'aria-controls': 'navigator', 'aria-expanded': 'false', onclick: () => setNavOpen(!document.querySelector('.workspace.nav-open')) },
    'Questions',
  );
}

/** Question screen body: the question list (a sheet on phones, with a backdrop that closes it) and the question. */
function workspace(navigator: HTMLElement, main: HTMLElement): HTMLElement {
  return h('div', { class: 'workspace' }, navigator, h('div', { class: 'nav-backdrop', onclick: () => setNavOpen(false) }), main);
}

type Tab = 'home' | 'train' | 'game' | 'history' | 'settings';

/** Outline icons of the tab bar (24×24 stroke paths): house, graduation cap, gamepad, clock, gear. */
const TAB_ICONS: Record<Tab, string[]> = {
  home: ['M3 10.5 12 3l9 7.5', 'M5 9v12h5v-6h4v6h5V9'],
  train: ['M2 9l10-5 10 5-10 5z', 'M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5', 'M22 9v6'],
  game: ['M7 6h10a5 5 0 0 1 5 5v2a4 4 0 0 1-7 2.6L14 14h-4l-1 1.6A4 4 0 0 1 2 13v-2a5 5 0 0 1 5-5z', 'M7 9v4M5 11h4', 'M15.5 10.5h.01M17.5 12.5h.01'],
  history: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', 'M12 7v5l3 2'],
  settings: [
    'M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0z',
    'M14.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
    'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1',
  ],
};

function tabIcon(id: Tab): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: '26', height: '26', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' }))
    svg.setAttribute(k, v);
  for (const d of TAB_ICONS[id]) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** Bottom navigation of the start and history screens on phones (hidden on the desktop, which has the top buttons). Icons only; the name is the button's label. */
function tabbar(active: Tab): HTMLElement {
  const tab = (id: Tab, label: string, open: () => void): HTMLElement =>
    h('button', { id: `tab-${id}`, class: id === active ? 'tab active' : 'tab', 'aria-label': label, title: label, 'aria-current': id === active ? 'page' : false, onclick: open }, tabIcon(id));
  return h(
    'nav',
    { class: active === 'game' ? 'tabbar game-tabs' : 'tabbar', 'aria-label': 'Sections' },
    tab('home', 'Home', () => void home()),
    tab('train', 'Train', () => void home('train').then(() => document.getElementById('training-card')?.scrollIntoView({ block: 'start' }))),
    tab('game', 'Game', () => void gameHub()),
    tab('history', 'History', () => void historyScreen()),
    tab('settings', 'Settings', () => void settingsScreen()),
  );
}

/** One summary of an import (a folder, or picked files): what was added, what was skipped as already imported, and why files failed. */
function showImportSummary(s: BankImportSummary): void {
  const skipped = s.files.filter((f) => f.status === 'skipped');
  const failed = s.files.filter((f) => f.status === 'failed');
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
  const body = h(
    'div',
    { id: 'import-summary' },
    s.error
      ? h('p', { class: 'warn' }, `Nothing imported: ${s.error}`)
      : h('p', { id: 'import-totals' }, `${plural(s.files.length, 'file')} found: ${plural(s.added, 'file')} added with ${plural(s.questions, 'question')}, ${skipped.length} skipped, ${failed.length} failed.`),
    !s.error && s.files.length === 0 && h('p', {}, platform === 'mobile' ? 'None of the chosen files is a .json file.' : 'The folder has no .json files.'),
    skipped.length > 0 &&
      h('div', { id: 'import-skipped' }, h('h3', {}, 'Skipped (already imported)'), h('ul', {}, ...skipped.map((f) => h('li', {}, `${f.file}: bank "${f.bank}" is already imported.`)))),
    failed.length > 0 &&
      h(
        'div',
        { id: 'import-failed' },
        h('h3', {}, 'Failed'),
        h('ul', {}, ...failed.map((f) => h('li', {}, h('strong', {}, f.file), h('ul', {}, ...f.errors.map((e) => h('li', {}, e)))))),
      ),
  );
  modal('Import summary', body, [{ label: 'OK', id: 'import-ok', primary: true, onClick: () => void home() }]);
}

// ---------- Home ----------

const DIFFICULTY_LABELS: Record<PracticeOptions['difficulty'], string> = { mixed: 'Mixed', easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const TYPE_LABELS: Record<QuestionType, string> = { single: 'Single answer', multi: 'Multiple answers', ordering: 'Ordering (drag and drop)' };
const ORDER_LABELS: Record<PracticeOptions['order'], string> = { random: 'Random', 'unseen-first': 'New questions first', 'missed-first': 'Missed questions first' };
const SOURCE_LABELS: Record<PracticeOptions['source'], string> = { all: 'Whole bank', missed: 'Questions I got wrong', bookmarked: 'Bookmarked questions' };
const TIMER_CHOICES = [0, 30, 60, 90, 120];

/** Profile of the last `info()` call; the screens edit a copy and save it through the main process. */
let profile: Profile;

function applyAppearance(p: Profile): void {
  document.documentElement.dataset.theme = p.theme;
}

function select<T extends string | number>(id: string, labels: [T, string][], value: T): HTMLSelectElement {
  return h('select', { id }, ...labels.map(([v, label]) => h('option', { value: String(v), selected: v === value }, label)));
}

function stat(id: string, value: string, label: string): HTMLElement {
  return h('div', { class: 'stat', id }, h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-label' }, label));
}

/** Training settings form, used on the home screen (prefix `practice`) and for the saved defaults (prefix `default`). */
function trainingForm(info: AppInfo, prefix: string, value: PracticeOptions): { node: HTMLElement; read: () => PracticeOptions | null } {
  const domainBoxes = info.bank.byDomain.map((d) =>
    h(
      'label',
      { class: 'chip', title: d.name },
      h('input', { type: 'checkbox', value: String(d.domain), checked: d.count > 0 && value.domains.includes(d.domain), disabled: d.count === 0 }),
      h('span', { class: 'chip-num' }, String(d.domain)),
      h('span', { class: 'chip-name' }, d.name),
      h('span', { class: 'chip-count' }, String(d.count)),
    ),
  );
  const setAll = (on: boolean): void => {
    for (const l of domainBoxes) {
      const box = l.querySelector('input') as HTMLInputElement;
      if (!box.disabled) box.checked = on;
    }
  };
  const typeBoxes = (Object.keys(TYPE_LABELS) as QuestionType[]).map((t) =>
    h('label', { class: 'check' }, h('input', { type: 'checkbox', value: t, checked: value.types.includes(t) }), ` ${TYPE_LABELS[t]}`),
  );
  const count = h('input', { id: `${prefix}-count`, type: 'number', min: '1', max: '200', value: String(value.count) });
  const difficulty = select(`${prefix}-difficulty`, Object.entries(DIFFICULTY_LABELS) as [PracticeOptions['difficulty'], string][], value.difficulty);
  const order = select(`${prefix}-order`, Object.entries(ORDER_LABELS) as [PracticeOptions['order'], string][], value.order);
  const source = select(`${prefix}-source`, Object.entries(SOURCE_LABELS) as [PracticeOptions['source'], string][], value.source);
  const timer = select(`${prefix}-timer`, TIMER_CHOICES.map((s): [number, string] => [s, s === 0 ? 'Off' : `${s} s per question`]), value.secondsPerQuestion);
  const node = h(
    'div',
    { class: 'training-form', id: `${prefix}-form` },
    h(
      'div',
      { class: 'row between' },
      h('span', { class: 'label' }, 'Domains'),
      h('span', { class: 'row' }, h('button', { class: 'mini', id: `${prefix}-domains-all`, onclick: () => setAll(true) }, 'All'), h('button', { class: 'mini', id: `${prefix}-domains-none`, onclick: () => setAll(false) }, 'None')),
    ),
    h('div', { class: 'domains' }, ...domainBoxes),
    h('div', { class: 'row wrap', id: `${prefix}-types` }, h('span', { class: 'label' }, 'Types'), ...typeBoxes),
    h(
      'div',
      { class: 'form-grid' },
      h('label', { class: 'field' }, 'Questions', count),
      h('label', { class: 'field' }, 'Difficulty', difficulty),
      h('label', { class: 'field' }, 'Questions from', source),
      h('label', { class: 'field' }, 'Order', order),
      h('label', { class: 'field' }, 'Timer', timer),
    ),
  );
  return {
    node,
    read: () => {
      const domains = domainBoxes.map((l) => l.querySelector('input') as HTMLInputElement).filter((i) => i.checked).map((i) => Number(i.value) as DomainId);
      const types = typeBoxes.map((l) => l.querySelector('input') as HTMLInputElement).filter((i) => i.checked).map((i) => i.value as QuestionType);
      if (domains.length === 0 || types.length === 0) {
        toast(domains.length === 0 ? 'Choose at least one domain.' : 'Choose at least one question type.');
        return null;
      }
      return {
        domains,
        types,
        count: Number(count.value) || 20,
        difficulty: difficulty.value as PracticeOptions['difficulty'],
        order: order.value as PracticeOptions['order'],
        source: source.value as PracticeOptions['source'],
        secondsPerQuestion: Number(timer.value),
      };
    },
  };
}

function daysUntil(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const now = new Date();
  return Math.round((new Date(y, m - 1, d).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
}

/** Start screen; `tab` is the bottom tab marked as current (Train shows this screen scrolled to the training card). */
async function home(tab: Tab = 'home'): Promise<void> {
  const info = await api.info();
  profile = info.profile;
  applyAppearance(profile);
  for (const d of info.bank.byDomain) domainNames.set(d.domain, d.name);
  platform = info.platform;
  document.documentElement.dataset.platform = platform;
  if (!profile.setupDone) return setupWizard(info);
  const mobile = platform === 'mobile';
  const candidate = `${profile.firstName} ${profile.lastName}`.trim();
  const form = trainingForm(info, 'practice', profile.training);
  const shortBank = info.bank.total < 150;
  const emptyBank = info.bank.total === 0;
  const passes = info.history.filter((e) => e.passed).length;
  const best = info.history.reduce((m, e) => Math.max(m, e.scaledScore), 0);
  const last = info.history[0];
  const p = info.progress;
  /** Quick training with the saved defaults, changed by `override`. */
  const quick = (override: Partial<PracticeOptions>): void => void startPractice({ ...profile.training, ...override });
  const days = profile.examDate ? daysUntil(profile.examDate) : null;
  const goalFill = h('span', { class: 'bar-fill' });
  goalFill.style.width = profile.dailyGoal > 0 ? `${Math.min(100, (p.today / profile.dailyGoal) * 100)}%` : '0';
  const weak = p.weakestDomain;
  const weakStats = weak ? p.byDomain[weak - 1] : null;
  /** Every domain and type: for the retry and bookmark pools, which ignore the default filters. */
  const everything: Partial<PracticeOptions> = { domains: info.bank.byDomain.map((d) => d.domain), types: ['single', 'multi', 'ordering'], difficulty: 'mixed' };

  show(
    h(
      'header',
      { class: 'topbar' },
      h('span', { class: 'brand' }, h('img', { class: 'brand-logo', src: 'icon.svg', alt: '' }), 'CAT CISSP Exams', h('span', { class: 'brand-sub' }, 'CISSP Computerized Adaptive Testing simulator')),
      h(
        'span',
        { class: 'row top-actions' },
        h('button', { id: 'open-history', class: 'ghost', onclick: () => void historyScreen() }, 'History'),
        h('button', { id: 'open-settings', class: 'ghost', onclick: () => void settingsScreen() }, 'Profile & settings'),
        !mobile && h('button', { id: 'quit', class: 'ghost', onclick: () => void api.quit() }, 'Quit'),
      ),
    ),
    h(
      'main',
      { class: 'home', id: 'home' },
      h(
        'section',
        { class: 'hero' },
        h(
          'div',
          { class: 'hero-text' },
          h('h1', {}, profile.firstName ? `Welcome back, ${profile.firstName}` : 'Exam simulation'),
          h('p', { class: 'lead' }, `The full CISSP CAT experience: 100–150 adaptive questions in 3 hours, no going back. ${mobile ? 'The app is pinned to the screen and screenshots are blocked' : 'The screen locks as in a test centre'} until the exam ends.`),
          h(
            'ul',
            { class: 'facts' },
            h('li', {}, h('strong', {}, '100–150'), ' questions'),
            h('li', {}, h('strong', {}, '3 h'), ' time limit'),
            h('li', {}, h('strong', {}, '700'), ' / 1000 to pass'),
          ),
          emptyBank && h('p', { class: 'warn', id: 'empty-bank' }, 'The question bank is empty. Import a question bank below to start.'),
          info.displays > 1 && h('p', { class: 'warn' }, `${info.displays} displays detected. A test centre uses one; disconnect the others for a realistic session.`),
          !emptyBank && shortBank && h('p', { class: 'warn' }, `The question bank has only ${info.bank.total} questions; the exam may end early when it runs out.`),
        ),
        h(
          'div',
          { class: 'hero-action' },
          h('p', { id: 'candidate-label' }, candidate ? `Candidate: ${candidate}` : 'Set your name in Profile & settings to see it on the exam screens.'),
          h('button', { id: 'start-exam', class: 'primary big-button', disabled: emptyBank, onclick: () => void nda(candidate || 'Candidate') }, 'Start exam simulation ▶'),
          h('p', { class: 'small' }, 'You accept the NDA and see a short tutorial before the clock starts.'),
        ),
      ),
      h(
        'section',
        { class: 'stats', 'aria-label': 'Your progress' },
        stat('stat-exams', String(info.history.length), 'Exams taken'),
        stat('stat-passed', String(passes), 'Passed'),
        stat('stat-best', info.history.length > 0 ? String(best) : '–', 'Best estimate'),
        stat('stat-last', last ? (last.passed ? 'PASS' : 'FAIL') : '–', 'Last result'),
      ),
      h(
        'section',
        { class: 'card', id: 'bank-card' },
        h(
          'div',
          { class: 'row between' },
          h('h2', {}, 'Question bank'),
          h(
            'button',
            {
              id: 'import-bank',
              onclick: async () => {
                const summary = await api.importBanks();
                if (summary) showImportSummary(summary);
              },
            },
            mobile ? 'Import question bank files…' : 'Import a folder of question banks…',
          ),
        ),
        h('p', { class: 'small' }, `${info.bank.total} questions. Imported banks: ${info.importedBanks.length === 0 ? 'none' : info.importedBanks.length}.`),
        info.importedBanks.length > 0 &&
          h(
            'ul',
            { id: 'imported-banks', class: 'imported-banks' },
            ...info.importedBanks.map((b) =>
              h(
                'li',
                {},
                h('span', { class: 'bank-name', title: b.file }, `${b.name} (${b.questions} questions)`),
                h(
                  'button',
                  {
                    class: 'remove-bank',
                    onclick: () =>
                      modal('Remove question bank', `Remove "${b.name}" and its ${b.questions} questions? The training progress is kept.`, [
                        { label: 'Cancel', id: 'remove-cancel', onClick: () => undefined },
                        {
                          label: 'Remove',
                          id: 'remove-confirm',
                          primary: true,
                          onClick: () =>
                            void api.removeBank(b.file).then(
                              () => {
                                toast(`Removed ${b.name}.`);
                                void home();
                              },
                              (err: unknown) => toast(errorText(err)),
                            ),
                        },
                      ]),
                  },
                  'Remove',
                ),
              ),
            ),
          ),
        h(
          'div',
          { class: 'bank-bars' },
          ...info.bank.byDomain.map((d) => {
            const share = info.bank.total === 0 ? 0 : d.count / info.bank.total;
            const fill = h('span', { class: 'bar-fill' });
            fill.style.width = `${Math.round(share * 1000) / 10}%`;
            const target = h('span', { class: 'bar-mark', title: `Blueprint weight ${Math.round(d.weight * 100)}%` });
            target.style.left = `${d.weight * 100}%`;
            return h(
              'div',
              { class: 'bank-row' },
              h('span', { class: 'bank-name' }, `${d.domain}. ${d.name}`),
              h('div', { class: 'bar thin' }, fill, target),
              h('span', { class: 'bank-count' }, `${d.count} · ${Math.round(d.weight * 100)}%`),
            );
          }),
        ),
        h('p', { class: 'small' }, 'Bar: share of the bank per domain; marker: blueprint weight.'),
        info.bankErrors.length > 0 && h('p', { class: 'warn' }, `Skipped: ${info.bankErrors.slice(0, 3).join('; ')}`),
      ),
      h(
        'section',
        { class: 'card study', id: 'study-card' },
        h('h2', {}, 'Study plan'),
        h(
          'div',
          { class: 'study-grid' },
          h(
            'div',
            {},
            h('p', { id: 'exam-countdown' }, days === null ? 'Set your exam date in Profile & settings to see a countdown.' : days > 0 ? `Your exam is in ${days} day${days === 1 ? '' : 's'}.` : days === 0 ? 'Your exam is today. Good luck!' : 'Your exam date has passed; set a new one in Profile & settings.'),
            h('p', { id: 'coverage' }, `Questions practised: ${p.seen} of ${p.total} · ${p.missed} to retry · ${p.bookmarks.length} bookmarked`),
            profile.dailyGoal > 0 &&
              h('div', { id: 'daily-goal' }, h('div', { class: 'progress-label' }, h('span', {}, 'Today'), h('span', {}, `${p.today} of ${profile.dailyGoal} questions`)), h('div', { class: 'bar' }, goalFill)),
          ),
          h(
            'div',
            { class: 'study-actions' },
            weak && weakStats
              ? h(
                  'p',
                  { id: 'weak-domain' },
                  `Weakest domain: ${weak}. ${domainNames.get(weak) ?? ''} (${percent(weakStats.correct, weakStats.answered)} correct). `,
                  h('button', { id: 'train-weak', class: 'mini', disabled: emptyBank, onclick: () => quick({ domains: [weak], source: 'all', order: 'missed-first' }) }, 'Train it'),
                )
              : h('p', { class: 'small', id: 'weak-domain' }, 'Answer a few training questions per domain to see your weakest one.'),
            h(
              'div',
              { class: 'row wrap' },
              h('button', { id: 'retry-missed', disabled: p.missed === 0, onclick: () => quick({ ...everything, source: 'missed' }) }, `Retry missed (${p.missed})`),
              h('button', { id: 'train-bookmarks', disabled: p.bookmarks.length === 0, onclick: () => quick({ ...everything, source: 'bookmarked' }) }, `Bookmarked (${p.bookmarks.length})`),
              h('button', { id: 'train-new', disabled: p.seen >= p.total, onclick: () => quick({ source: 'all', order: 'unseen-first' }) }, 'New questions'),
            ),
          ),
        ),
      ),
      gameCard(info),
      h(
        'div',
        { class: 'home-grid' },
        h(
          'section',
          { class: 'card', id: 'training-card' },
          h('h2', {}, 'Training mode'),
          h('p', { class: 'small' }, 'Each answer is marked right or wrong at once, with the correct answer and an explanation. No lock; optional timer.'),
          form.node,
          h(
            'div',
            { class: 'row end' },
            h('button', { id: 'open-paused', onclick: () => void pausedScreen() }, `Paused sessions (${info.paused.length})`),
            h(
              'button',
              {
                id: 'start-practice',
                class: 'primary',
                disabled: emptyBank,
                onclick: () => {
                  const options = form.read();
                  if (options) void startPractice(options);
                },
              },
              'Start training',
            ),
          ),
        ),
        h(
          'section',
          { class: 'card', id: 'history-card' },
          h('div', { class: 'row between' }, h('h2', {}, 'History'), h('button', { class: 'mini', onclick: () => void historyScreen() }, 'All history ▶')),
          info.history.length > 0 &&
            h('p', { id: 'history-stats', class: 'small' }, `${info.history.length} exam${info.history.length === 1 ? '' : 's'} · ${passes} passed · best estimate ${best} / 1000 · ${info.trainingHistory.length} training session${info.trainingHistory.length === 1 ? '' : 's'}`),
          info.history.length === 0
            ? h('p', { class: 'empty' }, 'No exams taken yet. Your results appear here after each simulation.')
            : examTable('history', info.history.slice(0, 10), false),
          h('p', { class: 'small' }, '* Training estimate on the 0–1000 scale; 700 is the passing standard.'),
        ),
      ),
    ),
    tabbar(tab),
  );
}

/** Exam history table; with `actions`, each row can show its domain report or be deleted. */
function examTable(id: string, entries: HistoryEntry[], actions: boolean): HTMLElement {
  const table = h(
    'table',
    { id },
    h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Result'), h('th', {}, 'Score*'), h('th', { class: 'opt' }, 'Items'), h('th', { class: 'opt' }, 'Time'), actions && h('th', {}, '')),
  );
  for (const e of entries) {
    const details = h(
      'tr',
      { class: 'details', hidden: true },
      h(
        'td',
        { colspan: '6' },
        h(
          'table',
          {},
          h('tr', {}, h('th', {}, 'Domain'), h('th', {}, 'Scored items'), h('th', {}, 'Correct'), h('th', {}, 'Proficiency')),
          ...e.domains.map((d) => h('tr', {}, h('td', {}, `${d.domain}. ${d.name}`), h('td', {}, String(d.answered)), h('td', {}, String(d.correct), ' ', meter(d.correct, d.answered)), h('td', {}, d.band))),
        ),
      ),
    );
    table.append(
      h(
        'tr',
        { class: 'entry' },
        h('td', {}, new Date(e.date).toLocaleString()),
        h('td', {}, h('span', { class: `badge ${e.passed ? 'pass' : 'fail'}` }, e.passed ? 'PASS' : 'FAIL')),
        h('td', {}, String(e.scaledScore)),
        h('td', { class: 'opt' }, String(e.itemsAnswered)),
        h('td', { class: 'opt' }, formatClock(e.elapsedSeconds)),
        actions &&
          h(
            'td',
            { class: 'actions' },
            h('button', { class: 'mini', onclick: () => { details.hidden = !details.hidden; } }, 'Domains'),
            e.hasReview === true &&
              h(
                'button',
                {
                  class: 'mini review-entry',
                  onclick: () =>
                    void api.examReview(e.date).then(
                      (items) => reviewScreen(items, '◀ History', () => void historyScreen()),
                      (err: unknown) => toast(errorText(err)),
                    ),
                },
                'Review',
              ),
            h('button', { class: 'mini delete-entry', onclick: () => void api.deleteHistory('exam', [e.date]).then(historyScreen) }, 'Delete'),
          ),
      ),
    );
    if (actions) table.append(details);
  }
  return table;
}

/** Bars of the last results, oldest on the left; `value` is 0–100. */
function trend(id: string, points: { value: number; label: string; good: boolean }[]): HTMLElement {
  return h(
    'div',
    { class: 'trend', id },
    ...points.map((pt) => {
      const bar = h('span', { class: `trend-bar ${pt.good ? 'good' : 'bad'}`, title: pt.label });
      bar.style.height = `${Math.max(3, pt.value)}%`;
      return bar;
    }),
  );
}

async function historyScreen(): Promise<void> {
  const info = await api.info();
  const confirmClear = (kind: 'exam' | 'training', what: string): void =>
    modal(`Clear ${what}`, `Delete every entry of your ${what}? This cannot be undone.`, [
      { label: 'Cancel', id: 'clear-cancel', onClick: () => undefined },
      { label: 'Delete all', id: 'clear-confirm', primary: true, onClick: () => void api.deleteHistory(kind, null).then(historyScreen) },
    ]);
  const exams = info.history.slice(0, 20).reverse();
  const sessions = info.trainingHistory.slice(0, 20).reverse();
  show(
    h('header', { class: 'topbar' }, h('span', { class: 'brand' }, 'Your history'), h('span', {}, `${info.history.length} exams · ${info.trainingHistory.length} training sessions`)),
    h(
      'main',
      { class: 'page panel', id: 'history-screen' },
      h(
        'section',
        { class: 'card' },
        h('h2', {}, 'Accuracy by domain (all training)'),
        h(
          'table',
          { id: 'domain-progress' },
          h('tr', {}, h('th', {}, 'Domain'), h('th', {}, 'Questions practised'), h('th', { class: 'opt' }, 'Answers'), h('th', {}, 'Accuracy')),
          ...info.progress.byDomain.map((d) =>
            h(
              'tr',
              { class: d.domain === info.progress.weakestDomain ? 'weak' : '' },
              h('td', {}, `${d.domain}. ${domainNames.get(d.domain) ?? ''}`),
              h('td', {}, `${d.seen} of ${d.total}`),
              h('td', { class: 'opt' }, String(d.answered)),
              h('td', {}, meter(d.correct, d.answered), ` ${percent(d.correct, d.answered)}`),
            ),
          ),
        ),
      ),
      h(
        'section',
        { class: 'card' },
        h('div', { class: 'row between' }, h('h2', {}, 'Exam simulations'), info.history.length > 0 && h('button', { id: 'clear-exams', class: 'mini', onclick: () => confirmClear('exam', 'exam history') }, 'Clear all')),
        exams.length > 1 && h('div', {}, h('p', { class: 'small' }, 'Score estimates, oldest first (700 to pass):'), trend('exam-trend', exams.map((e) => ({ value: e.scaledScore / 10, label: `${new Date(e.date).toLocaleDateString()}: ${e.scaledScore}`, good: e.passed })))),
        info.history.length === 0
          ? h('p', { class: 'empty' }, 'No exams taken yet.')
          : h('div', {}, examTable('exam-history', info.history, true), h('p', { class: 'small' }, '* Training estimate on the 0–1000 scale; 700 is the passing standard.')),
      ),
      h(
        'section',
        { class: 'card' },
        h('div', { class: 'row between' }, h('h2', {}, 'Training sessions'), info.trainingHistory.length > 0 && h('button', { id: 'clear-training', class: 'mini', onclick: () => confirmClear('training', 'training history') }, 'Clear all')),
        sessions.length > 1 && h('div', {}, h('p', { class: 'small' }, 'Accuracy per session, oldest first:'), trend('training-trend', sessions.map((t) => ({ value: (t.correct / Math.max(1, t.answered)) * 100, label: `${new Date(t.date).toLocaleDateString()}: ${percent(t.correct, t.answered)}`, good: t.correct / Math.max(1, t.answered) >= 0.7 })))),
        info.trainingHistory.length === 0
          ? h('p', { class: 'empty' }, 'No training sessions yet.')
          : h(
              'table',
              { id: 'training-history' },
              h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Questions'), h('th', { class: 'opt' }, 'Correct'), h('th', {}, 'Accuracy'), h('th', { class: 'opt' }, 'Difficulty'), h('th', { class: 'opt' }, 'From'), h('th', { class: 'opt' }, 'Domains'), h('th', {}, '')),
              ...info.trainingHistory.map((t) =>
                h(
                  'tr',
                  { class: 'entry' },
                  h('td', {}, new Date(t.date).toLocaleString()),
                  h('td', {}, String(t.answered)),
                  h('td', { class: 'opt' }, String(t.correct)),
                  h('td', {}, meter(t.correct, t.answered), ` ${percent(t.correct, t.answered)}`),
                  h('td', { class: 'opt' }, DIFFICULTY_LABELS[t.difficulty] ?? t.difficulty),
                  h('td', { class: 'opt' }, SOURCE_LABELS[t.source] ?? t.source),
                  h('td', { class: 'opt' }, t.byDomain.filter((d) => d.answered > 0).map((d) => d.domain).join(', ')),
                  h('td', { class: 'actions' }, h('button', { class: 'mini delete-entry', onclick: () => void api.deleteHistory('training', [t.date]).then(historyScreen) }, 'Delete')),
                ),
              ),
            ),
      ),
    ),
    h('footer', { class: 'bottombar has-tabs' }, h('span', {}), h('button', { id: 'history-home', class: 'primary', onclick: () => void home() }, 'Back to start')),
    tabbar('history'),
  );
  backAction = () => void home();
}

/** Profile and appearance fields (labelled), shared by the settings screen (prefix `settings`) and the setup wizard (prefix `setup`). */
function profileFields(prefix: string, p: Profile): { fields: Record<'firstName' | 'lastName' | 'examDate' | 'goal' | 'theme' | 'textSize', HTMLElement>; read: () => Omit<Profile, 'training' | 'setupDone'> } {
  const firstName = h('input', { id: `${prefix}-first-name`, type: 'text', maxlength: '40', autocomplete: 'given-name', value: p.firstName });
  const lastName = h('input', { id: `${prefix}-last-name`, type: 'text', maxlength: '40', autocomplete: 'family-name', value: p.lastName });
  const examDate = h('input', { id: `${prefix}-exam-date`, type: 'date', value: p.examDate });
  const goal = h('input', { id: `${prefix}-goal`, type: 'number', min: '0', max: '500', value: String(p.dailyGoal) });
  const theme = select(`${prefix}-theme`, [['light', 'Light'], ['dark', 'Dark']], p.theme);
  const textSize = select(`${prefix}-text`, [['normal', 'Normal'], ['large', 'Large'], ['larger', 'Larger']], p.textSize);
  theme.addEventListener('change', () => applyAppearance({ ...p, theme: theme.value as Profile['theme'] }));
  return {
    fields: {
      firstName: h('label', { class: 'field' }, 'First name', firstName),
      lastName: h('label', { class: 'field' }, 'Second name', lastName),
      examDate: h('label', { class: 'field' }, 'Exam date', examDate),
      goal: h('label', { class: 'field' }, 'Daily goal', goal, h('span', { class: 'field-hint' }, 'Training questions per day; 0 = no goal')),
      theme: h('label', { class: 'field' }, 'Theme', theme),
      textSize: h('label', { class: 'field' }, 'Text size', textSize),
    },
    read: () => ({
      firstName: firstName.value,
      lastName: lastName.value,
      examDate: examDate.value,
      dailyGoal: Number(goal.value) || 0,
      theme: theme.value as Profile['theme'],
      textSize: textSize.value as Profile['textSize'],
    }),
  };
}

async function settingsScreen(): Promise<void> {
  const info = await api.info();
  const p = info.profile;
  const { fields, read } = profileFields('settings', p);
  const form = trainingForm(info, 'default', p.training);
  const game = gameSettingsCard(info.game.settings);
  const danger = (id: string, label: string, title: string, text: string, run: () => Promise<void>): HTMLElement =>
    h('button', {
      id,
      onclick: () =>
        modal(title, text, [
          { label: 'Cancel', id: 'danger-cancel', onClick: () => undefined },
          { label, id: 'danger-confirm', primary: true, onClick: () => void run().then(() => toast('Done.')) },
        ]),
    }, label);
  const save = async (): Promise<void> => {
    const training = form.read();
    if (!training) return;
    profile = await api.saveProfile({ ...read(), setupDone: true, training });
    gameSettings = await api.saveGameSettings(game.read());
    toast('Settings saved.');
    void home();
  };
  show(
    h('header', { class: 'topbar' }, h('span', { class: 'brand' }, 'Profile & settings'), h('span', {}, `CAT CISSP Exams ${info.version}`)),
    h(
      'main',
      { class: 'page panel', id: 'settings' },
      h(
        'section',
        { class: 'card' },
        h('h2', {}, 'Profile'),
        h(
          'div',
          { class: 'form-grid cols-4' },
          fields.firstName,
          fields.lastName,
          fields.examDate,
          fields.goal,
        ),
      ),
      h(
        'div',
        { class: 'home-grid' },
        h('section', { class: 'card' }, h('h2', {}, 'Appearance'), h('div', { class: 'form-grid cols-2' }, fields.theme, fields.textSize)),
        h(
          'section',
          { class: 'card' },
          h('h2', {}, 'Your data'),
          h('p', { class: 'small' }, platform === 'mobile' ? 'Kept only on this phone, in the app’s private storage.' : 'Kept only on this computer, in the application profile folder.'),
          h(
            'div',
            { class: 'row wrap' },
            danger('reset-progress', 'Reset training progress', 'Reset training progress', 'Forget which questions you answered, your bookmarks and daily counts?', () => api.resetProgress()),
            danger('settings-clear-exams', 'Clear exam history', 'Clear exam history', 'Delete every exam result?', () => api.deleteHistory('exam', null)),
            danger('settings-clear-training', 'Clear training history', 'Clear training history', 'Delete every training session?', () => api.deleteHistory('training', null)),
          ),
        ),
      ),
      h('section', { class: 'card' }, h('h2', {}, 'Training defaults'), h('p', { class: 'small' }, 'Used to fill in the training form and by the quick buttons of the study plan.'), form.node),
      h('div', { class: 'home-grid' }, game.node, creditsCard()),
    ),
    h(
      'footer',
      { class: 'bottombar' },
      h('button', { id: 'settings-cancel', onclick: () => void home() }, 'Cancel'),
      h('button', { id: 'settings-save', class: 'primary', onclick: () => void save() }, 'Save settings'),
    ),
  );
  backAction = () => void home();
}

/** First start: names, exam plan, training preferences and appearance, one step at a time; saved at the end. */
function setupWizard(info: AppInfo): void {
  const { fields, read } = profileFields('setup', profile);
  const form = trainingForm(info, 'setup', profile.training);
  const steps: { title: string; text: string; body: HTMLElement }[] = [
    { title: 'Welcome to CAT CISSP Exams', text: 'A few questions to set the app up for you. You can change every answer later in Profile & settings. Your name appears on the exam screens and in your history.', body: h('div', { class: 'form-grid cols-2' }, fields.firstName, fields.lastName) },
    { title: 'Your exam plan', text: 'When is your CISSP exam, and how many training questions do you want to answer each day? Both are optional.', body: h('div', { class: 'form-grid cols-2' }, fields.examDate, fields.goal) },
    { title: 'Training preferences', text: 'What your training sessions ask by default: domains, question types, length, difficulty, order and timer.', body: form.node },
    { title: 'Appearance', text: 'How the app looks. Large text applies once you finish.', body: h('div', { class: 'form-grid cols-2' }, fields.theme, fields.textSize) },
  ];
  let step = 0;
  const go = async (to: number): Promise<void> => {
    if (to > step && step === 0 && read().firstName.trim() === '') return toast('Enter your first name.');
    if (to > step && step === 2 && !form.read()) return;
    if (to < steps.length) {
      step = to;
      return render();
    }
    const training = form.read();
    if (!training) return;
    profile = await api.saveProfile({ ...read(), setupDone: true, training });
    await home();
  };
  const render = (): void => {
    const last = step === steps.length - 1;
    show(
      h('header', { class: 'topbar' }, h('span', { class: 'brand' }, 'Set up CAT CISSP Exams'), h('span', { id: 'setup-step' }, `Step ${step + 1} of ${steps.length}`)),
      h(
        'main',
        { class: 'page panel', id: 'setup' },
        h('section', { class: 'card', id: `setup-step-${step + 1}` }, h('h2', {}, steps[step].title), h('p', { class: 'small' }, steps[step].text), steps[step].body),
      ),
      h(
        'footer',
        { class: 'bottombar' },
        h('button', { id: 'setup-back', disabled: step === 0, onclick: () => void go(step - 1) }, '◀ Back'),
        h('button', { id: last ? 'setup-finish' : 'setup-next', class: 'primary', onclick: () => void go(step + 1) }, last ? 'Finish' : 'Next ▶'),
      ),
    );
    if (step > 0) backAction = () => void go(step - 1);
  };
  render();
}

/** Paused training sessions: resume one where it was left, or delete it. */
async function pausedScreen(): Promise<void> {
  const info = await api.info();
  const remove = (s: PausedTraining): void =>
    modal('Delete paused session', `Delete the session paused on ${new Date(s.pausedAt).toLocaleString()}? Answers already given stay in your training progress.`, [
      { label: 'Cancel', id: 'delete-paused-cancel', onClick: () => undefined },
      { label: 'Delete', id: 'delete-paused-confirm', primary: true, onClick: () => void api.deletePaused(s.id).then(pausedScreen, (err: unknown) => toast(errorText(err))) },
    ]);
  show(
    h('header', { class: 'topbar' }, h('span', { class: 'brand' }, 'Paused training'), h('span', {}, `${info.paused.length} paused session${info.paused.length === 1 ? '' : 's'}`)),
    h(
      'main',
      { class: 'page panel', id: 'paused-screen' },
      h(
        'section',
        { class: 'card' },
        h('h2', {}, 'Paused training sessions'),
        info.paused.length === 0
          ? h('p', { class: 'empty' }, 'No paused sessions. Use Pause during a training session to continue it later.')
          : h(
              'table',
              { id: 'paused-list' },
              h('tr', {}, h('th', {}, 'Paused'), h('th', {}, 'Answered'), h('th', {}, 'Accuracy'), h('th', { class: 'opt' }, 'Difficulty'), h('th', { class: 'opt' }, 'From'), h('th', { class: 'opt' }, 'Domains'), h('th', {}, '')),
              ...info.paused.map((s) =>
                h(
                  'tr',
                  { class: 'entry' },
                  h('td', {}, new Date(s.pausedAt).toLocaleString()),
                  h('td', {}, `${s.answered} of ${s.total}`),
                  h('td', {}, meter(s.correct, s.answered), ` ${percent(s.correct, s.answered)}`),
                  h('td', { class: 'opt' }, DIFFICULTY_LABELS[s.options.difficulty]),
                  h('td', { class: 'opt' }, SOURCE_LABELS[s.options.source]),
                  h('td', { class: 'opt' }, s.options.domains.join(', ')),
                  h(
                    'td',
                    { class: 'actions' },
                    h('button', { class: 'mini primary resume-paused', onclick: () => void openPractice(api.resumePractice(s.id)) }, 'Resume'),
                    h('button', { class: 'mini delete-paused', onclick: () => remove(s) }, 'Delete'),
                  ),
                ),
              ),
            ),
      ),
    ),
    h('footer', { class: 'bottombar has-tabs' }, h('span', {}), h('button', { id: 'paused-home', class: 'primary', onclick: () => void home() }, 'Back to start')),
    tabbar('train'),
  );
  backAction = () => void home();
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
  showClassic(
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
      h('button', { id: 'nda-decline', onclick: () => { clearInterval(timer); void api.unlock().then(() => home()); } }, 'I do not accept'),
      h('button', { id: 'nda-accept', class: 'primary', onclick: () => { clearInterval(timer); tutorial(candidate); } }, 'I accept'),
    ),
  );
  // The agreement must be accepted or declined with its buttons.
  backAction = () => undefined;
}

function tutorial(candidate: string): void {
  showClassic(
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
        platform === 'mobile'
          ? h('li', {}, 'Touch and hold an option to strike it out. For ordering questions, drag the items by their handle (or use the arrows) into the right order.')
          : h('li', {}, 'Right-click an option to strike it out. For drag-and-drop questions, drag the items (or use the arrows) into the right order.'),
        platform === 'mobile'
          ? h('li', {}, 'Questions shows the list of questions: those answered and those still to come.')
          : h('li', {}, 'You can also press a letter key (A, B, C…) to select an option and Enter to select Next.'),
        h('li', {}, 'You may take a break at any time, but the clock keeps running.'),
        platform === 'mobile'
          ? h('li', {}, 'The app is pinned to the screen: leaving it is recorded as an incident. Screenshots are blocked.')
          : h('li', {}, 'The screen is locked: leaving the exam window is recorded as an incident.'),
      ),
    ),
    h(
      'footer',
      { class: 'bottombar' },
      h('span', {}),
      h('button', { id: 'tutorial-start', class: 'primary', onclick: () => void startExam(candidate) }, 'Begin the exam'),
    ),
  );
  backAction = () => undefined;
}

// ---------- Exam ----------

let clockTimer: number | undefined;
let examOver = false;

/** Time and question progress strip of the exam screen, with a pace hint against the time limit. */
interface ExamProgress {
  node: HTMLElement;
  update(answered?: number): void;
}

function progressBar(id: string, label: string): { bar: HTMLElement; fill: HTMLElement } {
  const fill = h('span', { class: 'bar-fill' });
  const bar = h('div', { class: 'bar', id, role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill);
  return { bar, fill };
}

function examProgress(state: ExamState): ExamProgress {
  const limit = (state.deadline - state.startedAt) / 1000;
  const time = progressBar('time-bar', 'Time used');
  const questions = progressBar('question-bar', 'Questions answered');
  const minMark = h('span', { class: 'bar-mark', title: `Minimum: ${state.minItems} questions` });
  minMark.style.left = `${(state.minItems / state.maxItems) * 100}%`;
  questions.bar.append(minMark);
  const timeText = h('span', { id: 'time-progress' });
  const questionText = h('span', { id: 'question-progress' });
  const pace = h('span', { id: 'pace', class: 'pace' });
  const perItem = limit / state.maxItems;
  let answered = 0;
  const setBar = (b: { bar: HTMLElement; fill: HTMLElement }, ratio: number): void => {
    const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 1000) / 10;
    b.fill.style.width = `${pct}%`;
    b.bar.setAttribute('aria-valuenow', String(pct));
  };
  const update = (n?: number): void => {
    if (n !== undefined) answered = n;
    const elapsed = Math.min(limit, Math.max(0, (Date.now() - state.startedAt) / 1000));
    setBar(time, elapsed / limit);
    setBar(questions, answered / state.maxItems);
    timeText.textContent = `${formatClock(elapsed)} of ${formatClock(limit)}`;
    questionText.textContent = `${answered} answered`;
    // Pace against the maximum length, so a candidate on pace can finish even a 150-item exam.
    const behind = Math.floor(elapsed / perItem - answered);
    pace.textContent = behind > 0 ? `Behind pace by ${behind} question${behind === 1 ? '' : 's'}` : 'On pace';
    pace.classList.toggle('behind', behind > 0);
    time.bar.classList.toggle('behind', behind > 0);
  };
  const node = h(
    'div',
    { class: 'progress', id: 'exam-progress' },
    h('div', { class: 'progress-item' }, h('div', { class: 'progress-label' }, h('span', { class: 'wide-only' }, 'Time used'), timeText), time.bar),
    h(
      'div',
      { class: 'progress-item' },
      h('div', { class: 'progress-label' }, h('span', { class: 'wide-only' }, 'Questions'), h('span', {}, questionText, h('span', { class: 'wide-only' }, ` · ends between ${state.minItems} and ${state.maxItems}`))),
      questions.bar,
    ),
    h('div', { class: 'progress-pace', title: `About ${Math.round(perItem)} seconds per question finishes ${state.maxItems} questions in time` }, pace),
  );
  update();
  return { node, update };
}

async function startExam(candidate: string): Promise<void> {
  examOver = false;
  const state = await api.startExam(candidate);
  const clock = h('span', { id: 'clock' });
  const progress = examProgress(state);
  const tick = (): void => {
    const left = (state.deadline - Date.now()) / 1000;
    clock.textContent = formatClock(left);
    clock.classList.toggle('low', left < 300);
    progress.update();
  };
  tick();
  clearInterval(clockTimer);
  clockTimer = window.setInterval(tick, 1000);
  renderExamQuestion(state, candidate, clock, progress);
}

function finishExam(): void {
  if (examOver) return;
  examOver = true;
  clearInterval(clockTimer);
  document.getElementById('modal')?.remove();
  void api.result().then(resultScreen);
}

/** Letter keys A–H pick an option; Enter submits. Skipped while a dialog is open or a button has focus. */
function questionKeys(select: (index: number) => void, submit: () => void): (e: KeyboardEvent) => void {
  return (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || document.querySelector('.overlay')) return;
    if (e.key === 'Enter') {
      if (document.activeElement instanceof HTMLButtonElement) return;
      e.preventDefault();
      submit();
      return;
    }
    const index = LETTERS.indexOf(e.key.toUpperCase());
    if (e.key.length === 1 && index >= 0) select(index);
  };
}

function questionBody(q: QuestionView): { node: HTMLElement; response: () => number[]; select: (index: number) => void } {
  const struck = new Set<number>();
  if (q.type === 'ordering') {
    const list = h('ol', { class: 'ordering', id: 'ordering' });
    let dragged: HTMLElement | null = null;
    const move = (li: HTMLElement, delta: number): void => {
      const sibling = delta < 0 ? li.previousElementSibling : li.nextElementSibling?.nextElementSibling ?? null;
      if (delta < 0 && !sibling) return;
      list.insertBefore(li, sibling);
    };
    /** Touch drag by the handle (the HTML drag and drop of the desktop does not work with fingers). */
    const touchDrag = (li: HTMLElement, grip: HTMLElement, e: PointerEvent): void => {
      if (e.pointerType === 'mouse' || !li.draggable) return;
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      li.classList.add('dragging');
      const onMove = (ev: PointerEvent): void => {
        for (const other of list.children) {
          const r = other.getBoundingClientRect();
          if (other === li || ev.clientY < r.top || ev.clientY > r.bottom) continue;
          list.insertBefore(li, ev.clientY < r.top + r.height / 2 ? other : other.nextElementSibling);
          return;
        }
      };
      const onEnd = (): void => {
        li.classList.remove('dragging');
        grip.removeEventListener('pointermove', onMove);
        grip.removeEventListener('pointerup', onEnd);
        grip.removeEventListener('pointercancel', onEnd);
      };
      grip.addEventListener('pointermove', onMove);
      grip.addEventListener('pointerup', onEnd);
      grip.addEventListener('pointercancel', onEnd);
    };
    q.options.forEach((text, i) => {
      const grip = h('span', { class: 'grip', 'aria-hidden': 'true' }, '⋮⋮');
      const li = h(
        'li',
        { draggable: 'true', 'data-index': String(i), class: 'drag-item' },
        grip,
        h('span', { class: 'text' }, text),
        h('button', { class: 'mini move', title: 'Move up', 'aria-label': 'Move up', onclick: () => move(li, -1) }, '▲'),
        h('button', { class: 'mini move', title: 'Move down', 'aria-label': 'Move down', onclick: () => move(li, 1) }, '▼'),
      );
      grip.addEventListener('pointerdown', (e) => touchDrag(li, grip, e));
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
      node: h('div', {}, h('p', { class: 'hint' }, platform === 'mobile' ? 'Drag the items by their handle (⋮⋮) into the correct order, first at the top, or use the arrows.' : 'Drag the items into the correct order (first at the top), or use the arrows.'), list),
      response: () => [...list.querySelectorAll('li')].map((li) => Number(li.dataset.index)),
      select: () => undefined,
    };
  }
  const multi = q.type === 'multi';
  const inputs: HTMLInputElement[] = [];
  const rows = q.options.map((text, i) => {
    const input = h('input', { type: multi ? 'checkbox' : 'radio', name: 'option', value: String(i), id: `opt-${i}` });
    inputs.push(input);
    const row = h('label', { class: 'option', for: `opt-${i}` }, input, h('span', { class: 'letter' }, `${LETTERS[i]}.`), h('span', { class: 'text' }, text));
    // Strike-out: right-click, or touch and hold. A long press may also raise `contextmenu`, so one press toggles once.
    let lastStrike = 0;
    let pressTimer: number | undefined;
    let pressStart = { x: 0, y: 0 };
    let swallowClick = false;
    const strike = (): void => {
      if (Date.now() - lastStrike < 700) return;
      lastStrike = Date.now();
      if (struck.has(i)) struck.delete(i);
      else struck.add(i);
      row.classList.toggle('struck', struck.has(i));
    };
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      strike();
    });
    row.addEventListener('pointerdown', (e) => {
      swallowClick = false;
      if (e.pointerType === 'mouse') return;
      pressStart = { x: e.clientX, y: e.clientY };
      pressTimer = window.setTimeout(() => {
        strike();
        // The finger lifting after a long press must not also select the option.
        swallowClick = true;
      }, 550);
    });
    row.addEventListener('pointermove', (e) => {
      if (Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 10) clearTimeout(pressTimer);
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) row.addEventListener(type, () => clearTimeout(pressTimer));
    row.addEventListener('click', (e) => {
      if (!swallowClick) return;
      e.preventDefault();
      swallowClick = false;
    });
    return row;
  });
  return {
    node: h('div', { class: 'options' }, ...rows),
    response: () => inputs.filter((x) => x.checked).map((x) => Number(x.value)),
    select: (index) => {
      const input = inputs[index];
      if (!input) return;
      if (multi) input.checked = !input.checked;
      else input.checked = true;
      input.focus();
    },
  };
}

function renderExamQuestion(state: ExamState, candidate: string, clock: HTMLElement, progress: ExamProgress): void {
  if (state.finished || !state.question) return finishExam();
  const q = state.question;
  progress.update(q.number - 1);
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
      renderExamQuestion(await api.answer(q.id, response), candidate, clock, progress);
    } catch {
      finishExam();
    }
  };
  const nextButton = h('button', { id: 'next', class: 'primary', onclick: () => void next() }, 'Next ▶');
  showClassic(
    h(
      'header',
      { class: 'topbar question-top' },
      h('span', { class: 'brand' }, h('span', { class: 'wide-only' }, 'ISC2 CISSP – Certified Information Systems Security Professional'), h('span', { class: 'narrow-only' }, 'CISSP')),
      h(
        'span',
        { class: 'right' },
        h('span', { id: 'candidate-name', class: 'wide-only' }, candidate),
        h('span', {}, h('span', { class: 'wide-only' }, 'Time Remaining '), clock),
        h('span', { id: 'qnum', class: 'qnum' }, `Question ${q.number}`),
        navToggle(),
      ),
    ),
    progress.node,
    workspace(examNavigator(state, q.number), h('main', { class: 'question', id: 'exam' }, h('p', { class: 'stem' }, q.stem), body.node)),
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
      h('span', { class: 'small keys' }, q.type === 'ordering' ? 'Enter: Next' : `Keys: A–${LETTERS[q.options.length - 1]} select · Enter: Next`),
      nextButton,
    ),
  );
  keyHandler = questionKeys(body.select, () => { if (!nextButton.disabled) void next(); });
  backAction = () => toast('There is no going back in the exam. Use End Exam to stop it.');
}

/**
 * Read-only side panel of the exam: answered questions, the current one and those still to come. The exam
 * has no going back, so the boxes are not buttons; questions past the minimum may not be delivered.
 */
function examNavigator(state: ExamState, current: number): HTMLElement {
  const boxes = Array.from({ length: state.maxItems }, (_, i) => {
    const n = i + 1;
    const kind = n < current ? 'answered' : n === current ? 'unanswered current' : n <= state.minItems ? 'unanswered' : 'optional';
    return h('span', { class: `nav-box ${kind}`, title: `Question ${n}` }, String(n));
  });
  const legend: [string, string][] = [['answered', 'Answered'], ['unanswered', 'Not answered yet'], ['optional', `May follow (after ${state.minItems})`]];
  return h(
    'aside',
    { class: 'navigator', id: 'navigator', 'aria-label': 'Questions' },
    h('h3', {}, 'Questions'),
    h('p', { class: 'small', id: 'navigator-count' }, `${current - 1} answered · at least ${Math.max(0, state.minItems - current + 1)} to go`),
    h('div', { class: 'nav-grid' }, ...boxes),
    h('ul', { class: 'nav-legend' }, ...legend.map(([cls, text]) => h('li', {}, h('span', { class: `nav-box ${cls}`, 'aria-hidden': 'true' }), text))),
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
  showClassic(
    h('header', { class: 'topbar' }, h('span', { class: 'brand' }, 'Examination Score Report'), h('span', {}, 'CISSP (simulation)')),
    h(
      'main',
      { class: 'page', id: 'result' },
      h('h1', { class: r.passed ? 'pass' : 'fail', id: 'outcome' }, r.passed ? 'Congratulations! You PASSED.' : 'You did not pass.'),
      h('p', {}, REASONS[r.reason] ?? r.reason),
      h(
        'p',
        {},
        `Questions answered: ${r.itemsAnswered} (${r.scoredItems} scored). Time used: ${formatClock(r.elapsedSeconds)}. Breaks: ${r.breaks}.`,
      ),
      h(
        'div',
        { class: 'score-scale', id: 'score-scale' },
        h('div', { class: 'scale-label' }, `Training score estimate: ${r.scaledScore} / 1000`),
        (() => {
          const track = h('div', { class: 'scale-track' }, h('span', { class: 'scale-pass', title: 'Passing standard: 700' }));
          const mark = h('span', { class: `scale-mark ${r.passed ? 'is-pass' : 'is-fail'}` });
          mark.style.left = `${Math.min(100, Math.max(0, r.scaledScore / 10))}%`;
          track.append(mark);
          return track;
        })(),
        h('div', { class: 'small' }, 'The marker shows your estimate; the line at 700 is the passing standard.'),
      ),
      h('h2', {}, 'Performance by domain'),
      h(
        'table',
        { id: 'domain-report' },
        h('tr', {}, h('th', {}, 'Domain'), h('th', { class: 'opt' }, 'Weight'), h('th', { class: 'opt' }, 'Scored items'), h('th', {}, 'Correct'), h('th', {}, 'Proficiency')),
        ...r.domains.map((d) =>
          h(
            'tr',
            {},
            h('td', {}, `${d.domain}. ${d.name}`),
            h('td', { class: 'opt' }, `${Math.round(d.weight * 100)}%`),
            h('td', { class: 'opt' }, String(d.answered)),
            h('td', {}, String(d.correct), ' ', meter(d.correct, d.answered)),
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
      h('button', { id: 'review', onclick: () => reviewScreen(r.review, '◀ Score report', () => resultScreen(r)) }, 'Review answers'),
      h('button', { id: 'result-home', class: 'primary', onclick: () => void home() }, 'Back to start'),
    ),
  );
  backAction = () => void home();
}

function answerText(options: string[], indices: number[], ordering: boolean): string {
  if (indices.length === 0) return '(not answered)';
  return ordering ? indices.map((i) => options[i]).join(' → ') : indices.map((i) => `${LETTERS[i]}. ${options[i]}`).join('; ');
}

/** Every answered question of an exam with the correct answer and explanation; `back` returns to where it was opened from. */
function reviewScreen(review: ReviewItem[], backLabel: string, back: () => void): void {
  const search = h('input', { id: 'review-search', type: 'text', placeholder: 'Search question text' });
  const onlyWrong = h('input', { id: 'review-wrong', type: 'checkbox' });
  const domainSelect = h(
    'select',
    { id: 'review-domain' },
    h('option', { value: '' }, 'All domains'),
    ...[...new Set(review.map((i) => i.domain))].sort((a, b) => a - b).map((d) => h('option', { value: String(d) }, `Domain ${d}: ${domainNames.get(d) ?? ''}`)),
  );
  const count = h('span', { class: 'small', id: 'review-count' });
  const articles = review.map((item) => ({
    item,
    node: h(
      'article',
      { class: item.correct ? 'right' : 'wrong' },
      h('h3', {}, `Question ${item.number} · Domain ${item.domain}${item.pretest ? ' · unscored pretest item' : ''} · ${item.correct ? 'Correct' : 'Incorrect'}`),
      h('p', { class: 'stem' }, item.stem),
      h('p', {}, h('strong', {}, 'Your answer: '), answerText(item.options, item.response, item.type === 'ordering')),
      h('p', {}, h('strong', {}, 'Correct answer: '), answerText(item.options, item.answer, item.type === 'ordering')),
      h('p', { class: 'explanation' }, item.explanation),
      item.optionNotes.length > 0 && h('ul', { class: 'notes' }, ...item.optionNotes.map((n, i) => n && h('li', {}, h('strong', {}, item.type === 'ordering' ? `${item.options[i]}: ` : `${LETTERS[i]}. `), n))),
    ),
  }));
  const empty = h('p', { class: 'empty', id: 'review-empty' }, 'No question matches these filters.');
  const apply = (): void => {
    const text = search.value.trim().toLowerCase();
    const domain = domainSelect.value;
    let shown = 0;
    for (const { item, node } of articles) {
      const visible =
        (!onlyWrong.checked || !item.correct) &&
        (domain === '' || String(item.domain) === domain) &&
        (text === '' || `${item.stem} ${item.options.join(' ')} ${item.explanation}`.toLowerCase().includes(text));
      node.hidden = !visible;
      if (visible) shown++;
    }
    empty.hidden = shown > 0;
    count.textContent = `Showing ${shown} of ${articles.length}`;
  };
  search.addEventListener('input', apply);
  onlyWrong.addEventListener('change', apply);
  domainSelect.addEventListener('change', apply);
  showClassic(
    h('header', { class: 'topbar' }, h('span', { class: 'brand' }, 'Answer review'), h('span', {}, `${review.filter((i) => i.correct).length} of ${review.length} correct`)),
    h(
      'main',
      { class: 'page review', id: 'review-list' },
      h('div', { class: 'filters' }, search, domainSelect, h('label', { class: 'check' }, onlyWrong, ' Incorrect only'), count),
      empty,
      ...articles.map((a) => a.node),
    ),
    h('footer', { class: 'bottombar' }, h('button', { id: 'review-back', onclick: back }, backLabel), h('button', { id: 'review-home', class: 'primary', onclick: () => void home() }, 'Back to start')),
  );
  apply();
  backAction = back;
}

// ---------- Training mode ----------

/** Electron wraps errors thrown in the main process; keep only the message. */
function errorText(err: unknown): string {
  return String((err as Error).message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

interface PracticeContext {
  total: number;
  seconds: number;
  bookmarks: Set<string>;
  /** Question ids and states, in session order, as last reported by the main process. */
  ids: string[];
  states: PracticeItemState[];
  /** Correct answers in a row in this session. */
  streak: number;
}

let practiceTimer: number | undefined;

function startPractice(options: PracticeOptions): Promise<void> {
  return openPractice(api.startPractice(options));
}

/** Shows the first question of a new training session, or the open question of a resumed one. */
async function openPractice(starting: Promise<PracticeStart>): Promise<void> {
  let start: PracticeStart;
  try {
    start = await starting;
  } catch (err) {
    toast(errorText(err));
    return;
  }
  renderPractice(start.question, start.feedback, {
    total: start.total,
    seconds: start.secondsPerQuestion,
    bookmarks: new Set(start.bookmarks),
    ids: start.ids,
    states: start.states,
    streak: 0,
  });
}

/** Saves the session to be resumed later; a session with every question answered just ends with its summary. */
async function pausePractice(ctx: PracticeContext): Promise<void> {
  clearInterval(practiceTimer);
  if (ctx.states.every((s) => s === 'correct' || s === 'wrong' || s === 'timedout')) return practiceSummary();
  await api.pausePractice();
  toast('Training paused. Resume it from Paused sessions.');
  await home();
}

/** Opens a training question by Skip, Back or the navigator. */
async function visitPractice(visit: Promise<PracticeVisit>, ctx: PracticeContext): Promise<void> {
  try {
    const v = await visit;
    ctx.states = v.states;
    renderPractice(v.question, v.feedback, ctx);
  } catch (err) {
    toast(errorText(err));
  }
}

const STATE_LABELS: Record<PracticeItemState, string> = { unanswered: 'Not answered', skipped: 'Skipped', correct: 'Correct', wrong: 'Wrong', timedout: 'Time ran out' };

/** Side panel with one box per training question: its state, whether it is marked, and a click opens it. */
function practiceNavigator(current: number, ctx: PracticeContext): HTMLElement {
  const count = (s: PracticeItemState): number => ctx.states.filter((x) => x === s).length;
  const done = ctx.states.length - count('unanswered') - count('skipped');
  const boxes = ctx.states.map((state, i) => {
    const marked = ctx.bookmarks.has(ctx.ids[i]);
    const label = `Question ${i + 1}: ${STATE_LABELS[state]}${marked ? ', marked' : ''}`;
    return h(
      'button',
      {
        class: `nav-box ${state}${marked ? ' marked' : ''}${i + 1 === current ? ' current' : ''}`,
        'data-number': String(i + 1),
        title: label,
        'aria-label': label,
        'aria-current': i + 1 === current ? 'true' : false,
        onclick: () => {
          if (i + 1 !== current) void visitPractice(api.gotoPractice(i + 1), ctx);
        },
      },
      String(i + 1),
    );
  });
  const legend: [string, string][] = [['correct', 'Correct'], ['wrong', 'Wrong'], ['timedout', 'Time ran out'], ['skipped', 'Skipped'], ['unanswered', 'Not answered'], ['marked', 'Marked (bookmark)']];
  return h(
    'aside',
    { class: 'navigator', id: 'navigator', 'aria-label': 'Questions' },
    h('h3', {}, 'Questions'),
    h('p', { class: 'small', id: 'navigator-count' }, `${done} of ${ctx.total} answered · ${count('skipped')} skipped`),
    h('div', { class: 'nav-grid' }, ...boxes),
    h('ul', { class: 'nav-legend' }, ...legend.map(([cls, text]) => h('li', {}, h('span', { class: `nav-box ${cls}`, 'aria-hidden': 'true' }), text))),
  );
}

function optionList(options: string[], indices: number[]): string {
  return indices.map((i) => `${LETTERS[i]}. ${options[i]}`).join('; ');
}

/** Marks the question right or wrong at once: the options, the correct answer, what was missed and why. */
function feedbackNodes(q: QuestionView, f: PracticeFeedback): Node[] {
  const ordering = q.type === 'ordering';
  const verdict = f.timedOut ? '⏱ Time ran out: counted as incorrect.' : f.correct ? '✔ Correct!' : '✘ Incorrect.';
  const nodes: Node[] = [
    h('p', { class: `verdict ${f.correct ? 'pass' : 'fail'}` }, verdict, h('span', { class: 'verdict-meta' }, `Domain ${f.domain}: ${domainNames.get(f.domain) ?? ''} · ${DIFFICULTY_LABELS[f.difficulty]}`)),
  ];
  if (ordering) {
    nodes.push(
      h('p', {}, h('strong', {}, 'Correct order:')),
      h('ol', { class: 'order-check', id: 'order-check' }, ...f.answer.map((a, i) =>
        h('li', { class: f.positions[i] ? 'ok' : 'ko' }, `${f.positions[i] ? '✔' : '✘'} ${q.options[a]}`, !f.positions[i] && f.response.length > 0 && h('span', { class: 'small' }, ` (you placed: ${q.options[f.response[i]]})`)),
      )),
    );
  } else {
    if (f.response.length > 0 && !f.correct) nodes.push(h('p', {}, h('strong', {}, 'Your answer: '), optionList(q.options, f.response)));
    nodes.push(h('p', { id: 'correct-answer' }, h('strong', {}, 'Correct answer: '), optionList(q.options, f.answer)));
    if (q.type === 'multi' && !f.correct && f.response.length > 0) {
      if (f.missedOptions.length > 0) nodes.push(h('p', { class: 'small' }, `You missed: ${f.missedOptions.map((i) => LETTERS[i]).join(', ')}.`));
      if (f.wrongChoices.length > 0) nodes.push(h('p', { class: 'small' }, `Not correct: ${f.wrongChoices.map((i) => LETTERS[i]).join(', ')}.`));
    }
  }
  nodes.push(h('div', { class: 'explanation' }, h('strong', {}, 'Explanation. '), f.explanation));
  if (ordering && f.optionNotes.length > 0) {
    nodes.push(h('ul', { class: 'notes' }, ...f.optionNotes.map((n, i) => n && h('li', {}, h('strong', {}, `${q.options[i]}: `), n))));
  }
  return nodes;
}

/** Colours the options of the question shown in `scope` and adds the per-option notes next to them. */
function markOptions(q: QuestionView, f: PracticeFeedback, scope: ParentNode): void {
  if (q.type === 'ordering') {
    scope.querySelectorAll<HTMLElement>('.drag-item').forEach((li, i) => {
      li.draggable = false;
      li.classList.add(f.positions[i] ? 'is-answer' : 'is-wrong');
    });
    for (const b of scope.querySelectorAll<HTMLButtonElement>('.drag-item button')) b.disabled = true;
    return;
  }
  scope.querySelectorAll('.option').forEach((row, i) => {
    const isAnswer = f.answer.includes(i);
    const chosen = f.response.includes(i);
    row.classList.add(isAnswer ? 'is-answer' : chosen ? 'is-wrong' : 'is-other');
    const text = row.querySelector('.text');
    if (isAnswer || chosen) text?.append(h('span', { class: `tag ${isAnswer ? 'ok' : 'ko'}` }, isAnswer ? (chosen ? 'Your answer: correct' : 'Correct answer') : 'Your answer: wrong'));
    if (f.optionNotes[i]) text?.append(h('span', { class: 'option-note' }, f.optionNotes[i]));
  });
}

/** Shows a training question; with `answered`, the question was answered before and is shown locked with its feedback. */
function renderPractice(q: QuestionView, answered: PracticeFeedback | null, ctx: PracticeContext): void {
  clearInterval(practiceTimer);
  const body = questionBody(q);
  const feedback = h('div', { id: 'feedback', 'aria-live': 'polite' });
  const tally = h('span', { id: 'practice-score' });
  const showTally = (): void => {
    const done = ctx.states.filter((s) => s === 'correct' || s === 'wrong' || s === 'timedout').length;
    tally.textContent = `${ctx.states.filter((s) => s === 'correct').length} of ${done} correct`;
  };
  showTally();
  const streak = h('span', { id: 'practice-streak' }, `Streak ${ctx.streak}`);
  const timeLeft = h('span', { id: 'practice-time-left' });
  const button = h('button', { id: 'check', class: 'primary' }, 'Check answer');
  const index = q.number - 1;
  /** Number of the first unanswered question after this one, wrapping round; null when every other one is answered. */
  const nextOpen = (): number | null => {
    for (let step = 1; step < ctx.total; step++) {
      const i = (index + step) % ctx.total;
      if (ctx.states[i] === 'unanswered' || ctx.states[i] === 'skipped') return i + 1;
    }
    return null;
  };
  const back = h('button', { id: 'practice-back', disabled: q.number === 1, onclick: () => void visitPractice(api.gotoPractice(q.number - 1), ctx) }, '◀ Back');
  const skip = h('button', { id: 'practice-skip', disabled: nextOpen() === null, onclick: () => void visitPractice(api.skipPractice(q.id), ctx) }, 'Skip ▶');
  let sidebar = practiceNavigator(q.number, ctx);
  const bookmark = h('button', { id: 'bookmark', 'aria-pressed': String(ctx.bookmarks.has(q.id)) });
  const showBookmark = (): void => {
    const on = ctx.bookmarks.has(q.id);
    bookmark.textContent = on ? '★ Bookmarked' : '☆ Bookmark';
    bookmark.setAttribute('aria-pressed', String(on));
    sidebar.querySelector(`.nav-box[data-number="${q.number}"]`)?.classList.toggle('marked', on);
  };
  bookmark.addEventListener('click', async () => {
    if (await api.toggleBookmark(q.id)) ctx.bookmarks.add(q.id);
    else ctx.bookmarks.delete(q.id);
    showBookmark();
  });
  let go: HTMLButtonElement | null = null;
  /** Locks the question, shows its feedback and turns the main button into "next". */
  const reveal = (f: PracticeFeedback): void => {
    clearInterval(practiceTimer);
    for (const input of document.querySelectorAll<HTMLInputElement>('#practice .options input')) {
      input.checked = f.response.includes(Number(input.value));
      input.disabled = true;
    }
    feedback.replaceChildren(...feedbackNodes(q, f));
    markOptions(q, f, root);
    const next = nextOpen();
    go = h('button', { id: 'practice-next', class: 'primary' }, next ? 'Next question ▶' : 'See summary');
    go.addEventListener('click', () => (next ? void visitPractice(api.gotoPractice(next), ctx) : void practiceSummary()));
    button.replaceWith(go);
    skip.hidden = true;
  };
  const answeredNow = (r: PracticeAnswer): void => {
    ctx.states = r.states;
    ctx.streak = r.feedback.correct ? ctx.streak + 1 : 0;
    showTally();
    streak.textContent = `Streak ${ctx.streak}`;
    const fresh = practiceNavigator(q.number, ctx);
    sidebar.replaceWith(fresh);
    sidebar = fresh;
    reveal(r.feedback);
    feedback.scrollIntoView({ block: 'nearest' });
  };
  const check = async (): Promise<void> => {
    const response = body.response();
    const needed = q.type === 'multi' ? q.selectCount : q.type === 'single' ? 1 : q.options.length;
    if (response.length !== needed) return toast(q.type === 'multi' ? `Select ${q.selectCount} options.` : 'Choose an answer.');
    button.disabled = true;
    answeredNow(await api.answerPractice(q.id, response));
  };
  button.addEventListener('click', () => void check());
  if (ctx.seconds > 0 && !answered) {
    const deadline = Date.now() + ctx.seconds * 1000;
    const tick = (): void => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      timeLeft.textContent = `${left} s left`;
      timeLeft.classList.toggle('low', left <= 10);
      if (left > 0 || go || button.disabled) return;
      button.disabled = true;
      void api.timeoutPractice(q.id).then(answeredNow);
    };
    tick();
    practiceTimer = window.setInterval(tick, 250);
  }
  show(
    h(
      'header',
      { class: 'topbar question-top' },
      h('span', { class: 'brand wide-only' }, 'Training mode'),
      h('span', { class: 'right' }, tally, streak, ctx.seconds > 0 && !answered && timeLeft, h('span', { id: 'qnum', class: 'qnum' }, `Question ${q.number} of ${ctx.total}`), navToggle()),
    ),
    workspace(sidebar, h('main', { class: 'question', id: 'practice' }, h('p', { class: 'stem' }, q.stem), body.node, feedback)),
    h(
      'footer',
      { class: 'bottombar practice-bar' },
      h('div', {}, back, h('button', { id: 'practice-stop', onclick: () => void practiceSummary() }, 'Stop'), bookmark),
      h('span', { class: 'small keys' }, q.type === 'ordering' ? 'Enter: Check / Next' : `Keys: A–${LETTERS[q.options.length - 1]} select · Enter: Check / Next`),
      h('div', {}, h('button', { id: 'practice-pause', onclick: () => void pausePractice(ctx) }, 'Pause'), skip, button),
    ),
  );
  showBookmark();
  if (answered) {
    if (q.type === 'ordering') {
      // Put the items back in the order the student submitted, so each position is marked against it.
      const list = document.getElementById('ordering');
      for (const i of answered.response) {
        const li = list?.querySelector(`li[data-index="${i}"]`);
        if (li) list?.append(li);
      }
    }
    reveal(answered);
  }
  keyHandler = questionKeys(
    (i) => { if (!go) body.select(i); },
    () => { if (go) go.click(); else if (!button.disabled) void check(); },
  );
  backAction = () =>
    modal('Leave training', 'Pause this session to resume it later, or stop it and see its summary?', [
      { label: 'Keep training', id: 'stop-cancel', onClick: () => undefined },
      { label: 'Pause', id: 'pause-confirm', onClick: () => void pausePractice(ctx) },
      { label: 'Stop', id: 'stop-confirm', primary: true, onClick: () => void practiceSummary() },
    ]);
}

async function practiceSummary(): Promise<void> {
  clearInterval(practiceTimer);
  const s = await api.practiceSummary();
  show(
    h('header', { class: 'topbar' }, h('span', { class: 'brand' }, 'Training summary'), h('span', {}, `${s.correct} of ${s.answered} correct (${percent(s.correct, s.answered)})`)),
    h(
      'main',
      { class: 'page', id: 'practice-summary' },
      s.timedOut > 0 && h('p', { class: 'warn' }, `${s.timedOut} question${s.timedOut === 1 ? '' : 's'} ran out of time.`),
      s.answered === 0
        ? h('p', { class: 'empty' }, 'No questions answered in this session.')
        : h(
            'table',
            { id: 'practice-domains' },
            h('tr', {}, h('th', {}, 'Domain'), h('th', {}, 'Answered'), h('th', {}, 'Correct'), h('th', {}, 'Accuracy')),
            ...s.byDomain.map((d) =>
              h(
                'tr',
                {},
                h('td', {}, `${d.domain}. ${domainNames.get(d.domain) ?? ''}`),
                h('td', {}, String(d.answered)),
                h('td', {}, String(d.correct)),
                h('td', {}, meter(d.correct, d.answered), ` ${percent(d.correct, d.answered)}`),
              ),
            ),
          ),
      s.missed.length > 0 && h('h2', {}, 'Questions to revisit'),
      ...s.missed.map((m) => h('article', { class: 'wrong' }, h('p', { class: 'stem' }, m.stem), h('p', { class: 'explanation' }, m.explanation))),
    ),
    h(
      'footer',
      { class: 'bottombar' },
      s.missed.length > 0
        ? h('button', { id: 'summary-retry', onclick: () => void startPractice({ ...profile.training, domains: [...new Set(s.byDomain.map((d) => d.domain))], types: ['single', 'multi', 'ordering'], difficulty: 'mixed', source: 'missed', count: s.missed.length }) }, 'Retry missed questions')
        : h('span', {}),
      h('button', { id: 'practice-home', class: 'primary', onclick: () => void home() }, 'Back to start'),
    ),
  );
  backAction = () => void home();
}

// ---------- Wiring ----------

api.onTimeout(() => {
  toast('Time is up.');
  finishExam();
});
api.onIncident((message) => toast(message));
// Android back button: closes a dialog (with its first, safe button) or the question list, then does what the
// screen says; on the start screen it is not handled, so the app goes to the background.
api.onBack(() => {
  const dialogButton = document.querySelector<HTMLButtonElement>('.overlay button');
  if (dialogButton) {
    dialogButton.click();
    return true;
  }
  if (document.querySelector('.workspace.nav-open')) {
    setNavOpen(false);
    return true;
  }
  if (!backAction) return false;
  backAction();
  return true;
});
document.addEventListener('copy', (e) => e.preventDefault());
document.addEventListener('cut', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => keyHandler?.(e));
void home();
