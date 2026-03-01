"use client";
// app/page.tsx
// Atmosify — vibrant music club theme, fully fixed layout.

import { useState, useEffect, useRef, useCallback } from "react";
import { getFunctions, httpsCallableFromURL } from "firebase/functions";
import { app } from "./lib/firebase";
import { PlaylistResults } from "./components/PlaylistResults";
import {
  loadRecent,
  saveRecent,
  type StoredPlaylist,
} from "./lib/recentPlaylists";
import type { AtmosPlaylist } from "../src/lib/types";

const LOADING_STAGES = [
  { delay: 0,      message: "Analyzing your request…" },
  { delay: 5000,   message: "Discovering artists via Perplexity…" },
  { delay: 18000,  message: "Searching 100k+ Atmos tracks…" },
  { delay: 35000,  message: "Enriching tracks with mood & energy…" },
  { delay: 65000,  message: "Curating your playlist with Gemini…" },
  { delay: 90000,  message: "Verifying Dolby Atmos on Apple Music…" },
  { delay: 115000, message: "Assembling your playlist…" },
];

type AppState =
  | { kind: "idle" }
  | { kind: "loading"; startedAt: number }
  | { kind: "clarify"; question: string }
  | { kind: "result"; playlist: AtmosPlaylist }
  | { kind: "error"; message: string };

function useElapsed(active: boolean, startedAt: number | null): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active || startedAt == null) { setElapsed(0); return; }
    const iv = setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => clearInterval(iv);
  }, [active, startedAt]);
  return elapsed;
}

/* ─── Skeleton Loader ──────────────────────────────────────────────────────── */

function SkeletonTrackRow({ index }: { index: number }) {
  const titleWidth = 55 + ((index * 7) % 35);
  const artistWidth = 35 + ((index * 11) % 30);
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="skeleton w-11 h-11 rounded-xl shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="skeleton h-4 rounded-lg" style={{ width: `${titleWidth}%` }} />
        <div className="skeleton h-3 rounded-md" style={{ width: `${artistWidth}%` }} />
      </div>
      <div className="skeleton h-3 w-9 rounded-md shrink-0" />
    </div>
  );
}

function LoadingView({ startedAt }: { startedAt: number }) {
  const elapsed = useElapsed(true, startedAt);
  const elapsedSec = Math.floor(elapsed / 1000);
  const stageMsg = LOADING_STAGES.reduce(
    (acc, stage) => (elapsed >= stage.delay ? stage.message : acc),
    LOADING_STAGES[0].message
  );

  return (
    <div className="py-6 space-y-5">
      <div className="flex items-center gap-3">
        <div
          className="w-5 h-5 rounded-full border-2 animate-spin shrink-0"
          style={{
            borderColor: "rgba(168, 85, 247, 0.2)",
            borderTopColor: "var(--color-accent)",
          }}
        />
        <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
          {stageMsg}
        </p>
      </div>

      <div className="space-y-2.5">
        <div className="skeleton h-7 w-3/5 rounded-lg" />
        <div className="skeleton h-4 w-4/5 rounded-md" />
        <div className="skeleton h-3 w-2/5 rounded-md" />
      </div>

      <div className="skeleton h-12 w-52 rounded-full" />

      <div className="glass-card-raised overflow-hidden !rounded-2xl">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i}>
            {i > 0 && (
              <div className="mx-4" style={{ height: "1px", background: "var(--color-border-subtle)" }} />
            )}
            <SkeletonTrackRow index={i} />
          </div>
        ))}
      </div>

      <p className="text-center" style={{ fontSize: "11px", color: "var(--color-text-tertiary)", letterSpacing: "0.5px" }}>
        {elapsedSec}s · usually 90–120s
      </p>
    </div>
  );
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

const EXAMPLE_PROMPTS = [
  "chill late night R&B, warm and introspective",
  "high energy workout, hip-hop and trap",
  "ambient electronic for deep focus",
];

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function fmtDuration(ms: number): string {
  const totalMins = Math.round(ms / 60000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* ─── Background Orbs ──────────────────────────────────────────────────────── */

function BackgroundOrbs() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
      {/* Purple — top left */}
      <div
        style={{
          position: "absolute",
          top: "-160px",
          left: "-160px",
          width: "700px",
          height: "700px",
          borderRadius: "9999px",
          background: "radial-gradient(circle, rgba(168,85,247,0.7) 0%, transparent 65%)",
          filter: "blur(80px)",
          opacity: 0.55,
        }}
      />
      {/* Pink — top right */}
      <div
        style={{
          position: "absolute",
          top: "5%",
          right: "-200px",
          width: "750px",
          height: "750px",
          borderRadius: "9999px",
          background: "radial-gradient(circle, rgba(236,72,153,0.65) 0%, transparent 65%)",
          filter: "blur(80px)",
          opacity: 0.45,
        }}
      />
      {/* Blue — bottom center */}
      <div
        style={{
          position: "absolute",
          bottom: "-180px",
          left: "30%",
          width: "700px",
          height: "700px",
          borderRadius: "9999px",
          background: "radial-gradient(circle, rgba(59,130,246,0.6) 0%, transparent 65%)",
          filter: "blur(80px)",
          opacity: 0.4,
        }}
      />
    </div>
  );
}

/* ─── Main Page ────────────────────────────────────────────────────────────── */

export default function AtmosifyPage() {
  const [prompt, setPrompt] = useState("");
  const [tweakInput, setTweakInput] = useState("");
  const [appState, setAppState] = useState<AppState>({ kind: "idle" });
  const [recents, setRecents] = useState<StoredPlaylist[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tweakRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecents(loadRecent());
  }, []);

  const runPipeline = useCallback(async (userPrompt: string) => {
    if (!userPrompt.trim()) return;
    setAppState({ kind: "loading", startedAt: Date.now() });

    try {
      const functions = getFunctions(app);
      const runAtmosify = httpsCallableFromURL<
        { prompt: string },
        | { status: "success"; playlist: AtmosPlaylist }
        | { status: "needs_clarification"; clarificationQuestion: string }
        | { status: "error"; error: string }
      >(functions, "https://runatmosify-or54ak2xqq-uc.a.run.app", { timeout: 570000 });

      const result = await runAtmosify({ prompt: userPrompt });
      const data = result.data;

      if (data.status === "success") {
        setAppState({ kind: "result", playlist: data.playlist });
        setRecents(saveRecent(userPrompt, data.playlist));
      } else if (data.status === "needs_clarification") {
        setAppState({ kind: "clarify", question: data.clarificationQuestion });
      } else {
        setAppState({ kind: "error", message: (data as { error: string }).error ?? "Pipeline failed" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unexpected error";
      setAppState({ kind: "error", message: msg });
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runPipeline(prompt);
  };

  const handleClarifySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runPipeline(prompt);
  };

  const handleTweak = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tweakInput.trim()) return;
    const refined = `${prompt}. Refine: ${tweakInput.trim()}`;
    setTweakInput("");
    runPipeline(refined);
  };

  const handleReset = () => {
    setAppState({ kind: "idle" });
    setPrompt("");
    setTweakInput("");
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const showPromptArea =
    appState.kind === "idle" ||
    appState.kind === "clarify" ||
    appState.kind === "error";

  const showRightPane =
    appState.kind === "loading" || appState.kind === "result";

  /* ── Shared: Prompt Form ─────────────────────────────────────────────────── */

  const promptForm = showPromptArea ? (
    <div
      style={{
        background: "rgba(255,255,255,0.04)",
        backdropFilter: "blur(40px)",
        WebkitBackdropFilter: "blur(40px)",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: "24px",
        padding: "24px",
        marginBottom: "20px",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <form
        onSubmit={appState.kind === "clarify" ? handleClarifySubmit : handleSubmit}
        style={{ width: "100%", display: "flex", flexDirection: "column", gap: "0" }}
      >
        {/* Clarification banner */}
        {appState.kind === "clarify" && (
          <div
            style={{
              marginBottom: "16px",
              padding: "16px",
              borderRadius: "16px",
              display: "flex",
              alignItems: "flex-start",
              gap: "12px",
              background: "rgba(168, 85, 247, 0.1)",
              border: "1px solid rgba(168, 85, 247, 0.2)",
            }}
          >
            <span style={{ fontSize: "18px", marginTop: "2px" }}>💬</span>
            <div>
              <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--color-accent-bright)", display: "block" }}>
                Quick question
              </span>
              <p style={{ fontSize: "14px", marginTop: "4px", color: "var(--color-text-secondary)" }}>
                {appState.question}
              </p>
            </div>
          </div>
        )}

        {/* Error banner */}
        {appState.kind === "error" && (
          <div
            style={{
              marginBottom: "16px",
              padding: "16px",
              borderRadius: "16px",
              display: "flex",
              alignItems: "flex-start",
              gap: "12px",
              background: "var(--color-error-bg)",
              border: "1px solid rgba(248, 113, 113, 0.2)",
            }}
          >
            <span style={{ fontSize: "18px", marginTop: "2px" }}>⚠️</span>
            <p style={{ fontSize: "14px", color: "var(--color-error)" }}>
              {appState.message}
            </p>
          </div>
        )}

        {/* Big textarea — explicit width 100%, no Tailwind w-full reliance */}
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="What do you want to hear? Describe a mood, a moment, an energy…"
          rows={5}
          autoFocus
          style={{
            width: "100%",
            boxSizing: "border-box",
            display: "block",
            resize: "none",
            borderRadius: "16px",
            padding: "16px 20px",
            fontSize: "16px",
            lineHeight: "1.6",
            fontFamily: "inherit",
            background: "rgba(255,255,255,0.06)",
            border: "2px solid rgba(255,255,255,0.10)",
            color: "var(--color-text)",
            minHeight: "148px",
            outline: "none",
            transition: "border-color 0.25s ease, box-shadow 0.25s ease",
          }}
          onFocus={e => {
            e.currentTarget.style.borderColor = "var(--color-accent)";
            e.currentTarget.style.boxShadow = "0 0 0 4px var(--color-accent-glow)";
          }}
          onBlur={e => {
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)";
            e.currentTarget.style.boxShadow = "none";
          }}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (prompt.trim()) runPipeline(prompt);
            }
          }}
        />

        {/* Build button — explicit full-width, overrides inline-flex */}
        <button
          type="submit"
          disabled={!prompt.trim()}
          style={{
            marginTop: "12px",
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            background: "linear-gradient(135deg, var(--color-accent), var(--color-pink))",
            color: "#fff",
            borderRadius: "9999px",
            fontSize: "16px",
            fontWeight: 700,
            letterSpacing: "0.02em",
            padding: "14px 28px",
            minHeight: "52px",
            border: "none",
            cursor: prompt.trim() ? "pointer" : "not-allowed",
            opacity: prompt.trim() ? 1 : 0.4,
            boxShadow: prompt.trim() ? "0 4px 24px rgba(168, 85, 247, 0.4)" : "none",
            transition: "all 0.25s ease",
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
        >
          ✨ Build My Playlist
        </button>

        {/* Example chips */}
        {appState.kind === "idle" && (
          <div style={{ marginTop: "16px", display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
            <span style={{ fontSize: "12px", color: "var(--color-text-tertiary)", fontWeight: 500 }}>
              Try:
            </span>
            {EXAMPLE_PROMPTS.map(ex => (
              <button
                key={ex}
                type="button"
                onClick={() => {
                  setPrompt(ex);
                  textareaRef.current?.focus();
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "6px 14px",
                  borderRadius: "9999px",
                  fontSize: "12px",
                  fontWeight: 500,
                  background: "rgba(168, 85, 247, 0.10)",
                  border: "1px solid rgba(168, 85, 247, 0.25)",
                  color: "var(--color-accent-bright)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "all 0.15s ease",
                  WebkitAppearance: "none",
                  appearance: "none",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = "rgba(168, 85, 247, 0.2)";
                  e.currentTarget.style.borderColor = "rgba(168, 85, 247, 0.5)";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = "rgba(168, 85, 247, 0.10)";
                  e.currentTarget.style.borderColor = "rgba(168, 85, 247, 0.25)";
                }}
              >
                {ex}
              </button>
            ))}
          </div>
        )}
      </form>
    </div>
  ) : null;

  /* ── Shared: Header ──────────────────────────────────────────────────────── */

  const header = (centered: boolean) => (
    <div style={{ marginBottom: "32px", textAlign: centered ? "center" : "left" }}>
      <h1
        style={{
          fontSize: "clamp(2.2rem, 8vw, 3rem)",
          fontWeight: 800,
          lineHeight: 1.1,
          letterSpacing: "-0.02em",
          background: "linear-gradient(135deg, #c084fc 0%, #ec4899 50%, #f59e0b 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          margin: 0,
        }}
      >
        Atmosify
      </h1>
      <p style={{ marginTop: "8px", fontSize: "15px", color: "var(--color-text-secondary)" }}>
        Dolby Atmos playlists built from 100,000+ verified tracks
      </p>
    </div>
  );

  /* ── Shared: Recent Playlists ────────────────────────────────────────────── */

  const recentPlaylists = appState.kind === "idle" && recents.length > 0 ? (
    <div style={{ marginTop: "24px" }}>
      <p style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--color-text-tertiary)", marginBottom: "12px" }}>
        Recent playlists
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {recents.map((item, i) => {
          const pct =
            item.playlist.tracks.length > 0
              ? Math.round((item.playlist.atmosVerifiedCount / item.playlist.tracks.length) * 100)
              : 0;
          return (
            <button
              key={i}
              onClick={() => {
                setPrompt(item.prompt);
                setAppState({ kind: "result", playlist: item.playlist });
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                borderRadius: "16px",
                padding: "14px 16px",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                cursor: "pointer",
                fontFamily: "inherit",
                WebkitAppearance: "none",
                appearance: "none",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
                <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.playlist.title}
                </span>
                <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)", flexShrink: 0, marginTop: "2px" }}>
                  {timeAgo(item.savedAt)}
                </span>
              </div>
              <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: "2px" }}>
                {item.prompt}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px", fontSize: "11px", fontWeight: 500, color: "var(--color-text-tertiary)" }}>
                <span>{item.playlist.tracks.length} tracks</span>
                <span>·</span>
                <span>{fmtDuration(item.playlist.totalDurationMs)}</span>
                <span>·</span>
                <span style={{ color: "var(--color-accent-bright)" }}>{pct}% Atmos</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  /* ── Render ──────────────────────────────────────────────────────────────── */

  return (
    <main
      className="bg-club"
      style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}
    >
      <BackgroundOrbs />

      {/* ── Two-pane layout (loading / result) ────────────────────────────── */}
      {showRightPane && (
        <div
          style={{
            position: "relative",
            zIndex: 10,
            width: "100%",
            maxWidth: "1200px",
            margin: "0 auto",
            padding: "40px 16px 64px",
          }}
        >
          {/* On large screens: side-by-side grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "clamp(320px, 36%, 440px) 1fr",
              gap: "40px",
              alignItems: "start",
            }}
            className="two-pane-grid"
          >
            {/* Left: compact header */}
            <div style={{ position: "sticky", top: "48px" }}>
              {header(false)}
              {appState.kind === "loading" && (
                <div className="lg:hidden">
                  <LoadingView startedAt={appState.startedAt} />
                </div>
              )}
            </div>

            {/* Right: loading / results */}
            <div>
              {appState.kind === "loading" && (
                <div className="hidden lg:block">
                  <LoadingView startedAt={appState.startedAt} />
                </div>
              )}

              {appState.kind === "result" && (
                <div>
                  <PlaylistResults playlist={appState.playlist} />

                  {/* Tweak */}
                  <form onSubmit={handleTweak} style={{ marginTop: "24px", display: "flex", gap: "8px" }}>
                    <input
                      ref={tweakRef}
                      value={tweakInput}
                      onChange={e => setTweakInput(e.target.value)}
                      placeholder="Refine… more upbeat, add some jazz, etc."
                      style={{
                        flex: 1,
                        borderRadius: "9999px",
                        padding: "12px 20px",
                        fontSize: "14px",
                        fontFamily: "inherit",
                        background: "rgba(255,255,255,0.06)",
                        border: "2px solid rgba(255,255,255,0.10)",
                        color: "var(--color-text)",
                        minHeight: "48px",
                        outline: "none",
                        transition: "border-color 0.25s ease, box-shadow 0.25s ease",
                      }}
                      onFocus={e => {
                        e.currentTarget.style.borderColor = "var(--color-accent)";
                        e.currentTarget.style.boxShadow = "0 0 0 3px var(--color-accent-glow)";
                      }}
                      onBlur={e => {
                        e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)";
                        e.currentTarget.style.boxShadow = "none";
                      }}
                    />
                    <button
                      type="submit"
                      disabled={!tweakInput.trim()}
                      className="btn-primary shrink-0 !px-6"
                    >
                      Refine
                    </button>
                  </form>

                  <div style={{ marginTop: "20px", textAlign: "center" }}>
                    <button onClick={handleReset} className="btn-ghost">
                      ← Start over
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* On mobile: stacked */}
          <style>{`
            @media (max-width: 767px) {
              .two-pane-grid {
                grid-template-columns: 1fr !important;
              }
            }
          `}</style>
        </div>
      )}

      {/* ── Centered single-pane layout (idle / clarify / error) ──────────── */}
      {!showRightPane && (
        <div
          style={{
            position: "relative",
            zIndex: 10,
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "48px 16px",
            minHeight: "100vh",
          }}
        >
          <div style={{ width: "100%", maxWidth: "520px" }}>
            {header(true)}
            {promptForm}
            {recentPlaylists}
          </div>
        </div>
      )}
    </main>
  );
}
