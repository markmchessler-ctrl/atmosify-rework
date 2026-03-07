// src/lib/types.ts
// Shared TypeScript interfaces for the Atmosify DB-first pipeline

export interface PlaylistIntent {
  description: string;
  genres: string[];
  subGenres: string[];
  moods: string[];
  vibeKeywords: string[];
  energyRange: [number, number]; // [min, max] on 1-10 scale
  targetDurationMinutes: number;
  targetTrackCount: number | null;
  artistPreferences: string[];
  excludeArtists: string[];
  eraPreference: string | null;
  referenceQuality: boolean;
}

export interface DiscoveredArtist {
  name: string;
  relevanceScore: number; // 0-1, how well they match the intent
  genreContext: string;   // e.g. "deep house pioneer"
  knownFor: string;       // e.g. "warm analog production, hypnotic grooves"
}

export interface DiscoveredArtists {
  artists: DiscoveredArtist[];
  searchStrategy: string; // which sources were used (Perplexity, Serper, Gemini)
}

export interface TrackCandidate {
  docId: string;
  Artist: string;
  track_Title: string;
  album: string;
  am_duration_ms: number | null;
  Apple_Music_ID: string;
  Apple_Music_URL: string | null;
  FINAL_SCORE: number | null;
  artistRelevance: number;     // from ArtistDiscovery
  artistGenreContext: string;  // from ArtistDiscovery
  overall_class?: string;      // quality classification from research engine
  am_has_atmos?: boolean;      // pre-verified Atmos flag from research engine
  enrichment_failed?: boolean; // true if AI enrichment failed for this track
  // Enriched fields (populated by TrackEnricher; may be from cache)
  atmos_mood?: string;
  atmos_energy?: number;   // 1-10
  atmos_vibe?: string[];
  atmos_tempo_estimate?: number; // BPM estimate
  atmos_key_estimate?: string;   // Camelot notation e.g. "8B", "3A"
}

export interface PlaylistDraftTrack {
  docId: string;
  Artist: string;
  track_Title: string;
  album: string;
  Apple_Music_ID: string;
  Apple_Music_URL: string | null;
  am_duration_ms: number | null;
  FINAL_SCORE: number | null;
  atmos_mood?: string;
  atmos_energy?: number;
  atmos_tempo_estimate?: number;
  atmos_vibe?: string[];
  atmos_key_estimate?: string;
  selectionRationale: string;
  position: number;
}

export interface PlaylistDraft {
  tracks: PlaylistDraftTrack[];
  unusedCandidates: TrackCandidate[]; // pool leftovers for gap-fill
}

export interface VerifiedTrack {
  docId: string;
  Artist: string;
  track_Title: string;
  album: string;
  Apple_Music_ID: string;
  Apple_Music_URL: string | null;
  durationMs: number;
  durationEstimated: boolean; // true = 4-min estimate, false = real Apple Music value
  atmosVerified: boolean;     // confirmed by Apple Music API
  atmosWarning: boolean;      // found on AM but no Atmos flag
  atmos_mood?: string;
  atmos_energy?: number;
  atmos_tempo_estimate?: number;
  atmos_vibe?: string[];
  atmos_key_estimate?: string;
  FINAL_SCORE: number | null;
}

export interface AtmosPlaylist {
  title: string;
  description: string;
  tracks: VerifiedTrack[];
  totalDurationMs: number;
  atmosVerifiedCount: number;
  atmosWarningCount: number;
  intent: PlaylistIntent;
  buildMetadata: {
    artistsDiscovered: number;
    candidatesFound: number;
    enrichedTracks: number;
    verificationDropped: number;
    expansionLoops: number;
    buildDurationMs: number;
  };
}

export interface ClarifyResult {
  needsClarification: boolean;
  clarificationQuestion?: string;
  intent?: PlaylistIntent;
}
