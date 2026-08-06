import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { queryAll } from "../db";
import {
  layout, esc, ml, label, entityUrl, localized,
  infoRow, formatDate, isExpired, section, entityHeader, infoSection, sidebar, statusPills,
} from "../html";
import { buildRelated, type RelatedResult } from "../related";

export function generateChapterIVPages(dist: string) {
  console.log("\nGenerating Chapter IV pages...");

  // Get all active paragraphs
  const paragraphs = queryAll(`
    SELECT chapter_name, paragraph_name, key_string,
      process_type, process_type_overrule, paragraph_version,
      modification_status, start_date, end_date
    FROM chapter_iv_paragraph
    WHERE end_date IS NULL OR end_date > date('now')
    ORDER BY chapter_name, paragraph_name`);

  for (const ch of paragraphs) {
    const legalRefPath = `${ch.chapter_name}/${ch.paragraph_name}`;

    // Build verse hierarchy from legal_text (same approach as medsearch)
    const verses = queryAll(`
      WITH RECURSIVE
      text_hierarchy AS (
        SELECT key, parent_text_key, 1 as verse_level
        FROM legal_text
        WHERE legal_reference_path = ?
          AND parent_text_key IS NULL
          AND (end_date IS NULL OR end_date > date('now'))
        UNION ALL
        SELECT lt.key, lt.parent_text_key, h.verse_level + 1
        FROM legal_text lt
        JOIN text_hierarchy h ON lt.parent_text_key = h.key
        WHERE lt.legal_reference_path = ?
          AND (lt.end_date IS NULL OR lt.end_date > date('now'))
      ),
      numbered_texts AS (
        SELECT
          lt.key,
          lt.parent_text_key,
          lt.content,
          lt.sequence_nr,
          lt.start_date,
          th.verse_level,
          ROW_NUMBER() OVER (ORDER BY lt.sequence_nr, lt.key) as verse_seq
        FROM legal_text lt
        JOIN text_hierarchy th ON th.key = lt.key
        WHERE lt.legal_reference_path = ?
          AND (lt.end_date IS NULL OR lt.end_date > date('now'))
      )
      SELECT
        t.content as text,
        t.verse_seq as verseSeq,
        t.verse_seq as verseNum,
        COALESCE(p.verse_seq, 0) as verseSeqParent,
        t.verse_level as verseLevel,
        t.start_date
      FROM numbered_texts t
      LEFT JOIN numbered_texts p ON p.key = t.parent_text_key
      ORDER BY t.verse_seq`, [legalRefPath, legalRefPath, legalRefPath]);

    // Get all linked products
    const linkedProducts = queryAll(`
      SELECT ampp.cti_extended, ampp.prescription_name, ampp.pack_display_value
      FROM ampp
      WHERE ampp.cti_extended IN (
        SELECT DISTINCT d.ampp_cti_extended FROM dmpp_chapter_iv dc
        JOIN dmpp d ON d.code = dc.dmpp_code AND d.delivery_environment = dc.delivery_environment
        WHERE dc.chapter_name = ? AND dc.paragraph_name = ?
          AND (d.end_date IS NULL OR d.end_date > date('now'))
      ) AND (ampp.end_date IS NULL OR ampp.end_date > date('now'))
      ORDER BY json_extract(ampp.prescription_name, '$.en')`, [ch.chapter_name, ch.paragraph_name]);

    const dir = join(dist, "chapter-iv", ch.chapter_name, ch.paragraph_name);
    mkdirSync(dir, { recursive: true });
    const title = `Chapter ${ch.chapter_name} — §${ch.paragraph_name}`;
    const related = buildRelated({
      entityDir: dir,
      entityBaseUrl: entityUrl.chapterIV(ch.chapter_name, ch.paragraph_name),
      entityName: title,
      entityNameHtml: esc(title),
      collections: [
        { labelKey: "chapterIV.coveredProducts", singularKey: "detail.package", slug: "products", items: linkedProducts.map((p: any) => {
          const pName = p.prescription_name || { en: p.pack_display_value || p.cti_extended };
          return { type: "ampp", url: entityUrl.ampp(pName, p.cti_extended), name: pName };
        }) },
      ],
    });
    writeFileSync(join(dir, "index.html"), renderChapterIV({
      ...ch,
      verses,
      linked_products_count: linkedProducts.length,
    }, related));
  }
  console.log(`  ${paragraphs.length} Chapter IV pages`);
}

const PROCESS_TYPES: Record<string, string> = {
  "1": "Automatic Agreement",
  "2": "Simplified Procedure",
  "3": "Prior Authorization",
  "4": "Specific Authorization",
};

const MOD_STATUSES: Record<string, string> = { E: "Active", C: "Modified", S: "Ended" };

function renderChapterIV(ch: any, related: RelatedResult): string {
  const keyStr = localized(ch.key_string, "en") || `§${ch.paragraph_name}`;
  const title = `Chapter ${ch.chapter_name} — §${ch.paragraph_name}`;

  const detailRows = [
    ch.process_type ? infoRow("chapterIV.processType", esc(PROCESS_TYPES[ch.process_type] || ch.process_type)) : "",
    ch.process_type_overrule ? infoRow("chapterIV.processOverride", esc(PROCESS_TYPES[ch.process_type_overrule] || ch.process_type_overrule)) : "",
    ch.paragraph_version ? infoRow("chapterIV.version", String(ch.paragraph_version)) : "",
    ch.modification_status ? infoRow("chapterIV.modificationStatus", esc(MOD_STATUSES[ch.modification_status] || ch.modification_status)) : "",
    ch.start_date || ch.end_date ? infoRow("detail.validity", `${formatDate(ch.start_date)} — ${ch.end_date ? formatDate(ch.end_date) : "∞"}`) : "",
  ];

  // Verses — render as indented tree
  const versesHtml = ch.verses.length > 0
    ? section("chapterIV.requirementsConditions", renderVerseTree(ch.verses))
    : "";

  const header = entityHeader({
    type: "chapter_iv",
    nameHtml: esc(title),
    codesHtml: ch.key_string ? `<p class="entity-code">${ml(ch.key_string)}</p>` : "",
    pillsHtml: isExpired(ch.end_date) ? statusPills([{ labelKey: "sidebar.expired", kind: "expired" }]) : "",
  });

  const side = sidebar(related.collections);

  return layout(title, `
<div class="container page-content">
<div class="detail-grid${side ? "" : " detail-grid-single"}"><div class="main-col">
${header}
${infoSection("detail.details", detailRows)}
${versesHtml}
</div>${side}</div></div>`, { description: `${title} — ${keyStr}` });
}

function renderVerseTree(verses: any[]): string {
  return `<div class="verse-tree">${verses.map((v) => {
    const text = v.text ? localized(v.text, "en") || "" : "";
    return `<div class="verse-item" style="margin-left:${((v.verseLevel || 1) - 1) * 1}rem">${text ? ml(v.text) : ""}</div>`;
  }).join("")}</div>`;
}
