"use client";
// app/components/SaveToAppleMusic.tsx
// Save an Atmosify playlist to Apple Music — dark themed.

import { useState, useCallback } from "react";
import { getFunctions, httpsCallableFromURL } from "firebase/functions";
import { app } from "../lib/firebase";
import {
  initializeMusicKit,
  createAppleMusicPlaylist,
  isMusicKitAvailable,
} from "../lib/musickit";
import type { AtmosPlaylist } from "../../src/lib/types";

interface SaveToAppleMusicProps {
  playlist: AtmosPlaylist;
  className?: string;
}

type SaveState =
  | "idle"
  | "fetching_token"
  | "authorizing"
  | "creating"
  | "success"
  | "error";

export function SaveToAppleMusic({ playlist, className }: SaveToAppleMusicProps) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedPlaylistId, setSavedPlaylistId] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (!isMusicKitAvailable()) {
      setErrorMessage("MusicKit JS is not loaded. Please refresh the page.");
      setSaveState("error");
      return;
    }

    setErrorMessage(null);
    setSaveState("fetching_token");

    try {
      const functions = getFunctions(app);
      const getDevToken = httpsCallableFromURL<void, { token: string }>(
        functions,
        "https://getapplemusicdevtoken-or54ak2xqq-uc.a.run.app"
      );
      const tokenResult = await getDevToken();
      const devToken = tokenResult.data.token;

      setSaveState("authorizing");
      const kit = await initializeMusicKit(devToken);

      if (!kit.isAuthorized) {
        await kit.authorize();
      }

      setSaveState("creating");
      const trackIds = playlist.tracks.map(t => t.Apple_Music_ID);

      const result = await createAppleMusicPlaylist(devToken, {
        name: playlist.title,
        description: playlist.description,
        trackIds,
      });

      if (result.success) {
        setSavedPlaylistId(result.playlistId ?? null);
        setSaveState("success");
      } else {
        setErrorMessage(result.error ?? "Failed to create playlist");
        setSaveState("error");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unexpected error";
      if (msg.toLowerCase().includes("cancel") || msg.toLowerCase().includes("aborted")) {
        setSaveState("idle");
        return;
      }
      setErrorMessage(msg);
      setSaveState("error");
    }
  }, [playlist]);

  const handleRetry = useCallback(() => {
    setSaveState("idle");
    setErrorMessage(null);
  }, []);

  if (saveState === "success") {
    return (
      <div className={`flex flex-col items-center gap-2 ${className ?? ""}`}>
        <div className="flex items-center gap-2 text-sm font-medium text-green-400">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          Saved to Apple Music
        </div>
        <p className="text-xs text-white/35">
          {playlist.tracks.length} tracks · Open the Music app to listen
        </p>
        {savedPlaylistId && (
          <a
            href={`music://music.apple.com/library/playlists/${savedPlaylistId}`}
            className="text-xs text-blue-400 hover:text-blue-300 transition"
          >
            Open in Music app →
          </a>
        )}
      </div>
    );
  }

  if (saveState === "error") {
    return (
      <div className={`flex flex-col items-center gap-2 ${className ?? ""}`}>
        <div className="flex items-center gap-2 text-sm font-medium text-red-400">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
          Save failed
        </div>
        {errorMessage && (
          <p className="text-xs text-white/40 text-center max-w-xs">{errorMessage}</p>
        )}
        {errorMessage?.includes("subscription") && (
          <p className="text-xs text-white/25 text-center max-w-xs">
            An Apple Music subscription is required to save playlists.
          </p>
        )}
        <button onClick={handleRetry} className="text-xs text-blue-400 hover:text-blue-300 transition">
          Try again
        </button>
      </div>
    );
  }

  const isLoading = saveState !== "idle";

  const stateLabel: Record<SaveState, string> = {
    idle: "Save to Apple Music",
    fetching_token: "Connecting…",
    authorizing: "Sign in to Apple Music…",
    creating: "Creating playlist…",
    success: "Saved!",
    error: "Failed",
  };

  return (
    <button
      onClick={handleSave}
      disabled={isLoading}
      className={`
        flex items-center gap-2 px-5 py-2.5 rounded-full font-medium text-sm
        transition-all duration-200 text-white
        ${isLoading ? "opacity-50 cursor-not-allowed" : "hover:opacity-85 active:scale-95"}
        ${className ?? ""}
      `}
      style={{ background: isLoading ? "rgba(255,255,255,0.1)" : "#0a84ff" }}
    >
      {isLoading ? (
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <AppleMusicIcon />
      )}
      {stateLabel[saveState]}
    </button>
  );
}

function AppleMusicIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.5 7.5l-7 2v7c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2c.35 0 .68.09.97.25V8.18l7-2V7.5z" />
    </svg>
  );
}
