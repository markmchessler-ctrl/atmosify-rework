// src/pipeline/verifier.ts
// Stage 6: Re-verify selected tracks against Apple Music API.
//
// - Confirms Atmos status on Apple Music
// - Extracts real duration from API response (writes back to Firestore)
// - Removes tracks not found on Apple Music (Assembler fills gaps)
// - Keeps tracks found without Atmos flag with a warning badge

import type { Firestore } from "firebase-admin/firestore";
import { batchLookupAppleTracks } from "../lib/appleMusic.js";
import type { PlaylistDraft, PlaylistDraftTrack, VerifiedTrack } from "../lib/types.js";

const DEFAULT_DURATION_MS = 240_000; // 4 min fallback

interface VerifierConfig {
  appleMusicToken: string;
}

export interface VerifierResult {
  verifiedTracks: VerifiedTrack[];
  removedDocIds: string[];
  atmosVerifiedCount: number;
  atmosWarningCount: number;
}

/**
 * Write real Apple Music durations back to Firestore for future use.
 * Fire-and-forget — don't block the response.
 */
function writeDurationsBack(
  db: Firestore,
  updates: Array<{ docId: string; durationMs: number; url: string | null }>
): void {
  const { Timestamp } = require("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
  const batch = db.batch();
  for (const u of updates) {
    const ref = db.collection("tracks").doc(u.docId);
    const fields: Record<string, unknown> = {
      am_duration_ms: u.durationMs,
      am_enriched: true,
      am_enriched_at: Timestamp.now(),
    };
    if (u.url) fields.am_url = u.url;
    batch.set(ref, fields, { merge: true });
  }
  batch.commit().catch(err =>
    console.warn("[verifier] Duration write-back failed:", err)
  );
}

/**
 * Main entry point: verify draft playlist tracks against Apple Music.
 * Returns verified tracks (removed = not found on Apple Music).
 */
export async function verifyPlaylist(
  db: Firestore,
  draft: PlaylistDraft,
  config: VerifierConfig
): Promise<VerifierResult> {
  const draftTracks = draft.tracks;
  if (draftTracks.length === 0) {
    return {
      verifiedTracks: [],
      removedDocIds: [],
      atmosVerifiedCount: 0,
      atmosWarningCount: 0,
    };
  }

  console.log(`[verifier] Verifying ${draftTracks.length} tracks against Apple Music API...`);

  const appleIds = draftTracks.map(t => t.Apple_Music_ID);
  const lookupResults = await batchLookupAppleTracks(appleIds, config.appleMusicToken);

  const verifiedTracks: VerifiedTrack[] = [];
  const removedDocIds: string[] = [];
  const durationUpdates: Array<{ docId: string; durationMs: number; url: string | null }> = [];
  let atmosVerifiedCount = 0;
  let atmosWarningCount = 0;

  for (const draftTrack of draftTracks) {
    const result = lookupResults.get(draftTrack.Apple_Music_ID);

    if (!result || !result.found) {
      // Track not found on Apple Music — remove from playlist
      console.log(`[verifier] Removing "${draftTrack.track_Title}" by ${draftTrack.Artist} (not found on Apple Music)`);
      removedDocIds.push(draftTrack.docId);
      continue;
    }

    const durationMs = result.durationMs ?? DEFAULT_DURATION_MS;
    const durationEstimated = result.durationMs == null;

    // Queue duration write-back if we got a real value
    if (!durationEstimated) {
      durationUpdates.push({
        docId: draftTrack.docId,
        durationMs,
        url: result.url,
      });
    }

    if (result.hasAtmos) {
      atmosVerifiedCount++;
    } else {
      atmosWarningCount++;
      console.log(
        `[verifier] Warning: "${draftTrack.track_Title}" found on AM but no Atmos flag — keeping with warning badge`
      );
    }

    verifiedTracks.push({
      docId: draftTrack.docId,
      Artist: draftTrack.Artist,
      track_Title: draftTrack.track_Title,
      album: draftTrack.album,
      Apple_Music_ID: draftTrack.Apple_Music_ID,
      Apple_Music_URL: result.url ?? draftTrack.Apple_Music_URL,
      durationMs,
      durationEstimated,
      atmosVerified: result.hasAtmos,
      atmosWarning: !result.hasAtmos,
      atmos_mood: draftTrack.atmos_mood,
      atmos_energy: draftTrack.atmos_energy,
      FINAL_SCORE: draftTrack.FINAL_SCORE,
    });
  }

  // Fire-and-forget duration write-backs
  if (durationUpdates.length > 0) {
    writeDurationsBack(db, durationUpdates);
  }

  console.log(
    `[verifier] Result: ${verifiedTracks.length} verified ` +
    `(${atmosVerifiedCount} Atmos confirmed, ${atmosWarningCount} warnings), ` +
    `${removedDocIds.length} removed`
  );

  return {
    verifiedTracks,
    removedDocIds,
    atmosVerifiedCount,
    atmosWarningCount,
  };
}
