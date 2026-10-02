import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

import { createStore } from '../src/store.js';
import { createNotesService, ValidationError } from '../src/notes.js';
import { createApp } from '../src/server.js';
import type { ActionLogger } from '../src/logger.js';

interface Entry {
  level: 'info' | 'warn' | 'error';
  message: string;
  details: Record<string, unknown>;
}

/** An ActionLogger that records calls instead of writing them anywhere. */
function createCapturingLogger() {
  const entries: Entry[] = [];

  const record =
    (level: Entry['level']) =>
    (details: Record<string, unknown>, message: string) => {
      entries.push({ level, message, details });
    };

  const logger: ActionLogger = {
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
  };

  return {
    logger,
    entries,
    find: (message: string) => entries.filter((e) => e.message === message),
  };
}

let dir: string;
let log: ReturnType<typeof createCapturingLogger>;
let notes: ReturnType<typeof createNotesService>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'notes-logging-'));
  log = createCapturingLogger();
  notes = createNotesService(createStore(join(dir, 'notes.json')), log.logger);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('note actions', () => {
  test('logs one info entry when a note is created', async () => {
    const note = await notes.create({ title: 'Groceries', body: 'milk' });

    const logged = log.find('note created');
    expect(logged).toHaveLength(1);
    expect(logged[0]!.level).toBe('info');
    expect(logged[0]!.details).toMatchObject({
      id: note.id,
      title: 'Groceries',
    });
  });

  test('does not log the note body', async () => {
    await notes.create({ title: 'Groceries', body: 'secret milk' });

    expect(JSON.stringify(log.entries)).not.toContain('secret milk');
  });

  test('logs which fields changed on update', async () => {
    const note = await notes.create({ title: 'Old', body: 'text' });

    await notes.update(note.id, { body: 'new text' });

    const logged = log.find('note updated');
    expect(logged).toHaveLength(1);
    expect(logged[0]!.details).toMatchObject({ id: note.id, fields: ['body'] });
  });

  test('logs a deletion', async () => {
    const note = await notes.create({ title: 'Groceries' });

    await notes.remove(note.id);

    expect(log.find('note deleted')[0]!.details).toMatchObject({ id: note.id });
  });

  test('logs nothing for an update that matched no note', async () => {
    await notes.update('does-not-exist', { title: 'New' });

    expect(log.find('note updated')).toHaveLength(0);
  });

  test('logs nothing for a deletion that matched no note', async () => {
    await notes.remove('does-not-exist');

    expect(log.find('note deleted')).toHaveLength(0);
  });
});

describe('validation failures', () => {
  test('log a warning rather than an error', async () => {
    await expect(notes.create({ title: '' })).rejects.toThrow(ValidationError);

    const logged = log.find('validation rejected');
    expect(logged).toHaveLength(1);
    expect(logged[0]!.level).toBe('warn');
    expect(logged[0]!.details.reason).toMatch(/title/i);
  });

  test('do not log a note as created', async () => {
    await expect(notes.create({ title: '' })).rejects.toThrow(ValidationError);

    expect(log.find('note created')).toHaveLength(0);
  });
});

describe('request logging', () => {
  test('logs API requests with method, path, and status', async () => {
    const app = createApp(notes, log.logger);

    await request(app).get('/notes');

    const logged = log.find('request');
    expect(logged).toHaveLength(1);
    expect(logged[0]!.details).toMatchObject({
      method: 'GET',
      path: '/notes',
      status: 200,
    });
    expect(typeof logged[0]!.details.durationMs).toBe('number');
  });

  test('does not log static asset requests', async () => {
    const app = createApp(notes, log.logger);

    await request(app).get('/');
    await request(app).get('/app.js');

    expect(log.find('request')).toHaveLength(0);
  });

  test('logs a 404 for an unknown note', async () => {
    const app = createApp(notes, log.logger);

    await request(app).get('/notes/does-not-exist');

    expect(log.find('request')[0]!.details).toMatchObject({ status: 404 });
  });
});

describe('unexpected failures', () => {
  test('log at error level with the cause', async () => {
    const boom = new Error('disk on fire');
    const app = createApp(
      {
        list: () => Promise.reject(boom),
        get: () => Promise.reject(boom),
        create: () => Promise.reject(boom),
        update: () => Promise.reject(boom),
        remove: () => Promise.reject(boom),
      },
      log.logger,
    );

    const response = await request(app).get('/notes');

    expect(response.status).toBe(500);
    const logged = log.find('request failed');
    expect(logged).toHaveLength(1);
    expect(logged[0]!.level).toBe('error');
    expect(logged[0]!.details.err).toBe(boom);
  });
});
