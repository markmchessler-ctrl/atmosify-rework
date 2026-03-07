// src/pipeline/trackEnricher.ts
// Stage 4: Enrich each track candidate with mood/energy/vibe metadata.
//
// Uses Perplexity (primary) or Gemini (fallback) to classify per-track affect.
// Caches results to Firestore under atmos_ prefix fields (30-day TTL).
// Cache-first: tracks enriched within 30 days are skipped.

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Firestore, Timestamp } from "firebase-admin/firestore";
import type { TrackCandidate, PlaylistIntent } from "../lib/types.js";

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";
const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";
const CACHE_TTL_DAYS = 30;
const BATCH_SIZE = 12; // tracks per Perplexity/Gemini call

interface EnrichmentConfig {
  perplexityApiKey: string;
  geminiApiKey: string;
}

interface TrackEnrichment {
  index: number;    // position in the batch
  mood: string;
  energy: number;   // 1-10
  vibe: string[];   // e.g. ["atmospheric", "hypnotic", "bass-heavy"]
  tempoEstimate: number; // BPM estimate
  keyEstimate: string | null; // Camelot notation e.g. "8B", "3A"
}

interface FirestoreEnrichmentFields {
  atmos_mood?: string;
  atmos_energy?: number;
  atmos_vibe?: string[];
  atmos_tempo_estimate?: number;
  atmos_key_estimate?: string;
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
- keyEstimate: Camelot wheel notation (1A-12A for minor keys, 1B-12B for major keys).
  Mapping: C/Am=8A/8B, G/Em=9A/9B, D/Bm=10A/10B, A/F#m=11A/11B, E/C#m=12A/12B,
  B/G#m=1A/1B, F#/D#m=2A/2B, Db/Bbm=3A/3B, Ab/Fm=4A/4B, Eb/Cm=5A/5B,
  Bb/Gm=6A/6B, F/Dm=7A/7B. Use null if truly unknown.

Context: The listener wants ${intent.description}
Desired mood: ${intent.moods.join(", ")}
Desired energy range: ${intent.energyRange[0]}-${intent.energyRange[1]}/10

Tracks:
${trackList}

Return ONLY valid JSON, no markdown:
[
  {"index": 0, "mood": "...", "energy": 5, "vibe": ["...", "..."], "tempoEstimate": 95, "keyEstimate": "8B"},
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
    if (enrichment.keyEstimate) track.atmos_key_estimate = enrichment.keyEstimate;

    // Write to Firestore cache
    const fields: FirestoreEnrichmentFields = {
      atmos_mood: enrichment.mood,
      atmos_energy: enrichment.energy,
      atmos_vibe: enrichment.vibe,
      atmos_tempo_estimate: enrichment.tempoEstimate,
      atmos_enriched_at: now,
      atmos_enriched_by: source,
    };
    if (enrichment.keyEstimate) fields.atmos_key_estimate = enrichment.keyEstimate;

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
    const refs = batch.map(t => db.collection("tracks").doc(t.docId));
    const snaps = await db.getAll(...refs);

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
        if (data.atmos_key_estimate) track.atmos_key_estimate = data.atmos_key_estimate;
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

  // -- Concurrent batch executor ---------------------------------
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

      // Gemini Flash is primary (classification task -- no web search needed)
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
          track.enrichment_failed = true;
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
