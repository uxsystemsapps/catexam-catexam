import { promises as fs } from 'node:fs';
import path from 'node:path';
import { mergeBanks, validateBank } from '../engine/bank';
import { normalizeProfile, normalizeProgress, type Profile, type Progress } from '../engine/profile';
import type { Question, QuestionBank } from '../engine/types';
import type { HistoryEntry, HistoryKind, TrainingEntry } from '../shared/api';

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
