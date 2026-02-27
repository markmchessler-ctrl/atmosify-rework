// src/pipeline/orchestrator.ts
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
  let matchResult = await matchArtistsToTracks(db, { artists: allDiscoveredArtists, searchStrategy: discovered.searchStrategy });
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
    const expandMatch = await matchArtistsToTracks(db, { artists: expanded.artists, searchStrategy: "expansion" });
    candidates = mergeUnique(candidates, expandMatch.candidates);
  }

  if (candidates.length === 0) {
    return {
      playlist: null,
      needsClarification: false,
      error: `No tracks found in the Atmos DB matching your request for "${intent.description}". Try a different genre or mood.`,
    };
  }

  // ── Stage 4: TrackEnricher ────────────────────────────────────────────────
  console.log(`[orchestrator] Stage 4: TrackEnricher (${candidates.length} candidates)`);
  const enricherResult = await enrichTracks(db, candidates, intent, {
    perplexityApiKey: config.perplexityApiKey,
    geminiApiKey: config.geminiApiKey,
  });
  const enrichedCandidates = enricherResult.enrichedCandidates;

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
