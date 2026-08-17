# CLAUDE.md

See [README.md](README.md) for pipeline commands and project structure.

## Nix builds

Builds can take 10+ minutes. Redirect output to a log file:

```bash
nix build .#site --print-build-logs &>/tmp/nix-build.log; echo "EXIT:$?"
```

Then read `/tmp/nix-build.log` when notified. Do NOT pipe through `tail` or poll.

## Domain

- **Hierarchy:** VTM → VMP → AMP → AMPP (substance → generic → brand → package)
- **CNK:** 7-digit Belgian pharmacy code
- **Languages:** nl, fr, en, de (single-page with CSS toggle, MiniSearch per-type indexes)
- **Deployed to:** [medsearch.be](https://medsearch.be) via Bunny Edge Storage + CDN (incremental manifest-diff upload from CI, see `scripts/deploy-bunny.ts`)
