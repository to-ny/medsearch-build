import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { queryAll } from "../db";
import {
  layout, esc, ml, label, entitySlug, entityUrl, formatPrice, localized,
  infoRow, formatDate, isExpired, section, entityHeader, infoSection, sidebar, statusPills, breadcrumb,
} from "../html";
import { buildRelated, type RelatedResult } from "../related";

export function generateAMPPPages(dist: string) {
  console.log("\nGenerating AMPP pages...");
  const dir = join(dist, "packages");
  mkdirSync(dir, { recursive: true });

  // Batch in chunks of 20K to manage memory
  const countResult = queryAll(
    `SELECT count(*) as c FROM ampp WHERE end_date IS NULL OR end_date > date('now')`
  );
  const total = countResult[0].c;
  const CHUNK = 20000;
  let generated = 0;

  for (let offset = 0; offset < total; offset += CHUNK) {
    const rows = queryAll(`
      SELECT p.cti_extended, p.amp_code, p.prescription_name, p.authorisation_nr,
        p.orphan, p.pack_display_value, p.status, p.ex_factory_price, p.atc_code,
        p.start_date, p.end_date, p.leaflet_url, p.spc_url,
        (SELECT json_object('code', a.code, 'name', json(a.name), 'companyActorNr', a.company_actor_nr,
          'companyName', (SELECT denomination FROM company WHERE actor_nr = a.company_actor_nr),
          'vmpCode', a.vmp_code,
          'vmpName', (SELECT json(v.name) FROM vmp v WHERE v.code = a.vmp_code),
          'vtmCode', (SELECT v.vtm_code FROM vmp v WHERE v.code = a.vmp_code),
          'vtmName', (SELECT json(t.name) FROM vtm t WHERE t.code = (SELECT v.vtm_code FROM vmp v WHERE v.code = a.vmp_code)))
         FROM amp a WHERE a.code = p.amp_code) as amp,
        (SELECT json_object('code', atc.code, 'description', atc.description)
         FROM atc_classification atc WHERE atc.code = p.atc_code) as atc,
        (SELECT COALESCE(json_group_array(json_object(
          'code', d.code, 'deliveryEnvironment', d.delivery_environment,
          'price', d.price, 'cheap', d.cheap, 'cheapest', d.cheapest, 'reimbursable', d.reimbursable
        )), '[]')
        FROM dmpp d WHERE d.ampp_cti_extended = p.cti_extended
          AND (d.end_date IS NULL OR d.end_date > date('now'))
        ORDER BY d.delivery_environment, d.code) as cnk_codes,
        (SELECT COALESCE(json_group_array(json_object(
          'chapterName', dc.chapter_name, 'paragraphName', dc.paragraph_name,
          'keyString', json(cp.key_string)
        )), '[]')
        FROM dmpp_chapter_iv dc
        JOIN chapter_iv_paragraph cp ON cp.chapter_name = dc.chapter_name AND cp.paragraph_name = dc.paragraph_name
        JOIN dmpp d ON d.code = dc.dmpp_code AND d.delivery_environment = dc.delivery_environment
        WHERE d.ampp_cti_extended = p.cti_extended
          AND (d.end_date IS NULL OR d.end_date > date('now'))) as chapter_iv
      FROM ampp p
      WHERE p.end_date IS NULL OR p.end_date > date('now')
      ORDER BY json_extract(p.prescription_name, '$.en'), p.cti_extended
      LIMIT ${CHUNK} OFFSET ${offset}`);

    for (const ampp of rows) {
      const pName = ampp.prescription_name || { en: ampp.pack_display_value || ampp.cti_extended };
      const slug = entitySlug(pName, ampp.cti_extended);
      const pageDir = join(dir, slug);
      mkdirSync(pageDir, { recursive: true });
      const chapterParas = [...new Map(ampp.chapter_iv.map((c: any) => [`${c.chapterName}-${c.paragraphName}`, c])).values()];
      const related = buildRelated({
        entityDir: pageDir,
        entityBaseUrl: entityUrl.ampp(pName, ampp.cti_extended),
        entityName: localized(pName, "en"),
        entityNameHtml: ml(pName),
        collections: [
          { labelKey: "detail.chapterIVRequirements", singularKey: "detail.chapterIVRequirements", slug: "chapter-iv", items: chapterParas.map((c: any) => ({
            type: "chapter_iv",
            url: entityUrl.chapterIV(c.chapterName, c.paragraphName),
            name: c.keyString || { en: `§${c.paragraphName}` },
            subtitle: `§${c.paragraphName}`,
          })) },
        ],
      });
      writeFileSync(join(pageDir, "index.html"), renderAMPP(ampp, related));
    }
    generated += rows.length;
    process.stdout.write(`  ${generated}/${total} AMPP pages\r`);
  }
  console.log(`  ${generated} AMPP pages    `);
}

function renderAMPP(p: any, related: RelatedResult): string {
  const pName = p.prescription_name || { en: p.pack_display_value || p.cti_extended };
  const name = localized(pName, "en");

  // Breadcrumb: Substance › Generic › Brand › self
  const crumbs = [];
  if (p.amp?.vtmName) crumbs.push({ html: ml(p.amp.vtmName), url: entityUrl.vtm(p.amp.vtmName, p.amp.vtmCode) });
  if (p.amp?.vmpName) crumbs.push({ html: ml(p.amp.vmpName), url: entityUrl.vmp(p.amp.vmpName, p.amp.vmpCode) });
  if (p.amp) crumbs.push({ html: ml(p.amp.name), url: entityUrl.amp(p.amp.name, p.amp.code) });
  crumbs.push({ html: ml(pName) });

  // Single-valued relationship (body info-row): ATC. (Chapter IV is N-valued → sidebar.)
  const relationshipRows = [
    p.atc ? infoRow("detail.atcClassification", `<a href="${entityUrl.atc(p.atc.code)}">${esc(p.atc.code)} — ${esc(p.atc.description)}</a>`) : "",
  ];
  const attrRows = [
    p.pack_display_value ? infoRow("detail.pack", esc(p.pack_display_value)) : "",
    p.authorisation_nr ? infoRow("detail.authorisationNr", esc(p.authorisation_nr)) : "",
    p.start_date || p.end_date ? infoRow("detail.validity", `${formatDate(p.start_date)} — ${p.end_date ? formatDate(p.end_date) : "∞"}`) : "",
    p.status ? infoRow("detail.status", esc(p.status)) : "",
  ];

  const keyFigures = infoSection("detail.keyFigures", [
    p.ex_factory_price != null ? infoRow("detail.exFactoryPrice", formatPrice(p.ex_factory_price)) : "",
  ]);

  // CNK codes / pricing — body table
  const cnkHtml = p.cnk_codes.length > 0 ? section("detail.pricingCnkCodes",
    `<table class="data-table"><tbody>${p.cnk_codes.map((d: any) => {
      const envLabel = d.deliveryEnvironment === "H" ? "H" : "P";
      const flags = [
        d.cheapest ? '<span class="flag flag-green">Cheapest</span>' : "",
        d.cheap ? '<span class="flag flag-blue">Cheap</span>' : "",
        d.reimbursable ? '<span class="flag flag-purple">Reimbursable</span>' : "",
      ].filter(Boolean).join(" ");
      return `<tr><td><span class="code-label">CNK</span> <code>${esc(d.code)}</code></td><td><span class="env-tag">${envLabel}</span></td><td class="data-price">${d.price != null ? formatPrice(d.price) : "—"}</td><td>${flags}</td></tr>`;
    }).join("")}</tbody></table>`, { count: p.cnk_codes.length }) : "";

  // Documents
  const docs: string[] = [];
  if (p.leaflet_url) docs.push(infoRow("detail.packageLeaflet", renderDocLinks(p.leaflet_url)));
  if (p.spc_url) docs.push(infoRow("detail.smpc", renderDocLinks(p.spc_url)));
  const docsHtml = docs.length ? section("detail.documents", `<dl class="info-list">${docs.join("")}</dl>`) : "";

  const pills = [
    p.orphan ? { labelKey: "detail.orphanDrug", kind: "muted" as const } : null,
    isExpired(p.end_date) ? { labelKey: "sidebar.expired", kind: "expired" as const } : null,
  ].filter(Boolean) as any[];

  const codesHtml = `<div class="entity-code"><span class="code-label">CTI</span> <code>${esc(p.cti_extended)}</code></div>${p.cnk_codes.length > 0 ? `<div class="entity-code">${p.cnk_codes.map((d: any) => `<span><span class="code-label">CNK</span> <code>${esc(d.code)}</code></span>`).join(" ")}</div>` : ""}`;

  const header = entityHeader({ type: "ampp", nameHtml: ml(pName), codesHtml, pillsHtml: statusPills(pills) });

  const side = sidebar(related.collections);

  return layout(name, `
<div class="container page-content">
${breadcrumb(crumbs)}
<div class="detail-grid${side ? "" : " detail-grid-single"}"><div class="main-col">
${header}
${infoSection("detail.details", [...relationshipRows, ...attrRows])}
${keyFigures}
${cnkHtml}${docsHtml}
</div>${side}</div></div>`, { description: `${name} — Medication package.` });
}

function renderDocLinks(urls: Record<string, string>): string {
  return Object.entries(urls)
    .filter(([, url]) => url)
    .map(([lang, url]) => `<a href="${esc(url as string)}" target="_blank" rel="noopener">${lang.toUpperCase()}</a>`)
    .join(" · ");
}
