import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { NotesService } from "./notes.js";

/**
 * Builds the MCP server, exposing the notes as **read-only** tools an AI model
 * can call.
 *
 * Deliberately read-only: only `list_notes` and `get_note` are registered. A
 * model connected to this server can read notes but cannot create, change, or
 * delete them. The write operations exist on the service — the Express API uses
 * them — they are simply not exposed here.
 *
 * The notes service is injected, exactly as it is for the Express app — which
 * is why both servers can share the same business logic without either knowing
 * about the other.
 *
 * Note this function does NOT connect a transport. Building and connecting are
 * separate so tests can attach an in-memory transport instead of stdio.
 */
export function createMcpServer(notes: NotesService): McpServer {
  const server = new McpServer({
    name: "notes",
    version: "1.0.0",
  });

  server.registerTool(
    "list_notes",
    {
      title: "List notes",
      // The model reads this description to decide when to call the tool, so it
      // is a prompt, not a code comment. Be concrete about what it returns.
      description:
        "List all saved notes, newest first. Returns each note’s id, title, " +
        "body, and timestamps. This is read-only and cannot change any note.",
      inputSchema: {},
      // Declares the tool never mutates state, so a host can run it without
      // prompting. Advisory — the guarantee here is that no write tool exists.
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      const all = await notes.list();

      return {
        content: [
          {
            type: "text",
            text:
              all.length === 0 ? "No notes yet." : JSON.stringify(all, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_note",
    {
      title: "Get a note",
      description:
        "Read one note by its id. Use list_notes first if you do not know " +
        "the id. This is read-only and cannot change the note.",
      // Each key becomes a property of the tool's JSON Schema. The .describe()
      // text is shown to the model, so it is how the model learns what to pass.
      inputSchema: {
        id: z.string().describe("The id of the note to read"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ id }) => {
      const note = await notes.get(id);

      if (!note) return failure(`No note found with id "${id}".`);

      return text(JSON.stringify(note, null, 2));
    },
  );

  return server;
}

/** A successful text result. */
function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

/**
 * A failed result.
 *
 * Note this *returns* rather than throws: `isError: true` tells the model the
 * call failed and lets it read why and try again. A thrown exception becomes a
 * protocol-level error the model cannot recover from as gracefully.
 */
function failure(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
