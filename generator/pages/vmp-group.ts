import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { queryAll } from "../db";
import {
  layout, esc, ml, label, badge, entitySlug, entityUrl,
  localized, relationshipList, infoRow, summaryCard, formatDate, section,
} from "../html";

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
    writeFileSync(join(pageDir, "index.html"), renderVMPGroup(vg));
  }
  console.log(`  ${rows.length} VMP Group pages`);
}

function renderVMPGroup(vg: any): string {
  const name = localized(vg.name, "en");

  const warnings: string[] = [];
  if (vg.patient_frailty_indicator) warnings.push(
    `<div class="warning-box"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/></svg><span>${label("detail.patientFrailtyDescription")}</span></div>`);

  const overviewRows: string[] = [];
  if (vg.no_generic_prescription_reason) overviewRows.push(infoRow("detail.noGenericPrescription", esc(vg.no_generic_prescription_reason)));
  if (vg.no_switch_reason) overviewRows.push(infoRow("detail.noSwitching", esc(vg.no_switch_reason)));
  if (vg.start_date || vg.end_date) overviewRows.push(infoRow("detail.validity", `${formatDate(vg.start_date)} — ${vg.end_date ? formatDate(vg.end_date) : "∞"}`));
  const overview = overviewRows.length ? section("detail.overview", `<dl class="info-list">${overviewRows.join("")}</dl>`) : "";

  const vmps = relationshipList("detail.memberProducts", vg.vmps.map((v: any) => ({
    type: "vmp", url: entityUrl.vmp(v.name, v.code), name: v.name,
    subtitle: v.status !== "AUTHORIZED" ? v.status : undefined,
  })));

  const sidebar = summaryCard([
    { labelKey: "detail.memberProducts", value: String(vg.vmps.length) },
    { labelKey: "detail.validity", value: vg.end_date && new Date(vg.end_date) < new Date() ? label("sidebar.expired") : label("sidebar.active") },
  ]);

  return layout(name, `
<div class="container page-content">
<nav class="breadcrumbs" aria-label="Breadcrumb" data-pagefind-ignore>
<a href="/">Home</a><span class="sep">›</span><span aria-current="page">${ml(vg.name)}</span>
</nav>
<div class="detail-grid"><div class="main-col">
<div class="entity-header" data-pagefind-body>${badge("vmp_group")}
<h1 data-pagefind-meta="title">${ml(vg.name)}</h1>
<div class="entity-code"><span class="code-label">${label("detail.code")}</span> <code>${esc(vg.code)}</code></div>
</div>
${warnings.join("")}${overview}${vmps}
</div>${sidebar}</div></div>`, { description: `${name} — Therapeutic group with ${vg.vmps.length} products.` });
}
