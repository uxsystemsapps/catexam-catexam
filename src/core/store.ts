import { mergeBanks, validateBank } from '../engine/bank';
import { normalizeProfile, normalizeProgress, type Profile, type Progress } from '../engine/profile';
import type { Question, QuestionBank } from '../engine/types';
import type { BankImportFile, BankImportSummary, HistoryEntry, HistoryKind, ImportedBank, TrainingEntry } from '../shared/api';

/**
 * A folder of files, addressed by relative names such as `profile.json` or `banks/a.json`. The desktop app
 * backs it with the file system (src/main/fsdir.ts), the Android app with IndexedDB (src/mobile/idbdir.ts).
 */
export interface DataDir {
  /** Text of the file, or null when it does not exist. */
  read(name: string): Promise<string | null>;
  /** Writes the whole file at once; a crash never leaves it half-written. */
  write(name: string, text: string): Promise<void>;
  /** Names of the files directly in `dir` (`''` for the top level); throws when `dir` cannot be read. */
  list(dir: string): Promise<string[]>;
  remove(name: string): Promise<void>;
}

/** One file offered for import (a file of the chosen folder, or a file picked on the phone). */
export interface ImportFile {
  name: string;
  read(): Promise<string>;
}

const HISTORY_LIMIT = 100;
const TRAINING_HISTORY_LIMIT = 200;
const HISTORY_FILES: Record<HistoryKind, string> = { exam: 'history.json', training: 'training-history.json' };
const BANKS = 'banks';

async function readBanksFrom(dir: DataDir, sub: string): Promise<{ banks: QuestionBank[]; files: string[]; errors: string[] }> {
  const banks: QuestionBank[] = [];
  const files: string[] = [];
  const errors: string[] = [];
  let names: string[];
  try {
    names = (await dir.list(sub)).filter((n) => n.toLowerCase().endsWith('.json')).sort();
  } catch {
    return { banks, files, errors };
  }
  for (const name of names) {
    try {
      const { bank, errors: e } = validateBank(JSON.parse((await dir.read(sub ? `${sub}/${name}` : name)) ?? ''));
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

/** Built-in banks (the top level of `builtin`) plus the banks the user imported into `user` (its `banks/`). */
export async function loadQuestions(
  builtin: DataDir,
  user: DataDir,
): Promise<{ questions: Question[]; imported: ImportedBank[]; errors: string[] }> {
  const shipped = await readBanksFrom(builtin, '');
  const own = await readBanksFrom(user, BANKS);
  const merged = mergeBanks([...shipped.banks, ...own.banks]);
  const imported = own.banks.map((b, i) => ({ file: own.files[i], name: b.name, questions: b.questions.length }));
  return { questions: merged.questions, imported, errors: [...shipped.errors, ...own.errors, ...merged.errors] };
}

/**
 * Validates every `*.json` file of `files` and copies the valid ones into the profile. A file whose bank
 * name is already loaded (built-in, imported before, or earlier in the same import) is skipped; a file with
 * errors is not copied. `source` names what was picked (a folder path, or the picked files) in the summary.
 */
export async function importBanks(
  source: string,
  files: () => Promise<ImportFile[]>,
  builtin: DataDir,
  user: DataDir,
): Promise<BankImportSummary> {
  const shipped = await readBanksFrom(builtin, '');
  const own = await readBanksFrom(user, BANKS);
  const names = new Set([...shipped.banks, ...own.banks].map((b) => b.name));
  let taken: Set<string>;
  try {
    taken = new Set(await user.list(BANKS));
  } catch {
    taken = new Set();
  }
  let entries: ImportFile[];
  try {
    entries = (await files()).filter((f) => f.name.toLowerCase().endsWith('.json')).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch (err) {
    return { folder: source, files: [], added: 0, questions: 0, error: `cannot read ${source}: ${(err as Error).message}` };
  }
  const report: BankImportFile[] = [];
  for (const entry of entries) {
    const file = entry.name;
    let raw: unknown;
    try {
      raw = JSON.parse(await entry.read());
    } catch (err) {
      report.push({ file, status: 'failed', bank: '', questions: 0, errors: [`not readable JSON: ${(err as Error).message}`] });
      continue;
    }
    const { bank, errors } = validateBank(raw);
    if (!bank) {
      const name = raw !== null && typeof raw === 'object' && 'name' in raw && typeof raw.name === 'string' ? raw.name : '';
      report.push({ file, status: 'failed', bank: name, questions: 0, errors });
      continue;
    }
    if (names.has(bank.name)) {
      report.push({ file, status: 'skipped', bank: bank.name, questions: bank.questions.length, errors: [] });
      continue;
    }
    // Never overwrite another imported bank that happens to have the same file name.
    const base = file.slice(0, -'.json'.length);
    let target = `${base}.json`;
    for (let n = 2; taken.has(target); n++) target = `${base}-${n}.json`;
    await user.write(`${BANKS}/${target}`, JSON.stringify(bank, null, 2));
    taken.add(target);
    names.add(bank.name);
    report.push({ file, status: 'added', bank: bank.name, questions: bank.questions.length, errors: [] });
  }
  const added = report.filter((f) => f.status === 'added');
  return { folder: source, files: report, added: added.length, questions: added.reduce((s, f) => s + f.questions, 0) };
}

/** Deletes an imported bank from the profile; `file` must be a bank file name listed by `loadQuestions`. */
export async function removeBank(file: string, user: DataDir): Promise<void> {
  if (!/^[^/\\]+\.json$/.test(file)) throw new Error('not an imported bank');
  await user.remove(`${BANKS}/${file}`);
}

/** Parsed JSON file of the profile, or undefined when it is missing or unreadable. */
async function readJson(user: DataDir, name: string): Promise<unknown> {
  try {
    const text = await user.read(name);
    return text === null ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function writeJson(user: DataDir, name: string, data: unknown): Promise<void> {
  await user.write(name, JSON.stringify(data, null, 2));
}

export async function readHistory(user: DataDir): Promise<HistoryEntry[]> {
  const data = await readJson(user, HISTORY_FILES.exam);
  return Array.isArray(data) ? (data as HistoryEntry[]) : [];
}

export async function readTrainingHistory(user: DataDir): Promise<TrainingEntry[]> {
  const data = await readJson(user, HISTORY_FILES.training);
  return Array.isArray(data) ? (data as TrainingEntry[]) : [];
}

export async function appendHistory(user: DataDir, entry: HistoryEntry): Promise<void> {
  await writeJson(user, HISTORY_FILES.exam, [entry, ...(await readHistory(user))].slice(0, HISTORY_LIMIT));
}

export async function appendTrainingHistory(user: DataDir, entry: TrainingEntry): Promise<void> {
  await writeJson(user, HISTORY_FILES.training, [entry, ...(await readTrainingHistory(user))].slice(0, TRAINING_HISTORY_LIMIT));
}

/** Deletes the entries of one history with the given dates (all of them when `dates` is null). */
export async function deleteHistory(user: DataDir, kind: HistoryKind, dates: readonly string[] | null): Promise<void> {
  const entries = kind === 'exam' ? await readHistory(user) : await readTrainingHistory(user);
  await writeJson(user, HISTORY_FILES[kind], dates === null ? [] : entries.filter((e) => !dates.includes(e.date)));
}

export async function readProfile(user: DataDir): Promise<Profile> {
  return normalizeProfile(await readJson(user, 'profile.json'));
}

export async function saveProfile(user: DataDir, profile: Profile): Promise<void> {
  await writeJson(user, 'profile.json', profile);
}

export async function readProgress(user: DataDir): Promise<Progress> {
  return normalizeProgress(await readJson(user, 'progress.json'));
}

export async function saveProgress(user: DataDir, progress: Progress): Promise<void> {
  await writeJson(user, 'progress.json', progress);
}
