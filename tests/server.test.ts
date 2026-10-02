import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

import { createStore } from '../src/store.js';
import { createNotesService } from '../src/notes.js';
import { createApp } from '../src/server.js';

let dir: string;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'notes-server-'));
  app = createApp(createNotesService(createStore(join(dir, 'notes.json'))));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function createNote(title: string, body?: string) {
  const response = await request(app)
    .post('/notes')
    .send(body === undefined ? { title } : { title, body });
  return response.body as { id: string; title: string; body: string };
}

describe('POST /notes', () => {
  test('returns 201 and the created note', async () => {
    const response = await request(app)
      .post('/notes')
      .send({ title: 'Groceries', body: 'milk' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ title: 'Groceries', body: 'milk' });
    expect(response.body.id).toBeTruthy();
  });

  test('returns 400 with an error message when the title is missing', async () => {
    const response = await request(app).post('/notes').send({ body: 'orphan' });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/title/i);
  });

  test('returns 400 when the JSON body is malformed', async () => {
    const response = await request(app)
      .post('/notes')
      .set('Content-Type', 'application/json')
      .send('{"title": ');

    expect(response.status).toBe(400);
    expect(response.body.error).toBeTruthy();
  });
});

describe('GET /notes', () => {
  test('returns an empty array when no notes exist', async () => {
    const response = await request(app).get('/notes');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  test('returns every note, newest first', async () => {
    await createNote('Older');
    await createNote('Newer');

    const response = await request(app).get('/notes');

    expect(response.status).toBe(200);
    expect(response.body.map((n: { title: string }) => n.title)).toEqual([
      'Newer',
      'Older',
    ]);
  });
});

describe('GET /notes/:id', () => {
  test('returns the matching note', async () => {
    const created = await createNote('Groceries');

    const response = await request(app).get(`/notes/${created.id}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(created.id);
  });

  test('returns 404 for an unknown id', async () => {
    const response = await request(app).get('/notes/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body.error).toBeTruthy();
  });
});

describe('PUT /notes/:id', () => {
  test('applies a partial update and returns the note', async () => {
    const created = await createNote('Old', 'keep me');

    const response = await request(app)
      .put(`/notes/${created.id}`)
      .send({ title: 'New' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ title: 'New', body: 'keep me' });
  });

  test('returns 404 for an unknown id', async () => {
    const response = await request(app)
      .put('/notes/does-not-exist')
      .send({ title: 'New' });

    expect(response.status).toBe(404);
  });

  test('returns 400 when the title is empty', async () => {
    const created = await createNote('Original');

    const response = await request(app)
      .put(`/notes/${created.id}`)
      .send({ title: '' });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/title/i);
  });

  test('returns 400 when no updatable field is supplied', async () => {
    const created = await createNote('Original');

    const response = await request(app).put(`/notes/${created.id}`).send({});

    expect(response.status).toBe(400);
  });
});

describe('DELETE /notes/:id', () => {
  test('returns 204 with an empty body', async () => {
    const created = await createNote('Groceries');

    const response = await request(app).delete(`/notes/${created.id}`);

    expect(response.status).toBe(204);
    expect(response.body).toEqual({});
  });

  test('actually removes the note', async () => {
    const created = await createNote('Groceries');

    await request(app).delete(`/notes/${created.id}`);

    expect((await request(app).get(`/notes/${created.id}`)).status).toBe(404);
  });

  test('returns 404 for an unknown id', async () => {
    const response = await request(app).delete('/notes/does-not-exist');

    expect(response.status).toBe(404);
  });
});

describe('static frontend', () => {
  test('serves the HTML page at the root', async () => {
    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/html/);
    expect(response.text).toMatch(/<title>/i);
  });

  test('serves the stylesheet and script', async () => {
    expect((await request(app).get('/styles.css')).status).toBe(200);
    expect((await request(app).get('/app.js')).status).toBe(200);
  });

  test('still serves the notes API as JSON', async () => {
    await createNote('Groceries');

    const response = await request(app).get('/notes');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/json/);
    expect(response.body).toHaveLength(1);
  });
});

describe('unknown routes', () => {
  test('returns 404 with a JSON error', async () => {
    const response = await request(app).get('/nope');

    expect(response.status).toBe(404);
    expect(response.body.error).toBeTruthy();
  });
});

describe('unexpected failures', () => {
  test('return 500 with a JSON error', async () => {
    const broken = createApp({
      list: () => Promise.reject(new Error('disk on fire')),
      get: () => Promise.reject(new Error('disk on fire')),
      create: () => Promise.reject(new Error('disk on fire')),
      update: () => Promise.reject(new Error('disk on fire')),
      remove: () => Promise.reject(new Error('disk on fire')),
    });

    const response = await request(broken).get('/notes');

    expect(response.status).toBe(500);
    expect(response.body.error).toBeTruthy();
    // The underlying failure should not leak to the client.
    expect(JSON.stringify(response.body)).not.toMatch(/disk on fire/);
  });
});
