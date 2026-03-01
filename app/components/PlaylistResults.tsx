"use client";
// app/components/PlaylistResults.tsx
// Apple Music-style dark track list.
// Fetches real album art from the AM catalog API on mount; falls back to gradient placeholder.

import { useEffect, useState } from "react";
import { getFunctions, httpsCallableFromURL } from "firebase/functions";
import { app } from "../lib/firebase";
import { SaveToAppleMusic } from "./SaveToAppleMusic";
import type { AtmosPlaylist, VerifiedTrack } from "../../src/lib/types";

interface PlaylistResultsProps {
  playlist: AtmosPlaylist;
}

// ── Artwork fetching ──────────────────────────────────────────────────────────

async function fetchArtworkMap(
  trackIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = trackIds.filter(Boolean);
  if (ids.length === 0) return map;

  // Get a dev token (same Cloud Run function used by SaveToAppleMusic)
  const functions = getFunctions(app);
  const getDevToken = httpsCallableFromURL<void, { token: string }>(
    functions,
    "https://getapplemusicdevtoken-or54ak2xqq-uc.a.run.app"
  );
  const { data } = await getDevToken();
  const devToken = data.token;

  // Apple Music catalog API — up to 300 IDs per request
  const CHUNK = 300;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK).join(",");
    try {
      const res = await fetch(
        `https://api.music.apple.com/v1/catalog/us/songs?ids=${chunk}`,
        { headers: { Authorization: `Bearer ${devToken}` } }
      );
      if (!res.ok) continue;
      const json = await res.json();
      for (const song of json.data ?? []) {
        const url: string | undefined = song.attributes?.artwork?.url;
        if (url) {
          // Replace the template placeholders with pixel dimensions.
          // 80px covers 40px display size at 2× retina.
          map.set(song.id, url.replace("{w}", "80").replace("{h}", "80"));
        }
      }
    } catch {
      // Network error — silently fall back to gradients for this chunk
    }
  }

  return map;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const GRADIENTS: [string, string][] = [
  ["#3b82f6", "#7c3aed"],
  ["#ec4899", "#f43f5e"],
  ["#f97316", "#eab308"],
  ["#10b981", "#0d9488"],
  ["#8b5cf6", "#6366f1"],
  ["#06b6d4", "#3b82f6"],
  ["#d946ef", "#ec4899"],
  ["#f43f5e", "#fb923c"],
];

function getArtistGradient(artist: string): string {
  const hash = artist.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const [from, to] = GRADIENTS[hash % GRADIENTS.length];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

function formatDuration(ms: number, estimated: boolean): string {
  const totalSecs = Math.round(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${estimated ? "~" : ""}${mins}:${String(secs).padStart(2, "0")}`;
}

function formatTotalDuration(ms: number): string {
  const totalMins = Math.round(ms / 60000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function AlbumArt({
  artist,
  artworkUrl,
}: {
  artist: string;
  artworkUrl?: string;
}) {
  return (
    <div
      className="w-10 h-10 rounded-lg shrink-0 relative overflow-hidden shadow-sm flex items-center justify-center"
      style={{ background: getArtistGradient(artist) }}
    >
      {/* Gradient initial — always rendered, hidden by real art if it loads */}
      <span className="text-white font-semibold text-sm select-none">
        {artist[0]?.toUpperCase() ?? "?"}
      </span>

      {/* Real artwork — overlays the gradient; hides itself on error */}
      {artworkUrl && (
        <img
          src={artworkUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          onError={e => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
    </div>
  );
}

function AtmosBadge({
  verified,
  warning,
}: {
  verified: boolean;
  warning: boolean;
}) {
  if (verified) {
    return (
      <span
        className="shrink-0 inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium text-blue-400"
        style={{
          background: "rgba(10,132,255,0.15)",
          border: "1px solid rgba(10,132,255,0.22)",
        }}
      >
        Atmos
      </span>
    );
  }
  if (warning) {
    return (
      <span
        className="shrink-0 inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium text-yellow-400/80"
        style={{
          background: "rgba(234,179,8,0.1)",
          border: "1px solid rgba(234,179,8,0.18)",
        }}
      >
        Atmos?
      </span>
    );
  }
  return null;
}

function TrackCard({
  track,
  artworkUrl,
}: {
  track: VerifiedTrack;
  artworkUrl?: string;
}) {
  return (
    <div className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-white/[0.04] transition-colors">
      <AlbumArt artist={track.Artist} artworkUrl={artworkUrl} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium text-white truncate leading-tight">
            {track.track_Title}
          </span>
          <AtmosBadge
            verified={track.atmosVerified}
            warning={track.atmosWarning}
          />
        </div>
        <div className="text-xs text-white/45 truncate mt-0.5">
          {track.Artist}
          {track.album && ` · ${track.album}`}
        </div>
      </div>

      <span className="text-xs text-white/30 shrink-0 tabular-nums">
        {formatDuration(track.durationMs, track.durationEstimated)}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PlaylistResults({ playlist }: PlaylistResultsProps) {
  const [artworkMap, setArtworkMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const ids = playlist.tracks.map(t => t.Apple_Music_ID);
    fetchArtworkMap(ids)
      .then(map => setArtworkMap(map))
      .catch(() => {/* fall back to gradients silently */});
  }, [playlist]);

  const atmosVerifiedPct =
    playlist.tracks.length > 0
      ? Math.round(
          (playlist.atmosVerifiedCount / playlist.tracks.length) * 100
        )
      : 0;

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-5">
        <h2 className="text-xl font-semibold text-white">{playlist.title}</h2>
        <p className="text-sm text-white/45 mt-1">{playlist.description}</p>

        <div className="flex flex-wrap items-center gap-2 mt-3 text-xs text-white/35">
          <span>{playlist.tracks.length} tracks</span>
          <span className="text-white/15">·</span>
          <span>{formatTotalDuration(playlist.totalDurationMs)}</span>
          <span className="text-white/15">·</span>
          <span>{atmosVerifiedPct}% Atmos confirmed</span>
          {playlist.atmosWarningCount > 0 && (
            <>
              <span className="text-white/15">·</span>
              <span>{playlist.atmosWarningCount} unverified</span>
            </>
          )}
        </div>

        <details className="mt-2">
          <summary className="text-xs text-white/20 cursor-pointer hover:text-white/40 transition-colors">
            Build details
          </summary>
          <div className="mt-1 text-xs text-white/20 space-y-0.5 pl-3">
            <div>Candidates found: {playlist.buildMetadata.candidatesFound}</div>
            <div>Enriched: {playlist.buildMetadata.enrichedTracks}</div>
            <div>
              Dropped at verification:{" "}
              {playlist.buildMetadata.verificationDropped}
            </div>
            <div>
              Build time:{" "}
              {(playlist.buildMetadata.buildDurationMs / 1000).toFixed(1)}s
            </div>
          </div>
        </details>
      </div>

      {/* Save to Apple Music */}
      <div className="mb-5">
        <SaveToAppleMusic playlist={playlist} />
      </div>

      {/* Track list */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {playlist.tracks.map((track, i) => (
          <div key={track.docId}>
            {i > 0 && (
              <div
                className="mx-3"
                style={{
                  height: "1px",
                  background: "rgba(255,255,255,0.05)",
                }}
              />
            )}
            <div className="px-2">
              <TrackCard
                track={track}
                artworkUrl={artworkMap.get(track.Apple_Music_ID)}
              />
            </div>
          </div>
        ))}
      </div>

      {playlist.atmosWarningCount > 0 && (
        <p className="mt-4 text-xs text-white/20 text-center">
          Tracks marked Atmos? come from verified artist catalogs but could not
          be confirmed via Apple Music API at build time.
        </p>
      )}
    </div>
  );
}
