import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { layout, label } from "../html";

export function generateSearchPage(dist: string) {
  const dir = join(dist, "search");
  mkdirSync(dir, { recursive: true });

  // Pagefind will be added after generation via `pagefind --site dist`
  // This page provides the container for Pagefind UI
  const content = `
  <div class="container page-content">
    <h1 class="search-page-title">${label("common.search")}</h1>
    <div id="search"></div>
    <link href="/_search/pagefind-ui.css" rel="stylesheet">
    <script src="/_search/pagefind-ui.js"></script>
    <script>
      window.addEventListener('DOMContentLoaded', function() {
        new PagefindUI({
          element: "#search",
          showSubResults: true,
          showImages: false,
          resetStyles: false
        });
        // Auto-focus and handle ?q= param
        var params = new URLSearchParams(location.search);
        var q = params.get('q');
        if (q) {
          var input = document.querySelector('.pagefind-ui__search-input');
          if (input) { input.value = q; input.dispatchEvent(new Event('input')); }
        }
      });
    </script>
  </div>`;

  writeFileSync(join(dir, "index.html"), layout("Search", content));
  console.log("  Generated search page");
}
