# Atmosify — Technical Handoff & Optimization Plan

## Table of Contents
1. [Current Infrastructure](#1-current-infrastructure)
2. [Project Structure](#2-project-structure)
3. [Pipeline Architecture](#3-pipeline-architecture)
4. [Stage-by-Stage Breakdown](#4-stage-by-stage-breakdown)
5. [Current Performance Profile](#5-current-performance-profile)
6. [Optimization 1: Enrich Only Top Candidates](#6-optimization-1-enrich-only-top-candidates)
7. [Optimization 2: Parallelize Enrichment Batches](#7-optimization-2-parallelize-enrichment-batches)
8. [Optimization 4: Cache Artist Discovery Results](#8-optimization-4-cache-artist-discovery-results)
9. [Implementation Order & Dependencies](#9-implementation-order--dependencies)

---

## 1. Current Infrastructure

### Firebase Project
- **Project ID:** `studio-8193119013-d66e8`
- **Hosting URL:** `https://studio-8193119013-d66e8.web.app`
- **Environment:** Firebase Studio (cloud IDE)
- **Runtime:** Node.js 22 (2nd Gen Cloud Functions)
- **Region:** `us-central1`

### Services Used
| Service | Purpose |
|---------|---------|
| Cloud Functions v2 | 3 functions: `runAtmosify`, `getAppleMusicDevToken`, `sharePlaylist` |
| Firestore (nextn) | Rate limits, shared playlists, enrichment cache |
| Firestore (atmos-master-db) | Cross-project: 103k-track music database |
| Firebase Hosting | Static Next.js 16 export |
| Firebase Auth | Google Sign-In with email allowlist |
| Secret Manager | API keys (Gemini, Perplexity, Serper, Apple Music, service account) |

### External APIs
| API | Used In | Cost Model |
|-----|---------|------------|
| Perplexity Sonar | Artist Discovery, Track Enrichment | Per-request pricing |
| Gemini 2.5 Flash | Clarify, Artist Discovery (fallback), Track Enrichment (fallback), Curator | Per-token (very cheap at Flash tier) |
| Serper | Artist Discovery (supplemental) | ~$0.001/search |
| Apple Music API | Verifier, Assembler | Free (rate-limited) |

### Secrets (in Firebase Secret Manager)
```
GEMINI_API_KEY
PERPLEXITY_API_KEY
SERPER_API_KEY
APPLE_TEAM_ID
APPLE_KEY_ID
APPLE_PRIVATE_KEY
ATMOS_DB_SERVICE_ACCOUNT    # JSON service account for cross-project Firestore
```

---

## 2. Project Structure

The Firebase Studio project lives at `~/atmosify/`. The functions source is the **project root** (not a `functions/` subdirectory).

```
~/atmosify/
├── firebase.json              # source: ".", predeploy: ["npm run build:functions"]
├── package.json               # esbuild src/index.ts → lib/index.js
├── firestore.rules
├── src/
│   ├── index.ts               # ★ FUNCTIONS ENTRY POINT (esbuild builds this)
│   ├── lib/
│   │   ├── appleMusic.ts      # Apple Music JWT + batch lookup
│   │   ├── atmosDb.ts         # Cross-project Firestore singleton
│   │   ├── rateLimit.ts       # Firestore-based rate limiter
│   │   ├── types.ts           # All shared TypeScript interfaces
│   │   ├── genreTaxonomy.ts   # Genre taxonomy for prompts
│   │   └── taxonomy.ts
│   ├── logic/                  # ★ Pipeline stages (NOT "pipeline/")
│   │   ├── orchestrator.ts    # Main pipeline coordinator
│   │   ├── clarify.ts         # Stage 1
│   │   ├── artistDiscovery.ts # Stage 2
│   │   ├── dbMatcher.ts       # Stage 3
│   │   ├── trackEnricher.ts   # Stage 4  ← BOTTLENECK
│   │   ├── curator.ts         # Stage 5
│   │   ├── verifier.ts        # Stage 6
│   │   ├── assembler.ts       # Stage 7
│   │   └── genreMap.ts
│   ├── services/
│   │   └── auth.ts            # Legacy secret definitions (unused by new pipeline)
│   └── ai/                    # Legacy Genkit AI flows (unused by new pipeline)
├── lib/
│   └── index.js               # ★ COMPILED OUTPUT (esbuild bundle, DO NOT EDIT)
├── app/                       # Next.js 16 frontend
│   ├── page.tsx               # Main app (wrapped in AuthGate)
│   ├── share/page.tsx         # Public share page
│   ├── layout.tsx             # Root layout with PWA manifest + SW
│   ├── globals.css            # Styles including mobile responsive
│   ├── lib/
│   │   ├── firebase.ts        # Firebase client SDK init
│   │   └── auth.ts            # Firebase Auth helpers
│   └── components/
│       ├── PlaylistResults.tsx # Track list + ShareButton
│       ├── SaveToAppleMusic.tsx
│       └── AuthGate.tsx       # Google Sign-In gate + email allowlist
├── public/
│   ├── manifest.json          # PWA manifest
│   ├── sw.js                  # Service worker
│   └── icons/
└── out/                       # Static export (deployed to Hosting)
```

### Critical Build Details
- **Build command:** `esbuild src/index.ts --bundle --platform=node --target=node22 --outfile=lib/index.js --external:firebase-functions --external:firebase-admin --external:@google-cloud/firestore --external:@genkit-ai/google-genai --external:genkit`
- **Predeploy hook** in `firebase.json` runs `npm run build:functions` automatically
- **Frontend build:** `next build` outputs static HTML to `out/`
- **Import paths in `src/index.ts` use `./logic/` NOT `./pipeline/`** — this caused a multi-session debugging saga

---

## 3. Pipeline Architecture

```
User Prompt
    │
    ▼
[1] Clarify (Gemini)          1-3s    Parse intent → PlaylistIntent
    │
    ▼
[2] Artist Discovery           3-6s    Perplexity → 50 artist names
    │  (Perplexity + Serper)           Serper adds supplemental names
    │                                  Gemini fallback if Perplexity fails
    ▼
[3] DB Matcher                 2-4s    Firestore queries (10 parallel)
    │  (Firestore)                     Exact → prefix → normalized search
    │                                  Returns ~100-300 TrackCandidates
    ▼
[4] Track Enricher           15-85s  ★ BOTTLENECK
    │  (Perplexity/Gemini)             Batches of 12, sequential per artist
    │  (Firestore cache)               30-day cache in Firestore (atmos_ fields)
    ▼
[5] Curator (Gemini)           3-8s    AI selects + sequences best tracks
    │                                  Requests 1.4x target for buffer
    ▼
[6] Verifier                   1-3s    Apple Music batch lookup (300/call)
    │  (Apple Music API)               Confirms Atmos, gets real durations
    ▼
[7] Assembler                  0-3s    Gap-fill from unused candidates
    │                                  Final formatting + metadata
    ▼
AtmosPlaylist Response

Expansion Loop: If Stage 3 returns fewer than targetCount × 2 candidates,
Stages 2-3 repeat up to 2 times with expanded artist discovery.
```

---

## 4. Stage-by-Stage Breakdown

### Stage 1: Clarify (`src/logic/clarify.ts`)
- **Input:** Raw user prompt string
- **Output:** `PlaylistIntent` (structured genres, moods, energy, duration, etc.)
- **API calls:** 1 Gemini 2.5 Flash (JSON mode, temperature 0.1)
- **Caching:** None
- **Time:** 1-3s
- **Cost:** <$0.001

### Stage 2: Artist Discovery (`src/logic/artistDiscovery.ts`)
- **Input:** `PlaylistIntent`
- **Output:** `DiscoveredArtists` (array of `{name, relevanceScore, genreContext, knownFor}`)
- **API calls:**
  - 1 Perplexity Sonar (primary, 45s timeout, temp 0.2, max 3000 tokens)
  - 1 Serper web search (supplemental, 10s timeout, top 10 results)
  - 1 Gemini Flash (fallback only if Perplexity fails)
- **Call pattern:** Sequential — Perplexity first, THEN Serper after Perplexity completes
- **Caching:** None — every request re-discovers artists from scratch
- **Time:** 3-6s (happy path), 5-10s (fallback)
- **Cost:** ~$0.01 per request
- **Expansion:** `expandArtistDiscovery()` makes 1 additional Perplexity call asking for 30 similar artists. Called up to 2x by orchestrator.

### Stage 3: DB Matcher (`src/logic/dbMatcher.ts`)
- **Input:** `DiscoveredArtists` + Firestore reference
- **Output:** `TrackCandidate[]` (deduplicated, sorted by relevance)
- **API calls:** Firestore queries only (cross-project to `atmos-master-db`)
- **Query strategy per artist (short-circuits on first hit):**
  1. Exact: `Artist == "name"` (limit 50)
  2. Prefix: `Artist >= "name"` AND `Artist <= "name\uf8ff"` (limit 50)
  3. Normalized: strip "The " prefix, re-query (limit 50)
- **Parallelism:** Batches of 10 artists via `Promise.all`, 100ms pause between batches
- **Filters:** Skips tracks without `Apple_Music_ID`, skips tracks with `am_verification_failed_at` within 7 days
- **Caching:** None (relies on Firestore's built-in caching)
- **Time:** 2-4s for 50 artists
- **Cost:** 500-2,500 Firestore document reads (~$0.002)

### Stage 4: Track Enricher (`src/logic/trackEnricher.ts`) — THE BOTTLENECK
- **Input:** `TrackCandidate[]` + `PlaylistIntent`
- **Output:** Same array with `atmos_mood`, `atmos_energy`, `atmos_vibe`, `atmos_tempo_estimate` populated
- **Process:**
  1. **In-memory check:** If `atmos_mood` + `atmos_energy` + `atmos_vibe` already present → cache hit
  2. **Firestore freshness check:** For tracks without in-memory enrichment, re-reads docs in batches of 50 to check `atmos_enriched_at` timestamp (30-day TTL)
  3. **Group truly stale tracks by artist**
  4. **For each artist's tracks, process in batches of 12:**
     - Try Perplexity Sonar (30s timeout, temp 0.1, max 2000 tokens)
     - Fallback to Gemini Flash (JSON mode, temp 0.1)
     - If both fail, apply defaults (mood: "unknown", energy: 5, vibe: [])
  5. **Write enrichments to Firestore** (fire-and-forget, merge writes)
- **Call pattern:** Sequential per artist, sequential per batch within artist
- **Caching:** 30-day TTL in Firestore under `atmos_` prefix fields
- **Time:**
  - Cache-warm: 2-4s (just freshness checks)
  - Cache-cold, 200 tracks: ~17 Perplexity calls × 3-5s each = **50-85s**
  - 50% cache hit: 25-45s
- **Cost:** 5-17 Perplexity calls on cold cache ($0.03-0.20+)
- **Known inefficiency:** Enriches ALL ~200 candidates, not just the ~45 that will likely be selected

### Stage 5: Curator (`src/logic/curator.ts`)
- **Input:** Enriched `TrackCandidate[]` + `PlaylistIntent`
- **Output:** `PlaylistDraft` (ordered tracks + unused candidates for gap-fill)
- **API calls:** 1 Gemini Flash (max 32768 output tokens, temp 0.3)
- **Prompt size:** Up to 200 candidates formatted at ~100 chars each = 5-8k input tokens
- **Fallback:** Rule-based selection (sort by relevance + quality, enforce artist diversity: max 3 per artist, 5 for preferred)
- **Requests 1.4x target** to absorb verification drops
- **Time:** 3-8s
- **Cost:** ~$0.002

### Stage 6: Verifier (`src/logic/verifier.ts`)
- **Input:** `PlaylistDraft` tracks
- **Output:** `VerifiedTrack[]` with real durations and Atmos confirmation
- **API calls:** Apple Music batch lookup (up to 300 IDs per call, `?extend=audioVariants`)
- **Write-backs:** Fire-and-forget Firestore writes for durations and failure timestamps
- **Time:** 1-3s
- **Cost:** Negligible (Apple Music API is free, ~20 Firestore writes)

### Stage 7: Assembler (`src/logic/assembler.ts`)
- **Input:** Verified tracks + unused candidates + intent
- **Output:** Final `AtmosPlaylist`
- **Gap-fill:** If verified < 60% of target, takes `needed × 3` unused candidates through verification
- **Time:** 0-3s (near-instant if no gap-fill needed)
- **Cost:** 0-1 Apple Music calls

---

## 5. Performance Profile

### Before Optimizations
| Stage | Time | API Calls | Cost |
|-------|------|-----------|------|
| 1. Clarify | 1-3s | 1 Gemini | <$0.001 |
| 2. Discover | 3-6s | 1 Perplexity + 1 Serper | ~$0.01 |
| 3. Match | 2-4s | Firestore only | ~$0.002 |
| 4. Enrich | 15-40s | 5-10 Perplexity (sequential) | $0.03-0.10 |
| 5. Curate | 3-8s | 1 Gemini | ~$0.002 |
| 6. Verify | 1-3s | 1 Apple Music | ~$0.001 |
| 7. Assemble | 0-3s | 0-1 Apple Music | ~$0.001 |
| **Total** | **25-67s** | **9-15 calls** | **$0.05-0.12** |

### After Optimizations (4 changes implemented)
| Stage | Time | API Calls | Cost |
|-------|------|-----------|------|
| 1. Clarify | 1-3s | 1 Gemini | <$0.001 |
| 2. Discover | **<0.5s** (cache hit) / 3-6s (miss) | 0 (hit) / 1 Perplexity + 1 Serper (miss) | ~$0.00001 (hit) / ~$0.01 (miss) |
| 3. Match | 2-4s | Firestore only | ~$0.002 |
| 3.5 Pre-score | **<0.1s** | None (in-memory) | $0 |
| 4. Enrich | **2-5s** | **1-4 Gemini Flash** (4× parallel) | **<$0.002** |
| 5. Curate | 3-8s | 1 Gemini | ~$0.002 |
| 6. Verify | 1-3s | 1 Apple Music | ~$0.001 |
| 7. Assemble | 0-3s | 0-1 Apple Music | ~$0.001 |
| **Total** | **5-15s** | **4-8 calls** | **<$0.01** |

### What Changed
1. **Gemini Flash is now PRIMARY for enrichment** — Perplexity demoted to fallback (classification task doesn't need web search, ~10x cheaper)
2. **Enrichment batches run in parallel** — 4 concurrent workers instead of sequential (4x faster)
3. **Only top ~45 candidates enriched** — pre-scored by artistRelevance + FINAL_SCORE instead of all ~200 (75% fewer API calls)
4. **Artist discovery results cached** — 1-hour TTL in Firestore, saves 3-6s on repeat/similar queries

---

## 6. Implemented Optimizations (4 changes)

All optimizations have been applied to the source files in `~/atmosify-rework/functions/src/`.

### Opt 1: Gemini Flash as Primary Enricher
**File:** `functions/src/pipeline/trackEnricher.ts`

Swapped Gemini 2.5 Flash to PRIMARY for track enrichment, Perplexity demoted to fallback. Track enrichment is a classification task (mood, energy, vibe, BPM) — Perplexity's web-search adds no value here. Gemini Flash is ~10x cheaper per call.

### Opt 2: Parallel Enrichment Batches
**File:** `functions/src/pipeline/trackEnricher.ts`

Replaced sequential nested `for` loops with a concurrent worker pool (`CONCURRENCY = 4`). Jobs are flattened into a queue; 4 workers pull from it via shared `jobIndex` (safe in Node.js single-threaded event loop). Each worker independently runs Gemini→Perplexity fallback. `applyEnrichment()` concurrent Firestore writes are safe (unique docIds).

### Opt 3: Pre-Enrichment Candidate Scoring
**Files:** `functions/src/pipeline/candidateScorer.ts` (NEW), `functions/src/pipeline/orchestrator.ts`

Added `scoreAndRank()` between Stage 3 and Stage 4. Scores candidates using fields already available from DB Matcher:
- `artistRelevance` (0-1) → 50 points
- `FINAL_SCORE` (0-100) → 30 points
- Already enriched (cache hit) → +15 bonus
- `am_duration_ms` present → +5 bonus

Only the top `targetCount × 3` candidates (~45) are enriched instead of all ~200. Already-enriched candidates are always included (free). Deferred candidates are still passed to the assembler as gap-fill pool.

### Opt 4: Artist Discovery Cache
**Files:** `functions/src/pipeline/artistDiscovery.ts`, `firestore.rules`

Added Firestore-backed cache for `discoverArtists()` with 1-hour TTL. Cache key is a SHA-256 hash (16 chars) of the intent's discovery-relevant fields (genres, subGenres, moods, vibeKeywords, energyRange, eraPreference, artistPreferences, excludeArtists, referenceQuality — all sorted for determinism). Cache miss writes fire-and-forget. Firestore rules deny client access (Admin SDK only).

### Former bottleneck analysis (now resolved)
The enricher previously processed every candidate returned by the DB matcher (~100-300 tracks). The curator only selects ~20. This meant 80-90% of enrichment API calls were wasted.

---

## 7. Testing Strategy

### Log Signatures to Verify
```
Opt 1: enriched by "gemini" (not "perplexity") in trackEnricher logs
Opt 2: "[trackEnricher] Processing N batches (4 concurrent)"
Opt 3: "[orchestrator] Pre-scoring: N candidates, enriching top M, deferring D"
Opt 4: "[artistDiscovery] Cache HIT" or "[artistDiscovery] Cache MISS"
```

### Test Cases
1. **Cold-cache request** (new genre): full pipeline runs, all stages execute
2. **Warm-cache request** (repeat same prompt): discovery cache hit, enrichment cache hits
3. **Niche request** (e.g., "Ethiopian jazz fusion"): expansion loops still trigger
4. **Timing**: `[orchestrator] Pipeline complete in XXXms` — expect 5-15s typical

### Combined Impact
| Metric | Before | After |
|--------|--------|-------|
| Total time (cold cache) | 25-67s | **5-15s** |
| Total time (warm cache) | 25-67s | **3-10s** |
| Perplexity calls | 6-17 | **1-2** (discovery only) |
| Gemini calls (enrichment) | 0-5 (fallback) | **1-4** (primary) |
| Cost per request | $0.05-0.12 | **<$0.01** |
| Worst case time | 90-180s | **15-30s** |

### Files Changed
| Action | File Path |
|--------|-----------|
| MODIFY | `functions/src/pipeline/trackEnricher.ts` |
| CREATE | `functions/src/pipeline/candidateScorer.ts` |
| MODIFY | `functions/src/pipeline/orchestrator.ts` |
| MODIFY | `functions/src/pipeline/artistDiscovery.ts` |
| MODIFY | `firestore.rules` |

---

## (Legacy) Original Optimization Proposals

> The following sections document the original proposals before implementation.
> They are preserved for reference but the optimizations have been applied
> to the source files. See Section 6 for the implemented summary.

### Original Solution
Pre-score candidates before enrichment using metadata already available, then enrich only the top `targetCount × 3` candidates. Move cache warming to an asynchronous background job.

### Implementation

#### Step 1: Add a scoring function (`src/logic/candidateScorer.ts`)

Create a new file that scores candidates using already-available fields:

```typescript
// src/logic/candidateScorer.ts

import type { TrackCandidate, PlaylistIntent } from "../lib/types.js";

interface ScoredCandidate extends TrackCandidate {
  preEnrichmentScore: number;
}

/**
 * Score candidates using metadata available BEFORE enrichment.
 * Used to select which candidates are worth the cost of an API call.
 *
 * Scoring factors (all available from DB Matcher output):
 *   - artistRelevance (0-1): from artist discovery, how well the artist matches
 *   - FINAL_SCORE (0-100): pre-existing quality score in the Atmos DB
 *   - Has existing enrichment (atmos_mood present): cache hit = free to include
 *   - am_duration_ms present: indicates verified Apple Music track
 */
export function scoreAndRank(
  candidates: TrackCandidate[],
  intent: PlaylistIntent,
  maxToEnrich: number
): { toEnrich: TrackCandidate[]; deferred: TrackCandidate[] } {
  const scored: ScoredCandidate[] = candidates.map(c => {
    let score = 0;

    // Artist relevance is the strongest signal (0-1, scale to 0-50)
    score += (c.artistRelevance ?? 0) * 50;

    // FINAL_SCORE from the research engine (0-100, scale to 0-30)
    score += ((c.FINAL_SCORE ?? 0) / 100) * 30;

    // Bonus for tracks that already have enrichment (cache hits are free)
    if (c.atmos_mood && c.atmos_energy) score += 15;

    // Bonus for tracks with verified Apple Music duration
    if (c.am_duration_ms) score += 5;

    return { ...c, preEnrichmentScore: score };
  });

  // Sort descending by score
  scored.sort((a, b) => b.preEnrichmentScore - a.preEnrichmentScore);

  // Always include cache hits (they're free) + top N scorers
  const alreadyEnriched = scored.filter(c => c.atmos_mood && c.atmos_energy);
  const needsEnrichment = scored.filter(c => !c.atmos_mood || !c.atmos_energy);

  const enrichBudget = Math.max(0, maxToEnrich - alreadyEnriched.length);
  const toEnrich = [
    ...alreadyEnriched,
    ...needsEnrichment.slice(0, enrichBudget),
  ];
  const deferred = needsEnrichment.slice(enrichBudget);

  return { toEnrich, deferred };
}
```

#### Step 2: Modify the orchestrator (`src/logic/orchestrator.ts`)

In the orchestrator, between Stage 3 and Stage 4, add the scoring step:

```typescript
// After Stage 3 (DB Matcher), before Stage 4 (Enricher):

import { scoreAndRank } from "./candidateScorer.js";

// ... inside runPipeline(), after candidates are assembled:

// ── Pre-enrichment scoring ──────────────────────────────────────
const targetCount = intent.targetTrackCount
  ?? Math.max(10, Math.round((intent.targetDurationMinutes * 60_000) / 240_000));
const enrichBudget = targetCount * 3; // Enrich 3x what we need

console.log(
  `[orchestrator] Pre-scoring: ${candidates.length} candidates, ` +
  `enriching top ${enrichBudget}`
);

const { toEnrich, deferred } = scoreAndRank(candidates, intent, enrichBudget);

// ── Stage 4: TrackEnricher (only top candidates) ────────────────
console.log(`[orchestrator] Stage 4: TrackEnricher (${toEnrich.length} of ${candidates.length})`);
const enricherResult = await enrichTracks(db, toEnrich, intent, {
  perplexityApiKey: config.perplexityApiKey,
  geminiApiKey: config.geminiApiKey,
});
```

#### Step 3 (Optional): Background cache warming

Create a scheduled Cloud Function that warms enrichment for deferred candidates:

```typescript
// In src/index.ts, add:

import { onSchedule } from "firebase-functions/v2/scheduler";

export const warmEnrichmentCache = onSchedule(
  {
    schedule: "every 6 hours",
    memory: "512MiB",
    timeoutSeconds: 300,
    secrets: [PERPLEXITY_API_KEY, GEMINI_API_KEY, ATMOS_DB_SERVICE_ACCOUNT],
  },
  async () => {
    // Query tracks that have Apple_Music_ID but no atmos_enriched_at
    // Process in batches, enriching up to 200 per run
    // This fills the cache gradually without blocking user requests
  }
);
```

### Expected Impact
| Metric | Before | After |
|--------|--------|-------|
| Tracks enriched per request | ~200 | ~45 |
| Perplexity calls (cold cache) | ~17 | ~4 |
| Enrichment time (cold cache) | 50-85s | 12-20s |
| Enrichment cost per request | $0.03-0.20 | $0.01-0.05 |
| Quality impact | None | None (curator only picks ~20 anyway) |

---

## 7. Optimization 2: Parallelize Enrichment Batches

### Problem
The enricher processes artist batches sequentially. For each artist, batches of 12 tracks are sent to Perplexity one at a time. If 4 artists each have 12 tracks, that's 4 sequential API calls taking 3-5s each = 12-20s total.

### Current Code (in `trackEnricher.ts`)
```typescript
// Current: sequential processing
for (const [artist, tracks] of byArtist) {
  for (let i = 0; i < tracks.length; i += BATCH_SIZE) {
    const batchTracks = tracks.slice(i, i + BATCH_SIZE);
    // ... build prompt ...
    let enrichments = await enrichWithPerplexity(prompt, config.perplexityApiKey);
    // ↑ BLOCKS until this completes before starting next batch
  }
}
```

### Solution
Replace the nested sequential loops with a concurrent batch executor that processes up to N Perplexity calls simultaneously.

### Implementation

#### Replace the processing loop in `enrichTracks()` (`src/logic/trackEnricher.ts`)

Replace the `// Process each artist's tracks in batches` section with:

```typescript
// ── Concurrent batch executor ─────────────────────────────────
const CONCURRENCY = 4; // max simultaneous Perplexity/Gemini calls

// Flatten all batches into a work queue
interface EnrichmentJob {
  artist: string;
  batchTracks: TrackCandidate[];
}

const jobs: EnrichmentJob[] = [];
for (const [artist, tracks] of byArtist) {
  for (let i = 0; i < tracks.length; i += BATCH_SIZE) {
    jobs.push({
      artist,
      batchTracks: tracks.slice(i, i + BATCH_SIZE),
    });
  }
}

console.log(
  `[trackEnricher] Processing ${jobs.length} batches ` +
  `(${CONCURRENCY} concurrent)`
);

// Process jobs with concurrency limit
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

    let enrichments = await enrichWithPerplexity(prompt, config.perplexityApiKey);
    let source = "perplexity";

    if (!enrichments || enrichments.length === 0) {
      enrichments = await enrichWithGemini(prompt, config.geminiApiKey);
      source = "gemini";
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
      console.warn(`[trackEnricher] Enrichment failed for: ${job.artist}`);
    }
  }
}

// Launch N concurrent workers
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => processNextJob())
);
```

### Key Design Decisions
- **`CONCURRENCY = 4`** — Perplexity rate limits are generous but 4 is a safe starting point. Can increase to 6-8 after testing.
- **Shared `jobIndex` counter** — Workers pull from the same queue, ensuring even distribution regardless of per-job latency.
- **No change to caching logic** — `applyEnrichment()` still writes to Firestore; concurrent writes are safe because each track has a unique `docId`.
- **Perplexity → Gemini fallback preserved** — Each worker independently tries Perplexity first, then falls back.

### Expected Impact
| Metric | Before (Sequential) | After (4× Parallel) |
|--------|---------------------|----------------------|
| 4 batches × 5s each | 20s | 5s |
| 8 batches × 5s each | 40s | 10s |
| 17 batches × 5s each | 85s | ~22s |
| API calls | Same | Same (just faster) |
| Cost | Same | Same |

### Combined with Optimization 1
If we first reduce candidates from ~200 to ~45 (Opt 1), then parallelize the remaining ~4 batches (Opt 2):
- **Before both:** 50-85s enrichment
- **After both:** 3-8s enrichment (a 10-20x improvement)

---

## 8. Optimization 4: Cache Artist Discovery Results

### Problem
Every pipeline request makes a fresh Perplexity call for artist discovery, even when the user asks for the same genre/mood combination as a previous request. "Chill late-night jazz" always triggers a new $0.01 Perplexity call and 3-6 seconds of latency.

### Solution
Cache artist discovery results in Firestore, keyed on a normalized hash of the `PlaylistIntent`'s core fields. Use a 1-hour TTL to balance freshness with cost savings.

### Implementation

#### Step 1: Add a hash function and cache logic to `artistDiscovery.ts`

Add these at the top of the file:

```typescript
import { getFirestore } from "firebase-admin/firestore";
import { createHash } from "crypto";

const DISCOVERY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const DISCOVERY_CACHE_COLLECTION = "discoveryCache";

/**
 * Build a deterministic cache key from the parts of the intent
 * that affect artist selection.
 */
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

  const hash = createHash("sha256")
    .update(JSON.stringify(keyParts))
    .digest("hex")
    .slice(0, 16); // 16 chars is plenty for uniqueness

  return `discovery_${hash}`;
}

interface CachedDiscovery {
  artists: DiscoveredArtist[];
  searchStrategy: string;
  cachedAt: number;
  intentDescription: string; // for debugging
}

async function getFromCache(
  cacheKey: string
): Promise<DiscoveredArtists | null> {
  try {
    const db = getFirestore(); // default (nextn) project
    const doc = await db
      .collection(DISCOVERY_CACHE_COLLECTION)
      .doc(cacheKey)
      .get();

    if (!doc.exists) return null;

    const data = doc.data() as CachedDiscovery;
    const age = Date.now() - data.cachedAt;

    if (age > DISCOVERY_CACHE_TTL_MS) {
      return null; // expired
    }

    return {
      artists: data.artists,
      searchStrategy: data.searchStrategy + "+cached",
    };
  } catch {
    return null; // cache miss on error
  }
}

async function writeToCache(
  cacheKey: string,
  result: DiscoveredArtists,
  intentDescription: string
): Promise<void> {
  try {
    const db = getFirestore();
    await db
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
```

#### Step 2: Modify `discoverArtists()` to check cache first

Wrap the existing function body:

```typescript
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

  // ── Existing discovery logic (unchanged) ───────────────────
  const prompt = buildArtistDiscoveryPrompt(intent, targetCount);
  let artists: DiscoveredArtist[] | null = null;
  let strategy = "";

  // ... (existing Perplexity → Gemini → Serper logic stays the same) ...

  const result: DiscoveredArtists = { artists, searchStrategy: strategy };

  // ── Write to cache (fire-and-forget) ───────────────────────
  writeToCache(cacheKey, result, intent.description).catch(() => {});

  return result;
}
```

#### Step 3: Update Firestore rules

Add read/write rules for the cache collection (admin-only write, since only Cloud Functions write to it):

```
match /discoveryCache/{docId} {
  allow read, write: if false; // server-only via Admin SDK
}
```

#### Step 4 (Optional): Cache cleanup

Add a scheduled function to delete expired cache entries:

```typescript
export const cleanupDiscoveryCache = onSchedule(
  { schedule: "every 24 hours" },
  async () => {
    const db = getFirestore();
    const cutoff = Date.now() - DISCOVERY_CACHE_TTL_MS;
    const expired = await db
      .collection("discoveryCache")
      .where("cachedAt", "<", cutoff)
      .limit(500)
      .get();

    const batch = db.batch();
    expired.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    console.log(`[cache cleanup] Deleted ${expired.size} expired discovery entries`);
  }
);
```

### Expected Impact
| Metric | Cache Miss | Cache Hit |
|--------|-----------|-----------|
| Time | 3-6s (unchanged) | <0.5s |
| Perplexity calls | 1 | 0 |
| Serper calls | 1 | 0 |
| Cost | ~$0.01 | ~$0.00001 (1 Firestore read) |

For repeat/similar requests within 1 hour, this saves 3-6 seconds and ~$0.01 per request. The cache hit rate depends on usage patterns — for demo sessions showing the same genres, it will be very high.

---

## 9. Implementation Order & Dependencies

```
Optimization 1 (Enrich Only Top)
    │
    │  No dependencies — can be implemented first
    │
    ▼
Optimization 2 (Parallelize Enrichment)
    │
    │  Independent of Opt 1 but combined effect is multiplicative
    │  Opt 1 reduces batch COUNT, Opt 2 reduces batch DURATION
    │
    ▼
Optimization 4 (Cache Artist Discovery)
    │
    │  Fully independent — can be implemented in any order
    │
    ▼
Deploy & Test
```

### Recommended Sequence
1. **Optimization 2 first** (lowest risk, highest immediate time savings, no behavioral change)
2. **Optimization 1 second** (reduces cost, slight behavioral change in which tracks get enriched)
3. **Optimization 4 third** (adds caching infrastructure, needs Firestore rules update)

### Testing Strategy
After each optimization, test with:
- A **cold-cache request** (new genre combination): verify full pipeline works
- A **warm-cache request** (repeat the same prompt): verify caching works
- A **niche request** (e.g., "Ethiopian jazz fusion"): verify expansion loops still trigger
- Check Cloud Functions logs for timing: `[orchestrator] Pipeline complete in XXXms`

### Expected Combined Impact
| Metric | Current | After All 3 Optimizations |
|--------|---------|---------------------------|
| Total time (cold cache) | 25-67s | **8-18s** |
| Total time (warm cache) | 25-67s | **5-12s** |
| Perplexity calls | 6-17 | **1-4** |
| Cost per request | $0.05-0.12 | **$0.01-0.04** |
| Worst case time | 90-180s | **20-40s** |

---

## Appendix: Key Interfaces Reference

```typescript
// PlaylistIntent — output of Stage 1, input to Stages 2-7
interface PlaylistIntent {
  description: string;
  genres: string[];           // e.g. ["Electronic", "House"]
  subGenres: string[];        // e.g. ["Deep House", "Tech House"]
  moods: string[];            // e.g. ["chill", "introspective"]
  vibeKeywords: string[];     // e.g. ["late-night", "atmospheric"]
  energyRange: [number, number]; // e.g. [3, 6]
  targetDurationMinutes: number;
  targetTrackCount: number | null;
  artistPreferences: string[];
  excludeArtists: string[];
  eraPreference: string | null;
  referenceQuality: boolean;
}

// TrackCandidate — output of Stage 3, enriched in Stage 4
interface TrackCandidate {
  docId: string;
  Artist: string;
  track_Title: string;
  album: string;
  am_duration_ms: number | null;
  Apple_Music_ID: string;
  Apple_Music_URL: string | null;
  FINAL_SCORE: number | null;
  artistRelevance: number;
  artistGenreContext: string;
  atmos_mood?: string;
  atmos_energy?: number;
  atmos_vibe?: string[];
  atmos_tempo_estimate?: number;
}

// AtmosPlaylist — final output
interface AtmosPlaylist {
  title: string;
  description: string;
  tracks: VerifiedTrack[];
  totalDurationMs: number;
  atmosVerifiedCount: number;
  atmosWarningCount: number;
  intent: PlaylistIntent;
  buildMetadata: { ... };
}
```
