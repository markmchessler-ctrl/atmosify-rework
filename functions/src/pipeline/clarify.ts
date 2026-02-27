// src/pipeline/clarify.ts
// Stage 1: Gatekeeper — parse user intent into structured PlaylistIntent.
//
// If the request is too vague, return a clarification question.
// Maps freeform language to canonical genre/mood terms from the taxonomy.
// REPLACES existing clarify.ts

import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildTaxonomyPromptContext } from "../lib/genreTaxonomy.js";
import type { PlaylistIntent, ClarifyResult } from "../lib/types.js";

const GEMINI_MODEL = "gemini-2.5-flash";

interface ClarifyConfig {
  geminiApiKey: string;
}

const VAGUE_REQUEST_INDICATORS = [
  "music", "songs", "playlist", "something", "anything", "good",
  "nice", "cool", "vibes", "beats",
];

function isRequestTooVague(userPrompt: string): boolean {
  const lower = userPrompt.toLowerCase().trim();
  const words = lower.split(/\s+/);
  // Vague if the entire prompt is just 1-3 generic words
  if (words.length <= 3 && words.every(w => VAGUE_REQUEST_INDICATORS.includes(w))) {
    return true;
  }
  return false;
}

function buildClarifyPrompt(userPrompt: string): string {
  // Include a compact taxonomy sample to help Gemini map genres correctly
  const taxonomyCtx = buildTaxonomyPromptContext([], []);

  return `You are a music curator assistant. A user wants a Dolby Atmos playlist.
Parse their request into structured metadata. Use the canonical genre taxonomy below.

${taxonomyCtx}

USER REQUEST:
"${userPrompt}"

TASK:
1. If the request is too vague to build a meaningful playlist (no genre, no mood, no vibe),
   set needsClarification: true and provide a friendly clarificationQuestion.
2. Otherwise, extract structured intent from the request.

For genres and subGenres, map to canonical taxonomy names where possible, but common genres
like R&B, Soul, Hip-Hop, Jazz, Classical, Country, Pop, Rock, Metal, Funk, Gospel, Latin,
Reggae, Blues, Folk, Punk, etc. are always valid — do not ask for clarification on them.
For moods, use descriptive words like: chill, energetic, melancholic, euphoric, romantic,
  introspective, uplifting, dark, aggressive, dreamy, sensual, nostalgic, hypnotic, etc.
For vibeKeywords, use sonic descriptors: warm, cold, atmospheric, driving, lo-fi, hi-fi,
  spacious, intimate, raw, polished, organic, electronic, analog, digital, etc.
For energyRange: 1=ambient/silent, 5=moderate, 10=intense/aggressive. Provide [min, max].
For eraPreference: "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s", "classic",
  "modern", or null.
For targetDurationMinutes: default to 60 if not specified.

Return ONLY valid JSON, no markdown:
{
  "needsClarification": false,
  "clarificationQuestion": null,
  "intent": {
    "description": "refined description of what the user wants",
    "genres": ["Primary Genre"],
    "subGenres": ["Sub-Genre 1", "Sub-Genre 2"],
    "moods": ["mood1", "mood2"],
    "vibeKeywords": ["vibe1", "vibe2"],
    "energyRange": [3, 6],
    "targetDurationMinutes": 60,
    "targetTrackCount": null,
    "artistPreferences": [],
    "excludeArtists": [],
    "eraPreference": null
  }
}`;
}

/**
 * Parse user request into structured PlaylistIntent using Gemini.
 */
export async function clarifyIntent(
  userPrompt: string,
  config: ClarifyConfig
): Promise<ClarifyResult> {
  // Quick vague-request check before hitting Gemini
  if (isRequestTooVague(userPrompt)) {
    return {
      needsClarification: true,
      clarificationQuestion:
        "What kind of music are you in the mood for? Tell me a genre, mood, or vibe — " +
        'like "late-night R&B", "energetic deep house", or "melancholic indie rock".',
    };
  }

  try {
    const genAI = new GoogleGenerativeAI(config.geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    const result = await model.generateContent(buildClarifyPrompt(userPrompt));
    const text = result.response.text();

    // responseMimeType:"application/json" means text should be valid JSON directly
    const parsed = JSON.parse(text) as {
      needsClarification: boolean;
      clarificationQuestion: string | null;
      intent: PlaylistIntent | null;
    };

    if (parsed.needsClarification || !parsed.intent) {
      return {
        needsClarification: true,
        clarificationQuestion:
          parsed.clarificationQuestion ??
          'Can you be more specific? For example: "chill late-night neo-soul" or "high-energy trap for working out".',
      };
    }

    // Ensure required fields have defaults
    const intent: PlaylistIntent = {
      description: parsed.intent.description ?? userPrompt,
      genres: parsed.intent.genres ?? [],
      subGenres: parsed.intent.subGenres ?? [],
      moods: parsed.intent.moods ?? [],
      vibeKeywords: parsed.intent.vibeKeywords ?? [],
      energyRange: parsed.intent.energyRange ?? [4, 7],
      targetDurationMinutes: parsed.intent.targetDurationMinutes ?? 60,
      targetTrackCount: parsed.intent.targetTrackCount ?? null,
      artistPreferences: parsed.intent.artistPreferences ?? [],
      excludeArtists: parsed.intent.excludeArtists ?? [],
      eraPreference: parsed.intent.eraPreference ?? null,
    };

    return { needsClarification: false, intent };
  } catch (err) {
    console.error("[clarify] Gemini error:", err);
    // If Gemini fails, do a best-effort parse to keep the pipeline moving
    return {
      needsClarification: false,
      intent: {
        description: userPrompt,
        genres: [],
        subGenres: [],
        moods: [],
        vibeKeywords: [],
        energyRange: [4, 7],
        targetDurationMinutes: 60,
        targetTrackCount: null,
        artistPreferences: [],
        excludeArtists: [],
        eraPreference: null,
      },
    };
  }
}
