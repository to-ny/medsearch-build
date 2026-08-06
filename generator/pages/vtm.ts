import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { queryAll } from "../db";
import {
  layout, esc, ml, label, entitySlug, entityUrl, formatPrice, localized,
  infoRow, formatDate, isExpired, entityHeader, infoSection, sidebar, statusPills,
} from "../html";
import { buildRelated, type RelatedResult } from "../related";

export function generateVTMPages(dist: string) {
  console.log("\nGenerating VTM pages...");
  const dir = join(dist, "substances");
  mkdirSync(dir, { recursive: true });

  const rows = queryAll(`
    SELECT v.code, v.name, v.start_date, v.end_date,
      (SELECT COALESCE(json_group_array(json_object(
        'code', vmp.code, 'name', json(vmp.name), 'status', vmp.status
      )), '[]') FROM vmp WHERE vmp.vtm_code = v.code AND (vmp.end_date IS NULL OR vmp.end_date > date('now'))) as vmps,
      (SELECT COALESCE(json_group_array(json_object(
        'code', amp.code, 'name', json(amp.name), 'companyName', c.denomination
      )), '[]') FROM amp LEFT JOIN company c ON c.actor_nr = amp.company_actor_nr
      WHERE amp.vmp_code IN (SELECT code FROM vmp WHERE vtm_code = v.code)
        AND (amp.end_date IS NULL OR amp.end_date > date('now'))) as amps,
      (SELECT COALESCE(json_group_array(json_object(
        'code', vg.code, 'name', json(vg.name)
      )), '[]') FROM vmp_group vg WHERE vg.code IN (
        SELECT DISTINCT vmp_group_code FROM vmp WHERE vtm_code = v.code
          AND vmp_group_code IS NOT NULL AND (end_date IS NULL OR end_date > date('now'))
      )) as vmp_groups,
      (SELECT COUNT(DISTINCT ampp.cti_extended) FROM ampp JOIN amp ON amp.code = ampp.amp_code
       JOIN vmp ON vmp.code = amp.vmp_code WHERE vmp.vtm_code = v.code
       AND (ampp.end_date IS NULL OR ampp.end_date > date('now'))) as package_count,
      (SELECT MIN(d.price) FROM dmpp d JOIN ampp ON ampp.cti_extended = d.ampp_cti_extended
       JOIN amp ON amp.code = ampp.amp_code JOIN vmp ON vmp.code = amp.vmp_code
       WHERE vmp.vtm_code = v.code AND d.price IS NOT NULL
       AND (d.end_date IS NULL OR d.end_date > date('now')) AND (ampp.end_date IS NULL OR ampp.end_date > date('now'))) as min_price,
      (SELECT MAX(d.price) FROM dmpp d JOIN ampp ON ampp.cti_extended = d.ampp_cti_extended
       JOIN amp ON amp.code = ampp.amp_code JOIN vmp ON vmp.code = amp.vmp_code
       WHERE vmp.vtm_code = v.code AND d.price IS NOT NULL
       AND (d.end_date IS NULL OR d.end_date > date('now')) AND (ampp.end_date IS NULL OR ampp.end_date > date('now'))) as max_price,
      (SELECT CASE WHEN COUNT(DISTINCT d.code) = 0 THEN NULL
        ELSE CAST(CAST(COUNT(DISTINCT CASE WHEN d.reimbursable THEN d.code END) AS REAL) / COUNT(DISTINCT d.code) * 100 AS INTEGER)
       END FROM dmpp d JOIN ampp ON ampp.cti_extended = d.ampp_cti_extended
       JOIN amp ON amp.code = ampp.amp_code JOIN vmp ON vmp.code = amp.vmp_code
       WHERE vmp.vtm_code = v.code AND (d.end_date IS NULL OR d.end_date > date('now'))
       AND (ampp.end_date IS NULL OR ampp.end_date > date('now'))) as reimbursable_percentage
    FROM vtm v WHERE v.end_date IS NULL OR v.end_date > date('now') ORDER BY json_extract(v.name, '$.en')`);

  for (const vtm of rows) {
    const slug = entitySlug(vtm.name, vtm.code);
    const pageDir = join(dir, slug);
    mkdirSync(pageDir, { recursive: true });
    const related = buildRelated({
      entityDir: pageDir,
      entityBaseUrl: entityUrl.vtm(vtm.name, vtm.code),
      entityName: localized(vtm.name, "en"),
      entityNameHtml: ml(vtm.name),
      collections: [
        { labelKey: "detail.genericProducts", singularKey: "detail.genericProduct", slug: "generics", items: vtm.vmps.map((x: any) => ({
          type: "vmp", url: entityUrl.vmp(x.name, x.code), name: x.name,
          subtitle: x.status !== "AUTHORIZED" ? x.status : undefined,
        })) },
        { labelKey: "detail.brandProducts", singularKey: "detail.brandProduct", slug: "brands", items: vtm.amps.map((x: any) => ({
          type: "amp", url: entityUrl.amp(x.name, x.code), name: x.name, subtitle: x.companyName,
        })) },
        { labelKey: "detail.therapeuticGroups", singularKey: "detail.therapeuticGroup", slug: "therapeutic-groups", items: vtm.vmp_groups.map((g: any) => ({
          type: "vmp_group", url: entityUrl.vmpGroup(g.name, g.code), name: g.name,
        })) },
      ],
    });
    writeFileSync(join(pageDir, "index.html"), renderVTM(vtm, related));
  }
  console.log(`  ${rows.length} VTM pages`);
}

function renderVTM(v: any, related: RelatedResult): string {
  const name = localized(v.name, "en");

  const langVariants = (["nl", "fr", "en", "de"] as const)
    .filter((l) => v.name[l] && v.name[l] !== name)
    .map((l) => infoRow(`languages.${l === "nl" ? "dutch" : l === "fr" ? "french" : l === "en" ? "english" : "german"}`, esc(v.name[l])))
    .join("");

  const validityRow = v.start_date || v.end_date
    ? infoRow("detail.validity", `${formatDate(v.start_date)} — ${v.end_date ? formatDate(v.end_date) : "∞"}`)
    : "";

  const priceStr = v.min_price != null
    ? `${formatPrice(v.min_price)}${v.max_price != null && v.max_price !== v.min_price ? ` — ${formatPrice(v.max_price)}` : ""}`
    : "";

  const detailRows = [validityRow, langVariants];

  const keyFigures = infoSection("detail.keyFigures", [
    priceStr ? infoRow("search.priceRange", priceStr) : "",
    v.reimbursable_percentage != null ? infoRow("sidebar.reimbursablePercent", `${v.reimbursable_percentage}%`) : "",
  ]);

  const header = entityHeader({
    type: "vtm",
    nameHtml: ml(v.name),
    codesHtml: `<div class="entity-code"><span class="code-label">${label("detail.code")}</span> <code>${esc(v.code)}</code></div>`,
    pillsHtml: isExpired(v.end_date) ? statusPills([{ labelKey: "sidebar.expired", kind: "expired" }]) : "",
  });

  const side = sidebar(related.collections);

  return layout(name, `
<div class="container page-content">
<div class="detail-grid${side ? "" : " detail-grid-single"}"><div class="main-col">
${header}
${infoSection("detail.details", detailRows)}
${keyFigures}
</div>${side}</div></div>`, { description: `${name} — Active substance with ${v.vmps.length} generic products and ${v.amps.length} brand products.` });
}
