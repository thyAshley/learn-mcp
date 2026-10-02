import { createStore } from './store.js';
import { createNotesService } from './notes.js';
import { createApp } from './server.js';
import { createLogger } from './logger.js';

const port = Number(process.env['PORT'] ?? 3000);
const file = process.env['NOTES_FILE'] ?? 'notes.json';

const logger = createLogger();
const app = createApp(createNotesService(createStore(file), logger), logger);

app.listen(port, () => {
  logger.info({ port, file }, 'notes api listening');
});
