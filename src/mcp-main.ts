import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createStderrLogger } from "./logger.js";
import { createMcpServer } from "./mcp.js";
import { createNotesService } from "./notes.js";
import { createStore } from "./store.js";

const file = process.env["NOTES_FILE"] ?? "notes.json";

const logger = createStderrLogger();
const notes = createNotesService(createStore(file), logger);
const server = createMcpServer(notes);

const transport = new StdioServerTransport();

await server.connect(transport);

logger.info({ file }, "notes mcp server ready");
