import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { isCorrect, validateBank } from '../src/engine/bank';
import { CatexamService } from '../src/core/service';
import {
  achievementList,
  addDays,
  BOSS_BONUS_XP,
  BOSS_HP,
  bossQuestionCount,
  completeDaily,
  dailyStreak,
  DAILY_QUESTIONS,
  defaultGameProgress,
  GAME_LIVES,
  GameRun,
  LIGHTNING_GRACE_MS,
  LIGHTNING_SECONDS,
  levelInfo,
  normalizeGameProgress,
  normalizeGameSettings,
  POWER_UP_CAP,
  selectDailyItems,
  selectIslandItems,
  STAGE_QUESTIONS,
  unlockAchievements,
  xpForLevel,
} from '../src/engine/game';
import { DOMAINS } from '../src/engine/domains';
import { estimateAbility, probabilityCorrect } from '../src/engine/irt';
import { PracticeSession } from '../src/engine/practice';
import {
  DEFAULT_PROFILE,
  normalizeProfile,
  normalizeProgress,
  recordAnswer,
  selectPracticeItems,
  summarizeProgress,
  toggleBookmark,
  WEAK_DOMAIN_MIN_ANSWERS,
  type PracticeOptions,
} from '../src/engine/profile';
import { CISSP_CAT, ExamSession } from '../src/engine/session';
import type { DomainId, Question, QuestionView, ReviewItem } from '../src/engine/types';
import {
  appendHistory,
  appendTrainingHistory,
  deleteHistory,
  importBanks,
  listPaused,
  loadQuestions,
  readExamReview,
  readHistory,
  readPaused,
  readProfile,
  readProgress,
  readTrainingHistory,
  removeBank,
  removePaused,
  saveProfile,
  savePaused,
  saveProgress,
} from '../src/core/store';
import { folderFiles, fsDir } from '../src/main/fsdir';
import type { HistoryEntry, TrainingEntry } from '../src/shared/api';

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function syntheticBank(perDomain: number, rng: () => number): Question[] {
  const out: Question[] = [];
  for (const d of DOMAINS) {
    for (let i = 0; i < perDomain; i++) {
      out.push({
        id: `S${d.id}-${i}`,
        domain: d.id,
        type: 'single',
        difficulty: -3 + 6 * rng(),
        stem: 'stem',
        options: ['a', 'b', 'c', 'd'],
        answer: [Math.floor(rng() * 4)],
        explanation: 'why',
      });
    }
  }
  return out;
}

/** Runs an exam for a simulated candidate of true ability `theta`; returns the session when over. */
function simulate(theta: number, seed: number): ExamSession {
  const rng = seeded(seed);
  const questions = syntheticBank(60, rng);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const exam = new ExamSession(questions, CISSP_CAT, rng);
  for (let view = exam.current(); view; view = exam.current()) {
    const q = byId.get(view.id) as Question;
    const right = rng() < probabilityCorrect(theta, q.difficulty);
    exam.answer(view.id, right ? q.answer : [(q.answer[0] + 1) % 4]);
  }
  return exam;
}

describe('question bank validation', () => {
  const good = { id: 'X1', domain: 1, type: 'single', difficulty: 0, stem: 's', options: ['a', 'b', 'c', 'd'], answer: [1], explanation: 'e' };

  it('accepts a valid bank and rejects broken items with a reason', () => {
    assert.equal(validateBank({ name: 'ok', questions: [good] }).errors.length, 0);
    const cases: [unknown, RegExp][] = [
      [{ ...good, answer: [4] }, /answer/],
      [{ ...good, answer: [0, 1] }, /single needs exactly one/],
      [{ ...good, type: 'multi', answer: [2] }, /multi needs/],
      [{ ...good, type: 'ordering', answer: [0, 1, 2] }, /every option/],
      [{ ...good, domain: 9 }, /domain/],
      [{ ...good, difficulty: 'hard' }, /difficulty/],
      [{ ...good, optionNotes: ['only one'] }, /optionNotes/],
    ];
    for (const [q, why] of cases) {
      const r = validateBank({ name: 'bad', questions: [q] });
      assert.equal(r.bank, null);
      assert.match(r.errors.join('\n'), why);
    }
    assert.match(validateBank({ name: 'dup', questions: [good, good] }).errors.join(), /duplicate id/);
  });

  it('ships a built-in bank that can feed a full 150-item exam with the blueprint mix', () => {
    const dir = path.join(__dirname, '..', '..', 'questions');
    const questions: Question[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const r = validateBank(JSON.parse(readFileSync(path.join(dir, file), 'utf8')));
      assert.deepEqual(r.errors, [], file);
      questions.push(...(r.bank?.questions ?? []));
    }
    assert.equal(new Set(questions.map((q) => q.id)).size, questions.length, 'ids unique across files');
    for (const d of DOMAINS) {
      const n = questions.filter((q) => q.domain === d.id).length;
      assert.ok(n >= Math.ceil(d.weight * 150), `domain ${d.id} has ${n} questions`);
    }
  });
});

describe('scoring', () => {
  const base = { id: 'q', domain: 1 as DomainId, difficulty: 0, stem: '', explanation: '', options: ['a', 'b', 'c', 'd'] };
  it('multi ignores selection order; ordering does not', () => {
    assert.equal(isCorrect({ ...base, type: 'multi', answer: [0, 2] }, [2, 0]), true);
    assert.equal(isCorrect({ ...base, type: 'multi', answer: [0, 2] }, [0, 2, 3]), false);
    assert.equal(isCorrect({ ...base, type: 'ordering', answer: [2, 0, 3, 1] }, [2, 0, 3, 1]), true);
    assert.equal(isCorrect({ ...base, type: 'ordering', answer: [2, 0, 3, 1] }, [0, 2, 3, 1]), false);
  });
  it('ability rises with correct answers and stays finite for perfect scores', () => {
    const items = [-1, 0, 1, 2].map((difficulty) => ({ difficulty, correct: true }));
    const all = estimateAbility(items);
    const half = estimateAbility(items.map((r, i) => ({ ...r, correct: i < 2 })));
    assert.ok(Number.isFinite(all.theta) && all.theta > half.theta);
  });
});

describe('CAT exam rules', () => {
  it('a strong candidate passes and a weak one fails at exactly the 100-item minimum', () => {
    const strong = simulate(2.5, 1).result();
    assert.equal(strong.passed, true);
    assert.equal(strong.reason, 'pass-confidence');
    assert.equal(strong.itemsAnswered, 100);
    const weak = simulate(-2.5, 2).result();
    assert.equal(weak.passed, false);
    assert.equal(weak.reason, 'fail-confidence');
    assert.equal(weak.itemsAnswered, 100);
  });

  it('never delivers more than 150 items; a borderline candidate is decided at the maximum', () => {
    let atMax = 0;
    for (let seed = 10; seed < 30; seed++) {
      const r = simulate(0, seed).result();
      assert.ok(r.itemsAnswered >= 100 && r.itemsAnswered <= 150);
      if (r.reason === 'max-items') {
        atMax++;
        assert.equal(r.itemsAnswered, 150);
        assert.equal(r.passed, r.theta > 0);
      }
    }
    assert.ok(atMax > 0, 'some borderline exams run to 150 items');
  });

  it('marks 25 unscored pretest items, all within the first 100', () => {
    const r = simulate(0, 5).result();
    const pretest = r.review.filter((i) => i.pretest);
    assert.equal(pretest.length, 25);
    assert.ok(pretest.every((i) => i.number <= 100));
    assert.equal(r.scoredItems, r.itemsAnswered - 25);
  });

  it('follows the domain weights of the blueprint', () => {
    const r = simulate(0, 7).result();
    for (const d of r.domains) {
      const delivered = r.review.filter((i) => i.domain === d.domain).length;
      assert.ok(Math.abs(delivered - d.weight * r.itemsAnswered) <= 1.5, `domain ${d.domain}: ${delivered} of ${r.itemsAnswered}`);
    }
  });

  it('adapts difficulty: harder items after right answers, easier after wrong ones', () => {
    const run = (correct: boolean): number[] => {
      const rng = seeded(21);
      const bank = syntheticBank(60, rng);
      const exam = new ExamSession(bank, CISSP_CAT, rng);
      for (let i = 0; i < 40; i++) {
        const view = exam.current();
        assert.ok(view);
        const q = bank.find((b) => b.id === view.id) as Question;
        exam.answer(view.id, correct ? q.answer : [(q.answer[0] + 1) % 4]);
      }
      exam.endByCandidate();
      const scored = exam.result().review.filter((r) => !r.pretest);
      return scored.map((r) => (bank.find((b) => b.id === r.id) as Question).difficulty);
    };
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const right = run(true);
    const wrong = run(false);
    // The first item sits at the starting estimate (0); later items follow the candidate.
    assert.ok(Math.abs(right[0]) < 0.5 && Math.abs(wrong[0]) < 0.5, `first items near 0: ${right[0]}, ${wrong[0]}`);
    assert.ok(mean(right.slice(-10)) > 2, `all-correct candidate gets hard items: ${mean(right.slice(-10))}`);
    assert.ok(mean(wrong.slice(-10)) < -2, `all-wrong candidate gets easy items: ${mean(wrong.slice(-10))}`);
  });

  it('refuses going back, skipping and empty answers', () => {
    const rng = seeded(3);
    const bank = syntheticBank(60, rng);
    const exam = new ExamSession(bank, CISSP_CAT, rng);
    const first = exam.current();
    assert.ok(first);
    assert.throws(() => exam.answer(first.id, []), /answer is required/);
    exam.answer(first.id, [0]);
    assert.throws(() => exam.answer(first.id, [0]), /only the current question/);
    assert.equal(exam.current()?.number, 2);
    assert.throws(() => exam.result(), /not over/);
  });

  it('does not reveal answers to the candidate screen', () => {
    const exam = new ExamSession(syntheticBank(60, seeded(4)), CISSP_CAT, seeded(4));
    assert.deepEqual(Object.keys(exam.current() ?? {}).sort(), ['id', 'number', 'options', 'selectCount', 'stem', 'type']);
  });

  it('time out: fail before 100 items; after 100, pass only if the last 75 estimates stayed above the standard', () => {
    // Confidence stop disabled so only the clock ends these exams.
    const config = { ...CISSP_CAT, confidenceZ: 1e9 };
    const run = (items: number, correct: boolean) => {
      let now = 0;
      const bank = syntheticBank(60, seeded(8));
      const exam = new ExamSession(bank, config, seeded(8), () => now);
      for (let i = 0; i < items; i++) {
        const view = exam.current();
        assert.ok(view);
        const q = bank.find((b) => b.id === view.id) as Question;
        exam.answer(view.id, correct ? q.answer : [(q.answer[0] + 1) % 4]);
      }
      now = config.timeLimitSeconds * 1000;
      assert.equal(exam.current(), null);
      return exam.result();
    };
    const early = run(99, true);
    assert.equal(early.reason, 'time-expired');
    assert.equal(early.passed, false);
    assert.equal(run(120, true).passed, true);
    assert.equal(run(120, false).passed, false);
  });

  it('ending the exam early is a fail', () => {
    const exam = new ExamSession(syntheticBank(60, seeded(6)), CISSP_CAT, seeded(6));
    exam.endByCandidate();
    assert.equal(exam.result().passed, false);
    assert.equal(exam.current(), null);
  });
});

describe('training mode', () => {
  const all = (over: Partial<PracticeOptions>): PracticeOptions => ({ ...DEFAULT_PROFILE.training, ...over });

  it('gives the answer and explanation after each item, only from the chosen domains', () => {
    const bank = syntheticBank(10, seeded(11));
    const p = new PracticeSession(selectPracticeItems(bank, all({ domains: [3, 5], count: 5 }), normalizeProgress({}), seeded(11)));
    for (let q = p.current(); q; q = p.current()) {
      const item = bank.find((b) => b.id === q.id) as Question;
      assert.ok(item.domain === 3 || item.domain === 5);
      const f = p.answer(q.id, item.answer);
      assert.equal(f.correct, true);
      assert.equal(f.explanation, 'why');
      assert.equal(f.domain, item.domain);
    }
    assert.equal(p.summary().answered, 5);
  });

  it('says which options were missed or wrongly chosen, and which ordering positions are wrong', () => {
    const multi: Question = { id: 'M', domain: 1, type: 'multi', difficulty: 1, stem: 's', options: ['a', 'b', 'c', 'd'], answer: [0, 2], explanation: 'e', optionNotes: ['A ok', 'B no', 'C ok', 'D no'] };
    const order: Question = { id: 'O', domain: 2, type: 'ordering', difficulty: -1, stem: 's', options: ['x', 'y', 'z'], answer: [2, 0, 1], explanation: 'e' };
    const p = new PracticeSession([multi, order]);
    const f = p.answer('M', [0, 1]);
    assert.deepEqual([f.correct, f.missedOptions, f.wrongChoices, f.difficulty], [false, [2], [1], 'hard']);
    assert.deepEqual(f.optionNotes, ['A ok', 'B no', 'C ok', 'D no']);
    const g = p.answer('O', [2, 1, 0]);
    assert.deepEqual([g.correct, g.positions, g.missedOptions, g.difficulty, g.finished], [false, [true, false, false], [], 'easy', true]);
  });

  it('a timed-out question counts as incorrect and moves on', () => {
    const bank = syntheticBank(2, seeded(3));
    const p = new PracticeSession(bank.slice(0, 2));
    const first = p.current() as QuestionView;
    const f = p.timeout(first.id);
    assert.deepEqual([f.correct, f.timedOut, f.response], [false, true, []]);
    assert.notEqual(p.current()?.id, first.id);
    assert.throws(() => p.timeout(first.id));
    assert.deepEqual([p.summary().answered, p.summary().timedOut, p.summary().missed.length], [1, 1, 1]);
  });

  it('skipped questions come back after the others, and an answered question reopens locked with its feedback', () => {
    const bank = syntheticBank(3, seeded(7)).slice(0, 3);
    const p = new PracticeSession(bank);
    const ids = bank.map((q) => q.id);
    assert.equal(p.skip(ids[0]).id, ids[1]);
    assert.deepEqual(p.states(), ['skipped', 'unanswered', 'unanswered']);
    p.answer(ids[1], bank[1].answer);
    assert.equal(p.current()?.id, ids[2]);
    const wrong = bank[2].type === 'ordering' ? [...bank[2].answer].reverse() : [bank[2].options.findIndex((_, i) => !bank[2].answer.includes(i))];
    const f = p.answer(ids[2], wrong);
    assert.equal(f.finished, false);
    assert.equal(p.current()?.id, ids[0], 'wraps round to the skipped question');
    assert.deepEqual(p.states(), ['skipped', 'correct', 'wrong']);

    const back = p.goTo(2);
    assert.deepEqual([back.question.id, back.question.number, back.feedback?.correct, back.feedback?.response], [ids[1], 2, true, bank[1].answer]);
    assert.throws(() => p.answer(ids[1], bank[1].answer), /already answered/);
    assert.deepEqual(p.goTo(1).feedback, null);
    assert.throws(() => p.goTo(4), /no such question/);

    assert.equal(p.answer(ids[0], bank[0].answer).finished, true);
    assert.equal(p.current(), null);
    assert.deepEqual(p.states(), ['correct', 'correct', 'wrong']);
    assert.deepEqual([p.summary().answered, p.summary().correct], [3, 2]);
  });

  it('selects by difficulty, type, missed and bookmarked questions, new or missed ones first', () => {
    const bank = syntheticBank(10, seeded(5));
    bank[0] = { ...bank[0], type: 'multi', answer: [0, 1] };
    const progress = normalizeProgress({});
    const hard = selectPracticeItems(bank, all({ difficulty: 'hard', count: 200 }), progress, seeded(1));
    assert.ok(hard.length > 0 && hard.every((q) => q.difficulty > 0.5));
    assert.deepEqual(selectPracticeItems(bank, all({ types: ['multi'], count: 200 }), progress).map((q) => q.id), [bank[0].id]);
    assert.throws(() => new PracticeSession(selectPracticeItems(bank, all({ source: 'missed' }), progress)), /no questions match/);

    recordAnswer(progress, bank[1].id, false, '2026-10-18', 't');
    recordAnswer(progress, bank[2].id, true, '2026-10-18', 't');
    toggleBookmark(progress, bank[2].id);
    assert.deepEqual(selectPracticeItems(bank, all({ source: 'missed' }), progress).map((q) => q.id), [bank[1].id]);
    assert.deepEqual(selectPracticeItems(bank, all({ source: 'bookmarked' }), progress).map((q) => q.id), [bank[2].id]);
    assert.equal(selectPracticeItems(bank, all({ order: 'missed-first', count: 1 }), progress, seeded(9))[0].id, bank[1].id);
    const fresh = selectPracticeItems(bank, all({ order: 'unseen-first', count: bank.length - 2 }), progress, seeded(9));
    assert.ok(fresh.every((q) => q.id !== bank[1].id && q.id !== bank[2].id));
    assert.equal(toggleBookmark(progress, bank[2].id), false);
    assert.deepEqual(progress.bookmarks, []);
  });

  it('names the weakest domain only once it has enough answers', () => {
    const bank = syntheticBank(10, seeded(6));
    const progress = normalizeProgress({});
    const d1 = bank.filter((q) => q.domain === 1);
    const d2 = bank.filter((q) => q.domain === 2);
    for (const q of d1.slice(0, WEAK_DOMAIN_MIN_ANSWERS - 1)) recordAnswer(progress, q.id, false, '2026-10-18', 't');
    for (const q of d2.slice(0, WEAK_DOMAIN_MIN_ANSWERS)) recordAnswer(progress, q.id, q === d2[0], '2026-10-18', 't');
    const s = summarizeProgress(bank, progress, '2026-10-18');
    assert.equal(s.weakestDomain, 2);
    assert.deepEqual([s.today, s.seen, s.missed], [2 * WEAK_DOMAIN_MIN_ANSWERS - 1, 2 * WEAK_DOMAIN_MIN_ANSWERS - 1, 2 * WEAK_DOMAIN_MIN_ANSWERS - 2]);
    recordAnswer(progress, d1[WEAK_DOMAIN_MIN_ANSWERS].id, false, '2026-10-18', 't');
    assert.equal(summarizeProgress(bank, progress, '2026-10-19').weakestDomain, 1);
    assert.equal(summarizeProgress(bank, progress, '2026-10-19').today, 0);
  });

  it('a paused session resumes on the same question with its answers, skips and order', () => {
    const bank = syntheticBank(3, seeded(8)).slice(0, 4);
    const ids = bank.map((q) => q.id);
    const p = new PracticeSession(bank);
    p.skip(ids[0]);
    p.answer(ids[1], bank[1].answer);
    p.goTo(2);
    const saved = JSON.parse(JSON.stringify(p.snapshot()));
    const r = PracticeSession.restore([...bank].reverse(), saved);
    assert.deepEqual([r.ids, r.position, r.states()], [ids, 2, ['skipped', 'correct', 'unanswered', 'unanswered']]);
    assert.equal(r.goTo(2).feedback?.correct, true);
    assert.throws(() => r.answer(ids[1], bank[1].answer), /already answered/);
    r.goTo(3);
    r.answer(ids[2], bank[2].answer);
    assert.equal(r.current()?.id, ids[3]);
    assert.throws(() => PracticeSession.restore(bank.slice(1), saved), /no longer in the question bank/);
    assert.throws(() => PracticeSession.restore(bank, { ...saved, cursor: 9 }), /damaged/);
  });
});

describe('profile and history storage', () => {
  it('replaces invalid profile fields with defaults and clamps numbers', () => {
    const p = normalizeProfile({ firstName: '  Ann  ', lastName: 7, examDate: '2026-13-45', dailyGoal: -3, theme: 'neon', setupDone: 'yes', training: { domains: [2, 9], count: 999, types: [], difficulty: 'hard', secondsPerQuestion: 45.4 } });
    assert.deepEqual(
      [p.firstName, p.lastName, p.setupDone, p.examDate, p.dailyGoal, p.theme, p.textSize, p.training.domains, p.training.count, p.training.types, p.training.difficulty, p.training.secondsPerQuestion],
      ['Ann', '', false, '', 0, 'light', 'normal', [2], 200, DEFAULT_PROFILE.training.types, 'hard', 45],
    );
    assert.deepEqual(normalizeProfile('garbage'), DEFAULT_PROFILE);
  });

  it('splits the single name of older profiles into first and second name', () => {
    const names = (raw: object): string[] => [normalizeProfile(raw).firstName, normalizeProfile(raw).lastName];
    assert.deepEqual(names({ name: '  Ann  van der Berg ' }), ['Ann', 'van der Berg']);
    assert.deepEqual(names({ name: 'Ann' }), ['Ann', '']);
    assert.deepEqual(names({ name: 'Old', firstName: 'New' }), ['New', '']);
  });

  it('keeps the answers of each exam apart from the history, and deletes them with their exam', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'catexam-test-'));
    const dir = fsDir(tmp);
    const exam = (date: string): HistoryEntry => ({ date, candidate: 'Ann', passed: true, reason: 'max-items', scaledScore: 720, itemsAnswered: 1, elapsedSeconds: 60, domains: [] });
    const review = (stem: string): ReviewItem[] => [{ number: 1, id: 'Q', domain: 1, type: 'single', stem, options: ['a', 'b'], response: [0], answer: [1], correct: false, pretest: false, explanation: 'why', optionNotes: [] }];
    try {
      await appendHistory(dir, exam('2026-10-19T08:00:00.000Z'), review('first'));
      await appendHistory(dir, exam('2026-10-19T09:00:00.000Z'), review('second'));
      assert.deepEqual((await readHistory(dir)).map((e) => e.hasReview), [true, true]);
      assert.equal((await readExamReview(dir, '2026-10-19T08:00:00.000Z'))[0].stem, 'first');
      assert.ok(!readFileSync(path.join(tmp, 'history.json'), 'utf8').includes('explanation'), 'the history index holds no questions');

      await deleteHistory(dir, 'exam', ['2026-10-19T08:00:00.000Z']);
      await assert.rejects(readExamReview(dir, '2026-10-19T08:00:00.000Z'), /not saved/);
      assert.equal((await readExamReview(dir, '2026-10-19T09:00:00.000Z'))[0].stem, 'second');
      await deleteHistory(dir, 'exam', null);
      assert.deepEqual(readdirSync(path.join(tmp, 'history')), []);

      // Beyond 100 exams the oldest is dropped, with its answers.
      for (let i = 0; i < 101; i++) await appendHistory(dir, exam(`2026-01-01T00:00:${String(i).padStart(3, '0')}Z`), review(String(i)));
      assert.equal((await readHistory(dir)).length, 100);
      await assert.rejects(readExamReview(dir, '2026-01-01T00:00:000Z'), /not saved/);
      assert.equal(readdirSync(path.join(tmp, 'history')).length, 100);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('saves, lists and removes paused training sessions', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'catexam-test-'));
    const dir = fsDir(tmp);
    const snapshot = new PracticeSession(syntheticBank(1, seeded(2)).slice(0, 2)).snapshot();
    const paused = (id: string, pausedAt: string) => ({ id, startedAt: '2026-10-19T08:00:00.000Z', pausedAt, total: 2, answered: 0, correct: 0, options: DEFAULT_PROFILE.training, snapshot });
    try {
      assert.deepEqual(await listPaused(dir), []);
      await savePaused(dir, paused('a', '2026-10-19T09:00:00.000Z'));
      await savePaused(dir, paused('b', '2026-10-19T10:00:00.000Z'));
      const list = await listPaused(dir);
      assert.deepEqual(list.map((s) => s.id), ['b', 'a'], 'last paused first');
      assert.ok(list.every((s) => !('snapshot' in s)), 'the list leaves the questions out');
      assert.deepEqual((await readPaused(dir, 'a')).snapshot, snapshot);
      await removePaused(dir, 'a');
      await removePaused(dir, 'a');
      assert.deepEqual((await listPaused(dir)).map((s) => s.id), ['b']);
      await assert.rejects(readPaused(dir, 'a'), /no longer exists/);
      await assert.rejects(readPaused(dir, '../profile'), /unknown paused session/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('saves the profile and progress, and deletes one or all history entries', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'catexam-test-'));
    const dir = fsDir(tmp);
    try {
      assert.deepEqual(await readProfile(dir), DEFAULT_PROFILE);
      const profile = normalizeProfile({ name: 'Ann', examDate: '2026-12-01', theme: 'dark' });
      await saveProfile(dir, profile);
      assert.deepEqual(await readProfile(dir), profile);

      const progress = normalizeProgress({});
      recordAnswer(progress, 'Q1', false, '2026-10-18', 't');
      await saveProgress(dir, progress);
      assert.deepEqual(await readProgress(dir), progress);

      const entry = (date: string): TrainingEntry => ({ date, answered: 2, correct: 1, timedOut: 0, difficulty: 'mixed', source: 'all', byDomain: [] });
      await appendTrainingHistory(dir, entry('a'));
      await appendTrainingHistory(dir, entry('b'));
      await appendTrainingHistory(dir, entry('c'));
      await deleteHistory(dir, 'training', ['b']);
      assert.deepEqual((await readTrainingHistory(dir)).map((e) => e.date), ['c', 'a']);
      await deleteHistory(dir, 'training', null);
      assert.deepEqual(await readTrainingHistory(dir), []);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('question bank folder import', () => {
  const question = (id: string) => ({ id, domain: 2, type: 'single', difficulty: 0, stem: 's', options: ['a', 'b', 'c', 'd'], answer: [0], explanation: 'e' });

  it('adds valid banks, skips already imported names, reports validator errors, and removes a bank', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'catexam-import-'));
    const builtin = fsDir(path.join(tmp, 'builtin'));
    const folder = path.join(tmp, 'folder');
    const user = fsDir(path.join(tmp, 'user'));
    const importBankFolder = (dir: string) => importBanks(dir, () => folderFiles(dir), builtin, user);
    try {
      await mkdir(path.join(tmp, 'builtin'));
      await mkdir(folder);
      await writeFile(path.join(tmp, 'builtin', 'core.json'), JSON.stringify({ name: 'Core', questions: [question('C1')] }));
      await writeFile(path.join(folder, 'a.json'), JSON.stringify({ name: 'Extra A', questions: [question('A1'), question('A2')] }));
      await writeFile(path.join(folder, 'b.json'), JSON.stringify({ name: 'Core', questions: [question('B1')] }));
      await writeFile(path.join(folder, 'c.json'), JSON.stringify({ name: 'Broken', questions: [{ ...question('X1'), answer: [7] }] }));
      await writeFile(path.join(folder, 'd.json'), '{ not json');
      await writeFile(path.join(folder, 'e.json'), JSON.stringify({ name: 'Extra A', questions: [question('E1')] }));
      await writeFile(path.join(folder, 'notes.txt'), 'ignored');

      const first = await importBankFolder(folder);
      assert.deepEqual(
        first.files.map((f) => [f.file, f.status, f.bank]),
        [['a.json', 'added', 'Extra A'], ['b.json', 'skipped', 'Core'], ['c.json', 'failed', 'Broken'], ['d.json', 'failed', ''], ['e.json', 'skipped', 'Extra A']],
      );
      assert.deepEqual([first.added, first.questions], [1, 2]);
      const brokenErrors = validateBank({ name: 'Broken', questions: [{ ...question('X1'), answer: [7] }] }).errors;
      assert.ok(brokenErrors.length > 0);
      assert.deepEqual(first.files[2].errors, brokenErrors);
      assert.equal(first.files[3].errors.length, 1);

      let loaded = await loadQuestions(builtin, user);
      assert.deepEqual(loaded.imported, [{ file: 'a.json', name: 'Extra A', questions: 2 }]);
      assert.equal(loaded.questions.length, 3);

      // Importing the same folder again adds nothing: its bank is already imported.
      const again = await importBankFolder(folder);
      assert.deepEqual([again.added, again.files[0].status], [0, 'skipped']);

      // A new bank with an already used file name gets its own file instead of overwriting.
      const other = path.join(tmp, 'other');
      await mkdir(other);
      await writeFile(path.join(other, 'a.json'), JSON.stringify({ name: 'Extra B', questions: [question('F1')] }));
      await importBankFolder(other);
      loaded = await loadQuestions(builtin, user);
      assert.deepEqual(loaded.imported.map((b) => [b.file, b.name]), [['a-2.json', 'Extra B'], ['a.json', 'Extra A']]);

      await removeBank('a.json', user);
      loaded = await loadQuestions(builtin, user);
      assert.deepEqual(loaded.imported.map((b) => b.name), ['Extra B']);
      assert.equal(loaded.questions.length, 2);
      await assert.rejects(removeBank('../builtin/core.json', user));

      const missing = await importBankFolder(path.join(tmp, 'nope'));
      assert.ok(missing.error && missing.files.length === 0);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('game mode', () => {
  /** A question whose answer is option 0; `logits` sets its difficulty band. */
  const q = (id: string, logits: number, domain: DomainId = 1): Question => ({ id, domain, type: 'single', difficulty: logits, stem: 's', options: ['a', 'b', 'c', 'd'], answer: [0], explanation: `why ${id}` });
  const play = (run: GameRun, right: boolean) => {
    const view = run.current() as QuestionView;
    return run.answer(view.id, right ? [0] : [1]);
  };
  /** The default rules, and the questions they keep for a boss. */
  const RULES = { difficulty: 'normal', stageQuestions: STAGE_QUESTIONS, bossHp: BOSS_HP, hearts: GAME_LIVES } as const;
  const BOSS_QUESTIONS = bossQuestionCount(BOSS_HP, GAME_LIVES);

  it('pays more XP for harder questions and doubles, then triples it in a combo', () => {
    const run = new GameRun([q('E', -1), q('M', 0), q('H', 1), ...Array.from({ length: 12 }, (_, i) => q(`X${i}`, 0))], 0);
    assert.deepEqual([play(run, true).xpGained, play(run, true).xpGained, play(run, true).xpGained], [10, 20, 30]);
    play(run, true);
    const fifth = play(run, true);
    assert.deepEqual([fifth.combo, fifth.multiplier, fifth.xpGained], [5, 2, 40]);
    for (let i = 6; i < 10; i++) play(run, true);
    const tenth = play(run, true);
    assert.deepEqual([tenth.combo, tenth.multiplier, tenth.xpGained], [10, 3, 60]);
    const miss = play(run, false);
    assert.deepEqual([miss.combo, miss.multiplier, miss.xpGained, miss.lives], [0, 1, 0, 2]);
    assert.equal(play(run, true).xpGained, 20, 'a wrong answer ends the frenzy');
  });

  it('ends the round when the hearts run out, keeps the explanation, and refuses more answers', () => {
    const run = new GameRun(Array.from({ length: 6 }, (_, i) => q(`L${i}`, 0)), 0);
    play(run, false);
    play(run, false);
    const last = play(run, false);
    assert.deepEqual([last.lives, last.end, last.next], [0, 'lives', null]);
    assert.equal(last.feedback.explanation, 'why L2');
    assert.equal(run.current(), null);
    assert.throws(() => run.answer('L3', [0]), /over/);
    assert.deepEqual(run.summary(), {
      kind: 'quick',
      answered: 3,
      correct: 0,
      total: 6,
      xpEarned: 0,
      bestCombo: 0,
      end: 'lives',
      level: levelInfo(0),
      island: null,
      boss: null,
      review: [],
      best: 0,
      newBest: false,
      daily: null,
      unlocked: [],
    });
  });

  it('clears the round when every question is answered with hearts left; a time-out costs a heart', () => {
    const run = new GameRun([q('A', 0), q('B', 0)], 0);
    const view = run.current() as QuestionView;
    const timedOut = run.timeout(view.id);
    assert.deepEqual([timedOut.feedback.timedOut, timedOut.lives, timedOut.end], [true, 2, null]);
    assert.equal(play(run, true).end, 'cleared');
  });

  it('turns XP into levels and funny ranks, and reports a level-up', () => {
    assert.deepEqual([levelInfo(0).level, levelInfo(0).rank, levelInfo(99).level, levelInfo(100).level, levelInfo(100).rank], [1, 'Intern', 1, 2, 'Password123 Survivor']);
    assert.deepEqual(levelInfo(150), { xp: 150, level: 2, rank: 'Password123 Survivor', levelStart: 100, nextLevel: 300 });
    assert.equal(levelInfo(xpForLevel(16)).rank, 'CISO of Doom');
    assert.equal(levelInfo(xpForLevel(16) - 1).rank, 'Crypto Wizard');
    const run = new GameRun([q('H', 1)], 90);
    const up = play(run, true);
    assert.deepEqual([up.level.xp, up.level.level, up.levelUp, up.rankUp], [120, 2, true, true]);
  });

  it('starts with sound and music off on phones and on on the desktop, and repairs a damaged save', () => {
    assert.deepEqual([normalizeGameProgress(undefined, 'mobile').settings.sound, normalizeGameProgress(undefined, 'mobile').settings.music], [false, false]);
    assert.deepEqual([normalizeGameProgress(undefined, 'desktop').settings.sound, normalizeGameProgress(undefined, 'desktop').settings.music], [true, true]);
    const repaired = normalizeGameProgress(
      { xp: -5, bestCombo: 3.6, games: 'x', settings: { sound: true, volume: 250, music: 'yes', musicVolume: -3, lite: 1 }, world: { at: 9, islands: [{ domain: 3, cleared: true }, { domain: 4, bossReached: true, victories: 2.2 }, 'junk'] } },
      'mobile',
    );
    assert.deepEqual([repaired.xp, repaired.bestCombo, repaired.games], [0, 4, 0]);
    assert.deepEqual(repaired.settings, { sound: true, volume: 100, music: false, musicVolume: 0, lite: false, difficulty: 'normal', stageQuestions: STAGE_QUESTIONS, bossHp: BOSS_HP, hearts: GAME_LIVES, islandSeconds: 0 });
    assert.equal(repaired.world.at, 1, 'an unknown island falls back to the first');
    assert.deepEqual(repaired.world.islands.map((i) => i.domain), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(repaired.world.islands[2], { domain: 3, cleared: true, bossReached: true, victories: 1 }, 'a cleared island had its boss reached and beaten');
    assert.deepEqual(repaired.world.islands[3], { domain: 4, cleared: false, bossReached: true, victories: 2 });
    assert.deepEqual(repaired.world.islands[0], { domain: 1, cleared: false, bossReached: false, victories: 0 });
  });

  it('keeps the game rules of the settings within their limits', () => {
    const s = normalizeGameSettings({ difficulty: 'nightmare', stageQuestions: 99, bossHp: 0, hearts: 2.6, islandSeconds: 50 }, 'desktop');
    assert.deepEqual([s.difficulty, s.stageQuestions, s.bossHp, s.hearts, s.islandSeconds], ['normal', 20, 1, 3, 45], 'clamped, rounded, and the nearest time limit on offer');
    const t = normalizeGameSettings({ difficulty: 'hard', stageQuestions: 2, bossHp: 40, hearts: 9, islandSeconds: 1000 }, 'desktop');
    assert.deepEqual([t.difficulty, t.stageQuestions, t.bossHp, t.hearts, t.islandSeconds], ['hard', 3, 15, 5, 120]);
  });

  it('keeps the hardest questions of an island for its boss and gives the stage the rest of the domain', () => {
    const bank = [
      ...Array.from({ length: 10 }, (_, i) => q(`H${i}`, 1 + i / 10, 4)),
      ...Array.from({ length: 10 }, (_, i) => q(`E${i}`, -1, 4)),
      q('OTHER', 2, 5),
    ];
    const items = selectIslandItems(bank, 4, RULES);
    assert.equal(items.boss.length, BOSS_QUESTIONS);
    assert.ok(items.boss.every((x) => x.id.startsWith('H')), 'the boss only gets hard questions when the domain has enough');
    assert.equal(items.stage.length, STAGE_QUESTIONS);
    assert.ok(items.stage.every((x) => x.domain === 4 && !items.boss.includes(x)), 'the stage gets other questions of the domain');
    // Few hard questions: the boss is topped up with the hardest of the rest.
    const few = selectIslandItems([q('H', 2, 6), q('M1', 0.4, 6), q('M2', 0.2, 6), ...Array.from({ length: 11 }, (_, i) => q(`L${i}`, -2, 6))], 6, RULES);
    assert.equal(few.boss.length, BOSS_QUESTIONS);
    assert.ok(['H', 'M1', 'M2'].every((id) => few.boss.some((x) => x.id === id)));
    assert.equal(few.stage.length, 4);
  });

  it('sizes an island by the rules and picks its questions by difficulty', () => {
    const bank = [
      ...Array.from({ length: 15 }, (_, i) => q(`E${i}`, -1 - i / 10, 2)),
      ...Array.from({ length: 15 }, (_, i) => q(`M${i}`, i / 50, 2)),
      ...Array.from({ length: 15 }, (_, i) => q(`H${i}`, 1 + i / 10, 2)),
    ];
    const easy = selectIslandItems(bank, 2, { difficulty: 'easy', stageQuestions: 4, bossHp: 3, hearts: 1 });
    assert.deepEqual([easy.stage.length, easy.boss.length], [4, bossQuestionCount(3, 1)]);
    assert.ok(easy.stage.every((x) => x.id.startsWith('E')) && easy.boss.every((x) => x.id.startsWith('M')), 'easy: easy stage, medium boss');
    const hard = selectIslandItems(bank, 2, { difficulty: 'hard', stageQuestions: 10, bossHp: 8, hearts: 3 });
    assert.ok(hard.boss.every((x) => x.id.startsWith('H')), 'hard: the boss gets the hard questions');
    assert.ok(hard.stage.every((x) => !x.id.startsWith('E')), 'hard: no easy questions in the stage while harder ones are left');
  });

  it('plays with the hearts and boss hit points of the rules', () => {
    const boss = Array.from({ length: bossQuestionCount(2, 1) }, (_, i) => q(`B${i}`, 1));
    const run = new GameRun([q('S', 0)], 0, { domain: 1, boss, bossHp: 2 }, { hearts: 1, powerUps: { fifty: 0, auditor: 0, patch: 1 } });
    assert.equal(run.livesLeft, 1);
    assert.throws(() => run.usePowerUp('patch', (run.current() as QuestionView).id), /full/, 'Patch Tuesday mends up to the hearts of the rules');
    assert.deepEqual(play(run, true).boss, { hp: 2, max: 2 });
    const hit = play(run, true);
    assert.deepEqual(hit.boss, { hp: 1, max: 2 });
    assert.equal(play(run, true).end, 'victory');
    const one = new GameRun([q('A', 0), q('B', 0)], 0, null, { hearts: 1 });
    assert.equal(play(one, false).end, 'lives', 'one heart: one miss ends a quick round');
    assert.equal(new GameRun([q('A', 0)], 0, null, { kind: 'daily', hearts: 5 }).livesLeft, 0, 'the daily challenge has no hearts whatever the rules');
  });

  it('opens the boss fight once the stage is won: right answers hit it, wrong ones cost hearts, and beating it pays a bonus', () => {
    const boss = Array.from({ length: BOSS_QUESTIONS }, (_, i) => q(`B${i}`, 1));
    const run = new GameRun([q('S1', 0), q('S2', 0)], 0, { domain: 1, boss });
    assert.deepEqual([run.currentPhase, run.bossState], ['stage', null]);
    play(run, false);
    const won = play(run, true);
    assert.deepEqual([won.phase, won.bossStarts, won.end, won.lives], ['stage', true, null, 2]);
    assert.deepEqual(won.boss, { hp: BOSS_HP, max: BOSS_HP });
    assert.equal((won.next as QuestionView).id.startsWith('B'), true, 'the next question is the boss’s');
    const hit = play(run, true);
    assert.deepEqual([hit.phase, hit.bossHit, hit.boss, hit.xpGained], ['boss', true, { hp: BOSS_HP - 1, max: BOSS_HP }, 30]);
    const miss = play(run, false);
    assert.deepEqual([miss.bossHit, miss.boss?.hp, miss.lives], [false, BOSS_HP - 1, 1]);
    let last = miss;
    for (let i = 1; i < BOSS_HP; i++) last = play(run, true);
    assert.deepEqual([last.end, last.next, last.boss?.hp, last.bonusXp], ['victory', null, 0, BOSS_BONUS_XP]);
    assert.equal(last.xpGained, 30 + BOSS_BONUS_XP);
    const s = run.summary();
    assert.deepEqual([s.end, s.island, s.boss, s.answered, s.correct, s.total], ['victory', 1, { hp: 0, max: BOSS_HP }, 2 + BOSS_HP + 1, 1 + BOSS_HP, 2 + BOSS_QUESTIONS]);
  });

  it('loses the island when the hearts run out, before or during the boss fight', () => {
    const boss = Array.from({ length: BOSS_QUESTIONS }, (_, i) => q(`B${i}`, 1));
    const stageLost = new GameRun(Array.from({ length: 4 }, (_, i) => q(`S${i}`, 0)), 0, { domain: 2, boss });
    for (let i = 0; i < 2; i++) play(stageLost, false);
    const out = play(stageLost, false);
    assert.deepEqual([out.end, out.phase, out.boss, stageLost.summary().boss], ['lives', 'stage', null, null]);
    // A boss retry: no stage, the fight at once, and three misses end it.
    const retry = new GameRun([], 0, { domain: 2, boss });
    assert.deepEqual([retry.currentPhase, retry.bossState, retry.total], ['boss', { hp: BOSS_HP, max: BOSS_HP }, BOSS_QUESTIONS]);
    play(retry, true);
    play(retry, false);
    play(retry, false);
    const lost = play(retry, false);
    assert.deepEqual([lost.end, lost.boss], ['lives', { hp: BOSS_HP - 1, max: BOSS_HP }]);
  });

  it('gives a boss fewer hit points when its domain has too few questions, so the fight always has a winner', () => {
    const boss = [q('B0', 1), q('B1', 1), q('B2', 1), q('B3', 1)];
    const run = new GameRun([], 0, { domain: 3, boss });
    assert.deepEqual(run.bossState, { hp: 2, max: 2 }, 'four questions and three hearts: two hits win, three misses lose');
    play(run, false);
    play(run, false);
    play(run, true);
    assert.equal(play(run, true).end, 'victory');
  });

  it('feeds wrong answers to the training retry list and keeps XP between sessions', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'catexam-game-'));
    try {
      await mkdir(path.join(tmp, 'builtin'));
      const bank = [q('G1', 1, 2), q('G2', 1, 2), q('G3', 1, 2)];
      await writeFile(path.join(tmp, 'builtin', 'game.json'), JSON.stringify({ name: 'Game', questions: bank }));
      const host = { version: 't', platform: 'mobile' as const, data: fsDir(path.join(tmp, 'user')), builtin: fsDir(path.join(tmp, 'builtin')), displays: () => 1, onTimeout: () => undefined };
      const service = await CatexamService.open(host);
      assert.equal((await service.info()).game.settings.sound, false);
      const start = await service.startGame({ ...DEFAULT_PROFILE.training, domains: [2], count: 3 });
      const right = await service.answerGame(start.question.id, [0]);
      await service.answerGame((right.next as QuestionView).id, [3]);
      assert.equal((await service.gameSummary()).end, 'quit');

      const reopened = await CatexamService.open(host);
      const info = await reopened.info();
      assert.deepEqual([info.game.level.xp, info.game.bestCombo, info.game.games], [30, 1, 1]);
      assert.deepEqual([info.progress.seen, info.progress.missed, info.progress.today], [2, 1, 2]);
      assert.equal(info.game.settings.music, false, 'music is off by default on the phone');
      const retry = await reopened.startPractice({ ...DEFAULT_PROFILE.training, domains: [2], source: 'missed' });
      assert.equal(retry.total, 1, 'the wrong game answer is a question to retry in training');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('saves the islands: the boss reached, then beaten, and where the cat stands', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'catexam-world-'));
    try {
      await mkdir(path.join(tmp, 'builtin'));
      // Domain 7: twelve easy stage questions and seven hard boss questions; every answer is option 0.
      const bank = [...Array.from({ length: 12 }, (_, i) => q(`S${i}`, -1, 7)), ...Array.from({ length: BOSS_QUESTIONS }, (_, i) => q(`B${i}`, 1.5, 7))];
      await writeFile(path.join(tmp, 'builtin', 'world.json'), JSON.stringify({ name: 'World', questions: bank }));
      const host = { version: 't', platform: 'desktop' as const, data: fsDir(path.join(tmp, 'user')), builtin: fsDir(path.join(tmp, 'builtin')), displays: () => 1, onTimeout: () => undefined };
      const service = await CatexamService.open(host);
      await assert.rejects(service.startBoss(7), /stage/, 'the boss alone needs the stage won first');
      await assert.rejects(service.startIsland(9), /unknown island/);
      const start = await service.startIsland(7);
      assert.deepEqual([start.island, start.phase, start.boss, start.total], [7, 'stage', null, STAGE_QUESTIONS]);
      assert.ok(start.question.id.startsWith('S'));
      let r = await service.answerGame(start.question.id, [0]);
      while (!r.bossStarts) r = await service.answerGame((r.next as QuestionView).id, [0]);
      assert.ok((r.next as QuestionView).id.startsWith('B'), 'the boss asks the hard questions');
      service.gameSummary();

      let reopened = await CatexamService.open(host);
      let world = (await reopened.info()).game.world;
      assert.equal(world.at, 7, 'the cat stands on the island played last');
      assert.deepEqual(world.islands[6], { domain: 7, cleared: false, bossReached: true, victories: 0 });
      const fight = await reopened.startBoss(7);
      assert.deepEqual([fight.phase, fight.boss], ['boss', { hp: BOSS_HP, max: BOSS_HP }]);
      r = await reopened.answerGame(fight.question.id, [0]);
      while (r.end === null) r = await reopened.answerGame((r.next as QuestionView).id, [0]);
      assert.equal(r.end, 'victory');

      reopened = await CatexamService.open(host);
      world = (await reopened.info()).game.world;
      assert.deepEqual(world.islands[6], { domain: 7, cleared: true, bossReached: true, victories: 1 });
      assert.ok(world.islands.filter((i) => i.domain !== 7).every((i) => !i.cleared && !i.bossReached));

      // The game rules of the settings shape the next island.
      const rules = await reopened.saveGameSettings({ ...(await reopened.info()).game.settings, stageQuestions: 3, bossHp: 2, hearts: 1, islandSeconds: 30 });
      assert.deepEqual([rules.stageQuestions, rules.bossHp, rules.hearts, rules.islandSeconds], [3, 2, 1, 30]);
      const short = await reopened.startIsland(7);
      assert.deepEqual([short.total, short.lives, short.secondsPerQuestion], [3, 1, 30]);
      const quickFight = await reopened.startBoss(7);
      assert.deepEqual([quickFight.boss, quickFight.lives], [{ hp: 2, max: 2 }, 1]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('earns power-ups with every five in a row and for a beaten boss, up to a small inventory', () => {
    const run = new GameRun(Array.from({ length: 16 }, (_, i) => q(`P${i}`, 0)), 0, null, { powerUps: { fifty: 0, auditor: 0, patch: POWER_UP_CAP } });
    const earned = Array.from({ length: 15 }, () => play(run, true).earned);
    assert.deepEqual([earned[4], earned[9], earned[14]], [['fifty'], ['auditor'], []], 'a full stack of Patch Tuesday takes no more');
    assert.deepEqual(earned.flat(), ['fifty', 'auditor']);
    assert.deepEqual(run.powerUps, { fifty: 1, auditor: 1, patch: POWER_UP_CAP });
    const fight = new GameRun([], 0, { domain: 1, boss: Array.from({ length: BOSS_QUESTIONS }, (_, i) => q(`B${i}`, 1)) });
    let last = play(fight, true);
    while (last.end === null) last = play(fight, true);
    assert.deepEqual([last.end, last.earned], ['victory', ['fifty', 'patch']], 'five hits in a row and the boss beaten');
  });

  it('50/50 takes two wrong options away, the Auditor rules one out with its reason, Patch Tuesday mends a heart', () => {
    const noted: Question = { ...q('N', 0), optionNotes: ['right', 'not b', 'not c', 'not d'] };
    const run = new GameRun([q('F', 0), noted, q('X', 0)], 0, null, { powerUps: { fifty: 1, auditor: 1, patch: 1 }, rng: seeded(3) });
    assert.throws(() => run.usePowerUp('patch', 'F'), /full/);
    const fifty = run.usePowerUp('fifty', 'F');
    assert.equal(fifty.removed.length, 2);
    assert.ok(!fifty.removed.includes(0), 'never the right answer');
    assert.deepEqual(fifty.powerUps, { fifty: 0, auditor: 1, patch: 1 });
    assert.throws(() => run.usePowerUp('auditor', 'F'), /one 50\/50 or hint/);
    assert.throws(() => run.usePowerUp('fifty', 'F'), /none of this/);
    play(run, false);
    const hint = run.usePowerUp('auditor', 'N');
    const out = hint.removed[0];
    assert.deepEqual([hint.removed.length, hint.hint], [1, `Not ${'ABCD'[out]}. not ${'abcd'[out]}`]);
    assert.notEqual(out, 0);
    const patch = run.usePowerUp('patch', 'N');
    assert.deepEqual([patch.lives, run.livesLeft, run.heartsLost, patch.powerUps], [3, 3, 1, { fifty: 0, auditor: 0, patch: 0 }]);

    const ordering: Question = { id: 'O', domain: 1, type: 'ordering', difficulty: 0, stem: 's', options: ['x', 'y', 'z'], answer: [2, 0, 1], explanation: 'e' };
    const twoOptions: Question = { ...q('T', 0), options: ['a', 'b'] };
    const other = new GameRun([ordering, twoOptions], 0, null, { powerUps: { fifty: 3, auditor: 3, patch: 0 } });
    assert.throws(() => other.usePowerUp('fifty', 'O'), /does not fit/);
    assert.equal(other.usePowerUp('auditor', 'O').hint, '“z” comes first.');
    other.answer('O', [2, 0, 1]);
    assert.throws(() => other.usePowerUp('fifty', 'T'), /does not fit/);
    assert.throws(() => other.usePowerUp('auditor', 'T'), /nothing to rule out/);

    const daily = new GameRun([q('D', 0)], 0, null, { kind: 'daily', powerUps: { fifty: 1, auditor: 1, patch: 1 } });
    assert.equal(daily.livesLeft, 0);
    assert.throws(() => daily.usePowerUp('patch', 'D'), /no hearts/);
    const flash = new GameRun([q('L', 0)], 0, null, { kind: 'lightning', powerUps: { fifty: 1, auditor: 1, patch: 1 } });
    assert.throws(() => flash.usePowerUp('fifty', 'L'), /lightning/);
  });

  it('picks the same daily challenge all day, counts the streak, and rewards it', () => {
    const bank = Array.from({ length: 40 }, (_, i) => q(`D${i}`, 0));
    const today = selectDailyItems(bank, '2026-10-19').map((x) => x.id);
    assert.equal(today.length, DAILY_QUESTIONS);
    assert.deepEqual(selectDailyItems([...bank].reverse(), '2026-10-19').map((x) => x.id), today, 'the same questions all day, whatever the order of the bank');
    assert.notDeepEqual(selectDailyItems(bank, '2026-10-20').map((x) => x.id), today);
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(dailyStreak(['2026-10-17', '2026-10-18'], '2026-10-19'), 2, 'today still open: the streak runs to yesterday');
    assert.equal(dailyStreak(['2026-10-16', '2026-10-18', '2026-10-19'], '2026-10-19'), 2);
    assert.equal(dailyStreak(['2026-10-17'], '2026-10-19'), 0, 'a missed day breaks the streak');

    const p = { ...defaultGameProgress('desktop'), powerUps: { fifty: 0, auditor: 0, patch: 0 } };
    const rewards = Array.from({ length: 7 }, (_, i) => completeDaily(p, addDays('2026-10-13', i)));
    assert.deepEqual(rewards[0], { day: '2026-10-13', streak: 1, xp: 50, powerUps: ['fifty'] });
    assert.deepEqual(rewards.map((r) => r?.xp), [50, 60, 70, 80, 90, 100, 110], 'a longer streak, a bigger bonus');
    assert.deepEqual(rewards[6]?.powerUps, ['fifty', 'auditor', 'patch'], 'the 7th day in a row brings one of each');
    assert.deepEqual([p.xp, p.stats.bestStreak, p.powerUps], [560, 7, { fifty: 3, auditor: 3, patch: 3 }]);
    assert.equal(completeDaily(p, '2026-10-19'), null, 'once a day');
  });

  it('runs the lightning round on the clock, with no hearts, and keeps every answer for the review', () => {
    let now = 1_000_000;
    const run = new GameRun(Array.from({ length: 30 }, (_, i) => q(`Z${i}`, 0)), 0, null, { kind: 'lightning', now: () => now });
    for (let i = 0; i < 4; i++) play(run, false);
    const right = play(run, true);
    assert.deepEqual([right.end, right.lives], [null, 0], 'wrong answers cost no heart');
    now += LIGHTNING_SECONDS * 1000 + LIGHTNING_GRACE_MS - 1;
    assert.equal(play(run, true).feedback.correct, true, 'an answer sent just before the end still counts');
    now += 2;
    assert.throws(() => play(run, true), /time is up/);
    const s = run.summary();
    assert.deepEqual([s.kind, s.end, s.answered, s.correct, s.review.length], ['lightning', 'time', 6, 2, 6]);
    assert.deepEqual([s.review[0].question.id, s.review[0].feedback.explanation, s.review[0].feedback.correct], ['Z0', 'why Z0', false]);
    const quitter = new GameRun([q('E', 0)], 0, null, { kind: 'lightning', now: () => now });
    quitter.quit();
    assert.equal(quitter.summary().end, 'quit', 'quitting before the end');
    const late = new GameRun([q('E', 0)], 0, null, { kind: 'lightning', now: () => now });
    now += LIGHTNING_SECONDS * 1000;
    late.quit();
    assert.equal(late.summary().end, 'time', 'the screen ends the round when the clock runs out');
  });

  it('unlocks each achievement once, on the day it is earned, and keeps badges and power-ups through a damaged save', () => {
    const p = defaultGameProgress('desktop');
    assert.deepEqual(unlockAchievements(p, '2026-10-19'), []);
    p.stats.right = 1;
    p.bestCombo = 5;
    assert.deepEqual(unlockAchievements(p, '2026-10-19').map((a) => a.name), ["Didn't click the link", 'Hashed it out']);
    p.xp = xpForLevel(5);
    assert.deepEqual(unlockAchievements(p, '2026-10-20').map((a) => a.name), ['Least Privilege, Most Points', 'Script Kiddie No More']);
    assert.deepEqual(unlockAchievements(p, '2026-10-21'), [], 'never twice');
    const list = achievementList(p);
    assert.equal(list.filter((a) => a.unlocked).length, 4);
    assert.equal(list.find((a) => a.id === 'combo-5')?.unlocked, '2026-10-19');
    const saved = normalizeGameProgress(JSON.parse(JSON.stringify({ ...p, achievements: { ...p.achievements, bogus: '2026-01-01', 'combo-10': 'yesterday' } })), 'desktop');
    assert.deepEqual(Object.keys(saved.achievements).sort(), ['combo-5', 'first-right', 'level-5', 'xp-1000']);
    assert.deepEqual(normalizeGameProgress({ powerUps: { fifty: 9, auditor: -1 } }, 'mobile').powerUps, { fifty: POWER_UP_CAP, auditor: 0, patch: 1 });
  });

  it('plays the daily challenge once a day with its reward, and keeps power-ups, the lightning high score and badges', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'catexam-stage3-'));
    try {
      await mkdir(path.join(tmp, 'builtin'));
      const bank = Array.from({ length: 12 }, (_, i) => q(`Q${i}`, 0, 3));
      await writeFile(path.join(tmp, 'builtin', 'stage3.json'), JSON.stringify({ name: 'Stage 3', questions: bank }));
      const host = { version: 't', platform: 'desktop' as const, data: fsDir(path.join(tmp, 'user')), builtin: fsDir(path.join(tmp, 'builtin')), displays: () => 1, onTimeout: () => undefined };
      const service = await CatexamService.open(host);
      let game = (await service.info()).game;
      assert.deepEqual([game.daily.done, game.daily.streak, game.daily.reward, game.powerUps], [false, 0, { xp: 50, powerUps: ['fifty'] }, { fifty: 1, auditor: 1, patch: 1 }]);
      const start = await service.startDaily();
      assert.deepEqual([start.kind, start.total, start.lives], ['daily', DAILY_QUESTIONS, 0]);
      const used = await service.usePowerUp('fifty', start.question.id);
      assert.deepEqual(used.unlocked.map((a) => a.id), ['power-up']);
      let r = await service.answerGame(start.question.id, [0]);
      for (let i = 1; i < DAILY_QUESTIONS; i++) r = await service.answerGame((r.next as QuestionView).id, i % 2 ? [1] : [0]);
      assert.equal(r.end, 'cleared', 'wrong answers do not end the daily challenge');
      assert.ok(r.unlocked.some((a) => a.id === 'daily'));
      const s = await service.gameSummary();
      assert.deepEqual(s.daily, { day: game.daily.today, streak: 1, xp: 50, powerUps: ['fifty'] });
      await assert.rejects(service.startDaily(), /done/);

      const flash = await service.startLightning();
      assert.deepEqual([flash.kind, flash.roundSeconds, flash.lives], ['lightning', LIGHTNING_SECONDS, 0]);
      const f = await service.answerGame(flash.question.id, [0]);
      await service.answerGame((f.next as QuestionView).id, [0]);
      const ls = await service.gameSummary();
      assert.deepEqual([ls.correct, ls.best, ls.newBest, ls.review.length], [2, 2, true, 2]);
      assert.equal((await service.gameSummary()).newBest, true, 'a second summary says the same');

      game = (await (await CatexamService.open(host)).info()).game;
      assert.deepEqual([game.daily.done, game.daily.streak, game.lightningBest], [true, 1, 2]);
      assert.deepEqual(game.powerUps, { fifty: 1, auditor: 1, patch: 1 }, 'the 50/50 used, and another one won');
      assert.ok(['power-up', 'daily', 'first-right'].every((id) => game.achievements.find((a) => a.id === id)?.unlocked));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
