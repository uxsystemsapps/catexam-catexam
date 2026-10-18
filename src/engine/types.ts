/** The eight CISSP domains (ISC2 exam outline effective April 2024). */
export type DomainId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * single: one correct option.
 * multi: several correct options ("Select TWO"); all must be selected and nothing else.
 * ordering: drag-and-drop item; the response is the full order of option indices.
 */
export type QuestionType = 'single' | 'multi' | 'ordering';

export interface Question {
  id: string;
  domain: DomainId;
  type: QuestionType;
  /** Rasch (1PL) difficulty in logits; 0 sits at the passing standard. */
  difficulty: number;
  stem: string;
  options: string[];
  /** single/multi: correct option indices (sorted); ordering: option indices in the correct order. */
  answer: number[];
  explanation: string;
}

export interface QuestionBank {
  name: string;
  questions: Question[];
}

/** What the candidate's screen may see: no answer, no explanation, no difficulty. */
export interface QuestionView {
  id: string;
  /** 1-based position in the exam. */
  number: number;
  type: QuestionType;
  stem: string;
  options: string[];
  /** For multi: how many options must be selected. */
  selectCount: number;
}

export type FinishReason =
  | 'pass-confidence'
  | 'fail-confidence'
  | 'max-items'
  | 'time-expired'
  | 'bank-exhausted'
  | 'ended-by-candidate';

export type ProficiencyBand = 'Above Proficiency Standard' | 'Near Proficiency Standard' | 'Below Proficiency Standard';

export interface DomainReport {
  domain: DomainId;
  name: string;
  weight: number;
  answered: number;
  correct: number;
  band: ProficiencyBand | 'Not enough items';
}

export interface ReviewItem {
  number: number;
  id: string;
  domain: DomainId;
  type: QuestionType;
  stem: string;
  options: string[];
  response: number[];
  answer: number[];
  correct: boolean;
  /** Unscored pretest item: it did not count toward the result. */
  pretest: boolean;
  explanation: string;
}

export interface Incident {
  /** Seconds since exam start. */
  at: number;
  kind: string;
  detail: string;
}

export interface ExamResult {
  passed: boolean;
  reason: FinishReason;
  /** Training estimate on the 0-1000 scale (700 = passing standard). The real exam only reports it on a fail. */
  scaledScore: number;
  theta: number;
  standardError: number;
  itemsAnswered: number;
  scoredItems: number;
  elapsedSeconds: number;
  breaks: number;
  domains: DomainReport[];
  incidents: Incident[];
  review: ReviewItem[];
}
