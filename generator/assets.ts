import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { join, extname } from "path";

/**
 * Fingerprint the cacheable assets (css/js) with a content hash and register
 * the hashed URLs. layout()/home.ts reference assets through hashedAsset() so
 * HTML pages get immutable URLs. A code change therefore rewrites every page
 * (full re-upload), while SAM bumps leave assets — and thus most pages —
 * untouched. Only the hashed copies land in dist/ (nothing references the
 * unhashed names).
 */
const HASHED_ASSETS = ["style.css", "lang.js", "search.js", "minisearch.min.js"];

const STATIC = join(import.meta.dir, "..", "static");

const hashedAssets: Record<string, string> = {};

export function fingerprintAssets(dist: string) {
  mkdirSync(join(dist, "assets"), { recursive: true });
  for (const name of HASHED_ASSETS) {
    const content = readFileSync(join(STATIC, name));
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 12);
    const ext = extname(name).slice(1);
    const base = name.slice(0, -ext.length - 1);
    writeFileSync(join(dist, "assets", `${base}.${hash}.${ext}`), content);
    hashedAssets[name] = `/assets/${base}.${hash}.${ext}`;
  }
  console.log(`Fingerprinted ${HASHED_ASSETS.length} assets`);
}

/** Names of files consumed by fingerprintAssets() — excluded from plain copy. */
export function hashedAssetNames(): Set<string> {
  return new Set(HASHED_ASSETS);
}

export function hashedAsset(name: string): string {
  return hashedAssets[name] || `/${name}`;
}
