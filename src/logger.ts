import pino from 'pino';

/**
 * The logging surface the app depends on — the subset of pino's API actually
 * used here. Depending on this rather than pino itself lets tests capture log
 * output, and keeps a logger from being a hard requirement of the services.
 */
export interface ActionLogger {
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

/** Discards everything. The default when no logger is supplied. */
export const silentLogger: ActionLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Builds the application logger.
 *
 * Pretty-printed outside production for a readable terminal; newline-delimited
 * JSON in production so a log collector can parse it.
 */
export function createLogger(): ActionLogger {
  const level = process.env['LOG_LEVEL'] ?? 'info';
  const pretty = process.env['NODE_ENV'] !== 'production';

  return pino({
    level,
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });
}
