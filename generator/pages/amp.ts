import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { queryAll } from "../db";
import {
  layout, esc, ml, label, entitySlug, entityUrl, formatPrice, localized,
  infoRow, infoRowRaw, infoSection, formatDate, isExpired, entityHeader, sidebar, statusPills, breadcrumb,
} from "../html";
import { buildRelated, type RelatedResult } from "../related";

export function generateAMPPages(dist: string) {
  console.log("\nGenerating AMP pages...");
  const dir = join(dist, "medications");
  mkdirSync(dir, { recursive: true });

  // Batch in chunks of 20K to manage memory
  const countResult = queryAll(
    `SELECT count(*) as c FROM amp WHERE end_date IS NULL OR end_date > date('now')`
  );
  const total = countResult[0].c;
  const CHUNK = 20000;
  let generated = 0;

  for (let offset = 0; offset < total; offset += CHUNK) {
    const rows = queryAll(`
      SELECT a.code, a.name, a.abbreviated_name, a.official_name, a.vmp_code,
        a.company_actor_nr, a.black_triangle, a.medicine_type, a.status, a.start_date, a.end_date,
        (SELECT json_object('code', vmp.code, 'name', json(vmp.name), 'vtmCode', vmp.vtm_code,
          'vtmName', (SELECT json(vtm.name) FROM vtm WHERE vtm.code = vmp.vtm_code))
         FROM vmp WHERE vmp.code = a.vmp_code) as vmp,
        (SELECT json_object('actorNr', c.actor_nr, 'denomination', c.denomination, 'city', c.city, 'countryCode', c.country_code)
         FROM company c WHERE c.actor_nr = a.company_actor_nr) as company,
        (SELECT COALESCE(json_group_array(json_object('code', atc.code, 'description', atc.description)), '[]')
         FROM (SELECT DISTINCT ampp.atc_code FROM ampp
               WHERE ampp.amp_code = a.code AND ampp.atc_code IS NOT NULL
                 AND (ampp.end_date IS NULL OR ampp.end_date > date('now'))) x
         JOIN atc_classification atc ON atc.code = x.atc_code
         ORDER BY atc.code) as atc_codes,
        (SELECT COALESCE(json_group_array(json_object(
          'substanceCode', i.substance_code, 'substanceName', json(s.name),
          'strengthValue', i.strength_value, 'strengthUnit', i.strength_unit, 'strengthDescription', i.strength_description
        )), '[]')
        FROM amp_ingredient i LEFT JOIN substance s ON s.code = i.substance_code
        WHERE i.amp_code = a.code
        ORDER BY i.component_sequence_nr, i.rank) as ingredients,
        (SELECT COALESCE(json_group_array(json_object(
          'sequenceNr', ac.sequence_nr,
          'formCode', ac.pharmaceutical_form_code, 'formName', json(pf.name),
          'routeCode', ac.route_of_administration_code, 'routeName', json(ra.name)
        )), '[]')
        FROM amp_component ac
        LEFT JOIN pharmaceutical_form pf ON pf.code = ac.pharmaceutical_form_code
        LEFT JOIN route_of_administration ra ON ra.code = ac.route_of_administration_code
        WHERE ac.amp_code = a.code
        ORDER BY ac.sequence_nr) as components,
        (SELECT COALESCE(json_group_array(json_object(
          'ctiExtended', ampp.cti_extended, 'prescriptionName', json(ampp.prescription_name),
          'packDisplayValue', ampp.pack_display_value, 'status', ampp.status
        )), '[]')
        FROM ampp WHERE ampp.amp_code = a.code AND (ampp.end_date IS NULL OR ampp.end_date > date('now'))
        ORDER BY json_extract(ampp.prescription_name, '$.en')) as packages,
        (SELECT MIN(d.price) FROM dmpp d JOIN ampp ON ampp.cti_extended = d.ampp_cti_extended
         WHERE ampp.amp_code = a.code AND d.price IS NOT NULL
         AND (d.end_date IS NULL OR d.end_date > date('now')) AND (ampp.end_date IS NULL OR ampp.end_date > date('now'))) as min_price,
        (SELECT MAX(d.price) FROM dmpp d JOIN ampp ON ampp.cti_extended = d.ampp_cti_extended
         WHERE ampp.amp_code = a.code AND d.price IS NOT NULL
         AND (d.end_date IS NULL OR d.end_date > date('now')) AND (ampp.end_date IS NULL OR ampp.end_date > date('now'))) as max_price
      FROM amp a WHERE a.end_date IS NULL OR a.end_date > date('now') ORDER BY json_extract(a.name, '$.en')
      LIMIT ${CHUNK} OFFSET ${offset}`);

    for (const amp of rows) {
      const slug = entitySlug(amp.name, amp.code);
      const pageDir = join(dir, slug);
      mkdirSync(pageDir, { recursive: true });
      const related = buildRelated({
        entityDir: pageDir,
        entityBaseUrl: entityUrl.amp(amp.name, amp.code),
        entityName: localized(amp.name, "en"),
        entityNameHtml: ml(amp.name),
        collections: [
          { labelKey: "detail.availablePackages", singularKey: "detail.package", slug: "packages", items: amp.packages.map((p: any) => ({
            type: "ampp",
            url: entityUrl.ampp(p.prescriptionName || { en: p.packDisplayValue || p.ctiExtended }, p.ctiExtended),
            name: p.prescriptionName || { en: p.packDisplayValue || p.ctiExtended },
            subtitle: p.packDisplayValue || undefined,
          })) },
        ],
      });
      writeFileSync(join(pageDir, "index.html"), renderAMP(amp, related));
    }
    generated += rows.length;
    process.stdout.write(`  ${generated}/${total} AMP pages\r`);
  }
  console.log(`  ${generated} AMP pages    `);
}

function renderAMP(a: any, related: RelatedResult): string {
  const name = localized(a.name, "en");

  const blackTriangle = a.black_triangle
    ? `<div class="warning-box"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/></svg><span>${label("detail.enhancedMonitoringDescription")}</span></div>`
    : "";

  // Composition & administration: active ingredients (substance → strength) + form/route
  const ingredientRows = a.ingredients.map((i: any) => {
    const strength = i.strengthDescription || (i.strengthValue ? `${i.strengthValue} ${i.strengthUnit || ""}` : "");
    const substanceName = i.substanceName || { en: "Unknown substance" };
    const labelHtml = i.substanceCode
      ? `<a href="${entityUrl.substance(substanceName, i.substanceCode)}">${ml(substanceName)}</a>`
      : ml(substanceName);
    return infoRowRaw(labelHtml, esc(strength));
  });
  const formRouteRows = a.components.flatMap((c: any) => [
    c.formName ? infoRow("detail.form", ml(c.formName)) : "",
    c.routeName ? infoRow("detail.route", ml(c.routeName)) : "",
  ]);
  const ingredients = infoSection("detail.activeIngredients", ingredientRows);
  const administration = infoSection("detail.administration", formRouteRows);

  const priceStr = a.min_price != null
    ? `${formatPrice(a.min_price)}${a.max_price != null && a.max_price !== a.min_price ? ` — ${formatPrice(a.max_price)}` : ""}`
    : "";

  // Breadcrumb: Substance › Generic › self
  const crumbs = [];
  if (a.vmp?.vtmName) crumbs.push({ html: ml(a.vmp.vtmName), url: entityUrl.vtm(a.vmp.vtmName, a.vmp.vtmCode) });
  if (a.vmp) crumbs.push({ html: ml(a.vmp.name), url: entityUrl.vmp(a.vmp.name, a.vmp.code) });
  crumbs.push({ html: ml(a.name) });

  // Single-valued relationships (body info-rows): manufacturer, ATC. (Packages are N-valued → sidebar.)
  const relationshipRows = [
    a.company ? infoRow("detail.manufacturer", `<a href="${entityUrl.company(a.company.denomination, a.company.actorNr)}">${esc(a.company.denomination)}</a>`) : "",
    ...a.atc_codes.map((atc: any) => infoRow("detail.atcClassification", `<a href="${entityUrl.atc(atc.code)}">${esc(atc.code)} — ${esc(atc.description)}</a>`)),
  ];

  const attrRows = [
    a.official_name ? infoRow("detail.officialName", esc(a.official_name)) : "",
    a.abbreviated_name ? infoRow("detail.abbreviatedName", ml(a.abbreviated_name)) : "",
    a.medicine_type ? infoRow("detail.medicineType", esc(a.medicine_type)) : "",
    a.start_date || a.end_date ? infoRow("detail.validity", `${formatDate(a.start_date)} — ${a.end_date ? formatDate(a.end_date) : "∞"}`) : "",
    a.status && a.status !== "AUTHORIZED" ? infoRow("detail.status", esc(a.status)) : "",
  ];

  const keyFigures = infoSection("detail.keyFigures", [priceStr ? infoRow("search.priceRange", priceStr) : ""]);

  const pills = [
    a.black_triangle ? { labelKey: "detail.enhancedMonitoring", kind: "warn" as const } : null,
    isExpired(a.end_date) ? { labelKey: "sidebar.expired", kind: "expired" as const } : null,
  ].filter(Boolean) as any[];

  const header = entityHeader({
    type: "amp",
    nameHtml: ml(a.name),
    codesHtml: `<div class="entity-code"><span class="code-label">${label("detail.code")}</span> <code>${esc(a.code)}</code></div>`,
    pillsHtml: statusPills(pills),
  });

  const side = sidebar(related.collections);

  return layout(name, `
<div class="container page-content">
${breadcrumb(crumbs)}
<div class="detail-grid${side ? "" : " detail-grid-single"}"><div class="main-col">
${header}
${blackTriangle}
${infoSection("detail.details", [...relationshipRows, ...attrRows])}
${keyFigures}
${ingredients}
${administration}
</div>${side}</div></div>`, { description: `${name} — Brand medication${a.company ? ` by ${a.company.denomination}` : ""}.` });
}
