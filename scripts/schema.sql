-- SAM Database Schema (Denormalized)
-- This schema mirrors the SAM v2 XML export structure for efficient bulk imports.
-- Multilingual text is stored as JSONB: {"nl": "...", "fr": "...", "en": "...", "de": "..."}
--
-- Design principles:
-- 1. Uses natural keys from XML (codes) instead of auto-generated IDs where practical
-- 2. Enables direct bulk inserts without tracking generated IDs
-- 3. Optimized for search application queries

-- ============================================================================
-- Extensions
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- VTM (Virtual Therapeutic Moiety) - Active substances
-- ============================================================================
CREATE TABLE IF NOT EXISTS vtm (
  code VARCHAR(20) PRIMARY KEY,
  name JSONB NOT NULL,  -- Multilingual
  start_date DATE,
  end_date DATE,
  sync_id INTEGER  -- For mark-and-sweep sync pattern
);

CREATE INDEX IF NOT EXISTS idx_vtm_name ON vtm USING GIN (name);
CREATE INDEX IF NOT EXISTS idx_vtm_validity ON vtm (start_date, end_date);

-- ============================================================================
-- VMP Group - Groups therapeutically equivalent VMPs
-- ============================================================================
CREATE TABLE IF NOT EXISTS vmp_group (
  code VARCHAR(20) PRIMARY KEY,
  name JSONB NOT NULL,  -- Multilingual
  no_generic_prescription_reason VARCHAR(100),
  no_switch_reason VARCHAR(100),
  patient_frailty_indicator BOOLEAN DEFAULT FALSE,
  start_date DATE,
  end_date DATE,
  sync_id INTEGER  -- For mark-and-sweep sync pattern
);

CREATE INDEX IF NOT EXISTS idx_vmp_group_name ON vmp_group USING GIN (name);

-- ============================================================================
-- VMP (Virtual Medicinal Product) - Generic products
-- ============================================================================
CREATE TABLE IF NOT EXISTS vmp (
  code VARCHAR(20) PRIMARY KEY,
  name JSONB NOT NULL,  -- Multilingual
  abbreviated_name JSONB,  -- Multilingual
  vtm_code VARCHAR(20) REFERENCES vtm(code),
  vmp_group_code VARCHAR(20) REFERENCES vmp_group(code),
  status VARCHAR(20) DEFAULT 'AUTHORIZED',
  start_date DATE,
  end_date DATE,
  sync_id INTEGER  -- For mark-and-sweep sync pattern
);

CREATE INDEX IF NOT EXISTS idx_vmp_name ON vmp USING GIN (name);
CREATE INDEX IF NOT EXISTS idx_vmp_vtm ON vmp (vtm_code);
CREATE INDEX IF NOT EXISTS idx_vmp_group ON vmp (vmp_group_code);
CREATE INDEX IF NOT EXISTS idx_vmp_validity ON vmp (start_date, end_date);

-- ============================================================================
-- Substance - Active substances (referenced by ingredients)
-- ============================================================================
CREATE TABLE IF NOT EXISTS substance (
  code VARCHAR(20) PRIMARY KEY,
  name JSONB NOT NULL,  -- Multilingual
  start_date DATE,
  end_date DATE,
  sync_id INTEGER  -- For mark-and-sweep sync pattern
);

CREATE INDEX IF NOT EXISTS idx_substance_name ON substance USING GIN (name);

-- ============================================================================
-- Company - Pharmaceutical manufacturers
-- ============================================================================
CREATE TABLE IF NOT EXISTS company (
  actor_nr VARCHAR(10) PRIMARY KEY,  -- 5-digit zero-padded
  denomination VARCHAR(255) NOT NULL,
  legal_form VARCHAR(50),
  vat_country_code VARCHAR(3),
  vat_number VARCHAR(50),
  street_name VARCHAR(255),
  street_num VARCHAR(50),
  postbox VARCHAR(50),
  postcode VARCHAR(50),
  city VARCHAR(100),
  country_code VARCHAR(3),
  phone VARCHAR(50),
  language VARCHAR(10),
  start_date DATE,
  end_date DATE,
  sync_id INTEGER  -- For mark-and-sweep sync pattern
);

CREATE INDEX IF NOT EXISTS idx_company_name ON company (denomination);

-- ============================================================================
-- Pharmaceutical Form - Drug delivery forms
-- ============================================================================
CREATE TABLE IF NOT EXISTS pharmaceutical_form (
  code VARCHAR(20) PRIMARY KEY,
  name JSONB NOT NULL,  -- Multilingual
  sync_id INTEGER  -- For mark-and-sweep sync pattern
);

-- ============================================================================
-- Route of Administration
-- ============================================================================
CREATE TABLE IF NOT EXISTS route_of_administration (
  code VARCHAR(20) PRIMARY KEY,
  name JSONB NOT NULL,  -- Multilingual
  sync_id INTEGER  -- For mark-and-sweep sync pattern
);

-- ============================================================================
-- ATC Classification - Anatomical Therapeutic Chemical codes
-- ============================================================================
CREATE TABLE IF NOT EXISTS atc_classification (
  code VARCHAR(20) PRIMARY KEY,
  description VARCHAR(500) NOT NULL,
  sync_id INTEGER  -- For mark-and-sweep sync pattern
);

CREATE INDEX IF NOT EXISTS idx_atc_description ON atc_classification (description);

-- ============================================================================
-- AMP (Actual Medicinal Product) - Branded products
-- ============================================================================
CREATE TABLE IF NOT EXISTS amp (
  code VARCHAR(50) PRIMARY KEY,  -- e.g., SAM123456-01
  name JSONB NOT NULL,  -- Multilingual
  abbreviated_name JSONB,  -- Multilingual
  official_name VARCHAR(500),
  vmp_code VARCHAR(20) REFERENCES vmp(code),
  company_actor_nr VARCHAR(10),  -- No FK - company table may not be populated
  black_triangle BOOLEAN DEFAULT FALSE,
  medicine_type VARCHAR(50),
  status VARCHAR(20) DEFAULT 'AUTHORIZED',
  start_date DATE,
  end_date DATE,
  sync_id INTEGER  -- For mark-and-sweep sync pattern
);

CREATE INDEX IF NOT EXISTS idx_amp_name ON amp USING GIN (name);
CREATE INDEX IF NOT EXISTS idx_amp_vmp ON amp (vmp_code);
CREATE INDEX IF NOT EXISTS idx_amp_company ON amp (company_actor_nr);
CREATE INDEX IF NOT EXISTS idx_amp_validity ON amp (start_date, end_date);

-- ============================================================================
-- AMP Component - Components with form/route (denormalized)
-- Uses natural key: amp_code + sequence_nr
-- ============================================================================
CREATE TABLE IF NOT EXISTS amp_component (
  amp_code VARCHAR(50) NOT NULL REFERENCES amp(code) ON DELETE CASCADE,
  sequence_nr INTEGER NOT NULL,
  pharmaceutical_form_code VARCHAR(20),  -- No FK - reference table may not exist
  route_of_administration_code VARCHAR(20),  -- No FK - reference table may not exist
  sync_id INTEGER,  -- For mark-and-sweep sync pattern
  PRIMARY KEY (amp_code, sequence_nr)
);

CREATE INDEX IF NOT EXISTS idx_amp_component_amp ON amp_component (amp_code);

-- ============================================================================
-- AMP Ingredient - Real actual ingredients (denormalized)
-- Uses natural key: amp_code + component_sequence_nr + rank
-- ============================================================================
CREATE TABLE IF NOT EXISTS amp_ingredient (
  amp_code VARCHAR(50) NOT NULL,
  component_sequence_nr INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  type VARCHAR(50) DEFAULT 'ACTIVE_SUBSTANCE',
  substance_code VARCHAR(20),  -- No FK - substance table may not be populated
  strength_value DECIMAL(15, 4),  -- Numeric strength value from <Strength> element
  strength_unit VARCHAR(50),  -- Unit from <Strength unit="..."> attribute (e.g., "mg", "mg/mL", "%")
  strength_description VARCHAR(255),  -- Fallback text for complex cases, e.g., "EQUAL 12.0000 mg/ 6.0000 mL"
  sync_id INTEGER,  -- For mark-and-sweep sync pattern
  PRIMARY KEY (amp_code, component_sequence_nr, rank),
  FOREIGN KEY (amp_code, component_sequence_nr) REFERENCES amp_component(amp_code, sequence_nr) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_amp_ingredient_amp ON amp_ingredient (amp_code);
CREATE INDEX IF NOT EXISTS idx_amp_ingredient_substance ON amp_ingredient (substance_code);

-- ============================================================================
-- AMPP (Actual Medicinal Product Package) - Package presentations
-- ============================================================================
CREATE TABLE IF NOT EXISTS ampp (
  cti_extended VARCHAR(50) PRIMARY KEY,
  amp_code VARCHAR(50) NOT NULL REFERENCES amp(code) ON DELETE CASCADE,
  prescription_name JSONB,  -- Multilingual
  authorisation_nr VARCHAR(50),
  orphan BOOLEAN DEFAULT FALSE,
  leaflet_url JSONB,  -- Multilingual URLs
  spc_url JSONB,  -- Multilingual URLs
  pack_display_value VARCHAR(500),
  status VARCHAR(20),
  ex_factory_price DECIMAL(10, 4),
  atc_code VARCHAR(20),
  start_date DATE,
  end_date DATE,
  sync_id INTEGER  -- For mark-and-sweep sync pattern
);

CREATE INDEX IF NOT EXISTS idx_ampp_amp ON ampp (amp_code);
CREATE INDEX IF NOT EXISTS idx_ampp_atc ON ampp (atc_code);
CREATE INDEX IF NOT EXISTS idx_ampp_validity ON ampp (start_date, end_date);

-- ============================================================================
-- DMPP - CNK codes with pricing (denormalized)
-- Uses natural key: code + delivery_environment
-- ============================================================================
CREATE TABLE IF NOT EXISTS dmpp (
  code VARCHAR(20) NOT NULL,  -- CNK code (7 digits)
  delivery_environment CHAR(1) NOT NULL DEFAULT 'P',  -- P=Public, H=Hospital
  ampp_cti_extended VARCHAR(50) NOT NULL REFERENCES ampp(cti_extended) ON DELETE CASCADE,
  price DECIMAL(10, 4),
  cheap BOOLEAN DEFAULT FALSE,
  cheapest BOOLEAN DEFAULT FALSE,
  reimbursable BOOLEAN DEFAULT FALSE,
  start_date DATE,
  end_date DATE,
  sync_id INTEGER,  -- For mark-and-sweep sync pattern
  PRIMARY KEY (code, delivery_environment)
);

CREATE INDEX IF NOT EXISTS idx_dmpp_ampp ON dmpp (ampp_cti_extended);
CREATE INDEX IF NOT EXISTS idx_dmpp_code ON dmpp (code);
CREATE INDEX IF NOT EXISTS idx_dmpp_validity ON dmpp (start_date, end_date);

-- ============================================================================
-- Reimbursement Context - Reimbursement rules (denormalized)
-- Uses natural key: dmpp_code + delivery_environment + legal_reference_path
-- ============================================================================
CREATE TABLE IF NOT EXISTS reimbursement_context (
  id SERIAL PRIMARY KEY,  -- Keep serial for copayment FK
  dmpp_code VARCHAR(20) NOT NULL,
  delivery_environment CHAR(1) NOT NULL DEFAULT 'P',
  legal_reference_path VARCHAR(255),
  reimbursement_criterion_category VARCHAR(10),
  reimbursement_criterion_code VARCHAR(20),
  flat_rate_system BOOLEAN DEFAULT FALSE,
  reference_price BOOLEAN DEFAULT FALSE,
  temporary BOOLEAN DEFAULT FALSE,
  reference_base_price DECIMAL(10, 4),
  reimbursement_base_price DECIMAL(10, 4),
  pricing_unit_quantity DECIMAL(10, 4),
  pricing_unit_label JSONB,  -- Multilingual
  start_date DATE,
  end_date DATE,
  sync_id INTEGER,  -- For mark-and-sweep sync pattern
  FOREIGN KEY (dmpp_code, delivery_environment) REFERENCES dmpp(code, delivery_environment) ON DELETE CASCADE
);

-- Natural key constraint for upsert pattern
CREATE UNIQUE INDEX IF NOT EXISTS uq_reimbursement_natural
ON reimbursement_context (dmpp_code, delivery_environment, COALESCE(legal_reference_path, ''));

CREATE INDEX IF NOT EXISTS idx_reimbursement_dmpp ON reimbursement_context (dmpp_code, delivery_environment);
CREATE INDEX IF NOT EXISTS idx_reimbursement_legal_ref ON reimbursement_context (legal_reference_path);

-- ============================================================================
-- Copayment - Patient cost by regimen type
-- ============================================================================
CREATE TABLE IF NOT EXISTS copayment (
  id SERIAL PRIMARY KEY,
  reimbursement_context_id INTEGER NOT NULL REFERENCES reimbursement_context(id) ON DELETE CASCADE,
  regimen_type VARCHAR(20) NOT NULL,  -- 1=PREFERENTIAL, 2=REGULAR
  fee_amount DECIMAL(10, 4),
  reimbursement_amount DECIMAL(10, 4)
);

CREATE INDEX IF NOT EXISTS idx_copayment_context ON copayment (reimbursement_context_id);

-- ============================================================================
-- Chapter IV Paragraph - Prior authorization paragraphs (denormalized)
-- Uses natural key: chapter_name + paragraph_name
-- ============================================================================
CREATE TABLE IF NOT EXISTS chapter_iv_paragraph (
  chapter_name VARCHAR(20) NOT NULL,  -- e.g., "IV"
  paragraph_name VARCHAR(50) NOT NULL,  -- e.g., "10680000"
  key_string JSONB,  -- Multilingual indication summary
  process_type VARCHAR(50),
  process_type_overrule VARCHAR(50),
  paragraph_version INTEGER,
  modification_status VARCHAR(50),
  start_date DATE,
  end_date DATE,
  sync_id INTEGER,  -- For mark-and-sweep sync pattern
  PRIMARY KEY (chapter_name, paragraph_name)
);

CREATE INDEX IF NOT EXISTS idx_chapter_iv_chapter ON chapter_iv_paragraph (chapter_name);
CREATE INDEX IF NOT EXISTS idx_chapter_iv_key_string ON chapter_iv_paragraph USING GIN (key_string);

-- ============================================================================
-- Chapter IV Verse - Structured legislation text
-- ============================================================================
CREATE TABLE IF NOT EXISTS chapter_iv_verse (
  id SERIAL PRIMARY KEY,
  chapter_name VARCHAR(20) NOT NULL,
  paragraph_name VARCHAR(50) NOT NULL,
  verse_seq INTEGER NOT NULL,
  verse_num INTEGER NOT NULL,
  verse_seq_parent INTEGER DEFAULT 0,
  verse_level INTEGER DEFAULT 1,
  text JSONB,  -- Multilingual
  request_type CHAR(1),  -- N=New, P=Prolongation
  agreement_term_quantity INTEGER,
  agreement_term_unit CHAR(1),  -- D=Days, W=Weeks, M=Months, Y=Years
  start_date DATE,
  FOREIGN KEY (chapter_name, paragraph_name) REFERENCES chapter_iv_paragraph(chapter_name, paragraph_name) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chapter_iv_verse_para ON chapter_iv_verse (chapter_name, paragraph_name);

-- ============================================================================
-- DMPP Chapter IV - Link CNKs to Chapter IV paragraphs (denormalized)
-- ============================================================================
CREATE TABLE IF NOT EXISTS dmpp_chapter_iv (
  dmpp_code VARCHAR(20) NOT NULL,
  delivery_environment CHAR(1) NOT NULL DEFAULT 'P',
  chapter_name VARCHAR(20) NOT NULL,
  paragraph_name VARCHAR(50) NOT NULL,
  sync_id INTEGER,  -- For mark-and-sweep sync pattern
  PRIMARY KEY (dmpp_code, delivery_environment, chapter_name, paragraph_name),
  FOREIGN KEY (dmpp_code, delivery_environment) REFERENCES dmpp(code, delivery_environment) ON DELETE CASCADE,
  FOREIGN KEY (chapter_name, paragraph_name) REFERENCES chapter_iv_paragraph(chapter_name, paragraph_name) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dmpp_chapter_iv_dmpp ON dmpp_chapter_iv (dmpp_code, delivery_environment);
CREATE INDEX IF NOT EXISTS idx_dmpp_chapter_iv_para ON dmpp_chapter_iv (chapter_name, paragraph_name);

-- ============================================================================
-- Standard Dosage - Dosage recommendations
-- ============================================================================
CREATE TABLE IF NOT EXISTS standard_dosage (
  code VARCHAR(50) PRIMARY KEY,
  vmp_group_code VARCHAR(20) REFERENCES vmp_group(code),
  target_group VARCHAR(20) NOT NULL,  -- NEONATE, PAEDIATRICS, ADOLESCENT, ADULT
  kidney_failure_class INTEGER,  -- 0=normal, 1-3=impairment
  liver_failure_class INTEGER,  -- 0=normal, 1-3=Child-Pugh
  treatment_duration_type VARCHAR(20) NOT NULL,  -- ONE_OFF, TEMPORARY, CHRONIC, IF_NECESSARY
  temporality_duration_value DECIMAL(10, 4),
  temporality_duration_unit VARCHAR(10),
  temporality_user_provided BOOLEAN,
  temporality_note JSONB,  -- Multilingual
  quantity DECIMAL(10, 4),
  quantity_denominator DECIMAL(10, 4),
  quantity_range_lower DECIMAL(10, 4),
  quantity_range_upper DECIMAL(10, 4),
  administration_frequency_quantity INTEGER,
  administration_frequency_is_max BOOLEAN,
  administration_frequency_timeframe_value DECIMAL(10, 4),
  administration_frequency_timeframe_unit VARCHAR(10),
  maximum_administration_quantity DECIMAL(10, 4),
  maximum_daily_quantity_value DECIMAL(10, 4),
  maximum_daily_quantity_unit VARCHAR(10),
  maximum_daily_quantity_multiplier DECIMAL(10, 4),
  textual_dosage JSONB,  -- Multilingual
  supplementary_info JSONB,  -- Multilingual
  route_specification JSONB,  -- Multilingual
  indication_code VARCHAR(50),
  indication_name JSONB,  -- Multilingual
  route_of_administration_code VARCHAR(20),
  start_date DATE,
  end_date DATE
);

CREATE INDEX IF NOT EXISTS idx_standard_dosage_vmp_group ON standard_dosage (vmp_group_code);
CREATE INDEX IF NOT EXISTS idx_standard_dosage_target ON standard_dosage (target_group);

-- ============================================================================
-- Dosage Parameter - Weight, age, etc.
-- ============================================================================
CREATE TABLE IF NOT EXISTS dosage_parameter (
  code VARCHAR(50) PRIMARY KEY,
  name JSONB,  -- Multilingual
  definition JSONB,  -- Multilingual
  standard_unit VARCHAR(20)
);

-- ============================================================================
-- Dosage Parameter Bounds - Weight/age constraints
-- ============================================================================
CREATE TABLE IF NOT EXISTS dosage_parameter_bounds (
  id SERIAL PRIMARY KEY,
  dosage_code VARCHAR(50) NOT NULL REFERENCES standard_dosage(code) ON DELETE CASCADE,
  parameter_code VARCHAR(50) NOT NULL REFERENCES dosage_parameter(code),
  lower_bound_value DECIMAL(10, 4),
  lower_bound_unit VARCHAR(20),
  upper_bound_value DECIMAL(10, 4),
  upper_bound_unit VARCHAR(20)
);

CREATE INDEX IF NOT EXISTS idx_dosage_bounds_dosage ON dosage_parameter_bounds (dosage_code);

-- ============================================================================
-- Legal Basis - Royal Decrees
-- ============================================================================
CREATE TABLE IF NOT EXISTS legal_basis (
  key VARCHAR(50) PRIMARY KEY,  -- e.g., "RD20180201"
  title JSONB NOT NULL,  -- Multilingual
  type VARCHAR(50) DEFAULT 'ROYAL_DECREE',
  effective_on DATE,
  start_date DATE,
  end_date DATE,
  sync_id INTEGER  -- For mark-and-sweep sync pattern
);

-- ============================================================================
-- Legal Reference - Chapters, paragraphs (hierarchical)
-- Uses path-based keys for denormalized bulk import
-- ============================================================================
CREATE TABLE IF NOT EXISTS legal_reference (
  id SERIAL PRIMARY KEY,
  legal_basis_key VARCHAR(50) NOT NULL,  -- References legal_basis(key)
  parent_path VARCHAR(500),  -- Parent's path, NULL for top-level
  key VARCHAR(100) NOT NULL,  -- e.g., "IV", "10680000"
  path VARCHAR(500) NOT NULL,  -- Full path, e.g., "IV/10680000"
  title JSONB,  -- Multilingual
  type VARCHAR(50) NOT NULL DEFAULT 'PARAGRAPH',  -- CHAPTER, PARAGRAPH, ARTICLE, SECTION
  first_published_on DATE,
  last_modified_on DATE,
  start_date DATE,
  end_date DATE,
  sync_id INTEGER  -- For mark-and-sweep sync pattern
);

-- Natural key constraint for upsert pattern
CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_reference_natural
ON legal_reference (legal_basis_key, path);

CREATE INDEX IF NOT EXISTS idx_legal_reference_basis ON legal_reference (legal_basis_key);
CREATE INDEX IF NOT EXISTS idx_legal_reference_path ON legal_reference (path);
CREATE INDEX IF NOT EXISTS idx_legal_reference_parent_path ON legal_reference (parent_path);

-- ============================================================================
-- Legal Text - Legal text content (hierarchical)
-- Uses path-based references for denormalized bulk import
-- ============================================================================
CREATE TABLE IF NOT EXISTS legal_text (
  id SERIAL PRIMARY KEY,
  legal_basis_key VARCHAR(50) NOT NULL,  -- References legal_basis(key)
  legal_reference_path VARCHAR(500) NOT NULL,  -- Path to parent legal_reference
  parent_text_key VARCHAR(100),  -- Parent text key for nesting, NULL for top-level
  key VARCHAR(100) NOT NULL,
  content JSONB,  -- Multilingual
  type VARCHAR(20) DEFAULT 'ALINEA',  -- ALINEA, POINT
  sequence_nr INTEGER NOT NULL DEFAULT 0,
  last_modified_on DATE,
  start_date DATE,
  end_date DATE,
  sync_id INTEGER  -- For mark-and-sweep sync pattern
);

-- Natural key constraint for upsert pattern
CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_text_natural
ON legal_text (legal_basis_key, legal_reference_path, key);

CREATE INDEX IF NOT EXISTS idx_legal_text_basis ON legal_text (legal_basis_key);
CREATE INDEX IF NOT EXISTS idx_legal_text_ref_path ON legal_text (legal_reference_path);
CREATE INDEX IF NOT EXISTS idx_legal_text_parent ON legal_text (parent_text_key);

-- ============================================================================
-- AMP Excipient - Inactive ingredients extracted from SmPC PDFs
-- Populated by separate sync script (not from SAM XML exports)
-- ============================================================================
CREATE TABLE IF NOT EXISTS amp_excipient (
  amp_code VARCHAR(50) PRIMARY KEY REFERENCES amp(code) ON DELETE CASCADE,
  text JSONB NOT NULL,  -- Multilingual: {"fr": "...", "nl": "...", "de": "...", "en": "..."}
  source_urls JSONB,    -- URLs per language: {"fr": "https://...", "nl": "https://..."}
  parsed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_amp_excipient_text ON amp_excipient USING GIN (text);

-- ============================================================================
-- Sync Metadata - Sync tracking/rollback
-- ============================================================================
CREATE TABLE IF NOT EXISTS sync_metadata (
  id SERIAL PRIMARY KEY,
  sync_type VARCHAR(50) NOT NULL,  -- 'full', 'amp', 'vmp', etc.
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  status VARCHAR(20) NOT NULL DEFAULT 'running',  -- running, completed, failed
  source_url VARCHAR(500),
  source_date DATE,
  record_counts JSONB,  -- {"amp": 12345, "vmp": 5678, ...}
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_metadata_status ON sync_metadata (status);
CREATE INDEX IF NOT EXISTS idx_sync_metadata_type ON sync_metadata (sync_type);

-- ============================================================================
-- Search Index - Unified search table with trigram support
-- ============================================================================
CREATE TABLE IF NOT EXISTS search_index (
  id SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  code TEXT NOT NULL,

  -- Concatenated searchable text for trigram index
  search_text TEXT NOT NULL,

  -- Display fields
  name JSONB,
  parent_code TEXT,
  parent_name JSONB,
  company_name TEXT,
  pack_info TEXT,
  price NUMERIC,
  reimbursable BOOLEAN,
  cnk_code TEXT,
  product_count INT,
  black_triangle BOOLEAN,

  -- Relationship filter columns
  vtm_code TEXT,
  vmp_code TEXT,
  amp_code TEXT,
  atc_code TEXT,
  company_actor_nr TEXT,
  vmp_group_code TEXT,

  end_date DATE,

  UNIQUE(entity_type, code)
);

-- Trigram index for substring search (accelerates ILIKE '%term%')
CREATE INDEX IF NOT EXISTS idx_search_text_trgm ON search_index USING GIN (search_text gin_trgm_ops);

-- Code prefix matching
CREATE INDEX IF NOT EXISTS idx_search_code ON search_index (code);

-- CNK exact match
CREATE INDEX IF NOT EXISTS idx_search_cnk ON search_index (cnk_code) WHERE cnk_code IS NOT NULL;

-- Relationship filter indexes (partial to save space)
CREATE INDEX IF NOT EXISTS idx_search_vtm ON search_index (vtm_code) WHERE vtm_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_search_vmp ON search_index (vmp_code) WHERE vmp_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_search_amp ON search_index (amp_code) WHERE amp_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_search_atc ON search_index (atc_code) WHERE atc_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_search_company ON search_index (company_actor_nr) WHERE company_actor_nr IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_search_vmp_group ON search_index (vmp_group_code) WHERE vmp_group_code IS NOT NULL;

-- Entity type for faceting
CREATE INDEX IF NOT EXISTS idx_search_entity_type ON search_index (entity_type);

-- Validity filtering
CREATE INDEX IF NOT EXISTS idx_search_end_date ON search_index (end_date) WHERE end_date IS NOT NULL;

-- ============================================================================
-- Search Index Extended - Additional filter columns for Phase B contextual filtering
-- This table extends search_index with form, route, reimbursement, and other filters.
-- Kept separate from search_index to reduce migration risk.
-- ============================================================================
CREATE TABLE IF NOT EXISTS search_index_extended (
  id SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  code TEXT NOT NULL,

  -- Concatenated searchable text for trigram index
  search_text TEXT NOT NULL,

  -- Display fields (same as search_index)
  name JSONB,
  parent_code TEXT,
  parent_name JSONB,
  company_name TEXT,
  pack_info TEXT,
  price NUMERIC,
  reimbursable BOOLEAN,
  cnk_code TEXT,
  product_count INT,
  black_triangle BOOLEAN,

  -- Relationship filter columns (same as search_index)
  vtm_code TEXT,
  vmp_code TEXT,
  amp_code TEXT,
  atc_code TEXT,
  company_actor_nr TEXT,
  vmp_group_code TEXT,

  end_date DATE,

  -- Phase B: Extended filter columns
  pharmaceutical_form_code VARCHAR(20),
  pharmaceutical_form_name JSONB,  -- Multilingual: {"nl": "...", "fr": "...", "en": "...", "de": "..."}
  route_of_administration_code VARCHAR(20),
  route_of_administration_name JSONB,  -- Multilingual
  reimbursement_category VARCHAR(10),  -- A, B, C, Cs, Cx, Fa, Fb
  chapter_iv_exists BOOLEAN DEFAULT FALSE,
  delivery_environment CHAR(1),  -- P=Public, H=Hospital
  medicine_type VARCHAR(50),  -- ALLOPATHIC, HOMEOPATHIC, etc.

  UNIQUE(entity_type, code)
);

-- Trigram index for substring search (accelerates ILIKE '%term%')
CREATE INDEX IF NOT EXISTS idx_search_ext_text_trgm ON search_index_extended USING GIN (search_text gin_trgm_ops);

-- Code prefix matching
CREATE INDEX IF NOT EXISTS idx_search_ext_code ON search_index_extended (code);

-- CNK exact match
CREATE INDEX IF NOT EXISTS idx_search_ext_cnk ON search_index_extended (cnk_code) WHERE cnk_code IS NOT NULL;

-- Relationship filter indexes (partial to save space)
CREATE INDEX IF NOT EXISTS idx_search_ext_vtm ON search_index_extended (vtm_code) WHERE vtm_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_search_ext_vmp ON search_index_extended (vmp_code) WHERE vmp_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_search_ext_amp ON search_index_extended (amp_code) WHERE amp_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_search_ext_atc ON search_index_extended (atc_code) WHERE atc_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_search_ext_company ON search_index_extended (company_actor_nr) WHERE company_actor_nr IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_search_ext_vmp_group ON search_index_extended (vmp_group_code) WHERE vmp_group_code IS NOT NULL;

-- Entity type for faceting
CREATE INDEX IF NOT EXISTS idx_search_ext_entity_type ON search_index_extended (entity_type);

-- Validity filtering
CREATE INDEX IF NOT EXISTS idx_search_ext_end_date ON search_index_extended (end_date) WHERE end_date IS NOT NULL;

-- Phase B: Extended filter indexes
CREATE INDEX IF NOT EXISTS idx_search_ext_form ON search_index_extended (pharmaceutical_form_code) WHERE pharmaceutical_form_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_search_ext_route ON search_index_extended (route_of_administration_code) WHERE route_of_administration_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_search_ext_reimb_cat ON search_index_extended (reimbursement_category) WHERE reimbursement_category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_search_ext_medicine_type ON search_index_extended (medicine_type) WHERE medicine_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_search_ext_delivery_env ON search_index_extended (delivery_environment) WHERE delivery_environment IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_search_ext_chapter_iv ON search_index_extended (chapter_iv_exists) WHERE chapter_iv_exists = TRUE;
