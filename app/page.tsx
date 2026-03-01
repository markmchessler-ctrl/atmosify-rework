"use client";
// app/page.tsx
// Atmosify main page — Material 3 dark theme with responsive two-pane layout.

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
            borderColor: "var(--md-sys-color-outline-variant)",
            borderTopColor: "var(--md-sys-color-primary)",
          }}
        />
        <p
          className="text-sm"
          style={{ color: "var(--md-sys-color-on-surface-variant)" }}
        >
          {stageMsg}
        </p>
      </div>

      {/* Skeleton playlist header */}
      <div className="space-y-2.5">
        <div className="skeleton h-6 w-3/5 rounded-lg" />
        <div className="skeleton h-4 w-4/5 rounded-md" />
        <div className="skeleton h-3 w-2/5 rounded-md" />
      </div>

      {/* Skeleton Save button */}
      <div className="skeleton h-11 w-48 rounded-full" />

      {/* Skeleton track list */}
      <div
        className="rounded-3xl overflow-hidden"
        style={{
          background: "var(--md-sys-color-surface-container-lowest)",
          border: "1px solid var(--md-sys-color-outline-variant)",
        }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i}>
            {i > 0 && (
              <div
                className="mx-4"
                style={{ height: "1px", background: "var(--md-sys-color-outline-variant)" }}
              />
            )}
            <SkeletonTrackRow index={i} />
          </div>
        ))}
      </div>

      {/* Elapsed timer */}
      <p
        className="text-center"
        style={{
          fontSize: "11px",
          letterSpacing: "0.5px",
          color: "var(--md-sys-color-outline)",
        }}
      >
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
    <main className="min-h-screen" style={{ background: "var(--md-sys-color-surface)" }}>
      {/* Subtle branded gradient overlay */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 120% 40% at 50% 0%, rgba(59,91,169,0.15) 0%, transparent 60%)",
        }}
      />

      <div
        className={`
          relative z-10 mx-auto max-w-[1200px] px-4 py-12 sm:py-16
          ${showRightPane ? "lg:grid lg:grid-cols-[minmax(340px,420px)_1fr] lg:gap-10 lg:items-start" : ""}
        `}
      >
        {/* ─── Left Pane: Prompt Area ──────────────────────────────────────── */}
        <div
          className={`
            ${showRightPane ? "lg:sticky lg:top-16" : "max-w-2xl mx-auto"}
          `}
        >
          {/* Header */}
          <div className={`mb-8 ${showRightPane ? "lg:text-left" : "text-center"}`}>
            <h1
              className="font-bold tracking-tight"
              style={{
                fontSize: "2rem",
                lineHeight: "2.5rem",
                color: "var(--md-sys-color-on-surface)",
              }}
            >
              Atmosify
            </h1>
            <p
              className="mt-1.5"
              style={{
                fontSize: "14px",
                lineHeight: "20px",
                letterSpacing: "0.25px",
                color: "var(--md-sys-color-on-surface-variant)",
              }}
            >
              Dolby Atmos playlists built from 100,000+ verified tracks
            </p>
          </div>

          {/* Prompt form — M3 card */}
          {showPromptArea && (
            <div
              className="rounded-3xl p-5 mb-6"
              style={{
                background: "var(--md-sys-color-surface-container-low)",
                border: "1px solid var(--md-sys-color-outline-variant)",
              }}
            >
              <form onSubmit={appState.kind === "clarify" ? handleClarifySubmit : handleSubmit}>

                {/* Clarification banner */}
                {appState.kind === "clarify" && (
                  <div
                    className="mb-4 p-4 rounded-2xl flex items-start gap-3"
                    style={{
                      background: "var(--md-sys-color-surface-container)",
                      border: "1px solid var(--md-sys-color-outline-variant)",
                    }}
                  >
                    <svg
                      className="w-5 h-5 shrink-0 mt-0.5"
                      style={{ color: "var(--md-sys-color-primary)" }}
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <div>
                      <span
                        className="font-medium text-sm"
                        style={{ color: "var(--md-sys-color-on-surface)" }}
                      >
                        One quick question
                      </span>
                      <p
                        className="text-sm mt-1"
                        style={{ color: "var(--md-sys-color-on-surface-variant)" }}
                      >
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
                      background: "var(--md-sys-color-error-container)",
                    }}
                  >
                    <svg
                      className="w-5 h-5 shrink-0 mt-0.5"
                      style={{ color: "var(--md-sys-color-on-error-container)" }}
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <p
                      className="text-sm"
                      style={{ color: "var(--md-sys-color-on-error-container)" }}
                    >
                      {appState.message}
                    </p>
                  </div>
                )}

                {/* Textarea — M3 outlined text field */}
                <div className="relative">
                  <textarea
                    ref={textareaRef}
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    placeholder="Describe your vibe… e.g. chill late night R&B, warm and introspective, 20 minutes"
                    rows={3}
                    autoFocus
                    className="w-full resize-none rounded-2xl px-4 py-3 pr-24 text-sm focus:outline-none"
                    style={{
                      background: "var(--md-sys-color-surface-container)",
                      border: "2px solid var(--md-sys-color-outline-variant)",
                      color: "var(--md-sys-color-on-surface)",
                      fontSize: "14px",
                      lineHeight: "20px",
                      letterSpacing: "0.25px",
                      transition: `border-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard)`,
                    }}
                    onFocus={e =>
                      (e.currentTarget.style.borderColor = "var(--md-sys-color-primary)")
                    }
                    onBlur={e =>
                      (e.currentTarget.style.borderColor = "var(--md-sys-color-outline-variant)")
                    }
                    onKeyDown={e => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (prompt.trim()) runPipeline(prompt);
                      }
                    }}
                  />
                  <button
                    type="submit"
                    disabled={!prompt.trim()}
                    className="btn-filled absolute bottom-3 right-3 !px-5 !py-2 !min-h-[40px] text-sm"
                  >
                    Build
                  </button>
                </div>

                {/* Example chips — M3 suggestion chips */}
                {appState.kind === "idle" && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {EXAMPLE_PROMPTS.map(ex => (
                      <button
                        key={ex}
                        type="button"
                        onClick={() => {
                          setPrompt(ex);
                          textareaRef.current?.focus();
                        }}
                        className="rounded-full px-3.5 py-2 text-xs transition-all hover:bg-white/[0.06]"
                        style={{
                          border: "1px solid var(--md-sys-color-outline)",
                          color: "var(--md-sys-color-on-surface-variant)",
                          fontWeight: 500,
                          letterSpacing: "0.1px",
                          minHeight: "32px",
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

          {/* Recent playlists — idle state only */}
          {appState.kind === "idle" && recents.length > 0 && (
            <div className="mt-6">
              <p
                style={{
                  fontSize: "11px",
                  fontWeight: 500,
                  letterSpacing: "0.5px",
                  textTransform: "uppercase",
                  color: "var(--md-sys-color-on-surface-variant)",
                  marginBottom: "12px",
                }}
              >
                Recent
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
                      className="w-full text-left rounded-2xl px-4 py-3.5 transition-all hover:bg-white/[0.04]"
                      style={{
                        background: "var(--md-sys-color-surface-container-low)",
                        border: "1px solid var(--md-sys-color-outline-variant)",
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span
                          className="text-sm font-medium truncate leading-snug"
                          style={{ color: "var(--md-sys-color-on-surface)" }}
                        >
                          {item.playlist.title}
                        </span>
                        <span
                          className="shrink-0 mt-px"
                          style={{
                            fontSize: "11px",
                            color: "var(--md-sys-color-outline)",
                          }}
                        >
                          {timeAgo(item.savedAt)}
                        </span>
                      </div>
                      <div
                        className="text-xs truncate mt-0.5"
                        style={{ color: "var(--md-sys-color-on-surface-variant)" }}
                      >
                        {item.prompt}
                      </div>
                      <div
                        className="flex items-center gap-2 mt-2"
                        style={{
                          fontSize: "12px",
                          fontWeight: 500,
                          letterSpacing: "0.5px",
                          color: "var(--md-sys-color-outline)",
                        }}
                      >
                        <span>{item.playlist.tracks.length} tracks</span>
                        <span style={{ color: "var(--md-sys-color-outline-variant)" }}>·</span>
                        <span>{fmtDuration(item.playlist.totalDurationMs)}</span>
                        <span style={{ color: "var(--md-sys-color-outline-variant)" }}>·</span>
                        <span>{pct}% Atmos</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Prompt area also visible during loading on mobile (collapsed on desktop) */}
          {appState.kind === "loading" && (
            <div className="lg:hidden">
              <LoadingView startedAt={appState.startedAt} />
            </div>
          )}
        </div>

        {/* ─── Right Pane: Loading / Results (desktop) ─────────────────────── */}
        {showRightPane && (
          <div>
            {/* Loading — desktop only (mobile shown above in left pane) */}
            {appState.kind === "loading" && (
              <div className="hidden lg:block">
                <LoadingView startedAt={appState.startedAt} />
              </div>
            )}

            {appState.kind === "result" && (
              <div>
                <PlaylistResults playlist={appState.playlist} />

                {/* Tweak / refine form */}
                <form onSubmit={handleTweak} className="mt-6 flex gap-2">
                  <input
                    ref={tweakRef}
                    value={tweakInput}
                    onChange={e => setTweakInput(e.target.value)}
                    placeholder="Refine… e.g. more upbeat, add some jazz"
                    className="flex-1 rounded-full px-4 py-2.5 text-sm focus:outline-none"
                    style={{
                      background: "var(--md-sys-color-surface-container)",
                      border: "2px solid var(--md-sys-color-outline-variant)",
                      color: "var(--md-sys-color-on-surface)",
                      minHeight: "44px",
                      letterSpacing: "0.25px",
                      transition: `border-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard)`,
                    }}
                    onFocus={e =>
                      (e.currentTarget.style.borderColor = "var(--md-sys-color-primary)")
                    }
                    onBlur={e =>
                      (e.currentTarget.style.borderColor = "var(--md-sys-color-outline-variant)")
                    }
                  />
                  <button
                    type="submit"
                    disabled={!tweakInput.trim()}
                    className="btn-filled !px-5 shrink-0"
                  >
                    Refine
                  </button>
                </form>

                {/* Start over */}
                <div className="mt-5 text-center">
                  <button onClick={handleReset} className="btn-text">
                    Start over
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
