// src/pipeline/candidateScorer.ts
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

    // FINAL_SCORE from the research engine (0-10, scale to 0-30)
    score += ((c.FINAL_SCORE ?? 0) / 10) * 30;

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
