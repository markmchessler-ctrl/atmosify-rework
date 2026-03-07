// src/pipeline/orchestrator.ts
// Main pipeline orchestrator -- replaces the recursive web-search loop.
//
// NEW PIPELINE:
//   [1] Clarify   -> structured PlaylistIntent
//   [2] Discover  -> artist names matching vibe/mood
//   [3] Match     -> DB tracks from those artists
//   [4] Enrich    -> per-track mood/energy/vibe
//   [5] Curate    -> AI selects + sequences best tracks
//   [6] Verify    -> Apple Music API re-confirmation + real durations
//   [7] Assemble  -> gap-fill + final formatting
//
// Expansion loops (max 2) trigger when candidates pool is too thin.

import { getFirestore } from "firebase-admin/firestore";
import { getAtmosDb } from "../lib/atmosDb.js";
import { generateAppleMusicToken } from "../lib/appleMusic.js";
import { clarifyIntent } from "./clarify.js";
import { discoverArtists, expandArtistDiscovery } from "./artistDiscovery.js";
import { matchArtistsToTracks, discoverTracksByAttributes } from "./dbMatcher.js";
import { expandGenreList } from "./genreMap.js";
import { enrichTracks } from "./trackEnricher.js";
import { scoreAndRank } from "./candidateScorer.js";
import { curatePlaylist } from "./curator.js";
import { verifyPlaylist } from "./verifier.js";
import { assemblePlaylist } from "./assembler.js";
import type { AtmosPlaylist, DiscoveredArtist, PlaylistIntent } from "../lib/types.js";

const MAX_EXPANSION_LOOPS = 2;
// Minimum candidates needed before running curation (20x target for broad pool)
const MIN_CANDIDATE_MULTIPLIER = 20;

interface OrchestratorConfig {
  geminiApiKey: string;
  perplexityApiKey: string;
  serperApiKey?: string;
  appleTeamId: string;
  appleKeyId: string;
  applePrivateKey: string;
  jobId?: string;
}

interface PipelineCheckpoint {
  stage: string;
  message: string;
  updatedAt: number;
  // Saved after clarify
  intent?: PlaylistIntent;
  // Saved after discover
  discoveredArtists?: DiscoveredArtist[];
  searchStrategy?: string;
  completedStages?: string[];
}

/** Write pipeline stage progress to nextn Firestore for real-time frontend updates. */
async function reportProgress(
  jobId: string | undefined,
  stage: string,
  message: string,
  checkpoint?: Partial<PipelineCheckpoint>
): Promise<void> {
  if (!jobId) return;
  try {
    const nextnDb = getFirestore();
    await nextnDb.doc(`pipelineJobs/${jobId}`).set(
      { stage, message, updatedAt: Date.now(), ...checkpoint },
      { merge: true }
    );
  } catch (err) {
    console.warn(`[orchestrator] Failed to report progress for job ${jobId}:`, err);
  }
}

/** Load existing checkpoint for a jobId (for pipeline resume). */
async function loadCheckpoint(jobId: string): Promise<PipelineCheckpoint | null> {
  try {
    const nextnDb = getFirestore();
    const snap = await nextnDb.doc(`pipelineJobs/${jobId}`).get();
    if (!snap.exists) return null;
    const data = snap.data() as PipelineCheckpoint;
    if (!data.completedStages || data.completedStages.length === 0) return null;
    return data;
  } catch {
    return null;
  }
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

  // Check for existing checkpoint (pipeline resume)
  let checkpoint: PipelineCheckpoint | null = null;
  if (config.jobId) {
    checkpoint = await loadCheckpoint(config.jobId);
    if (checkpoint) {
      console.log(`[orchestrator] Resuming from checkpoint. Completed stages: ${checkpoint.completedStages?.join(", ")}`);
    }
  }
  const completed = new Set(checkpoint?.completedStages ?? []);

  // -- Stage 1: Clarify ------------------------------------------------------
  let intent: PlaylistIntent;
  if (completed.has("clarify") && checkpoint?.intent) {
    console.log("[orchestrator] Stage 1: Clarify (cached)");
    intent = checkpoint.intent;
  } else {
    console.log("[orchestrator] Stage 1: Clarify");
    await reportProgress(config.jobId, "clarify", "Analyzing your request...");
    const clarifyResult = await clarifyIntent(userPrompt, { geminiApiKey: config.geminiApiKey });

    if (clarifyResult.needsClarification || !clarifyResult.intent) {
      return {
        playlist: null,
        needsClarification: true,
        clarificationQuestion: clarifyResult.clarificationQuestion,
      };
    }
    intent = clarifyResult.intent;
    await reportProgress(config.jobId, "clarify", "Analyzing your request...", {
      intent,
      completedStages: ["clarify"],
    });
  }

  const minCandidates = getMinCandidates(intent);

  if (intent.referenceQuality) {
    console.log("[orchestrator] Reference quality mode ACTIVE");
  }

  const discoveryConfig = {
    perplexityApiKey: config.perplexityApiKey,
    geminiApiKey: config.geminiApiKey,
    serperApiKey: config.serperApiKey,
  };

  // -- Stage 2: ArtistDiscovery ----------------------------------------------
  let allDiscoveredArtists: DiscoveredArtist[];
  let searchStrategy: string;
  if (completed.has("discover") && checkpoint?.discoveredArtists) {
    console.log("[orchestrator] Stage 2: ArtistDiscovery (cached)");
    allDiscoveredArtists = checkpoint.discoveredArtists;
    searchStrategy = checkpoint.searchStrategy ?? "cached";
  } else {
    console.log("[orchestrator] Stage 2: ArtistDiscovery");
    await reportProgress(config.jobId, "discover", "Discovering artists via Perplexity...");
    const discovered = await discoverArtists(intent, discoveryConfig);
    allDiscoveredArtists = [...discovered.artists];
    searchStrategy = discovered.searchStrategy;
    await reportProgress(config.jobId, "discover", "Discovering artists via Perplexity...", {
      discoveredArtists: allDiscoveredArtists,
      searchStrategy,
      completedStages: ["clarify", "discover"],
    });
  }

  // Compute target track count early (needed for attribute discovery limits)
  const targetCount = intent.targetTrackCount
    ?? Math.max(10, Math.round((intent.targetDurationMinutes * 60_000) / 240_000));

  // -- Stage 3: DBMatcher ----------------------------------------------------
  console.log("[orchestrator] Stage 3: DBMatcher");
  await reportProgress(config.jobId, "match", "Searching 100k+ Atmos tracks...");
  let matchResult = await matchArtistsToTracks(db, { artists: allDiscoveredArtists, searchStrategy }, intent);
  let candidates = matchResult.candidates;

  // Supplement with genre/mood attribute discovery (capped to avoid off-genre flood)
  const attrLimit = Math.max(50, targetCount * 5);
  const dbCandidates = await discoverTracksByAttributes(db, intent, attrLimit);
  if (dbCandidates.length > 0) {
    console.log(`[orchestrator] Attribute discovery found ${dbCandidates.length} additional candidates (limit ${attrLimit})`);
    candidates = mergeUnique(candidates, dbCandidates);
  }

  // Expansion loops if candidate pool is too thin
  let expansionLoop = 0;
  while (candidates.length < minCandidates && expansionLoop < MAX_EXPANSION_LOOPS) {
    expansionLoop++;
    console.log(
      `[orchestrator] Expansion loop ${expansionLoop}: only ${candidates.length} candidates, need ${minCandidates}. Expanding...`
    );

    // Broaden genre search on each expansion
    intent.subGenres = expandGenreList(intent.genres, intent.subGenres);

    const expanded = await expandArtistDiscovery(intent, allDiscoveredArtists, discoveryConfig, 100);

    if (expanded.artists.length === 0) {
      console.log("[orchestrator] No new artists from expansion -- stopping");
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

  // -- Pre-enrichment scoring ----------------------------------------------
  const enrichBudget = targetCount * 3;

  const { toEnrich, deferred } = scoreAndRank(candidates, intent, enrichBudget);
  console.log(
    `[orchestrator] Pre-scoring: ${candidates.length} candidates, ` +
    `enriching top ${toEnrich.length}, deferring ${deferred.length}`
  );

  // -- Stage 4: TrackEnricher (only top candidates) ----------------------
  console.log(`[orchestrator] Stage 4: TrackEnricher (${toEnrich.length} of ${candidates.length})`);
  await reportProgress(config.jobId, "enrich", `Enriching ${toEnrich.length} tracks with mood & energy...`);
  const enricherResult = await enrichTracks(db, toEnrich, intent, {
    perplexityApiKey: config.perplexityApiKey,
    geminiApiKey: config.geminiApiKey,
  });
  // Include deferred candidates at end for gap-fill pool in assembler
  const enrichedCandidates = [...enricherResult.enrichedCandidates, ...deferred];

  // -- Stage 5: Curator ------------------------------------------------------
  console.log("[orchestrator] Stage 5: Curator");
  await reportProgress(config.jobId, "curate", "Curating your playlist with Gemini...");
  const curatorResult = await curatePlaylist(enrichedCandidates, intent, {
    geminiApiKey: config.geminiApiKey,
  });
  const draft = curatorResult.draft;

  // -- Stage 6: Verifier -----------------------------------------------------
  console.log("[orchestrator] Stage 6: Verifier");
  await reportProgress(config.jobId, "verify", "Verifying Dolby Atmos on Apple Music...");
  const appleMusicToken = generateAppleMusicToken(
    config.appleTeamId,
    config.appleKeyId,
    config.applePrivateKey
  );
  const verifierResult = await verifyPlaylist(db, draft, { appleMusicToken });

  // -- Stage 7: Assembler ----------------------------------------------------
  console.log("[orchestrator] Stage 7: Assembler");
  await reportProgress(config.jobId, "assemble", "Assembling your playlist...");
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

  await reportProgress(config.jobId, "complete", "Done!");

  // Clean up job doc after a delay (don't block the response)
  if (config.jobId) {
    const nextnDb = getFirestore();
    nextnDb.doc(`pipelineJobs/${config.jobId}`).delete().catch(() => {});
  }

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
