// src/index.ts -- Atmosify Cloud Functions
// DB-first Dolby Atmos playlist engine with rate limiting + sharing.

import { randomBytes } from "crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { runPipeline } from "./pipeline/orchestrator.js";
import { generateAppleMusicToken } from "./lib/appleMusic.js";
import { ATMOS_DB_SERVICE_ACCOUNT } from "./lib/atmosDb.js";
import {
  checkRateLimit,
  extractIp,
  ATMOSIFY_RATE_LIMIT,
  DEV_TOKEN_RATE_LIMIT,
  SHARE_RATE_LIMIT,
} from "./lib/rateLimit.js";
import type { AtmosPlaylist } from "./lib/types.js";

// -- Initialize the default Firebase app (for nextn project) ----------------
initializeApp();

// -- Secrets ----------------------------------------------------------------
const GEMINI_API_KEY      = defineSecret("GEMINI_API_KEY");
const PERPLEXITY_API_KEY  = defineSecret("PERPLEXITY_API_KEY");
const SERPER_API_KEY      = defineSecret("SERPER_API_KEY");
const APPLE_TEAM_ID       = defineSecret("APPLE_TEAM_ID");
const APPLE_KEY_ID        = defineSecret("APPLE_KEY_ID");
const APPLE_PRIVATE_KEY   = defineSecret("APPLE_PRIVATE_KEY");
// ATMOS_DB_SERVICE_ACCOUNT is imported from atmosDb.ts

// -- runAtmosify -- Main playlist builder ------------------------------------
export const runAtmosify = onCall(
  {
    memory: "1GiB",
    timeoutSeconds: 540,
    secrets: [
      GEMINI_API_KEY,
      PERPLEXITY_API_KEY,
      SERPER_API_KEY,
      APPLE_TEAM_ID,
      APPLE_KEY_ID,
      APPLE_PRIVATE_KEY,
      ATMOS_DB_SERVICE_ACCOUNT,
    ],
  },
  async (request) => {
    // Rate limit: 10 requests per hour per IP
    const ip = extractIp(request);
    const rateCheck = await checkRateLimit(ip, ATMOSIFY_RATE_LIMIT);
    if (!rateCheck.allowed) {
      throw new HttpsError(
        "resource-exhausted",
        `Rate limit exceeded. Try again in ${Math.ceil((rateCheck.retryAfterMs ?? 0) / 60000)} minutes.`
      );
    }

    const data = request.data as { prompt?: string; jobId?: string };
    const prompt = data?.prompt?.trim();

    if (!prompt) {
      throw new HttpsError("invalid-argument", "prompt is required");
    }

    const result = await runPipeline(prompt, {
      geminiApiKey:      GEMINI_API_KEY.value(),
      perplexityApiKey:  PERPLEXITY_API_KEY.value(),
      serperApiKey:      SERPER_API_KEY.value() || undefined,
      appleTeamId:       APPLE_TEAM_ID.value(),
      appleKeyId:        APPLE_KEY_ID.value(),
      applePrivateKey:   APPLE_PRIVATE_KEY.value(),
      jobId:             data.jobId,
    });

    if (result.needsClarification) {
      return {
        status: "needs_clarification",
        clarificationQuestion: result.clarificationQuestion,
      };
    }

    if (result.error) {
      return {
        status: "error",
        error: result.error,
      };
    }

    return {
      status: "success",
      playlist: result.playlist,
    };
  }
);

// -- getAppleMusicDevToken -- Returns Apple Music developer JWT --------------
export const getAppleMusicDevToken = onCall(
  {
    secrets: [APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY],
  },
  async (request) => {
    // Rate limit: 50 requests per hour per IP
    const ip = extractIp(request);
    const rateCheck = await checkRateLimit(ip, DEV_TOKEN_RATE_LIMIT);
    if (!rateCheck.allowed) {
      throw new HttpsError(
        "resource-exhausted",
        `Rate limit exceeded. Try again in ${Math.ceil((rateCheck.retryAfterMs ?? 0) / 60000)} minutes.`
      );
    }

    const token = generateAppleMusicToken(
      APPLE_TEAM_ID.value(),
      APPLE_KEY_ID.value(),
      APPLE_PRIVATE_KEY.value()
    );
    return { token };
  }
);

// -- sharePlaylist -- Store a playlist for sharing ---------------------------
function generateShareId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(12);
  let result = "";
  for (const b of bytes) result += chars[b % chars.length];
  return result;
}

export const sharePlaylist = onCall(
  {
    // No secrets needed -- uses default nextn Firestore
  },
  async (request) => {
    // Rate limit: 20 requests per hour per IP
    const ip = extractIp(request);
    const rateCheck = await checkRateLimit(ip, SHARE_RATE_LIMIT);
    if (!rateCheck.allowed) {
      throw new HttpsError(
        "resource-exhausted",
        `Rate limit exceeded. Try again in ${Math.ceil((rateCheck.retryAfterMs ?? 0) / 60000)} minutes.`
      );
    }

    const data = request.data as { playlist?: AtmosPlaylist };
    const playlist = data?.playlist;

    if (!playlist || !playlist.tracks || playlist.tracks.length === 0) {
      throw new HttpsError("invalid-argument", "playlist with tracks is required");
    }

    const shareId = generateShareId();
    const db = getFirestore();

    await db.collection("sharedPlaylists").doc(shareId).set({
      playlist,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    console.log(`[sharePlaylist] Created share ${shareId} with ${playlist.tracks.length} tracks`);

    return { shareId };
  }
);
