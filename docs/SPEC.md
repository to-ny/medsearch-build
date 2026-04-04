# MedSearch Specification

## 1. Architecture

- Static site generator: SAM XML → SQLite → HTML pages → Pagefind index
- Client-side search via MiniSearch/Pagefind
- Languages: nl, fr, en, de (single page with CSS toggle)
- Language fallback chain: requested → en → nl → fr → de → first available

## 2. Routes

- `/` — Home with search hero
- `/vtm/[code]` — Substance detail
- `/vmp/[code]` — Generic product detail
- `/amp/[code]` — Brand detail
- `/ampp/[cti]` — Package detail
- `/company/[actorNr]` — Company detail
- `/vmp-group/[code]` — Therapeutic group detail
- `/atc/[code]` — ATC classification detail
- `/chapter-iv/[chapter]/[paragraph]` — Chapter IV detail

## 3. Domain Hierarchy

VTM → VMP → AMP → AMPP (substance → generic → brand → package)

Supporting entities: Company, VMP Group, Substance, ATC Classification, DMPP (CNK codes), Reimbursement Context, Chapter IV Paragraph, Standard Dosage.

## 4. Entity Types

### VTM (Virtual Therapeutic Moiety — Active Substance)
- code, name, validity period
- Relations: child VMPs, AMP count

### VMP (Virtual Medicinal Product — Generic)
- code, name, abbreviatedName, vtmCode, vmpGroupCode, status
- Relations: parent VTM, VMP Group, child AMPs, dosages

### AMP (Actual Medicinal Product — Brand)
- code, name, abbreviatedName, officialName, vmpCode, companyActorNr, blackTriangle, medicineType, status
- Relations: parent VMP, Company, components (pharma form + route), ingredients (substance + strength), excipients, child AMPPs

### AMPP (Actual Medicinal Product Package)
- ctiExtended, ampCode, prescriptionName, authorisationNr, orphan, leafletUrl, spcUrl, packDisplayValue, status, exFactoryPrice, atcCode
- Relations: parent AMP, ATC classification, DMPP/CNK codes, reimbursement contexts, Chapter IV paragraphs

### DMPP (CNK Code)
- code (7-digit CNK), deliveryEnvironment (P=Public, H=Hospital), price, cheap, cheapest, reimbursable

### Company
- actorNr, denomination, legalForm, VAT info, address, phone, language
- Relations: child AMPs

### VMP Group
- code, name, noGenericPrescriptionReason, noSwitchReason, patientFrailtyIndicator
- Relations: member VMPs, standard dosages

### ATC Classification
- code, description
- Relations: parent/child ATC codes, linked AMPPs

### Reimbursement Context
- dmppCode, deliveryEnvironment, category (A/B/C/Cs/Cx/Fa/Fb), flatRateSystem, referencePrice, temporary, referenceBasePrice, reimbursementBasePrice, pricingUnit
- Nested copayments: regimenType (1=Preferential, 2=Regular), feeAmount, reimbursementAmount

### Chapter IV Paragraph
- chapterName, paragraphName, keyString (indication), processType, paragraphVersion
- Nested verses: hierarchical legislation text with request type (N=New, P=Prolongation), agreement terms
- Relations: linked DMPPs

### Standard Dosage
- targetGroup (Neonate/Paediatrics/Adolescent/Adult), treatmentDurationType (One-off/Temporary/Chronic/If necessary)
- Dosing: quantity, frequency, max daily, textual dosage
- Conditions: kidney/liver failure class, parameter bounds (age/weight)
- Context: indication, route of administration, supplementary info

## 5. Search

### Behavior
- Minimum 2 characters to trigger
- Debounce 300ms
- CNK detection: 7-digit pattern → prioritize DMPP exact match
- ATC detection: pattern like `N02BE01` → search ATC codes
- Multi-word: all tokens must match, order-independent, bonus for in-order

### Scoring (descending priority)
- Exact name match: 1.0
- Code/CNK exact match: 0.95
- Name prefix: 0.8
- Word prefix: 0.6
- Contains: 0.4
- Fuzzy fallback: 0.2

### Result ordering
1. Score descending
2. Same score: type priority vtm > vmp > amp > ampp > company > vmp_group
3. Same type+score: alphabetical by localized name

### Typo tolerance
- For 4+ char queries with zero results, use fuzzy matching (threshold 0.3)

## 6. Entity Cards

Common structure: type badge, primary name, secondary line, context/relationship line.

### Badge colors
- VTM/Substance: Purple `#8B5CF6`
- VMP: Blue `#3B82F6`
- AMP: Green `#10B981`
- AMPP: Orange `#F97316`
- Company: Gray `#6B7280`
- VMP Group: Teal `#14B8A6`
- ATC: Indigo `#6366F1`

### Card content per type
- **VTM**: name, "Active substance", VMP count + AMP count
- **VMP**: name, status badge, parent VTM name, AMP count
- **AMP**: name + black triangle warning, parent VMP name, company, package count
- **AMPP**: prescription name or AMP name + pack value, CNK code, price, reimbursement badge
- **Company**: denomination, city/country, product count
- **VMP Group**: name, VMP count, frailty indicator
- **ATC**: code + description, product count

### Status indicators
- AUTHORIZED: no badge (default)
- REVOKED: red badge
- SUSPENDED: yellow badge
- Black Triangle: warning icon
- Orphan Drug: badge
- Reimbursable: category badge (A/B/C)

## 7. Detail Views

### Common layout
- Breadcrumbs: Home > [parent entity] > current
- Entity header: type badge, name, code, status
- Desktop: main content (2/3) + related entities sidebar (1/3)

### VTM Detail
- Overview: validity, language variants
- Generic Products: VMP cards
- Brand Products: collapsible, AMP cards

### VMP Detail
- Overview: abbreviated name, validity
- Active Substance: VTM link
- Therapeutic Group: VMP Group link, frailty indicator
- Brand Products: AMP cards with company, black triangle
- Dosage Recommendations: grouped by target group, showing indication, textual dosage, duration

### AMP Detail
- Overview: official name, medicine type, black triangle warning
- Generic Product: VMP link
- Manufacturer: Company card with address
- Pharmaceutical Details: form + route per component
- Active Ingredients: substance name + strength
- Excipients: SmPC text + source URL
- Packages: AMPP cards with price, CNK, reimbursement

### AMPP Detail
- Overview: pack value, authorisation nr, orphan indicator
- Brand: AMP link
- ATC Classification: code + hierarchy
- Pricing & CNK Codes: DMPP list with environment, price, cheap/cheapest indicators
- Reimbursement: category badge, copayment amounts (preferential vs regular), reference price, legal reference
- Chapter IV: linked paragraphs with indication
- Documents: leaflet + SmPC links per language

### Company Detail
- Contact: full address, phone, VAT
- Legal: legal form, validity
- Products: paginated AMP list

### VMP Group Detail
- Overview: frailty indicator, no-generic/no-switch reasons
- Member Products: VMP cards
- Dosage Recommendations: full detail per target group — quantity, frequency, max daily, duration, conditions, parameter bounds

### ATC Detail
- Hierarchy: breadcrumb path (N → N02 → N02B → ...)
- Child Classifications: links
- Products: paginated AMPP list

### Chapter IV Detail
- Overview: process type, version, modification status
- Requirements: hierarchical verse display, indented by level, request type, agreement terms
- Covered Products: DMPP list

## 8. Reimbursement Categories

- A: 100% reimbursed (green)
- B: 75% (blue)
- C: 50% (yellow)
- Cs/Cx: special conditions (orange)
- Fa/Fb: lump-sum (purple)

## 9. Internationalization

- UI translations: JSON per language (nl, fr, en, de)
- Database content: multilingual text fields with fallback chain
- Language detection priority: URL param → stored preference → browser language → 'en'

## 10. Responsive Design

- Mobile (<640px): single column, stacked cards, simplified pagination, touch targets >=44px
- Tablet (640-1024px): 2 columns
- Desktop (>1024px): sidebar layout, sticky related entities, keyboard shortcuts

## 11. Accessibility

- WCAG 2.1 AA
- All interactive elements keyboard-accessible
- Semantic HTML with ARIA labels
- Color contrast >=4.5:1
- Focus indicators, skip links
- Live regions for dynamic content
