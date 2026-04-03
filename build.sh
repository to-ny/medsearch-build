#!/usr/bin/env bash
# Full MedSearch build pipeline: SAM XML → SQLite → static HTML → search index
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SKIP_FETCH=false
SKIP_IMPORT=false
EXPORT_DIR="data/sam-export"
export DB_PATH="${DB_PATH:-data/medsearch.sqlite}"

for arg in "$@"; do
  case $arg in
    --skip-fetch) SKIP_FETCH=true ;;
    --skip-import) SKIP_IMPORT=true ;;
    --help|-h)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --skip-fetch   Use existing SAM XML in $EXPORT_DIR"
      echo "  --skip-import  Use existing SQLite database at $DB_PATH"
      echo "  -h, --help     Show this help"
      exit 0
      ;;
  esac
done

# ============================================================================
# Step 1: Fetch SAM data
# ============================================================================
if [ "$SKIP_FETCH" = false ]; then
  echo "=== Step 1: Fetching SAM XML exports ==="
  bash fetch-sam.sh
else
  echo "=== Step 1: Skipping fetch (using existing XML) ==="
fi

# ============================================================================
# Step 2: Import into SQLite
# ============================================================================
if [ "$SKIP_IMPORT" = false ]; then
  XML_COUNT=$(find "$EXPORT_DIR" -name '*.xml' 2>/dev/null | wc -l)
  if [ "$XML_COUNT" -eq 0 ]; then
    echo "ERROR: No XML files found in $EXPORT_DIR"
    echo "Run ./fetch-sam.sh first, or use --skip-import with an existing database."
    exit 1
  fi

  echo ""
  echo "=== Step 2: Importing SAM XML into SQLite ==="
  bun run scripts/sync-sam-database.ts --skip-download --verbose
else
  echo ""
  echo "=== Step 2: Skipping import (using existing database) ==="
  if [ ! -f "$DB_PATH" ]; then
    echo "ERROR: Database not found at $DB_PATH"
    exit 1
  fi
fi

# ============================================================================
# Step 3: Generate static HTML
# ============================================================================
echo ""
echo "=== Step 3: Generating static HTML ==="
bun run generator/index.ts

# ============================================================================
# Step 4: Build search index
# ============================================================================
echo ""
echo "=== Step 4: Building search index ==="
ionice -c 3 nice -n 15 pagefind --site dist --output-subdir _search

# ============================================================================
# Done
# ============================================================================
echo ""
echo "=== Build complete ==="
du -sh dist/
echo "Pages: $(find dist/ -name index.html | wc -l)"
echo ""
echo "Serve locally:  python3 -m http.server 3000 -d dist"
