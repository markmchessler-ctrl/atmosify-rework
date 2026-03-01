"use client";
// app/components/PlaylistResults.tsx
// M3 dark-themed track list with Apple Music album art.

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

  const functions = getFunctions(app);
  const getDevToken = httpsCallableFromURL<void, { token: string }>(
    functions,
    "https://getapplemusicdevtoken-or54ak2xqq-uc.a.run.app"
  );
  const { data } = await getDevToken();
  const devToken = data.token;

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
          map.set(song.id, url.replace("{w}", "88").replace("{h}", "88"));
        }
      }
    } catch {
      // Silently fall back to gradients
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
      className="w-11 h-11 shrink-0 relative overflow-hidden flex items-center justify-center"
      style={{
        background: getArtistGradient(artist),
        borderRadius: "var(--md-sys-shape-corner-medium)",
      }}
    >
      <span
        className="font-semibold text-sm select-none"
        style={{ color: "white" }}
      >
        {artist[0]?.toUpperCase() ?? "?"}
      </span>

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
        className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full font-medium"
        style={{
          fontSize: "11px",
          letterSpacing: "0.5px",
          background: "var(--atmos-verified-bg)",
          color: "var(--md-sys-color-primary)",
        }}
      >
        Atmos
      </span>
    );
  }
  if (warning) {
    return (
      <span
        className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full font-medium"
        style={{
          fontSize: "11px",
          letterSpacing: "0.5px",
          background: "var(--atmos-warning-bg)",
          color: "var(--md-sys-color-tertiary)",
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
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl transition-colors hover:bg-white/[0.04]"
      style={{ minHeight: "56px" }}
    >
      <AlbumArt artist={track.Artist} artworkUrl={artworkUrl} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="truncate"
            style={{
              fontSize: "14px",
              lineHeight: "20px",
              fontWeight: 500,
              color: "var(--md-sys-color-on-surface)",
              letterSpacing: "0.1px",
            }}
          >
            {track.track_Title}
          </span>
        </div>
        <div className="truncate mt-0.5">
          <span
            style={{
              fontSize: "12px",
              lineHeight: "16px",
              color: "var(--md-sys-color-on-surface-variant)",
              letterSpacing: "0.4px",
            }}
          >
            {track.Artist}
            {track.album && ` · ${track.album}`}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <AtmosBadge verified={track.atmosVerified} warning={track.atmosWarning} />
        <span
          style={{
            fontSize: "12px",
            fontWeight: 500,
            letterSpacing: "0.5px",
            color: "var(--md-sys-color-outline)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatDuration(track.durationMs, track.durationEstimated)}
        </span>
      </div>
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
      {/* Playlist header */}
      <div className="mb-6">
        <h2
          style={{
            fontSize: "22px",
            lineHeight: "28px",
            fontWeight: 500,
            color: "var(--md-sys-color-on-surface)",
          }}
        >
          {playlist.title}
        </h2>
        <p
          className="mt-2"
          style={{
            fontSize: "14px",
            lineHeight: "20px",
            letterSpacing: "0.25px",
            color: "var(--md-sys-color-on-surface-variant)",
          }}
        >
          {playlist.description}
        </p>

        {/* Stats row */}
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3"
          style={{
            fontSize: "12px",
            fontWeight: 500,
            letterSpacing: "0.5px",
            color: "var(--md-sys-color-outline)",
          }}
        >
          <span>{playlist.tracks.length} tracks</span>
          <span style={{ color: "var(--md-sys-color-outline-variant)" }}>·</span>
          <span>{formatTotalDuration(playlist.totalDurationMs)}</span>
          <span style={{ color: "var(--md-sys-color-outline-variant)" }}>·</span>
          <span>{atmosVerifiedPct}% Atmos confirmed</span>
          {playlist.atmosWarningCount > 0 && (
            <>
              <span style={{ color: "var(--md-sys-color-outline-variant)" }}>·</span>
              <span>{playlist.atmosWarningCount} unverified</span>
            </>
          )}
        </div>

        {/* Build details */}
        <details
          className="mt-3 rounded-2xl overflow-hidden"
          style={{ background: "var(--md-sys-color-surface-container-low)" }}
        >
          <summary
            className="px-4 py-3 cursor-pointer flex items-center gap-2 select-none"
            style={{
              fontSize: "12px",
              fontWeight: 500,
              letterSpacing: "0.5px",
              color: "var(--md-sys-color-on-surface-variant)",
            }}
          >
            <svg
              className="w-4 h-4 transition-transform chevron-icon"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
            Build details
          </summary>
          <div
            className="px-4 pb-3 grid grid-cols-2 gap-x-6 gap-y-1"
            style={{
              fontSize: "12px",
              color: "var(--md-sys-color-outline)",
            }}
          >
            <span>Candidates found</span>
            <span className="text-right">{playlist.buildMetadata.candidatesFound}</span>
            <span>Enriched</span>
            <span className="text-right">{playlist.buildMetadata.enrichedTracks}</span>
            <span>Dropped at verification</span>
            <span className="text-right">{playlist.buildMetadata.verificationDropped}</span>
            <span>Build time</span>
            <span className="text-right">
              {(playlist.buildMetadata.buildDurationMs / 1000).toFixed(1)}s
            </span>
          </div>
        </details>
      </div>

      {/* Save to Apple Music */}
      <div className="mb-5">
        <SaveToAppleMusic playlist={playlist} />
      </div>

      {/* Track list */}
      <div
        className="rounded-3xl overflow-hidden"
        style={{
          background: "var(--md-sys-color-surface-container-lowest)",
          border: "1px solid var(--md-sys-color-outline-variant)",
        }}
      >
        {playlist.tracks.map((track, i) => (
          <div key={track.docId}>
            {i > 0 && (
              <div
                className="mx-4"
                style={{
                  height: "1px",
                  background: "var(--md-sys-color-outline-variant)",
                }}
              />
            )}
            <TrackCard
              track={track}
              artworkUrl={artworkMap.get(track.Apple_Music_ID)}
            />
          </div>
        ))}
      </div>

      {playlist.atmosWarningCount > 0 && (
        <p
          className="mt-4 text-center"
          style={{
            fontSize: "12px",
            letterSpacing: "0.4px",
            color: "var(--md-sys-color-outline)",
          }}
        >
          Tracks marked Atmos? come from verified artist catalogs but could not
          be confirmed via Apple Music API at build time.
        </p>
      )}
    </div>
  );
}
