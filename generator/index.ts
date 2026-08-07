import { mkdirSync, cpSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { getDb, closeDb, queryOne } from "./db";
import { generateVTMPages } from "./pages/vtm";
import { generateVMPPages } from "./pages/vmp";
import { generateAMPPages } from "./pages/amp";
import { generateAMPPPages } from "./pages/ampp";
import { generateCompanyPages } from "./pages/company";
import { generateSubstancePages } from "./pages/substance";
import { generateVMPGroupPages } from "./pages/vmp-group";
import { generateATCPages } from "./pages/atc";
import { generateChapterIVPages } from "./pages/chapter-iv";
import { generateHomePage, generate404Page } from "./pages/home";
import { generateHelpPage } from "./pages/help";
import { generateSearchIndexes } from "./indexes";

const DIST = join(import.meta.dir, "..", "dist");
const STATIC = join(import.meta.dir, "..", "static");

async function main() {
  const start = Date.now();
  console.log("MedSearch Static Site Generator");
  console.log("================================\n");

  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  if (process.env.SKIP_STATIC !== "1") {
    cpSync(STATIC, DIST, { recursive: true });
    console.log("Copied static assets");
  }

  // SAM version lives in this single file (not stamped into every page's
  // footer), so a SAM bump changes one file and incremental deploys stay small.
  writeFileSync(
    join(DIST, "version.json"),
    JSON.stringify({ sam: process.env.SAM_VERSION || null })
  );

  const db = getDb();
  console.log(`Opened database: ${process.env.DB_PATH || "data/medsearch.sqlite"}`);

  const stats = queryOne(`
    SELECT
      (SELECT count(*) FROM vtm WHERE end_date IS NULL OR end_date > date('now')) as vtm,
      (SELECT count(*) FROM vmp WHERE end_date IS NULL OR end_date > date('now')) as vmp,
      (SELECT count(*) FROM amp WHERE end_date IS NULL OR end_date > date('now')) as amp,
      (SELECT count(*) FROM ampp WHERE end_date IS NULL OR end_date > date('now')) as ampp,
      (SELECT count(*) FROM company WHERE end_date IS NULL OR end_date > date('now')) as company,
      (SELECT count(*) FROM substance) as substance,
      (SELECT count(*) FROM vmp_group WHERE end_date IS NULL OR end_date > date('now')) as vmp_group,
      (SELECT count(*) FROM atc_classification) as atc,
      (SELECT count(*) FROM chapter_iv_paragraph WHERE end_date IS NULL OR end_date > date('now')) as chapter_iv
  `);
  console.log(`Database: ${stats.vtm} VTMs, ${stats.vmp} VMPs, ${stats.amp} AMPs, ${stats.ampp} AMPPs, ${stats.company} Companies, ${stats.substance} Substances, ${stats.vmp_group} VMP Groups, ${stats.atc} ATCs, ${stats.chapter_iv} Chapter IVs`);

  generateVTMPages(DIST);
  generateVMPPages(DIST);
  generateAMPPages(DIST);
  generateAMPPPages(DIST);
  generateCompanyPages(DIST);
  generateSubstancePages(DIST);
  generateVMPGroupPages(DIST);
  generateATCPages(DIST);
  generateChapterIVPages(DIST);
  generateHomePage(DIST, stats);
  generate404Page(DIST);
  generateHelpPage(DIST);

  console.log("\nGenerating search indexes...");
  generateSearchIndexes(DIST);

  closeDb();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n================================`);
  console.log(`Done in ${elapsed}s.`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  closeDb();
  process.exit(1);
});
