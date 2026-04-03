import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { Pool } from "pg";
import {
  layout, esc, ml, label, badge, entitySlug, entityUrl,
  localized, relationshipList, infoRow, summaryCard, formatDate, section,
} from "../html";

export async function generateSubstancePages(pool: Pool, dist: string) {
  console.log("\nGenerating Substance pages...");
  const dir = join(dist, "ingredients");
  mkdirSync(dir, { recursive: true });

  const { rows } = await pool.query(`
    SELECT s.code, s.name, s.start_date, s.end_date,
      (SELECT COALESCE(json_agg(json_build_object(
        'code', a.code, 'name', a.name, 'companyName', c.denomination
      ) ORDER BY a.name->>'en'), '[]'::json)
      FROM amp_ingredient i JOIN amp a ON a.code = i.amp_code
      LEFT JOIN company c ON c.actor_nr = a.company_actor_nr
      WHERE i.substance_code = s.code AND (a.end_date IS NULL OR a.end_date > CURRENT_DATE)) as used_in_amps
    FROM substance s WHERE s.end_date IS NULL OR s.end_date > CURRENT_DATE
    ORDER BY s.name->>'en'`);

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
  const hasOverview = s.start_date || s.end_date || langVariants;
  const overview = hasOverview
    ? section("detail.overview", `<dl class="info-list">${s.start_date || s.end_date ? infoRow("detail.validity", `${formatDate(s.start_date)} — ${s.end_date ? formatDate(s.end_date) : "∞"}`) : ""}${langVariants}</dl>`)
    : "";

  const amps = relationshipList("detail.productsContainingIngredient", s.used_in_amps.map((a: any) => ({
    type: "amp", url: entityUrl.amp(a.name, a.code), name: a.name, subtitle: a.companyName,
  })));

  const sidebar = summaryCard([
    { labelKey: "detail.brandProducts", value: String(s.used_in_amps.length) },
    { labelKey: "detail.validity", value: s.end_date && new Date(s.end_date) < new Date() ? label("sidebar.expired") : label("sidebar.active") },
  ]);

  return layout(name, `
<div class="container page-content">
<nav class="breadcrumbs" aria-label="Breadcrumb" data-pagefind-ignore>
<a href="/">Home</a><span class="sep">›</span><span aria-current="page">${ml(s.name)}</span>
</nav>
<div class="detail-grid"><div class="main-col">
<div class="entity-header" data-pagefind-body>${badge("substance")}
<h1 data-pagefind-meta="title">${ml(s.name)}</h1>
<div class="entity-code"><span class="code-label">${label("detail.code")}</span> <code>${esc(s.code)}</code></div>
</div>
${overview}${amps}
</div>${sidebar}</div></div>`, { description: `${name} — Ingredient used in ${s.used_in_amps.length} products.` });
}
