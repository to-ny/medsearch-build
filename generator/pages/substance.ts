import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { queryAll } from "../db";
import {
  layout, esc, ml, label, badge, entitySlug, entityUrl,
  localized, relationshipList, infoRow, summaryCard, section,
} from "../html";

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
    writeFileSync(join(pageDir, "index.html"), renderSubstance(sub));
  }
  console.log(`  ${rows.length} Substance pages`);
}

function renderSubstance(s: any): string {
  const name = localized(s.name, "en");

  const langVariants = (["nl", "fr", "en", "de"] as const)
    .filter((l) => s.name[l] && s.name[l] !== name)
    .map((l) => infoRow(`languages.${l === "nl" ? "dutch" : l === "fr" ? "french" : l === "en" ? "english" : "german"}`, esc(s.name[l])))
    .join("");
  const overview = langVariants
    ? section("detail.overview", `<dl class="info-list">${langVariants}</dl>`)
    : "";

  const amps = relationshipList("detail.productsContainingIngredient", s.used_in_amps.map((a: any) => ({
    type: "amp", url: entityUrl.amp(a.name, a.code), name: a.name, subtitle: a.companyName,
  })));

  const sidebar = summaryCard([
    { labelKey: "detail.brandProducts", value: String(s.used_in_amps.length) },
  ]);

  return layout(name, `
<div class="container page-content">
<div class="detail-grid"><div class="main-col">
<div class="entity-header">${badge("substance")}
<h1>${ml(s.name)}</h1>
<div class="entity-code"><span class="code-label">${label("detail.code")}</span> <code>${esc(s.code)}</code></div>
</div>
${overview}${amps}
</div>${sidebar}</div></div>`, { description: `${name} — Ingredient used in ${s.used_in_amps.length} products.` });
}
