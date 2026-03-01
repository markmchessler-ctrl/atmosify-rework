// src/lib/referenceAtmos.ts
// Static reference-quality Dolby Atmos data module.
//
// Ranked lists sourced from NotebookLM "Reference-Level Dolby Atmos and
// Immersive Audio Sources" notebook (ID: 4c684892-6d11-468e-8645-ef7ef2fdfd21)
// containing 160 curated sources (IAA reviews, QuadraphonicQuad, ASR, What Hi-Fi?,
// mix engineer interviews, Dolby Atmos production analyses).
//
// These lists are a STARTING POINT for reference-quality playlists, not a limiter.

// ─── 1. REFERENCE ARTISTS (ranked by Atmos production quality) ──────────────

export interface ReferenceArtist {
  rank: number;
  name: string;
  genres: string[];           // genre family tags for affinity matching
  knownForAtmos: string;      // what makes their Atmos mixes noteworthy
}

export const REFERENCE_ARTISTS: ReferenceArtist[] = [
  { rank: 1, name: "Steven Wilson", genres: ["Rock", "Progressive Rock", "Art Pop"], knownForAtmos: "Meticulous multi-channel remixer; personally oversees every Atmos mix with obsessive detail" },
  { rank: 2, name: "Pink Floyd", genres: ["Rock", "Progressive Rock", "Psychedelic Rock"], knownForAtmos: "Pioneering immersive soundscapes; Dark Side of the Moon and Wish You Were Here are Atmos benchmarks" },
  { rank: 3, name: "The Beatles", genres: ["Rock", "Pop"], knownForAtmos: "Abbey Road and Sgt. Pepper Atmos remixes by Giles Martin set the gold standard for classic catalog remixes" },
  { rank: 4, name: "Steely Dan", genres: ["Rock", "Jazz", "Pop"], knownForAtmos: "Audiophile-grade recordings; Aja and Gaucho are reference-level for tonal accuracy in Atmos" },
  { rank: 5, name: "Peter Gabriel", genres: ["Rock", "Art Pop", "Global/Regional"], knownForAtmos: "Early surround-sound advocate; i/o album natively mixed in Atmos with spatial storytelling" },
  { rank: 6, name: "Kraftwerk", genres: ["Electronic/Dance", "Synth-Pop"], knownForAtmos: "3-D concert experiences and catalog remixes define electronic music in immersive space" },
  { rank: 7, name: "Billie Eilish", genres: ["Pop", "Electropop", "Alternative"], knownForAtmos: "Finneas productions are native Atmos; Happier Than Ever is a spatial audio showcase" },
  { rank: 8, name: "The Weeknd", genres: ["R&B/Soul", "Pop", "Electronic/Dance"], knownForAtmos: "Dawn FM and After Hours feature expansive Atmos mixes with cinematic depth" },
  { rank: 9, name: "Alicia Keys", genres: ["R&B/Soul", "Pop"], knownForAtmos: "Keys album in Atmos showcases vocal intimacy and piano placement in 3D space" },
  { rank: 10, name: "Taylor Swift", genres: ["Pop", "Country", "Indie Pop"], knownForAtmos: "Folklore and Midnights Atmos mixes praised for vocal clarity and spatial warmth" },
  { rank: 11, name: "Frank Zappa", genres: ["Rock", "Jazz", "Classical"], knownForAtmos: "Complex arrangements translate brilliantly to Atmos; reveals hidden layers in dense mixes" },
  { rank: 12, name: "Roxy Music", genres: ["Rock", "Art Pop", "Synth-Pop"], knownForAtmos: "Avalon Atmos remix is an audiophile reference for lush, textured spatial presentation" },
  { rank: 13, name: "Miles Davis", genres: ["Jazz", "Jazz Fusion"], knownForAtmos: "Kind of Blue and Bitches Brew Atmos remixes place instruments in realistic acoustic space" },
  { rank: 14, name: "Rush", genres: ["Rock", "Progressive Rock"], knownForAtmos: "Moving Pictures Atmos mix showcases technical precision and instrumental separation" },
  { rank: 15, name: "Dire Straits", genres: ["Rock", "Classic Rock"], knownForAtmos: "Brothers in Arms was already an audiophile reference; Atmos elevates the spatial staging" },
  { rank: 16, name: "David Bowie", genres: ["Rock", "Art Pop", "Synth-Pop"], knownForAtmos: "Ziggy Stardust and Let's Dance Atmos remixes bring new dimension to iconic productions" },
  { rank: 17, name: "Alan Parsons", genres: ["Rock", "Progressive Rock", "Pop"], knownForAtmos: "Audio engineer turned artist; Eye in the Sky Atmos mix is technically impeccable" },
  { rank: 18, name: "Yello", genres: ["Electronic/Dance", "Synth-Pop"], knownForAtmos: "Swiss electronic pioneers; Point album mixed natively in Atmos with playful spatial effects" },
  { rank: 19, name: "Donald Fagen", genres: ["Jazz", "Rock", "Pop"], knownForAtmos: "The Nightfly Atmos mix is a masterclass in spatial placement and tonal fidelity" },
  { rank: 20, name: "Jean-Michel Jarre", genres: ["Electronic/Dance", "Ambient"], knownForAtmos: "Oxygene and Equinoxe in Atmos transform synthesizer landscapes into true 3D environments" },
  { rank: 21, name: "Imagine Dragons", genres: ["Rock", "Pop", "Alternative Rock"], knownForAtmos: "Modern pop-rock with dynamic Atmos mixes that use height channels effectively" },
  { rank: 22, name: "Olivia Rodrigo", genres: ["Pop", "Alternative Rock"], knownForAtmos: "SOUR and GUTS feature polished Atmos mixes with vocal clarity and emotional depth" },
  { rank: 23, name: "Monkey House", genres: ["Pop", "Jazz", "Rock"], knownForAtmos: "Niche audiophile favorite; Atmos mixes by Justin Gray are reference-quality for small ensemble" },
  { rank: 24, name: "Talking Heads", genres: ["Rock", "Post-Punk", "Art Pop"], knownForAtmos: "Stop Making Sense in Atmos is a landmark concert film mix with immersive staging" },
  { rank: 25, name: "King Crimson", genres: ["Rock", "Progressive Rock"], knownForAtmos: "Steven Wilson-supervised Atmos mixes reveal extraordinary detail in complex compositions" },
];

// ─── 2. REFERENCE ENGINEERS (ranked by Atmos mixing excellence) ──────────────

export interface ReferenceEngineer {
  rank: number;
  name: string;
  knownForAtmos: string;
}

export const REFERENCE_ENGINEERS: ReferenceEngineer[] = [
  { rank: 1, name: "Steven Wilson", knownForAtmos: "Artist-engineer hybrid; personally remixes classic albums with obsessive spatial detail" },
  { rank: 2, name: "Bob Clearmountain", knownForAtmos: "Legendary mixer; Atmos remixes of Roxy Music, Bryan Adams, The Rolling Stones" },
  { rank: 3, name: "Morten Lindberg", knownForAtmos: "2L label founder; Dolby Atmos classical/choral recordings are reference-grade" },
  { rank: 4, name: "Justin Gray", knownForAtmos: "Monkey House producer; immersive mixing with natural acoustic staging" },
  { rank: 5, name: "Hans-Martin Buff", knownForAtmos: "Prince engineer turned Atmos specialist; precision spatial placement" },
  { rank: 6, name: "James Guthrie", knownForAtmos: "Pink Floyd's engineer; Atmos remixes preserve and extend the original spatial vision" },
  { rank: 7, name: "Michael Romanowski", knownForAtmos: "Mastering engineer with deep Atmos expertise; Coast Mastering" },
  { rank: 8, name: "John 'Beetle' Bailey", knownForAtmos: "Dolby-endorsed mixer; wide catalog of high-profile Atmos mixes" },
  { rank: 9, name: "Karma Auger", knownForAtmos: "Immersive audio specialist; natural spatial staging in acoustic genres" },
  { rank: 10, name: "Erich Gobel", knownForAtmos: "Atmos mixing with dynamic range preservation and spatial clarity" },
  { rank: 11, name: "Andres Mayo", knownForAtmos: "Latin immersive audio pioneer; Grammy-winning spatial mixes" },
  { rank: 12, name: "Martin Muscatello", knownForAtmos: "Argentine immersive mixer; collaborates with Mayo on reference Latin Atmos" },
  { rank: 13, name: "Dave Way", knownForAtmos: "Pop/rock Atmos mixer; Sheryl Crow, Fiona Apple spatial productions" },
  { rank: 14, name: "Shawn Dealey", knownForAtmos: "Nashville Atmos specialist; country and Americana immersive mixes" },
  { rank: 15, name: "Paul 'P-Dub' Walton", knownForAtmos: "Hip-hop and R&B Atmos pioneer; creative spatial FX placement" },
  { rank: 16, name: "Jerry Harrison", knownForAtmos: "Talking Heads member turned producer; immersive mixing of band catalog" },
  { rank: 17, name: "E.T. Thorngren", knownForAtmos: "Veteran mixer; Steely Dan and classic rock Atmos remixes" },
  { rank: 18, name: "Stephen W. Tayler", knownForAtmos: "Peter Gabriel and Kate Bush mixer; detailed spatial staging" },
  { rank: 19, name: "David Kosten", knownForAtmos: "Bat for Lashes, Everything Everything; indie Atmos with artistic vision" },
  { rank: 20, name: "Ricardo Bacelar", knownForAtmos: "Brazilian pianist/producer; native Atmos jazz and classical fusion" },
  { rank: 21, name: "Stan Kybert", knownForAtmos: "UK mixer; Atmos work on rock and electronic genres" },
  { rank: 22, name: "Andy Bradfield", knownForAtmos: "Pop and rock Atmos mixer; clean spatial staging" },
  { rank: 23, name: "Ken Lewis", knownForAtmos: "Hip-hop and pop mixer; creative Atmos production techniques" },
  { rank: 24, name: "Bainz", knownForAtmos: "Modern pop producer-mixer; native Atmos pop productions" },
  { rank: 25, name: "Jaycen Joshua", knownForAtmos: "Elite hip-hop/pop mixer; Atmos mixes for major label releases" },
];

// ─── 3. QUALITY KEYWORDS (trigger reference-quality mode) ────────────────────

export const QUALITY_KEYWORDS: string[] = [
  "the best",
  "best atmos",
  "best dolby",
  "reference",
  "reference quality",
  "reference-quality",
  "high quality",
  "high-quality",
  "audiophile",
  "demo quality",
  "demo-quality",
  "showcase",
  "spatial showcase",
  "best sounding",
  "best-sounding",
  "best mixed",
  "best-mixed",
  "premium",
  "top tier",
  "top-tier",
  "gold standard",
  "exceptional quality",
  "highest quality",
  "outstanding mix",
  "immersive showcase",
];

// ─── 4. UTILITY FUNCTIONS ────────────────────────────────────────────────────

/**
 * Detect whether the user's prompt signals a desire for reference-quality Atmos.
 * Case-insensitive keyword match against QUALITY_KEYWORDS.
 */
export function detectQualityIntent(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return QUALITY_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Filter reference artists by genre affinity.
 * Returns ALL reference artists if no genre overlap exists (starting point, not limiter).
 */
export function getReferenceArtistsForGenre(genres: string[]): ReferenceArtist[] {
  if (genres.length === 0) return REFERENCE_ARTISTS;

  const lowerGenres = genres.map(g => g.toLowerCase());
  const matched = REFERENCE_ARTISTS.filter(a =>
    a.genres.some(g => lowerGenres.some(lg =>
      g.toLowerCase().includes(lg) || lg.includes(g.toLowerCase())
    ))
  );

  // If no genre overlap, return ALL reference artists as a starting point
  return matched.length > 0 ? matched : REFERENCE_ARTISTS;
}

/**
 * Build a prompt fragment for artist discovery that seeds reference artists.
 * Injected at the top of the discovery prompt when referenceQuality is true.
 */
export function buildReferencePromptFragment(genres: string[]): string {
  const relevant = getReferenceArtistsForGenre(genres);
  const artistLines = relevant
    .slice(0, 15) // limit to top 15 for prompt budget
    .map(a => `- ${a.name} (${a.genres.join(", ")}): ${a.knownForAtmos}`)
    .join("\n");

  const engineerLines = REFERENCE_ENGINEERS
    .slice(0, 10) // top 10 engineers
    .map(e => `- ${e.name}: ${e.knownForAtmos}`)
    .join("\n");

  return `REFERENCE-QUALITY ATMOS CONTEXT:
The listener specifically wants reference-quality Dolby Atmos music. Use these as a
starting point — include artists from this list AND discover additional artists who
match their production quality standards. This is a STARTING POINT, not a limiter.

REFERENCE ARTISTS (proven exceptional Atmos mixes):
${artistLines}

TOP ATMOS MIX ENGINEERS (tracks mixed by these engineers tend to be reference-quality):
${engineerLines}

IMPORTANT: Include reference artists that match the listener's genre/mood request,
but ALSO discover additional artists whose production quality meets this standard.
The reference list should guide your quality threshold, not restrict your choices.

`;
}
