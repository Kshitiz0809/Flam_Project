// Tiny in-memory fixed-window rate limiter, per client IP.
//
// Once deployed, anyone who can reach the server can spend the Gemini key's
// quota, so this caps requests per IP. In-memory is fine for a single
// instance; multiple instances would need a shared store (e.g. Redis).
import { ApiError } from './errors.js';

/**
 * @param {object} opts
 * @param {number} opts.max       requests allowed per window per IP
 * @param {number} opts.windowMs
 */
export function rateLimit({ max, windowMs }) {
  const hits = new Map(); // ip → { count, resetAt }

  // Drop expired entries so the map can't grow forever.
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) if (entry.resetAt <= now) hits.delete(ip);
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || 'unknown';
    let entry = hits.get(ip);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(ip, entry);
    }
    entry.count++;
    if (entry.count > max) {
      const retryAfterS = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfterS));
      return next(new ApiError(429, 'RATE_LIMITED', `Too many requests from this device. Try again in ${retryAfterS}s.`, { retryable: true }));
    }
    next();
  };
}
