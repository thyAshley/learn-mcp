import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { Note } from './notes.js';

export interface Store {
  read(): Promise<Note[]>;
  write(notes: Note[]): Promise<void>;
}

/**
 * Persists notes as a JSON array in a single file.
 *
 * Writes go to a temporary file that is then renamed into place, so an
 * interrupted write can never leave a half-written notes file behind. All
 * writes are chained onto one promise so overlapping requests cannot
 * interleave and lose data.
 */
export function createStore(filePath: string): Store {
  let pending: Promise<unknown> = Promise.resolve();

  /** Queues work so only one file operation runs at a time. */
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation, operation);
    // Swallow rejections on the chain itself; callers still see their own.
    pending = result.catch(() => undefined);
    return result;
  }

  async function readNotes(): Promise<Note[]> {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }

    if (raw.trim() === '') return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        `Notes file at ${filePath} contains malformed JSON. ` +
          'Fix or remove the file to continue.',
      );
    }

    if (!Array.isArray(parsed)) {
      throw new Error(
        `Notes file at ${filePath} must contain a JSON array of notes.`,
      );
    }

    return parsed as Note[];
  }

  async function writeNotes(notes: Note[]): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });

    const temp = join(dirname(filePath), `.${randomUUID()}.tmp`);
    await writeFile(temp, `${JSON.stringify(notes, null, 2)}\n`, 'utf8');
    await rename(temp, filePath);
  }

  return {
    read: () => enqueue(readNotes),
    write: (notes) => enqueue(() => writeNotes(notes)),
  };
}
