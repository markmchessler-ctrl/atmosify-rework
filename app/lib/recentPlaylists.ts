// app/lib/recentPlaylists.ts
// Persist the last N Atmosify results in localStorage.

import type { AtmosPlaylist } from "../../src/lib/types";

const STORAGE_KEY = "atmosify_recent";
const MAX_ENTRIES = 5;

export interface StoredPlaylist {
  savedAt: number;   // unix ms
  prompt: string;    // the prompt that produced this playlist
  playlist: AtmosPlaylist;
}

export function loadRecent(): StoredPlaylist[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredPlaylist[]) : [];
  } catch {
    return [];
  }
}

export function saveRecent(prompt: string, playlist: AtmosPlaylist): StoredPlaylist[] {
  try {
    const existing = loadRecent();
    const entry: StoredPlaylist = { savedAt: Date.now(), prompt, playlist };
    // Deduplicate by title — keep the newest version of any same-titled playlist
    const deduped = existing.filter(e => e.playlist.title !== playlist.title);
    const updated = [entry, ...deduped].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}
