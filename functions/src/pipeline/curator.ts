// src/pipeline/curator.ts
// Stage 5: AI-powered playlist selection and sequencing.
//
// Gemini 3.1 Flash Lite takes the enriched candidate pool and selects
// the best tracks, ordering them for mood arc and energy flow coherence.

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { TrackCandidate, PlaylistIntent, PlaylistDraft, PlaylistDraftTrack } from "../lib/types.js";
import { getBpmRange, buildCrossPollinationContext, buildTaxonomyPromptContext } from "../lib/genreTaxonomy.js";
import { extractJSON } from "./perplexity.js";

const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";
// Max candidates to send to Gemini in a single prompt (token budget)
const MAX_CANDIDATES_IN_PROMPT = 200;
// Default duration estimate for tracks without am_duration_ms (4 minutes)
const DEFAULT_DURATION_MS = 240_000;

interface CuratorConfig {
  geminiApiKey: string;
}

interface GeminiTrackSelection {
  docId: string;
  selectionRationale: string;
  position: number;
}

function formatCandidateForPrompt(track: TrackCandidate): string {
  const duration = track.am_duration_ms
    ? `${Math.round(track.am_duration_ms / 60000)}:${String(Math.round((track.am_duration_ms % 60000) / 1000)).padStart(2, "0")}`
    : "~4:00";
  const score = track.FINAL_SCORE != null ? ` | score:${track.FINAL_SCORE}` : "";
  const mood = track.atmos_mood ? ` | mood:${track.atmos_mood}` : "";
  const energy = track.atmos_energy != null ? ` | energy:${track.atmos_energy}/10` : "";
  const vibe = track.atmos_vibe?.length ? ` | vibe:${track.atmos_vibe.join(",")}` : "";
  const bpm = track.atmos_tempo_estimate ? ` | bpm:${track.atmos_tempo_estimate}` : "";
  const key = track.atmos_key_estimate ? ` | key:${track.atmos_key_estimate}` : "";
  const relevance = ` | relevance:${track.artistRelevance.toFixed(2)}`;
  const genreCtx = ` | genre:${track.artistGenreContext}`;
  const enrichFail = track.enrichment_failed ? " | ENRICHMENT_FAILED" : "";

  return `${track.docId}|${track.Artist} - ${track.track_Title} (${track.album}) [${duration}${mood}${energy}${vibe}${bpm}${key}${score}${relevance}${genreCtx}${enrichFail}]`;
}

function buildCuratorPrompt(
  intent: PlaylistIntent,
  candidates: TrackCandidate[],
  targetTrackCount: number,
  targetDurationMs: number
): string {
  const bpmRange = intent.genres.length > 0
    ? getBpmRange(intent.subGenres[0] ?? intent.genres[0])
    : [80, 140];

  const trackList = candidates
    .slice(0, MAX_CANDIDATES_IN_PROMPT)
    .map((t) => formatCandidateForPrompt(t))
    .join("\n");

  const crossPollinationCtx = buildCrossPollinationContext(intent.genres, intent.subGenres);
  const taxonomyCtx = buildTaxonomyPromptContext(intent.genres, intent.moods);

  return `You are a world-class music curator and playlist editor specializing in Dolby Atmos spatial audio.
Your job is to select and sequence the best ${targetTrackCount} tracks from the candidate pool below
to create an outstanding Dolby Atmos playlist that showcases spatial audio production quality.

LISTENER REQUEST:
"${intent.description}"
Genres: ${intent.genres.join(", ")}
Sub-genres: ${intent.subGenres.join(", ")}
Moods: ${intent.moods.join(", ")}
Vibe keywords: ${intent.vibeKeywords.join(", ")}
Energy range desired: ${intent.energyRange[0]}-${intent.energyRange[1]}/10
Target duration: ${Math.round(targetDurationMs / 60000)} minutes
${intent.eraPreference ? `Era preference: ${intent.eraPreference}` : ""}
${intent.artistPreferences.length > 0 ? `Listener likes these artists specifically: ${intent.artistPreferences.join(", ")}` : ""}
${intent.excludeArtists.length > 0 ? `Exclude these artists: ${intent.excludeArtists.join(", ")}` : ""}

${taxonomyCtx}
${crossPollinationCtx}

SELECTION CRITERIA (in order of priority):
1. STRICT GENRE ADHERENCE -- This is the MOST IMPORTANT rule. ONLY select tracks by artists who genuinely belong
   to the requested genre(s): ${intent.genres.join(", ")}${intent.subGenres.length > 0 ? ` (sub-genres: ${intent.subGenres.join(", ")})` : ""}.
   REJECT any track whose artist is NOT associated with these genres, even if the track's mood/energy fits.
   For example: if the request is "Yacht Rock", do NOT include BTS, The Weeknd, Disclosure, or any K-pop/R&B/EDM artist.
   When in doubt about genre fit, EXCLUDE the track. It is better to have fewer tracks than off-genre filler.
2. DOLBY ATMOS QUALITY -- Every track in this playlist will be verified for Dolby Atmos availability.
   Prefer tracks with higher quality scores (score field) as this correlates with better spatial audio mixes.
   Tracks with score >= 7.0 are reference-quality Atmos candidates.
3. MOOD & VIBE ALIGNMENT -- Track mood/vibe must match the listener's request
4. ENERGY ARC -- Build a coherent energy journey; avoid jarring energy jumps (>3 points) between consecutive tracks
5. CREATIVE GENRE PAIRING -- You may include 1-2 tracks from closely adjacent genres for variety,
   but ONLY if the artist has clear stylistic overlap with the requested genre.
   For example: a Yacht Rock playlist could include 1 soft AOR or West Coast jazz-fusion track, but NOT EDM or K-pop.
6. ARTIST DIVERSITY -- Max 2-3 tracks per artist (unless listener specifically requested an artist)
7. DURATION -- Target ${Math.round(targetDurationMs / 60000)} minutes total (use ~4:00 estimate for tracks without duration)
8. RELEVANCE -- Prefer tracks from higher-relevance artists (relevance field closer to 1.0)
9. BPM COHERENCE -- Expected BPM range for this genre: ${bpmRange[0]}-${bpmRange[1]} BPM.
   Adjacent tracks should stay within 15-20 BPM of each other for smooth transitions.
10. METADATA QUALITY -- Tracks marked ENRICHMENT_FAILED have no mood/energy data and should be deprioritized.
   Tracks with mood 'unknown' should only fill gaps when better options are exhausted.
${intent.referenceQuality ? "10. REFERENCE QUALITY -- This listener specifically wants reference-quality Dolby Atmos mixes. Strongly prefer tracks with score >= 8.0 by artists known for exceptional spatial audio production (e.g. artists working with top mix engineers like Steven Wilson, Bob Clearmountain, Giles Martin)." : ""}

SEQUENCING RULES:
- Start with a track that immediately establishes the mood (opener should be recognizable or impactful)
- Cross-genre tracks work best in the middle third -- sandwich them between genre-core tracks
- Build energy gradually -- middle section can explore more variation
- End with a satisfying resolution track (slightly lower energy, strong mood callback)
- Avoid putting two tracks with the same vibe descriptor back-to-back
- Keep artist variety -- don't cluster all tracks from one artist together
- BPM transitions: keep consecutive tracks within 15-20 BPM when possible
- KEY COMPATIBILITY: When key data is available, prefer Camelot-compatible transitions
  (same key, +/-1 number, or A/B switch). This creates harmonic flow between tracks.

CANDIDATE POOL (format: docId|Artist - Title (Album) [duration|mood|energy|vibe|bpm|key|score|relevance|genre]):
NOTE: Use ONLY the exact docId value (the part before the first pipe) in your response.
${trackList}

Select exactly ${targetTrackCount} tracks. For each selection, provide a brief rationale.

Return ONLY valid JSON, no markdown:
{
  "playlist": [
    {
      "docId": "exact_docId_from_above",
      "position": 1,
      "selectionRationale": "Opens the set with the right hypnotic energy..."
    }
  ]
}`;
}

/**
 * Select and sequence tracks using Gemini.
 */
async function curatWithGemini(
  prompt: string,
  apiKey: string
): Promise<GeminiTrackSelection[] | null> {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.3,
        maxOutputTokens: 32768,
      },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // responseMimeType:"application/json" means text should be valid JSON directly
    let parsed: { playlist: GeminiTrackSelection[] } | null = null;
    try {
      parsed = JSON.parse(text) as { playlist: GeminiTrackSelection[] };
    } catch (parseErr) {
      console.warn("[curator] JSON.parse failed, trying extractJSON. text length:", text.length, "text[:500]:", text.slice(0, 500));
      parsed = extractJSON<{ playlist: GeminiTrackSelection[] }>(text);
    }
    if (!parsed?.playlist) {
      console.warn("[curator] No playlist in parsed response. Keys:", parsed ? Object.keys(parsed) : "null");
    }
    return parsed?.playlist ?? null;
  } catch (err) {
    console.error("[curator] Gemini curation failed:", err);
    return null;
  }
}

/**
 * Fallback: rule-based selection when Gemini fails.
 * Sorts by relevance + quality score and enforces artist diversity.
 */
function ruleBasedSelection(
  candidates: TrackCandidate[],
  targetCount: number,
  targetDurationMs: number,
  intent: PlaylistIntent
): PlaylistDraftTrack[] {
  const selected: PlaylistDraftTrack[] = [];
  const artistCounts = new Map<string, number>();
  const lowerExclude = new Set(intent.excludeArtists.map(a => a.toLowerCase()));
  let accumulatedDuration = 0;

  for (const track of candidates) {
    if (selected.length >= targetCount) break;
    if (accumulatedDuration >= targetDurationMs * 1.1) break;

    const artistKey = track.Artist.toLowerCase();
    if (lowerExclude.has(artistKey)) continue;

    const artistCount = artistCounts.get(artistKey) ?? 0;
    const maxPerArtist = intent.artistPreferences.map(a => a.toLowerCase()).includes(artistKey)
      ? 5 // more tracks for specifically requested artists
      : 3;

    if (artistCount >= maxPerArtist) continue;

    const durationMs = track.am_duration_ms ?? DEFAULT_DURATION_MS;
    selected.push({
      docId: track.docId,
      Artist: track.Artist,
      track_Title: track.track_Title,
      album: track.album,
      Apple_Music_ID: track.Apple_Music_ID,
      Apple_Music_URL: track.Apple_Music_URL,
      am_duration_ms: track.am_duration_ms,
      FINAL_SCORE: track.FINAL_SCORE,
      atmos_mood: track.atmos_mood,
      atmos_energy: track.atmos_energy,
      atmos_tempo_estimate: track.atmos_tempo_estimate,
      atmos_vibe: track.atmos_vibe,
      atmos_key_estimate: track.atmos_key_estimate,
      selectionRationale: "Rule-based selection (AI curation unavailable)",
      position: selected.length + 1,
    });

    artistCounts.set(artistKey, artistCount + 1);
    accumulatedDuration += durationMs;
  }

  return selected;
}

export interface CuratorResult {
  draft: PlaylistDraft;
  curatedByAI: boolean;
}

/**
 * Main entry point: select and sequence tracks from the enriched candidate pool.
 */
export async function curatePlaylist(
  candidates: TrackCandidate[],
  intent: PlaylistIntent,
  config: CuratorConfig
): Promise<CuratorResult> {
  const targetDurationMs = intent.targetDurationMinutes * 60 * 1000;
  const avgDurationMs = DEFAULT_DURATION_MS; // 4 min estimate
  const targetTrackCount = intent.targetTrackCount
    ?? Math.max(10, Math.round(targetDurationMs / avgDurationMs));

  // Request 1.4x tracks from curator to absorb verification drops (Fix 2)
  const curatorTargetCount = Math.ceil(targetTrackCount * 1.4);

  // Filter/sort unknown-mood candidates (Fix 3): prefer enriched tracks
  const enriched = candidates.filter(c => c.atmos_mood && c.atmos_mood !== "unknown");
  const underEnriched = candidates.filter(c => !c.atmos_mood || c.atmos_mood === "unknown");
  const filteredCandidates = enriched.length >= targetTrackCount * 2
    ? enriched
    : [...enriched, ...underEnriched]; // keep under-enriched if pool too thin

  console.log(
    `[curator] Curating ${curatorTargetCount} tracks (1.4x overshoot of ${targetTrackCount}) from ${filteredCandidates.length} candidates ` +
    `(${enriched.length} enriched, ${underEnriched.length} under-enriched). ` +
    `Target: ${intent.targetDurationMinutes} min`
  );

  const prompt = buildCuratorPrompt(intent, filteredCandidates, curatorTargetCount, targetDurationMs);
  const selections = await curatWithGemini(prompt, config.geminiApiKey);

  if (!selections || selections.length === 0) {
    console.warn("[curator] Gemini curation failed, using rule-based fallback");
    const tracks = ruleBasedSelection(filteredCandidates, curatorTargetCount, targetDurationMs, intent);
    const selectedDocIds = new Set(tracks.map(t => t.docId));
    return {
      draft: {
        tracks,
        unusedCandidates: filteredCandidates.filter(c => !selectedDocIds.has(c.docId)),
      },
      curatedByAI: false,
    };
  }

  // Map docIds back to full candidate data
  const candidateMap = new Map(filteredCandidates.map(c => [c.docId, c]));
  const draftTracks: PlaylistDraftTrack[] = [];
  const usedDocIds = new Set<string>();

  for (const sel of selections) {
    const candidate = candidateMap.get(sel.docId);
    if (!candidate || usedDocIds.has(sel.docId)) continue;

    draftTracks.push({
      docId: candidate.docId,
      Artist: candidate.Artist,
      track_Title: candidate.track_Title,
      album: candidate.album,
      Apple_Music_ID: candidate.Apple_Music_ID,
      Apple_Music_URL: candidate.Apple_Music_URL,
      am_duration_ms: candidate.am_duration_ms,
      FINAL_SCORE: candidate.FINAL_SCORE,
      atmos_mood: candidate.atmos_mood,
      atmos_energy: candidate.atmos_energy,
      atmos_tempo_estimate: candidate.atmos_tempo_estimate,
      atmos_vibe: candidate.atmos_vibe,
      atmos_key_estimate: candidate.atmos_key_estimate,
      selectionRationale: sel.selectionRationale,
      position: sel.position,
    });
    usedDocIds.add(sel.docId);
  }

  // Sort by assigned position
  draftTracks.sort((a, b) => a.position - b.position);

  const unusedCandidates = filteredCandidates.filter(c => !usedDocIds.has(c.docId));

  console.log(`[curator] Gemini selected ${draftTracks.length} tracks, ${unusedCandidates.length} unused`);

  return {
    draft: { tracks: draftTracks, unusedCandidates },
    curatedByAI: true,
  };
}
