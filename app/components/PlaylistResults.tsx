"use client";
// app/components/PlaylistResults.tsx
// Vibrant music-club themed track list with Apple Music album art.

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
        borderRadius: "var(--radius-md)",
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
          style={{ borderRadius: "var(--radius-md)" }}
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
        className="shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full font-semibold"
        style={{
          fontSize: "11px",
          letterSpacing: "0.5px",
          background: "var(--color-atmos-verified-bg)",
          color: "var(--color-atmos-verified)",
          boxShadow: "0 0 8px rgba(168, 85, 247, 0.2)",
        }}
      >
        ✓ Atmos
      </span>
    );
  }
  if (warning) {
    return (
      <span
        className="shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full font-semibold"
        style={{
          fontSize: "11px",
          letterSpacing: "0.5px",
          background: "var(--color-atmos-warning-bg)",
          color: "var(--color-atmos-warning)",
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
      className="flex items-center gap-3 px-4 py-3 transition-all"
      style={{
        minHeight: "56px",
        borderRadius: "var(--radius-md)",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = "var(--color-surface-hover)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = "transparent";
      }}
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
              color: "var(--color-text)",
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
              color: "var(--color-text-secondary)",
              letterSpacing: "0.4px",
            }}
          >
            {track.Artist}
            {track.album && ` · ${track.album}`}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 track-card-meta">
        <AtmosBadge verified={track.atmosVerified} warning={track.atmosWarning} />
        <span
          style={{
            fontSize: "12px",
            fontWeight: 500,
            letterSpacing: "0.5px",
            color: "var(--color-text-tertiary)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatDuration(track.durationMs, track.durationEstimated)}
        </span>
      </div>
    </div>
  );
}

// ── Share Button ──────────────────────────────────────────────────────────────

function ShareButton({ playlist }: { playlist: AtmosPlaylist }) {
  const [status, setStatus] = useState<"idle" | "sharing" | "copied" | "error">("idle");

  const handleShare = async () => {
    setStatus("sharing");
    try {
      const functions = getFunctions(app);
      const sharePlaylist = httpsCallableFromURL<
        { playlist: AtmosPlaylist },
        { shareId: string }
      >(functions, "https://shareplaylist-or54ak2xqq-uc.a.run.app");

      const { data } = await sharePlaylist({ playlist });
      const shareUrl = `${window.location.origin}/share?id=${data.shareId}`;

      // Try native share first, fall back to clipboard
      if (navigator.share) {
        await navigator.share({
          title: playlist.title,
          text: `Check out this Atmos playlist: ${playlist.title}`,
          url: shareUrl,
        });
        setStatus("idle");
      } else {
        await navigator.clipboard.writeText(shareUrl);
        setStatus("copied");
        setTimeout(() => setStatus("idle"), 2500);
      }
    } catch (err) {
      // User cancelled native share
      if (err instanceof Error && err.name === "AbortError") {
        setStatus("idle");
        return;
      }
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  };

  return (
    <button
      onClick={handleShare}
      disabled={status === "sharing"}
      className="btn-outlined"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "13px",
        opacity: status === "sharing" ? 0.6 : 1,
      }}
    >
      {status === "idle" && (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
          Share
        </>
      )}
      {status === "sharing" && "Sharing..."}
      {status === "copied" && "Link copied!"}
      {status === "error" && "Failed — try again"}
    </button>
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
          className="playlist-title"
          style={{
            fontSize: "24px",
            lineHeight: "32px",
            fontWeight: 700,
            color: "var(--color-text)",
          }}
        >
          {playlist.title}
        </h2>
        <p
          className="mt-2"
          style={{
            fontSize: "14px",
            lineHeight: "22px",
            letterSpacing: "0.25px",
            color: "var(--color-text-secondary)",
          }}
        >
          {playlist.description}
        </p>

        {/* Stats row */}
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3"
          style={{
            fontSize: "13px",
            fontWeight: 500,
            letterSpacing: "0.3px",
            color: "var(--color-text-tertiary)",
          }}
        >
          <span>🎵 {playlist.tracks.length} tracks</span>
          <span style={{ color: "var(--color-border)" }}>·</span>
          <span>⏱ {formatTotalDuration(playlist.totalDurationMs)}</span>
          <span style={{ color: "var(--color-border)" }}>·</span>
          <span
            style={{ color: "var(--color-accent-bright)" }}
          >
            {atmosVerifiedPct}% Atmos confirmed
          </span>
          {playlist.atmosWarningCount > 0 && (
            <>
              <span style={{ color: "var(--color-border)" }}>·</span>
              <span style={{ color: "var(--color-atmos-warning)" }}>
                {playlist.atmosWarningCount} unverified
              </span>
            </>
          )}
        </div>

        {/* Build details */}
        <details
          className="mt-4 overflow-hidden"
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-lg)",
          }}
        >
          <summary
            className="px-4 py-3 cursor-pointer flex items-center gap-2 select-none"
            style={{
              fontSize: "12px",
              fontWeight: 500,
              letterSpacing: "0.5px",
              color: "var(--color-text-secondary)",
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
            className="px-4 pb-3 grid grid-cols-2 gap-x-6 gap-y-1.5"
            style={{
              fontSize: "12px",
              color: "var(--color-text-tertiary)",
            }}
          >
            <span>Candidates found</span>
            <span className="text-right" style={{ color: "var(--color-text-secondary)" }}>
              {playlist.buildMetadata.candidatesFound}
            </span>
            <span>Enriched</span>
            <span className="text-right" style={{ color: "var(--color-text-secondary)" }}>
              {playlist.buildMetadata.enrichedTracks}
            </span>
            <span>Dropped at verification</span>
            <span className="text-right" style={{ color: "var(--color-text-secondary)" }}>
              {playlist.buildMetadata.verificationDropped}
            </span>
            <span>Build time</span>
            <span className="text-right" style={{ color: "var(--color-text-secondary)" }}>
              {(playlist.buildMetadata.buildDurationMs / 1000).toFixed(1)}s
            </span>
          </div>
        </details>
      </div>

      {/* Actions: Save + Share */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <SaveToAppleMusic playlist={playlist} />
        <ShareButton playlist={playlist} />
      </div>

      {/* Track list */}
      <div
        className="overflow-hidden"
        style={{
          background: "rgba(255, 255, 255, 0.03)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-xl)",
        }}
      >
        {playlist.tracks.map((track, i) => (
          <div key={track.docId}>
            {i > 0 && (
              <div
                className="mx-4"
                style={{
                  height: "1px",
                  background: "var(--color-border-subtle)",
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
            color: "var(--color-text-tertiary)",
          }}
        >
          Tracks marked Atmos? come from verified artist catalogs but could not
          be confirmed via Apple Music API at build time.
        </p>
      )}
    </div>
  );
}
