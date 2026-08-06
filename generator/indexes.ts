import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { queryAll } from "./db";
import { localized } from "./html";

export function generateSearchIndexes(dist: string) {
  const dir = join(dist, "_indexes");
  mkdirSync(dir, { recursive: true });

  const types = [
    { key: "vtm", label: "Substances", fn: indexVTM },
    { key: "vmp", label: "Generics", fn: indexVMP },
    { key: "amp", label: "Medications", fn: indexAMP },
    { key: "ampp", label: "Packages", fn: indexAMPP },
    { key: "company", label: "Companies", fn: indexCompany },
    { key: "substance", label: "Ingredients", fn: indexSubstance },
    { key: "vmp-group", label: "Therapeutic Groups", fn: indexVMPGroup },
    { key: "atc", label: "Classifications", fn: indexATC },
    { key: "chapter-iv", label: "Chapter IV", fn: indexChapterIV },
  ];

  for (const t of types) {
    const rows = t.fn();
    const json = JSON.stringify(rows);
    writeFileSync(join(dir, `${t.key}.json`), json);
    console.log(`  ${t.key}: ${rows.length} entries (${(json.length / 1024).toFixed(0)}KB)`);
  }
}

function indexVTM() {
  return queryAll(`
    SELECT v.code, v.name,
      (SELECT count(*) FROM vmp WHERE vtm_code = v.code AND (end_date IS NULL OR end_date > date('now'))) as vmp_count
    FROM vtm v WHERE v.end_date IS NULL OR v.end_date > date('now')
    ORDER BY json_extract(v.name, '$.en'), v.code
  `).map(r => {
    const entry: Record<string, unknown> = {
      n: localized(r.name, "en"), code: r.code,
    };
    if (r.vmp_count) entry.sub = `${r.vmp_count} generic products`;
    return entry;
  });
}

function indexVMP() {
  return queryAll(`
    SELECT v.code, v.name, v.abbreviated_name,
      (SELECT json(t.name) FROM vtm t WHERE t.code = v.vtm_code) as vtm_name,
      (SELECT json(g.name) FROM vmp_group g WHERE g.code = v.vmp_group_code) as group_name
    FROM vmp v WHERE v.end_date IS NULL OR v.end_date > date('now')
    ORDER BY json_extract(v.name, '$.en'), v.code
  `).map(r => {
    const entry: Record<string, unknown> = {
      n: localized(r.name, "en"), code: r.code,
    };
    if (r.vtm_name) entry.sub = localized(r.vtm_name, "en");
    if (r.group_name) entry.group = localized(r.group_name, "en");
    return entry;
  });
}

function indexAMP() {
  return queryAll(`
    SELECT a.code, a.name, a.status, a.black_triangle,
      a.company_actor_nr,
      (SELECT denomination FROM company WHERE actor_nr = a.company_actor_nr) as company_name,
      (SELECT json(v.name) FROM vmp v WHERE v.code = a.vmp_code) as vmp_name
    FROM amp a WHERE (a.end_date IS NULL OR a.end_date > date('now'))
    ORDER BY json_extract(a.name, '$.en'), a.code
  `).map(r => {
    const entry: Record<string, unknown> = {
      n: localized(r.name, "en"), code: r.code,
    };
    if (r.company_name) entry.company = r.company_name;
    if (r.vmp_name) entry.sub = localized(r.vmp_name, "en");
    if (r.black_triangle) entry.bt = true;
    return entry;
  });
}

function indexAMPP() {
  return queryAll(`
    SELECT p.cti_extended, p.prescription_name, p.pack_display_value,
      p.ex_factory_price, p.amp_code,
      (SELECT json(a.name) FROM amp a WHERE a.code = p.amp_code) as amp_name,
      (SELECT denomination FROM company c JOIN amp a ON a.company_actor_nr = c.actor_nr WHERE a.code = p.amp_code) as company_name,
      (SELECT group_concat(d.code, ' ') FROM dmpp d WHERE d.ampp_cti_extended = p.cti_extended AND (d.end_date IS NULL OR d.end_date > date('now'))) as cnk_codes,
      (SELECT max(d.reimbursable) FROM dmpp d WHERE d.ampp_cti_extended = p.cti_extended AND (d.end_date IS NULL OR d.end_date > date('now'))) as reimbursable
    FROM ampp p WHERE p.end_date IS NULL OR p.end_date > date('now')
    ORDER BY json_extract(p.prescription_name, '$.en'), p.cti_extended
  `).map(r => {
    const name = r.prescription_name || { en: r.pack_display_value || r.cti_extended };
    const n = localized(name, "en") || r.pack_display_value || r.cti_extended;
    const entry: Record<string, unknown> = {
      n,
      code: r.cti_extended,
    };
    if (r.cnk_codes) entry.cnk = r.cnk_codes;
    if (r.amp_name) entry.sub = localized(r.amp_name, "en");
    if (r.company_name) entry.company = r.company_name;
    if (r.pack_display_value) entry.pack = r.pack_display_value;
    if (r.ex_factory_price != null) entry.price = r.ex_factory_price;
    if (r.reimbursable) entry.reimb = true;
    return entry;
  });
}

function indexCompany() {
  return queryAll(`
    SELECT c.actor_nr, c.denomination, c.country_code,
      (SELECT count(*) FROM amp WHERE company_actor_nr = c.actor_nr AND (end_date IS NULL OR end_date > date('now'))) as product_count
    FROM company c WHERE c.end_date IS NULL OR c.end_date > date('now')
    ORDER BY c.denomination, c.actor_nr
  `).map(r => {
    const entry: Record<string, unknown> = {
      n: r.denomination || '', code: r.actor_nr,
    };
    if (r.country_code) entry.sub = r.country_code;
    if (r.product_count) entry.count = r.product_count;
    return entry;
  });
}

function indexSubstance() {
  return queryAll(`
    SELECT s.code, s.name,
      (SELECT count(*) FROM amp_ingredient ai WHERE ai.substance_code = s.code) as usage_count
    FROM substance s
    ORDER BY json_extract(s.name, '$.en'), s.code
  `).map(r => {
    const entry: Record<string, unknown> = {
      n: localized(r.name, "en"), code: r.code,
    };
    if (r.usage_count) entry.sub = `Used in ${r.usage_count} products`;
    return entry;
  });
}

function indexVMPGroup() {
  return queryAll(`
    SELECT g.code, g.name,
      (SELECT count(*) FROM vmp WHERE vmp_group_code = g.code AND (end_date IS NULL OR end_date > date('now'))) as member_count
    FROM vmp_group g WHERE g.end_date IS NULL OR g.end_date > date('now')
    ORDER BY json_extract(g.name, '$.en'), g.code
  `).map(r => {
    const entry: Record<string, unknown> = {
      n: localized(r.name, "en"), code: r.code,
    };
    if (r.member_count) entry.sub = `${r.member_count} members`;
    return entry;
  });
}

function indexATC() {
  return queryAll(`
    SELECT code, description FROM atc_classification ORDER BY code
  `).map(r => ({
    n: r.description, code: r.code,
  }));
}

function indexChapterIV() {
  return queryAll(`
    SELECT chapter_name, paragraph_name, key_string, process_type
    FROM chapter_iv_paragraph
    WHERE end_date IS NULL OR end_date > date('now')
    ORDER BY chapter_name, paragraph_name
  `).map(r => {
    const entry: Record<string, unknown> = {
      id: `${r.chapter_name}-${r.paragraph_name}`,
      n: localized(r.key_string, "en") || `§${r.paragraph_name}`,
      code: r.paragraph_name,
      url: `/chapter-iv/${r.chapter_name}/${r.paragraph_name}/`,
    };
    if (r.process_type === "3") entry.sub = "Prior Authorization";
    else if (r.process_type === "1") entry.sub = "Automatic Agreement";
    return entry;
  });
}
