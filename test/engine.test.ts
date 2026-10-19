import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { isCorrect, validateBank } from '../src/engine/bank';
import { CatexamService } from '../src/core/service';
import { GameRun, levelInfo, normalizeGameProgress, xpForLevel } from '../src/engine/game';
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
    assert.deepEqual(run.summary(), { answered: 3, correct: 0, total: 6, xpEarned: 0, bestCombo: 0, end: 'lives', level: levelInfo(0) });
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

  it('starts with sound off on phones and on on the desktop, and repairs a damaged save', () => {
    assert.equal(normalizeGameProgress(undefined, 'mobile').settings.sound, false);
    assert.equal(normalizeGameProgress(undefined, 'desktop').settings.sound, true);
    assert.deepEqual(normalizeGameProgress({ xp: -5, bestCombo: 3.6, games: 'x', settings: { sound: true, volume: 250, lite: 1 } }, 'mobile'), {
      xp: 0,
      bestCombo: 4,
      games: 0,
      settings: { sound: true, volume: 100, lite: false },
    });
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
      assert.equal(service.gameSummary().end, 'quit');

      const reopened = await CatexamService.open(host);
      const info = await reopened.info();
      assert.deepEqual([info.game.level.xp, info.game.bestCombo, info.game.games], [30, 1, 1]);
      assert.deepEqual([info.progress.seen, info.progress.missed, info.progress.today], [2, 1, 2]);
      const retry = await reopened.startPractice({ ...DEFAULT_PROFILE.training, domains: [2], source: 'missed' });
      assert.equal(retry.total, 1, 'the wrong game answer is a question to retry in training');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
