// src/pipeline/artistDiscovery.ts
// Stage 2: Discover artists matching the user's vibe/mood/genre request.
//
// Sources (in order):
//   1. Perplexity Sonar (PRIMARY) -- web-aware, great for music genre knowledge
import { extractJSON } from "./perplexity.js";
//   2. Serper (SUPPLEMENTAL) -- web search for niche/specific requests
//   3. Gemini 3.1 Flash Lite (FALLBACK) -- if Perplexity is unavailable
//
// All prompts are grounded in the NotebookLM genre taxonomy.

import { createHash } from "crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getFirestore } from "firebase-admin/firestore";
import { buildTaxonomyPromptContext } from "../lib/genreTaxonomy.js";
import { buildReferencePromptFragment } from "../lib/referenceAtmos.js";
import type { PlaylistIntent, DiscoveredArtists, DiscoveredArtist } from "../lib/types.js";

// -- Discovery cache --------------------------------------------------------
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
    description: intent.description,
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
    : "No specific era preference -- include classic and contemporary artists.";

  const excludeText = intent.excludeArtists.length > 0
    ? `Exclude these artists: ${intent.excludeArtists.join(", ")}`
    : "";

  const includeText = intent.artistPreferences.length > 0
    ? `The listener specifically likes: ${intent.artistPreferences.join(", ")} -- include similar artists.`
    : "";

  return `${taxonomyContext}

${referenceContext}LISTENER REQUEST:
Description: ${intent.description}
Genres: ${intent.genres.join(", ") || "Any"}
Sub-genres: ${intent.subGenres.join(", ") || "Any"}
Moods: ${intent.moods.join(", ") || "Any"}
Vibe keywords: ${intent.vibeKeywords.join(", ") || "Any"}
Energy level (1-10): ${intent.energyRange[0]}-${intent.energyRange[1]}
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
 * Extract artist names from Serper search results using Gemini.
 * Replaces fragile regex with AI-based extraction.
 */
async function extractArtistsFromSerperResults(
  results: SerperResult[],
  geminiApiKey: string
): Promise<string[]> {
  const snippetText = results
    .map(r => `Title: ${r.title}\nSnippet: ${r.snippet}`)
    .join("\n\n");

  if (!snippetText.trim()) return [];

  try {
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    });

    const result = await model.generateContent(
      `Extract all music artist/band names mentioned in these search results. Return ONLY valid JSON:\n{"artists": ["Artist Name 1", "Artist Name 2"]}\n\nSearch results:\n${snippetText}`
    );
    const text = result.response.text();
    const parsed = JSON.parse(text) as { artists: string[] };
    return (parsed.artists ?? []).slice(0, 20);
  } catch {
    console.warn("[artistDiscovery] Gemini extraction from Serper results failed, falling back to regex");
    // Regex fallback: numbered lists, quoted names, capitalized proper nouns
    const names = new Set<string>();
    for (const r of results) {
      const text = `${r.title} ${r.snippet}`;
      // Match numbered list items: "1. Artist Name", "2) Artist Name"
      const numbered = text.match(/\d+[\.)]\s*([A-Z][a-zA-Z\s&'.\-]{2,30})/g) ?? [];
      for (const m of numbered) {
        const name = m.replace(/^\d+[\.)]\s*/, "").trim();
        if (name.length > 2 && name.length < 40) names.add(name);
      }
      // Match quoted names
      const quoted = text.match(/["']([A-Z][a-zA-Z\s&'.\-]{2,30})["']/g) ?? [];
      for (const m of quoted) {
        const name = m.replace(/['"]/g, "").trim();
        if (name.length > 2 && name.length < 40) names.add(name);
      }
    }
    return Array.from(names).slice(0, 20);
  }
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
  apiKey: string,
  geminiApiKey: string
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
    return extractArtistsFromSerperResults(data.organic ?? [], geminiApiKey);
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
  // -- Check cache --------------------------------------------
  const cacheKey = buildDiscoveryCacheKey(intent);
  const cached = await getFromCache(cacheKey);
  if (cached) {
    console.log(
      `[artistDiscovery] Cache HIT (${cached.artists.length} artists, ` +
      `strategy: ${cached.searchStrategy})`
    );
    return cached;
  }
  console.log("[artistDiscovery] Cache MISS -- querying APIs...");

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
    const serperNames = await querySerperForArtists(serperQuery, config.serperApiKey, config.geminiApiKey);
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
