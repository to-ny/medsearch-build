#!/usr/bin/env bash
# Fetch the latest SAM v2 XML export from FAMHP/AFMPS
set -euo pipefail

SAM_PORTAL="https://www.vas.ehealth.fgov.be/websamcivics/samcivics"
XSD_VERSION=5
EXPORT_DIR="data/sam-export"

mkdir -p "$EXPORT_DIR"

echo "Fetching latest SAM export version..."
VERSION=$(curl -sL "${SAM_PORTAL}/download/samv2-full-getLastVersion?xsd=${XSD_VERSION}" --max-time 15)

if ! [[ "$VERSION" =~ ^[0-9]+$ ]]; then
  echo "ERROR: Could not determine latest version. Got: $VERSION"
  echo "Download manually from: $SAM_PORTAL"
  exit 1
fi

echo "Latest SAM version: $VERSION"

ZIP_PATH="${EXPORT_DIR}/sam-full-v${VERSION}.zip"
DOWNLOAD_URL="${SAM_PORTAL}/download/samv2-download?type=FULL&xsd=${XSD_VERSION}&version=${VERSION}"

# Check if we already have XML files from this version
EXISTING=$(find "$EXPORT_DIR" -name '*.xml' -newer "$EXPORT_DIR" 2>/dev/null | head -1)
if [ -n "$EXISTING" ]; then
  echo "XML files already present in $EXPORT_DIR — skipping download."
  echo "Delete them and re-run to force a fresh download."
  ls -la "$EXPORT_DIR"/*.xml 2>/dev/null
  exit 0
fi

echo "Downloading full SAM export (~300MB)..."
echo "URL: $DOWNLOAD_URL"
curl -# -L -o "$ZIP_PATH" "$DOWNLOAD_URL" --max-time 600 --retry 3 --retry-delay 5

echo "Extracting..."
unzip -o "$ZIP_PATH" -d "$EXPORT_DIR"
rm -f "$ZIP_PATH"

echo ""
echo "Done! Files in $EXPORT_DIR:"
ls -la "$EXPORT_DIR"/*.xml 2>/dev/null
