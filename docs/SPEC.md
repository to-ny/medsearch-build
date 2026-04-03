# MedSearch Application Specification

## 1. Architecture Overview

### 1.1 System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Search Page │  │ Detail Page │  │ Browse Page │  │ Language Selector   │ │
│  │ /           │  │ /[type]/[id]│  │ /browse     │  │ (Context Provider)  │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         │                │                │                     │            │
│  ┌──────┴────────────────┴────────────────┴─────────────────────┴──────────┐│
│  │                        Shared Components                                 ││
│  │  SearchBar │ EntityCard │ EntityDetail │ RelationshipList │ Breadcrumbs ││
│  └──────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ HTTP/JSON
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API LAYER (Next.js Route Handlers)             │
│  ┌─────────────────┐  ┌─────────────────────────────────────────────────┐   │
│  │ /api/search     │  │ /api/entities/[type]/[id]                       │   │
│  │ Unified search  │  │ VTM, VMP, AMP, AMPP, Company, VMPGroup, etc.   │   │
│  └────────┬────────┘  └──────────────────────┬──────────────────────────┘   │
│           │                                  │                               │
│  ┌────────┴──────────────────────────────────┴──────────────────────────┐   │
│  │                    Data Access Layer (src/server/)                    │   │
│  │  repositories/  │  queries/  │  types/  │  utils/                    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ SQL
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PostgreSQL (Neon via Vercel)                         │
│  vtm │ vmp │ amp │ ampp │ dmpp │ company │ vmp_group │ reimbursement │ ...  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Component Hierarchy

```
App
├── LanguageProvider (Context)
│   └── Layout
│       ├── Header
│       │   ├── Logo
│       │   ├── SearchBar (global, always visible)
│       │   └── LanguageSelector
│       │
│       └── Main Content (per route)
│           │
│           ├── SearchPage (/)
│           │   ├── SearchHero (large search input when empty)
│           │   ├── SearchResults
│           │   │   ├── SearchResultsHeader (count, filters)
│           │   │   ├── EntityTypeFilter
│           │   │   └── ResultsList
│           │   │       └── EntityCard (per result)
│           │   └── Pagination
│           │
│           ├── DetailPage (/[type]/[id])
│           │   ├── Breadcrumbs
│           │   ├── EntityHeader
│           │   │   ├── EntityTypeBadge
│           │   │   ├── EntityTitle
│           │   │   └── EntityStatus
│           │   ├── EntityDetail (type-specific)
│           │   │   ├── InfoSection
│           │   │   ├── RelationshipSection
│           │   │   │   └── RelationshipList
│           │   │   │       └── EntityCard (mini variant)
│           │   │   └── CollapsibleSection
│           │   └── RelatedEntities (sidebar on desktop)
│           │
│           └── BrowsePage (/browse)
│               ├── EntityTypeGrid
│               └── AlphabeticalIndex
```

### 1.3 Routing Structure

| Route | Purpose | Key Features |
|-------|---------|--------------|
| `/` | Home/Search | Large search hero, popular searches, recent searches |
| `/search?q=...` | Search Results | Filtered results, pagination, type filters |
| `/vtm/[code]` | VTM Detail | Substance info, linked VMPs, linked AMPs |
| `/vmp/[code]` | VMP Detail | Generic product info, substance, brands, dosages |
| `/amp/[code]` | AMP Detail | Brand info, ingredients, excipients, packages |
| `/ampp/[cti]` | AMPP Detail | Package info, prices, CNK codes, documents |
| `/company/[actorNr]` | Company Detail | Company info, all products |
| `/vmp-group/[code]` | VMP Group Detail | Therapeutic group, members, dosages |
| `/atc/[code]` | ATC Class Detail | Classification info, linked products |
| `/chapter-iv/[chapter]/[paragraph]` | Chapter IV Detail | Authorization requirements |
| `/browse` | Browse by Type | Alphabetical navigation, type selection |

---

## 2. Data Types

### 2.1 Core Domain Types

```typescript
// src/server/types/domain.ts

/** Supported UI languages */
type Language = 'nl' | 'fr' | 'en' | 'de';

/** Multilingual text object - stored as JSONB in database */
interface MultilingualText {
  nl?: string;
  fr?: string;
  en?: string;
  de?: string;
}

/** Extract text for a language with fallback chain: requested → en → nl → fr → de → first available */
function getLocalizedText(text: MultilingualText | null | undefined, lang: Language): string;

/** Entity type discriminator for unified handling */
type EntityType =
  | 'vtm'
  | 'vmp'
  | 'amp'
  | 'ampp'
  | 'company'
  | 'vmp_group'
  | 'substance'
  | 'atc';

/** Common validity period */
interface ValidityPeriod {
  startDate: string | null;  // ISO date string
  endDate: string | null;
}
```

### 2.2 Entity Types

```typescript
// src/server/types/entities.ts

/** VTM - Virtual Therapeutic Moiety (Active Substance) */
interface VTM extends ValidityPeriod {
  code: string;
  name: MultilingualText;
}

/** VTM with relationships loaded */
interface VTMWithRelations extends VTM {
  vmps: VMPSummary[];           // Generic products containing this substance
  ampCount: number;             // Total brand products
}

/** VMP - Virtual Medicinal Product (Generic) */
interface VMP extends ValidityPeriod {
  code: string;
  name: MultilingualText;
  abbreviatedName: MultilingualText | null;
  vtmCode: string | null;
  vmpGroupCode: string | null;
  status: 'AUTHORIZED' | 'REVOKED' | 'SUSPENDED';
}

/** VMP with relationships loaded */
interface VMPWithRelations extends VMP {
  vtm: VTMSummary | null;           // Parent substance
  vmpGroup: VMPGroupSummary | null; // Therapeutic group
  amps: AMPSummary[];               // Brand products
  dosages: StandardDosageSummary[]; // Dosing recommendations
}

/** AMP - Actual Medicinal Product (Brand) */
interface AMP extends ValidityPeriod {
  code: string;
  name: MultilingualText;
  abbreviatedName: MultilingualText | null;
  officialName: string | null;
  vmpCode: string | null;
  companyActorNr: string | null;
  blackTriangle: boolean;           // Enhanced monitoring required
  medicineType: string | null;
  status: 'AUTHORIZED' | 'REVOKED' | 'SUSPENDED';
}

/** AMP with all relationships */
interface AMPWithRelations extends AMP {
  vmp: VMPSummary | null;
  company: CompanySummary | null;
  components: AMPComponent[];
  ingredients: AMPIngredient[];
  excipients: AMPExcipient | null;
  packages: AMPPSummary[];
}

/** AMP Component - pharmaceutical form and route */
interface AMPComponent {
  sequenceNr: number;
  pharmaceuticalFormCode: string | null;
  pharmaceuticalFormName: MultilingualText | null;
  routeOfAdministrationCode: string | null;
  routeOfAdministrationName: MultilingualText | null;
}

/** AMP Ingredient - active substance with strength */
interface AMPIngredient {
  componentSequenceNr: number;
  rank: number;
  type: 'ACTIVE_SUBSTANCE' | 'EXCIPIENT';
  substanceCode: string | null;
  substanceName: MultilingualText | null;
  strengthDescription: string | null;  // e.g., "EQUAL 500 mg"
}

/** AMP Excipient - inactive ingredients from SmPC */
interface AMPExcipient {
  ampCode: string;
  text: MultilingualText;
  sourceUrls: MultilingualText | null;
  parsedAt: string;
}

/** AMPP - Actual Medicinal Product Package */
interface AMPP extends ValidityPeriod {
  ctiExtended: string;
  ampCode: string;
  prescriptionName: MultilingualText | null;
  authorisationNr: string | null;
  orphan: boolean;
  leafletUrl: MultilingualText | null;
  spcUrl: MultilingualText | null;
  packDisplayValue: string | null;
  status: string | null;
  exFactoryPrice: number | null;
  atcCode: string | null;
}

/** AMPP with relationships */
interface AMPPWithRelations extends AMPP {
  amp: AMPSummary;
  atcClassification: ATCClassification | null;
  cnkCodes: DMPP[];
  reimbursementContexts: ReimbursementContext[];
  chapterIVParagraphs: ChapterIVParagraphSummary[];
}

/** DMPP - CNK Code with pricing */
interface DMPP extends ValidityPeriod {
  code: string;                     // 7-digit CNK code
  deliveryEnvironment: 'P' | 'H';   // Public or Hospital
  amppCtiExtended: string;
  price: number | null;
  cheap: boolean;
  cheapest: boolean;
  reimbursable: boolean;
}

/** Company - Pharmaceutical manufacturer */
interface Company extends ValidityPeriod {
  actorNr: string;
  denomination: string;
  legalForm: string | null;
  vatCountryCode: string | null;
  vatNumber: string | null;
  streetName: string | null;
  streetNum: string | null;
  postbox: string | null;
  postcode: string | null;
  city: string | null;
  countryCode: string | null;
  phone: string | null;
  language: string | null;
}

/** Company with relationships */
interface CompanyWithRelations extends Company {
  products: AMPSummary[];
  productCount: number;
}

/** VMP Group - Therapeutic classification */
interface VMPGroup extends ValidityPeriod {
  code: string;
  name: MultilingualText;
  noGenericPrescriptionReason: string | null;
  noSwitchReason: string | null;
  patientFrailtyIndicator: boolean;
}

/** VMP Group with relationships */
interface VMPGroupWithRelations extends VMPGroup {
  vmps: VMPSummary[];
  dosages: StandardDosage[];
}

/** Substance - referenced by ingredients */
interface Substance extends ValidityPeriod {
  code: string;
  name: MultilingualText;
}

/** ATC Classification - WHO drug classification */
interface ATCClassification {
  code: string;
  description: string;
}

/** Reimbursement Context - insurance coverage */
interface ReimbursementContext extends ValidityPeriod {
  id: number;
  dmppCode: string;
  deliveryEnvironment: 'P' | 'H';
  legalReferencePath: string | null;
  reimbursementCriterionCategory: string | null;  // A, B, C, Cs, Cx, Fa, Fb
  reimbursementCriterionCode: string | null;
  flatRateSystem: boolean;
  referencePrice: boolean;
  temporary: boolean;
  referenceBasePrice: number | null;
  reimbursementBasePrice: number | null;
  pricingUnitQuantity: number | null;
  pricingUnitLabel: MultilingualText | null;
  copayments: Copayment[];
}

/** Copayment - patient cost by regimen */
interface Copayment {
  id: number;
  regimenType: '1' | '2';  // 1=PREFERENTIAL, 2=REGULAR
  feeAmount: number | null;
  reimbursementAmount: number | null;
}

/** Chapter IV Paragraph - prior authorization rules */
interface ChapterIVParagraph extends ValidityPeriod {
  chapterName: string;
  paragraphName: string;
  keyString: MultilingualText | null;   // Indication summary
  processType: string | null;
  processTypeOverrule: string | null;
  paragraphVersion: number | null;
  modificationStatus: string | null;
}

/** Chapter IV with full details */
interface ChapterIVParagraphWithRelations extends ChapterIVParagraph {
  verses: ChapterIVVerse[];
  linkedProducts: DMPPSummary[];
}

/** Chapter IV Verse - legislation text */
interface ChapterIVVerse {
  id: number;
  verseSeq: number;
  verseNum: number;
  verseSeqParent: number;
  verseLevel: number;
  text: MultilingualText | null;
  requestType: 'N' | 'P' | null;  // New or Prolongation
  agreementTermQuantity: number | null;
  agreementTermUnit: 'D' | 'W' | 'M' | 'Y' | null;
  startDate: string | null;
}

/** Standard Dosage - dosing recommendations */
interface StandardDosage extends ValidityPeriod {
  code: string;
  vmpGroupCode: string | null;
  targetGroup: 'NEONATE' | 'PAEDIATRICS' | 'ADOLESCENT' | 'ADULT';
  kidneyFailureClass: number | null;
  liverFailureClass: number | null;
  treatmentDurationType: 'ONE_OFF' | 'TEMPORARY' | 'CHRONIC' | 'IF_NECESSARY';
  temporalityDurationValue: number | null;
  temporalityDurationUnit: string | null;
  temporalityUserProvided: boolean | null;
  temporalityNote: MultilingualText | null;
  quantity: number | null;
  quantityDenominator: number | null;
  quantityRangeLower: number | null;
  quantityRangeUpper: number | null;
  administrationFrequencyQuantity: number | null;
  administrationFrequencyIsMax: boolean | null;
  administrationFrequencyTimeframeValue: number | null;
  administrationFrequencyTimeframeUnit: string | null;
  maximumAdministrationQuantity: number | null;
  maximumDailyQuantityValue: number | null;
  maximumDailyQuantityUnit: string | null;
  maximumDailyQuantityMultiplier: number | null;
  textualDosage: MultilingualText | null;
  supplementaryInfo: MultilingualText | null;
  routeSpecification: MultilingualText | null;
  indicationCode: string | null;
  indicationName: MultilingualText | null;
  routeOfAdministrationCode: string | null;
  parameterBounds: DosageParameterBounds[];
}

/** Dosage Parameter Bounds - weight/age constraints */
interface DosageParameterBounds {
  parameterCode: string;
  parameterName: MultilingualText | null;
  lowerBoundValue: number | null;
  lowerBoundUnit: string | null;
  upperBoundValue: number | null;
  upperBoundUnit: string | null;
}

/** Legal Basis - Royal Decrees */
interface LegalBasis extends ValidityPeriod {
  key: string;
  title: MultilingualText;
  type: string;
  effectiveOn: string | null;
}

/** Legal Reference - hierarchical legislation structure */
interface LegalReference extends ValidityPeriod {
  id: number;
  legalBasisKey: string;
  parentPath: string | null;
  key: string;
  path: string;
  title: MultilingualText | null;
  type: 'CHAPTER' | 'PARAGRAPH' | 'ARTICLE' | 'SECTION';
  firstPublishedOn: string | null;
  lastModifiedOn: string | null;
}

/** Legal Text - actual text content */
interface LegalText extends ValidityPeriod {
  id: number;
  legalBasisKey: string;
  legalReferencePath: string;
  parentTextKey: string | null;
  key: string;
  content: MultilingualText | null;
  type: 'ALINEA' | 'POINT';
  sequenceNr: number;
  lastModifiedOn: string | null;
}
```

### 2.3 Summary Types (for lists and search results)

```typescript
// src/server/types/summaries.ts

/** Base summary with common fields for search results */
interface EntitySummary {
  entityType: EntityType;
  code: string;               // Primary identifier
  name: MultilingualText;
  status?: string;
}

interface VTMSummary extends EntitySummary {
  entityType: 'vtm';
}

interface VMPSummary extends EntitySummary {
  entityType: 'vmp';
  vtmCode: string | null;
  vmpGroupCode: string | null;
}

interface AMPSummary extends EntitySummary {
  entityType: 'amp';
  vmpCode: string | null;
  companyActorNr: string | null;
  companyName: string | null;
  blackTriangle: boolean;
}

interface AMPPSummary extends EntitySummary {
  entityType: 'ampp';
  ampCode: string;
  ampName: MultilingualText;
  packDisplayValue: string | null;
  exFactoryPrice: number | null;
  cnkCode: string | null;         // Primary CNK for display
  reimbursable: boolean;
}

interface CompanySummary {
  entityType: 'company';
  actorNr: string;
  denomination: string;
  city: string | null;
  countryCode: string | null;
}

interface VMPGroupSummary extends EntitySummary {
  entityType: 'vmp_group';
  patientFrailtyIndicator: boolean;
}

interface SubstanceSummary extends EntitySummary {
  entityType: 'substance';
}

interface ATCSummary {
  entityType: 'atc';
  code: string;
  description: string;
}

interface ChapterIVParagraphSummary {
  chapterName: string;
  paragraphName: string;
  keyString: MultilingualText | null;
}

interface DMPPSummary {
  code: string;
  deliveryEnvironment: 'P' | 'H';
  price: number | null;
  reimbursable: boolean;
}

interface StandardDosageSummary {
  code: string;
  targetGroup: string;
  textualDosage: MultilingualText | null;
  indicationName: MultilingualText | null;
}
```

### 2.4 API Types

```typescript
// src/server/types/api.ts

/** Unified search result item */
interface SearchResultItem {
  entityType: EntityType;
  code: string;
  name: MultilingualText;

  // Context-specific fields (vary by type)
  parentName?: MultilingualText;     // For VMP: VTM name; For AMP: VMP name
  parentCode?: string;
  companyName?: string;              // For AMP
  packInfo?: string;                 // For AMPP
  price?: number;                    // For AMPP
  reimbursable?: boolean;            // For AMPP
  cnkCode?: string;                  // For AMPP
  productCount?: number;             // For Company

  // Relevance metadata
  matchedField: 'name' | 'code' | 'cnk' | 'company' | 'substance';
  matchScore: number;                // 0-1, for result ordering
}

/** Search request parameters */
interface SearchRequest {
  q: string;                         // Search query (required)
  lang?: Language;                   // UI language for fallbacks
  types?: EntityType[];              // Filter to specific types
  limit?: number;                    // Max results (default 20, max 100)
  offset?: number;                   // Pagination offset
}

/** Search response */
interface SearchResponse {
  query: string;
  totalCount: number;
  results: SearchResultItem[];
  facets: {
    byType: Record<EntityType, number>;
  };
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

/** Entity detail request (URL params) */
interface EntityDetailParams {
  type: EntityType;
  id: string;                        // code or primary key
}

/** Entity detail query params */
interface EntityDetailQuery {
  lang?: Language;
  include?: string[];                // Relationships to include
}

/** Generic API error response */
interface APIError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** API error codes */
type APIErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_PARAMS'
  | 'INVALID_TYPE'
  | 'QUERY_TOO_SHORT'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR';
```

---

## 3. API Specification

### 3.1 Search Endpoint

```
GET /api/search
```

**Purpose:** Unified search across all entity types.

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `q` | string | Yes | - | Search query, minimum 2 characters |
| `lang` | string | No | 'en' | Language for sorting/fallbacks: nl, fr, en, de |
| `types` | string | No | all | Comma-separated entity types to include |
| `limit` | number | No | 20 | Results per page (max 100) |
| `offset` | number | No | 0 | Pagination offset |

**Response: 200 OK**

```typescript
{
  query: string;
  totalCount: number;
  results: SearchResultItem[];
  facets: {
    byType: {
      vtm: number;
      vmp: number;
      amp: number;
      ampp: number;
      company: number;
      vmp_group: number;
      substance: number;
      atc: number;
    };
  };
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}
```

**Response: 400 Bad Request**

```typescript
{
  error: {
    code: 'QUERY_TOO_SHORT';
    message: 'Search query must be at least 2 characters';
  }
}
```

**Response: 400 Bad Request**

```typescript
{
  error: {
    code: 'INVALID_PARAMS';
    message: 'Invalid entity type: "invalid"';
    details: {
      validTypes: ['vtm', 'vmp', 'amp', 'ampp', 'company', 'vmp_group', 'substance', 'atc'];
    };
  }
}
```

---

### 3.2 Entity Detail Endpoints

#### 3.2.1 VTM Detail

```
GET /api/entities/vtm/[code]
```

**Response: 200 OK**

```typescript
{
  entity: VTMWithRelations;
}
```

**Fields returned:**
- `code`: VTM code
- `name`: Multilingual name
- `startDate`, `endDate`: Validity period
- `vmps`: Array of VMPSummary (all generic products with this substance)
- `ampCount`: Total number of brand products

---

#### 3.2.2 VMP Detail

```
GET /api/entities/vmp/[code]
```

**Response: 200 OK**

```typescript
{
  entity: VMPWithRelations;
}
```

**Fields returned:**
- All VMP fields
- `vtm`: VTMSummary or null
- `vmpGroup`: VMPGroupSummary or null
- `amps`: Array of AMPSummary (all brands)
- `dosages`: Array of StandardDosageSummary

---

#### 3.2.3 AMP Detail

```
GET /api/entities/amp/[code]
```

**Response: 200 OK**

```typescript
{
  entity: AMPWithRelations;
}
```

**Fields returned:**
- All AMP fields
- `vmp`: VMPSummary or null
- `company`: CompanySummary or null
- `components`: Array of AMPComponent with pharmaceutical form and route names
- `ingredients`: Array of AMPIngredient with substance names
- `excipients`: AMPExcipient or null (text from SmPC)
- `packages`: Array of AMPPSummary with prices and CNK codes

---

#### 3.2.4 AMPP Detail

```
GET /api/entities/ampp/[ctiExtended]
```

**Response: 200 OK**

```typescript
{
  entity: AMPPWithRelations;
}
```

**Fields returned:**
- All AMPP fields
- `amp`: AMPSummary
- `atcClassification`: ATCClassification or null
- `cnkCodes`: Array of DMPP (public and hospital CNK codes with prices)
- `reimbursementContexts`: Array with copayments nested
- `chapterIVParagraphs`: Array of ChapterIVParagraphSummary

---

#### 3.2.5 Company Detail

```
GET /api/entities/company/[actorNr]
```

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `productsLimit` | number | No | 50 | Max products to return |
| `productsOffset` | number | No | 0 | Products pagination offset |

**Response: 200 OK**

```typescript
{
  entity: CompanyWithRelations;
}
```

**Fields returned:**
- All Company fields (address, VAT, etc.)
- `products`: Paginated array of AMPSummary
- `productCount`: Total number of products

---

#### 3.2.6 VMP Group Detail

```
GET /api/entities/vmp-group/[code]
```

**Response: 200 OK**

```typescript
{
  entity: VMPGroupWithRelations;
}
```

**Fields returned:**
- All VMPGroup fields
- `vmps`: Array of VMPSummary (all members)
- `dosages`: Array of StandardDosage (full details)

---

#### 3.2.7 Substance Detail

```
GET /api/entities/substance/[code]
```

**Response: 200 OK**

```typescript
{
  entity: {
    code: string;
    name: MultilingualText;
    startDate: string | null;
    endDate: string | null;
    usedInAmps: AMPSummary[];      // AMPs using this as ingredient
    usedInAmpCount: number;
  };
}
```

---

#### 3.2.8 ATC Classification Detail

```
GET /api/entities/atc/[code]
```

**Response: 200 OK**

```typescript
{
  entity: {
    code: string;
    description: string;
    parentCode: string | null;         // e.g., "N02B" for "N02BE"
    children: ATCSummary[];            // Child codes
    packages: AMPPSummary[];           // Products with this ATC
    packageCount: number;
  };
}
```

---

#### 3.2.9 Chapter IV Paragraph Detail

```
GET /api/entities/chapter-iv/[chapterName]/[paragraphName]
```

**Response: 200 OK**

```typescript
{
  entity: ChapterIVParagraphWithRelations;
}
```

**Fields returned:**
- All ChapterIVParagraph fields
- `verses`: Array of ChapterIVVerse (hierarchical legislation text)
- `linkedProducts`: Array of DMPPSummary

---

### 3.3 Common Error Responses

**404 Not Found**

```typescript
{
  error: {
    code: 'NOT_FOUND';
    message: 'VTM with code "INVALID" not found';
  }
}
```

**400 Invalid Type**

```typescript
{
  error: {
    code: 'INVALID_TYPE';
    message: 'Invalid entity type: "invalid"';
    details: {
      validTypes: ['vtm', 'vmp', 'amp', 'ampp', 'company', 'vmp_group', 'substance', 'atc', 'chapter-iv'];
    };
  }
}
```

**500 Server Error**

```typescript
{
  error: {
    code: 'SERVER_ERROR';
    message: 'An unexpected error occurred';
  }
}
```

---

## 4. Search Specification

### 4.1 Search Algorithm

The search operates in two phases: **candidate retrieval** and **ranking**.

#### Phase 1: Candidate Retrieval

Execute parallel queries against each searchable table, using PostgreSQL's GIN indexes on JSONB name fields:

```sql
-- Pattern: search all language variants in multilingual fields
-- Using ILIKE for prefix matching, trigram similarity for fuzzy matching

-- Example for VTM:
SELECT
  'vtm' as entity_type,
  code,
  name,
  NULL as parent_code,
  NULL as parent_name,
  'name' as matched_field
FROM vtm
WHERE
  name->>'en' ILIKE $1 || '%'
  OR name->>'nl' ILIKE $1 || '%'
  OR name->>'fr' ILIKE $1 || '%'
  OR name->>'de' ILIKE $1 || '%'
  OR code ILIKE $1 || '%'
  AND (end_date IS NULL OR end_date > CURRENT_DATE)
LIMIT 50;
```

**Tables searched and fields:**

| Table | Fields Searched | Index Used |
|-------|-----------------|------------|
| vtm | name (all langs), code | idx_vtm_name (GIN) |
| vmp | name (all langs), abbreviated_name, code | idx_vmp_name (GIN) |
| amp | name (all langs), abbreviated_name, official_name, code | idx_amp_name (GIN) |
| ampp | prescription_name (all langs), cti_extended | - |
| dmpp | code (CNK) | idx_dmpp_code |
| company | denomination | idx_company_name |
| vmp_group | name (all langs), code | idx_vmp_group_name (GIN) |
| substance | name (all langs), code | idx_substance_name (GIN) |
| atc_classification | code, description | idx_atc_description |

**Special handling:**

1. **CNK Code Search**: If query matches pattern `/^\d{7}$/` (7 digits), prioritize exact match in `dmpp.code`
2. **ATC Code Search**: If query matches pattern `/^[A-Z]\d{2}[A-Z]{0,2}\d{0,2}$/i`, search ATC codes
3. **Code Search**: Always include exact code matches across all tables

#### Phase 2: Ranking

Score each result based on:

```typescript
interface ScoringFactors {
  exactMatch: 1.0;        // Query exactly equals name (case-insensitive)
  prefixMatch: 0.8;       // Name starts with query
  wordPrefixMatch: 0.6;   // A word in name starts with query
  containsMatch: 0.4;     // Name contains query anywhere
  codeMatch: 0.9;         // Primary code matches
  cnkMatch: 0.95;         // CNK code exact match (very specific)
}
```

**Scoring algorithm:**

```typescript
function calculateScore(result: RawResult, query: string, lang: Language): number {
  const normalizedQuery = query.toLowerCase().trim();
  const name = getLocalizedText(result.name, lang).toLowerCase();

  // Exact match (highest priority)
  if (name === normalizedQuery) {
    return 1.0;
  }

  // Code exact match
  if (result.code.toLowerCase() === normalizedQuery) {
    return 0.95;
  }

  // CNK exact match
  if (result.cnkCode === normalizedQuery) {
    return 0.95;
  }

  // Name prefix match
  if (name.startsWith(normalizedQuery)) {
    return 0.8 + (normalizedQuery.length / name.length) * 0.1;
  }

  // Word prefix match (e.g., "para" matches "Paracetamol 500mg")
  const words = name.split(/\s+/);
  if (words.some(word => word.startsWith(normalizedQuery))) {
    return 0.6 + (normalizedQuery.length / name.length) * 0.1;
  }

  // Contains match
  if (name.includes(normalizedQuery)) {
    return 0.4;
  }

  // Fallback (matched on different language or fuzzy)
  return 0.2;
}
```

**Result ordering:**

1. Sort by score descending
2. Within same score, order by entity type priority: `vtm` > `vmp` > `amp` > `ampp` > `company` > `vmp_group`
3. Within same type and score, order alphabetically by localized name

### 4.2 Query Preprocessing

```typescript
function preprocessQuery(query: string): ProcessedQuery {
  const trimmed = query.trim();

  return {
    original: query,
    normalized: trimmed.toLowerCase(),

    // Detect special query types
    isCnkQuery: /^\d{7}$/.test(trimmed),
    isAtcQuery: /^[A-Z]\d{2}[A-Z]{0,2}\d{0,2}$/i.test(trimmed),
    isCodeQuery: /^[A-Z0-9-]+$/i.test(trimmed) && trimmed.length >= 3,

    // Split for multi-word matching
    tokens: trimmed.split(/\s+/).filter(t => t.length >= 2),
  };
}
```

### 4.3 Multi-word Query Handling

For queries with multiple words (e.g., "ibuprofen 400"):

1. **All words must match**: Each word must appear somewhere in the name or related fields
2. **Order-independent**: "400 ibuprofen" matches "Ibuprofen 400mg tablet"
3. **Scoring boost**: Higher score if words appear in order

```typescript
function multiWordScore(name: string, tokens: string[]): number {
  const nameLower = name.toLowerCase();

  // All tokens must be present
  const allPresent = tokens.every(token => nameLower.includes(token));
  if (!allPresent) return 0;

  // Check if tokens appear in order
  let lastIndex = -1;
  let inOrder = true;
  for (const token of tokens) {
    const index = nameLower.indexOf(token, lastIndex + 1);
    if (index <= lastIndex) {
      inOrder = false;
      break;
    }
    lastIndex = index;
  }

  return inOrder ? 0.7 : 0.5;
}
```

### 4.4 Typo Tolerance

For queries 4+ characters that return zero results:

1. Try PostgreSQL trigram similarity (`pg_trgm` extension)
2. Threshold: similarity > 0.3
3. Mark results as "fuzzy match" in UI

```sql
-- Fuzzy matching fallback
SELECT code, name, similarity(name->>'en', $1) as sim
FROM vtm
WHERE similarity(name->>'en', $1) > 0.3
   OR similarity(name->>'nl', $1) > 0.3
   OR similarity(name->>'fr', $1) > 0.3
ORDER BY GREATEST(
  similarity(name->>'en', $1),
  similarity(name->>'nl', $1),
  similarity(name->>'fr', $1)
) DESC
LIMIT 10;
```

### 4.5 Performance Considerations

**Targets:**
- Search response: < 200ms for typical queries
- First meaningful results: < 100ms (stream partial results if needed)

**Optimizations:**

1. **Query limits**: Each table query limited to 50 candidates
2. **Early termination**: If exact match found, skip fuzzy search
3. **Caching**: Cache common queries for 5 minutes (invalidate on data sync)
4. **Connection pooling**: Use Vercel Postgres connection pooling
5. **Parallel queries**: Execute all table searches concurrently

### 4.6 Search UX Flow

```
User types → Debounce 300ms → Preprocess query →
  → If < 2 chars: Show "Type at least 2 characters"
  → If ≥ 2 chars: Show loading state, fetch results
  → Results arrive: Update display, preserve scroll position
  → Type filters change: Re-filter locally if all results cached, else refetch
```

---

## 5. Results Display Specification

### 5.1 Search Results Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Search Results Header                                       │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 247 results for "ibuprofen"              [Type Filter ▼]│ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ Entity Type Filters (horizontal scrollable)                 │
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐     │
│ │All 247 │ │VTM (1) │ │VMP (12)│ │AMP (89)│ │AMPP(145)│     │
│ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘     │
│                                                             │
│ Results List                                                │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [VTM Badge] Ibuprofen                                   │ │
│ │ Active substance                                        │ │
│ │ 12 generic products • 89 brands                        ← │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [VMP Badge] Ibuprofen oral 400 mg                       │ │
│ │ Generic product • Substance: Ibuprofen                  │ │
│ │ 23 brands available                                    ← │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [AMP Badge] Nurofen 400 mg ⚠                           │ │
│ │ Brand • Generic: Ibuprofen oral 400mg                   │ │
│ │ Reckitt Benckiser • 3 packages                        ← │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ Pagination                                                  │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │  ← Previous    Page 1 of 13    Next →                   │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Entity Card Specifications

Each entity type has a distinct card design. All cards share a common structure:

```
┌────────────────────────────────────────────────────────────┐
│ [Type Badge]  Primary Name                    [Status Icon]│
│ Secondary descriptor line                                  │
│ Relationship/context line                              [→] │
└────────────────────────────────────────────────────────────┘
```

#### VTM Card (Substance)

```typescript
interface VTMCardProps {
  vtm: VTMSummary;
  vmpCount: number;
  ampCount: number;
  language: Language;
}
```

**Display:**
- **Badge:** Purple pill, "Substance"
- **Primary:** Localized name
- **Secondary:** "Active substance"
- **Context:** "{vmpCount} generic products • {ampCount} brands"

#### VMP Card (Generic Product)

```typescript
interface VMPCardProps {
  vmp: VMPSummary;
  vtmName: MultilingualText | null;
  ampCount: number;
  language: Language;
}
```

**Display:**
- **Badge:** Blue pill, "Generic"
- **Primary:** Localized name
- **Secondary:** "Generic product" + status badge if not AUTHORIZED
- **Context:** If vtmName: "Substance: {vtmName}" • "{ampCount} brands"

#### AMP Card (Brand)

```typescript
interface AMPCardProps {
  amp: AMPSummary;
  vmpName: MultilingualText | null;
  companyName: string | null;
  packageCount: number;
  language: Language;
}
```

**Display:**
- **Badge:** Green pill, "Brand"
- **Primary:** Localized name + ⚠ if blackTriangle
- **Secondary:** "Brand" + status badge if not AUTHORIZED
- **Context:** Line 1: "Generic: {vmpName}" (linked)
- **Context:** Line 2: "{companyName}" • "{packageCount} packages"

#### AMPP Card (Package)

```typescript
interface AMPPCardProps {
  ampp: AMPPSummary;
  ampName: MultilingualText;
  cnkCode: string | null;
  price: number | null;
  reimbursable: boolean;
  language: Language;
}
```

**Display:**
- **Badge:** Orange pill, "Package"
- **Primary:** Localized prescription name or "{ampName} - {packDisplayValue}"
- **Secondary:** "Package" + orphan badge if applicable
- **Context:** Line 1: "CNK: {cnkCode}" if available
- **Context:** Line 2: "€{price}" • Reimbursement badge (A/B/C) if reimbursable

#### Company Card

```typescript
interface CompanyCardProps {
  company: CompanySummary;
  productCount: number;
}
```

**Display:**
- **Badge:** Gray pill, "Company"
- **Primary:** denomination
- **Secondary:** "{city}, {countryCode}"
- **Context:** "{productCount} products"

#### VMP Group Card

```typescript
interface VMPGroupCardProps {
  vmpGroup: VMPGroupSummary;
  vmpCount: number;
  language: Language;
}
```

**Display:**
- **Badge:** Teal pill, "Therapeutic Group"
- **Primary:** Localized name
- **Secondary:** "Therapeutic classification"
- **Context:** "{vmpCount} generic products" + frailty indicator if applicable

#### ATC Card

```typescript
interface ATCCardProps {
  atc: ATCSummary;
  productCount: number;
}
```

**Display:**
- **Badge:** Indigo pill, "ATC"
- **Primary:** code + " - " + description
- **Secondary:** Full ATC hierarchy breadcrumb
- **Context:** "{productCount} products"

### 5.3 Type Badges

| Entity Type | Color | Label |
|-------------|-------|-------|
| vtm | Purple (#8B5CF6) | Substance |
| vmp | Blue (#3B82F6) | Generic |
| amp | Green (#10B981) | Brand |
| ampp | Orange (#F97316) | Package |
| company | Gray (#6B7280) | Company |
| vmp_group | Teal (#14B8A6) | Group |
| substance | Purple (#8B5CF6) | Substance |
| atc | Indigo (#6366F1) | ATC |

### 5.4 Status Indicators

| Status | Visual | Usage |
|--------|--------|-------|
| AUTHORIZED | None (default) | Active products |
| REVOKED | Red badge "Revoked" | No longer available |
| SUSPENDED | Yellow badge "Suspended" | Temporarily unavailable |
| Black Triangle | ⚠ icon | Enhanced monitoring |
| Orphan Drug | 🔷 badge | Rare disease |
| Reimbursable | ✓ with category | Insurance coverage |

### 5.5 Empty/Loading/Error States

**Empty State (no query):**
```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│           🔍 Search Belgium's Medication Database           │
│                                                             │
│     Find medications, substances, brands, and packages      │
│                                                             │
│   Examples: "ibuprofen", "3234567" (CNK), "Pfizer"         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Loading State:**
```
┌─────────────────────────────────────────────────────────────┐
│ Searching...                                                │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ████████████░░░░░░░░ (skeleton card)                    │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ████████████░░░░░░░░ (skeleton card)                    │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**No Results:**
```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│           No results found for "xyzabc123"                  │
│                                                             │
│   Try:                                                      │
│   • Check spelling                                          │
│   • Use fewer words                                         │
│   • Try a CNK code (7 digits)                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Error State:**
```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│           ⚠ Unable to load results                          │
│                                                             │
│   Please check your connection and try again.               │
│                                                             │
│   [Retry Search]                                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.6 Pagination

**Pattern:** Offset-based pagination with page numbers

**Display:**
- Show: Previous, numbered pages (max 5), Next
- Current page highlighted
- Disabled state for unavailable navigation

**URL State:**
- `/search?q=ibuprofen&page=2`
- `page` param controls offset (offset = (page - 1) * limit)

---

## 6. Detail View Specifications

### 6.1 Common Detail Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Breadcrumbs                                                 │
│ Home > [Parent if applicable] > Current Entity              │
├─────────────────────────────────────────────────────────────┤
│ Entity Header                                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [Type Badge]                              [Status Badge]│ │
│ │                                                         │ │
│ │ Entity Name (large, primary heading)                    │ │
│ │                                                         │ │
│ │ Code: XXXXX • Additional key info                       │ │
│ └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ Main Content (type-specific sections)                       │
│ ┌───────────────────────────────┬───────────────────────┐   │
│ │ Primary Information           │ Related Entities      │   │
│ │ (2/3 width on desktop)        │ (1/3 width, sticky)   │   │
│ │                               │                       │   │
│ │ [Section 1]                   │ Parent: Link          │   │
│ │ [Section 2]                   │ Children: Count, Link │   │
│ │ [Section 3]                   │ Related: Count, Link  │   │
│ │ ...                           │                       │   │
│ └───────────────────────────────┴───────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 VTM Detail (Substance)

**URL:** `/vtm/[code]`

**Header:**
- Badge: "Substance" (purple)
- Title: Localized name
- Subtitle: Code: {code}

**Sections:**

1. **Overview**
   - Validity period (if set)
   - All language variants of name (expandable)

2. **Generic Products** (Primary relationship)
   - List of VMPSummary cards
   - Count in header: "23 Generic Products"
   - Each card links to VMP detail
   - Show abbreviated name if different from full name

3. **Brand Products** (Secondary relationship)
   - Collapsed by default (can be many)
   - Count shown: "89 Brands"
   - Click to expand with paginated list
   - Each links to AMP detail

**Sidebar (Related Entities):**
- None (VTM is top of hierarchy)

---

### 6.3 VMP Detail (Generic Product)

**URL:** `/vmp/[code]`

**Header:**
- Badge: "Generic" (blue)
- Title: Localized name
- Subtitle: Code: {code} • Status: {status}

**Sections:**

1. **Overview**
   - Abbreviated name (if different)
   - Validity period
   - All language variants (expandable)

2. **Active Substance** (Link to VTM if vtmCode exists)
   - VTMSummary card with link

3. **Therapeutic Group** (Link to VMP Group if vmpGroupCode exists)
   - VMPGroupSummary card with link
   - Show patient frailty indicator if true

4. **Brand Products**
   - List of AMPSummary cards
   - Each shows company name, black triangle indicator
   - Links to AMP detail

5. **Dosage Recommendations** (if dosages exist)
   - Grouped by target group (Adult, Paediatric, etc.)
   - Each shows:
     - Indication name
     - Textual dosage
     - Treatment duration type
     - Expandable for full details (quantities, frequencies)

**Sidebar:**
- Parent: VTM link (if exists)
- Group: VMP Group link (if exists)
- Brands count with link to section

---

### 6.4 AMP Detail (Brand)

**URL:** `/amp/[code]`

**Header:**
- Badge: "Brand" (green)
- Title: Localized name + ⚠ if black triangle
- Subtitle: Code: {code} • {company denomination}

**Sections:**

1. **Overview**
   - Official name (if different from localized name)
   - Abbreviated name
   - Medicine type
   - Black triangle warning box (if applicable)
   - Validity period

2. **Generic Product** (Link to VMP)
   - VMPSummary card with link
   - Shows substance chain: VMP → VTM

3. **Manufacturer**
   - CompanySummary card with link
   - Full address if available

4. **Pharmaceutical Details**
   - For each component:
     - Pharmaceutical form (localized name)
     - Route of administration (localized name)

5. **Active Ingredients**
   - For each ingredient:
     - Substance name (linked if substance exists)
     - Strength description (e.g., "500 mg")
     - Type indicator

6. **Excipients** (Inactive Ingredients)
   - If amp_excipient exists:
     - Full text from SmPC (formatted)
     - Source URL links to SmPC documents
     - Parsed date
   - If not: "Excipient data not available"

7. **Packages Available**
   - List of AMPPSummary cards
   - Each shows:
     - Pack display value
     - Price (ex-factory)
     - CNK code (primary)
     - Reimbursement indicator
   - Links to AMPP detail

**Sidebar:**
- Generic: VMP link
- Substance: VTM link (via VMP)
- Company: Link with logo placeholder
- Packages count

---

### 6.5 AMPP Detail (Package)

**URL:** `/ampp/[ctiExtended]`

**Header:**
- Badge: "Package" (orange)
- Title: Prescription name or fallback
- Subtitle: CTI: {ctiExtended} • ATC: {atcCode}

**Sections:**

1. **Overview**
   - Pack display value
   - Authorisation number
   - Orphan drug indicator (if true)
   - Status
   - Validity period

2. **Brand Information**
   - AMPSummary card with link
   - Shows manufacturer

3. **ATC Classification** (if atcCode exists)
   - ATC code with description
   - Link to ATC detail page
   - Full hierarchy breadcrumb

4. **Pricing & CNK Codes**
   - Table/list of DMPPs:
     | CNK Code | Environment | Price | Status |
     | 1234567 | Public | €12.34 | Cheapest ✓ |
     | 1234568 | Hospital | €10.00 | |
   - Cheap/Cheapest indicators
   - Reimbursable indicator

5. **Reimbursement** (if contexts exist)
   - For each ReimbursementContext:
     - Category badge (A/B/C/Cs/Cx/Fa/Fb)
     - Reference price info
     - Flat rate indicator
     - **Copayments table:**
       | Regimen | Patient Fee | Reimbursement |
       | Preferential | €1.50 | €10.84 |
       | Regular | €4.00 | €8.34 |
     - Legal reference path (linked)

6. **Chapter IV Requirements** (if applicable)
   - List of ChapterIVParagraphSummary
   - Each shows:
     - Paragraph name
     - Key string (indication summary)
     - Link to full Chapter IV detail

7. **Documents**
   - Package leaflet links (per language)
   - SmPC links (per language)
   - Only show available languages

**Sidebar:**
- Brand: AMP link
- Generic: VMP link (via AMP)
- Substance: VTM link (via VMP)
- ATC: Classification link
- Reimbursement: Summary badge

---

### 6.6 Company Detail

**URL:** `/company/[actorNr]`

**Header:**
- Badge: "Company" (gray)
- Title: denomination
- Subtitle: {city}, {countryCode}

**Sections:**

1. **Contact Information**
   - Full address (formatted)
   - Phone number
   - VAT number (country + number)
   - Preferred language

2. **Legal Information**
   - Legal form
   - Validity period

3. **Products** (Primary content)
   - Paginated list of AMPSummary cards
   - Count header: "Showing 1-50 of 234 products"
   - Pagination controls
   - Each links to AMP detail

**Sidebar:**
- Products count
- Country flag (if available)

---

### 6.7 VMP Group Detail

**URL:** `/vmp-group/[code]`

**Header:**
- Badge: "Therapeutic Group" (teal)
- Title: Localized name
- Subtitle: Code: {code}

**Sections:**

1. **Overview**
   - Patient frailty indicator (highlighted warning if true)
   - No generic prescription reason (if set)
   - No switch reason (if set)
   - Validity period

2. **Member Products** (Generic products in this group)
   - List of VMPSummary cards
   - Each shows VTM link if available
   - Links to VMP detail

3. **Dosage Recommendations**
   - Full StandardDosage display for each:
     - **Target group** (header): Adult, Paediatric, etc.
     - **Indication** (if set)
     - **Dosage info:**
       - Textual dosage (primary display)
       - Quantity/range if numeric
       - Frequency and timeframe
       - Maximum daily quantity
     - **Duration:**
       - Treatment duration type
       - Duration value and unit if TEMPORARY
     - **Conditions:**
       - Kidney failure class (0-3)
       - Liver failure class (0-3)
     - **Parameter bounds** (age/weight restrictions):
       - Formatted as range (e.g., "Age: 12-18 years")
     - **Additional info:**
       - Route specification
       - Supplementary info
       - Temporality note
   - Collapsible sections for complex dosages

**Sidebar:**
- Member count
- Dosage count

---

### 6.8 ATC Classification Detail

**URL:** `/atc/[code]`

**Header:**
- Badge: "ATC" (indigo)
- Title: {code} - {description}
- Subtitle: Classification level indicator

**Sections:**

1. **Classification Hierarchy**
   - Breadcrumb showing full path:
     N → N02 → N02B → N02BE → N02BE01
   - Each level clickable

2. **Child Classifications** (if any)
   - List of ATCSummary cards
   - Links to child ATC pages

3. **Products with this Classification**
   - Paginated list of AMPPSummary cards
   - Shows price, CNK, reimbursement
   - Links to AMPP detail

**Sidebar:**
- Parent ATC link
- Children count
- Products count

---

### 6.9 Chapter IV Paragraph Detail

**URL:** `/chapter-iv/[chapterName]/[paragraphName]`

**Header:**
- Badge: "Chapter IV" (red)
- Title: Chapter {chapterName} - §{paragraphName}
- Subtitle: Key string (indication summary)

**Sections:**

1. **Overview**
   - Process type (authorization workflow)
   - Modification status
   - Paragraph version
   - Validity period

2. **Requirements & Conditions**
   - Hierarchical display of verses
   - Indented by verse level
   - Shows:
     - Verse text (localized)
     - Request type (New/Prolongation)
     - Agreement term (if applicable)
   - Collapsible for long legislation

3. **Covered Products**
   - List of DMPPSummary (CNK codes covered)
   - Each shows price, reimbursement status
   - Links to AMPP via DMPP lookup

**Sidebar:**
- Products count
- Legal reference link

---

### 6.10 Collapsible Sections

For dense information, use collapsible sections:

```typescript
interface CollapsibleSectionProps {
  title: string;
  count?: number;           // Show count badge if applicable
  defaultOpen?: boolean;    // Default expansion state
  children: React.ReactNode;
}
```

**Behavior:**
- Header always visible with title and count
- Chevron indicates expand/collapse state
- Click anywhere on header to toggle
- Smooth height animation (200ms)
- Keyboard accessible (Enter/Space to toggle)

---

## 7. Component Specifications

### 7.1 SearchBar

```typescript
interface SearchBarProps {
  defaultValue?: string;
  placeholder?: string;       // Default: "Search medications, substances, brands..."
  autoFocus?: boolean;        // Focus on mount
  size?: 'normal' | 'large';  // 'large' for hero
  onSearch: (query: string) => void;
}
```

**Behavior:**
- Debounce input by 300ms
- Minimum 2 characters to trigger search
- Show clear button when value present
- Submit on Enter
- Escape clears input
- Show loading spinner during search

**Keyboard shortcuts:**
- `/` focuses search bar (when not already focused)
- `Escape` clears and blurs

---

### 7.2 EntityCard

```typescript
interface EntityCardProps {
  entity: SearchResultItem | EntitySummary;
  variant?: 'default' | 'compact' | 'detailed';
  language: Language;
  onClick?: () => void;       // If not provided, renders as link
  href?: string;              // Link destination
  showRelationships?: boolean; // Show parent/child links
}
```

**Variants:**
- `default`: Standard card for search results
- `compact`: Smaller card for relationship lists
- `detailed`: Larger card with more info for featured display

---

### 7.3 EntityTypeBadge

```typescript
interface EntityTypeBadgeProps {
  type: EntityType;
  size?: 'sm' | 'md' | 'lg';
}
```

**Implementation:**
- Use color map from section 5.3
- Rounded pill shape
- Localized label based on UI language

---

### 7.4 Breadcrumbs

```typescript
interface BreadcrumbItem {
  label: string;
  href?: string;              // If not provided, not clickable
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}
```

**Behavior:**
- Home always first item
- Last item not linked (current page)
- Truncate middle items on mobile (show first, last, ellipsis)

---

### 7.5 RelationshipList

```typescript
interface RelationshipListProps {
  title: string;
  entities: EntitySummary[];
  entityType: EntityType;
  language: Language;
  maxInitialDisplay?: number;  // Default: 5
  totalCount?: number;         // For "Show all X" link
  onShowAll?: () => void;
}
```

**Behavior:**
- Show first N items
- "Show more" button if more exist
- Links to entity details

---

### 7.6 LanguageSelector

```typescript
interface LanguageSelectorProps {
  currentLanguage: Language;
  onChange: (lang: Language) => void;
}
```

**Display:**
- Dropdown with language names in their own language:
  - English
  - Nederlands
  - Français
  - Deutsch
- Show current language with flag emoji (optional)

---

### 7.7 PriceDisplay

```typescript
interface PriceDisplayProps {
  amount: number | null;
  currency?: string;          // Default: 'EUR'
  showNull?: boolean;         // Show "N/A" if null
  size?: 'sm' | 'md' | 'lg';
}
```

**Format:**
- €12.34 (euro symbol, 2 decimal places)
- "Price not available" if null and showNull is true

---

### 7.8 ReimbursementBadge

```typescript
interface ReimbursementBadgeProps {
  category: string | null;    // A, B, C, Cs, Cx, Fa, Fb
  showLabel?: boolean;        // Show full label vs just letter
}
```

**Display:**
- Color coded:
  - A: Green (100% reimbursed)
  - B: Blue (75%)
  - C: Yellow (50%)
  - Cs/Cx: Orange (special conditions)
  - Fa/Fb: Purple (lump-sum)
- Tooltip with full explanation

---

### 7.9 StatusBadge

```typescript
interface StatusBadgeProps {
  status: 'AUTHORIZED' | 'REVOKED' | 'SUSPENDED' | string;
}
```

**Display:**
- AUTHORIZED: No badge (default state)
- REVOKED: Red badge
- SUSPENDED: Yellow badge

---

### 7.10 DocumentLinks

```typescript
interface DocumentLinksProps {
  leafletUrls: MultilingualText | null;
  spcUrls: MultilingualText | null;
  language: Language;
}
```

**Display:**
- Show available document types
- Each language variant as separate link
- Icons for PDF documents
- External link indicator

---

### 7.11 CollapsibleSection

```typescript
interface CollapsibleSectionProps {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}
```

**Behavior:**
- As specified in section 6.10

---

### 7.12 Pagination

```typescript
interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  siblingCount?: number;      // Pages shown around current (default: 1)
}
```

**Display:**
- Previous/Next buttons
- Page numbers with ellipsis for gaps
- Current page highlighted
- Disabled states for bounds

---

### 7.13 LoadingSkeleton

```typescript
interface LoadingSkeletonProps {
  variant: 'card' | 'detail' | 'list';
  count?: number;             // For list variant
}
```

**Variants:**
- `card`: Single entity card skeleton
- `detail`: Full detail page skeleton
- `list`: Multiple card skeletons

---

### 7.14 EmptyState

```typescript
interface EmptyStateProps {
  variant: 'no-query' | 'no-results' | 'error';
  query?: string;
  onRetry?: () => void;
}
```

**Content defined in section 5.5**

---

## 8. Navigation & State Management

### 8.1 Navigation Patterns

**Search → Detail:**
1. User clicks entity card in search results
2. Navigate to `/[type]/[code]`
3. Breadcrumb shows: Home > [Search: "query"] > Entity Name
4. Back button returns to search results (preserved state)

**Detail → Related Entity:**
1. User clicks related entity link
2. Navigate to new detail page
3. Breadcrumb extends: Home > Previous > Current
4. Back button returns to previous detail

**Context Preservation:**
- Search query preserved in URL: `/search?q=ibuprofen`
- Scroll position restored on back navigation
- Type filters preserved: `/search?q=ibuprofen&types=amp,ampp`

### 8.2 URL Structure

| Route | Parameters | Query Params |
|-------|------------|--------------|
| `/` | - | - |
| `/search` | - | `q`, `types`, `page`, `lang` |
| `/vtm/[code]` | code | `lang` |
| `/vmp/[code]` | code | `lang` |
| `/amp/[code]` | code | `lang` |
| `/ampp/[ctiExtended]` | ctiExtended | `lang` |
| `/company/[actorNr]` | actorNr | `lang`, `page` |
| `/vmp-group/[code]` | code | `lang` |
| `/atc/[code]` | code | `lang`, `page` |
| `/chapter-iv/[chapter]/[paragraph]` | chapter, paragraph | `lang` |

### 8.3 State Management

**Server State (React Server Components):**
- Entity detail data: Fetched on page load via RSC
- Search results: Fetched via API route (needs client interactivity)

**Client State:**
- Language preference: React Context + localStorage
- Search input: Component state with URL sync
- Expanded sections: Component state (ephemeral)
- Pagination: URL state

**Language Context:**

```typescript
interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;  // UI translations
  getLocalized: (text: MultilingualText | null) => string;
}
```

**Persistence:**
- Language stored in localStorage
- Read on app initialization
- Default: browser language or 'en'

### 8.4 Data Fetching Patterns

**Search Page (Client Component):**
```typescript
// Uses SWR or React Query for caching
const { data, error, isLoading } = useSWR(
  query.length >= 2 ? `/api/search?q=${query}&types=${types}&page=${page}` : null,
  fetcher
);
```

**Detail Pages (Server Component):**
```typescript
// Direct database access via repository
export default async function VTMDetailPage({ params }: { params: { code: string } }) {
  const vtm = await vtmRepository.getWithRelations(params.code);
  if (!vtm) notFound();
  return <VTMDetail vtm={vtm} />;
}
```

**Relationship Loading:**
- Initial load includes primary relationships
- Large relationship lists loaded on demand (e.g., all products for company)

---

## 9. Internationalization

### 9.1 UI Translation

**Approach:** JSON translation files per language

```
src/
  locales/
    en.json
    nl.json
    fr.json
    de.json
```

**Structure:**
```json
{
  "search": {
    "placeholder": "Search medications, substances, brands...",
    "results": "{count} results for \"{query}\"",
    "noResults": "No results found",
    "minChars": "Type at least 2 characters"
  },
  "entities": {
    "vtm": "Substance",
    "vmp": "Generic",
    "amp": "Brand",
    "ampp": "Package",
    "company": "Company",
    "vmpGroup": "Therapeutic Group"
  },
  "detail": {
    "overview": "Overview",
    "ingredients": "Active Ingredients",
    "excipients": "Inactive Ingredients",
    "packages": "Available Packages",
    "dosage": "Dosage Recommendations"
  },
  "reimbursement": {
    "categoryA": "100% reimbursed",
    "categoryB": "75% reimbursed",
    "categoryC": "50% reimbursed"
  }
}
```

### 9.2 Database Content Localization

**Function:**
```typescript
function getLocalizedText(
  text: MultilingualText | null | undefined,
  lang: Language
): string {
  if (!text) return '';

  // Try requested language first
  if (text[lang]) return text[lang];

  // Fallback chain: en → nl → fr → de → first available
  const fallbackOrder: Language[] = ['en', 'nl', 'fr', 'de'];
  for (const fallback of fallbackOrder) {
    if (text[fallback]) return text[fallback];
  }

  // Last resort: first available value
  const firstValue = Object.values(text).find(v => v);
  return firstValue || '';
}
```

### 9.3 Language Detection

**Priority:**
1. URL parameter (`?lang=nl`)
2. Stored preference (localStorage)
3. Browser Accept-Language header
4. Default: 'en'

**Implementation:**
```typescript
function detectLanguage(request: Request): Language {
  // 1. URL param
  const url = new URL(request.url);
  const urlLang = url.searchParams.get('lang');
  if (isValidLanguage(urlLang)) return urlLang;

  // 2. Cookie (set from localStorage on client)
  const cookieLang = getCookie(request, 'language');
  if (isValidLanguage(cookieLang)) return cookieLang;

  // 3. Accept-Language
  const acceptLang = request.headers.get('Accept-Language');
  const parsed = parseAcceptLanguage(acceptLang);
  for (const { lang } of parsed) {
    const short = lang.split('-')[0];
    if (isValidLanguage(short)) return short as Language;
  }

  return 'en';
}
```

---

## 10. Production Requirements

### 10.1 Performance

**Targets:**
| Metric | Target |
|--------|--------|
| Search response | < 200ms (p95) |
| Detail page TTFB | < 100ms |
| Largest Contentful Paint | < 2.5s |
| First Input Delay | < 100ms |
| Cumulative Layout Shift | < 0.1 |

**Strategies:**

1. **Database:**
   - Use existing GIN indexes for text search
   - Connection pooling via Vercel Postgres
   - Query result caching (5 minute TTL for search)

2. **Frontend:**
   - React Server Components for static content
   - Streaming for large lists
   - Image optimization (company logos if added)
   - Code splitting per route

3. **Caching:**
   - CDN caching for static assets
   - SWR/React Query for client-side caching
   - stale-while-revalidate for search results

### 10.2 Accessibility

**WCAG 2.1 AA Compliance:**

1. **Keyboard Navigation:**
   - All interactive elements focusable
   - Logical tab order
   - Skip links for main content
   - `/` shortcut for search focus

2. **Screen Readers:**
   - Semantic HTML (headings, landmarks)
   - ARIA labels for icons
   - Live regions for search results
   - Descriptive link text

3. **Visual:**
   - Color contrast ratio ≥ 4.5:1
   - Focus indicators visible
   - No information conveyed by color alone
   - Resizable text (up to 200%)

4. **ARIA Patterns:**
   - Collapsible: `aria-expanded`, `aria-controls`
   - Tabs (if used): `role="tablist"`, `aria-selected`
   - Loading: `aria-busy="true"`, `aria-live="polite"`
   - Pagination: `aria-current="page"`

### 10.3 Error Handling

**Network Errors:**
```typescript
interface ErrorBoundaryProps {
  fallback: React.ReactNode;
  onError?: (error: Error) => void;
}
```

- Show user-friendly message
- Retry button where applicable
- Log to monitoring service

**Empty States:**
- Distinguish between "no results" and "error"
- Provide actionable suggestions

**Validation Errors:**
- Inline error messages
- Focus management to error

### 10.4 Loading States

**Skeleton Patterns:**

1. **Search Results:**
   - Show skeleton cards immediately
   - Fade in results as they arrive
   - Preserve scroll position

2. **Detail Pages:**
   - Header skeleton with type badge
   - Section skeletons matching layout
   - Relationships load independently

3. **Transitions:**
   - Minimum skeleton display: 200ms (prevent flash)
   - Fade transition: 150ms

### 10.5 Responsive Design

**Breakpoints:**
| Name | Width | Adjustments |
|------|-------|-------------|
| Mobile | < 640px | Single column, stacked cards |
| Tablet | 640-1024px | 2 columns for results |
| Desktop | > 1024px | Sidebar layout for details |

**Mobile Adaptations:**
- Hamburger menu for navigation
- Search bar in header (collapsed on scroll)
- Cards stack vertically
- Collapsible sections default closed
- Pagination simplified (prev/next only)
- Touch targets ≥ 44px

**Desktop Enhancements:**
- Sticky sidebar for relationships
- Keyboard shortcuts visible
- Hover states for cards
- Multi-column layouts

### 10.6 SEO

**Meta Tags:**
```typescript
export function generateMetadata({ params }: Props): Metadata {
  return {
    title: `${entityName} - MedSearch`,
    description: `Details about ${entityName}, a ${entityType} in Belgium's medication database.`,
    openGraph: {
      title: entityName,
      description: description,
      type: 'website',
    },
  };
}
```

**Structured Data (JSON-LD):**
```json
{
  "@context": "https://schema.org",
  "@type": "Drug",
  "name": "Nurofen 400mg",
  "activeIngredient": "Ibuprofen",
  "manufacturer": {
    "@type": "Organization",
    "name": "Reckitt Benckiser"
  }
}
```

**URL Structure:**
- Clean, readable URLs
- Entity type in path for clarity
- Codes used as identifiers (stable)

**Sitemap:**
- Generate for high-traffic entities
- Prioritize substances and common brands
- Update frequency: weekly

---

## 11. Implementation Notes

### 11.1 Recommended Implementation Order

**Phase 1: Foundation**
1. TypeScript types for all entities (`src/server/types/`)
2. Database query functions (`src/server/queries/`)
3. Language context and utilities
4. Base layout with header/footer

**Phase 2: Search**
1. Search API endpoint
2. SearchBar component
3. Search results page
4. EntityCard component (all variants)
5. Pagination component

**Phase 3: Detail Views (Priority Order)**
1. AMP detail (most commonly accessed)
2. AMPP detail (includes pricing/reimbursement)
3. VMP detail
4. VTM detail
5. Company detail
6. VMP Group detail
7. ATC detail
8. Chapter IV detail

**Phase 4: Polish**
1. Loading skeletons
2. Error boundaries
3. Empty states
4. Accessibility audit
5. Performance optimization
6. SEO implementation

### 11.2 Key Technical Decisions

1. **React Server Components for details:**
   - Detail pages are mostly static
   - RSC provides better performance
   - Only interactive parts need client components

2. **Client component for search:**
   - Requires real-time updates
   - Debouncing, loading states
   - Type filters are interactive

3. **SWR for search caching:**
   - Automatic cache invalidation
   - Optimistic UI updates
   - Built-in error handling

4. **URL-based state:**
   - Shareable search links
   - Back button works correctly
   - SEO-friendly

5. **GIN indexes for search:**
   - Already exist in schema
   - Support multilingual JSONB search
   - Add trigram extension for fuzzy matching

### 11.3 Potential Challenges

**1. Large Result Sets**
- Some searches may return thousands of results
- **Mitigation:** Strict limits, type filtering, pagination
- Consider virtual scrolling for very long lists

**2. Complex Relationship Graphs**
- Some entities have many relationships
- **Mitigation:** Lazy loading, pagination within sections
- Collapse secondary relationships by default

**3. Multilingual Content Gaps**
- Some content only available in certain languages
- **Mitigation:** Clear fallback chain, show original language indicator

**4. Reimbursement Complexity**
- Many edge cases in reimbursement rules
- **Mitigation:** Display raw data clearly, link to official sources
- Consider tooltips for complex terms

**5. Search Performance**
- Full-text search across multiple tables
- **Mitigation:** Query limits, early termination, caching
- Monitor slow queries, add indexes as needed

### 11.4 File Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout with providers
│   ├── page.tsx                # Home/search hero
│   ├── search/
│   │   └── page.tsx            # Search results
│   ├── vtm/
│   │   └── [code]/
│   │       └── page.tsx        # VTM detail
│   ├── vmp/
│   │   └── [code]/
│   │       └── page.tsx        # VMP detail
│   ├── amp/
│   │   └── [code]/
│   │       └── page.tsx        # AMP detail
│   ├── ampp/
│   │   └── [ctiExtended]/
│   │       └── page.tsx        # AMPP detail
│   ├── company/
│   │   └── [actorNr]/
│   │       └── page.tsx        # Company detail
│   ├── vmp-group/
│   │   └── [code]/
│   │       └── page.tsx        # VMP Group detail
│   ├── atc/
│   │   └── [code]/
│   │       └── page.tsx        # ATC detail
│   ├── chapter-iv/
│   │   └── [chapter]/
│   │       └── [paragraph]/
│   │           └── page.tsx    # Chapter IV detail
│   └── api/
│       ├── search/
│       │   └── route.ts        # Search endpoint
│       └── entities/
│           └── [type]/
│               └── [id]/
│                   └── route.ts # Entity detail endpoint
├── components/
│   ├── ui/                     # Base UI components
│   │   ├── badge.tsx
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── input.tsx
│   │   ├── skeleton.tsx
│   │   └── ...
│   ├── search/
│   │   ├── search-bar.tsx
│   │   ├── search-results.tsx
│   │   ├── entity-type-filter.tsx
│   │   └── pagination.tsx
│   ├── entities/
│   │   ├── entity-card.tsx
│   │   ├── entity-header.tsx
│   │   ├── entity-type-badge.tsx
│   │   └── relationship-list.tsx
│   ├── detail/
│   │   ├── vtm-detail.tsx
│   │   ├── vmp-detail.tsx
│   │   ├── amp-detail.tsx
│   │   ├── ampp-detail.tsx
│   │   ├── company-detail.tsx
│   │   ├── vmp-group-detail.tsx
│   │   ├── atc-detail.tsx
│   │   └── chapter-iv-detail.tsx
│   ├── layout/
│   │   ├── header.tsx
│   │   ├── breadcrumbs.tsx
│   │   ├── language-selector.tsx
│   │   └── footer.tsx
│   └── shared/
│       ├── collapsible-section.tsx
│       ├── price-display.tsx
│       ├── reimbursement-badge.tsx
│       ├── status-badge.tsx
│       ├── document-links.tsx
│       ├── loading-skeleton.tsx
│       └── empty-state.tsx
├── server/
│   ├── db/
│   │   ├── client.ts           # Existing
│   │   └── schema.sql          # Existing
│   ├── types/
│   │   ├── domain.ts
│   │   ├── entities.ts
│   │   ├── summaries.ts
│   │   └── api.ts
│   ├── queries/
│   │   ├── search.ts
│   │   ├── vtm.ts
│   │   ├── vmp.ts
│   │   ├── amp.ts
│   │   ├── ampp.ts
│   │   ├── company.ts
│   │   ├── vmp-group.ts
│   │   ├── atc.ts
│   │   └── chapter-iv.ts
│   └── utils/
│       ├── localization.ts
│       └── validation.ts
├── lib/
│   ├── hooks/
│   │   ├── use-language.ts
│   │   ├── use-search.ts
│   │   └── use-debounce.ts
│   └── utils/
│       ├── cn.ts               # Class name utility
│       └── format.ts           # Price, date formatting
└── locales/
    ├── en.json
    ├── nl.json
    ├── fr.json
    └── de.json
```

---

## 12. Appendix: Database Field Reference

### Mapping Schema Fields to UI

This section ensures every database field is accounted for in the specification.

#### VTM Table
| Field | UI Display | Location |
|-------|------------|----------|
| code | "Code: {code}" | Detail header subtitle |
| name | Primary heading | Detail header, cards |
| start_date | "Valid from: {date}" | Overview section |
| end_date | "Valid until: {date}" | Overview section, status |

#### VMP Table
| Field | UI Display | Location |
|-------|------------|----------|
| code | "Code: {code}" | Header subtitle |
| name | Primary heading | Header, cards |
| abbreviated_name | "Also known as: {name}" | Overview |
| vtm_code | Link to VTM | Parent relationship |
| vmp_group_code | Link to VMP Group | Therapeutic group section |
| status | Status badge | Header, cards |
| start_date, end_date | Validity info | Overview |

#### AMP Table
| Field | UI Display | Location |
|-------|------------|----------|
| code | "Code: {code}" | Header subtitle |
| name | Primary heading | Header, cards |
| abbreviated_name | "Also known as" | Overview |
| official_name | "Official name" | Overview (if different) |
| vmp_code | Link to VMP | Generic product section |
| company_actor_nr | Link to Company | Manufacturer section |
| black_triangle | ⚠ icon + warning box | Header, cards, overview |
| medicine_type | Badge/label | Overview |
| status | Status badge | Header |
| start_date, end_date | Validity | Overview |

#### AMP Component Table
| Field | UI Display | Location |
|-------|------------|----------|
| sequence_nr | Component order | Pharmaceutical details |
| pharmaceutical_form_code | Form name lookup | Pharmaceutical details |
| route_of_administration_code | Route name lookup | Pharmaceutical details |

#### AMP Ingredient Table
| Field | UI Display | Location |
|-------|------------|----------|
| component_sequence_nr | Grouped by component | Ingredients section |
| rank | Order within component | Ingredients list |
| type | "Active" / "Excipient" badge | Ingredients list |
| substance_code | Link to Substance | Ingredient name |
| strength_description | e.g., "500 mg" | After ingredient name |

#### AMP Excipient Table
| Field | UI Display | Location |
|-------|------------|----------|
| text | Full excipient text | Excipients section |
| source_urls | "Source: {url}" links | Excipients section |
| parsed_at | "Last updated: {date}" | Excipients footer |

#### AMPP Table
| Field | UI Display | Location |
|-------|------------|----------|
| cti_extended | "CTI: {code}" | Header subtitle |
| amp_code | Link to AMP | Brand section |
| prescription_name | Primary name | Header, cards |
| authorisation_nr | "Auth Nr: {nr}" | Overview |
| orphan | "Orphan Drug" badge | Header, cards |
| leaflet_url | Document links | Documents section |
| spc_url | Document links | Documents section |
| pack_display_value | Package description | Cards, overview |
| status | Status badge | Header |
| ex_factory_price | "€{price}" | Cards, pricing section |
| atc_code | ATC link | Classification section |
| start_date, end_date | Validity | Overview |

#### DMPP Table
| Field | UI Display | Location |
|-------|------------|----------|
| code | CNK code display | Pricing table |
| delivery_environment | "Public" / "Hospital" | Pricing table |
| price | "€{price}" | Pricing table |
| cheap | "Cheap" badge | Pricing table |
| cheapest | "Cheapest ✓" badge | Pricing table |
| reimbursable | "Reimbursable" indicator | Cards, pricing |
| start_date, end_date | Validity | Pricing table |

#### Company Table
| Field | UI Display | Location |
|-------|------------|----------|
| actor_nr | Internal ID | Not displayed |
| denomination | Primary heading | Header, cards |
| legal_form | "Legal form: {form}" | Legal info section |
| vat_country_code + vat_number | "VAT: {country}{number}" | Legal info |
| street_name, street_num, postbox | Address line 1 | Contact section |
| postcode, city | Address line 2 | Contact section |
| country_code | Country name | Contact section |
| phone | Phone link | Contact section |
| language | Preferred language | Legal info |
| start_date, end_date | Validity | Legal info |

#### VMP Group Table
| Field | UI Display | Location |
|-------|------------|----------|
| code | "Code: {code}" | Header subtitle |
| name | Primary heading | Header, cards |
| no_generic_prescription_reason | Warning box | Overview |
| no_switch_reason | Warning box | Overview |
| patient_frailty_indicator | ⚠ "Frailty warning" | Header, cards, overview |
| start_date, end_date | Validity | Overview |

#### Standard Dosage Table
| Field | UI Display | Location |
|-------|------------|----------|
| code | Internal reference | Not displayed |
| vmp_group_code | Group context | (implicit via group) |
| target_group | Section header | Dosage grouping |
| kidney_failure_class | "Kidney function: {class}" | Conditions |
| liver_failure_class | "Liver function: {class}" | Conditions |
| treatment_duration_type | Duration badge | Dosage info |
| temporality_duration_value/unit | "{value} {unit}" | Duration |
| temporality_user_provided | "User-defined duration" | Duration |
| temporality_note | Additional duration info | Duration |
| quantity, quantity_denominator | Formatted quantity | Dosage |
| quantity_range_lower/upper | "{lower}-{upper}" | Dosage |
| administration_frequency_* | "{qty} times per {period}" | Frequency |
| maximum_administration_quantity | "Max: {qty} per dose" | Limits |
| maximum_daily_quantity_* | "Max daily: {qty}" | Limits |
| textual_dosage | Primary dosage display | Main dosage text |
| supplementary_info | Additional notes | Below dosage |
| route_specification | Route details | Below dosage |
| indication_code, indication_name | Indication display | Dosage header |
| route_of_administration_code | Route lookup | Dosage header |

#### Chapter IV Tables
| Field | UI Display | Location |
|-------|------------|----------|
| chapter_name + paragraph_name | "Chapter {ch} - §{para}" | Header |
| key_string | Indication summary | Header subtitle |
| process_type | "Process: {type}" | Overview |
| verses.text | Hierarchical legislation | Requirements section |
| verses.request_type | "New" / "Prolongation" | Verse display |
| verses.agreement_term_* | "Valid for: {term}" | Verse display |

#### Reimbursement Context Table
| Field | UI Display | Location |
|-------|------------|----------|
| reimbursement_criterion_category | Category badge (A/B/C) | Reimbursement section |
| flat_rate_system | "Flat rate" indicator | Reimbursement section |
| reference_price | "Reference pricing" indicator | Reimbursement section |
| temporary | "Temporary" badge | Reimbursement section |
| reference_base_price | "Ref. price: €{amount}" | Pricing details |
| reimbursement_base_price | "Base: €{amount}" | Pricing details |
| pricing_unit_quantity/label | Unit info | Pricing details |
| copayments.fee_amount | "Patient pays: €{amount}" | Copayment table |
| copayments.reimbursement_amount | "Insurance pays: €{amount}" | Copayment table |

---

## 13. Completion Verification

### Search
- [x] Search algorithm fully specified (parallel queries, scoring, ranking)
- [x] Result ranking/ordering logic defined (score-based with type priority)
- [x] Partial matches, typos, multi-word queries addressed
- [x] Performance approach specified (limits, caching, parallel queries)

### Results Display
- [x] Every searchable entity type has defined card format
- [x] Visual differentiation via color-coded badges
- [x] Relationship indicators designed (parent links, counts)
- [x] Empty, loading, and error states defined

### Detail Views
- [x] VTM detail complete
- [x] VMP detail complete
- [x] AMP detail complete
- [x] AMPP detail complete
- [x] Company detail complete
- [x] VMP Group detail complete
- [x] ATC Classification detail complete
- [x] Chapter IV detail complete
- [x] All database fields accounted for (Appendix)
- [x] All relationships listed with navigation

### API
- [x] Search endpoint with request/response types
- [x] All entity detail endpoints specified
- [x] Query parameters enumerated
- [x] Pagination consistent
- [x] Error responses defined

### Components
- [x] All components have typed props
- [x] Reusable patterns identified
- [x] Interactive behaviors explicit

### Navigation
- [x] Search → detail flow clear
- [x] Detail → related entity flow clear
- [x] Back navigation specified
- [x] URL structure supports deep linking

---

*End of Specification*
