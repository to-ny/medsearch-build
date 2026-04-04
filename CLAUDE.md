# medsearch-build

Private build repo for MedSearch static site generator.

## Pipeline

```
SAM XML → SQLite → HTML pages → Pagefind index → static site
         database     html         search          site
```

Each step is a separate Nix derivation. Only `site` (a cheap merge) rebuilds
when `static/` changes. Pagefind only re-runs when HTML content changes.

## Commands

```bash
nix build .#database          # SAM XML → SQLite
nix build .#html              # SQLite → HTML pages (content only)
nix build .#search            # HTML → Pagefind index
nix build .#site              # Merge html + search + static
nix build                     # Full pipeline (= .#site)
nix develop                   # Dev shell with pinned tools
nix run .#update-sam          # Check for new SAM version
```

## Running nix builds

Nix builds can take 10+ minutes. Redirect output to a log file and run in background:

```bash
nix build .#site --print-build-logs &>/tmp/nix-build.log; echo "EXIT:$?"
```

Then read `/tmp/nix-build.log` when notified of completion. Do NOT pipe through
`tail` or use polling loops — they lose output or time out.

## Updating SAM data

SAM version and hash are pinned in `flake.nix`. To update:

1. Run `nix run .#update-sam` to check for a new version
2. Update `samVersion` in `flake.nix`
3. Set `samHash` to `""` and run `nix build .#database`
4. Copy the correct hash from the error message into `samHash`

## Structure

- `generator/` — Bun/TS static HTML generator
- `scripts/` — SAM sync script + DB schema
- `static/` — CSS, JS assets copied to output
- `data/` — SAM XML exports + SQLite DB (gitignored)
- `dist/` — Generated output (gitignored)

## Domain

- **Hierarchy:** VTM → VMP → AMP → AMPP (substance → generic → brand → package)
- **CNK:** 7-digit Belgian pharmacy code
- **Languages:** nl, fr, en, de (single-page with CSS toggle)
