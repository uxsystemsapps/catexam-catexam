import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { isCorrect, validateBank } from '../src/engine/bank';
import { DOMAINS } from '../src/engine/domains';
import { estimateAbility, probabilityCorrect } from '../src/engine/irt';
import { PracticeSession } from '../src/engine/practice';
import { CISSP_CAT, ExamSession } from '../src/engine/session';
import type { DomainId, Question } from '../src/engine/types';

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
  it('gives the answer and explanation after each item, only from the chosen domains', () => {
    const bank = syntheticBank(10, seeded(11));
    const p = new PracticeSession(bank, [3, 5], 5, seeded(11));
    for (let q = p.current(); q; q = p.current()) {
      const item = bank.find((b) => b.id === q.id) as Question;
      assert.ok(item.domain === 3 || item.domain === 5);
      const f = p.answer(q.id, item.answer);
      assert.equal(f.correct, true);
      assert.equal(f.explanation, 'why');
    }
    assert.equal(p.summary().answered, 5);
  });
});
