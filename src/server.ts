import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import { ValidationError, type NotesService } from './notes.js';
import { silentLogger, type ActionLogger } from './logger.js';

// Resolved relative to this module rather than the working directory, so the
// frontend is found whether running from src/ via tsx or from dist/ via node.
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** Routes below are mounted on a path with a single `:id` segment. */
type IdRequest = Request<{ id: string }>;

/**
 * Builds the Express app. The service is injected so tests can supply their
 * own storage, and so the app can be exercised without binding a port.
 */
export function createApp(
  notes: NotesService,
  log: ActionLogger = silentLogger,
) {
  const app = express();

  app.use(express.json());

  // Logs one line per API request once the response is sent. Mounted before
  // the static handler but scoped to /notes, so serving the page and its
  // assets does not drown out the note actions.
  app.use('/notes', (req: Request, res: Response, next: NextFunction) => {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const elapsedNs = Number(process.hrtime.bigint() - startedAt);
      log.info(
        {
          method: req.method,
          // req.originalUrl, since req.path is relative to this mount point.
          path: req.originalUrl,
          status: res.statusCode,
          durationMs: Math.round(elapsedNs / 1e5) / 10,
        },
        'request',
      );
    });

    next();
  });

  // Serves the browser UI at "/". Mounted before the routes below so it cannot
  // shadow them, and before the 404 handler so unknown paths still return JSON.
  app.use(express.static(publicDir));

  app.get('/notes', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await notes.list());
    } catch (error) {
      next(error);
    }
  });

  app.get(
    '/notes/:id',
    async (req: IdRequest, res: Response, next: NextFunction) => {
      try {
        const note = await notes.get(req.params.id);
        if (!note) {
          res.status(404).json({ error: 'Note not found.' });
          return;
        }
        res.json(note);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post('/notes', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(201).json(await notes.create(req.body));
    } catch (error) {
      next(error);
    }
  });

  app.put(
    '/notes/:id',
    async (req: IdRequest, res: Response, next: NextFunction) => {
      try {
        const updated = await notes.update(req.params.id, req.body);
        if (!updated) {
          res.status(404).json({ error: 'Note not found.' });
          return;
        }
        res.json(updated);
      } catch (error) {
        next(error);
      }
    },
  );

  app.delete(
    '/notes/:id',
    async (req: IdRequest, res: Response, next: NextFunction) => {
      try {
        const removed = await notes.remove(req.params.id);
        if (!removed) {
          res.status(404).json({ error: 'Note not found.' });
          return;
        }
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found.' });
  });

  const handleErrors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }

    // A body parser failure is the client's fault, not ours.
    if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ error: 'Request body is not valid JSON.' });
      return;
    }

    // Log for the operator; return something generic to the client.
    log.error({ err: error }, 'request failed');
    res.status(500).json({ error: 'Internal server error.' });
  };

  app.use(handleErrors);

  return app;
}
