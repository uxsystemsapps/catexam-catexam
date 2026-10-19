import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DataDir, ImportFile } from '../core/store';

/** A folder of the file system as a `DataDir`. */
export function fsDir(root: string): DataDir {
  return {
    async read(name) {
      try {
        return await fs.readFile(path.join(root, name), 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
    // Writes through a temporary file, so a crash never leaves a half-written file behind.
    async write(name, text) {
      const file = path.join(root, name);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(`${file}.tmp`, text);
      await fs.rename(`${file}.tmp`, file);
    },
    async list(dir) {
      return (await fs.readdir(path.join(root, dir), { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
    },
    async remove(name) {
      await fs.unlink(path.join(root, name));
    },
  };
}

/** The files directly in `folder`, for a bank import. */
export async function folderFiles(folder: string): Promise<ImportFile[]> {
  return (await fs.readdir(folder, { withFileTypes: true }))
    .filter((e) => e.isFile())
    .map((e) => ({ name: e.name, read: () => fs.readFile(path.join(folder, e.name), 'utf8') }));
}
