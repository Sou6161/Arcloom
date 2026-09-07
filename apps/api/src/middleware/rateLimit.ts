import rateLimit, { ipKeyGenerator, type RateLimitRequestHandler } from 'express-rate-limit';
import { AppError } from '../utils/AppError.js';

/**
 * Rate limits, keyed by session token so one visitor cannot exhaust the shared
 * budget. There is no login, so these are the only thing standing between a
 * public demo and an unbounded bill.
 *
 * Keying on the owner token rather than IP is deliberate: several visitors can
 * share an IP (offices, mobile carriers, corporate VPNs), and IP-based limits
 * would punish them for each other's usage.
 */
function keyBySession(req: { ownerToken?: string; ip?: string }): string {
  if (req.ownerToken) return req.ownerToken;
  // Fallback only (the cookie is set on the first request). ipKeyGenerator
  // normalises IPv6 to its /64 prefix — without it a single client could rotate
  // through addresses in its own subnet and bypass the limit entirely.
  return req.ip ? ipKeyGenerator(req.ip) : 'unknown';
}

const handler = (message: string) => () => {
  throw new AppError(429, 'RATE_LIMITED', message);
};

/** Broad ceiling on all API traffic. */
export const generalLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: keyBySession,
  handler: handler('Too many requests. Please wait a moment and try again.'),
});

/** Uploads are expensive (disk, CPU, database) — much tighter. */
export const uploadLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: keyBySession,
  handler: handler('Upload limit reached. Please try again later.'),
});

/**
 * AI questions cost real money per call, so this is the limit that actually
 * protects the budget.
 */
export const askLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 60_000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: keyBySession,
  handler: handler('You have reached the hourly question limit. Please try again later.'),
});
