"use client";
// app/share/page.tsx
// Shared playlist viewer — fetches from Firestore sharedPlaylists collection.

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { app } from "../lib/firebase";
import { PlaylistResults } from "../components/PlaylistResults";
import type { AtmosPlaylist } from "../../src/lib/types";

type ShareState =
  | { kind: "loading" }
  | { kind: "found"; playlist: AtmosPlaylist }
  | { kind: "expired" }
  | { kind: "error"; message: string };

export default function SharePage() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const [state, setState] = useState<ShareState>({ kind: "loading" });

  useEffect(() => {
    if (!id) {
      setState({ kind: "error", message: "No playlist ID provided." });
      return;
    }

    const db = getFirestore(app);
    getDoc(doc(db, "sharedPlaylists", id))
      .then((snap) => {
        if (!snap.exists()) {
          setState({ kind: "expired" });
          return;
        }
        const data = snap.data();
        if (data.expiresAt && data.expiresAt < Date.now()) {
          setState({ kind: "expired" });
          return;
        }
        setState({ kind: "found", playlist: data.playlist as AtmosPlaylist });
      })
      .catch((err) => {
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to load playlist",
        });
      });
  }, [id]);

  return (
    <main
      className="bg-club"
      style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}
    >
      {/* Background orbs — simplified version */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
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
        <div
          style={{
            position: "absolute",
            bottom: "-180px",
            right: "-100px",
            width: "700px",
            height: "700px",
            borderRadius: "9999px",
            background: "radial-gradient(circle, rgba(59,130,246,0.6) 0%, transparent 65%)",
            filter: "blur(80px)",
            opacity: 0.4,
          }}
        />
      </div>

      <div
        style={{
          position: "relative",
          zIndex: 10,
          width: "100%",
          maxWidth: "720px",
          margin: "0 auto",
          padding: "40px 16px 64px",
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: "32px", textAlign: "center" }}>
          <a href="/" style={{ textDecoration: "none" }}>
            <h1
              style={{
                fontSize: "clamp(1.8rem, 6vw, 2.4rem)",
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
          </a>
          <p style={{ marginTop: "6px", fontSize: "13px", color: "var(--color-text-tertiary)" }}>
            Shared playlist
          </p>
        </div>

        {/* Loading */}
        {state.kind === "loading" && (
          <div style={{ textAlign: "center", padding: "48px 0" }}>
            <div
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "50%",
                border: "3px solid rgba(168, 85, 247, 0.2)",
                borderTopColor: "var(--color-accent)",
                animation: "spin 0.8s linear infinite",
                margin: "0 auto 16px",
              }}
            />
            <p style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
              Loading playlist...
            </p>
          </div>
        )}

        {/* Expired */}
        {state.kind === "expired" && (
          <div
            style={{
              textAlign: "center",
              padding: "48px 24px",
              background: "rgba(255,255,255,0.04)",
              borderRadius: "24px",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <p style={{ fontSize: "48px", marginBottom: "16px" }}>
              :(
            </p>
            <p style={{ fontSize: "18px", fontWeight: 600, color: "var(--color-text)" }}>
              This playlist has expired
            </p>
            <p style={{ fontSize: "14px", color: "var(--color-text-secondary)", marginTop: "8px" }}>
              Shared playlists are available for 30 days.
            </p>
            <a
              href="/"
              style={{
                display: "inline-block",
                marginTop: "24px",
                padding: "12px 28px",
                borderRadius: "9999px",
                background: "linear-gradient(135deg, var(--color-accent), var(--color-pink))",
                color: "#fff",
                fontWeight: 700,
                fontSize: "14px",
                textDecoration: "none",
              }}
            >
              Build your own playlist
            </a>
          </div>
        )}

        {/* Error */}
        {state.kind === "error" && (
          <div
            style={{
              textAlign: "center",
              padding: "48px 24px",
              background: "var(--color-error-bg)",
              borderRadius: "24px",
              border: "1px solid rgba(248, 113, 113, 0.2)",
            }}
          >
            <p style={{ fontSize: "16px", color: "var(--color-error)" }}>
              {state.message}
            </p>
            <a
              href="/"
              className="btn-ghost"
              style={{ display: "inline-block", marginTop: "16px", textDecoration: "none" }}
            >
              Go home
            </a>
          </div>
        )}

        {/* Found — render playlist */}
        {state.kind === "found" && (
          <div>
            <PlaylistResults playlist={state.playlist} />
            <div style={{ marginTop: "32px", textAlign: "center" }}>
              <a
                href="/"
                style={{
                  display: "inline-block",
                  padding: "14px 32px",
                  borderRadius: "9999px",
                  background: "linear-gradient(135deg, var(--color-accent), var(--color-pink))",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: "15px",
                  textDecoration: "none",
                  boxShadow: "0 4px 24px rgba(168, 85, 247, 0.4)",
                }}
              >
                Build your own Atmos playlist
              </a>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
