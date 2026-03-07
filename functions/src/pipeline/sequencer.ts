// src/pipeline/sequencer.ts
// Post-curation algorithmic sequencing optimizer.
//
// Re-orders verified tracks for smooth transitions using:
//   - BPM proximity (30% weight)
//   - Energy arc alignment (30% weight)
//   - Camelot key compatibility (20% weight)
//   - Vibe tag similarity (20% weight)
//
// Adaptive structure: single arc for short playlists, multi-set for 60+ min.

import type { VerifiedTrack, PlaylistIntent } from "../lib/types.js";

const DEFAULT_DURATION_MS = 240_000;
const TRACKS_PER_SET = 12;
const MIN_TRACKS_FOR_MULTI_SET = 16;

// Transition scoring weights
const W_BPM = 0.30;
const W_ENERGY = 0.30;
const W_KEY = 0.20;
const W_VIBE = 0.20;

// --- Camelot Wheel ---

/**
 * Parse a Camelot notation string (e.g. "8B", "3A") into number + letter.
 * Returns null for invalid/missing keys.
 */
function parseCamelot(key: string | undefined): { num: number; letter: "A" | "B" } | null {
  if (!key) return null;
  const match = key.trim().match(/^(\d{1,2})([AB])$/i);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  if (num < 1 || num > 12) return null;
  return { num, letter: match[2].toUpperCase() as "A" | "B" };
}

/**
 * Camelot wheel compatibility score between two keys.
 * Same key = 1.0, adjacent number = 0.8, relative major/minor = 0.7,
 * two steps = 0.4, distant = 0.2, unknown = 0.5.
 */
function camelotCompatibility(keyA: string | undefined, keyB: string | undefined): number {
  const a = parseCamelot(keyA);
  const b = parseCamelot(keyB);

  // If either key is unknown, return neutral score
  if (!a || !b) return 0.5;

  // Same key
  if (a.num === b.num && a.letter === b.letter) return 1.0;

  // Relative major/minor (same number, different letter)
  if (a.num === b.num && a.letter !== b.letter) return 0.7;

  // Adjacent numbers (circular: 12 wraps to 1)
  const diff = Math.abs(a.num - b.num);
  const circularDiff = Math.min(diff, 12 - diff);

  if (circularDiff === 1 && a.letter === b.letter) return 0.8;
  if (circularDiff === 1 && a.letter !== b.letter) return 0.5;
  if (circularDiff === 2 && a.letter === b.letter) return 0.4;

  return 0.2;
}

// --- Scoring Functions ---

/**
 * BPM transition score: 1.0 if within 5 BPM, linear decay to 0 at 30+ BPM gap.
 */
function bpmScore(bpmA: number | undefined, bpmB: number | undefined): number {
  if (bpmA == null || bpmB == null) return 0.5; // neutral if unknown
  const gap = Math.abs(bpmA - bpmB);
  if (gap <= 5) return 1.0;
  if (gap >= 30) return 0.0;
  return 1.0 - (gap - 5) / 25;
}

/**
 * Energy transition score incorporating arc target.
 * Rewards smooth transitions AND alignment with the target energy at this position.
 */
function energyScore(
  energyA: number | undefined,
  energyB: number | undefined,
  arcTarget: number
): number {
  if (energyA == null || energyB == null) return 0.5;

  // Penalize jarring jumps (>3 points)
  const jump = Math.abs(energyA - energyB);
  const smoothness = jump <= 1 ? 1.0 : jump <= 3 ? 0.7 : Math.max(0, 1.0 - jump * 0.15);

  // Reward alignment with energy arc target
  const arcAlignment = 1.0 - Math.abs(energyB - arcTarget) / 10;

  return smoothness * 0.6 + arcAlignment * 0.4;
}

/**
 * Vibe tag similarity using Jaccard coefficient.
 */
function vibeScore(vibeA: string[] | undefined, vibeB: string[] | undefined): number {
  if (!vibeA?.length || !vibeB?.length) return 0.5;
  const setA = new Set(vibeA.map(v => v.toLowerCase()));
  const setB = new Set(vibeB.map(v => v.toLowerCase()));
  let intersection = 0;
  for (const v of setA) {
    if (setB.has(v)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0.5;
  // Partial overlap is ideal (not identical, not completely different)
  const jaccard = intersection / union;
  // Sweet spot: ~0.3-0.5 overlap scores highest
  if (jaccard >= 0.3 && jaccard <= 0.6) return 1.0;
  if (jaccard > 0.6) return 0.7; // too similar = repetitive
  return 0.3 + jaccard; // low overlap but some connection
}

/**
 * Combined transition score between two consecutive tracks.
 */
function transitionScore(
  prev: VerifiedTrack,
  next: VerifiedTrack,
  arcTarget: number
): number {
  return (
    W_BPM * bpmScore(prev.atmos_tempo_estimate, next.atmos_tempo_estimate) +
    W_ENERGY * energyScore(prev.atmos_energy, next.atmos_energy, arcTarget) +
    W_KEY * camelotCompatibility(prev.atmos_key_estimate, next.atmos_key_estimate) +
    W_VIBE * vibeScore(prev.atmos_vibe, next.atmos_vibe)
  );
}

// --- Energy Arc ---

/**
 * Compute the target energy at a given position in a set.
 * Bell curve peaking at 60-70% through the set.
 */
function energyArcTarget(
  position: number,
  setSize: number,
  energyRange: [number, number]
): number {
  const p = setSize <= 1 ? 0.5 : position / (setSize - 1); // 0 to 1
  const base = energyRange[0];
  const amplitude = (energyRange[1] - energyRange[0]) * 0.6;
  // Peak at 65% through the set
  const shifted = Math.sin(Math.PI * Math.pow(p, 0.85));
  return base + amplitude * shifted;
}

// --- Set Division ---

interface SetBoundary {
  startIndex: number;
  endIndex: number;
  label: string;
}

/**
 * Divide tracks into sets for multi-set structure.
 */
function divideSets(trackCount: number, totalDurationMs: number): SetBoundary[] {
  const totalMinutes = totalDurationMs / 60_000;

  // Single set for short playlists
  if (trackCount < MIN_TRACKS_FOR_MULTI_SET || totalMinutes < 60) {
    return [{ startIndex: 0, endIndex: trackCount - 1, label: "Full Set" }];
  }

  const setCount = Math.ceil(trackCount / TRACKS_PER_SET);
  const tracksPerSet = Math.ceil(trackCount / setCount);
  const sets: SetBoundary[] = [];

  for (let i = 0; i < setCount; i++) {
    const start = i * tracksPerSet;
    const end = Math.min(start + tracksPerSet - 1, trackCount - 1);
    if (start > trackCount - 1) break;
    sets.push({ startIndex: start, endIndex: end, label: `Set ${i + 1}` });
  }

  return sets;
}

// --- Main Sequencer ---

/**
 * Pick the best opener for a set: moderate energy, high quality, good mood match.
 */
function pickOpener(
  tracks: VerifiedTrack[],
  energyRange: [number, number]
): number {
  const targetEnergy = energyRange[0] + (energyRange[1] - energyRange[0]) * 0.4;
  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const energy = t.atmos_energy ?? 5;
    const energyFit = 1.0 - Math.abs(energy - targetEnergy) / 10;
    const quality = (t.FINAL_SCORE ?? 5) / 10;
    const score = energyFit * 0.5 + quality * 0.5;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

/**
 * Greedy nearest-neighbor sequencing for a single set of tracks.
 */
function sequenceSet(
  tracks: VerifiedTrack[],
  energyRange: [number, number]
): VerifiedTrack[] {
  if (tracks.length <= 2) return tracks;

  const remaining = [...tracks];
  const result: VerifiedTrack[] = [];

  // Pick opener
  const openerIdx = pickOpener(remaining, energyRange);
  result.push(remaining.splice(openerIdx, 1)[0]);

  // Greedy: pick best transition for each subsequent position
  for (let pos = 1; pos < tracks.length; pos++) {
    if (remaining.length === 0) break;

    const prev = result[result.length - 1];
    const arcTarget = energyArcTarget(pos, tracks.length, energyRange);

    let bestIdx = 0;
    let bestTransScore = -1;

    for (let i = 0; i < remaining.length; i++) {
      const score = transitionScore(prev, remaining[i], arcTarget);
      if (score > bestTransScore) {
        bestTransScore = score;
        bestIdx = i;
      }
    }

    result.push(remaining.splice(bestIdx, 1)[0]);
  }

  return result;
}

// --- Public API ---

export interface SequencerResult {
  tracks: VerifiedTrack[];
  sets: SetBoundary[];
}

/**
 * Sequence verified tracks for smooth flow.
 * Handles both single-arc and multi-set playlists.
 */
export function sequenceTracks(
  tracks: VerifiedTrack[],
  intent: PlaylistIntent
): SequencerResult {
  if (tracks.length <= 2) {
    return {
      tracks,
      sets: [{ startIndex: 0, endIndex: tracks.length - 1, label: "Full Set" }],
    };
  }

  const totalDurationMs = tracks.reduce(
    (sum, t) => sum + (t.durationMs ?? DEFAULT_DURATION_MS),
    0
  );

  const setBoundaries = divideSets(tracks.length, totalDurationMs);

  if (setBoundaries.length === 1) {
    // Single set -- sequence all tracks together
    const sequenced = sequenceSet(tracks, intent.energyRange);
    logTransitions(sequenced);
    return {
      tracks: sequenced,
      sets: [{ startIndex: 0, endIndex: sequenced.length - 1, label: "Full Set" }],
    };
  }

  // Multi-set: distribute tracks evenly, then sequence each set
  console.log(`[sequencer] Divided ${tracks.length} tracks into ${setBoundaries.length} sets`);

  // Pre-sort by energy so sets get a spread
  const sorted = [...tracks].sort((a, b) =>
    (a.atmos_energy ?? 5) - (b.atmos_energy ?? 5)
  );

  // Round-robin distribute to sets for energy variety
  const setTracks: VerifiedTrack[][] = setBoundaries.map(() => []);
  for (let i = 0; i < sorted.length; i++) {
    setTracks[i % setBoundaries.length].push(sorted[i]);
  }

  // Sequence each set independently
  const finalTracks: VerifiedTrack[] = [];
  const finalSets: SetBoundary[] = [];

  for (let s = 0; s < setTracks.length; s++) {
    const startIndex = finalTracks.length;
    const sequenced = sequenceSet(setTracks[s], intent.energyRange);
    finalTracks.push(...sequenced);
    finalSets.push({
      startIndex,
      endIndex: finalTracks.length - 1,
      label: `Set ${s + 1}`,
    });
  }

  logTransitions(finalTracks);

  return { tracks: finalTracks, sets: finalSets };
}

/**
 * Log transition quality for debugging.
 */
function logTransitions(tracks: VerifiedTrack[]): void {
  if (tracks.length < 2) return;

  let totalScore = 0;
  let minScore = 1.0;
  let count = 0;

  for (let i = 1; i < tracks.length; i++) {
    const score = transitionScore(tracks[i - 1], tracks[i], 5);
    totalScore += score;
    if (score < minScore) minScore = score;
    count++;
  }

  const avgScore = count > 0 ? (totalScore / count).toFixed(3) : "N/A";
  console.log(
    `[sequencer] Transition scores: avg=${avgScore}, min=${minScore.toFixed(3)}, ` +
    `${count} transitions across ${tracks.length} tracks`
  );
}
