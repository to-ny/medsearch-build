# medsearch-build

Private build repo for [MedSearch](https://medsearch.be) — a static site for Belgium's SAM v2 medication database.

## Pipeline

```
SAM XML → SQLite → HTML + search indexes → static site
         database          html                site
```

Built entirely with [Nix](https://nixos.org/) — each step is a separate derivation, cached independently.

## Quick start

```bash
nix build              # Full pipeline → result/
nix build .#database   # SAM XML → SQLite
nix build .#html       # SQLite → HTML + JSON indexes
nix build .#site       # Merge html + static/ assets
nix develop            # Dev shell (bun, curl, unzip)
nix run .#update-sam   # Check for new SAM version
```

Changing files in `static/` only rebuilds `.#site` (instant merge). Content changes rebuild `.#html`.

## Updating SAM data

Version and hash are pinned in `flake.nix`:

1. `nix run .#update-sam` — check latest version
2. Update `samVersion` in `flake.nix`
3. Set `samHash` to `""`, run `nix build .#database`
4. Copy the correct hash from the error into `samHash`

## Structure

- `generator/` — Bun/TypeScript static HTML generator + search index builder
- `scripts/` — SAM sync script + SQLite schema
- `static/` — CSS, JS, MiniSearch (copied to output as-is)
- `flake.nix` — Nix build pipeline
