import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStore } from '../src/store.js';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'notes-store-'));
  file = join(dir, 'notes.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('read', () => {
  test('returns an empty array when the file does not exist', async () => {
    const store = createStore(file);

    expect(await store.read()).toEqual([]);
  });

  test('returns the notes previously written', async () => {
    const store = createStore(file);
    const notes = [
      {
        id: 'a1',
        title: 'Groceries',
        body: 'milk, eggs',
        createdAt: '2026-10-02T00:00:00.000Z',
        updatedAt: '2026-10-02T00:00:00.000Z',
      },
    ];

    await store.write(notes);

    expect(await store.read()).toEqual(notes);
  });

  test('throws when the file contains malformed JSON', async () => {
    await writeFile(file, '{not json', 'utf8');
    const store = createStore(file);

    await expect(store.read()).rejects.toThrow(/malformed/i);
  });

  test('throws when the file contains JSON that is not an array', async () => {
    await writeFile(file, '{"notes":[]}', 'utf8');
    const store = createStore(file);

    await expect(store.read()).rejects.toThrow(/array/i);
  });
});

describe('write', () => {
  test('creates the file with indented JSON', async () => {
    const store = createStore(file);

    await store.write([
      {
        id: 'a1',
        title: 'Groceries',
        body: '',
        createdAt: '2026-10-02T00:00:00.000Z',
        updatedAt: '2026-10-02T00:00:00.000Z',
      },
    ]);

    const raw = await readFile(file, 'utf8');
    expect(raw).toContain('\n  ');
    expect(raw.endsWith('\n')).toBe(true);
  });

  test('leaves no temporary files behind', async () => {
    const store = createStore(file);

    await store.write([]);

    const { readdir } = await import('node:fs/promises');
    expect(await readdir(dir)).toEqual(['notes.json']);
  });

  test('serializes concurrent writes so the last one wins', async () => {
    const store = createStore(file);
    const note = (id: string) => ({
      id,
      title: id,
      body: '',
      createdAt: '2026-10-02T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    });

    await Promise.all([
      store.write([note('first')]),
      store.write([note('second')]),
      store.write([note('third')]),
    ]);

    const result = await store.read();
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('third');
  });

  test('creates the parent directory when it is missing', async () => {
    const nested = join(dir, 'deep', 'notes.json');
    const store = createStore(nested);

    await store.write([]);

    expect(await store.read()).toEqual([]);
  });
});
