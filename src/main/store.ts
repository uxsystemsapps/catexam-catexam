import { promises as fs } from 'node:fs';
import path from 'node:path';
import { mergeBanks, validateBank } from '../engine/bank';
import type { Question, QuestionBank } from '../engine/types';
import type { HistoryEntry } from '../shared/api';

const HISTORY_LIMIT = 100;

async function readBanksFrom(dir: string): Promise<{ banks: QuestionBank[]; files: string[]; errors: string[] }> {
  const banks: QuestionBank[] = [];
  const files: string[] = [];
  const errors: string[] = [];
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  } catch {
    return { banks, files, errors };
  }
  for (const name of names) {
    try {
      const { bank, errors: e } = validateBank(JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')));
      if (bank) {
        banks.push(bank);
        files.push(name);
      } else errors.push(...e.map((m) => `${name}: ${m}`));
    } catch (err) {
      errors.push(`${name}: ${(err as Error).message}`);
    }
  }
  return { banks, files, errors };
}

/** Built-in banks (shipped in `questions/`) plus banks the user imported into the profile folder. */
export async function loadQuestions(
  builtinDir: string,
  userDir: string,
): Promise<{ questions: Question[]; imported: string[]; errors: string[] }> {
  const builtin = await readBanksFrom(builtinDir);
  const user = await readBanksFrom(path.join(userDir, 'banks'));
  const merged = mergeBanks([...builtin.banks, ...user.banks]);
  return { questions: merged.questions, imported: user.files, errors: [...builtin.errors, ...user.errors, ...merged.errors] };
}

/** Validates a bank file and copies it into the profile; nothing is copied when it has errors. */
export async function importBank(file: string, userDir: string): Promise<{ imported: string | null; errors: string[] }> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    return { imported: null, errors: [`cannot read ${path.basename(file)}: ${(err as Error).message}`] };
  }
  const { bank, errors } = validateBank(raw);
  if (!bank) return { imported: null, errors };
  const dir = path.join(userDir, 'banks');
  await fs.mkdir(dir, { recursive: true });
  const name = path.basename(file);
  await fs.writeFile(path.join(dir, name), JSON.stringify(bank, null, 2));
  return { imported: name, errors: [] };
}

export async function readHistory(userDir: string): Promise<HistoryEntry[]> {
  try {
    const data: unknown = JSON.parse(await fs.readFile(path.join(userDir, 'history.json'), 'utf8'));
    return Array.isArray(data) ? (data as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export async function appendHistory(userDir: string, entry: HistoryEntry): Promise<void> {
  const history = [entry, ...(await readHistory(userDir))].slice(0, HISTORY_LIMIT);
  await fs.mkdir(userDir, { recursive: true });
  await fs.writeFile(path.join(userDir, 'history.json'), JSON.stringify(history, null, 2));
}
