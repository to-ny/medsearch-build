import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { queryAll } from "../db";
import {
  layout, esc, ml, label, entitySlug, entityUrl, localized,
  infoRow, entityHeader, infoSection, sidebar,
} from "../html";
import { buildRelated, type RelatedResult } from "../related";

export function generateSubstancePages(dist: string) {
  console.log("\nGenerating Substance pages...");
  const dir = join(dist, "ingredients");
  mkdirSync(dir, { recursive: true });

  const rows = queryAll(`
    SELECT s.code, s.name,
      (SELECT COALESCE(json_group_array(json_object(
        'code', a.code, 'name', json(a.name), 'companyName', c.denomination
      )), '[]')
      FROM amp_ingredient i JOIN amp a ON a.code = i.amp_code
      LEFT JOIN company c ON c.actor_nr = a.company_actor_nr
      WHERE i.substance_code = s.code AND (a.end_date IS NULL OR a.end_date > date('now'))
      ORDER BY json_extract(a.name, '$.en')) as used_in_amps
    FROM substance s
    ORDER BY json_extract(s.name, '$.en')`);

  for (const sub of rows) {
    const slug = entitySlug(sub.name, sub.code);
    const pageDir = join(dir, slug);
    mkdirSync(pageDir, { recursive: true });
    const related = buildRelated({
      entityDir: pageDir,
      entityBaseUrl: entityUrl.substance(sub.name, sub.code),
      entityName: localized(sub.name, "en"),
      entityNameHtml: ml(sub.name),
      collections: [
        { labelKey: "detail.productsContainingIngredient", singularKey: "detail.brandProduct", slug: "products", items: sub.used_in_amps.map((a: any) => ({
          type: "amp", url: entityUrl.amp(a.name, a.code), name: a.name, subtitle: a.companyName,
        })) },
      ],
    });
    writeFileSync(join(pageDir, "index.html"), renderSubstance(sub, related));
  }
  console.log(`  ${rows.length} Substance pages`);
}

function renderSubstance(s: any, related: RelatedResult): string {
  const name = localized(s.name, "en");

  const langVariants = (["nl", "fr", "en", "de"] as const)
    .filter((l) => s.name[l] && s.name[l] !== name)
    .map((l) => infoRow(`languages.${l === "nl" ? "dutch" : l === "fr" ? "french" : l === "en" ? "english" : "german"}`, esc(s.name[l])))
    .join("");

  const header = entityHeader({
    type: "substance",
    nameHtml: ml(s.name),
    codesHtml: `<div class="entity-code"><span class="code-label">${label("detail.code")}</span> <code>${esc(s.code)}</code></div>`,
  });

  const side = sidebar(related.collections);

  return layout(name, `
<div class="container page-content">
<div class="detail-grid${side ? "" : " detail-grid-single"}"><div class="main-col">
${header}
${infoSection("detail.details", [langVariants])}
</div>${side}</div></div>`, { description: `${name} — Ingredient used in ${s.used_in_amps.length} products.` });
}
