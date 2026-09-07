import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { allowedOrigins } from './config/env.js';
import { apiRouter } from './routes/index.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';
import { attachOwner } from './middleware/owner.js';
import { generalLimiter } from './middleware/rateLimit.js';

/** Builds the configured Express application (no network binding). */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  // Behind Render/Vercel proxies; needed for correct client IPs.
  app.set('trust proxy', 1);
  // Security headers. crossOriginResourcePolicy is relaxed because the API is
  // consumed from a different origin than the one serving it.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(attachOwner);
  // After attachOwner so limits are keyed by session, not shared IP.
  app.use('/api', generalLimiter);

  app.use('/api', apiRouter);

  // 404 then the terminal error handler — order matters.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
