# medsearch-build

Private build repo for MedSearch static site generator.

## Pipeline

```
SAM XML (FAMHP/AFMPS) → SQLite → HTML generator → Pagefind → static site
```

## Commands

```bash
nix build .#database          # SAM XML → SQLite
nix build .#html              # SQLite → HTML pages
nix build .#site              # HTML → HTML + search index
nix build                     # Full pipeline
nix develop                   # Dev shell with pinned tools
nix run .#update-sam          # Check for new SAM version
```

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
