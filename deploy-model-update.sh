#!/bin/bash
# Atmosify — Update Gemini model to 3.1 Flash Lite Preview
# Paste into Firebase Studio terminal to patch all pipeline files.

set -e
echo "=== Updating Gemini model to gemini-3.1-flash-lite-preview ==="

# Patch all pipeline files that reference the old model
for f in src/logic/clarify.ts src/logic/curator.ts src/logic/trackEnricher.ts src/logic/artistDiscovery.ts; do
  if [ -f "$f" ]; then
    sed -i 's/gemini-2\.5-flash/gemini-3.1-flash-lite-preview/g' "$f"
    echo "  [PATCHED] $f"
  else
    echo "  [SKIP]    $f (not found)"
  fi
done

echo ""
echo "=== Done. Run 'npm run build:functions' to compile, then deploy. ==="
