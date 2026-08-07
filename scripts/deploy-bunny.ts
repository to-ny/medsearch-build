#!/usr/bin/env bun
/**
 * Incremental deploy of the built static site to Bunny Edge Storage, then purge
 * the pull zone cache.
 *
 * Diffs the local site against a manifest (`.deploy-manifest.json`) stored in
 * the bucket, so only new/changed files upload and removed files are deleted —
 * no recursive listing of the ~180k remote directories. Since the SAM version
 * lives in a single /version.json (not stamped into every page), a SAM bump
 * changes only the pages whose data actually changed, keeping deploys small.
 *
 * Usage: bun scripts/deploy-bunny.ts <site-dir> [--dry-run]
 * Env:   BUNNY_STORAGE_ZONE, BUNNY_STORAGE_ENDPOINT, BUNNY_STORAGE_PASSWORD,
 *        BUNNY_PULLZONE_ID, BUNNY_API_KEY
 */
import { createHash } from "crypto";
import { readdirSync, statSync, readFileSync } from "fs";
import { join, relative } from "path";

const SITE = process.argv[2];
const DRY = process.argv.includes("--dry-run");
if (!SITE) {
  console.error("usage: bun scripts/deploy-bunny.ts <site-dir> [--dry-run]");
  process.exit(1);
}

function env(key: string): string {
  const v = process.env[key];
  if (!v && !DRY) {
    console.error(`Missing required env: ${key}`);
    process.exit(1);
  }
  return v || "";
}

const ZONE = env("BUNNY_STORAGE_ZONE");
const ENDPOINT = env("BUNNY_STORAGE_ENDPOINT"); // e.g. storage.bunnycdn.com
const PASSWORD = env("BUNNY_STORAGE_PASSWORD");
const PULLZONE = env("BUNNY_PULLZONE_ID");
const API_KEY = env("BUNNY_API_KEY");

const STORAGE = `https://${ENDPOINT}/${ZONE}`;
const MANIFEST = ".deploy-manifest.json";
const CONCURRENCY = 40;

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  xml: "application/xml",
  txt: "text/plain; charset=utf-8",
  ico: "image/x-icon",
  png: "image/png",
  webmanifest: "application/manifest+json",
};
function contentType(path: string): string {
  return MIME[path.split(".").pop()!.toLowerCase()] || "application/octet-stream";
}

/** Recursively list files, returning posix-relative paths. */
function walk(dir: string, base = dir, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else out.push(relative(base, p).split(/[\\/]/).join("/"));
  }
  return out;
}

/** Run `fn` over `items` with a fixed worker pool. */
async function pool<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  const queue = items.slice();
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      await fn(queue.shift()!);
      if (++done % 2000 === 0) console.log(`  ${done}/${items.length}`);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker)
  );
}

async function withRetry(fn: () => Promise<Response>, what: string, tries = 4): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fn();
      if (r.ok || r.status === 404) return r;
      if (attempt >= tries) throw new Error(`${what} → HTTP ${r.status}`);
    } catch (e) {
      if (attempt >= tries) throw e;
    }
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }
}

// --- hash the local site ---
console.log(`Hashing local site (${SITE})…`);
const local: Record<string, string> = {};
for (const rel of walk(SITE)) {
  local[rel] = createHash("sha256").update(readFileSync(join(SITE, rel))).digest("hex");
}
console.log(`  ${Object.keys(local).length} files`);

// --- previous manifest ---
async function getManifest(): Promise<Record<string, string>> {
  const r = await fetch(`${STORAGE}/${MANIFEST}`, { headers: { AccessKey: PASSWORD } });
  if (!r.ok) return {}; // 404 on first deploy, or unreadable → treat as empty
  try {
    return (await r.json()) as Record<string, string>;
  } catch {
    return {};
  }
}
const remote = DRY ? {} : await getManifest();

const toUpload = Object.keys(local).filter((p) => local[p] !== remote[p]);
const toDelete = Object.keys(remote).filter((p) => !(p in local));
console.log(
  `Plan: upload ${toUpload.length}, delete ${toDelete.length}, unchanged ${
    Object.keys(local).length - toUpload.length
  }`
);

if (DRY) {
  console.log("Dry run — no changes made.");
  process.exit(0);
}

// --- upload changed files ---
if (toUpload.length) {
  console.log("Uploading…");
  await pool(toUpload, async (rel) => {
    const body = readFileSync(join(SITE, rel));
    await withRetry(
      () =>
        fetch(`${STORAGE}/${rel}`, {
          method: "PUT",
          headers: { AccessKey: PASSWORD, "Content-Type": contentType(rel) },
          body,
        }),
      `PUT ${rel}`
    );
  });
}

// --- delete removed files ---
if (toDelete.length) {
  console.log("Deleting removed files…");
  await pool(toDelete, async (rel) => {
    await withRetry(
      () => fetch(`${STORAGE}/${rel}`, { method: "DELETE", headers: { AccessKey: PASSWORD } }),
      `DELETE ${rel}`
    );
  });
}

// --- write manifest LAST, so a failed deploy re-attempts next run ---
console.log("Writing manifest…");
await withRetry(
  () =>
    fetch(`${STORAGE}/${MANIFEST}`, {
      method: "PUT",
      headers: { AccessKey: PASSWORD, "Content-Type": "application/json" },
      body: JSON.stringify(local),
    }),
  "PUT manifest"
);

// --- purge the pull zone cache ---
console.log("Purging pull zone cache…");
await withRetry(
  () => fetch(`https://api.bunny.net/pullzone/${PULLZONE}/purgeCache`, {
    method: "POST",
    headers: { AccessKey: API_KEY },
  }),
  "purge"
);

console.log(`Done — uploaded ${toUpload.length}, deleted ${toDelete.length}.`);
