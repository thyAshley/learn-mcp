import { randomUUID } from 'node:crypto';

import { silentLogger, type ActionLogger } from './logger.js';
import type { Store } from './store.js';

export interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNoteInput {
  title: string;
  body?: string;
}

export interface UpdateNoteInput {
  title?: string;
  body?: string;
}

/** Thrown when caller-supplied input is unusable. Maps to HTTP 400. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface NotesService {
  list(): Promise<Note[]>;
  get(id: string): Promise<Note | undefined>;
  create(input: CreateNoteInput): Promise<Note>;
  update(id: string, patch: UpdateNoteInput): Promise<Note | undefined>;
  remove(id: string): Promise<boolean>;
}

function parseTitle(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError('"title" is required and must be a string.');
  }

  const title = value.trim();
  if (title === '') {
    throw new ValidationError('"title" must not be empty.');
  }

  return title;
}

function parseBody(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError('"body" must be a string.');
  }

  return value;
}

/**
 * CRUD operations over notes, persisted through the given store.
 *
 * Logs each action that changes data. Note bodies are deliberately never
 * logged — only ids, titles, and which fields changed.
 */
export function createNotesService(
  store: Store,
  log: ActionLogger = silentLogger,
): NotesService {
  async function list(): Promise<Note[]> {
    const notes = await store.read();
    // Notes are appended in creation order. Reversing first means that notes
    // sharing a timestamp (same millisecond) still come back newest-first,
    // since Array.prototype.sort is stable.
    return [...notes]
      .reverse()
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  /**
   * Runs an operation, logging any rejected input as a warning before
   * rethrowing. Bad input is the caller's mistake, not a server fault, so it
   * belongs at warn rather than error.
   */
  async function reportingValidation<T>(
    action: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ValidationError) {
        log.warn({ action, reason: error.message }, 'validation rejected');
      }
      throw error;
    }
  }

  return {
    list,

    async get(id) {
      const notes = await store.read();
      return notes.find((note) => note.id === id);
    },

    create(input) {
      return reportingValidation('create', async () => {
        const payload: unknown = input ?? {};
        if (typeof payload !== 'object' || Array.isArray(payload)) {
          throw new ValidationError('Request body must be a JSON object.');
        }

        const fields = payload as Record<string, unknown>;
        const title = parseTitle(fields['title']);
        const body =
          fields['body'] === undefined ? '' : parseBody(fields['body']);

        const now = new Date().toISOString();
        const note: Note = {
          id: randomUUID(),
          title,
          body,
          createdAt: now,
          updatedAt: now,
        };

        const notes = await store.read();
        await store.write([...notes, note]);

        log.info({ id: note.id, title: note.title }, 'note created');

        return note;
      });
    },

    update(id, patch) {
      return reportingValidation('update', async () => {
        const payload: unknown = patch ?? {};
        if (typeof payload !== 'object' || Array.isArray(payload)) {
          throw new ValidationError('Request body must be a JSON object.');
        }

        const fields = payload as Record<string, unknown>;
        const hasTitle = fields['title'] !== undefined;
        const hasBody = fields['body'] !== undefined;

        if (!hasTitle && !hasBody) {
          throw new ValidationError(
            'Provide at least one of "title" or "body" to update.',
          );
        }

        // Validate before reading, so bad input never touches the file.
        const title = hasTitle ? parseTitle(fields['title']) : undefined;
        const body = hasBody ? parseBody(fields['body']) : undefined;

        const notes = await store.read();
        const index = notes.findIndex((note) => note.id === id);
        if (index === -1) return undefined;

        const existing = notes[index]!;
        const updated: Note = {
          ...existing,
          ...(title !== undefined ? { title } : {}),
          ...(body !== undefined ? { body } : {}),
          updatedAt: new Date().toISOString(),
        };

        const next = [...notes];
        next[index] = updated;
        await store.write(next);

        const changed = [
          ...(title !== undefined ? ['title'] : []),
          ...(body !== undefined ? ['body'] : []),
        ];
        log.info({ id: updated.id, fields: changed }, 'note updated');

        return updated;
      });
    },

    async remove(id) {
      const notes = await store.read();
      const remaining = notes.filter((note) => note.id !== id);

      if (remaining.length === notes.length) return false;

      await store.write(remaining);

      log.info({ id }, 'note deleted');

      return true;
    },
  };
}
