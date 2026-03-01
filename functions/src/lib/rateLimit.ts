// src/lib/rateLimit.ts
// Firestore-based rate limiting for Cloud Functions v2.
// Uses the default (nextn) Firestore project.

import { getFirestore } from "firebase-admin/firestore";

interface RateLimitConfig {
  collection: string;
  maxRequests: number;
  windowMs: number;
  keyPrefix: string;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number | null;
}

/**
 * Check and record a rate-limited request.
 * Uses IP address as the rate-limit key.
 * Stores timestamps in a Firestore document, pruning stale entries each call.
 */
export async function checkRateLimit(
  ip: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const db = getFirestore();
  const now = Date.now();
  const windowStart = now - config.windowMs;
  const docId = `${config.keyPrefix}_${sanitizeIp(ip)}`;
  const docRef = db.collection(config.collection).doc(docId);

  return db.runTransaction(async (txn) => {
    const snap = await txn.get(docRef);
    const data = snap.data() as { timestamps?: number[] } | undefined;

    // Keep only timestamps within the rolling window
    const timestamps = (data?.timestamps ?? []).filter((ts) => ts > windowStart);

    if (timestamps.length >= config.maxRequests) {
      const oldestInWindow = Math.min(...timestamps);
      const retryAfterMs = oldestInWindow + config.windowMs - now;
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(retryAfterMs, 0),
      };
    }

    // Allowed — record this request
    timestamps.push(now);
    txn.set(docRef, { timestamps, updatedAt: now }, { merge: true });

    return {
      allowed: true,
      remaining: config.maxRequests - timestamps.length,
      retryAfterMs: null,
    };
  });
}

function sanitizeIp(ip: string): string {
  return ip.replace(/[.:]/g, "_");
}

/**
 * Extract the client IP from a callable function request.
 * Cloud Functions v2 on Cloud Run populates x-forwarded-for.
 */
export function extractIp(request: { rawRequest?: { ip?: string; headers?: Record<string, string | string[] | undefined> } }): string {
  const raw = request.rawRequest;
  if (raw?.ip) return raw.ip;

  const forwarded = raw?.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  if (Array.isArray(forwarded) && forwarded.length > 0) return forwarded[0].split(",")[0].trim();

  return "unknown";
}

// ── Pre-defined rate limit configs ───────────────────────────────────────────

/** runAtmosify: 10 requests per hour per IP */
export const ATMOSIFY_RATE_LIMIT: RateLimitConfig = {
  collection: "rateLimits",
  maxRequests: 10,
  windowMs: 60 * 60 * 1000,
  keyPrefix: "atmosify",
};

/** getAppleMusicDevToken: 50 requests per hour per IP */
export const DEV_TOKEN_RATE_LIMIT: RateLimitConfig = {
  collection: "rateLimits",
  maxRequests: 50,
  windowMs: 60 * 60 * 1000,
  keyPrefix: "devtoken",
};

/** sharePlaylist: 20 requests per hour per IP */
export const SHARE_RATE_LIMIT: RateLimitConfig = {
  collection: "rateLimits",
  maxRequests: 20,
  windowMs: 60 * 60 * 1000,
  keyPrefix: "share",
};
