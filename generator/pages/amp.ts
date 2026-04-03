import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { Pool } from "pg";
import {
  layout, esc, ml, label, badge, entitySlug, entityUrl, formatPrice,
  localized, relationshipList, infoRow, summaryCard, formatDate, section,
} from "../html";

export async function generateAMPPages(pool: Pool, dist: string) {
  console.log("\nGenerating AMP pages...");
  const dir = join(dist, "medications");
  mkdirSync(dir, { recursive: true });

  const { rows } = await pool.query(`
    SELECT a.code, a.name, a.abbreviated_name, a.official_name, a.vmp_code,
      a.company_actor_nr, a.black_triangle, a.medicine_type, a.status, a.start_date, a.end_date,
      (SELECT json_build_object('code', vmp.code, 'name', vmp.name, 'vtmCode', vmp.vtm_code,
        'vtmName', (SELECT name FROM vtm WHERE vtm.code = vmp.vtm_code))
       FROM vmp WHERE vmp.code = a.vmp_code) as vmp,
      (SELECT json_build_object('actorNr', c.actor_nr, 'denomination', c.denomination, 'city', c.city, 'countryCode', c.country_code)
       FROM company c WHERE c.actor_nr = a.company_actor_nr) as company,
      (SELECT COALESCE(json_agg(json_build_object(
        'substanceCode', i.substance_code, 'substanceName', s.name,
        'strengthValue', i.strength_value, 'strengthUnit', i.strength_unit, 'strengthDescription', i.strength_description
      ) ORDER BY i.component_sequence_nr, i.rank), '[]'::json)
      FROM amp_ingredient i LEFT JOIN substance s ON s.code = i.substance_code
      WHERE i.amp_code = a.code) as ingredients,
      (SELECT COALESCE(json_agg(json_build_object(
        'sequenceNr', ac.sequence_nr,
        'formCode', ac.pharmaceutical_form_code, 'formName', pf.name,
        'routeCode', ac.route_of_administration_code, 'routeName', ra.name
      ) ORDER BY ac.sequence_nr), '[]'::json)
      FROM amp_component ac
      LEFT JOIN pharmaceutical_form pf ON pf.code = ac.pharmaceutical_form_code
      LEFT JOIN route_of_administration ra ON ra.code = ac.route_of_administration_code
      WHERE ac.amp_code = a.code) as components,
      (SELECT COALESCE(json_agg(json_build_object(
        'ctiExtended', ampp.cti_extended, 'prescriptionName', ampp.prescription_name,
        'packDisplayValue', ampp.pack_display_value, 'status', ampp.status
      ) ORDER BY ampp.prescription_name->>'en'), '[]'::json)
      FROM ampp WHERE ampp.amp_code = a.code AND (ampp.end_date IS NULL OR ampp.end_date > CURRENT_DATE)) as packages,
      (SELECT MIN(d.price) FROM dmpp d JOIN ampp ON ampp.cti_extended = d.ampp_cti_extended
       WHERE ampp.amp_code = a.code AND d.price IS NOT NULL
       AND (d.end_date IS NULL OR d.end_date > CURRENT_DATE) AND (ampp.end_date IS NULL OR ampp.end_date > CURRENT_DATE)) as min_price,
      (SELECT MAX(d.price) FROM dmpp d JOIN ampp ON ampp.cti_extended = d.ampp_cti_extended
       WHERE ampp.amp_code = a.code AND d.price IS NOT NULL
       AND (d.end_date IS NULL OR d.end_date > CURRENT_DATE) AND (ampp.end_date IS NULL OR ampp.end_date > CURRENT_DATE)) as max_price
    FROM amp a WHERE a.end_date IS NULL OR a.end_date > CURRENT_DATE ORDER BY a.name->>'en'`);

  for (const amp of rows) {
    const slug = entitySlug(amp.name, amp.code);
    const pageDir = join(dir, slug);
    mkdirSync(pageDir, { recursive: true });
    writeFileSync(join(pageDir, "index.html"), renderAMP(amp));
  }
  console.log(`  ${rows.length} AMP pages`);
}

function renderAMP(a: any): string {
  const name = localized(a.name, "en");

  const overviewRows: string[] = [];
  if (a.official_name) overviewRows.push(infoRow("detail.officialName", esc(a.official_name)));
  if (a.abbreviated_name) overviewRows.push(infoRow("detail.abbreviatedName", ml(a.abbreviated_name)));
  if (a.medicine_type) overviewRows.push(infoRow("detail.medicineType", esc(a.medicine_type)));
  if (a.start_date || a.end_date) overviewRows.push(infoRow("detail.validity", `${formatDate(a.start_date)} — ${a.end_date ? formatDate(a.end_date) : "∞"}`));
  if (a.status && a.status !== "AUTHORIZED") overviewRows.push(infoRow("detail.status", esc(a.status)));
  const overview = overviewRows.length ? section("detail.overview", `<dl class="info-list">${overviewRows.join("")}</dl>`) : "";

  const blackTriangle = a.black_triangle
    ? `<div class="warning-box"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/></svg><span>${label("detail.enhancedMonitoringDescription")}</span></div>`
    : "";

  const vmpLink = a.vmp ? section("detail.genericProduct",
    `<a href="${entityUrl.vmp(a.vmp.name, a.vmp.code)}" class="rel-item">${badge("vmp")}<div class="rel-item-content"><span class="rel-item-name">${ml(a.vmp.name)}</span></div><span class="rel-item-arrow">›</span></a>`) : "";

  const companyLink = a.company ? section("detail.manufacturer",
    `<a href="${entityUrl.company(a.company.denomination, a.company.actorNr)}" class="rel-item">${badge("company")}<div class="rel-item-content"><span class="rel-item-name">${esc(a.company.denomination)}</span>${a.company.city ? `<span class="rel-item-subtitle">${esc(a.company.city)}${a.company.countryCode ? `, ${esc(a.company.countryCode)}` : ""}</span>` : ""}</div><span class="rel-item-arrow">›</span></a>`) : "";

  // Components (form + route)
  const componentsHtml = a.components.length > 0 ? section("detail.pharmaceuticalDetails",
    `<dl class="info-list">${a.components.map((c: any) => `${c.formName ? infoRow("detail.form", ml(c.formName)) : ""}${c.routeName ? infoRow("detail.route", ml(c.routeName)) : ""}`).join("")}</dl>`) : "";

  // Ingredients
  const ingredientsHtml = a.ingredients.length > 0 ? section("detail.activeIngredients",
    `<div class="rel-list">${a.ingredients.map((i: any) => {
      const strength = i.strengthDescription || (i.strengthValue ? `${i.strengthValue} ${i.strengthUnit || ""}` : "");
      const substanceName = i.substanceName || { en: "Unknown substance" };
      const url = i.substanceCode ? entityUrl.substance(substanceName, i.substanceCode) : "";
      return url
        ? `<a href="${url}" class="rel-item">${badge("substance")}<div class="rel-item-content"><span class="rel-item-name">${ml(substanceName)}</span>${strength ? `<span class="rel-item-subtitle">${esc(strength)}</span>` : ""}</div><span class="rel-item-arrow">›</span></a>`
        : `<div class="rel-item">${badge("substance")}<div class="rel-item-content"><span class="rel-item-name">${ml(substanceName)}</span>${strength ? `<span class="rel-item-subtitle">${esc(strength)}</span>` : ""}</div></div>`;
    }).join("")}</div>`) : "";

  // Packages
  const packagesHtml = relationshipList("detail.availablePackages", a.packages.map((p: any) => ({
    type: "ampp",
    url: entityUrl.ampp(p.prescriptionName || { en: p.packDisplayValue || p.ctiExtended }, p.ctiExtended),
    name: p.prescriptionName || { en: p.packDisplayValue || p.ctiExtended },
    subtitle: p.packDisplayValue || undefined,
  })));

  const priceStr = a.min_price != null
    ? `${formatPrice(a.min_price)}${a.max_price != null && a.max_price !== a.min_price ? ` — ${formatPrice(a.max_price)}` : ""}`
    : "";

  const sidebar = summaryCard([
    a.vmp?.vtmName ? { labelKey: "detail.activeSubstance", value: `<a href="${entityUrl.vtm(a.vmp.vtmName, a.vmp.vtmCode)}">${ml(a.vmp.vtmName)}</a>`, isLink: true } : null,
    a.vmp ? { labelKey: "detail.genericProduct", value: `<a href="${entityUrl.vmp(a.vmp.name, a.vmp.code)}">${ml(a.vmp.name)}</a>`, isLink: true } : null,
    a.company ? { labelKey: "detail.manufacturer", value: esc(a.company.denomination) } : null,
    { labelKey: "sidebar.packageCount", value: String(a.packages.length) },
    { labelKey: "search.priceRange", value: priceStr },
    { labelKey: "detail.activeIngredients", value: a.ingredients.length ? String(a.ingredients.length) : "" },
    { labelKey: "detail.validity", value: a.end_date && new Date(a.end_date) < new Date() ? label("sidebar.expired") : label("sidebar.active") },
  ].filter(Boolean) as any[]);

  return layout(name, `
<div class="container page-content">
<nav class="breadcrumbs" aria-label="Breadcrumb" data-pagefind-ignore>
<a href="/">Home</a><span class="sep">›</span><span aria-current="page">${ml(a.name)}</span>
</nav>
<div class="detail-grid"><div class="main-col">
<div class="entity-header" data-pagefind-body>${badge("amp")}${a.black_triangle ? ' <span class="black-triangle" title="Enhanced Monitoring">▲</span>' : ""}
<h1 data-pagefind-meta="title">${ml(a.name)}</h1>
<div class="entity-code"><span class="code-label">${label("detail.code")}</span> <code>${esc(a.code)}</code></div>
</div>
${blackTriangle}${overview}${vmpLink}${companyLink}${componentsHtml}${ingredientsHtml}${packagesHtml}
</div>${sidebar}</div></div>`, { description: `${name} — Brand medication${a.company ? ` by ${a.company.denomination}` : ""}.` });
}
