import { isCorrect, isValidResponse } from './bank';
import type { DomainId, Question, QuestionView } from './types';
import type { Rng } from './session';

export interface PracticeFeedback {
  correct: boolean;
  answer: number[];
  explanation: string;
  finished: boolean;
}

export interface PracticeSummary {
  answered: number;
  correct: number;
  byDomain: { domain: DomainId; answered: number; correct: number }[];
  missed: { id: string; stem: string; explanation: string }[];
}

/** Training mode: chosen domains, immediate feedback with the explanation after each item. */
export class PracticeSession {
  private readonly items: Question[];
  private index = 0;
  private readonly results: { question: Question; correct: boolean }[] = [];

  constructor(bank: readonly Question[], domains: readonly DomainId[], count: number, rng: Rng = Math.random) {
    const pool = bank.filter((q) => domains.includes(q.domain));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this.items = pool.slice(0, Math.max(1, count));
    if (this.items.length === 0) throw new Error('no questions in the chosen domains');
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
    const q = this.items[this.index];
    if (!q || q.id !== questionId) throw new Error('only the current question can be answered');
    if (!isValidResponse(q, response)) throw new Error('an answer is required');
    const correct = isCorrect(q, response);
    this.results.push({ question: q, correct });
    this.index++;
    return { correct, answer: [...q.answer], explanation: q.explanation, finished: this.index >= this.items.length };
  }

  summary(): PracticeSummary {
    const domains = [...new Set(this.items.map((q) => q.domain))].sort();
    return {
      answered: this.results.length,
      correct: this.results.filter((r) => r.correct).length,
      byDomain: domains.map((domain) => {
        const rs = this.results.filter((r) => r.question.domain === domain);
        return { domain, answered: rs.length, correct: rs.filter((r) => r.correct).length };
      }),
      missed: this.results
        .filter((r) => !r.correct)
        .map((r) => ({ id: r.question.id, stem: r.question.stem, explanation: r.question.explanation })),
    };
  }
}
