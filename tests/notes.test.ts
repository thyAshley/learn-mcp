import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStore } from '../src/store.js';
import { createNotesService, ValidationError } from '../src/notes.js';

let dir: string;
let notes: ReturnType<typeof createNotesService>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'notes-service-'));
  notes = createNotesService(createStore(join(dir, 'notes.json')));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('create', () => {
  test('returns a note with an id and timestamps', async () => {
    const note = await notes.create({ title: 'Groceries', body: 'milk' });

    expect(note.id).toMatch(/[0-9a-f-]{36}/);
    expect(note.title).toBe('Groceries');
    expect(note.body).toBe('milk');
    expect(note.createdAt).toBe(note.updatedAt);
    expect(Number.isNaN(Date.parse(note.createdAt))).toBe(false);
  });

  test('defaults a missing body to an empty string', async () => {
    const note = await notes.create({ title: 'Groceries' });

    expect(note.body).toBe('');
  });

  test('trims surrounding whitespace from the title', async () => {
    const note = await notes.create({ title: '  Groceries  ' });

    expect(note.title).toBe('Groceries');
  });

  test('persists the note so it can be listed', async () => {
    const created = await notes.create({ title: 'Groceries' });

    expect(await notes.list()).toEqual([created]);
  });

  test('gives each note a distinct id', async () => {
    const first = await notes.create({ title: 'One' });
    const second = await notes.create({ title: 'Two' });

    expect(first.id).not.toBe(second.id);
  });

  test.each([
    ['a missing title', {}],
    ['an empty title', { title: '' }],
    ['a whitespace-only title', { title: '   ' }],
    ['a non-string title', { title: 42 }],
    ['a non-string body', { title: 'ok', body: 42 }],
  ])('rejects %s', async (_label, input) => {
    await expect(notes.create(input as never)).rejects.toThrow(ValidationError);
  });

  test('does not persist anything when validation fails', async () => {
    await expect(notes.create({ title: '' })).rejects.toThrow(ValidationError);

    expect(await notes.list()).toEqual([]);
  });
});

describe('list', () => {
  test('returns an empty array when there are no notes', async () => {
    expect(await notes.list()).toEqual([]);
  });

  test('returns the newest note first', async () => {
    const older = await notes.create({ title: 'Older' });
    const newer = await notes.create({ title: 'Newer' });

    const result = await notes.list();

    expect(result.map((n) => n.id)).toEqual([newer.id, older.id]);
  });
});

describe('get', () => {
  test('returns the matching note', async () => {
    const created = await notes.create({ title: 'Groceries' });

    expect(await notes.get(created.id)).toEqual(created);
  });

  test('returns undefined for an unknown id', async () => {
    expect(await notes.get('does-not-exist')).toBeUndefined();
  });
});

describe('update', () => {
  test('changes the title and leaves the body alone', async () => {
    const created = await notes.create({ title: 'Old', body: 'keep me' });

    const updated = await notes.update(created.id, { title: 'New' });

    expect(updated?.title).toBe('New');
    expect(updated?.body).toBe('keep me');
  });

  test('changes the body and leaves the title alone', async () => {
    const created = await notes.create({ title: 'keep me', body: 'old' });

    const updated = await notes.update(created.id, { body: 'new' });

    expect(updated?.title).toBe('keep me');
    expect(updated?.body).toBe('new');
  });

  test('preserves the id and creation time but advances updatedAt', async () => {
    const created = await notes.create({ title: 'Old' });

    const updated = await notes.update(created.id, { title: 'New' });

    expect(updated?.id).toBe(created.id);
    expect(updated?.createdAt).toBe(created.createdAt);
    expect(
      Date.parse(updated!.updatedAt) >= Date.parse(created.updatedAt),
    ).toBe(true);
  });

  test('persists the change', async () => {
    const created = await notes.create({ title: 'Old' });

    await notes.update(created.id, { title: 'New' });

    expect((await notes.get(created.id))?.title).toBe('New');
  });

  test('accepts an empty body', async () => {
    const created = await notes.create({ title: 'Title', body: 'text' });

    const updated = await notes.update(created.id, { body: '' });

    expect(updated?.body).toBe('');
  });

  test('returns undefined for an unknown id', async () => {
    expect(await notes.update('nope', { title: 'New' })).toBeUndefined();
  });

  test.each([
    ['an empty title', { title: '' }],
    ['a whitespace-only title', { title: '  ' }],
    ['a non-string title', { title: 42 }],
    ['a non-string body', { body: 42 }],
    ['no recognised fields', {}],
  ])('rejects %s', async (_label, patch) => {
    const created = await notes.create({ title: 'Original' });

    await expect(notes.update(created.id, patch as never)).rejects.toThrow(
      ValidationError,
    );
  });

  test('leaves the note untouched when validation fails', async () => {
    const created = await notes.create({ title: 'Original' });

    await expect(notes.update(created.id, { title: '' })).rejects.toThrow(
      ValidationError,
    );

    expect((await notes.get(created.id))?.title).toBe('Original');
  });
});

describe('remove', () => {
  test('reports success and drops the note', async () => {
    const created = await notes.create({ title: 'Groceries' });

    expect(await notes.remove(created.id)).toBe(true);
    expect(await notes.get(created.id)).toBeUndefined();
  });

  test('leaves other notes in place', async () => {
    const kept = await notes.create({ title: 'Keep' });
    const doomed = await notes.create({ title: 'Delete' });

    await notes.remove(doomed.id);

    expect((await notes.list()).map((n) => n.id)).toEqual([kept.id]);
  });

  test('reports failure for an unknown id', async () => {
    expect(await notes.remove('does-not-exist')).toBe(false);
  });
});
