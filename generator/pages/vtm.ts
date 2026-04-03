import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { Pool } from "pg";
import {
  layout, esc, ml, label, badge, entitySlug, entityUrl, formatPrice,
  localized, relationshipList, infoRow, summaryCard, formatDate, section, minify,
} from "../html";

export async function generateVTMPages(pool: Pool, dist: string) {
  console.log("\nGenerating VTM pages...");
  const dir = join(dist, "substances");
  mkdirSync(dir, { recursive: true });

  const { rows } = await pool.query(`
    SELECT v.code, v.name, v.start_date, v.end_date,
      (SELECT COALESCE(json_agg(json_build_object(
        'code', vmp.code, 'name', vmp.name, 'status', vmp.status
      ) ORDER BY vmp.name->>'en'), '[]'::json)
      FROM vmp WHERE vmp.vtm_code = v.code AND (vmp.end_date IS NULL OR vmp.end_date > CURRENT_DATE)) as vmps,
      (SELECT COALESCE(json_agg(json_build_object(
        'code', amp.code, 'name', amp.name, 'companyName', c.denomination
      ) ORDER BY amp.name->>'en'), '[]'::json)
      FROM amp LEFT JOIN company c ON c.actor_nr = amp.company_actor_nr
      WHERE amp.vmp_code IN (SELECT code FROM vmp WHERE vtm_code = v.code)
        AND (amp.end_date IS NULL OR amp.end_date > CURRENT_DATE)) as amps,
      (SELECT COALESCE(json_agg(json_build_object(
        'code', vg.code, 'name', vg.name
      ) ORDER BY vg.name->>'en'), '[]'::json)
      FROM vmp_group vg WHERE vg.code IN (
        SELECT DISTINCT vmp_group_code FROM vmp WHERE vtm_code = v.code
          AND vmp_group_code IS NOT NULL AND (end_date IS NULL OR end_date > CURRENT_DATE)
      )) as vmp_groups,
      (SELECT COUNT(DISTINCT ampp.cti_extended)::int FROM ampp JOIN amp ON amp.code = ampp.amp_code
       JOIN vmp ON vmp.code = amp.vmp_code WHERE vmp.vtm_code = v.code
       AND (ampp.end_date IS NULL OR ampp.end_date > CURRENT_DATE)) as package_count,
      (SELECT MIN(d.price) FROM dmpp d JOIN ampp ON ampp.cti_extended = d.ampp_cti_extended
       JOIN amp ON amp.code = ampp.amp_code JOIN vmp ON vmp.code = amp.vmp_code
       WHERE vmp.vtm_code = v.code AND d.price IS NOT NULL
       AND (d.end_date IS NULL OR d.end_date > CURRENT_DATE) AND (ampp.end_date IS NULL OR ampp.end_date > CURRENT_DATE)) as min_price,
      (SELECT MAX(d.price) FROM dmpp d JOIN ampp ON ampp.cti_extended = d.ampp_cti_extended
       JOIN amp ON amp.code = ampp.amp_code JOIN vmp ON vmp.code = amp.vmp_code
       WHERE vmp.vtm_code = v.code AND d.price IS NOT NULL
       AND (d.end_date IS NULL OR d.end_date > CURRENT_DATE) AND (ampp.end_date IS NULL OR ampp.end_date > CURRENT_DATE)) as max_price,
      (SELECT CASE WHEN COUNT(DISTINCT d.code) = 0 THEN NULL
        ELSE (COUNT(DISTINCT CASE WHEN d.reimbursable THEN d.code END)::float / COUNT(DISTINCT d.code)::float * 100)::int
       END FROM dmpp d JOIN ampp ON ampp.cti_extended = d.ampp_cti_extended
       JOIN amp ON amp.code = ampp.amp_code JOIN vmp ON vmp.code = amp.vmp_code
       WHERE vmp.vtm_code = v.code AND (d.end_date IS NULL OR d.end_date > CURRENT_DATE)
       AND (ampp.end_date IS NULL OR ampp.end_date > CURRENT_DATE)) as reimbursable_percentage
    FROM vtm v WHERE v.end_date IS NULL OR v.end_date > CURRENT_DATE ORDER BY v.name->>'en'`);

  for (const vtm of rows) {
    const slug = entitySlug(vtm.name, vtm.code);
    const pageDir = join(dir, slug);
    mkdirSync(pageDir, { recursive: true });
    writeFileSync(join(pageDir, "index.html"), renderVTM(vtm));
  }
  console.log(`  ${rows.length} VTM pages`);
}

function renderVTM(v: any): string {
  const name = localized(v.name, "en");
  const isExpired = v.end_date && new Date(v.end_date) < new Date();

  const langVariants = (["nl", "fr", "en", "de"] as const)
    .filter((l) => v.name[l] && v.name[l] !== name)
    .map((l) => infoRow(`languages.${l === "nl" ? "dutch" : l === "fr" ? "french" : l === "en" ? "english" : "german"}`, esc(v.name[l])))
    .join("");

  const hasOverview = v.start_date || v.end_date || langVariants;
  const overview = hasOverview
    ? section("detail.overview", `<dl class="info-list">${v.start_date || v.end_date ? infoRow("detail.validity", `${formatDate(v.start_date)} — ${v.end_date ? formatDate(v.end_date) : "∞"}`) : ""}${langVariants}</dl>`)
    : "";

  const vmps = relationshipList("detail.genericProducts", v.vmps.map((x: any) => ({
    type: "vmp", url: entityUrl.vmp(x.name, x.code), name: x.name,
    subtitle: x.status !== "AUTHORIZED" ? x.status : undefined,
  })));

  const amps = relationshipList("detail.brandProducts", v.amps.map((x: any) => ({
    type: "amp", url: entityUrl.amp(x.name, x.code), name: x.name, subtitle: x.companyName,
  })));

  const priceStr = v.min_price != null
    ? `${formatPrice(v.min_price)}${v.max_price != null && v.max_price !== v.min_price ? ` — ${formatPrice(v.max_price)}` : ""}`
    : "";

  const sidebar = summaryCard([
    ...v.vmp_groups.slice(0, 2).map((g: any) => ({
      labelKey: "detail.therapeuticGroup",
      value: `<a href="${entityUrl.vmpGroup(g.name, g.code)}">${ml(g.name)}</a>`,
      isLink: true,
    })),
    { labelKey: "detail.genericProducts", value: String(v.vmps.length) },
    { labelKey: "detail.brandProducts", value: String(v.amps.length) },
    { labelKey: "sidebar.packageCount", value: String(v.package_count) },
    { labelKey: "search.priceRange", value: priceStr },
    { labelKey: "sidebar.reimbursablePercent", value: v.reimbursable_percentage != null ? `${v.reimbursable_percentage}%` : "" },
    { labelKey: "detail.validity", value: isExpired ? label("sidebar.expired") : label("sidebar.active") },
  ]);

  return layout(name, `
<div class="container page-content">
<nav class="breadcrumbs" aria-label="Breadcrumb" data-pagefind-ignore>
<a href="/">Home</a><span class="sep">›</span><span aria-current="page">${ml(v.name)}</span>
</nav>
<div class="detail-grid">
<div class="main-col">
<div class="entity-header" data-pagefind-body>${badge("vtm")}
<h1 data-pagefind-meta="title">${ml(v.name)}</h1>
<div class="entity-code"><span class="code-label">${label("detail.code")}</span> <code>${esc(v.code)}</code></div>
</div>
${overview}${vmps}${amps}
</div>
${sidebar}
</div>
</div>`, { description: `${name} — Active substance with ${v.vmps.length} generic products and ${v.amps.length} brand products.` });
}
