// src/lib/genreTaxonomy.ts
// Static genre taxonomy pre-extracted from NotebookLM:
// "The Universal Atlas of Music Genres and Theory" (ID: ee0fc4b7-f6e1-4142-a399-24abbf9c3710)
//
// Sources: Musicmap genealogy, Apple Music genre tree, BPM research, MUSIC five-factor model,
// "Evolutionary Taxonomy and Acoustic Determinants of Global Music Genres"
//
// Rebuild manually when taxonomy needs updating by querying the NotebookLM notebook.

// ─── 1. GENRE HIERARCHY (11 families) ─────────────────────────────────────────

export interface GenreFamily {
  name: string;
  subGenres: string[];
  musicFactor: MusicFactor | MusicFactor[];
  bpmRange: [number, number];
}

export const GENRE_FAMILIES: GenreFamily[] = [
  {
    name: "Pop",
    subGenres: ["K-Pop", "Pop Latino", "Viral Hits", "A-List Pop", "Power Pop", "Synth-Pop", "Dream Pop", "Indie Pop", "Electropop"],
    musicFactor: "Mellow",
    bpmRange: [100, 130],
  },
  {
    name: "Rock",
    subGenres: ["Classic Rock", "Hard Rock", "Metal", "Alternative Rock", "Indie Rock", "Psychedelic Rock", "Punk Rock", "Progressive Rock", "Post-Rock", "Shoegaze", "Grunge", "Garage Rock"],
    musicFactor: ["Intense", "Campestral"],
    bpmRange: [110, 160],
  },
  {
    name: "Hip-Hop/Rap",
    subGenres: ["Trap", "Drill", "Boom Bap", "Conscious Hip-Hop", "G-Funk", "Southern Hip-Hop", "Cloud Rap", "Mumble Rap", "Afro-Trap", "Latin Trap", "Experimental Hip-Hop"],
    musicFactor: "Urban",
    bpmRange: [70, 140],
  },
  {
    name: "Electronic/Dance",
    subGenres: [
      "Deep House", "Tech House", "Progressive House", "Future House", "Melodic House",
      "Techno", "Minimal Techno", "Industrial Techno",
      "Trance", "Progressive Trance", "Psytrance",
      "Drum & Bass", "Liquid DnB", "Neurofunk",
      "Dubstep", "Future Bass", "Bass House",
      "EDM", "Big Room", "Electro",
      "Ambient", "Downtempo", "Chillout",
      "Jungle", "Breakbeat", "UK Garage",
      "Afro House", "Melodic Techno",
    ],
    musicFactor: "Urban",
    bpmRange: [60, 180],
  },
  {
    name: "R&B/Soul",
    subGenres: ["Soul", "Funk", "Motown", "Neo-Soul", "Contemporary R&B", "Alternative R&B", "Trap Soul", "Quiet Storm", "New Jack Swing", "PBR&B"],
    musicFactor: "Mellow",
    bpmRange: [60, 105],
  },
  {
    name: "Latin",
    subGenres: ["Urbano Latino", "Reggaeton", "Música Mexicana", "Bachata", "Salsa", "Cumbia", "Latin Pop", "Latin Jazz", "Bossa Nova", "Flamenco", "Bolero"],
    musicFactor: ["Urban", "Mellow"],
    bpmRange: [80, 130],
  },
  {
    name: "Jazz",
    subGenres: ["Bebop", "Cool Jazz", "Hard Bop", "Free Jazz", "Jazz Fusion", "Big Band", "Ragtime", "Smooth Jazz", "Avant-Garde Jazz", "Latin Jazz", "Gypsy Jazz"],
    musicFactor: "Sophisticated",
    bpmRange: [80, 240],
  },
  {
    name: "Classical",
    subGenres: ["Symphony", "Chamber Music", "Opera", "Solo Piano", "Choral", "Baroque", "Romantic", "Contemporary Classical", "Minimalist", "Film Score", "Orchestral"],
    musicFactor: "Sophisticated",
    bpmRange: [40, 200],
  },
  {
    name: "Country",
    subGenres: ["Americana", "Alt-Country", "Bluegrass", "Country Pop", "Outlaw Country", "Red Dirt", "Country Rock", "Neo-Traditional Country", "Honky Tonk", "Bro-Country"],
    musicFactor: "Campestral",
    bpmRange: [80, 140],
  },
  {
    name: "Gospel/Christian",
    subGenres: ["Black Gospel", "Praise & Worship", "Christian Rock", "Christian Hip-Hop", "Southern Gospel", "Contemporary Christian", "Gospel R&B"],
    musicFactor: ["Mellow", "Intense"],
    bpmRange: [70, 140],
  },
  {
    name: "Global/Regional",
    subGenres: ["Afrobeats", "Afrobeats/Afropop", "Reggae", "Dancehall", "J-Pop", "C-Pop", "K-Indie", "Indian Classical", "Bollywood", "Soca", "Zouk", "Highlife", "Amapiano", "Gqom", "Kizomba"],
    musicFactor: ["Urban", "Mellow", "Campestral"],
    bpmRange: [60, 140],
  },
];

// ─── 2. MUSICMAP MACRO CLUSTERS (genre adjacency for smooth transitions) ─────

export interface MusicmapCluster {
  name: string;
  genres: string[]; // ordered by genealogical proximity
  description: string;
}

export const MUSICMAP_CLUSTERS: MusicmapCluster[] = [
  {
    name: "Blue Note",
    genres: ["Gospel", "Blues", "Jazz", "Soul", "R&B", "Funk"],
    description: "African-American roots music lineage — emotionally rich, improvisational",
  },
  {
    name: "Rock",
    genres: ["Rock & Roll", "Classic Rock", "Punk", "Post-Punk", "New Wave", "Hardcore", "Alternative", "Indie Rock", "Grunge", "Contemporary Rock", "Metal"],
    description: "Guitar-driven lineage from 1950s R'n'R through contemporary forms",
  },
  {
    name: "Electronic Dance Music",
    genres: ["Breakbeat", "Jungle", "Drum & Bass", "Hardcore Techno", "Techno", "House", "Deep House", "Tech House", "Trance", "Ambient", "Downtempo"],
    description: "Electronic lineage — from early breakbeats through club music to ambient",
  },
  {
    name: "Hip-Hop",
    genres: ["Old School Hip-Hop", "Boom Bap", "East Coast", "West Coast", "Southern", "Trap", "Drill", "Cloud Rap", "Experimental Hip-Hop"],
    description: "Urban poetry and production — percussion-forward, lyrically driven",
  },
  {
    name: "Pop",
    genres: ["Adult Contemporary", "Teen Pop", "Power Pop", "Synth-Pop", "Electropop", "Indie Pop", "Dream Pop", "Art Pop"],
    description: "Melodically accessible, commercially oriented music",
  },
  {
    name: "Reggae",
    genres: ["Ska", "Rocksteady", "Roots Reggae", "Dancehall", "Dub", "Soca"],
    description: "Caribbean rhythmic tradition — offbeat emphasis, spiritual/social themes",
  },
  {
    name: "Country/Folk",
    genres: ["Bluegrass", "Old-Time", "Folk", "Country", "Americana", "Alt-Country", "Singer-Songwriter"],
    description: "Roots acoustic tradition — storytelling, acoustic instrumentation",
  },
  {
    name: "Latin",
    genres: ["Bossa Nova", "Samba", "Salsa", "Cumbia", "Bachata", "Reggaeton", "Urbano Latino", "Latin Pop"],
    description: "Latin American rhythmic traditions — syncopated, dance-oriented",
  },
  {
    name: "Industrial/Gothic",
    genres: ["Industrial", "EBM", "Gothic Rock", "Darkwave", "Post-Industrial", "Noise"],
    description: "Dark, abrasive, mechanistic — subversive and boundary-pushing",
  },
  {
    name: "World/Global",
    genres: ["Afrobeats", "Amapiano", "J-Pop", "C-Pop", "Bollywood", "Indian Classical", "Celtic", "Flamenco"],
    description: "Regional traditions outside Western mainstream lineages",
  },
];

// ─── 3. BPM RANGES BY SPECIFIC GENRE/SUBGENRE ────────────────────────────────

export const BPM_RANGES: Record<string, [number, number]> = {
  // Electronic
  "Ambient": [60, 120],
  "Downtempo": [70, 110],
  "Chillout": [80, 110],
  "Deep House": [110, 125],
  "House": [118, 135],
  "Tech House": [122, 132],
  "Progressive House": [126, 135],
  "Melodic House": [120, 128],
  "Afro House": [120, 130],
  "Techno": [130, 150],
  "Minimal Techno": [128, 135],
  "Melodic Techno": [130, 140],
  "Trance": [132, 150],
  "Progressive Trance": [130, 145],
  "Psytrance": [145, 160],
  "Drum & Bass": [160, 180],
  "Liquid DnB": [160, 175],
  "Jungle": [155, 175],
  "Breakbeat": [115, 145],
  "Dubstep": [138, 142],
  "Future Bass": [120, 160],
  "Bass House": [128, 140],
  "EDM": [128, 145],
  "Big Room": [128, 138],
  // Hip-Hop
  "Boom Bap": [85, 100],
  "Old School Hip-Hop": [85, 100],
  "East Coast": [85, 105],
  "Trap": [70, 140],
  "Drill": [60, 80],
  "Cloud Rap": [75, 110],
  "Southern Hip-Hop": [80, 115],
  "Contemporary R&B": [60, 100],
  "Alternative R&B": [65, 100],
  "Trap Soul": [60, 90],
  "Neo-Soul": [65, 100],
  // Pop/Rock
  "Pop": [100, 130],
  "Indie Pop": [95, 125],
  "Synth-Pop": [105, 130],
  "Dream Pop": [85, 115],
  "Electropop": [115, 130],
  "K-Pop": [110, 135],
  "Rock": [110, 145],
  "Alternative Rock": [105, 140],
  "Indie Rock": [100, 140],
  "Punk Rock": [155, 200],
  "Metal": [120, 220],
  "Grunge": [100, 140],
  "Classic Rock": [100, 140],
  // Roots
  "Jazz": [80, 240],
  "Bebop": [160, 240],
  "Smooth Jazz": [80, 110],
  "Country": [90, 140],
  "Americana": [80, 130],
  "Bluegrass": [120, 180],
  "Folk": [75, 120],
  "Reggae": [60, 90],
  "Dancehall": [80, 110],
  "Ska": [140, 200],
  // Latin
  "Reggaeton": [90, 100],
  "Salsa": [160, 240],
  "Bachata": [118, 140],
  "Cumbia": [90, 110],
  "Bossa Nova": [110, 140],
  // Global
  "Afrobeats": [90, 115],
  "Amapiano": [110, 120],
};

// ─── 4. MUSIC FIVE-FACTOR MOOD MODEL ─────────────────────────────────────────

export type MusicFactor = "Mellow" | "Urban" | "Sophisticated" | "Intense" | "Campestral";

export interface MusicFactorDef {
  name: MusicFactor;
  description: string;
  characteristics: string[];
  typicalGenres: string[];
  energyRange: [number, number]; // 1-10 scale
  valence: "positive" | "mixed" | "negative" | "variable";
}

export const MUSIC_FACTORS: MusicFactorDef[] = [
  {
    name: "Mellow",
    description: "Smooth, relaxing, romantic — low arousal, moderate-to-high valence",
    characteristics: ["quiet", "smooth", "soft", "gentle", "romantic", "sensual", "warm", "intimate"],
    typicalGenres: ["Soft Rock", "R&B", "Soul", "Neo-Soul", "Smooth Jazz", "Dream Pop", "Ambient", "Contemporary R&B"],
    energyRange: [1, 4],
    valence: "positive",
  },
  {
    name: "Urban",
    description: "Rhythmic, electric, percussive — strong beat, street-oriented",
    characteristics: ["rhythmic", "electric", "percussive", "groovy", "energetic", "danceable", "bass-heavy"],
    typicalGenres: ["Hip-Hop", "Rap", "Funk", "Trap", "R&B", "Dancehall", "Electronic", "House", "Afrobeats"],
    energyRange: [5, 9],
    valence: "variable",
  },
  {
    name: "Sophisticated",
    description: "Complex, thoughtful, intelligent — cerebral, nuanced, high musicianship",
    characteristics: ["complex", "intelligent", "nuanced", "tasteful", "refined", "harmonic", "improvisational"],
    typicalGenres: ["Jazz", "Classical", "World", "Progressive Rock", "Art Pop", "Chamber Music", "Fusion"],
    energyRange: [2, 7],
    valence: "variable",
  },
  {
    name: "Intense",
    description: "Loud, forceful, aggressive — high arousal, often negative or tense valence",
    characteristics: ["loud", "aggressive", "powerful", "raw", "heavy", "energetic", "anthemic", "driving"],
    typicalGenres: ["Metal", "Punk", "Hard Rock", "Hardcore", "Industrial", "Drum & Bass", "Techno", "Psytrance"],
    energyRange: [7, 10],
    valence: "negative",
  },
  {
    name: "Campestral",
    description: "Rootsy, acoustic, sincere — pastoral, storytelling, organic",
    characteristics: ["acoustic", "rootsy", "authentic", "sincere", "pastoral", "storytelling", "natural", "earthy"],
    typicalGenres: ["Country", "Folk", "Americana", "Bluegrass", "Singer-Songwriter", "Celtic", "Gospel"],
    energyRange: [2, 6],
    valence: "positive",
  },
];

// ─── 5. THREE-DIMENSIONAL AFFECT MODEL ───────────────────────────────────────

export interface AffectProfile {
  valence: "very_positive" | "positive" | "neutral" | "negative" | "very_negative";
  energyArousal: "very_high" | "high" | "moderate" | "low" | "very_low";
  tensionArousal: "tense" | "excited" | "relaxed" | "calm";
}

// ─── 6. UTILITY FUNCTIONS ────────────────────────────────────────────────────

/** Given a genre name, find its parent family */
export function findGenreFamily(genre: string): GenreFamily | undefined {
  const lower = genre.toLowerCase();
  return GENRE_FAMILIES.find(
    f =>
      f.name.toLowerCase() === lower ||
      f.subGenres.some(s => s.toLowerCase() === lower)
  );
}

/** Get adjacent genres using Musicmap cluster membership */
export function getAdjacentGenres(genre: string, maxResults = 6): string[] {
  const lower = genre.toLowerCase();
  const cluster = MUSICMAP_CLUSTERS.find(c =>
    c.genres.some(g => g.toLowerCase() === lower || g.toLowerCase().includes(lower))
  );
  if (!cluster) return [];
  return cluster.genres.filter(g => g.toLowerCase() !== lower).slice(0, maxResults);
}

/** Get BPM range for a genre (falls back to family BPM range) */
export function getBpmRange(genre: string): [number, number] {
  const exact = BPM_RANGES[genre];
  if (exact) return exact;
  const family = findGenreFamily(genre);
  return family ? family.bpmRange : [80, 140];
}

/** Get the MUSIC factor(s) for a genre */
export function getMusicFactor(genre: string): MusicFactor[] {
  const family = findGenreFamily(genre);
  if (!family) return ["Mellow"];
  const factor = family.musicFactor;
  return Array.isArray(factor) ? factor : [factor];
}

/**
 * Build a compact taxonomy context string for AI prompts.
 * Includes genre hierarchy, BPM ranges, and mood model relevant to the request.
 */
export function buildTaxonomyPromptContext(genres: string[], moods: string[]): string {
  const relevantFamilies = GENRE_FAMILIES.filter(f =>
    genres.some(g =>
      f.name.toLowerCase().includes(g.toLowerCase()) ||
      g.toLowerCase().includes(f.name.toLowerCase()) ||
      f.subGenres.some(s => s.toLowerCase().includes(g.toLowerCase()))
    )
  );

  // Fall back to all families if nothing matched
  const familiesToShow = relevantFamilies.length > 0 ? relevantFamilies : GENRE_FAMILIES.slice(0, 4);

  const hierarchyLines = familiesToShow.map(f =>
    `- ${f.name} family (BPM ${f.bpmRange[0]}-${f.bpmRange[1]}): ${f.subGenres.join(", ")}`
  ).join("\n");

  // Find MUSIC factors matching the mood keywords
  const lowerMoods = moods.map(m => m.toLowerCase());
  const relevantFactors = MUSIC_FACTORS.filter(f =>
    f.characteristics.some(c => lowerMoods.some(m => c.includes(m) || m.includes(c)))
  );
  const factorsToShow = relevantFactors.length > 0 ? relevantFactors : MUSIC_FACTORS;

  const factorLines = factorsToShow.map(f =>
    `- ${f.name}: ${f.description} (energy ${f.energyRange[0]}-${f.energyRange[1]}/10, genres: ${f.typicalGenres.slice(0, 4).join(", ")})`
  ).join("\n");

  const adjacentInfo = genres.flatMap(g => {
    const adj = getAdjacentGenres(g);
    return adj.length > 0 ? [`- ${g} → adjacent: ${adj.join(", ")}`] : [];
  }).join("\n");

  return `CANONICAL GENRE TAXONOMY:
Genre hierarchy and BPM ranges:
${hierarchyLines}

MUSIC Five-Factor Mood Model (relevant factors):
${factorLines}

Genre adjacency (for variety without jarring transitions):
${adjacentInfo || "No specific adjacency data for these genres."}`;
}
