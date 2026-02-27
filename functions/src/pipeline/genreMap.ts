// src/pipeline/genreMap.ts
// Genre adjacency map — now data-driven from the NotebookLM genre taxonomy.
// REPLACES the previous hand-coded adjacency map.
//
// Use getAdjacentGenres() to find related genres for broadening a search
// when the initial candidate pool is too thin.

export { getAdjacentGenres, findGenreFamily, getBpmRange, getMusicFactor } from "../lib/genreTaxonomy.js";

import { MUSICMAP_CLUSTERS, GENRE_FAMILIES } from "../lib/genreTaxonomy.js";

/**
 * Get all genres within the same Musicmap cluster as the given genre.
 * More precise than getAdjacentGenres — uses cluster membership.
 */
export function getClusterGenres(genre: string): string[] {
  const lower = genre.toLowerCase();
  for (const cluster of MUSICMAP_CLUSTERS) {
    if (cluster.genres.some(g => g.toLowerCase().includes(lower) || lower.includes(g.toLowerCase()))) {
      return cluster.genres.filter(g => !g.toLowerCase().includes(lower));
    }
  }
  return [];
}

/**
 * Expand a genre list to include related sub-genres and adjacent genres.
 * Used by ArtistDiscovery when broadening scope for expansion loops.
 */
export function expandGenreList(genres: string[], subGenres: string[]): string[] {
  const result = new Set([...genres, ...subGenres]);

  for (const genre of genres) {
    const lower = genre.toLowerCase();

    // Add sub-genres from the same family
    const family = GENRE_FAMILIES.find(
      f => f.name.toLowerCase() === lower ||
        f.subGenres.some(s => s.toLowerCase() === lower)
    );
    if (family) {
      family.subGenres.slice(0, 5).forEach(s => result.add(s));
    }

    // Add adjacent cluster genres
    getClusterGenres(genre).slice(0, 3).forEach(g => result.add(g));
  }

  return Array.from(result);
}

/**
 * Check if two genres are "compatible" (in the same cluster or family).
 * Used by the Curator to validate transitions between tracks.
 */
export function areGenresCompatible(genreA: string, genreB: string): boolean {
  const lowerA = genreA.toLowerCase();
  const lowerB = genreB.toLowerCase();

  // Same genre
  if (lowerA === lowerB) return true;

  // Same family
  for (const family of GENRE_FAMILIES) {
    const inFamily = (g: string) =>
      family.name.toLowerCase() === g ||
      family.subGenres.some(s => s.toLowerCase() === g);
    if (inFamily(lowerA) && inFamily(lowerB)) return true;
  }

  // Same cluster
  for (const cluster of MUSICMAP_CLUSTERS) {
    const inCluster = (g: string) =>
      cluster.genres.some(cg => cg.toLowerCase().includes(g) || g.includes(cg.toLowerCase()));
    if (inCluster(lowerA) && inCluster(lowerB)) return true;
  }

  return false;
}
