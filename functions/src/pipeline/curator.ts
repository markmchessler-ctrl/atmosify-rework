// src/pipeline/curator.ts
// Stage 5: AI-powered playlist selection and sequencing.
//
// Gemini 2.5 Flash Lite takes the enriched candidate pool and selects
// the best tracks, ordering them for mood arc and energy flow coherence.

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { TrackCandidate, PlaylistIntent, PlaylistDraft, PlaylistDraftTrack } from "../lib/types.js";
import { getBpmRange } from "../lib/genreTaxonomy.js";
import { extractJSON } from "../services/perplexity.js";

const GEMINI_MODEL = "gemini-2.5-flash";
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

function formatCandidateForPrompt(track: TrackCandidate, index: number): string {
  const duration = track.am_duration_ms
    ? `${Math.round(track.am_duration_ms / 60000)}:${String(Math.round((track.am_duration_ms % 60000) / 1000)).padStart(2, "0")}`
    : "~4:00";
  const score = track.FINAL_SCORE != null ? ` | score:${track.FINAL_SCORE}` : "";
  const mood = track.atmos_mood ? ` | mood:${track.atmos_mood}` : "";
  const energy = track.atmos_energy != null ? ` | energy:${track.atmos_energy}/10` : "";
  const vibe = track.atmos_vibe?.length ? ` | vibe:${track.atmos_vibe.join(",")}` : "";
  const relevance = ` | relevance:${track.artistRelevance.toFixed(2)}`;
  const genreCtx = ` | genre:${track.artistGenreContext}`;

  return `${index}|${track.docId}|${track.Artist} - ${track.track_Title} (${track.album}) [${duration}${mood}${energy}${vibe}${score}${relevance}${genreCtx}]`;
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
    .map((t, i) => formatCandidateForPrompt(t, i))
    .join("\n");

  return `You are a world-class music curator and playlist editor. Your job is to select and sequence
the best ${targetTrackCount} tracks from the candidate pool below to create an outstanding Dolby Atmos playlist.

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

SELECTION CRITERIA (in order of priority):
1. MOOD & VIBE ALIGNMENT — Track mood/vibe must match the listener's request
2. ENERGY ARC — Build a coherent energy journey; avoid jarring energy jumps between consecutive tracks
3. ARTIST DIVERSITY — Max 2-3 tracks per artist (unless listener specifically requested an artist)
4. QUALITY SIGNAL — When equally suitable, prefer tracks with higher quality scores (score field)
5. DURATION — Target ${Math.round(targetDurationMs / 60000)} minutes total (use ~4:00 estimate for tracks without duration)
6. RELEVANCE — Prefer tracks from higher-relevance artists (relevance field closer to 1.0)
7. BPM COHERENCE — Expected BPM range for this genre: ${bpmRange[0]}-${bpmRange[1]} BPM

SEQUENCING RULES:
- Start with a track that immediately establishes the mood
- Middle section can include more energy variation
- End with a satisfying resolution track
- Avoid putting two tracks with the same vibe descriptor back-to-back
- Keep artist variety — don't cluster all tracks from one artist

CANDIDATE POOL (format: index|docId|Artist - Title (Album) [duration|mood|energy|vibe|score|relevance|genre]):
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
        maxOutputTokens: 4000,
      },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // responseMimeType:"application/json" means text should be valid JSON directly
    let parsed: { playlist: GeminiTrackSelection[] } | null = null;
    try {
      parsed = JSON.parse(text) as { playlist: GeminiTrackSelection[] };
    } catch {
      // Fallback: try extracting JSON from markdown fences or bracket-depth scan
      parsed = extractJSON<{ playlist: GeminiTrackSelection[] }>(text);
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

  console.log(
    `[curator] Curating ${targetTrackCount} tracks from ${candidates.length} candidates. ` +
    `Target: ${intent.targetDurationMinutes} min`
  );

  const prompt = buildCuratorPrompt(intent, candidates, targetTrackCount, targetDurationMs);
  const selections = await curatWithGemini(prompt, config.geminiApiKey);

  if (!selections || selections.length === 0) {
    console.warn("[curator] Gemini curation failed, using rule-based fallback");
    const tracks = ruleBasedSelection(candidates, targetTrackCount, targetDurationMs, intent);
    const selectedDocIds = new Set(tracks.map(t => t.docId));
    return {
      draft: {
        tracks,
        unusedCandidates: candidates.filter(c => !selectedDocIds.has(c.docId)),
      },
      curatedByAI: false,
    };
  }

  // Map docIds back to full candidate data
  const candidateMap = new Map(candidates.map(c => [c.docId, c]));
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
      selectionRationale: sel.selectionRationale,
      position: sel.position,
    });
    usedDocIds.add(sel.docId);
  }

  // Sort by assigned position
  draftTracks.sort((a, b) => a.position - b.position);

  const unusedCandidates = candidates.filter(c => !usedDocIds.has(c.docId));

  console.log(`[curator] Gemini selected ${draftTracks.length} tracks, ${unusedCandidates.length} unused`);

  return {
    draft: { tracks: draftTracks, unusedCandidates },
    curatedByAI: true,
  };
}
