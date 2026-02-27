"use client";
// app/page.tsx
// Atmosify main page — prompt input → pipeline → playlist results.

import { useState, useEffect, useRef, useCallback } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./lib/firebase";
import { PlaylistResults } from "./components/PlaylistResults";
import type { AtmosPlaylist } from "../functions/src/lib/types";

// Pipeline takes ~90-150s; cycle through realistic stage messages
const LOADING_STAGES = [
  { delay: 0,    message: "Analyzing your request…" },
  { delay: 5000, message: "Discovering artists via Perplexity…" },
  { delay: 18000, message: "Searching 100k+ Atmos tracks…" },
  { delay: 35000, message: "Enriching tracks with mood & energy…" },
  { delay: 65000, message: "Curating your playlist with Gemini…" },
  { delay: 90000, message: "Verifying Dolby Atmos on Apple Music…" },
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

  // Pick the most recent stage message
  const stageMsg = LOADING_STAGES.reduce((acc, stage) => {
    return elapsed >= stage.delay ? stage.message : acc;
  }, LOADING_STAGES[0].message);

  return (
    <div className="flex flex-col items-center gap-6 py-16 text-center">
      <div className="relative w-16 h-16">
        <svg className="w-16 h-16 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
      <div>
        <p className="text-gray-700 font-medium">{stageMsg}</p>
        <p className="text-sm text-gray-400 mt-1">{elapsedSec}s elapsed · usually 90–120s</p>
      </div>
      <p className="text-xs text-gray-400 max-w-xs">
        We're searching 100,000+ Dolby Atmos tracks and curating a personalized playlist just for you.
      </p>
    </div>
  );
}

const EXAMPLE_PROMPTS = [
  "chill late night R&B, warm and introspective, 20 minutes",
  "high energy workout playlist, hip-hop and trap, 30 minutes",
  "ambient electronic, focus and flow, 45 minutes",
  "Sunday morning jazz and soul, relaxed, 25 minutes",
  "indie folk, melancholic and acoustic, 20 minutes",
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
      const runAtmosify = httpsCallable<
        { prompt: string },
        | { status: "success"; playlist: AtmosPlaylist }
        | { status: "needs_clarification"; clarificationQuestion: string }
        | { status: "error"; error: string }
      >(functions, "runAtmosify", { timeout: 570000 }); // 9.5 min timeout

      const result = await runAtmosify({ prompt: userPrompt });
      const data = result.data;

      if (data.status === "success") {
        setAppState({ kind: "result", playlist: data.playlist });
      } else if (data.status === "needs_clarification") {
        setAppState({ kind: "clarify", question: data.clarificationQuestion });
      } else {
        setAppState({ kind: "error", message: data.error ?? "Pipeline failed" });
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
    // Re-run with the clarification answer appended to the original prompt
    runPipeline(prompt);
  };

  const handleReset = () => {
    setAppState({ kind: "idle" });
    setPrompt("");
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  return (
    <main className="min-h-screen bg-white px-4 py-12 sm:py-20">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="mb-10 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 tracking-tight">
            Atmosify
          </h1>
          <p className="mt-2 text-gray-500 text-sm sm:text-base">
            Dolby Atmos playlists built from 100,000+ verified tracks
          </p>
        </div>

        {/* Prompt form — shown when idle or after clarification */}
        {(appState.kind === "idle" || appState.kind === "clarify" || appState.kind === "error") && (
          <form onSubmit={appState.kind === "clarify" ? handleClarifySubmit : handleSubmit} className="mb-6">

            {/* Clarification question */}
            {appState.kind === "clarify" && (
              <div className="mb-4 p-4 bg-blue-50 rounded-xl text-sm text-blue-800">
                <span className="font-medium">One quick question: </span>
                {appState.question}
              </div>
            )}

            {/* Error */}
            {appState.kind === "error" && (
              <div className="mb-4 p-4 bg-red-50 rounded-xl text-sm text-red-700">
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
                className="w-full resize-none rounded-2xl border border-gray-200 px-4 py-3 pr-24 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 transition"
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
                className="absolute bottom-3 right-3 px-3 py-1.5 rounded-xl bg-black text-white text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-800 transition active:scale-95"
              >
                Build →
              </button>
            </div>

            {/* Example prompts */}
            {appState.kind === "idle" && (
              <div className="mt-3 flex flex-wrap gap-2">
                {EXAMPLE_PROMPTS.slice(0, 3).map(ex => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => { setPrompt(ex); textareaRef.current?.focus(); }}
                    className="text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-100 px-2 py-1 rounded-lg transition"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            )}
          </form>
        )}

        {/* Loading state */}
        {appState.kind === "loading" && (
          <LoadingView startedAt={appState.startedAt} />
        )}

        {/* Results */}
        {appState.kind === "result" && (
          <div>
            <PlaylistResults playlist={appState.playlist} />
            <div className="mt-8 text-center">
              <button
                onClick={handleReset}
                className="text-sm text-gray-400 hover:text-gray-600 underline transition"
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
