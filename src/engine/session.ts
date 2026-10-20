import { isCorrect, isValidResponse } from './bank';
import { DOMAINS } from './domains';
import { estimateAbility, type ScoredResponse } from './irt';
import type {
  DomainId,
  DomainReport,
  ExamResult,
  FinishReason,
  Incident,
  Question,
  QuestionView,
  ReviewItem,
} from './types';

export interface ExamConfig {
  /** No pass/fail decision before this many items (scored + pretest). */
  minItems: number;
  maxItems: number;
  /** Unscored items mixed into the first `minItems` positions. */
  pretestItems: number;
  timeLimitSeconds: number;
  /** Ability (logits) at the passing standard; scaled score 700. */
  passingTheta: number;
  /** z for the confidence-interval stop rule (1.96 = 95%). */
  confidenceZ: number;
  /** When time runs out after `minItems`: the candidate passes only if the estimate stayed above the
   * standard after each of the last `timeoutWindow` scored items. */
  timeoutWindow: number;
}

/** CISSP CAT rules (English exam, from April 2024): 100-150 items, 3 hours, 25 unscored pretest items. */
export const CISSP_CAT: ExamConfig = {
  minItems: 100,
  maxItems: 150,
  pretestItems: 25,
  timeLimitSeconds: 3 * 60 * 60,
  passingTheta: 0,
  confidenceZ: 1.96,
  timeoutWindow: 75,
};

/** Training scale: 700 at the passing standard, 150 points per logit, clamped to 0-1000. */
export function scaledScore(theta: number, passingTheta: number): number {
  return Math.round(Math.min(1000, Math.max(0, 700 + 150 * (theta - passingTheta))));
}

interface Delivered {
  question: Question;
  pretest: boolean;
  response: number[] | null;
  correct: boolean;
}

/** Random source in [0, 1); injectable for tests. */
export type Rng = () => number;

/**
 * One computerized adaptive test. Rules enforced here, not in the UI:
 * - one item at a time, every item must be answered, no going back, no review before the end;
 * - next scored item: the domain most under its blueprint weight, difficulty closest to the current
 *   ability estimate (random pick among the 5 closest, so the exam is not the same every time);
 * - stops on 95% confidence after the minimum, at the maximum, at the time limit, or when the bank runs out.
 */
export class ExamSession {
  private readonly delivered: Delivered[] = [];
  private readonly used = new Set<string>();
  private readonly pretestPositions = new Set<number>();
  private readonly thetaHistory: number[] = [];
  private readonly incidents: Incident[] = [];
  private estimate = { theta: 0, se: Infinity };
  private finished: FinishReason | null = null;
  private finishedAt: number | null = null;
  private breaks = 0;
  readonly startedAt: number;

  constructor(
    private readonly bank: readonly Question[],
    readonly config: ExamConfig = CISSP_CAT,
    private readonly rng: Rng = Math.random,
    private readonly now: () => number = Date.now,
  ) {
    if (config.pretestItems > config.minItems) throw new Error('pretestItems must not exceed minItems');
    const positions = Array.from({ length: config.minItems }, (_, i) => i);
    for (let k = 0; k < config.pretestItems; k++) {
      const j = k + Math.floor(rng() * (positions.length - k));
      [positions[k], positions[j]] = [positions[j], positions[k]];
      this.pretestPositions.add(positions[k]);
    }
    this.startedAt = now();
    this.deliverNext();
  }

  get deadline(): number {
    return this.startedAt + this.config.timeLimitSeconds * 1000;
  }

  get isFinished(): boolean {
    return this.finished !== null;
  }

  /** The item on screen, or null once the exam is over. */
  current(): QuestionView | null {
    this.checkTime();
    if (this.finished) return null;
    const d = this.delivered[this.delivered.length - 1];
    return {
      id: d.question.id,
      number: this.delivered.length,
      type: d.question.type,
      stem: d.question.stem,
      options: [...d.question.options],
      selectCount: d.question.type === 'multi' ? d.question.answer.length : 1,
    };
  }

  /** Answers the item on screen. Answering any other item (going back, skipping ahead) is refused. */
  answer(questionId: string, response: number[]): void {
    this.checkTime();
    if (this.finished) throw new Error('the exam is over');
    const d = this.delivered[this.delivered.length - 1];
    if (d.question.id !== questionId) throw new Error('only the current question can be answered');
    if (!isValidResponse(d.question, response)) throw new Error('an answer is required before moving on');
    d.response = [...response];
    d.correct = isCorrect(d.question, response);
    if (!d.pretest) {
      this.estimate = estimateAbility(this.scoredResponses());
      this.thetaHistory.push(this.estimate.theta);
    }
    this.decideOrContinue();
  }

  recordBreak(): void {
    this.breaks++;
    this.recordIncident('break', 'candidate took a break (the clock kept running)');
  }

  recordIncident(kind: string, detail: string): void {
    this.incidents.push({ at: Math.round((this.now() - this.startedAt) / 1000), kind, detail });
  }

  endByCandidate(): void {
    if (!this.finished) this.finish('ended-by-candidate');
  }

  /** Ends the exam when the clock has run out; returns true if it is over. */
  checkTime(): boolean {
    if (!this.finished && this.now() >= this.deadline) this.finish('time-expired');
    return this.finished !== null;
  }

  result(): ExamResult {
    if (!this.finished || this.finishedAt === null) throw new Error('the exam is not over');
    const answered = this.delivered.filter((d) => d.response !== null);
    const scored = answered.filter((d) => !d.pretest);
    return {
      passed: this.passed(),
      reason: this.finished,
      // No scored answer: there is no evidence of ability, so the prior (the passing standard) must not show as 700.
      scaledScore: scored.length === 0 ? 0 : scaledScore(this.estimate.theta, this.config.passingTheta),
      theta: this.estimate.theta,
      standardError: this.estimate.se,
      itemsAnswered: answered.length,
      scoredItems: scored.length,
      elapsedSeconds: Math.round((this.finishedAt - this.startedAt) / 1000),
      breaks: this.breaks,
      domains: DOMAINS.map((info): DomainReport => {
        const items = scored.filter((d) => d.question.domain === info.id);
        const correct = items.filter((d) => d.correct).length;
        let band: DomainReport['band'] = 'Not enough items';
        if (items.length >= 3) {
          // Shrunk per-domain estimate: few items per domain, so a tighter prior keeps the band honest.
          const t = estimateAbility(items.map((d) => ({ difficulty: d.question.difficulty, correct: d.correct })), 1).theta;
          const delta = t - this.config.passingTheta;
          band = delta > 0.3 ? 'Above Proficiency Standard' : delta < -0.3 ? 'Below Proficiency Standard' : 'Near Proficiency Standard';
        }
        return { domain: info.id, name: info.name, weight: info.weight, answered: items.length, correct, band };
      }),
      incidents: [...this.incidents],
      review: answered.map((d, i): ReviewItem => ({
        number: i + 1,
        id: d.question.id,
        domain: d.question.domain,
        type: d.question.type,
        stem: d.question.stem,
        options: [...d.question.options],
        response: d.response ?? [],
        answer: [...d.question.answer],
        correct: d.correct,
        pretest: d.pretest,
        explanation: d.question.explanation,
        optionNotes: [...(d.question.optionNotes ?? [])],
      })),
    };
  }

  private scoredResponses(): ScoredResponse[] {
    return this.delivered
      .filter((d) => !d.pretest && d.response !== null)
      .map((d) => ({ difficulty: d.question.difficulty, correct: d.correct }));
  }

  private passed(): boolean {
    const cut = this.config.passingTheta;
    switch (this.finished) {
      case 'pass-confidence':
        return true;
      case 'max-items':
      case 'bank-exhausted':
        return this.estimate.theta > cut;
      case 'time-expired': {
        if (this.delivered.filter((d) => d.response !== null).length < this.config.minItems) return false;
        const window = this.thetaHistory.slice(-this.config.timeoutWindow);
        return window.length > 0 && window.every((t) => t > cut);
      }
      default:
        return false;
    }
  }

  private decideOrContinue(): void {
    const answered = this.delivered.length;
    const { theta, se } = this.estimate;
    const cut = this.config.passingTheta;
    if (answered >= this.config.minItems && Math.abs(theta - cut) >= this.config.confidenceZ * se) {
      this.finish(theta > cut ? 'pass-confidence' : 'fail-confidence');
    } else if (answered >= this.config.maxItems) {
      this.finish('max-items');
    } else if (!this.deliverNext()) {
      this.finish('bank-exhausted');
    }
  }

  private finish(reason: FinishReason): void {
    this.finished = reason;
    this.finishedAt = Math.min(this.now(), this.deadline);
  }

  private deliverNext(): boolean {
    const position = this.delivered.length;
    const pretest = this.pretestPositions.has(position);
    const domain = this.nextDomain();
    if (domain === null) return false;
    const pool = this.bank.filter((q) => q.domain === domain && !this.used.has(q.id));
    let pick: Question;
    if (pretest) {
      pick = pool[Math.floor(this.rng() * pool.length)];
    } else {
      const theta = this.estimate.theta;
      const closest = [...pool]
        .sort((a, b) => Math.abs(a.difficulty - theta) - Math.abs(b.difficulty - theta))
        .slice(0, 5);
      pick = closest[Math.floor(this.rng() * closest.length)];
    }
    this.used.add(pick.id);
    this.delivered.push({ question: pick, pretest, response: null, correct: false });
    return true;
  }

  /** Domain furthest below its blueprint share, among domains that still have unused items. */
  private nextDomain(): DomainId | null {
    const counts: Record<number, number> = {};
    for (const d of this.delivered) counts[d.question.domain] = (counts[d.question.domain] ?? 0) + 1;
    const n = this.delivered.length + 1;
    let best: DomainId | null = null;
    let bestGap = -Infinity;
    for (const info of DOMAINS) {
      if (!this.bank.some((q) => q.domain === info.id && !this.used.has(q.id))) continue;
      const gap = info.weight * n - (counts[info.id] ?? 0) + this.rng() * 1e-6;
      if (gap > bestGap) {
        bestGap = gap;
        best = info.id;
      }
    }
    return best;
  }
}
