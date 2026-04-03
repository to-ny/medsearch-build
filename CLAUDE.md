# medsearch-build

Private build repo for MedSearch static site generator.

## Pipeline

```
SAM XML (FAMHP/AFMPS) → SQLite → HTML generator → Pagefind → static site
```

## Commands

```bash
./fetch-sam.sh                # Download latest SAM XML export (needs network)
nix build .#database          # SAM XML → SQLite
nix build .#html              # SQLite → HTML pages
nix build .#site              # HTML → HTML + search index
nix build                     # Full pipeline
nix develop                   # Dev shell with pinned tools
```

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
