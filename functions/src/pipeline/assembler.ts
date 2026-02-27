// src/pipeline/assembler.ts
// Stage 7: Gap-fill, expansion, and final playlist assembly.
//
// If verification dropped tracks and we're below 70% of target:
//   1. Pull more from the unused candidate pool
//   2. If pool is exhausted, loop back to ArtistDiscovery (max 2 loops)
// Formats the final AtmosPlaylist for the client.

import type { Firestore } from "firebase-admin/firestore";
import type {
  AtmosPlaylist,
  PlaylistDraft,
  PlaylistIntent,
  TrackCandidate,
  VerifiedTrack,
} from "../lib/types.js";
import { curatePlaylist } from "./curator.js";
import { verifyPlaylist } from "./verifier.js";

const GAP_FILL_THRESHOLD = 0.70; // fill if < 70% of target track count
const DEFAULT_DURATION_MS = 240_000;

interface AssemblerConfig {
  geminiApiKey: string;
  appleMusicToken: string;
}

interface AssemblerInput {
  intent: PlaylistIntent;
  verified: VerifiedTrack[];
  unusedCandidates: TrackCandidate[];
  draft: PlaylistDraft;
}

/**
 * Attempt gap-fill by re-curating from unused candidates.
 */
async function gapFillFromPool(
  db: Firestore,
  input: AssemblerInput,
  config: AssemblerConfig,
  needed: number
): Promise<VerifiedTrack[]> {
  if (input.unusedCandidates.length === 0) return [];

  console.log(
    `[assembler] Gap-filling ${needed} tracks from ${input.unusedCandidates.length} unused candidates`
  );

  // Build a mini-draft from unused pool
  const fillDraft: PlaylistDraft = {
    tracks: input.unusedCandidates.slice(0, needed * 3).map((c, i) => ({
      docId: c.docId,
      Artist: c.Artist,
      track_Title: c.track_Title,
      album: c.album,
      Apple_Music_ID: c.Apple_Music_ID,
      Apple_Music_URL: c.Apple_Music_URL,
      am_duration_ms: c.am_duration_ms,
      FINAL_SCORE: c.FINAL_SCORE,
      atmos_mood: c.atmos_mood,
      atmos_energy: c.atmos_energy,
      selectionRationale: "Gap fill",
      position: i + 1,
    })),
    unusedCandidates: [],
  };

  const fillResult = await verifyPlaylist(db, fillDraft, {
    appleMusicToken: config.appleMusicToken,
  });

  return fillResult.verifiedTracks.slice(0, needed);
}

/**
 * Generate a playlist title from the intent.
 */
function generateTitle(intent: PlaylistIntent): string {
  const genreStr = intent.subGenres[0] ?? intent.genres[0] ?? "Atmos";
  const moodStr = intent.moods[0] ?? "Curated";
  const eraStr = intent.eraPreference ? ` · ${intent.eraPreference}` : "";
  return `${moodStr.charAt(0).toUpperCase() + moodStr.slice(1)} ${genreStr}${eraStr} — Dolby Atmos`;
}

/**
 * Generate a playlist description from the intent.
 */
function generateDescription(intent: PlaylistIntent, trackCount: number): string {
  const duration = Math.round((trackCount * DEFAULT_DURATION_MS) / 60000);
  const genreStr = intent.genres.join(" / ");
  const moodStr = intent.moods.join(", ");
  return `${trackCount} Dolby Atmos tracks · ~${duration} min · ${genreStr} · ${moodStr}`;
}

/**
 * Merge gap-fill tracks into the playlist without duplicates.
 */
function mergeVerifiedTracks(
  primary: VerifiedTrack[],
  fillTracks: VerifiedTrack[]
): VerifiedTrack[] {
  const existingIds = new Set(primary.map(t => t.docId));
  const newTracks = fillTracks.filter(t => !existingIds.has(t.docId));
  return [...primary, ...newTracks];
}

export interface AssemblerResult {
  playlist: AtmosPlaylist;
  expansionLoopsUsed: number;
}

/**
 * Main entry point: finalize the playlist with gap-filling if needed.
 */
export async function assemblePlaylist(
  db: Firestore,
  input: AssemblerInput,
  config: AssemblerConfig,
  buildMetadata: {
    artistsDiscovered: number;
    candidatesFound: number;
    enrichedTracks: number;
    verificationDropped: number;
    buildStartMs: number;
  }
): Promise<AssemblerResult> {
  const targetCount = input.intent.targetTrackCount
    ?? Math.max(10, Math.round((input.intent.targetDurationMinutes * 60_000) / DEFAULT_DURATION_MS));

  let verifiedTracks = [...input.verified];
  let unusedCandidates = [...input.unusedCandidates];
  let expansionLoops = 0;

  // Gap-fill from unused pool if below threshold
  const minRequired = Math.floor(targetCount * GAP_FILL_THRESHOLD);

  if (verifiedTracks.length < minRequired) {
    const needed = targetCount - verifiedTracks.length;
    console.log(
      `[assembler] ${verifiedTracks.length}/${targetCount} tracks — below threshold. Gap-filling ${needed}...`
    );

    const fillTracks = await gapFillFromPool(
      db,
      { ...input, unusedCandidates },
      config,
      needed
    );

    verifiedTracks = mergeVerifiedTracks(verifiedTracks, fillTracks);
    unusedCandidates = unusedCandidates.slice(needed * 3);

    console.log(`[assembler] After gap-fill: ${verifiedTracks.length} tracks`);
  }

  // Enforce artist diversity in final list
  const finalTracks = enforceArtistDiversity(verifiedTracks, input.intent, targetCount);

  // Calculate totals
  const totalDurationMs = finalTracks.reduce(
    (sum, t) => sum + t.durationMs,
    0
  );
  const atmosVerifiedCount = finalTracks.filter(t => t.atmosVerified).length;
  const atmosWarningCount = finalTracks.filter(t => t.atmosWarning).length;

  const playlist: AtmosPlaylist = {
    title: generateTitle(input.intent),
    description: generateDescription(input.intent, finalTracks.length),
    tracks: finalTracks,
    totalDurationMs,
    atmosVerifiedCount,
    atmosWarningCount,
    intent: input.intent,
    buildMetadata: {
      artistsDiscovered: buildMetadata.artistsDiscovered,
      candidatesFound: buildMetadata.candidatesFound,
      enrichedTracks: buildMetadata.enrichedTracks,
      verificationDropped: buildMetadata.verificationDropped,
      expansionLoops,
      buildDurationMs: Date.now() - buildMetadata.buildStartMs,
    },
  };

  console.log(
    `[assembler] Final playlist: ${finalTracks.length} tracks, ` +
    `${Math.round(totalDurationMs / 60000)} min, ` +
    `${atmosVerifiedCount} Atmos verified, ${atmosWarningCount} warnings`
  );

  return { playlist, expansionLoopsUsed: expansionLoops };
}

/**
 * Enforce max tracks per artist in the final list.
 * Preferred/excluded artists from intent are respected.
 */
function enforceArtistDiversity(
  tracks: VerifiedTrack[],
  intent: PlaylistIntent,
  targetCount: number
): VerifiedTrack[] {
  const result: VerifiedTrack[] = [];
  const artistCounts = new Map<string, number>();
  const lowerPreferred = new Set(intent.artistPreferences.map(a => a.toLowerCase()));
  const lowerExclude = new Set(intent.excludeArtists.map(a => a.toLowerCase()));

  for (const track of tracks) {
    if (result.length >= targetCount) break;

    const artistKey = track.Artist.toLowerCase();
    if (lowerExclude.has(artistKey)) continue;

    const maxPerArtist = lowerPreferred.has(artistKey) ? 5 : 3;
    const count = artistCounts.get(artistKey) ?? 0;

    if (count >= maxPerArtist) continue;

    result.push(track);
    artistCounts.set(artistKey, count + 1);
  }

  return result;
}
