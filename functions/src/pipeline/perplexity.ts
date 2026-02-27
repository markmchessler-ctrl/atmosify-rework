// src/pipeline/perplexity.ts
// Perplexity API wrapper — repurposed for artist discovery and track enrichment.
// The original track-search logic has been removed.
//
// This module is kept as a thin wrapper so calling code doesn't need to know
// the Perplexity API format details.

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";

export interface PerplexityConfig {
  apiKey: string;
  model?: string;    // default: "sonar"
  maxTokens?: number;
  temperature?: number;
}

export interface PerplexityResponse {
  content: string;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

/**
 * Send a chat completion request to Perplexity.
 * Returns the text content of the first choice, or null on error.
 */
export async function queryPerplexity(
  prompt: string,
  config: PerplexityConfig,
  timeoutMs = 45_000
): Promise<string | null> {
  const body = {
    model: config.model ?? "sonar",
    messages: [{ role: "user", content: prompt }],
    max_tokens: config.maxTokens ?? 3000,
    temperature: config.temperature ?? 0.2,
  };

  try {
    const resp = await fetch(PERPLEXITY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!resp.ok) {
      console.warn(`[perplexity] HTTP ${resp.status}: ${resp.statusText}`);
      return null;
    }

    const data = await resp.json() as {
      choices: Array<{ message: { content: string } }>;
      model: string;
    };

    return data.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    console.error("[perplexity] Request failed:", err);
    return null;
  }
}

/**
 * Extract a JSON array or object from a Perplexity response string.
 * Uses bracket-depth tracking to find the correct boundaries, avoiding
 * the greedy-regex problem where citation footnotes break parsing.
 */
export function extractJSON<T>(content: string): T | null {
  // 1. Try markdown code fences first (most reliable)
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]) as T; } catch { /* fall through */ }
  }

  // 2. Find JSON using bracket-depth tracking (handles citations after JSON)
  for (const [open, close] of [["{", "}"], ["[", "]"]] as const) {
    const start = content.indexOf(open);
    if (start === -1) continue;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < content.length; i++) {
      const ch = content[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\" && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(content.slice(start, i + 1)) as T; } catch { break; }
        }
      }
    }
  }

  return null;
}
