import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { queryAll } from "../db";
import {
  layout, esc, ml, label, entitySlug, entityUrl, localized,
  infoRow, formatDate, isExpired, entityHeader, infoSection, sidebar, statusPills,
} from "../html";
import { buildRelated, type RelatedResult } from "../related";

export function generateVMPGroupPages(dist: string) {
  console.log("\nGenerating VMP Group pages...");
  const dir = join(dist, "therapeutic-groups");
  mkdirSync(dir, { recursive: true });

  const rows = queryAll(`
    SELECT vg.code, vg.name, vg.no_generic_prescription_reason, vg.no_switch_reason,
      vg.patient_frailty_indicator, vg.start_date, vg.end_date,
      (SELECT COALESCE(json_group_array(json_object(
        'code', vmp.code, 'name', json(vmp.name), 'status', vmp.status
      )), '[]')
      FROM vmp WHERE vmp.vmp_group_code = vg.code
        AND (vmp.end_date IS NULL OR vmp.end_date > date('now'))
      ORDER BY json_extract(vmp.name, '$.en')) as vmps
    FROM vmp_group vg WHERE vg.end_date IS NULL OR vg.end_date > date('now')
    ORDER BY json_extract(vg.name, '$.en')`);

  for (const vg of rows) {
    const slug = entitySlug(vg.name, vg.code);
    const pageDir = join(dir, slug);
    mkdirSync(pageDir, { recursive: true });
    const related = buildRelated({
      entityDir: pageDir,
      entityBaseUrl: entityUrl.vmpGroup(vg.name, vg.code),
      entityName: localized(vg.name, "en"),
      entityNameHtml: ml(vg.name),
      collections: [
        { labelKey: "detail.memberProducts", singularKey: "detail.memberProduct", slug: "members", items: vg.vmps.map((v: any) => ({
          type: "vmp", url: entityUrl.vmp(v.name, v.code), name: v.name,
          subtitle: v.status !== "AUTHORIZED" ? v.status : undefined,
        })) },
      ],
    });
    writeFileSync(join(pageDir, "index.html"), renderVMPGroup(vg, related));
  }
  console.log(`  ${rows.length} VMP Group pages`);
}

function renderVMPGroup(vg: any, related: RelatedResult): string {
  const name = localized(vg.name, "en");

  const warnings: string[] = [];
  if (vg.patient_frailty_indicator) warnings.push(
    `<div class="warning-box"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/></svg><span>${label("detail.patientFrailtyDescription")}</span></div>`);

  const detailRows = [
    vg.no_generic_prescription_reason ? infoRow("detail.noGenericPrescription", esc(vg.no_generic_prescription_reason)) : "",
    vg.no_switch_reason ? infoRow("detail.noSwitching", esc(vg.no_switch_reason)) : "",
    vg.start_date || vg.end_date ? infoRow("detail.validity", `${formatDate(vg.start_date)} — ${vg.end_date ? formatDate(vg.end_date) : "∞"}`) : "",
  ];

  const header = entityHeader({
    type: "vmp_group",
    nameHtml: ml(vg.name),
    codesHtml: `<div class="entity-code"><span class="code-label">${label("detail.code")}</span> <code>${esc(vg.code)}</code></div>`,
    pillsHtml: isExpired(vg.end_date) ? statusPills([{ labelKey: "sidebar.expired", kind: "expired" }]) : "",
  });

  const side = sidebar(related.collections);

  return layout(name, `
<div class="container page-content">
<div class="detail-grid${side ? "" : " detail-grid-single"}"><div class="main-col">
${header}
${warnings.join("")}
${infoSection("detail.details", detailRows)}
</div>${side}</div></div>`, { description: `${name} — Therapeutic group with ${vg.vmps.length} products.` });
}
