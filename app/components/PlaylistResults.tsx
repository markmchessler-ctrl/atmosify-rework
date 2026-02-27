"use client";
// app/components/PlaylistResults.tsx
// Displays a completed Atmosify playlist with track cards and Apple Music save button.
// REPLACES/UPDATES existing PlaylistResults component.

import { SaveToAppleMusic } from "./SaveToAppleMusic";
import type { AtmosPlaylist, VerifiedTrack } from "../../functions/src/lib/types";

interface PlaylistResultsProps {
  playlist: AtmosPlaylist;
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

function AtmosBadge({ verified, warning }: { verified: boolean; warning: boolean }) {
  if (verified) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
        <span>●</span> Atmos
      </span>
    );
  }
  if (warning) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700">
        <span>◐</span> Atmos?
      </span>
    );
  }
  return null;
}

function TrackCard({ track, position }: { track: VerifiedTrack; position: number }) {
  return (
    <div className="flex items-start gap-3 py-3 px-4 hover:bg-gray-50 rounded-lg transition-colors group">
      {/* Position */}
      <span className="w-6 shrink-0 text-sm text-gray-400 text-right mt-0.5">{position}</span>

      {/* Track info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2 flex-wrap">
          <span className="font-medium text-sm text-gray-900 truncate">{track.track_Title}</span>
          <AtmosBadge verified={track.atmosVerified} warning={track.atmosWarning} />
          {track.FINAL_SCORE != null && (
            <span className="text-xs text-gray-400 ml-auto">★ {track.FINAL_SCORE}</span>
          )}
        </div>
        <div className="text-xs text-gray-500 truncate mt-0.5">
          {track.Artist}
          {track.album && ` · ${track.album}`}
        </div>
        {(track.atmos_mood || track.atmos_energy != null) && (
          <div className="flex items-center gap-2 mt-1">
            {track.atmos_mood && (
              <span className="text-xs text-gray-400 italic">{track.atmos_mood}</span>
            )}
            {track.atmos_energy != null && (
              <EnergyBar energy={track.atmos_energy} />
            )}
          </div>
        )}
      </div>

      {/* Duration */}
      <span className="text-xs text-gray-400 shrink-0 mt-0.5">
        {formatDuration(track.durationMs, track.durationEstimated)}
      </span>
    </div>
  );
}

function EnergyBar({ energy }: { energy: number }) {
  const segments = 5;
  const filled = Math.round((energy / 10) * segments);
  return (
    <div className="flex items-center gap-0.5" title={`Energy: ${energy}/10`}>
      {Array.from({ length: segments }).map((_, i) => (
        <div
          key={i}
          className={`w-1.5 h-2 rounded-sm ${i < filled ? "bg-blue-400" : "bg-gray-200"}`}
        />
      ))}
    </div>
  );
}

export function PlaylistResults({ playlist }: PlaylistResultsProps) {
  const atmosVerifiedPct = playlist.tracks.length > 0
    ? Math.round((playlist.atmosVerifiedCount / playlist.tracks.length) * 100)
    : 0;

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">{playlist.title}</h2>
        <p className="text-sm text-gray-500 mt-1">{playlist.description}</p>

        {/* Stats bar */}
        <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-gray-500">
          <span>{playlist.tracks.length} tracks</span>
          <span>{formatTotalDuration(playlist.totalDurationMs)}</span>
          <span>
            {atmosVerifiedPct}% Atmos confirmed
            {playlist.atmosWarningCount > 0 && ` · ${playlist.atmosWarningCount} unverified`}
          </span>
          <span className="text-gray-400">
            from {playlist.buildMetadata.artistsDiscovered} artists
          </span>
        </div>

        {/* Build stats (collapsible in production; shown here for transparency) */}
        <details className="mt-2">
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
            Build details
          </summary>
          <div className="mt-1 text-xs text-gray-400 space-y-0.5 pl-3">
            <div>Candidates found: {playlist.buildMetadata.candidatesFound}</div>
            <div>Enriched: {playlist.buildMetadata.enrichedTracks}</div>
            <div>Dropped at verification: {playlist.buildMetadata.verificationDropped}</div>
            <div>Build time: {(playlist.buildMetadata.buildDurationMs / 1000).toFixed(1)}s</div>
          </div>
        </details>
      </div>

      {/* Save to Apple Music */}
      <div className="mb-6">
        <SaveToAppleMusic playlist={playlist} />
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 text-xs text-gray-400">
        <span className="flex items-center gap-1">
          <span className="inline-flex items-center gap-1 px-1 py-0.5 rounded bg-blue-100 text-blue-800 text-xs">● Atmos</span>
          = confirmed
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-flex items-center gap-1 px-1 py-0.5 rounded bg-yellow-100 text-yellow-700 text-xs">◐ Atmos?</span>
          = likely Atmos
        </span>
        <span>~4:00 = estimated duration</span>
      </div>

      {/* Track list */}
      <div className="divide-y divide-gray-100">
        {playlist.tracks.map((track, i) => (
          <TrackCard key={track.docId} track={track} position={i + 1} />
        ))}
      </div>

      {/* Footer note */}
      {playlist.atmosWarningCount > 0 && (
        <p className="mt-4 text-xs text-gray-400 text-center">
          Tracks marked with ◐ come from Atmos-verified artist catalogs but could not be confirmed via Apple Music API at build time.
        </p>
      )}
    </div>
  );
}
