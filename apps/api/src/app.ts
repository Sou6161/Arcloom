import express, { type Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { allowedOrigins } from './config/env.js';
import { apiRouter } from './routes/index.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';
import { attachOwner } from './middleware/owner.js';

/** Builds the configured Express application (no network binding). */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(attachOwner);

  app.use('/api', apiRouter);

  // 404 then the terminal error handler — order matters.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
