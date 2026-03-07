#!/bin/bash
# Atmosify Pipeline Optimization — Deploy to Firebase Studio
# Paste this entire script into Firebase Studio's terminal.
# It writes 5 files: 4 modified + 1 new (candidateScorer.ts)
#
# Path mapping: local functions/src/pipeline/ → Studio src/logic/

set -e
echo "=== Deploying Atmosify pipeline optimizations ==="

# ─── File 1/5: src/logic/trackEnricher.ts ───────────────────────────────────
echo "[1/5] Writing src/logic/trackEnricher.ts..."
cat > src/logic/trackEnricher.ts << 'ATMOSIFY_EOF_1'
// src/logic/trackEnricher.ts
// Stage 4: Enrich each track candidate with mood/energy/vibe metadata.
//
// Uses Gemini Flash (primary) or Perplexity (fallback) to classify per-track affect.
// Caches results to Firestore under atmos_ prefix fields (30-day TTL).
// Cache-first: tracks enriched within 30 days are skipped.

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Firestore, Timestamp } from "firebase-admin/firestore";
import type { TrackCandidate, PlaylistIntent } from "../lib/types.js";

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";
const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";
const CACHE_TTL_DAYS = 30;
const BATCH_SIZE = 12; // tracks per Gemini/Perplexity call

interface EnrichmentConfig {
  perplexityApiKey: string;
  geminiApiKey: string;
}

interface TrackEnrichment {
  mood: string;
  energy: number;   // 1-10
  vibe: string[];   // e.g. ["atmospheric", "hypnotic", "bass-heavy"]
  tempoEstimate: number; // BPM estimate
}

interface FirestoreEnrichmentFields {
  atmos_mood?: string;
  atmos_energy?: number;
  atmos_vibe?: string[];
  atmos_tempo_estimate?: number;
  atmos_enriched_at?: Timestamp;
  atmos_enriched_by?: string;
}

function isCacheFresh(enrichedAt: Timestamp | undefined): boolean {
  if (!enrichedAt) return false;
  const ageMs = Date.now() - enrichedAt.toMillis();
  return ageMs < CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
}

function buildEnrichmentPrompt(
  artist: string,
  tracks: Array<{ index: number; title: string; album: string }>,
  intent: PlaylistIntent
): string {
  const trackList = tracks
    .map(t => `${t.index + 1}. "${t.title}" from album "${t.album}"`)
    .join("\n");

  return `You are a music expert. For each track by ${artist} listed below, classify:
- mood: one descriptive word (e.g., "melancholic", "euphoric", "introspective", "energetic", "sensual")
- energy: integer 1-10 (1=ambient/soft, 10=intense/aggressive)
- vibe: 2-4 short descriptors (e.g., ["atmospheric", "hypnotic", "late-night"])
- tempoEstimate: BPM estimate as integer

Context: The listener wants ${intent.description}
Desired mood: ${intent.moods.join(", ")}
Desired energy range: ${intent.energyRange[0]}-${intent.energyRange[1]}/10

Tracks:
${trackList}

Return ONLY valid JSON, no markdown:
[
  {"index": 0, "mood": "...", "energy": 5, "vibe": ["...", "..."], "tempoEstimate": 95},
  ...
]`;
}

async function enrichWithPerplexity(
  prompt: string,
  apiKey: string
): Promise<TrackEnrichment[] | null> {
  try {
    const resp = await fetch(PERPLEXITY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2000,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) return null;

    const data = await resp.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]) as TrackEnrichment[];
  } catch {
    return null;
  }
}

async function enrichWithGemini(
  prompt: string,
  apiKey: string
): Promise<TrackEnrichment[] | null> {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]) as TrackEnrichment[];
  } catch {
    return null;
  }
}

/**
 * Apply enrichment results to a batch of TrackCandidates.
 * Also writes results to Firestore cache (atmos_ prefix fields).
 */
async function applyEnrichment(
  db: Firestore,
  tracks: TrackCandidate[],
  enrichments: TrackEnrichment[],
  source: string
): Promise<void> {
  const { Timestamp: FsTimestamp } = await import("firebase-admin/firestore");
  const now = FsTimestamp.now();
  const writes: Promise<void>[] = [];

  for (const enrichment of enrichments) {
    const track = tracks[enrichment.index];
    if (!track) continue;

    // Update in-memory candidate
    track.atmos_mood = enrichment.mood;
    track.atmos_energy = enrichment.energy;
    track.atmos_vibe = enrichment.vibe;
    track.atmos_tempo_estimate = enrichment.tempoEstimate;

    // Write to Firestore cache
    const fields: FirestoreEnrichmentFields = {
      atmos_mood: enrichment.mood,
      atmos_energy: enrichment.energy,
      atmos_vibe: enrichment.vibe,
      atmos_tempo_estimate: enrichment.tempoEstimate,
      atmos_enriched_at: now,
      atmos_enriched_by: source,
    };

    writes.push(
      db.collection("tracks").doc(track.docId).set(fields, { merge: true })
        .catch(err => console.warn(`[trackEnricher] Cache write failed for ${track.docId}:`, err))
    );
  }

  await Promise.all(writes);
}

export interface EnricherResult {
  enrichedCandidates: TrackCandidate[];
  cacheHits: number;
  freshlyEnriched: number;
  failed: number;
}

/**
 * Main entry point: enrich track candidates with per-track mood/energy/vibe.
 * Processes ALL candidates (not just the final selection) so the cache fills rapidly.
 */
export async function enrichTracks(
  db: Firestore,
  candidates: TrackCandidate[],
  intent: PlaylistIntent,
  config: EnrichmentConfig
): Promise<EnricherResult> {
  let cacheHits = 0;
  let freshlyEnriched = 0;
  let failed = 0;

  // Separate cached vs. stale/missing
  const needsEnrichment: TrackCandidate[] = [];
  for (const track of candidates) {
    // Check if enrichment is already loaded (from DB query) and still fresh
    // We can't check atmos_enriched_at here directly since it's not in TrackCandidate.
    // Re-fetch enriched_at from Firestore for cache check.
    if (track.atmos_mood && track.atmos_energy && track.atmos_vibe) {
      cacheHits++;
    } else {
      needsEnrichment.push(track);
    }
  }

  console.log(
    `[trackEnricher] ${cacheHits} cache hits, ${needsEnrichment.length} tracks need enrichment`
  );

  // Check atmos_enriched_at for tracks that appear unenriched
  // Do this in batches to avoid too many Firestore reads
  const FRESHNESS_BATCH = 50;
  const trulyStale: TrackCandidate[] = [];

  for (let i = 0; i < needsEnrichment.length; i += FRESHNESS_BATCH) {
    const batch = needsEnrichment.slice(i, i + FRESHNESS_BATCH);
    const snaps = await Promise.all(
      batch.map(t => db.collection("tracks").doc(t.docId).get())
    );

    for (let j = 0; j < batch.length; j++) {
      const track = batch[j];
      const snap = snaps[j];
      const data = snap.data() as FirestoreEnrichmentFields | undefined;

      if (data?.atmos_enriched_at && isCacheFresh(data.atmos_enriched_at)) {
        // Load from cache
        track.atmos_mood = data.atmos_mood;
        track.atmos_energy = data.atmos_energy;
        track.atmos_vibe = data.atmos_vibe;
        track.atmos_tempo_estimate = data.atmos_tempo_estimate;
        cacheHits++;
      } else {
        trulyStale.push(track);
      }
    }
  }

  console.log(
    `[trackEnricher] After freshness check: ${cacheHits} cache hits, ${trulyStale.length} to enrich`
  );

  // Group by artist for more efficient batching
  const byArtist = new Map<string, TrackCandidate[]>();
  for (const track of trulyStale) {
    const existing = byArtist.get(track.Artist) ?? [];
    existing.push(track);
    byArtist.set(track.Artist, existing);
  }

  // ── Concurrent batch executor ─────────────────────────────────
  const CONCURRENCY = 4; // max simultaneous Gemini/Perplexity calls

  interface EnrichmentJob {
    artist: string;
    batchTracks: TrackCandidate[];
  }

  const jobs: EnrichmentJob[] = [];
  for (const [artist, tracks] of byArtist) {
    for (let i = 0; i < tracks.length; i += BATCH_SIZE) {
      jobs.push({ artist, batchTracks: tracks.slice(i, i + BATCH_SIZE) });
    }
  }

  console.log(
    `[trackEnricher] Processing ${jobs.length} batches (${Math.min(CONCURRENCY, jobs.length)} concurrent)`
  );

  let jobIndex = 0;

  async function processNextJob(): Promise<void> {
    while (jobIndex < jobs.length) {
      const myIndex = jobIndex++;
      const job = jobs[myIndex];

      const batchInput = job.batchTracks.map((t, idx) => ({
        index: idx,
        title: t.track_Title,
        album: t.album,
      }));

      const prompt = buildEnrichmentPrompt(job.artist, batchInput, intent);

      // Gemini Flash is primary (classification task — no web search needed)
      // Perplexity is fallback only
      let enrichments = await enrichWithGemini(prompt, config.geminiApiKey);
      let source = "gemini";

      if (!enrichments || enrichments.length === 0) {
        enrichments = await enrichWithPerplexity(prompt, config.perplexityApiKey);
        source = "perplexity";
      }

      if (enrichments && enrichments.length > 0) {
        await applyEnrichment(db, job.batchTracks, enrichments, source);
        freshlyEnriched += enrichments.length;
      } else {
        for (const track of job.batchTracks) {
          track.atmos_mood = "unknown";
          track.atmos_energy = 5;
          track.atmos_vibe = [];
        }
        failed += job.batchTracks.length;
        console.warn(`[trackEnricher] Enrichment failed for artist: ${job.artist}`);
      }
    }
  }

  // Launch N concurrent workers
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => processNextJob())
  );

  console.log(
    `[trackEnricher] Done: ${cacheHits} cache hits, ${freshlyEnriched} enriched, ${failed} failed`
  );

  return {
    enrichedCandidates: candidates,
    cacheHits,
    freshlyEnriched,
    failed,
  };
}
ATMOSIFY_EOF_1

# ─── File 2/5: src/logic/candidateScorer.ts (NEW) ──────────────────────────
echo "[2/5] Writing src/logic/candidateScorer.ts (NEW)..."
cat > src/logic/candidateScorer.ts << 'ATMOSIFY_EOF_2'
// src/logic/candidateScorer.ts
// Pre-enrichment scoring: rank candidates using metadata already available
// from DB Matcher so we only spend API calls on the top candidates.

import type { TrackCandidate, PlaylistIntent } from "../lib/types.js";

/**
 * Score and rank candidates using fields available BEFORE enrichment.
 * Returns the top `maxToEnrich` candidates for enrichment, plus the rest
 * as deferred (available for gap-fill but not worth an API call).
 *
 * Already-enriched candidates (cache hits) are always included since
 * they cost nothing to pass through the enricher.
 */
export function scoreAndRank(
  candidates: TrackCandidate[],
  _intent: PlaylistIntent,
  maxToEnrich: number
): { toEnrich: TrackCandidate[]; deferred: TrackCandidate[] } {
  const scored = candidates.map(c => {
    let score = 0;

    // Artist relevance is the strongest signal (0-1, scale to 0-50)
    score += (c.artistRelevance ?? 0) * 50;

    // FINAL_SCORE from the research engine (0-100, scale to 0-30)
    score += ((c.FINAL_SCORE ?? 0) / 100) * 30;

    // Bonus for tracks that already have enrichment (cache hits are free)
    if (c.atmos_mood && c.atmos_energy) score += 15;

    // Bonus for tracks with verified Apple Music duration
    if (c.am_duration_ms) score += 5;

    return { candidate: c, score };
  });

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  // Always include cache hits (they're free) + top N scorers needing enrichment
  const alreadyEnriched = scored.filter(s => s.candidate.atmos_mood && s.candidate.atmos_energy);
  const needsEnrichment = scored.filter(s => !s.candidate.atmos_mood || !s.candidate.atmos_energy);

  const enrichBudget = Math.max(0, maxToEnrich - alreadyEnriched.length);

  const toEnrich = [
    ...alreadyEnriched.map(s => s.candidate),
    ...needsEnrichment.slice(0, enrichBudget).map(s => s.candidate),
  ];
  const deferred = needsEnrichment.slice(enrichBudget).map(s => s.candidate);

  return { toEnrich, deferred };
}
ATMOSIFY_EOF_2

# ─── File 3/5: src/logic/orchestrator.ts ────────────────────────────────────
echo "[3/5] Writing src/logic/orchestrator.ts..."
cat > src/logic/orchestrator.ts << 'ATMOSIFY_EOF_3'
// src/logic/orchestrator.ts
// Main pipeline orchestrator — replaces the recursive web-search loop.
//
// NEW PIPELINE:
//   [1] Clarify   → structured PlaylistIntent
//   [2] Discover  → artist names matching vibe/mood
//   [3] Match     → DB tracks from those artists
//   [4] Enrich    → per-track mood/energy/vibe
//   [5] Curate    → AI selects + sequences best tracks
//   [6] Verify    → Apple Music API re-confirmation + real durations
//   [7] Assemble  → gap-fill + final formatting
//
// Expansion loops (max 2) trigger when candidates pool is too thin.

import { getAtmosDb } from "../lib/atmosDb.js";
import { generateAppleMusicToken } from "../lib/appleMusic.js";
import { clarifyIntent } from "./clarify.js";
import { discoverArtists, expandArtistDiscovery } from "./artistDiscovery.js";
import { matchArtistsToTracks } from "./dbMatcher.js";
import { enrichTracks } from "./trackEnricher.js";
import { scoreAndRank } from "./candidateScorer.js";
import { curatePlaylist } from "./curator.js";
import { verifyPlaylist } from "./verifier.js";
import { assemblePlaylist } from "./assembler.js";
import type { AtmosPlaylist, DiscoveredArtist, PlaylistIntent } from "../lib/types.js";

const MAX_EXPANSION_LOOPS = 2;
// Minimum candidates needed before running curation (2x target track count)
const MIN_CANDIDATE_MULTIPLIER = 2;

interface OrchestratorConfig {
  geminiApiKey: string;
  perplexityApiKey: string;
  serperApiKey?: string;
  appleTeamId: string;
  appleKeyId: string;
  applePrivateKey: string;
}

export interface OrchestratorResult {
  playlist: AtmosPlaylist | null;
  needsClarification: boolean;
  clarificationQuestion?: string;
  error?: string;
}

/**
 * Calculate minimum candidate target based on intent.
 */
function getMinCandidates(intent: PlaylistIntent): number {
  const targetCount = intent.targetTrackCount
    ?? Math.max(10, Math.round((intent.targetDurationMinutes * 60_000) / 240_000));
  return targetCount * MIN_CANDIDATE_MULTIPLIER;
}

/**
 * Run the full Atmosify pipeline for a user request.
 */
export async function runPipeline(
  userPrompt: string,
  config: OrchestratorConfig
): Promise<OrchestratorResult> {
  const buildStartMs = Date.now();
  const db = getAtmosDb();

  // ── Stage 1: Clarify ──────────────────────────────────────────────────────
  console.log("[orchestrator] Stage 1: Clarify");
  const clarifyResult = await clarifyIntent(userPrompt, { geminiApiKey: config.geminiApiKey });

  if (clarifyResult.needsClarification || !clarifyResult.intent) {
    return {
      playlist: null,
      needsClarification: true,
      clarificationQuestion: clarifyResult.clarificationQuestion,
    };
  }

  const intent = clarifyResult.intent;
  const minCandidates = getMinCandidates(intent);

  if (intent.referenceQuality) {
    console.log("[orchestrator] Reference quality mode ACTIVE");
  }

  const discoveryConfig = {
    perplexityApiKey: config.perplexityApiKey,
    geminiApiKey: config.geminiApiKey,
    serperApiKey: config.serperApiKey,
  };

  // ── Stage 2: ArtistDiscovery ──────────────────────────────────────────────
  console.log("[orchestrator] Stage 2: ArtistDiscovery");
  const discovered = await discoverArtists(intent, discoveryConfig);
  let allDiscoveredArtists: DiscoveredArtist[] = [...discovered.artists];

  // ── Stage 3: DBMatcher ────────────────────────────────────────────────────
  console.log("[orchestrator] Stage 3: DBMatcher");
  let matchResult = await matchArtistsToTracks(db, { artists: allDiscoveredArtists, searchStrategy: discovered.searchStrategy }, intent);
  let candidates = matchResult.candidates;

  // Expansion loops if candidate pool is too thin
  let expansionLoop = 0;
  while (candidates.length < minCandidates && expansionLoop < MAX_EXPANSION_LOOPS) {
    expansionLoop++;
    console.log(
      `[orchestrator] Expansion loop ${expansionLoop}: only ${candidates.length} candidates, need ${minCandidates}. Expanding...`
    );

    const expanded = await expandArtistDiscovery(intent, allDiscoveredArtists, discoveryConfig, 30);

    if (expanded.artists.length === 0) {
      console.log("[orchestrator] No new artists from expansion — stopping");
      break;
    }

    allDiscoveredArtists = [...allDiscoveredArtists, ...expanded.artists];
    const expandMatch = await matchArtistsToTracks(db, { artists: expanded.artists, searchStrategy: "expansion" }, intent);
    candidates = mergeUnique(candidates, expandMatch.candidates);
  }

  if (candidates.length === 0) {
    return {
      playlist: null,
      needsClarification: false,
      error: `No tracks found in the Atmos DB matching your request for "${intent.description}". Try a different genre or mood.`,
    };
  }

  // ── Pre-enrichment scoring ──────────────────────────────────────────────
  const targetCount = intent.targetTrackCount
    ?? Math.max(10, Math.round((intent.targetDurationMinutes * 60_000) / 240_000));
  const enrichBudget = targetCount * 3;

  const { toEnrich, deferred } = scoreAndRank(candidates, intent, enrichBudget);
  console.log(
    `[orchestrator] Pre-scoring: ${candidates.length} candidates, ` +
    `enriching top ${toEnrich.length}, deferring ${deferred.length}`
  );

  // ── Stage 4: TrackEnricher (only top candidates) ──────────────────────
  console.log(`[orchestrator] Stage 4: TrackEnricher (${toEnrich.length} of ${candidates.length})`);
  const enricherResult = await enrichTracks(db, toEnrich, intent, {
    perplexityApiKey: config.perplexityApiKey,
    geminiApiKey: config.geminiApiKey,
  });
  // Include deferred candidates at end for gap-fill pool in assembler
  const enrichedCandidates = [...enricherResult.enrichedCandidates, ...deferred];

  // ── Stage 5: Curator ──────────────────────────────────────────────────────
  console.log("[orchestrator] Stage 5: Curator");
  const curatorResult = await curatePlaylist(enrichedCandidates, intent, {
    geminiApiKey: config.geminiApiKey,
  });
  const draft = curatorResult.draft;

  // ── Stage 6: Verifier ─────────────────────────────────────────────────────
  console.log("[orchestrator] Stage 6: Verifier");
  const appleMusicToken = generateAppleMusicToken(
    config.appleTeamId,
    config.appleKeyId,
    config.applePrivateKey
  );
  const verifierResult = await verifyPlaylist(db, draft, { appleMusicToken });

  // ── Stage 7: Assembler ────────────────────────────────────────────────────
  console.log("[orchestrator] Stage 7: Assembler");
  const assemblerResult = await assemblePlaylist(
    db,
    {
      intent,
      verified: verifierResult.verifiedTracks,
      unusedCandidates: draft.unusedCandidates,
      draft,
    },
    {
      geminiApiKey: config.geminiApiKey,
      appleMusicToken,
    },
    {
      artistsDiscovered: allDiscoveredArtists.length,
      candidatesFound: candidates.length,
      enrichedTracks: enricherResult.freshlyEnriched + enricherResult.cacheHits,
      verificationDropped: verifierResult.removedDocIds.length,
      buildStartMs,
    }
  );

  const { playlist } = assemblerResult;

  if (playlist.tracks.length === 0) {
    return {
      playlist: null,
      needsClarification: false,
      error: `Found artists matching your request, but no tracks passed Apple Music verification. Try a broader genre.`,
    };
  }

  console.log(
    `[orchestrator] Pipeline complete in ${Date.now() - buildStartMs}ms. ` +
    `${playlist.tracks.length} tracks, ${playlist.atmosVerifiedCount} Atmos confirmed.`
  );

  return { playlist, needsClarification: false };
}

/**
 * Merge two candidate arrays, deduplicating by docId.
 */
function mergeUnique<T extends { docId: string }>(a: T[], b: T[]): T[] {
  const seen = new Set(a.map(x => x.docId));
  const result = [...a];
  for (const item of b) {
    if (!seen.has(item.docId)) {
      result.push(item);
      seen.add(item.docId);
    }
  }
  return result;
}
ATMOSIFY_EOF_3

# ─── File 4/5: src/logic/artistDiscovery.ts ─────────────────────────────────
echo "[4/5] Writing src/logic/artistDiscovery.ts..."
cat > src/logic/artistDiscovery.ts << 'ATMOSIFY_EOF_4'
// src/logic/artistDiscovery.ts
// Stage 2: Discover artists matching the user's vibe/mood/genre request.
//
// Sources (in order):
//   1. Perplexity Sonar (PRIMARY) — web-aware, great for music genre knowledge
import { extractJSON } from "./perplexity.js";
//   2. Serper (SUPPLEMENTAL) — web search for niche/specific requests
//   3. Gemini 3.1 Flash Lite (FALLBACK) — if Perplexity is unavailable
//
// All prompts are grounded in the NotebookLM genre taxonomy.

import { createHash } from "crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getFirestore } from "firebase-admin/firestore";
import { buildTaxonomyPromptContext } from "../lib/genreTaxonomy.js";
import { buildReferencePromptFragment } from "../lib/referenceAtmos.js";
import type { PlaylistIntent, DiscoveredArtists, DiscoveredArtist } from "../lib/types.js";

// ── Discovery cache ────────────────────────────────────────────────────────
const DISCOVERY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const DISCOVERY_CACHE_COLLECTION = "discoveryCache";

interface CachedDiscovery {
  artists: DiscoveredArtist[];
  searchStrategy: string;
  cachedAt: number;
  intentDescription: string;
}

function buildDiscoveryCacheKey(intent: PlaylistIntent): string {
  const keyParts = {
    genres: [...intent.genres].sort(),
    subGenres: [...intent.subGenres].sort(),
    moods: [...intent.moods].sort(),
    vibeKeywords: [...intent.vibeKeywords].sort(),
    energyRange: intent.energyRange,
    eraPreference: intent.eraPreference ?? "any",
    artistPreferences: [...intent.artistPreferences].sort(),
    excludeArtists: [...intent.excludeArtists].sort(),
    referenceQuality: intent.referenceQuality,
  };
  return "discovery_" + createHash("sha256")
    .update(JSON.stringify(keyParts))
    .digest("hex")
    .slice(0, 16);
}

async function getFromCache(cacheKey: string): Promise<DiscoveredArtists | null> {
  try {
    const doc = await getFirestore()
      .collection(DISCOVERY_CACHE_COLLECTION)
      .doc(cacheKey)
      .get();
    if (!doc.exists) return null;
    const data = doc.data() as CachedDiscovery;
    if (Date.now() - data.cachedAt > DISCOVERY_CACHE_TTL_MS) return null;
    return { artists: data.artists, searchStrategy: data.searchStrategy + "+cached" };
  } catch {
    return null;
  }
}

async function writeToCache(
  cacheKey: string,
  result: DiscoveredArtists,
  intentDescription: string
): Promise<void> {
  try {
    await getFirestore()
      .collection(DISCOVERY_CACHE_COLLECTION)
      .doc(cacheKey)
      .set({
        artists: result.artists,
        searchStrategy: result.searchStrategy,
        cachedAt: Date.now(),
        intentDescription,
      });
  } catch (err) {
    console.warn("[artistDiscovery] Cache write failed:", err);
  }
}

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";
// Gemini 3.1 Flash Lite
const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";

interface ArtistDiscoveryConfig {
  perplexityApiKey: string;
  geminiApiKey: string;
  serperApiKey?: string;
}

/**
 * Build the artist discovery prompt, grounded in the genre taxonomy.
 */
function buildArtistDiscoveryPrompt(intent: PlaylistIntent, targetCount = 50): string {
  const taxonomyContext = buildTaxonomyPromptContext(intent.genres, intent.moods);
  const referenceContext = intent.referenceQuality
    ? buildReferencePromptFragment(intent.genres)
    : "";

  const eraText = intent.eraPreference
    ? `Era preference: ${intent.eraPreference}`
    : "No specific era preference — include classic and contemporary artists.";

  const excludeText = intent.excludeArtists.length > 0
    ? `Exclude these artists: ${intent.excludeArtists.join(", ")}`
    : "";

  const includeText = intent.artistPreferences.length > 0
    ? `The listener specifically likes: ${intent.artistPreferences.join(", ")} — include similar artists.`
    : "";

  return `${taxonomyContext}

${referenceContext}LISTENER REQUEST:
Description: ${intent.description}
Genres: ${intent.genres.join(", ") || "Any"}
Sub-genres: ${intent.subGenres.join(", ") || "Any"}
Moods: ${intent.moods.join(", ") || "Any"}
Vibe keywords: ${intent.vibeKeywords.join(", ") || "Any"}
Energy level (1-10): ${intent.energyRange[0]}–${intent.energyRange[1]}
${eraText}
${includeText}
${excludeText}

TASK:
List ${targetCount} artists whose music fits within the genre/sub-genre boundaries above
and matches the mood/vibe profile. Requirements:
- Use ONLY the genre labels from the canonical taxonomy provided above
- Include both well-known headliners AND deep-cut/underground artists for variety
- Prioritize artists known for HIGH PRODUCTION QUALITY (mixing, mastering, Dolby Atmos mixes)
- Weight towards artists with rich discographies (more tracks = more options)
- For each artist include: name, relevance score (0.0-1.0), genre context (short phrase),
  and what they are known for sonically

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "artists": [
    {
      "name": "Artist Name",
      "relevanceScore": 0.95,
      "genreContext": "deep house pioneer",
      "knownFor": "warm analog production, hypnotic bass lines"
    }
  ]
}`;
}

/**
 * Build a Serper web search query for supplemental artist discovery.
 */
function buildSerperQuery(intent: PlaylistIntent): string {
  const genreStr = intent.subGenres.length > 0 ? intent.subGenres[0] : intent.genres[0] ?? "music";
  const moodStr = intent.moods.slice(0, 2).join(" ");
  const eraStr = intent.eraPreference ? ` ${intent.eraPreference}` : "";
  return `best ${moodStr} ${genreStr}${eraStr} artists music`;
}

/**
 * Parse artist names from Serper search results.
 * Extracts artist names from titles and snippets heuristically.
 */
function parseArtistsFromSerperResults(results: SerperResult[]): string[] {
  const names = new Set<string>();
  for (const r of results) {
    // Look for patterns like "Top 10 [genre] artists" numbered lists in snippets
    const text = `${r.title} ${r.snippet}`;
    // Basic extraction: look for quoted names or capitalized proper noun sequences
    const matches = text.match(/["']([A-Z][a-zA-Z\s&'.-]{2,30})["']/g) ?? [];
    for (const m of matches) {
      const name = m.replace(/['"]/g, "").trim();
      if (name.length > 2 && name.length < 50) names.add(name);
    }
  }
  return Array.from(names).slice(0, 20);
}

interface SerperResult {
  title: string;
  snippet: string;
  link: string;
}

interface PerplexityMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Call Perplexity Sonar API for artist discovery.
 */
async function queryPerplexityForArtists(
  prompt: string,
  apiKey: string
): Promise<DiscoveredArtist[] | null> {
  const messages: PerplexityMessage[] = [
    { role: "user", content: prompt },
  ];

  try {
    const resp = await fetch(PERPLEXITY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "sonar",
        messages,
        max_tokens: 3000,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!resp.ok) {
      console.warn(`[artistDiscovery] Perplexity error: HTTP ${resp.status}`);
      return null;
    }

    const data = await resp.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "";

    // Extract JSON from response (handles markdown fences and citation suffixes)
    const parsed = extractJSON<{ artists: DiscoveredArtist[] }>(content);
    if (!parsed) {
      console.warn("[artistDiscovery] Perplexity: no JSON in response");
      return null;
    }
    return parsed.artists ?? null;
  } catch (err) {
    console.error("[artistDiscovery] Perplexity query failed:", err);
    return null;
  }
}

/**
 * Call Serper for supplemental artist discovery via web search.
 */
async function querySerperForArtists(
  query: string,
  apiKey: string
): Promise<string[]> {
  try {
    const resp = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify({ q: query, num: 10 }),
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "(unreadable)");
      console.warn(`[artistDiscovery] Serper error: HTTP ${resp.status} | query: "${query}" | body: ${body.slice(0, 300)}`);
      return [];
    }

    const data = await resp.json() as { organic: SerperResult[] };
    return parseArtistsFromSerperResults(data.organic ?? []);
  } catch (err) {
    console.warn("[artistDiscovery] Serper query failed:", err);
    return [];
  }
}

/**
 * Call Gemini as fallback for artist discovery.
 */
async function queryGeminiForArtists(
  prompt: string,
  apiKey: string
): Promise<DiscoveredArtist[] | null> {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const parsed = extractJSON<{ artists: DiscoveredArtist[] }>(text);
    if (!parsed) return null;
    return parsed.artists ?? null;
  } catch (err) {
    console.error("[artistDiscovery] Gemini query failed:", err);
    return null;
  }
}

/**
 * Merge Serper artist names into the Perplexity/Gemini result set.
 * Serper artists get a moderate relevance score since they lack context.
 */
function mergeSerperArtists(
  primary: DiscoveredArtist[],
  serperNames: string[],
  intent: PlaylistIntent
): DiscoveredArtist[] {
  const existingNames = new Set(primary.map(a => a.name.toLowerCase()));
  const genreCtx = intent.subGenres[0] ?? intent.genres[0] ?? "genre match";
  const added: DiscoveredArtist[] = [];

  for (const name of serperNames) {
    if (!existingNames.has(name.toLowerCase())) {
      added.push({
        name,
        relevanceScore: 0.6,
        genreContext: genreCtx,
        knownFor: "discovered via web search",
      });
      existingNames.add(name.toLowerCase());
    }
  }

  return [...primary, ...added];
}

/**
 * Main entry point: discover artists matching the playlist intent.
 */
export async function discoverArtists(
  intent: PlaylistIntent,
  config: ArtistDiscoveryConfig,
  targetCount = 50
): Promise<DiscoveredArtists> {
  // ── Check cache ────────────────────────────────────────────
  const cacheKey = buildDiscoveryCacheKey(intent);
  const cached = await getFromCache(cacheKey);
  if (cached) {
    console.log(
      `[artistDiscovery] Cache HIT (${cached.artists.length} artists, ` +
      `strategy: ${cached.searchStrategy})`
    );
    return cached;
  }
  console.log("[artistDiscovery] Cache MISS — querying APIs...");

  const prompt = buildArtistDiscoveryPrompt(intent, targetCount);
  let artists: DiscoveredArtist[] | null = null;
  let strategy = "";

  // 1. Try Perplexity (PRIMARY)
  artists = await queryPerplexityForArtists(prompt, config.perplexityApiKey);
  if (artists && artists.length > 0) {
    strategy = "perplexity";
    console.log(`[artistDiscovery] Perplexity returned ${artists.length} artists`);
  } else {
    // 2. Fallback to Gemini
    console.log("[artistDiscovery] Falling back to Gemini...");
    artists = await queryGeminiForArtists(prompt, config.geminiApiKey);
    if (artists && artists.length > 0) {
      strategy = "gemini";
      console.log(`[artistDiscovery] Gemini returned ${artists.length} artists`);
    } else {
      console.error("[artistDiscovery] Both Perplexity and Gemini failed");
      artists = [];
      strategy = "none";
    }
  }

  // 3. Serper supplemental (if API key provided)
  if (config.serperApiKey) {
    const serperQuery = buildSerperQuery(intent);
    const serperNames = await querySerperForArtists(serperQuery, config.serperApiKey);
    if (serperNames.length > 0) {
      artists = mergeSerperArtists(artists, serperNames, intent);
      strategy += "+serper";
      console.log(`[artistDiscovery] Serper added ${serperNames.length} additional artists`);
    }
  }

  // Sort by relevance score descending
  artists.sort((a, b) => b.relevanceScore - a.relevanceScore);

  const result: DiscoveredArtists = { artists, searchStrategy: strategy };

  // Write to cache (fire-and-forget)
  writeToCache(cacheKey, result, intent.description).catch(() => {});

  return result;
}

/**
 * Expand the artist pool when the initial DB match is thin.
 * Asks for artists SIMILAR TO those already discovered.
 */
export async function expandArtistDiscovery(
  intent: PlaylistIntent,
  existingArtists: DiscoveredArtist[],
  config: ArtistDiscoveryConfig,
  additionalCount = 30
): Promise<DiscoveredArtists> {
  const topArtistNames = existingArtists.slice(0, 10).map(a => a.name).join(", ");
  const taxonomyContext = buildTaxonomyPromptContext(intent.genres, intent.moods);
  const referenceContext = intent.referenceQuality
    ? buildReferencePromptFragment(intent.genres)
    : "";

  const expansionPrompt = `${taxonomyContext}

${referenceContext}EXISTING ARTISTS ALREADY DISCOVERED (DO NOT REPEAT THESE):
${topArtistNames}

LISTENER REQUEST:
${intent.description}
Genres: ${intent.genres.join(", ")}
Moods: ${intent.moods.join(", ")}

TASK:
Find ${additionalCount} MORE artists that are similar to the existing artists listed above
but have NOT been listed yet. Focus on:
- Artists in adjacent sub-genres within the same genre cluster
- Deeper cuts and less well-known artists that fit the vibe
- Artists from the same era/scene as the existing list
- Artists with large discographies (more tracks = more options)

Return ONLY valid JSON:
{
  "artists": [
    {
      "name": "Artist Name",
      "relevanceScore": 0.80,
      "genreContext": "similar to [existing artist]",
      "knownFor": "key sonic characteristics"
    }
  ]
}`;

  const newArtists = await queryPerplexityForArtists(expansionPrompt, config.perplexityApiKey)
    ?? await queryGeminiForArtists(expansionPrompt, config.geminiApiKey)
    ?? [];

  const existingNames = new Set(existingArtists.map(a => a.name.toLowerCase()));
  const filtered = newArtists.filter(a => !existingNames.has(a.name.toLowerCase()));

  console.log(`[artistDiscovery] Expansion returned ${filtered.length} new artists`);

  return {
    artists: filtered,
    searchStrategy: "expansion",
  };
}
ATMOSIFY_EOF_4

# ─── File 5/5: firestore.rules ──────────────────────────────────────────────
echo "[5/5] Writing firestore.rules..."
cat > firestore.rules << 'ATMOSIFY_EOF_5'
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Shared playlists: anyone can read (public share links), only backend writes
    match /sharedPlaylists/{shareId} {
      allow read: if true;
      allow write: if false;
    }

    // Rate limits: backend only
    match /rateLimits/{doc} {
      allow read, write: if false;
    }

    // Discovery cache: backend only (Cloud Functions via Admin SDK)
    match /discoveryCache/{docId} {
      allow read, write: if false;
    }

    // Default: deny all
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
ATMOSIFY_EOF_5

echo ""
echo "=== All 5 files written successfully ==="
echo ""
echo "Files updated:"
echo "  [MODIFIED] src/logic/trackEnricher.ts     (Opts 1+2: Gemini primary + parallel workers)"
echo "  [NEW]      src/logic/candidateScorer.ts    (Opt 3: pre-enrichment scoring)"
echo "  [MODIFIED] src/logic/orchestrator.ts       (Opt 3: pre-score before enrich)"
echo "  [MODIFIED] src/logic/artistDiscovery.ts    (Opt 4: discovery cache)"
echo "  [MODIFIED] firestore.rules                 (Opt 4: discoveryCache rule)"
echo ""
echo "Next: run 'npm run build:functions' to compile, then deploy."
