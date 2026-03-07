// src/pipeline/dbMatcher.ts
// Stage 3: Query the Atmos Master DB (103k tracks) by artist names.
//
// Uses exact match + prefix search fallback to handle artist name variants.
// Runs queries in parallel batches to maximize throughput.

import type { Firestore, Timestamp } from "firebase-admin/firestore";
import type { DiscoveredArtists, DiscoveredArtist, TrackCandidate, PlaylistIntent } from "../lib/types.js";
import { getReferenceArtistsForGenre } from "../lib/referenceAtmos.js";

const PARALLEL_BATCH_SIZE = 10;  // Firestore parallel query limit
const MAX_TRACKS_PER_ARTIST = 50; // cap per artist to avoid one artist dominating

const MIN_QUALITY_SCORE = 5.0; // Minimum FINAL_SCORE to enter the pipeline
const EXCLUDED_QUALITY_CLASSES = new Set(["Poor", "Harmful"]);

interface FirestoreTrackDoc {
  Artist?: string;
  track_Title?: string;
  album?: string;
  am_duration_ms?: number;
  Apple_Music_ID?: string;
  Apple_Music_URL?: string;
  FINAL_SCORE?: number;
  overall_class?: string;
  am_has_atmos?: boolean;
  atmos_mood?: string;
  atmos_energy?: number;
  atmos_vibe?: string[];
  atmos_tempo_estimate?: number;
  atmos_key_estimate?: string;
  am_verification_failed_at?: Timestamp;
  [key: string]: unknown;
}

const VERIFICATION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Quality gate: exclude tracks with low scores or poor classification.
 * Tracks without a score are allowed through (score will be null for new/unscored tracks).
 */
function passesQualityGate(data: FirestoreTrackDoc): boolean {
  // Exclude tracks explicitly classified as Poor or Harmful
  if (data.overall_class && EXCLUDED_QUALITY_CLASSES.has(data.overall_class)) return false;
  // Exclude tracks with a FINAL_SCORE below the minimum (null = unscored, allow through)
  if (data.FINAL_SCORE != null && data.FINAL_SCORE < MIN_QUALITY_SCORE) return false;
  return true;
}

/** Skip tracks that recently failed Apple Music verification */
function isRecentlyFailed(failedAt: Timestamp | undefined): boolean {
  if (!failedAt) return false;
  const failedMs = failedAt.toMillis();
  return Date.now() - failedMs < VERIFICATION_COOLDOWN_MS;
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
        if (isRecentlyFailed(data.am_verification_failed_at)) continue;
        if (!passesQualityGate(data)) continue;
        results.push(docToCandidate(doc.id, data, artistRelevance, artistGenreContext));
      }
      return { tracks: results, matched: true };
    }
  } catch (err) {
    console.warn(`[dbMatcher] Exact query failed for "${artistName}":`, err);
  }

  // 2. Prefix search fallback (catches "The Rolling Stones" -> "Rolling Stones" etc.)
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
        if (isRecentlyFailed(data.am_verification_failed_at)) continue;
        if (!passesQualityGate(data)) continue;
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
          if (isRecentlyFailed(data.am_verification_failed_at)) continue;
          if (!passesQualityGate(data)) continue;
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
    overall_class: (data.overall_class as string | undefined) ?? undefined,
    am_has_atmos: (data.am_has_atmos as boolean | undefined) ?? undefined,
    artistRelevance,
    artistGenreContext,
    atmos_mood: data.atmos_mood as string | undefined,
    atmos_energy: data.atmos_energy as number | undefined,
    atmos_vibe: data.atmos_vibe as string[] | undefined,
    atmos_tempo_estimate: data.atmos_tempo_estimate as number | undefined,
    atmos_key_estimate: data.atmos_key_estimate as string | undefined,
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
  discovered: DiscoveredArtists,
  intent?: PlaylistIntent
): Promise<DBMatchResult> {
  const allCandidates = new Map<string, TrackCandidate>(); // docId -> candidate
  const seenAppleIds = new Map<string, string>(); // Apple_Music_ID -> docId (for cross-doc dedup)
  const matchedArtists: string[] = [];
  const unmatchedArtists: string[] = [];

  let artists = discovered.artists;

  // Prepend reference artists when reference quality mode is active
  if (intent?.referenceQuality) {
    const refArtists = getReferenceArtistsForGenre(intent.genres);
    const existingNames = new Set(artists.map(a => a.name.toLowerCase()));
    const refAsDiscovered: DiscoveredArtist[] = refArtists
      .filter(ra => !existingNames.has(ra.name.toLowerCase()))
      .map(ra => ({
        name: ra.name,
        relevanceScore: 0.95,
        genreContext: ra.genres.join(", "),
        knownFor: ra.knownForAtmos,
      }));
    artists = [...refAsDiscovered, ...artists];
    console.log(`[dbMatcher] Reference quality: prepended ${refAsDiscovered.length} reference artists`);
  }

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
          // Deduplicate by docId and Apple Music ID
          const existingByDocId = allCandidates.get(track.docId);
          const existingDocIdForAppleId = seenAppleIds.get(track.Apple_Music_ID);

          if (existingByDocId) {
            // Same docId seen before -- keep higher relevance version
            if (track.artistRelevance > existingByDocId.artistRelevance) {
              allCandidates.set(track.docId, track);
            }
          } else if (existingDocIdForAppleId) {
            // Different docId but same Apple Music ID -- keep higher relevance version
            const existingByAppleId = allCandidates.get(existingDocIdForAppleId);
            if (existingByAppleId && track.artistRelevance > existingByAppleId.artistRelevance) {
              allCandidates.delete(existingDocIdForAppleId);
              seenAppleIds.set(track.Apple_Music_ID, track.docId);
              allCandidates.set(track.docId, track);
            }
          } else {
            // New track -- add it
            allCandidates.set(track.docId, track);
            seenAppleIds.set(track.Apple_Music_ID, track.docId);
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

/**
 * Check if a track's genre aligns with the intent genres/subGenres.
 * Uses case-insensitive substring matching to catch "Yacht Rock" in "Rock / Yacht Rock".
 */
function genreAligns(trackGenre: string | undefined, intent: PlaylistIntent): boolean {
  if (!trackGenre) return false;
  const lower = trackGenre.toLowerCase();
  const allIntentGenres = [...(intent.genres ?? []), ...(intent.subGenres ?? [])];
  return allIntentGenres.some(g => lower.includes(g.toLowerCase()) || g.toLowerCase().includes(lower));
}

/**
 * Discover tracks by genre and mood attributes (supplements artist-based matching).
 * GENRE-FIRST: queries by genre first to stay on-genre, then optionally by mood
 * within genre-matched results. Tracks that don't match intent genres are excluded.
 */
export async function discoverTracksByAttributes(
  db: Firestore,
  intent: PlaylistIntent,
  limit: number
): Promise<TrackCandidate[]> {
  const tracksCol = db.collection("tracks");
  const results = new Map<string, TrackCandidate>();

  // 1. Query by genre FIRST (primary -- keeps results on-genre)
  const allGenres = [...(intent.genres ?? []), ...(intent.subGenres ?? [])];
  for (const genre of allGenres.slice(0, 4)) {
    if (results.size >= limit) break;
    try {
      const snap = await tracksCol
        .where("genre", "==", genre)
        .limit(Math.min(limit - results.size, MAX_TRACKS_PER_ARTIST * 10))
        .get();

      for (const doc of snap.docs) {
        if (results.has(doc.id)) continue;
        const data = doc.data() as FirestoreTrackDoc;
        if (!data.Apple_Music_ID) continue;
        if (isRecentlyFailed(data.am_verification_failed_at)) continue;
        if (!passesQualityGate(data)) continue;
        results.set(doc.id, docToCandidate(doc.id, data, 0.5, `genre-match:${genre}`));
      }
    } catch (err) {
      console.warn(`[dbMatcher] Genre query failed for "${genre}":`, err);
    }
  }

  // 2. Query by mood ONLY if genre results are thin, and filter by genre in-memory
  if (results.size < limit / 2) {
    const moods = intent.moods ?? [];
    let moodAdded = 0;
    for (const mood of moods.slice(0, 2)) {
      if (results.size >= limit) break;
      try {
        const snap = await tracksCol
          .where("atmos_mood", "==", mood)
          .limit(MAX_TRACKS_PER_ARTIST * 5)
          .get();

        for (const doc of snap.docs) {
          if (results.has(doc.id)) continue;
          const data = doc.data() as FirestoreTrackDoc;
          if (!data.Apple_Music_ID) continue;
          if (isRecentlyFailed(data.am_verification_failed_at)) continue;
          if (!passesQualityGate(data)) continue;
          // Genre filter: only accept mood-matched tracks if their genre aligns
          if (!genreAligns(data.genre as string | undefined, intent)) continue;
          results.set(doc.id, docToCandidate(doc.id, data, 0.3, `mood-match:${mood}`));
          moodAdded++;
        }
      } catch (err) {
        console.warn(`[dbMatcher] Attribute query failed for mood "${mood}":`, err);
      }
    }
    console.log(`[dbMatcher] Mood queries added ${moodAdded} genre-aligned tracks`);
  }

  console.log(`[dbMatcher] Attribute discovery: ${results.size} tracks from genre/mood queries`);
  return Array.from(results.values());
}
