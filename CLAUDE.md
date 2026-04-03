# medsearch-build

Private build repo for MedSearch static site generator.

## Pipeline

```
SAM XML (FAMHP/AFMPS) → PostgreSQL (temp) → HTML generator → Pagefind → static site
```

## Commands

```bash
./fetch-sam.sh          # Download latest SAM XML export
./build.sh              # Full pipeline: fetch → import → generate → index
./build.sh --skip-fetch # Use existing XML
./build.sh --skip-import # Use existing database (needs DATABASE_URL)
nix develop             # Enter dev shell with pinned tools
nix build               # Hermetic build (needs XML in data/sam-export/)
```

## Structure

- `generator/` — Bun/TS static HTML generator
- `scripts/` — SAM sync script + DB schema (from medsearch app)
- `static/` — CSS, JS assets copied to output
- `data/` — SAM XML exports (gitignored)
- `dist/` — Generated output (gitignored)

## Domain

- **Hierarchy:** VTM → VMP → AMP → AMPP (substance → generic → brand → package)
- **CNK:** 7-digit Belgian pharmacy code
- **Languages:** nl, fr, en, de (single-page with CSS toggle)
