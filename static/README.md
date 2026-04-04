# MedSearch

Belgium's complete medication database — a static site built from the official SAM v2 data.

Search medications, generics, substances, packages, companies, and more.

## Data

- Source: [FAMHP/AFMPS SAM v2](https://www.famhp.be/en)
- Languages: English, Dutch, French, German
- Entities: VTM → VMP → AMP → AMPP (substance → generic → brand → package)

## How it's built

This site is generated from the official SAM v2 XML export via a three-stage Nix pipeline:

1. **SAM XML → SQLite** — downloads the FAMHP export and loads it into a normalized database
2. **SQLite → HTML + search indexes** — a Bun/TypeScript generator produces static pages and per-type MiniSearch indexes
3. **HTML + static assets → site** — merges generated content with CSS, JS, and client-side search
