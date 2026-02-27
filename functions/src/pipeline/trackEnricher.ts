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
const GEMINI_MODEL = "gemini-2.5-flash";
const CACHE_TTL_DAYS = 30;
const BATCH_SIZE = 12; // tracks per Perplexity/Gemini call

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

  // Process each artist's tracks in batches
  for (const [artist, tracks] of byArtist) {
    for (let i = 0; i < tracks.length; i += BATCH_SIZE) {
      const batchTracks = tracks.slice(i, i + BATCH_SIZE);
      const batchInput = batchTracks.map((t, idx) => ({
        index: idx,
        title: t.track_Title,
        album: t.album,
      }));

      const prompt = buildEnrichmentPrompt(artist, batchInput, intent);

      // Try Perplexity first, then Gemini
      let enrichments = await enrichWithPerplexity(prompt, config.perplexityApiKey);
      let source = "perplexity";

      if (!enrichments || enrichments.length === 0) {
        enrichments = await enrichWithGemini(prompt, config.geminiApiKey);
        source = "gemini";
      }

      if (enrichments && enrichments.length > 0) {
        await applyEnrichment(db, batchTracks, enrichments, source);
        freshlyEnriched += enrichments.length;
      } else {
        // Apply defaults for failed tracks so pipeline can continue
        for (const track of batchTracks) {
          track.atmos_mood = "unknown";
          track.atmos_energy = 5;
          track.atmos_vibe = [];
        }
        failed += batchTracks.length;
        console.warn(`[trackEnricher] Enrichment failed for artist: ${artist}`);
      }
    }
  }

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
