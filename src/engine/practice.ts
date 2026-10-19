import { isCorrect, isValidResponse } from './bank';
import { difficultyOf, type Difficulty } from './profile';
import type { DomainId, Question, QuestionView } from './types';

export interface PracticeFeedback {
  correct: boolean;
  /** The question's time limit ran out before an answer was given (scored as incorrect). */
  timedOut: boolean;
  response: number[];
  answer: number[];
  explanation: string;
  /** Why each option is right or wrong, when the bank provides it; otherwise empty. */
  optionNotes: string[];
  /** single/multi: correct options the student did not choose. */
  missedOptions: number[];
  /** single/multi: options the student chose that are wrong. */
  wrongChoices: number[];
  /** ordering: per position, whether the student placed the right item there. */
  positions: boolean[];
  domain: DomainId;
  difficulty: Difficulty;
  finished: boolean;
}

export interface PracticeSummary {
  answered: number;
  correct: number;
  timedOut: number;
  byDomain: { domain: DomainId; answered: number; correct: number }[];
  missed: { id: string; stem: string; explanation: string }[];
}

/** State of one training question, as shown on the question navigator. */
export type PracticeItemState = 'unanswered' | 'skipped' | 'correct' | 'wrong' | 'timedout';

/** A question opened from the navigator: its feedback when it was already answered, otherwise null. */
export interface PracticeVisit {
  question: QuestionView;
  feedback: PracticeFeedback | null;
}

/** Everything a paused training session needs to go on: question order, answers given, skips and the open question. */
export interface PracticeSnapshot {
  ids: string[];
  cursor: number;
  feedback: (PracticeFeedback | null)[];
  skipped: number[];
}

/**
 * Training mode: questions chosen up front, immediate feedback with the explanation after each item.
 * The student may skip a question and open any question again; an answered question stays answered.
 */
export class PracticeSession {
  private readonly items: Question[];
  /** Index of the question on screen. */
  private cursor = 0;
  private readonly feedback: (PracticeFeedback | null)[];
  private readonly skipped = new Set<number>();

  constructor(items: readonly Question[]) {
    if (items.length === 0) throw new Error('no questions match these training settings');
    this.items = [...items];
    this.feedback = this.items.map(() => null);
  }

  get total(): number {
    return this.items.length;
  }

  get ids(): string[] {
    return this.items.map((q) => q.id);
  }

  /** Number (1-based) of the question on screen. */
  get position(): number {
    return this.cursor + 1;
  }

  /** The session as it stands, to be continued later with `restore`. */
  snapshot(): PracticeSnapshot {
    return structuredClone({ ids: this.ids, cursor: this.cursor, feedback: this.feedback, skipped: [...this.skipped] });
  }

  /** Continues a paused session; throws when the snapshot is damaged or one of its questions is no longer in `bank`. */
  static restore(bank: readonly Question[], snapshot: PracticeSnapshot): PracticeSession {
    const { ids, cursor, feedback, skipped } = snapshot;
    if (!Array.isArray(ids) || !Array.isArray(feedback) || !Array.isArray(skipped) || feedback.length !== ids.length) throw new Error('the paused session is damaged');
    const byId = new Map(bank.map((q) => [q.id, q]));
    const items = ids.map((id) => byId.get(id));
    if (items.some((q) => q === undefined)) throw new Error('some questions of this session are no longer in the question bank');
    const session = new PracticeSession(items as Question[]);
    if (!Number.isInteger(cursor) || cursor < 0 || cursor >= ids.length) throw new Error('the paused session is damaged');
    session.cursor = cursor;
    feedback.forEach((f, i) => (session.feedback[i] = f ? structuredClone(f) : null));
    for (const i of skipped) if (Number.isInteger(i) && i >= 0 && i < ids.length && !feedback[i]) session.skipped.add(i);
    return session;
  }

  /** The question on screen, or null once every question is answered. */
  current(): QuestionView | null {
    return this.finished ? null : this.view(this.cursor);
  }

  states(): PracticeItemState[] {
    return this.feedback.map((f, i) => (f ? (f.timedOut ? 'timedout' : f.correct ? 'correct' : 'wrong') : this.skipped.has(i) ? 'skipped' : 'unanswered'));
  }

  answer(questionId: string, response: number[]): PracticeFeedback {
    const q = this.currentItem(questionId);
    if (!isValidResponse(q, response)) throw new Error('an answer is required');
    return this.record(q, [...response], isCorrect(q, response), false);
  }

  /** The time limit of the current question ran out: it counts as incorrect. */
  timeout(questionId: string): PracticeFeedback {
    return this.record(this.currentItem(questionId), [], false, true);
  }

  /** The open question with its answer, for the game's power-ups; only while it is unanswered. */
  currentQuestion(questionId: string): Readonly<Question> {
    return this.currentItem(questionId);
  }

  /** Leaves the current question unanswered and moves to the next unanswered one (the same one when it is the last). */
  skip(questionId: string): QuestionView {
    this.currentItem(questionId);
    this.skipped.add(this.cursor);
    this.cursor = this.nextUnanswered() ?? this.cursor;
    return this.view(this.cursor);
  }

  /** Opens question `number` (1-based), answered or not. */
  goTo(number: number): PracticeVisit {
    const index = number - 1;
    if (!Number.isInteger(index) || index < 0 || index >= this.items.length) throw new Error('no such question');
    this.cursor = index;
    const f = this.feedback[index];
    return { question: this.view(index), feedback: f ? structuredClone(f) : null };
  }

  summary(): PracticeSummary {
    const results = this.items.flatMap((question, i) => {
      const f = this.feedback[i];
      return f ? [{ question, correct: f.correct, timedOut: f.timedOut }] : [];
    });
    const domains = [...new Set(this.items.map((q) => q.domain))].sort();
    return {
      answered: results.length,
      correct: results.filter((r) => r.correct).length,
      timedOut: results.filter((r) => r.timedOut).length,
      byDomain: domains.map((domain) => {
        const rs = results.filter((r) => r.question.domain === domain);
        return { domain, answered: rs.length, correct: rs.filter((r) => r.correct).length };
      }),
      missed: results
        .filter((r) => !r.correct)
        .map((r) => ({ id: r.question.id, stem: r.question.stem, explanation: r.question.explanation })),
    };
  }

  private get finished(): boolean {
    return this.feedback.every((f) => f !== null);
  }

  private view(index: number): QuestionView {
    const q = this.items[index];
    return {
      id: q.id,
      number: index + 1,
      type: q.type,
      stem: q.stem,
      options: [...q.options],
      selectCount: q.type === 'multi' ? q.answer.length : 1,
    };
  }

  /** First unanswered question after the cursor, wrapping round; null when there is none besides the cursor. */
  private nextUnanswered(): number | null {
    for (let step = 1; step < this.items.length; step++) {
      const i = (this.cursor + step) % this.items.length;
      if (!this.feedback[i]) return i;
    }
    return null;
  }

  private currentItem(questionId: string): Question {
    const q = this.items[this.cursor];
    if (q.id !== questionId) throw new Error('only the current question can be answered');
    if (this.feedback[this.cursor]) throw new Error('this question is already answered');
    return q;
  }

  private record(q: Question, response: number[], correct: boolean, timedOut: boolean): PracticeFeedback {
    const ordering = q.type === 'ordering';
    const feedback: PracticeFeedback = {
      correct,
      timedOut,
      response,
      answer: [...q.answer],
      explanation: q.explanation,
      optionNotes: [...(q.optionNotes ?? [])],
      missedOptions: ordering ? [] : q.answer.filter((a) => !response.includes(a)),
      wrongChoices: ordering ? [] : response.filter((r) => !q.answer.includes(r)),
      positions: ordering ? q.answer.map((a, i) => response[i] === a) : [],
      domain: q.domain,
      difficulty: difficultyOf(q.difficulty),
      finished: false,
    };
    this.feedback[this.cursor] = feedback;
    this.skipped.delete(this.cursor);
    feedback.finished = this.finished;
    this.cursor = this.nextUnanswered() ?? this.cursor;
    return structuredClone(feedback);
  }
}
