import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { layout, label, badge } from "../html";
import { LANGS, type Lang } from "../i18n";

/** Wrap content in per-language divs, shown/hidden by CSS */
function mlBlock(content: Record<Lang, string>): string {
  return LANGS.map(
    (l) => `<div class="i18n-${l}">${content[l]}</div>`
  ).join("");
}

function hierarchyTree(): string {
  return `<div class="help-tree">
<div class="help-tree-node">${badge("vtm")}<div>${label("entityLabels.substance")} <span class="text-muted">(VTM)</span></div></div>
<div class="help-tree-branch">
<div class="help-tree-node">${badge("vmp")}<div>${label("entityLabels.generic")} <span class="text-muted">(VMP)</span></div></div>
<div class="help-tree-branch">
<div class="help-tree-node">${badge("amp")}<div>${label("entityLabels.brand")} <span class="text-muted">(AMP)</span></div></div>
<div class="help-tree-branch">
<div class="help-tree-node">${badge("ampp")}<div>${label("entityLabels.package")} <span class="text-muted">(AMPP)</span></div></div>
</div></div></div></div>`;
}

const entityTypes: Record<Lang, string> = {
  en: `<dl class="help-defs">
<dt>${badge("vtm")} <strong>Substance</strong> (VTM — Virtual Therapeutic Moiety)</dt>
<dd>The active ingredient, independent of dose, form, or manufacturer. E.g. <em>Paracetamol</em>.</dd>
<dt>${badge("vmp")} <strong>Generic</strong> (VMP — Virtual Medicinal Product)</dt>
<dd>A standardized product definition: substance + strength + form. E.g. <em>Paracetamol 500mg tablet</em>. This is a virtual concept — both originator brands and their generic copies belong to the same VMP. "Generic" here refers to this standard definition, not to whether a cheaper generic alternative is available.</dd>
<dt>${badge("amp")} <strong>Brand</strong> (AMP — Actual Medicinal Product)</dt>
<dd>A specific manufacturer's product with a marketing authorization. E.g. <em>Dafalgan 500mg tablet</em> by UPSA Belgium.</dd>
<dt>${badge("ampp")} <strong>Package</strong> (AMPP — Actual Medicinal Product Package)</dt>
<dd>The specific package sold at the pharmacy, with its own CNK code, price, and reimbursement status. E.g. <em>Dafalgan 500mg, 30 tablets</em>.</dd>
<dt>${badge("company")} <strong>Company</strong></dt>
<dd>The manufacturer, distributor, or marketing authorization holder of a medication.</dd>
<dt>${badge("substance")} <strong>Ingredient</strong></dt>
<dd>A specific chemical substance used in a formulation, with its strength. Distinct from VTM: a combination product (e.g. amoxicillin + clavulanic acid) has one VTM but multiple ingredients.</dd>
<dt>${badge("vmp_group")} <strong>Therapeutic Group</strong></dt>
<dd>A grouping of generic products (VMPs) that are considered therapeutically equivalent. May carry restrictions on generic substitution or prescribing, and flags for patient frailty.</dd>
<dt>${badge("atc")} <strong>ATC Classification</strong></dt>
<dd>The WHO's 5-level Anatomical Therapeutic Chemical classification. Groups medications from anatomical system down to specific substance. E.g. <code>N02BE01</code> = Nervous system → Analgesics → Anilides → Paracetamol.</dd>
<dt>${badge("chapter_iv")} <strong>Chapter IV</strong></dt>
<dd>Belgian reimbursement rules requiring prior authorization from the health insurance fund before certain medications are reimbursed. Each paragraph defines conditions, covered products, and the authorization process.</dd>
</dl>`,
  nl: `<dl class="help-defs">
<dt>${badge("vtm")} <strong>Stof</strong> (VTM — Virtual Therapeutic Moiety)</dt>
<dd>Het werkzame bestanddeel, onafhankelijk van dosis, vorm of fabrikant. Bv. <em>Paracetamol</em>.</dd>
<dt>${badge("vmp")} <strong>Generiek</strong> (VMP — Virtual Medicinal Product)</dt>
<dd>Een gestandaardiseerde productdefinitie: stof + sterkte + vorm. Bv. <em>Paracetamol 500mg tablet</em>. Dit is een virtueel concept — zowel originele merken als hun generieke kopieën behoren tot dezelfde VMP. "Generiek" verwijst hier naar deze standaarddefinitie, niet naar de beschikbaarheid van een goedkoper alternatief.</dd>
<dt>${badge("amp")} <strong>Merk</strong> (AMP — Actual Medicinal Product)</dt>
<dd>Een product van een specifieke fabrikant met een handelsvergunning. Bv. <em>Dafalgan 500mg tablet</em> van UPSA Belgium.</dd>
<dt>${badge("ampp")} <strong>Verpakking</strong> (AMPP — Actual Medicinal Product Package)</dt>
<dd>De specifieke verpakking in de apotheek, met eigen CNK-code, prijs en terugbetalingsstatus. Bv. <em>Dafalgan 500mg, 30 tabletten</em>.</dd>
<dt>${badge("company")} <strong>Bedrijf</strong></dt>
<dd>De fabrikant, distributeur of houder van de handelsvergunning van een geneesmiddel.</dd>
<dt>${badge("substance")} <strong>Ingrediënt</strong></dt>
<dd>Een specifieke chemische stof in een formulering, met sterkte. Verschilt van VTM: een combinatieproduct (bv. amoxicilline + clavulaanzuur) heeft één VTM maar meerdere ingrediënten.</dd>
<dt>${badge("vmp_group")} <strong>Therapeutische Groep</strong></dt>
<dd>Een groepering van generieke producten (VMP's) die als therapeutisch equivalent worden beschouwd. Kan beperkingen bevatten voor generieke substitutie of voorschrijving, en markeringen voor patiëntenkwetsbaarheid.</dd>
<dt>${badge("atc")} <strong>ATC-classificatie</strong></dt>
<dd>De 5-niveaus anatomisch-therapeutisch-chemische classificatie van de WHO. Groepeert geneesmiddelen van anatomisch systeem tot specifieke stof. Bv. <code>N02BE01</code> = Zenuwstelsel → Analgetica → Aniliden → Paracetamol.</dd>
<dt>${badge("chapter_iv")} <strong>Hoofdstuk IV</strong></dt>
<dd>Belgische terugbetalingsregels die voorafgaande toestemming van het ziekenfonds vereisen voordat bepaalde geneesmiddelen worden terugbetaald. Elke paragraaf definieert voorwaarden, gedekte producten en het autorisatieproces.</dd>
</dl>`,
  fr: `<dl class="help-defs">
<dt>${badge("vtm")} <strong>Substance</strong> (VTM — Virtual Therapeutic Moiety)</dt>
<dd>Le principe actif, indépendamment de la dose, de la forme ou du fabricant. Ex. <em>Paracétamol</em>.</dd>
<dt>${badge("vmp")} <strong>Générique</strong> (VMP — Virtual Medicinal Product)</dt>
<dd>Une définition de produit standardisée : substance + dosage + forme. Ex. <em>Paracétamol 500mg comprimé</em>. C'est un concept virtuel — les marques originales et leurs copies génériques appartiennent au même VMP. « Générique » désigne ici cette définition standard, pas la disponibilité d'une alternative moins chère.</dd>
<dt>${badge("amp")} <strong>Marque</strong> (AMP — Actual Medicinal Product)</dt>
<dd>Un produit d'un fabricant spécifique avec une autorisation de mise sur le marché. Ex. <em>Dafalgan 500mg comprimé</em> par UPSA Belgium.</dd>
<dt>${badge("ampp")} <strong>Conditionnement</strong> (AMPP — Actual Medicinal Product Package)</dt>
<dd>L'emballage spécifique vendu en pharmacie, avec son propre code CNK, prix et statut de remboursement. Ex. <em>Dafalgan 500mg, 30 comprimés</em>.</dd>
<dt>${badge("company")} <strong>Entreprise</strong></dt>
<dd>Le fabricant, distributeur ou titulaire de l'autorisation de mise sur le marché d'un médicament.</dd>
<dt>${badge("substance")} <strong>Ingrédient</strong></dt>
<dd>Une substance chimique spécifique dans une formulation, avec son dosage. Distinct du VTM : un produit combiné (ex. amoxicilline + acide clavulanique) a un seul VTM mais plusieurs ingrédients.</dd>
<dt>${badge("vmp_group")} <strong>Groupe Thérapeutique</strong></dt>
<dd>Un regroupement de produits génériques (VMP) considérés comme thérapeutiquement équivalents. Peut comporter des restrictions de substitution générique ou de prescription, et des indicateurs de fragilité du patient.</dd>
<dt>${badge("atc")} <strong>Classification ATC</strong></dt>
<dd>La classification anatomique, thérapeutique et chimique à 5 niveaux de l'OMS. Regroupe les médicaments du système anatomique jusqu'à la substance spécifique. Ex. <code>N02BE01</code> = Système nerveux → Analgésiques → Anilides → Paracétamol.</dd>
<dt>${badge("chapter_iv")} <strong>Chapitre IV</strong></dt>
<dd>Règles de remboursement belges exigeant une autorisation préalable de la mutuelle avant le remboursement de certains médicaments. Chaque paragraphe définit les conditions, les produits couverts et le processus d'autorisation.</dd>
</dl>`,
  de: `<dl class="help-defs">
<dt>${badge("vtm")} <strong>Substanz</strong> (VTM — Virtual Therapeutic Moiety)</dt>
<dd>Der Wirkstoff, unabhängig von Dosis, Form oder Hersteller. Z.B. <em>Paracetamol</em>.</dd>
<dt>${badge("vmp")} <strong>Generikum</strong> (VMP — Virtual Medicinal Product)</dt>
<dd>Eine standardisierte Produktdefinition: Substanz + Stärke + Form. Z.B. <em>Paracetamol 500mg Tablette</em>. Dies ist ein virtuelles Konzept — sowohl Originalmarken als auch Generika gehören zum selben VMP. „Generikum" bezeichnet hier diese Standarddefinition, nicht die Verfügbarkeit einer günstigeren Alternative.</dd>
<dt>${badge("amp")} <strong>Marke</strong> (AMP — Actual Medicinal Product)</dt>
<dd>Ein Produkt eines bestimmten Herstellers mit Marktzulassung. Z.B. <em>Dafalgan 500mg Tablette</em> von UPSA Belgium.</dd>
<dt>${badge("ampp")} <strong>Packung</strong> (AMPP — Actual Medicinal Product Package)</dt>
<dd>Die spezifische Packung in der Apotheke, mit eigenem CNK-Code, Preis und Erstattungsstatus. Z.B. <em>Dafalgan 500mg, 30 Tabletten</em>.</dd>
<dt>${badge("company")} <strong>Unternehmen</strong></dt>
<dd>Der Hersteller, Vertreiber oder Zulassungsinhaber eines Arzneimittels.</dd>
<dt>${badge("substance")} <strong>Zutat</strong></dt>
<dd>Ein spezifischer chemischer Stoff in einer Formulierung, mit Stärke. Unterscheidet sich von VTM: Ein Kombinationsprodukt (z.B. Amoxicillin + Clavulansäure) hat ein VTM aber mehrere Zutaten.</dd>
<dt>${badge("vmp_group")} <strong>Therapeutische Gruppe</strong></dt>
<dd>Eine Gruppierung generischer Produkte (VMPs), die als therapeutisch gleichwertig gelten. Kann Einschränkungen für generische Substitution oder Verschreibung und Kennzeichen für Patientengebrechlichkeit enthalten.</dd>
<dt>${badge("atc")} <strong>ATC-Klassifikation</strong></dt>
<dd>Die 5-stufige anatomisch-therapeutisch-chemische Klassifikation der WHO. Gruppiert Arzneimittel vom anatomischen System bis zur spezifischen Substanz. Z.B. <code>N02BE01</code> = Nervensystem → Analgetika → Anilide → Paracetamol.</dd>
<dt>${badge("chapter_iv")} <strong>Kapitel IV</strong></dt>
<dd>Belgische Erstattungsregeln, die eine vorherige Genehmigung der Krankenkasse erfordern, bevor bestimmte Arzneimittel erstattet werden. Jeder Paragraph definiert Bedingungen, abgedeckte Produkte und das Genehmigungsverfahren.</dd>
</dl>`,
};

const codes: Record<Lang, string> = {
  en: `<dl class="help-defs">
<dt><strong>CNK</strong></dt>
<dd>A 7-digit code printed on every medication package sold in Belgian pharmacies. Pharmacists scan it to identify the product and process reimbursement. Each code is tied to a delivery context: <strong>P</strong> (public pharmacy) or <strong>H</strong> (hospital).</dd>
<dt><strong>ATC</strong></dt>
<dd>The WHO's Anatomical Therapeutic Chemical classification. It groups medications by body system and mechanism. Read left-to-right: <code>N02BE01</code> = <em>N</em> (Nervous system) → <em>02</em> (Analgesics) → <em>B</em> (Other analgesics) → <em>E</em> (Anilides) → <em>01</em> (Paracetamol).</dd>
<dt><strong>SAM codes</strong></dt>
<dd>Internal identifiers from the FAMHP database (VTM code, VMP code, AMP code, AMPP code). Shown on detail pages but rarely needed for lookups.</dd>
</dl>`,
  nl: `<dl class="help-defs">
<dt><strong>CNK</strong></dt>
<dd>Een 7-cijferige code op elke geneesmiddelverpakking in Belgische apotheken. Apothekers scannen deze om het product te identificeren en de terugbetaling te verwerken. Elke code is gekoppeld aan een aflevercontext: <strong>P</strong> (openbare apotheek) of <strong>H</strong> (ziekenhuisapotheek).</dd>
<dt><strong>ATC</strong></dt>
<dd>De anatomisch-therapeutisch-chemische classificatie van de WHO. Deze groepeert geneesmiddelen per lichaamssysteem en werkingsmechanisme. Lees van links naar rechts: <code>N02BE01</code> = <em>N</em> (Zenuwstelsel) → <em>02</em> (Analgetica) → <em>B</em> (Overige analgetica) → <em>E</em> (Aniliden) → <em>01</em> (Paracetamol).</dd>
<dt><strong>SAM-codes</strong></dt>
<dd>Interne identificatienummers uit de FAGG-databank (VTM-code, VMP-code, AMP-code, AMPP-code). Getoond op detailpagina's maar zelden nodig voor opzoeking.</dd>
</dl>`,
  fr: `<dl class="help-defs">
<dt><strong>CNK</strong></dt>
<dd>Un code à 7 chiffres imprimé sur chaque emballage de médicament vendu en pharmacie belge. Les pharmaciens le scannent pour identifier le produit et traiter le remboursement. Chaque code est lié à un contexte de délivrance : <strong>P</strong> (pharmacie publique) ou <strong>H</strong> (pharmacie hospitalière).</dd>
<dt><strong>ATC</strong></dt>
<dd>La classification anatomique, thérapeutique et chimique de l'OMS. Elle regroupe les médicaments par système corporel et mécanisme d'action. Lecture de gauche à droite : <code>N02BE01</code> = <em>N</em> (Système nerveux) → <em>02</em> (Analgésiques) → <em>B</em> (Autres analgésiques) → <em>E</em> (Anilides) → <em>01</em> (Paracétamol).</dd>
<dt><strong>Codes SAM</strong></dt>
<dd>Identifiants internes de la base de données AFMPS (code VTM, code VMP, code AMP, code AMPP). Affichés sur les pages détaillées mais rarement nécessaires pour les recherches.</dd>
</dl>`,
  de: `<dl class="help-defs">
<dt><strong>CNK</strong></dt>
<dd>Ein 7-stelliger Code auf jeder Arzneimittelpackung in belgischen Apotheken. Apotheker scannen ihn zur Produktidentifikation und Erstattungsabwicklung. Jeder Code ist an einen Abgabekontext gebunden: <strong>P</strong> (öffentliche Apotheke) oder <strong>H</strong> (Krankenhausapotheke).</dd>
<dt><strong>ATC</strong></dt>
<dd>Die anatomisch-therapeutisch-chemische Klassifikation der WHO. Sie gruppiert Arzneimittel nach Körpersystem und Wirkungsmechanismus. Von links nach rechts lesen: <code>N02BE01</code> = <em>N</em> (Nervensystem) → <em>02</em> (Analgetika) → <em>B</em> (Andere Analgetika) → <em>E</em> (Anilide) → <em>01</em> (Paracetamol).</dd>
<dt><strong>SAM-Codes</strong></dt>
<dd>Interne Kennungen der FAGG-Datenbank (VTM-Code, VMP-Code, AMP-Code, AMPP-Code). Auf Detailseiten angezeigt, aber selten für Suchen benötigt.</dd>
</dl>`,
};

const pricing: Record<Lang, string> = {
  en: `<dl class="help-defs">
<dt><strong>Ex-factory price</strong></dt>
<dd>The manufacturer's price before margins and VAT. This is <em>not</em> what you pay at the pharmacy — the patient price depends on reimbursement category, insurance status, and co-payment rules.</dd>
<dt><strong>Reimbursable</strong></dt>
<dd>Whether Belgian health insurance (RIZIV/INAMI) covers part of the cost.</dd>
<dt><strong>Cheap / Cheapest</strong></dt>
<dd>Belgium encourages affordable prescribing. "Cheap" means the product's price meets the reimbursement ceiling for its group. "Cheapest" means it is among the lowest-priced. When a physician prescribes by substance name (INN), the pharmacist must dispense a "cheap" product.</dd>
<dt><strong>Chapter IV</strong></dt>
<dd>Certain medications require prior authorization before reimbursement. The process: (1) physician submits a request, (2) the health insurance fund's advisory physician evaluates it against published conditions, (3) if approved, the patient receives authorization for a defined period.</dd>
</dl>`,
  nl: `<dl class="help-defs">
<dt><strong>Af-fabrieksprijs</strong></dt>
<dd>De prijs van de fabrikant vóór marges en BTW. Dit is <em>niet</em> wat u in de apotheek betaalt — de patiëntprijs hangt af van de terugbetalingscategorie, verzekeringsstatus en eigen bijdrage.</dd>
<dt><strong>Terugbetaalbaar</strong></dt>
<dd>Of de Belgische ziekteverzekering (RIZIV) een deel van de kosten dekt.</dd>
<dt><strong>Goedkoop / Goedkoopst</strong></dt>
<dd>België moedigt betaalbaar voorschrijven aan. "Goedkoop" betekent dat de prijs van het product het terugbetalingsplafond voor zijn groep haalt. "Goedkoopst" betekent dat het tot de laagst geprijsde behoort. Als een arts op stofnaam (INN) voorschrijft, moet de apotheker een "goedkoop" product afleveren.</dd>
<dt><strong>Hoofdstuk IV</strong></dt>
<dd>Bepaalde geneesmiddelen vereisen voorafgaande toestemming voor terugbetaling. Het proces: (1) de arts dient een aanvraag in, (2) de adviserend geneesheer van het ziekenfonds beoordeelt deze aan de hand van de gepubliceerde voorwaarden, (3) bij goedkeuring krijgt de patiënt een machtiging voor een bepaalde periode.</dd>
</dl>`,
  fr: `<dl class="help-defs">
<dt><strong>Prix départ usine</strong></dt>
<dd>Le prix du fabricant avant marges et TVA. Ce n'est <em>pas</em> ce que vous payez à la pharmacie — le prix patient dépend de la catégorie de remboursement, du statut d'assurance et des règles de ticket modérateur.</dd>
<dt><strong>Remboursable</strong></dt>
<dd>Si l'assurance maladie belge (INAMI) couvre une partie du coût.</dd>
<dt><strong>Bon marché / Le moins cher</strong></dt>
<dd>La Belgique encourage la prescription abordable. "Bon marché" signifie que le prix du produit respecte le plafond de remboursement de son groupe. "Le moins cher" signifie qu'il est parmi les moins chers. Quand un médecin prescrit en DCI (nom de substance), le pharmacien doit délivrer un produit "bon marché".</dd>
<dt><strong>Chapitre IV</strong></dt>
<dd>Certains médicaments nécessitent une autorisation préalable pour le remboursement. Le processus : (1) le médecin soumet une demande, (2) le médecin-conseil de la mutuelle l'évalue selon les conditions publiées, (3) en cas d'accord, le patient reçoit une autorisation pour une durée déterminée.</dd>
</dl>`,
  de: `<dl class="help-defs">
<dt><strong>Ab-Werk-Preis</strong></dt>
<dd>Der Herstellerpreis vor Margen und MwSt. Dies ist <em>nicht</em> der Apothekenpreis — der Patientenpreis hängt von der Erstattungskategorie, dem Versicherungsstatus und den Zuzahlungsregeln ab.</dd>
<dt><strong>Erstattungsfähig</strong></dt>
<dd>Ob die belgische Krankenversicherung (RIZIV/INAMI) einen Teil der Kosten übernimmt.</dd>
<dt><strong>Günstig / Am günstigsten</strong></dt>
<dd>Belgien fördert erschwingliches Verschreiben. "Günstig" bedeutet, dass der Produktpreis die Erstattungsobergrenze seiner Gruppe erreicht. "Am günstigsten" bedeutet, dass es zu den preiswertesten gehört. Verschreibt ein Arzt nach Wirkstoffname (INN), muss der Apotheker ein "günstiges" Produkt abgeben.</dd>
<dt><strong>Kapitel IV</strong></dt>
<dd>Bestimmte Arzneimittel erfordern eine vorherige Genehmigung zur Erstattung. Der Prozess: (1) der Arzt reicht einen Antrag ein, (2) der beratende Arzt der Krankenkasse prüft ihn anhand der veröffentlichten Bedingungen, (3) bei Genehmigung erhält der Patient eine Bewilligung für einen festgelegten Zeitraum.</dd>
</dl>`,
};

const indicators: Record<Lang, string> = {
  en: `<dl class="help-defs">
<dt><span class="black-triangle">&#9650;</span> <strong>Black Triangle</strong></dt>
<dd>Enhanced monitoring by the European Medicines Agency, typically for newer medications. It does not mean the medication is unsafe — authorities are actively collecting safety data.</dd>
<dt><strong>Orphan Drug</strong></dt>
<dd>A medication for rare diseases (fewer than 5 per 10,000 inhabitants in the EU), which receives special regulatory incentives.</dd>
<dt><strong>Patient Frailty</strong></dt>
<dd>Certain therapeutic groups require extra caution for elderly or frail patients regarding dosage and monitoring.</dd>
</dl>`,
  nl: `<dl class="help-defs">
<dt><span class="black-triangle">&#9650;</span> <strong>Zwarte Driehoek</strong></dt>
<dd>Aanvullende monitoring door het Europees Geneesmiddelenbureau, meestal voor nieuwere geneesmiddelen. Het betekent niet dat het geneesmiddel onveilig is — autoriteiten verzamelen actief veiligheidsgegevens.</dd>
<dt><strong>Weesgeneesmiddel</strong></dt>
<dd>Een geneesmiddel voor zeldzame ziekten (minder dan 5 per 10.000 inwoners in de EU), dat speciale regelgevende stimulansen ontvangt.</dd>
<dt><strong>Patiëntenkwetsbaarheid</strong></dt>
<dd>Bepaalde therapeutische groepen vereisen extra voorzichtigheid bij oudere of kwetsbare patiënten wat betreft dosering en monitoring.</dd>
</dl>`,
  fr: `<dl class="help-defs">
<dt><span class="black-triangle">&#9650;</span> <strong>Triangle Noir</strong></dt>
<dd>Surveillance renforcée par l'Agence européenne des médicaments, généralement pour les médicaments plus récents. Cela ne signifie pas que le médicament est dangereux — les autorités collectent activement des données de sécurité.</dd>
<dt><strong>Médicament Orphelin</strong></dt>
<dd>Un médicament pour les maladies rares (moins de 5 pour 10 000 habitants dans l'UE), bénéficiant d'incitations réglementaires spéciales.</dd>
<dt><strong>Fragilité du Patient</strong></dt>
<dd>Certains groupes thérapeutiques nécessitent une prudence accrue pour les patients âgés ou fragiles en matière de dosage et de suivi.</dd>
</dl>`,
  de: `<dl class="help-defs">
<dt><span class="black-triangle">&#9650;</span> <strong>Schwarzes Dreieck</strong></dt>
<dd>Zusätzliche Überwachung durch die Europäische Arzneimittel-Agentur, typischerweise für neuere Arzneimittel. Es bedeutet nicht, dass das Arzneimittel unsicher ist — Behörden sammeln aktiv Sicherheitsdaten.</dd>
<dt><strong>Orphan-Arzneimittel</strong></dt>
<dd>Ein Arzneimittel für seltene Krankheiten (weniger als 5 pro 10.000 Einwohner in der EU), das besondere regulatorische Anreize erhält.</dd>
<dt><strong>Patientengebrechlichkeit</strong></dt>
<dd>Bestimmte therapeutische Gruppen erfordern besondere Vorsicht bei älteren oder gebrechlichen Patienten hinsichtlich Dosierung und Überwachung.</dd>
</dl>`,
};

export function generateHelpPage(dist: string) {
  const dir = join(dist, "help");
  mkdirSync(dir, { recursive: true });

  const content = `
<div class="help-content">
<h1>${label("help.title")}</h1>

<section class="section">
<h2 class="section-title">${label("help.hierarchy")}</h2>
${hierarchyTree()}
</section>

<section class="section">
<h2 class="section-title">${label("help.badges")}</h2>
${mlBlock(entityTypes)}
</section>

<section class="section">
<h2 class="section-title">${label("help.codes")}</h2>
${mlBlock(codes)}
</section>

<section class="section">
<h2 class="section-title">${label("help.pricing")}</h2>
${mlBlock(pricing)}
</section>

<section class="section">
<h2 class="section-title">${label("help.indicators")}</h2>
${mlBlock(indicators)}
</section>
</div>`;

  writeFileSync(
    join(dir, "index.html"),
    layout("Help — MedSearch", content, {
      description:
        "Learn how to use MedSearch: understand medication types (VTM, VMP, AMP, AMPP), codes (CNK, ATC), pricing, and reimbursement in Belgium.",
    })
  );
  console.log("  Generated help page");
}
