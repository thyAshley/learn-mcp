import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createStore } from '../src/store.js';
import { createNotesService } from '../src/notes.js';
import { createMcpServer } from '../src/mcp.js';

let dir: string;
let client: Client;
let notes: ReturnType<typeof createNotesService>;

/**
 * Connects a real MCP client to a real MCP server over a linked in-memory
 * transport pair. This exercises the actual protocol — initialize handshake,
 * tool discovery, JSON-RPC calls — without spawning a subprocess.
 */
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'notes-mcp-'));
  notes = createNotesService(createStore(join(dir, 'notes.json')));

  const server = createMcpServer(notes);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  client = new Client({ name: 'test-client', version: '1.0.0' });

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
});

afterEach(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

/** Reads the text out of a tool result. */
function textOf(result: unknown): string {
  const { content } = result as { content: Array<{ type: string; text?: string }> };
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}

/** True when the tool reported failure via isError. */
function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

describe('tool discovery', () => {
  test('advertises exactly the two read tools', async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'get_note',
      'list_notes',
    ]);
  });

  test('every tool has a description for the model to read', async () => {
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.description, `${tool.name} needs a description`).toBeTruthy();
    }
  });

  test('describes the argument get_note expects', async () => {
    const { tools } = await client.listTools();

    const get = tools.find((tool) => tool.name === 'get_note')!;
    expect(get.inputSchema.required).toEqual(['id']);
    expect(Object.keys(get.inputSchema.properties ?? {})).toEqual(['id']);
  });

  test('marks both tools read-only', async () => {
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, `${tool.name}`).toBe(true);
    }
  });
});

// The security property this server is built around: a model connected to it
// can read notes but has no way to change them. These tests fail loudly if a
// write tool is ever added without a deliberate decision.
describe('read-only guarantee', () => {
  test.each(['create_note', 'update_note', 'delete_note'])(
    'does not expose %s',
    async (name) => {
      const { tools } = await client.listTools();

      expect(tools.map((tool) => tool.name)).not.toContain(name);
    },
  );

  test('refuses a call to a write tool that is not registered', async () => {
    const result = await client.callTool({
      name: 'delete_note',
      arguments: { id: 'anything' },
    });

    expect(isError(result)).toBe(true);
    expect(textOf(result)).toMatch(/not found/i);
  });

  test('reading leaves the stored notes untouched', async () => {
    const created = await notes.create({ title: 'Groceries', body: 'milk' });

    await client.callTool({ name: 'list_notes', arguments: {} });
    await client.callTool({ name: 'get_note', arguments: { id: created.id } });

    expect(await notes.list()).toEqual([created]);
  });
});

describe('list_notes', () => {
  test('reports when there are no notes', async () => {
    const result = await client.callTool({ name: 'list_notes', arguments: {} });

    expect(textOf(result)).toMatch(/no notes/i);
  });

  test('returns the notes that exist, newest first', async () => {
    await notes.create({ title: 'Older', body: 'first' });
    await notes.create({ title: 'Newer', body: 'second' });

    const text = textOf(await client.callTool({ name: 'list_notes', arguments: {} }));

    expect(text).toContain('Older');
    expect(text).toContain('Newer');
    expect(text.indexOf('Newer')).toBeLessThan(text.indexOf('Older'));
  });
});

describe('get_note', () => {
  test('returns the matching note', async () => {
    const created = await notes.create({ title: 'Groceries' });

    const result = await client.callTool({
      name: 'get_note',
      arguments: { id: created.id },
    });

    expect(isError(result)).toBe(false);
    expect(textOf(result)).toContain('Groceries');
  });

  test('reports an unknown id as a tool error, not a crash', async () => {
    const result = await client.callTool({
      name: 'get_note',
      arguments: { id: 'does-not-exist' },
    });

    expect(isError(result)).toBe(true);
    expect(textOf(result)).toMatch(/no note found/i);
  });
});
