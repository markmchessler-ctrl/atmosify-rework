// src/pipeline/dbMatcher.ts
// Stage 3: Query the Atmos Master DB (103k tracks) by artist names.
//
// Uses exact match + prefix search fallback to handle artist name variants.
// Runs queries in parallel batches to maximize throughput.

import type { Firestore } from "firebase-admin/firestore";
import type { DiscoveredArtists, TrackCandidate } from "../lib/types.js";

const PARALLEL_BATCH_SIZE = 10;  // Firestore parallel query limit
const MAX_TRACKS_PER_ARTIST = 50; // cap per artist to avoid one artist dominating

interface FirestoreTrackDoc {
  Artist?: string;
  track_Title?: string;
  album?: string;
  am_duration_ms?: number;
  Apple_Music_ID?: string;
  Apple_Music_URL?: string;
  FINAL_SCORE?: number;
  atmos_mood?: string;
  atmos_energy?: number;
  atmos_vibe?: string[];
  atmos_tempo_estimate?: number;
  [key: string]: unknown;
}

/**
 * Normalize an artist name for comparison and fallback matching.
 * Removes leading "The ", "A ", "An " and lowercases.
 */
function normalizeArtistName(name: string): string {
  return name
    .replace(/^(The |A |An )/i, "")
    .trim()
    .toLowerCase();
}

/**
 * Query Firestore for tracks by a single artist name.
 * Tries exact match first, then prefix search as fallback.
 */
async function queryArtistTracks(
  db: Firestore,
  artistName: string,
  artistRelevance: number,
  artistGenreContext: string
): Promise<{ tracks: TrackCandidate[]; matched: boolean }> {
  const tracksCol = db.collection("tracks");
  const results: TrackCandidate[] = [];

  // 1. Exact match query
  try {
    const exactSnap = await tracksCol
      .where("Artist", "==", artistName)
      .limit(MAX_TRACKS_PER_ARTIST)
      .get();

    if (!exactSnap.empty) {
      for (const doc of exactSnap.docs) {
        const data = doc.data() as FirestoreTrackDoc;
        if (!data.Apple_Music_ID) continue;
        results.push(docToCandidate(doc.id, data, artistRelevance, artistGenreContext));
      }
      return { tracks: results, matched: true };
    }
  } catch (err) {
    console.warn(`[dbMatcher] Exact query failed for "${artistName}":`, err);
  }

  // 2. Prefix search fallback (catches "The Rolling Stones" → "Rolling Stones" etc.)
  try {
    const prefix = artistName;
    const prefixSnap = await tracksCol
      .where("Artist", ">=", prefix)
      .where("Artist", "<=", prefix + "\uf8ff")
      .limit(MAX_TRACKS_PER_ARTIST)
      .get();

    if (!prefixSnap.empty) {
      for (const doc of prefixSnap.docs) {
        const data = doc.data() as FirestoreTrackDoc;
        if (!data.Apple_Music_ID) continue;
        results.push(docToCandidate(doc.id, data, artistRelevance, artistGenreContext));
      }
      return { tracks: results, matched: results.length > 0 };
    }
  } catch (err) {
    console.warn(`[dbMatcher] Prefix query failed for "${artistName}":`, err);
  }

  // 3. Try without "The " prefix
  const normalized = normalizeArtistName(artistName);
  if (normalized !== artistName.toLowerCase()) {
    try {
      const capitalizedNorm = normalized.charAt(0).toUpperCase() + normalized.slice(1);
      const normSnap = await tracksCol
        .where("Artist", "==", capitalizedNorm)
        .limit(MAX_TRACKS_PER_ARTIST)
        .get();

      if (!normSnap.empty) {
        for (const doc of normSnap.docs) {
          const data = doc.data() as FirestoreTrackDoc;
          if (!data.Apple_Music_ID) continue;
          results.push(docToCandidate(doc.id, data, artistRelevance, artistGenreContext));
        }
        return { tracks: results, matched: results.length > 0 };
      }
    } catch (err) {
      console.warn(`[dbMatcher] Normalized query failed for "${artistName}":`, err);
    }
  }

  return { tracks: [], matched: false };
}

function docToCandidate(
  docId: string,
  data: FirestoreTrackDoc,
  artistRelevance: number,
  artistGenreContext: string
): TrackCandidate {
  return {
    docId,
    Artist: (data.Artist as string) ?? "",
    track_Title: (data.Title as string) ?? (data.track_Title as string) ?? "",
    album: (data.Album as string) ?? (data.album as string) ?? "",
    am_duration_ms: (data.am_duration_ms as number | null) ?? null,
    Apple_Music_ID: (data.Apple_Music_ID as string) ?? docId,
    Apple_Music_URL: (data.Apple_Music_URL as string | null) ?? null,
    FINAL_SCORE: (data.FINAL_SCORE as number | null) ?? null,
    artistRelevance,
    artistGenreContext,
    atmos_mood: data.atmos_mood as string | undefined,
    atmos_energy: data.atmos_energy as number | undefined,
    atmos_vibe: data.atmos_vibe as string[] | undefined,
    atmos_tempo_estimate: data.atmos_tempo_estimate as number | undefined,
  };
}

export interface DBMatchResult {
  candidates: TrackCandidate[];
  matchedArtists: string[];
  unmatchedArtists: string[];
  totalFound: number;
}

/**
 * Main entry point: match discovered artists to DB tracks.
 * Returns a deduplicated pool of track candidates.
 */
export async function matchArtistsToTracks(
  db: Firestore,
  discovered: DiscoveredArtists
): Promise<DBMatchResult> {
  const allCandidates = new Map<string, TrackCandidate>(); // docId → candidate
  const matchedArtists: string[] = [];
  const unmatchedArtists: string[] = [];

  const artists = discovered.artists;
  console.log(`[dbMatcher] Querying ${artists.length} artists in Firestore...`);

  // Process in parallel batches
  for (let i = 0; i < artists.length; i += PARALLEL_BATCH_SIZE) {
    const batch = artists.slice(i, i + PARALLEL_BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(artist =>
        queryArtistTracks(db, artist.name, artist.relevanceScore, artist.genreContext)
      )
    );

    for (let j = 0; j < batch.length; j++) {
      const artist = batch[j];
      const { tracks, matched } = batchResults[j];

      if (matched && tracks.length > 0) {
        matchedArtists.push(artist.name);
        for (const track of tracks) {
          // Deduplicate; keep the version with higher relevance if seen twice
          const existing = allCandidates.get(track.docId);
          if (!existing || track.artistRelevance > existing.artistRelevance) {
            allCandidates.set(track.docId, track);
          }
        }
      } else {
        unmatchedArtists.push(artist.name);
      }
    }

    // Brief pause between batches to avoid Firestore connection exhaustion
    if (i + PARALLEL_BATCH_SIZE < artists.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  const candidates = Array.from(allCandidates.values());

  // Sort: high-relevance artists first, then by FINAL_SCORE within same relevance tier
  candidates.sort((a, b) => {
    if (b.artistRelevance !== a.artistRelevance) return b.artistRelevance - a.artistRelevance;
    return (b.FINAL_SCORE ?? 0) - (a.FINAL_SCORE ?? 0);
  });

  console.log(
    `[dbMatcher] Result: ${candidates.length} tracks from ${matchedArtists.length} matched artists. ` +
    `${unmatchedArtists.length} unmatched artists.`
  );
  if (unmatchedArtists.length > 0) {
    console.log(`[dbMatcher] Unmatched: ${unmatchedArtists.join(", ")}`);
  }

  return {
    candidates,
    matchedArtists,
    unmatchedArtists,
    totalFound: candidates.length,
  };
}
