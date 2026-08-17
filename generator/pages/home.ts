import { writeFileSync } from "fs";
import { join } from "path";
import { layout, label } from "../html";
import { hashedAsset } from "../assets";

export function generate404Page(dist: string) {
  const content = `
<div class="container page-content" style="text-align:center;padding:4rem 1rem;">
<h1 style="font-size:2.5rem;font-weight:700;margin-bottom:0.5rem;">404</h1>
<p style="color:var(--text-secondary);margin-bottom:1.5rem;">${label("notFound.message")}</p>
<a href="/" class="chip">${label("notFound.home")}</a>
</div>`;
  writeFileSync(join(dist, "404.html"), layout("404 — Not Found", content));
  console.log("  Generated 404 page");
}

interface Stats {
  vtm: number;
  vmp: number;
  amp: number;
  ampp: number;
  company: number;
  substance: number;
  vmp_group: number;
  atc: number;
  chapter_iv: number;
}

export function generateHomePage(dist: string, stats: Stats) {
  const content = `
<div class="hero">
<div class="container hero-inner">
<div class="search-bar-wrap">
<select id="type-select" class="type-select" aria-label="Entity type"></select>
<div class="search-input-wrap">
<svg class="search-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd"/></svg>
<input id="search-input" type="search" autocomplete="off" spellcheck="false">
</div>
</div>
<div class="hero-examples">
<span class="examples-label">${label("home.examples")}:</span>
<button class="chip" onclick="fillSearch('paracetamol','amp')">paracetamol</button>
<button class="chip" onclick="fillSearch('Dafalgan','amp')">Dafalgan</button>
<button class="chip" onclick="fillSearch('0039347','ampp')">0039347</button>
<button class="chip" onclick="fillSearch('Pfizer','company')">Pfizer</button>
<button class="chip" onclick="fillSearch('N02BE01','atc')">N02BE01</button>
</div>
</div>
</div>
<div class="search-results-section">
<div class="container">
<div id="search-count" class="search-count"></div>
<div id="search-results"></div>
</div>
</div>
<div class="hero-stats">
<div class="stat"><span class="stat-value">${stats.amp.toLocaleString()}</span><span class="stat-label">${label("stats.medications")}</span></div>
<div class="stat"><span class="stat-value">${stats.ampp.toLocaleString()}</span><span class="stat-label">${label("stats.packages")}</span></div>
<div class="stat"><span class="stat-value">${stats.substance.toLocaleString()}</span><span class="stat-label">${label("stats.substances")}</span></div>
</div>
<script src="${hashedAsset("minisearch.min.js")}"></script>
<script src="${hashedAsset("search.js")}"></script>
<script>window.addEventListener('DOMContentLoaded', initSearch);</script>`;

  writeFileSync(
    join(dist, "index.html"),
    layout("MedSearch — Belgium Medication Database", content, {
      description:
        "Search Belgium's official SAM medication database. Find medications, substances, brands, packages, pricing, and reimbursement information.",
    })
  );
  console.log("  Generated home page");
}
