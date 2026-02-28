"use client";
// app/components/PlaylistResults.tsx
// Apple Music-style dark track list with album art placeholders.

import { SaveToAppleMusic } from "./SaveToAppleMusic";
import type { AtmosPlaylist, VerifiedTrack } from "../../src/lib/types";

interface PlaylistResultsProps {
  playlist: AtmosPlaylist;
}

// Deterministic gradient per artist name
const GRADIENTS: [string, string][] = [
  ["#3b82f6", "#7c3aed"], // blue → purple
  ["#ec4899", "#f43f5e"], // pink → rose
  ["#f97316", "#eab308"], // orange → amber
  ["#10b981", "#0d9488"], // emerald → teal
  ["#8b5cf6", "#6366f1"], // violet → indigo
  ["#06b6d4", "#3b82f6"], // cyan → blue
  ["#d946ef", "#ec4899"], // fuchsia → pink
  ["#f43f5e", "#fb923c"], // rose → orange
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
  const formatted = `${mins}:${String(secs).padStart(2, "0")}`;
  return estimated ? `~${formatted}` : formatted;
}

function formatTotalDuration(ms: number): string {
  const totalMins = Math.round(ms / 60000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function AlbumArt({ artist }: { artist: string }) {
  return (
    <div
      className="w-10 h-10 rounded-lg shrink-0 flex items-center justify-center shadow-sm"
      style={{ background: getArtistGradient(artist) }}
    >
      <span className="text-white font-semibold text-sm select-none">
        {artist[0]?.toUpperCase() ?? "?"}
      </span>
    </div>
  );
}

function AtmosBadge({ verified, warning }: { verified: boolean; warning: boolean }) {
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

function TrackCard({ track }: { track: VerifiedTrack }) {
  return (
    <div className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-white/[0.04] transition-colors">
      <AlbumArt artist={track.Artist} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium text-white truncate leading-tight">
            {track.track_Title}
          </span>
          <AtmosBadge verified={track.atmosVerified} warning={track.atmosWarning} />
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

export function PlaylistResults({ playlist }: PlaylistResultsProps) {
  const atmosVerifiedPct =
    playlist.tracks.length > 0
      ? Math.round((playlist.atmosVerifiedCount / playlist.tracks.length) * 100)
      : 0;

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-5">
        <h2 className="text-xl font-semibold text-white">{playlist.title}</h2>
        <p className="text-sm text-white/45 mt-1">{playlist.description}</p>

        {/* Stats */}
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
            <div>Dropped at verification: {playlist.buildMetadata.verificationDropped}</div>
            <div>Build time: {(playlist.buildMetadata.buildDurationMs / 1000).toFixed(1)}s</div>
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
              <div className="mx-3" style={{ height: "1px", background: "rgba(255,255,255,0.05)" }} />
            )}
            <div className="px-2">
              <TrackCard track={track} />
            </div>
          </div>
        ))}
      </div>

      {playlist.atmosWarningCount > 0 && (
        <p className="mt-4 text-xs text-white/20 text-center">
          Tracks marked Atmos? come from verified artist catalogs but could not be confirmed via Apple Music API at build time.
        </p>
      )}
    </div>
  );
}
