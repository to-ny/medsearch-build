import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { queryAll } from "../db";
import {
  layout, esc, label, entityUrl,
  infoRow, entityHeader, infoSection, sidebar, breadcrumb,
} from "../html";
import { buildRelated, type RelatedResult } from "../related";

export function generateATCPages(dist: string) {
  console.log("\nGenerating ATC pages...");
  const dir = join(dist, "classifications");
  mkdirSync(dir, { recursive: true });

  // Fetch all ATC codes
  const rows = queryAll(`
    SELECT atc.code, atc.description,
      (SELECT COALESCE(json_group_array(json_object(
        'code', child.code, 'description', child.description
      )), '[]')
      FROM atc_classification child
      WHERE child.code LIKE atc.code || '%'
        AND length(child.code) = CASE
          WHEN length(atc.code) = 1 THEN 3
          WHEN length(atc.code) = 3 THEN 4
          WHEN length(atc.code) = 4 THEN 5
          WHEN length(atc.code) = 5 THEN 7
          ELSE 0
        END
      ORDER BY child.code) as children,
      (SELECT COUNT(DISTINCT ampp.cti_extended) FROM ampp
       WHERE ampp.atc_code = atc.code
         AND (ampp.end_date IS NULL OR ampp.end_date > date('now'))) as package_count
    FROM atc_classification atc
    ORDER BY atc.code`);

  // Pre-build parent lookup for hierarchy
  const atcMap = new Map(rows.map((r: any) => [r.code, r]));

  for (const atc of rows) {
    const slug = `${atc.code.toLowerCase()}_${atc.code}`;
    const pageDir = join(dir, slug);
    mkdirSync(pageDir, { recursive: true });
    const entityName = `${atc.code} — ${atc.description}`;
    const related = buildRelated({
      entityDir: pageDir,
      entityBaseUrl: entityUrl.atc(atc.code),
      entityName,
      entityNameHtml: esc(entityName),
      collections: [
        { labelKey: "detail.childClassifications", singularKey: "detail.childClassification", slug: "children", items: atc.children.map((c: any) => ({
          type: "atc", url: entityUrl.atc(c.code), name: { en: `${c.code} — ${c.description}` },
        })) },
      ],
    });
    writeFileSync(join(pageDir, "index.html"), renderATC(atc, atcMap, related));
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

function renderATC(atc: any, atcMap: Map<string, any>, related: RelatedResult): string {
  const level = getATCLevel(atc.code);
  const hierarchy = buildHierarchy(atc.code, atcMap);

  const crumbs: { html: string; url?: string }[] = hierarchy.map((h) => ({ html: esc(h.code), url: entityUrl.atc(h.code) }));
  crumbs.push({ html: esc(atc.code) });

  const detailRows = [infoRow("sidebar.level", label(`atcLevels.level${level}`))];

  const header = entityHeader({
    type: "atc",
    nameHtml: esc(atc.description),
    codesHtml: `<div class="entity-code"><span class="code-label">${label("codes.atcFull")}</span> <code>${esc(atc.code)}</code></div>`,
  });

  const side = sidebar(related.collections);

  return layout(`${atc.code} — ${atc.description}`, `
<div class="container page-content">
${hierarchy.length > 0 ? breadcrumb(crumbs) : ""}
<div class="detail-grid${side ? "" : " detail-grid-single"}"><div class="main-col">
${header}
${infoSection("detail.details", detailRows)}
</div>${side}</div></div>`, { description: `${atc.code} — ${atc.description}. ATC Classification.` });
}
