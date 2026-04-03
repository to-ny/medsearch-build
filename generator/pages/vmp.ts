import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { queryAll } from "../db";
import {
  layout, esc, ml, label, badge, entitySlug, entityUrl, formatPrice,
  localized, relationshipList, infoRow, summaryCard, formatDate, section,
} from "../html";

export function generateVMPPages(dist: string) {
  console.log("\nGenerating VMP pages...");
  const dir = join(dist, "generics");
  mkdirSync(dir, { recursive: true });

  const rows = queryAll(`
    SELECT v.code, v.name, v.abbreviated_name, v.vtm_code, v.vmp_group_code, v.status,
      v.start_date, v.end_date,
      (SELECT json_object('code', vtm.code, 'name', json(vtm.name)) FROM vtm WHERE vtm.code = v.vtm_code) as vtm,
      (SELECT json_object('code', vg.code, 'name', json(vg.name), 'patientFrailtyIndicator', vg.patient_frailty_indicator)
       FROM vmp_group vg WHERE vg.code = v.vmp_group_code) as vmp_group,
      (SELECT COALESCE(json_group_array(json_object(
        'code', amp.code, 'name', json(amp.name), 'companyName', c.denomination, 'blackTriangle', amp.black_triangle
      )), '[]')
      FROM amp LEFT JOIN company c ON c.actor_nr = amp.company_actor_nr
      WHERE amp.vmp_code = v.code AND (amp.end_date IS NULL OR amp.end_date > date('now'))
      ORDER BY json_extract(amp.name, '$.en')) as amps,
      (SELECT COUNT(DISTINCT ampp.cti_extended) FROM ampp JOIN amp ON amp.code = ampp.amp_code
       WHERE amp.vmp_code = v.code AND (ampp.end_date IS NULL OR ampp.end_date > date('now'))) as package_count,
      (SELECT MIN(d.price) FROM dmpp d JOIN ampp ON ampp.cti_extended = d.ampp_cti_extended
       JOIN amp ON amp.code = ampp.amp_code WHERE amp.vmp_code = v.code AND d.price IS NOT NULL
       AND (d.end_date IS NULL OR d.end_date > date('now')) AND (ampp.end_date IS NULL OR ampp.end_date > date('now'))) as min_price,
      (SELECT MAX(d.price) FROM dmpp d JOIN ampp ON ampp.cti_extended = d.ampp_cti_extended
       JOIN amp ON amp.code = ampp.amp_code WHERE amp.vmp_code = v.code AND d.price IS NOT NULL
       AND (d.end_date IS NULL OR d.end_date > date('now')) AND (ampp.end_date IS NULL OR ampp.end_date > date('now'))) as max_price,
      (SELECT CASE WHEN COUNT(DISTINCT d.code) = 0 THEN NULL
        ELSE CAST(CAST(COUNT(DISTINCT CASE WHEN d.reimbursable THEN d.code END) AS REAL) / COUNT(DISTINCT d.code) * 100 AS INTEGER)
       END FROM dmpp d JOIN ampp ON ampp.cti_extended = d.ampp_cti_extended
       JOIN amp ON amp.code = ampp.amp_code WHERE amp.vmp_code = v.code
       AND (d.end_date IS NULL OR d.end_date > date('now')) AND (ampp.end_date IS NULL OR ampp.end_date > date('now'))) as reimbursable_percentage
    FROM vmp v WHERE v.end_date IS NULL OR v.end_date > date('now') ORDER BY json_extract(v.name, '$.en')`);

  for (const vmp of rows) {
    const slug = entitySlug(vmp.name, vmp.code);
    const pageDir = join(dir, slug);
    mkdirSync(pageDir, { recursive: true });
    writeFileSync(join(pageDir, "index.html"), renderVMP(vmp));
  }
  console.log(`  ${rows.length} VMP pages`);
}

function renderVMP(v: any): string {
  const name = localized(v.name, "en");

  const overviewRows: string[] = [];
  if (v.abbreviated_name) overviewRows.push(infoRow("detail.abbreviatedName", ml(v.abbreviated_name)));
  if (v.start_date || v.end_date) overviewRows.push(infoRow("detail.validity", `${formatDate(v.start_date)} — ${v.end_date ? formatDate(v.end_date) : "∞"}`));
  if (v.status && v.status !== "AUTHORIZED") overviewRows.push(infoRow("detail.status", esc(v.status)));

  const overview = overviewRows.length ? section("detail.overview", `<dl class="info-list">${overviewRows.join("")}</dl>`) : "";

  const vtmLink = v.vtm ? section("detail.activeSubstance",
    `<a href="${entityUrl.vtm(v.vtm.name, v.vtm.code)}" class="rel-item">${badge("vtm")}<div class="rel-item-content"><span class="rel-item-name">${ml(v.vtm.name)}</span></div><span class="rel-item-arrow">›</span></a>`) : "";

  const groupLink = v.vmp_group ? section("detail.therapeuticGroup",
    `<a href="${entityUrl.vmpGroup(v.vmp_group.name, v.vmp_group.code)}" class="rel-item">${badge("vmp_group")}<div class="rel-item-content"><span class="rel-item-name">${ml(v.vmp_group.name)}</span></div><span class="rel-item-arrow">›</span></a>`) : "";

  const amps = relationshipList("detail.brandProducts", v.amps.map((x: any) => ({
    type: "amp", url: entityUrl.amp(x.name, x.code), name: x.name, subtitle: x.companyName,
  })));

  const priceStr = v.min_price != null
    ? `${formatPrice(v.min_price)}${v.max_price != null && v.max_price !== v.min_price ? ` — ${formatPrice(v.max_price)}` : ""}`
    : "";

  const sidebar = summaryCard([
    v.vtm ? { labelKey: "detail.activeSubstance", value: `<a href="${entityUrl.vtm(v.vtm.name, v.vtm.code)}">${ml(v.vtm.name)}</a>`, isLink: true } : null,
    { labelKey: "detail.brandProducts", value: String(v.amps.length) },
    { labelKey: "sidebar.packageCount", value: String(v.package_count) },
    { labelKey: "search.priceRange", value: priceStr },
    { labelKey: "sidebar.reimbursablePercent", value: v.reimbursable_percentage != null ? `${v.reimbursable_percentage}%` : "" },
    { labelKey: "detail.validity", value: v.end_date && new Date(v.end_date) < new Date() ? label("sidebar.expired") : label("sidebar.active") },
  ].filter(Boolean) as any[]);

  return layout(name, `
<div class="container page-content">
<nav class="breadcrumbs" aria-label="Breadcrumb" data-pagefind-ignore>
<a href="/">Home</a><span class="sep">›</span><span aria-current="page">${ml(v.name)}</span>
</nav>
<div class="detail-grid"><div class="main-col">
<div class="entity-header" data-pagefind-body>${badge("vmp")}
<h1 data-pagefind-meta="title">${ml(v.name)}</h1>
<div class="entity-code"><span class="code-label">${label("detail.code")}</span> <code>${esc(v.code)}</code></div>
</div>
${overview}${vtmLink}${groupLink}${amps}
</div>${sidebar}</div></div>`, { description: `${name} — Generic product with ${v.amps.length} brands.` });
}
