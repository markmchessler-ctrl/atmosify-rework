"use client";
// app/page.tsx
// Atmosify main page — dark branded theme with glass card input.

import { useState, useEffect, useRef, useCallback } from "react";
import { getFunctions, httpsCallableFromURL } from "firebase/functions";
import { app } from "./lib/firebase";
import { PlaylistResults } from "./components/PlaylistResults";
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

function LoadingView({ startedAt }: { startedAt: number }) {
  const elapsed = useElapsed(true, startedAt);
  const elapsedSec = Math.floor(elapsed / 1000);
  const stageMsg = LOADING_STAGES.reduce(
    (acc, stage) => (elapsed >= stage.delay ? stage.message : acc),
    LOADING_STAGES[0].message
  );
  // Fills to ~95% over 120s so it never appears complete before the result arrives
  const progressPct = Math.min(95, (elapsed / 120000) * 100);

  return (
    <div className="py-10 space-y-4">
      {/* Progress bar */}
      <div
        className="w-full h-0.5 rounded-full overflow-hidden"
        style={{ background: "rgba(255,255,255,0.08)" }}
      >
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${progressPct}%`,
            background: "linear-gradient(90deg, #4169e1, #0a84ff)",
          }}
        />
      </div>
      <p className="text-sm text-white/70">{stageMsg}</p>
      <p className="text-xs text-white/30">{elapsedSec}s · usually 90–120s</p>
    </div>
  );
}

const EXAMPLE_PROMPTS = [
  "chill late night R&B, warm and introspective, 20 minutes",
  "high energy workout, hip-hop and trap, 30 minutes",
  "ambient electronic, focus and flow, 45 minutes",
];

export default function AtmosifyPage() {
  const [prompt, setPrompt] = useState("");
  const [appState, setAppState] = useState<AppState>({ kind: "idle" });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const handleReset = () => {
    setAppState({ kind: "idle" });
    setPrompt("");
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  return (
    <main
      className="min-h-screen px-4 py-12 sm:py-20"
      style={{
        background:
          "radial-gradient(ellipse 150% 50% at 50% 0%, rgba(65,105,225,0.75) 0%, #000000 60%)",
      }}
    >
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="mb-10 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            Atmosify
          </h1>
          <p className="mt-2 text-white/45 text-sm sm:text-base">
            Dolby Atmos playlists built from 100,000+ verified tracks
          </p>
        </div>

        {/* Prompt form — glass card */}
        {(appState.kind === "idle" || appState.kind === "clarify" || appState.kind === "error") && (
          <div
            className="rounded-2xl p-5 mb-6"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.07)",
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
            }}
          >
            <form onSubmit={appState.kind === "clarify" ? handleClarifySubmit : handleSubmit}>

              {appState.kind === "clarify" && (
                <div
                  className="mb-4 p-3 rounded-xl text-sm text-blue-300"
                  style={{
                    background: "rgba(10,132,255,0.1)",
                    border: "1px solid rgba(10,132,255,0.18)",
                  }}
                >
                  <span className="font-medium">One quick question: </span>
                  {appState.question}
                </div>
              )}

              {appState.kind === "error" && (
                <div
                  className="mb-4 p-3 rounded-xl text-sm text-red-300"
                  style={{
                    background: "rgba(239,68,68,0.08)",
                    border: "1px solid rgba(239,68,68,0.18)",
                  }}
                >
                  {appState.message}
                </div>
              )}

              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder="Describe your vibe… e.g. chill late night R&B, warm and introspective, 20 minutes"
                  rows={3}
                  autoFocus
                  className="w-full resize-none rounded-xl px-4 py-3 pr-24 text-sm text-white placeholder-white/25 focus:outline-none transition"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.09)",
                    color: "white",
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = "rgba(10,132,255,0.5)")}
                  onBlur={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)")}
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
                  className="absolute bottom-3 right-3 px-3 py-1.5 rounded-lg text-white text-sm font-medium disabled:opacity-25 disabled:cursor-not-allowed hover:opacity-85 transition active:scale-95"
                  style={{ background: "#0a84ff" }}
                >
                  Build →
                </button>
              </div>

              {appState.kind === "idle" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {EXAMPLE_PROMPTS.map(ex => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => { setPrompt(ex); textareaRef.current?.focus(); }}
                      className="text-xs text-white/35 hover:text-white/60 hover:bg-white/5 px-2 py-1 rounded-lg transition"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              )}
            </form>
          </div>
        )}

        {appState.kind === "loading" && <LoadingView startedAt={appState.startedAt} />}

        {appState.kind === "result" && (
          <div>
            <PlaylistResults playlist={appState.playlist} />
            <div className="mt-8 text-center">
              <button
                onClick={handleReset}
                className="text-sm text-white/30 hover:text-white/60 transition"
              >
                ← Build another playlist
              </button>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}
