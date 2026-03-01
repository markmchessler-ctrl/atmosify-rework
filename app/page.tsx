"use client";
// app/page.tsx
// Atmosify — vibrant music club theme with big inviting textarea.

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
      {/* Stage indicator */}
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

      {/* Skeleton playlist header */}
      <div className="space-y-2.5">
        <div className="skeleton h-7 w-3/5 rounded-lg" />
        <div className="skeleton h-4 w-4/5 rounded-md" />
        <div className="skeleton h-3 w-2/5 rounded-md" />
      </div>

      {/* Skeleton Save button */}
      <div className="skeleton h-12 w-52 rounded-full" />

      {/* Skeleton track list */}
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

      {/* Elapsed */}
      <p className="text-center" style={{ fontSize: "11px", color: "var(--color-text-tertiary)", letterSpacing: "0.5px" }}>
        {elapsedSec}s · usually 90–120s
      </p>
    </div>
  );
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

const EXAMPLE_PROMPTS = [
  "chill late night R&B, warm and introspective, 20 minutes",
  "high energy workout, hip-hop and trap, 30 minutes",
  "ambient electronic, focus and flow, 45 minutes",
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

  return (
    <main className="min-h-screen bg-club">
      {/* Colorful orbs — ambient background light */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(168,85,247,0.5) 0%, transparent 70%)" }}
        />
        <div
          className="absolute top-1/4 -right-40 w-[600px] h-[600px] rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(236,72,153,0.5) 0%, transparent 70%)" }}
        />
        <div
          className="absolute -bottom-40 left-1/3 w-[500px] h-[500px] rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(59,130,246,0.5) 0%, transparent 70%)" }}
        />
      </div>

      <div
        className={`
          relative z-10 mx-auto max-w-[1200px] px-4 py-10 sm:py-16
          ${showRightPane ? "lg:grid lg:grid-cols-[minmax(360px,440px)_1fr] lg:gap-10 lg:items-start" : ""}
        `}
      >
        {/* ─── Left Pane: Prompt Area ──────────────────────────────────────── */}
        <div className={showRightPane ? "lg:sticky lg:top-12" : "max-w-2xl mx-auto"}>

          {/* Header */}
          <div className={`mb-8 ${showRightPane ? "lg:text-left" : "text-center"}`}>
            <h1
              className="font-extrabold tracking-tight"
              style={{
                fontSize: "2.5rem",
                lineHeight: "1.1",
                background: "linear-gradient(135deg, #c084fc, #ec4899, #f59e0b)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Atmosify
            </h1>
            <p className="mt-2 text-sm sm:text-base" style={{ color: "var(--color-text-secondary)" }}>
              Dolby Atmos playlists built from 100,000+ verified tracks
            </p>
          </div>

          {/* Prompt form */}
          {showPromptArea && (
            <div className="glass-card p-5 sm:p-6 mb-6">
              <form onSubmit={appState.kind === "clarify" ? handleClarifySubmit : handleSubmit}>

                {/* Clarification banner */}
                {appState.kind === "clarify" && (
                  <div
                    className="mb-4 p-4 rounded-2xl flex items-start gap-3"
                    style={{
                      background: "rgba(168, 85, 247, 0.1)",
                      border: "1px solid rgba(168, 85, 247, 0.2)",
                    }}
                  >
                    <span className="text-lg mt-0.5">💬</span>
                    <div>
                      <span className="font-semibold text-sm" style={{ color: "var(--color-accent-bright)" }}>
                        Quick question
                      </span>
                      <p className="text-sm mt-1" style={{ color: "var(--color-text-secondary)" }}>
                        {appState.question}
                      </p>
                    </div>
                  </div>
                )}

                {/* Error banner */}
                {appState.kind === "error" && (
                  <div
                    className="mb-4 p-4 rounded-2xl flex items-start gap-3"
                    style={{
                      background: "var(--color-error-bg)",
                      border: "1px solid rgba(248, 113, 113, 0.2)",
                    }}
                  >
                    <span className="text-lg mt-0.5">⚠️</span>
                    <p className="text-sm" style={{ color: "var(--color-error)" }}>
                      {appState.message}
                    </p>
                  </div>
                )}

                {/* Big textarea */}
                <div className="relative">
                  <textarea
                    ref={textareaRef}
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    placeholder="What do you want to hear? Describe a mood, a moment, an energy…"
                    rows={5}
                    autoFocus
                    className="w-full resize-none rounded-2xl px-5 py-4 text-base leading-relaxed focus:outline-none"
                    style={{
                      background: "var(--color-surface-input)",
                      border: "2px solid var(--color-border)",
                      color: "var(--color-text)",
                      minHeight: "140px",
                      transition: `border-color var(--duration-normal) var(--ease-out), box-shadow var(--duration-normal) var(--ease-out)`,
                    }}
                    onFocus={e => {
                      e.currentTarget.style.borderColor = "var(--color-accent)";
                      e.currentTarget.style.boxShadow = "0 0 0 4px var(--color-accent-glow)";
                    }}
                    onBlur={e => {
                      e.currentTarget.style.borderColor = "var(--color-border)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                    onKeyDown={e => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (prompt.trim()) runPipeline(prompt);
                      }
                    }}
                  />
                </div>

                {/* Build button — full width below textarea */}
                <button
                  type="submit"
                  disabled={!prompt.trim()}
                  className="btn-primary w-full mt-4 text-base"
                >
                  ✨ Build My Playlist
                </button>

                {/* Example chips */}
                {appState.kind === "idle" && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="text-xs mr-1 self-center" style={{ color: "var(--color-text-tertiary)" }}>
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
                        className="rounded-full px-3 py-1.5 text-xs transition-all"
                        style={{
                          background: "rgba(168, 85, 247, 0.08)",
                          border: "1px solid rgba(168, 85, 247, 0.2)",
                          color: "var(--color-accent-bright)",
                          fontWeight: 500,
                        }}
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                )}
              </form>
            </div>
          )}

          {/* Recent playlists */}
          {appState.kind === "idle" && recents.length > 0 && (
            <div className="mt-6">
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-text-tertiary)" }}>
                Recent playlists
              </p>
              <div className="space-y-2">
                {recents.map((item, i) => {
                  const pct =
                    item.playlist.tracks.length > 0
                      ? Math.round(
                          (item.playlist.atmosVerifiedCount /
                            item.playlist.tracks.length) *
                            100
                        )
                      : 0;
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        setPrompt(item.prompt);
                        setAppState({ kind: "result", playlist: item.playlist });
                      }}
                      className="w-full text-left rounded-2xl px-4 py-3.5 transition-all hover:scale-[1.01]"
                      style={{
                        background: "var(--color-surface)",
                        border: "1px solid var(--color-border)",
                        transition: `all var(--duration-normal) var(--ease-out)`,
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-sm font-semibold truncate leading-snug" style={{ color: "var(--color-text)" }}>
                          {item.playlist.title}
                        </span>
                        <span className="shrink-0 mt-px" style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                          {timeAgo(item.savedAt)}
                        </span>
                      </div>
                      <div className="text-xs truncate mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
                        {item.prompt}
                      </div>
                      <div className="flex items-center gap-2 mt-2" style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-tertiary)" }}>
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
          )}

          {/* Loading on mobile */}
          {appState.kind === "loading" && (
            <div className="lg:hidden">
              <LoadingView startedAt={appState.startedAt} />
            </div>
          )}
        </div>

        {/* ─── Right Pane: Loading / Results ────────────────────────────────── */}
        {showRightPane && (
          <div>
            {appState.kind === "loading" && (
              <div className="hidden lg:block">
                <LoadingView startedAt={appState.startedAt} />
              </div>
            )}

            {appState.kind === "result" && (
              <div>
                <PlaylistResults playlist={appState.playlist} />

                {/* Tweak form */}
                <form onSubmit={handleTweak} className="mt-6 flex gap-2">
                  <input
                    ref={tweakRef}
                    value={tweakInput}
                    onChange={e => setTweakInput(e.target.value)}
                    placeholder="Refine… more upbeat, add some jazz, etc."
                    className="flex-1 rounded-full px-5 py-3 text-sm focus:outline-none"
                    style={{
                      background: "var(--color-surface-input)",
                      border: "2px solid var(--color-border)",
                      color: "var(--color-text)",
                      minHeight: "48px",
                      transition: `border-color var(--duration-normal) var(--ease-out), box-shadow var(--duration-normal) var(--ease-out)`,
                    }}
                    onFocus={e => {
                      e.currentTarget.style.borderColor = "var(--color-accent)";
                      e.currentTarget.style.boxShadow = "0 0 0 3px var(--color-accent-glow)";
                    }}
                    onBlur={e => {
                      e.currentTarget.style.borderColor = "var(--color-border)";
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

                {/* Start over */}
                <div className="mt-5 text-center">
                  <button onClick={handleReset} className="btn-ghost">
                    ← Start over
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
