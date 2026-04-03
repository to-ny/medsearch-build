import { writeFileSync } from "fs";
import { join } from "path";
import { layout, label } from "../html";

interface Stats {
  vtm: number;
  vmp: number;
  amp: number;
  ampp: number;
  company: number;
  substance: number;
}

export function generateHomePage(dist: string, stats: Stats) {
  const content = `
<div class="hero">
<div class="container hero-inner">
<h1>${label("home.title")}</h1>
<p class="hero-subtitle">${label("home.subtitle")}</p>
<div class="hero-examples">
<span class="examples-label">${label("home.examples")}:</span>
<button class="chip" onclick="fillSearch('paracetamol')">paracetamol</button>
<button class="chip" onclick="fillSearch('Dafalgan')">Dafalgan</button>
<button class="chip" onclick="fillSearch('0039347')">0039347</button>
<button class="chip" onclick="fillSearch('Pfizer')">Pfizer</button>
<button class="chip" onclick="fillSearch('N02BE01')">N02BE01</button>
</div>
</div>
<div class="hero-stats">
<div class="stat"><span class="stat-value">${stats.amp.toLocaleString()}</span><span class="stat-label">${label("stats.medications")}</span></div>
<div class="stat"><span class="stat-value">${stats.ampp.toLocaleString()}</span><span class="stat-label">${label("stats.packages")}</span></div>
<div class="stat"><span class="stat-value">${stats.substance.toLocaleString()}</span><span class="stat-label">${label("stats.substances")}</span></div>
</div>
</div>
<div class="search-section">
<div id="search"></div>
</div>
<link href="/_search/pagefind-ui.css" rel="stylesheet">
<script src="/_search/pagefind-ui.js"></script>
<script>
window.addEventListener('DOMContentLoaded', function() {
  new PagefindUI({ element: "#search", showSubResults: true, showImages: false, resetStyles: false });
  var params = new URLSearchParams(location.search);
  var q = params.get('q');
  if (q) fillSearch(q);
});
function fillSearch(q) {
  var input = document.querySelector('.pagefind-ui__search-input');
  if (input) { input.value = q; input.dispatchEvent(new Event('input')); input.focus(); }
}
</script>`;

  writeFileSync(
    join(dist, "index.html"),
    layout("MedSearch — Belgium Medication Database", content, {
      description:
        "Search Belgium's official SAM medication database. Find medications, substances, brands, packages, pricing, and reimbursement information.",
    })
  );
  console.log("  Generated home page");
}
