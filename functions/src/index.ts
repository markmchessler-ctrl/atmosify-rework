// src/index.ts — Atmosify Cloud Functions
// DB-first Dolby Atmos playlist engine
//
// CHANGES FROM PREVIOUS VERSION:
//   - runAtmosify: now uses DB-first pipeline via orchestrator.ts
//   - getAppleMusicDevToken: new callable for client-side MusicKit JS
//   - New secrets: ATMOS_DB_SERVICE_ACCOUNT, APPLE_TEAM_ID, APPLE_KEY_ID,
//                  APPLE_PRIVATE_KEY, SERPER_API_KEY
//   - Existing extractor.ts functionality removed (no longer needed)
//
// NOTE: Copy the existing non-Atmosify functions (if any) from the previous
// index.ts into this file before deploying.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { runPipeline } from "./pipeline/orchestrator.js";
import { generateAppleMusicToken } from "./lib/appleMusic.js";
import { ATMOS_DB_SERVICE_ACCOUNT } from "./lib/atmosDb.js";

// ── Initialize the default Firebase app (for nextn project) ────────────────
initializeApp();

// ── Secrets ────────────────────────────────────────────────────────────────
const GEMINI_API_KEY      = defineSecret("GEMINI_API_KEY");
const PERPLEXITY_API_KEY  = defineSecret("PERPLEXITY_API_KEY");
const SERPER_API_KEY      = defineSecret("SERPER_API_KEY");
const APPLE_TEAM_ID       = defineSecret("APPLE_TEAM_ID");
const APPLE_KEY_ID        = defineSecret("APPLE_KEY_ID");
const APPLE_PRIVATE_KEY   = defineSecret("APPLE_PRIVATE_KEY");
// ATMOS_DB_SERVICE_ACCOUNT is imported from atmosDb.ts

// ── runAtmosify — Main playlist builder ────────────────────────────────────
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
    const data = request.data as { prompt?: string };
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

// ── getAppleMusicDevToken — Returns Apple Music developer JWT ──────────────
// Called by the client before MusicKit.configure() and before "Save to Apple Music".
export const getAppleMusicDevToken = onCall(
  {
    secrets: [APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY],
  },
  async () => {
    const token = generateAppleMusicToken(
      APPLE_TEAM_ID.value(),
      APPLE_KEY_ID.value(),
      APPLE_PRIVATE_KEY.value()
    );
    return { token };
  }
);
