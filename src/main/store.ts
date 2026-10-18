import { promises as fs } from 'node:fs';
import path from 'node:path';
import { mergeBanks, validateBank } from '../engine/bank';
import { normalizeProfile, normalizeProgress, type Profile, type Progress } from '../engine/profile';
import type { Question, QuestionBank } from '../engine/types';
import type { BankImportFile, BankImportSummary, HistoryEntry, HistoryKind, ImportedBank, TrainingEntry } from '../shared/api';

const HISTORY_LIMIT = 100;
const TRAINING_HISTORY_LIMIT = 200;
const HISTORY_FILES: Record<HistoryKind, string> = { exam: 'history.json', training: 'training-history.json' };

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
): Promise<{ questions: Question[]; imported: ImportedBank[]; errors: string[] }> {
  const builtin = await readBanksFrom(builtinDir);
  const user = await readBanksFrom(path.join(userDir, 'banks'));
  const merged = mergeBanks([...builtin.banks, ...user.banks]);
  const imported = user.banks.map((b, i) => ({ file: user.files[i], name: b.name, questions: b.questions.length }));
  return { questions: merged.questions, imported, errors: [...builtin.errors, ...user.errors, ...merged.errors] };
}

/**
 * Validates every `*.json` file of `folder` and copies the valid ones into the profile. A file whose bank
 * name is already loaded (built-in, imported before, or earlier in the same folder) is skipped; a file with
 * errors is not copied.
 */
export async function importBankFolder(folder: string, builtinDir: string, userDir: string): Promise<BankImportSummary> {
  const builtin = await readBanksFrom(builtinDir);
  const dir = path.join(userDir, 'banks');
  const user = await readBanksFrom(dir);
  const names = new Set([...builtin.banks, ...user.banks].map((b) => b.name));
  let taken: Set<string>;
  try {
    taken = new Set(await fs.readdir(dir));
  } catch {
    taken = new Set();
  }
  let entries: string[];
  try {
    entries = (await fs.readdir(folder, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.json'))
      .map((e) => e.name)
      .sort();
  } catch (err) {
    return { folder, files: [], added: 0, questions: 0, error: `cannot read the folder: ${(err as Error).message}` };
  }
  const files: BankImportFile[] = [];
  for (const file of entries) {
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(path.join(folder, file), 'utf8'));
    } catch (err) {
      files.push({ file, status: 'failed', bank: '', questions: 0, errors: [`not readable JSON: ${(err as Error).message}`] });
      continue;
    }
    const { bank, errors } = validateBank(raw);
    if (!bank) {
      const name = raw !== null && typeof raw === 'object' && 'name' in raw && typeof raw.name === 'string' ? raw.name : '';
      files.push({ file, status: 'failed', bank: name, questions: 0, errors });
      continue;
    }
    if (names.has(bank.name)) {
      files.push({ file, status: 'skipped', bank: bank.name, questions: bank.questions.length, errors: [] });
      continue;
    }
    // Never overwrite another imported bank that happens to have the same file name.
    const base = file.slice(0, -'.json'.length);
    let target = `${base}.json`;
    for (let n = 2; taken.has(target); n++) target = `${base}-${n}.json`;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, target), JSON.stringify(bank, null, 2));
    taken.add(target);
    names.add(bank.name);
    files.push({ file, status: 'added', bank: bank.name, questions: bank.questions.length, errors: [] });
  }
  const added = files.filter((f) => f.status === 'added');
  return { folder, files, added: added.length, questions: added.reduce((s, f) => s + f.questions, 0) };
}

/** Deletes an imported bank from the profile; `file` must be a bank file name listed by `loadQuestions`. */
export async function removeBank(file: string, userDir: string): Promise<void> {
  if (path.basename(file) !== file || !file.endsWith('.json')) throw new Error('not an imported bank');
  await fs.unlink(path.join(userDir, 'banks', file));
}

/** Parsed JSON file of the profile folder, or undefined when it is missing or unreadable. */
async function readJson(userDir: string, name: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(path.join(userDir, name), 'utf8'));
  } catch {
    return undefined;
  }
}

/** Writes through a temporary file, so a crash never leaves a half-written file behind. */
async function writeJson(userDir: string, name: string, data: unknown): Promise<void> {
  await fs.mkdir(userDir, { recursive: true });
  const file = path.join(userDir, name);
  await fs.writeFile(`${file}.tmp`, JSON.stringify(data, null, 2));
  await fs.rename(`${file}.tmp`, file);
}

export async function readHistory(userDir: string): Promise<HistoryEntry[]> {
  const data = await readJson(userDir, HISTORY_FILES.exam);
  return Array.isArray(data) ? (data as HistoryEntry[]) : [];
}

export async function readTrainingHistory(userDir: string): Promise<TrainingEntry[]> {
  const data = await readJson(userDir, HISTORY_FILES.training);
  return Array.isArray(data) ? (data as TrainingEntry[]) : [];
}

export async function appendHistory(userDir: string, entry: HistoryEntry): Promise<void> {
  await writeJson(userDir, HISTORY_FILES.exam, [entry, ...(await readHistory(userDir))].slice(0, HISTORY_LIMIT));
}

export async function appendTrainingHistory(userDir: string, entry: TrainingEntry): Promise<void> {
  await writeJson(userDir, HISTORY_FILES.training, [entry, ...(await readTrainingHistory(userDir))].slice(0, TRAINING_HISTORY_LIMIT));
}

/** Deletes the entries of one history with the given dates (all of them when `dates` is null). */
export async function deleteHistory(userDir: string, kind: HistoryKind, dates: readonly string[] | null): Promise<void> {
  const entries = kind === 'exam' ? await readHistory(userDir) : await readTrainingHistory(userDir);
  await writeJson(userDir, HISTORY_FILES[kind], dates === null ? [] : entries.filter((e) => !dates.includes(e.date)));
}

export async function readProfile(userDir: string): Promise<Profile> {
  return normalizeProfile(await readJson(userDir, 'profile.json'));
}

export async function saveProfile(userDir: string, profile: Profile): Promise<void> {
  await writeJson(userDir, 'profile.json', profile);
}

export async function readProgress(userDir: string): Promise<Progress> {
  return normalizeProgress(await readJson(userDir, 'progress.json'));
}

export async function saveProgress(userDir: string, progress: Progress): Promise<void> {
  await writeJson(userDir, 'progress.json', progress);
}
