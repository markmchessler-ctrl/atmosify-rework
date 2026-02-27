# Atmosify Rework — Setup Instructions

All generated files are in `~/atmosify-rework/`. Copy them into your Firebase Studio project.

---

## 1. Copy Files into Firebase Studio

Open your Atmosify project in Firebase Studio and copy these files:

### New files (create in Firebase Studio):
```
functions/src/lib/types.ts
functions/src/lib/genreTaxonomy.ts
functions/src/lib/atmosDb.ts
functions/src/lib/appleMusic.ts
functions/src/pipeline/artistDiscovery.ts
functions/src/pipeline/dbMatcher.ts
functions/src/pipeline/trackEnricher.ts
functions/src/pipeline/curator.ts
functions/src/pipeline/verifier.ts
functions/src/pipeline/assembler.ts
app/lib/musickit.ts
app/components/SaveToAppleMusic.tsx
```

### Replace existing files:
```
functions/src/pipeline/clarify.ts        → replace with new version
functions/src/pipeline/perplexity.ts     → replace with new version
functions/src/pipeline/genreMap.ts       → replace with new version
functions/src/pipeline/orchestrator.ts   → replace with new version
functions/src/index.ts                   → MERGE: keep existing non-Atmosify functions,
                                           replace runAtmosify, add getAppleMusicDevToken
```

### Modify existing files:
- `app/layout.tsx` — add MusicKit JS CDN script (see layout.tsx for instructions)
- `app/components/PlaylistResults.tsx` — replace with new version (or merge)
- `functions/src/pipeline/extractor.ts` — rename to `extractor.legacy.ts` (no longer called)

---

## 2. Install Dependencies

In `functions/`:
```bash
npm install jsonwebtoken
npm install --save-dev @types/jsonwebtoken
```

---

## 3. Set Firebase Secrets

In Firebase Studio terminal (project: nextn):
```bash
# Cross-project Firestore access — paste the JSON from:
# ~/atmos-mcp/serviceAccount.json OR ~/atmos-master-db-firebase-adminsdk-*.json
firebase functions:secrets:set ATMOS_DB_SERVICE_ACCOUNT

# Apple Music credentials (from your Apple Developer account)
firebase functions:secrets:set APPLE_TEAM_ID
firebase functions:secrets:set APPLE_KEY_ID
firebase functions:secrets:set APPLE_PRIVATE_KEY   # paste the .p8 file contents as one line

# Serper API key (from serper.dev — get a free key)
firebase functions:secrets:set SERPER_API_KEY

# These likely already exist in nextn:
firebase functions:secrets:set GEMINI_API_KEY
firebase functions:secrets:set PERPLEXITY_API_KEY
```

For local emulator testing, add to `functions/.env`:
```
ATMOS_DB_SERVICE_ACCOUNT=<json string>
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_PRIVATE_KEY=
SERPER_API_KEY=
GEMINI_API_KEY=
PERPLEXITY_API_KEY=
```

---

## 4. Local Emulator Test

```bash
# In functions/
firebase emulators:start --only functions

# Test runAtmosify
curl -X POST http://localhost:5002/nextn/us-central1/runAtmosify \
  -H "Content-Type: application/json" \
  -d '{"data": {"prompt": "chill late-night R&B, warm and introspective, 1 hour"}}'
```

---

## 5. Verification Tests

1. **Cross-project access**: Run `runAtmosify` with a simple prompt. Check logs for "[dbMatcher] Result: N tracks"
2. **Artist discovery**: Verify Perplexity returns artists (not empty array)
3. **DB matching**: Check "[dbMatcher] X matched artists" in logs
4. **Enrichment**: Check Firestore `tracks` documents for `atmos_mood`, `atmos_energy` fields
5. **Apple Music token**: Call `getAppleMusicDevToken` and verify it returns a JWT
6. **MusicKit save**: Open the app in browser, build a playlist, click "Save to Apple Music"

---

## 6. Deploy

```bash
firebase deploy --only functions
firebase deploy --only hosting
```

---

## Pipeline Architecture Reference

```
User Prompt
    ↓
[1] clarify.ts        — Gemini: parse intent → PlaylistIntent
    ↓
[2] artistDiscovery.ts — Perplexity (primary) + Serper + Gemini (fallback)
    ↓                    "What artists match this vibe?" → 40-80 artists
[3] dbMatcher.ts      — Firestore: query 103k tracks by artist name
    ↓                    → large candidate pool
[4] trackEnricher.ts  — Perplexity (primary) + Gemini: per-track mood/energy
    ↓                    Caches to Firestore (atmos_ prefix, 30-day TTL)
[5] curator.ts        — Gemini: select + sequence best tracks
    ↓
[6] verifier.ts       — Apple Music API: confirm Atmos, get real durations
    ↓
[7] assembler.ts      — Gap-fill + expansion loops + final formatting
    ↓
Client → SaveToAppleMusic component (MusicKit JS)
```
