# Notes

A minimal note-taking app — browser UI plus a REST API. Node + TypeScript +
Express, with notes stored in a JSON file instead of a database.

## Setup

```bash
npm install
npm run dev          # http://localhost:3000
```

Open <http://localhost:3000> for the UI. The same server answers the API at
`/notes`, so the frontend is just a client of the endpoints below.

## Frontend

A single static page — no framework, no build step. Add a note with the form,
then edit or delete any note inline. The list shows newest first, errors from
the API appear in a banner, and the page follows your system light/dark setting.

Note text is rendered with `textContent`, so a note containing markup shows as
literal characters rather than being parsed as HTML.

| Script | Does |
|---|---|
| `npm run dev` | Start with reload on change |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled build |
| `npm test` | Run the test suite |
| `npm run typecheck` | Typecheck without emitting |

| Variable | Default | Does |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `NOTES_FILE` | `notes.json` | Where notes are stored, relative to the working directory |
| `LOG_LEVEL` | `info` | `trace`…`fatal`, or `silent` |
| `NODE_ENV` | — | `production` switches logs from pretty-printed to JSON |

## API

All request and response bodies are JSON.

### `POST /notes` → `201`

`title` is required and must be non-empty; `body` is optional, defaulting to `""`.

```bash
curl -X POST localhost:3000/notes \
  -H 'Content-Type: application/json' \
  -d '{"title":"Groceries","body":"milk, eggs"}'
```

```json
{
  "id": "6f1c…",
  "title": "Groceries",
  "body": "milk, eggs",
  "createdAt": "2026-10-02T05:12:00.000Z",
  "updatedAt": "2026-10-02T05:12:00.000Z"
}
```

### `GET /notes` → `200`

Returns an array of every note, newest first.

```bash
curl localhost:3000/notes
```

### `GET /notes/:id` → `200` / `404`

```bash
curl localhost:3000/notes/6f1c…
```

### `PUT /notes/:id` → `200` / `404`

A partial update — send `title`, `body`, or both. At least one is required.
`id` and `createdAt` never change; `updatedAt` is bumped.

```bash
curl -X PUT localhost:3000/notes/6f1c… \
  -H 'Content-Type: application/json' \
  -d '{"body":"milk, eggs, bread"}'
```

### `DELETE /notes/:id` → `204` / `404`

```bash
curl -X DELETE localhost:3000/notes/6f1c…
```

### Errors

Failures return `{ "error": "message" }` with status `400` (invalid input or
malformed JSON), `404` (unknown id or route), or `500` (unexpected). Internal
error details are logged server-side rather than returned to the client.

## How it works

```
src/index.ts       entry point — reads env vars, starts listening
src/server.ts      Express routes, static file serving, status mapping
src/notes.ts       CRUD logic, validation, the Note type
src/store.ts       reads and writes notes.json
src/logger.ts      pino setup and the ActionLogger interface
public/index.html  the page
public/app.js      fetch calls and DOM rendering
public/styles.css  styling, including dark mode
```

## Logging

Every action that changes data is logged with [pino](https://getpino.io) —
pretty-printed in development, newline-delimited JSON when
`NODE_ENV=production`.

```
[13:28:42] INFO: note created
    id: "93b00067-ca42-4cb2-9a59-6fcfc23070d1"
    title: "Groceries"
[13:28:42] INFO: request
    method: "POST"
    path: "/notes"
    status: 201
    durationMs: 2.7
[13:28:43] WARN: validation rejected
    action: "create"
    reason: "\"title\" is required and must be a string."
```

Three things this does deliberately:

- **Note bodies are never logged** — only ids, titles, and which fields changed.
  Bodies are the content itself, and can be long or private.
- **Only `/notes` requests are logged**, not the page and its assets, so note
  actions aren't buried under static file hits.
- **Rejected input logs at `warn`, not `error`.** Bad input is the caller's
  mistake; `error` is reserved for unexpected server failures, which log the
  cause while returning only a generic message to the client.

Actions are logged from the service layer rather than the routes, so the log
reflects what actually happened to data — a `PUT` against an unknown id logs the
request and its 404, but no mutation, because none occurred.

The logger is injected (`createNotesService(store, logger)`), so tests can
capture log output and the services don't depend on a global.

Each request reads the whole file, works in memory, and writes it back. At this
scale that is simple and correct, and avoids in-memory state drifting from disk.

Two details worth knowing:

- **Writes are atomic.** Data is written to a temporary file and then renamed
  into place, so an interrupted write cannot leave a truncated `notes.json`.
- **Writes are serialized.** All file operations are queued on a single promise
  chain, so two overlapping requests cannot interleave and lose a note.

A missing notes file reads as an empty list. A *corrupt* one raises an error
rather than silently resetting, so a stray keystroke in the file does not
discard your notes.

## Tests

```bash
npm test
```

69 tests: `store` against temporary files, `notes` for CRUD and validation,
`server` end-to-end through Supertest including the 400, 404, and 500 paths and
the static file routes, and `logging` against a capturing logger.

The frontend's DOM logic has no automated tests — it was verified by driving the
real page in headless Chromium.

Note that the test suite binds an ephemeral local port, so it needs an
environment that permits local port binding.

## Scope

Deliberately left out: authentication, pagination, search, tags, and soft
deletes. The file-per-process storage model assumes a single server instance.
