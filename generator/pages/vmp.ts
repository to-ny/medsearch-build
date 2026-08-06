import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { queryAll } from "../db";
import {
  layout, esc, ml, label, entitySlug, entityUrl, formatPrice, localized,
  infoRow, formatDate, isExpired, entityHeader, infoSection, sidebar, statusPills, breadcrumb,
} from "../html";
import { buildRelated, type RelatedResult } from "../related";

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
    const related = buildRelated({
      entityDir: pageDir,
      entityBaseUrl: entityUrl.vmp(vmp.name, vmp.code),
      entityName: localized(vmp.name, "en"),
      entityNameHtml: ml(vmp.name),
      collections: [
        { labelKey: "detail.brandProducts", singularKey: "detail.brandProduct", slug: "brands", items: vmp.amps.map((x: any) => ({
          type: "amp", url: entityUrl.amp(x.name, x.code), name: x.name, subtitle: x.companyName,
        })) },
      ],
    });
    writeFileSync(join(pageDir, "index.html"), renderVMP(vmp, related));
  }
  console.log(`  ${rows.length} VMP pages`);
}

function renderVMP(v: any, related: RelatedResult): string {
  const name = localized(v.name, "en");

  const priceStr = v.min_price != null
    ? `${formatPrice(v.min_price)}${v.max_price != null && v.max_price !== v.min_price ? ` — ${formatPrice(v.max_price)}` : ""}`
    : "";

  const crumbs = [];
  if (v.vtm) crumbs.push({ html: ml(v.vtm.name), url: entityUrl.vtm(v.vtm.name, v.vtm.code) });
  crumbs.push({ html: ml(v.name) });

  const relationshipRows = [
    v.vmp_group ? infoRow("detail.therapeuticGroup", `<a href="${entityUrl.vmpGroup(v.vmp_group.name, v.vmp_group.code)}">${ml(v.vmp_group.name)}</a>`) : "",
  ];
  const attrRows = [
    v.abbreviated_name ? infoRow("detail.abbreviatedName", ml(v.abbreviated_name)) : "",
    v.start_date || v.end_date ? infoRow("detail.validity", `${formatDate(v.start_date)} — ${v.end_date ? formatDate(v.end_date) : "∞"}`) : "",
    v.status && v.status !== "AUTHORIZED" ? infoRow("detail.status", esc(v.status)) : "",
  ];

  const keyFigures = infoSection("detail.keyFigures", [
    priceStr ? infoRow("search.priceRange", priceStr) : "",
    v.reimbursable_percentage != null ? infoRow("sidebar.reimbursablePercent", `${v.reimbursable_percentage}%`) : "",
  ]);

  const header = entityHeader({
    type: "vmp",
    nameHtml: ml(v.name),
    codesHtml: `<div class="entity-code"><span class="code-label">${label("detail.code")}</span> <code>${esc(v.code)}</code></div>`,
    pillsHtml: isExpired(v.end_date) ? statusPills([{ labelKey: "sidebar.expired", kind: "expired" }]) : "",
  });

  const side = sidebar(related.collections);

  return layout(name, `
<div class="container page-content">
${breadcrumb(crumbs)}
<div class="detail-grid${side ? "" : " detail-grid-single"}"><div class="main-col">
${header}
${infoSection("detail.details", [...relationshipRows, ...attrRows])}
${keyFigures}
</div>${side}</div></div>`, { description: `${name} — Generic product with ${v.amps.length} brands.` });
}
