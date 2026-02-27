// src/lib/appleMusic.ts
// Apple Music JWT generation + batch track lookup + Atmos verification
// Ported and extended from atmos-mcp/functions/src/index.ts

import jwt from "jsonwebtoken";

export interface AppleTrackAttrs {
  name: string;
  artistName: string;
  albumName: string;
  genreNames: string[];
  releaseDate: string;
  isrc?: string;
  audioVariants?: string[];   // e.g. ["dolby-atmos", "lossless", "lossy-stereo"]
  audioTraits?: string[];     // legacy field, no longer used for Atmos detection
  composerName?: string;
  durationInMillis: number;
  url: string;
}

export interface AppleLookupResult {
  id: string;
  found: boolean;
  hasAtmos: boolean;
  durationMs: number | null;
  url: string | null;
  attrs: AppleTrackAttrs | null;
}

/**
 * Generate a developer JWT for the Apple Music API.
 * The private key may be stored as a single line with escaped \n sequences.
 */
export function generateAppleMusicToken(
  teamId: string,
  keyId: string,
  privateKey: string
): string {
  // Normalize escaped \n sequences that come from single-line secret storage.
  // Handle both literal \n (two chars) and already-real newlines.
  const pem = privateKey
    .replace(/\\n/g, "\n")   // literal \n → real newline
    .trim();                  // remove any leading/trailing whitespace
  return jwt.sign({}, pem, {
    algorithm: "ES256",
    expiresIn: "12h",
    issuer: teamId,
    keyid: keyId,
  });
}

/**
 * Batch lookup Apple Music tracks.
 * Processes up to 300 IDs per API call.
 * Returns a map of Apple Music ID → lookup result.
 */
export async function batchLookupAppleTracks(
  ids: string[],
  token: string,
  storefront = "us"
): Promise<Map<string, AppleLookupResult>> {
  const results = new Map<string, AppleLookupResult>();
  const BATCH_SIZE = 300;

  const notFound = (id: string): AppleLookupResult => ({
    id,
    found: false,
    hasAtmos: false,
    durationMs: null,
    url: null,
    attrs: null,
  });

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const idsParam = encodeURIComponent(batch.join(","));

    try {
      const resp = await fetch(
        `https://api.music.apple.com/v1/catalog/${storefront}/songs?ids=${idsParam}&extend=audioVariants`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15000),
        }
      );

      if (!resp.ok) {
        console.warn(`[appleMusic] Batch lookup failed: HTTP ${resp.status}`);
        batch.forEach(id => results.set(id, notFound(id)));
        continue;
      }

      const data = await resp.json() as {
        data: Array<{ id: string; attributes: AppleTrackAttrs }>;
      };

      const foundIds = new Set<string>();
      for (const item of (data.data ?? [])) {
        const attrs = item.attributes;
        const hasAtmos = (attrs.audioVariants ?? []).includes("dolby-atmos");
        // Diagnostic: log audioVariants for every track so we can see what Apple Music returns
        console.log(`[appleMusic] Track ${item.id}: ${attrs.artistName} – ${attrs.name} | audioVariants=${JSON.stringify(attrs.audioVariants)} | audioTraits=${JSON.stringify(attrs.audioTraits)}`);
        results.set(item.id, {
          id: item.id,
          found: true,
          hasAtmos,
          durationMs: attrs.durationInMillis ?? null,
          url: attrs.url ?? null,
          attrs,
        });
        foundIds.add(item.id);
      }

      // Mark tracks not returned by Apple Music
      for (const id of batch) {
        if (!foundIds.has(id)) {
          results.set(id, notFound(id));
        }
      }
    } catch (err) {
      console.error(`[appleMusic] Batch lookup error:`, err);
      batch.forEach(id => results.set(id, notFound(id)));
    }

    // Respect Apple Music rate limits between batches
    if (i + BATCH_SIZE < ids.length) {
      await new Promise(r => setTimeout(r, 250));
    }
  }

  return results;
}
