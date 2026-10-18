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

/** Training mode: questions chosen up front, immediate feedback with the explanation after each item. */
export class PracticeSession {
  private readonly items: Question[];
  private index = 0;
  private readonly results: { question: Question; correct: boolean; timedOut: boolean }[] = [];

  constructor(items: readonly Question[]) {
    if (items.length === 0) throw new Error('no questions match these training settings');
    this.items = [...items];
  }

  get total(): number {
    return this.items.length;
  }

  current(): QuestionView | null {
    const q = this.items[this.index];
    if (!q) return null;
    return {
      id: q.id,
      number: this.index + 1,
      type: q.type,
      stem: q.stem,
      options: [...q.options],
      selectCount: q.type === 'multi' ? q.answer.length : 1,
    };
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

  summary(): PracticeSummary {
    const domains = [...new Set(this.items.map((q) => q.domain))].sort();
    return {
      answered: this.results.length,
      correct: this.results.filter((r) => r.correct).length,
      timedOut: this.results.filter((r) => r.timedOut).length,
      byDomain: domains.map((domain) => {
        const rs = this.results.filter((r) => r.question.domain === domain);
        return { domain, answered: rs.length, correct: rs.filter((r) => r.correct).length };
      }),
      missed: this.results
        .filter((r) => !r.correct)
        .map((r) => ({ id: r.question.id, stem: r.question.stem, explanation: r.question.explanation })),
    };
  }

  private currentItem(questionId: string): Question {
    const q = this.items[this.index];
    if (!q || q.id !== questionId) throw new Error('only the current question can be answered');
    return q;
  }

  private record(q: Question, response: number[], correct: boolean, timedOut: boolean): PracticeFeedback {
    this.results.push({ question: q, correct, timedOut });
    this.index++;
    const ordering = q.type === 'ordering';
    return {
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
      finished: this.index >= this.items.length,
    };
  }
}
