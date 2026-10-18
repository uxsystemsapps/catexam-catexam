import { DOMAIN_IDS } from './domains';
import type { DomainId, Question, QuestionBank, QuestionType } from './types';

const TYPES: readonly QuestionType[] = ['single', 'multi', 'ordering'];

export interface BankValidation {
  bank: QuestionBank | null;
  errors: string[];
}

function isIntArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((x) => Number.isInteger(x));
}

/** Validates an untrusted bank (parsed JSON). Returns the bank only when there are no errors. */
export function validateBank(raw: unknown): BankValidation {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) return { bank: null, errors: ['bank is not a JSON object'] };
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== 'string' || obj.name.trim() === '') errors.push('bank "name" must be a non-empty string');
  if (!Array.isArray(obj.questions) || obj.questions.length === 0) {
    errors.push('bank "questions" must be a non-empty array');
    return { bank: null, errors };
  }
  const ids = new Set<string>();
  const questions: Question[] = [];
  obj.questions.forEach((q: unknown, i: number) => {
    const where = `question #${i + 1}`;
    if (typeof q !== 'object' || q === null) {
      errors.push(`${where}: not an object`);
      return;
    }
    const r = q as Record<string, unknown>;
    const id = typeof r.id === 'string' && r.id.trim() !== '' ? r.id : null;
    const at = id ? `${where} (${id})` : where;
    if (!id) errors.push(`${where}: "id" must be a non-empty string`);
    else if (ids.has(id)) errors.push(`${at}: duplicate id`);
    else ids.add(id);
    if (!DOMAIN_IDS.includes(r.domain as DomainId)) errors.push(`${at}: "domain" must be 1-8`);
    if (!TYPES.includes(r.type as QuestionType)) errors.push(`${at}: "type" must be single, multi or ordering`);
    if (typeof r.difficulty !== 'number' || !Number.isFinite(r.difficulty) || Math.abs(r.difficulty) > 4) {
      errors.push(`${at}: "difficulty" must be a number between -4 and 4`);
    }
    if (typeof r.stem !== 'string' || r.stem.trim() === '') errors.push(`${at}: "stem" must be a non-empty string`);
    if (typeof r.explanation !== 'string') errors.push(`${at}: "explanation" must be a string`);
    const options = r.options;
    if (!Array.isArray(options) || options.length < 2 || options.length > 8 || !options.every((o) => typeof o === 'string' && o.trim() !== '')) {
      errors.push(`${at}: "options" must be 2-8 non-empty strings`);
      return;
    }
    const answer = r.answer;
    if (!isIntArray(answer) || answer.some((a) => a < 0 || a >= options.length) || new Set(answer).size !== answer.length) {
      errors.push(`${at}: "answer" must be distinct option indices`);
      return;
    }
    if (r.type === 'single' && answer.length !== 1) errors.push(`${at}: single needs exactly one answer`);
    if (r.type === 'multi' && (answer.length < 2 || answer.length >= options.length)) {
      errors.push(`${at}: multi needs at least two answers and at least one wrong option`);
    }
    if (r.type === 'ordering' && answer.length !== options.length) errors.push(`${at}: ordering answer must list every option`);
    questions.push({
      id: id ?? '',
      domain: r.domain as DomainId,
      type: r.type as QuestionType,
      difficulty: r.difficulty as number,
      stem: r.stem as string,
      options: options as string[],
      answer: r.type === 'ordering' ? [...answer] : [...answer].sort((a, b) => a - b),
      explanation: r.explanation as string,
    });
  });
  if (errors.length > 0) return { bank: null, errors };
  return { bank: { name: obj.name as string, questions }, errors };
}

/** Merges banks; a question id that appears again is an error (the first one wins). */
export function mergeBanks(banks: readonly QuestionBank[]): { questions: Question[]; errors: string[] } {
  const seen = new Set<string>();
  const questions: Question[] = [];
  const errors: string[] = [];
  for (const b of banks) {
    for (const q of b.questions) {
      if (seen.has(q.id)) {
        errors.push(`${b.name}: duplicate id ${q.id} skipped`);
        continue;
      }
      seen.add(q.id);
      questions.push(q);
    }
  }
  return { questions, errors };
}

/** True when the response is a valid shape for the question (it may still be wrong). */
export function isValidResponse(q: Question, response: readonly number[]): boolean {
  if (!isIntArray(response as unknown)) return false;
  if (response.some((r) => r < 0 || r >= q.options.length)) return false;
  if (new Set(response).size !== response.length) return false;
  if (q.type === 'single') return response.length === 1;
  if (q.type === 'multi') return response.length === q.answer.length;
  return response.length === q.options.length;
}

/** Dichotomous scoring: the whole item is right or wrong, as on the real exam. */
export function isCorrect(q: Question, response: readonly number[]): boolean {
  if (!isValidResponse(q, response)) return false;
  const given = q.type === 'ordering' ? [...response] : [...response].sort((a, b) => a - b);
  return given.length === q.answer.length && given.every((v, i) => v === q.answer[i]);
}
