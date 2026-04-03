#!/usr/bin/env bash
# Full MedSearch build pipeline: SAM XML → PostgreSQL → static HTML → search index
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SKIP_FETCH=false
SKIP_IMPORT=false
PG_PORT=5433
EXPORT_DIR="data/sam-export"

for arg in "$@"; do
  case $arg in
    --skip-fetch) SKIP_FETCH=true ;;
    --skip-import) SKIP_IMPORT=true ;;
    --help|-h)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --skip-fetch   Use existing SAM XML in $EXPORT_DIR"
      echo "  --skip-import  Skip XML import, use existing database"
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

# Check XML files exist
XML_COUNT=$(find "$EXPORT_DIR" -name '*.xml' 2>/dev/null | wc -l)
if [ "$XML_COUNT" -eq 0 ] && [ "$SKIP_IMPORT" = false ]; then
  echo "ERROR: No XML files found in $EXPORT_DIR"
  echo "Run ./fetch-sam.sh first, or use --skip-import with an existing database."
  exit 1
fi

# ============================================================================
# Step 2: Start temporary PostgreSQL and import data
# ============================================================================
PG_DATA=$(mktemp -d)
PG_LOG="$PG_DATA/pg.log"
PG_SOCKET="$PG_DATA"
export DATABASE_URL="postgresql://postgres@localhost:${PG_PORT}/medsearch?host=${PG_SOCKET}"

cleanup() {
  echo "Stopping PostgreSQL..."
  pg_ctl -D "$PG_DATA" stop -m fast 2>/dev/null || true
  rm -rf "$PG_DATA"
}
trap cleanup EXIT

if [ "$SKIP_IMPORT" = false ]; then
  echo ""
  echo "=== Step 2: Starting temporary PostgreSQL ==="
  initdb -D "$PG_DATA" --no-locale --encoding=UTF8 -U postgres -A trust > /dev/null
  echo "unix_socket_directories = '${PG_SOCKET}'" >> "$PG_DATA/postgresql.conf"
  echo "listen_addresses = ''" >> "$PG_DATA/postgresql.conf"
  echo "port = ${PG_PORT}" >> "$PG_DATA/postgresql.conf"
  # Tune for import speed (not durability — this is ephemeral)
  echo "shared_buffers = 256MB" >> "$PG_DATA/postgresql.conf"
  echo "work_mem = 64MB" >> "$PG_DATA/postgresql.conf"
  echo "maintenance_work_mem = 256MB" >> "$PG_DATA/postgresql.conf"
  echo "fsync = off" >> "$PG_DATA/postgresql.conf"
  echo "synchronous_commit = off" >> "$PG_DATA/postgresql.conf"
  echo "full_page_writes = off" >> "$PG_DATA/postgresql.conf"

  pg_ctl -D "$PG_DATA" -l "$PG_LOG" start
  createdb -h "$PG_SOCKET" -p "$PG_PORT" -U postgres medsearch

  echo "Loading schema..."
  psql -h "$PG_SOCKET" -p "$PG_PORT" -U postgres -d medsearch -f scripts/schema.sql > /dev/null

  echo ""
  echo "=== Step 3: Importing SAM XML data ==="
  bun run scripts/sync-sam-database.ts --skip-download --verbose
else
  echo ""
  echo "=== Steps 2-3: Skipping import (--skip-import) ==="
  echo "Using DATABASE_URL from environment or default"
fi

# ============================================================================
# Step 4: Generate static HTML
# ============================================================================
echo ""
echo "=== Step 4: Generating static HTML ==="
bun run generator/index.ts

# ============================================================================
# Step 5: Build search index
# ============================================================================
echo ""
echo "=== Step 5: Building search index ==="
# Use ionice + nice to prevent freezing the system (WSL2 I/O is sensitive).
# prlimit caps virtual memory at 4GB as a safety net.
ionice -c 3 nice -n 15 prlimit --as=4000000000 -- \
  pagefind --site dist --output-subdir _search

# ============================================================================
# Done
# ============================================================================
echo ""
echo "=== Build complete ==="
du -sh dist/
echo "Pages: $(find dist/ -name index.html | wc -l)"
echo ""
echo "Serve locally:  bunx serve dist -l 3000"
echo "Or:             python3 -m http.server 3000 -d dist"
