import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { Pool } from "pg";
import {
  layout, esc, label, badge, entityUrl,
  relationshipList, infoRow, summaryCard, section,
} from "../html";

export async function generateATCPages(pool: Pool, dist: string) {
  console.log("\nGenerating ATC pages...");
  const dir = join(dist, "classifications");
  mkdirSync(dir, { recursive: true });

  // Fetch all ATC codes
  const { rows } = await pool.query(`
    SELECT atc.code, atc.description,
      (SELECT COALESCE(json_agg(json_build_object(
        'code', child.code, 'description', child.description
      ) ORDER BY child.code), '[]'::json)
      FROM atc_classification child
      WHERE child.code LIKE atc.code || '%'
        AND length(child.code) = CASE
          WHEN length(atc.code) = 1 THEN 3
          WHEN length(atc.code) = 3 THEN 4
          WHEN length(atc.code) = 4 THEN 5
          WHEN length(atc.code) = 5 THEN 7
          ELSE 0
        END) as children,
      (SELECT count(DISTINCT ampp.cti_extended)::int FROM ampp
       WHERE ampp.atc_code = atc.code
         AND (ampp.end_date IS NULL OR ampp.end_date > CURRENT_DATE)) as package_count
    FROM atc_classification atc
    ORDER BY atc.code`);

  // Pre-build parent lookup for hierarchy
  const atcMap = new Map(rows.map((r: any) => [r.code, r]));

  for (const atc of rows) {
    const slug = `${atc.code.toLowerCase()}_${atc.code}`;
    const pageDir = join(dir, slug);
    mkdirSync(pageDir, { recursive: true });
    writeFileSync(join(pageDir, "index.html"), renderATC(atc, atcMap));
  }
  console.log(`  ${rows.length} ATC pages`);
}

function getATCLevel(code: string): number {
  switch (code.length) {
    case 1: return 1;
    case 3: return 2;
    case 4: return 3;
    case 5: return 4;
    case 7: return 5;
    default: return 0;
  }
}

function getParentCode(code: string): string | null {
  switch (code.length) {
    case 3: return code.charAt(0);
    case 4: return code.substring(0, 3);
    case 5: return code.substring(0, 4);
    case 7: return code.substring(0, 5);
    default: return null;
  }
}

function buildHierarchy(code: string, atcMap: Map<string, any>): { code: string; description: string }[] {
  const chain: { code: string; description: string }[] = [];
  let current = code;
  while (current) {
    const parent = getParentCode(current);
    if (parent && atcMap.has(parent)) {
      chain.unshift({ code: parent, description: atcMap.get(parent).description });
    }
    current = parent!;
  }
  return chain;
}

function renderATC(atc: any, atcMap: Map<string, any>): string {
  const level = getATCLevel(atc.code);
  const hierarchy = buildHierarchy(atc.code, atcMap);

  const hierarchyHtml = hierarchy.length > 0
    ? section("detail.classificationHierarchy", `<div class="atc-hierarchy">${hierarchy.map((h, i) =>
        `<div class="atc-level"><span class="atc-indent">${"—".repeat(i + 1)}</span><a href="${entityUrl.atc(h.code)}">${esc(h.code)} — ${esc(h.description)}</a></div>`
      ).join("")}<div class="atc-level atc-level-current"><span class="atc-indent">${"—".repeat(hierarchy.length + 1)}</span>${esc(atc.code)} — ${esc(atc.description)}</div></div>`)
    : "";

  const children = relationshipList("detail.childClassifications", atc.children.map((c: any) => ({
    type: "atc", url: entityUrl.atc(c.code), name: { en: `${c.code} — ${c.description}` },
  })));

  const sidebar = summaryCard([
    { labelKey: "sidebar.level", value: `${label(`atcLevels.level${level}`)}` },
    hierarchy.length > 0 ? { labelKey: "detail.parent", value: `<a href="${entityUrl.atc(hierarchy[hierarchy.length - 1].code)}">${esc(hierarchy[hierarchy.length - 1].code)}</a>`, isLink: true } : null,
    { labelKey: "detail.children", value: String(atc.children.length) },
    { labelKey: "sidebar.packageCount", value: String(atc.package_count) },
  ].filter(Boolean) as any[]);

  return layout(`${atc.code} — ${atc.description}`, `
<div class="container page-content">
<nav class="breadcrumbs" aria-label="Breadcrumb" data-pagefind-ignore>
<a href="/">Home</a><span class="sep">›</span><span aria-current="page">${esc(atc.code)} — ${esc(atc.description)}</span>
</nav>
<div class="detail-grid"><div class="main-col">
<div class="entity-header" data-pagefind-body>${badge("atc")}
<h1 data-pagefind-meta="title">${esc(atc.description)}</h1>
<div class="entity-code"><span class="code-label">${label("codes.atcFull")}</span> <code>${esc(atc.code)}</code></div>
</div>
${hierarchyHtml}${children}
</div>${sidebar}</div></div>`, { description: `${atc.code} — ${atc.description}. ATC Classification.` });
}
