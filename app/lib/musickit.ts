// app/lib/musickit.ts
// MusicKit JS wrapper for client-side Apple Music integration.
//
// Prerequisites:
// 1. Add to app/layout.tsx:
//    <Script src="https://js-cdn.music.apple.com/musickit/v3/musickit.js" strategy="beforeInteractive" />
// 2. The getAppleMusicDevToken Cloud Function must be deployed.
//
// MusicKit JS is loaded via CDN — this module provides a typed wrapper.

declare global {
  interface Window {
    MusicKit: MusicKitGlobal;
  }
}

interface MusicKitGlobal {
  configure(config: MusicKitConfig): Promise<MusicKitInstance>;
  getInstance(): MusicKitInstance;
}

interface MusicKitConfig {
  developerToken: string;
  app: {
    name: string;
    build: string;
  };
}

interface MusicKitInstance {
  authorize(): Promise<string>; // returns Music User Token
  unauthorize(): Promise<void>;
  isAuthorized: boolean;
  musicUserToken: string | null;
  api: MusicKitAPI;
}

interface MusicKitAPI {
  music(path: string, options?: Record<string, unknown>): Promise<{ data: unknown }>;
}

let initialized = false;

/**
 * Initialize MusicKit with the developer token from the Cloud Function.
 * Safe to call multiple times — only initializes once.
 */
export async function initializeMusicKit(devToken: string): Promise<MusicKitInstance> {
  if (initialized && window.MusicKit) {
    return window.MusicKit.getInstance();
  }

  if (!window.MusicKit) {
    throw new Error("MusicKit JS is not loaded. Add the CDN script to layout.tsx.");
  }

  await window.MusicKit.configure({
    developerToken: devToken,
    app: {
      name: "Atmosify",
      build: "1.0",
    },
  });

  initialized = true;
  return window.MusicKit.getInstance();
}

/**
 * Authorize with Apple Music (triggers OAuth popup).
 * Returns the Music User Token for API calls.
 */
export async function authorizeAppleMusic(devToken: string): Promise<string> {
  const kit = await initializeMusicKit(devToken);
  const token = await kit.authorize();
  return token;
}

export interface CreatePlaylistOptions {
  name: string;
  description: string;
  trackIds: string[]; // Apple Music catalog IDs
}

export interface CreatePlaylistResult {
  success: boolean;
  playlistId?: string;
  playlistUrl?: string;
  skippedTracks: number;
  error?: string;
}

/**
 * Create an Apple Music playlist in the user's library.
 * Requires prior authorization (authorizeAppleMusic).
 */
export async function createAppleMusicPlaylist(
  devToken: string,
  options: CreatePlaylistOptions
): Promise<CreatePlaylistResult> {
  try {
    const kit = await initializeMusicKit(devToken);

    if (!kit.isAuthorized) {
      await kit.authorize();
    }

    const musicUserToken = kit.musicUserToken;
    if (!musicUserToken) {
      return { success: false, skippedTracks: 0, error: "No Music User Token after authorization" };
    }

    // Create the playlist
    const createResp = await fetch("https://api.music.apple.com/v1/me/library/playlists", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${devToken}`,
        "Music-User-Token": musicUserToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        attributes: {
          name: options.name,
          description: { standard: options.description },
        },
        relationships: {
          tracks: {
            data: options.trackIds.map(id => ({
              id,
              type: "songs",
            })),
          },
        },
      }),
    });

    if (!createResp.ok) {
      const errorText = await createResp.text();
      // Handle specific error cases
      if (createResp.status === 401) {
        return { success: false, skippedTracks: 0, error: "Apple Music subscription required" };
      }
      return { success: false, skippedTracks: 0, error: `API error: ${createResp.status} ${errorText}` };
    }

    const data = await createResp.json() as {
      data: Array<{ id: string; href?: string; attributes?: { url?: string } }>;
    };

    const playlist = data.data?.[0];
    const playlistId = playlist?.id;

    return {
      success: true,
      playlistId,
      skippedTracks: 0,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, skippedTracks: 0, error: message };
  }
}

/**
 * Check if MusicKit JS is loaded and available.
 */
export function isMusicKitAvailable(): boolean {
  return typeof window !== "undefined" && !!window.MusicKit;
}
