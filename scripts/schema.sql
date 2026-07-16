-- SAM Database Schema (SQLite)
-- Mirrors the SAM v2 XML export structure.
-- Multilingual text stored as JSON TEXT: {"nl": "...", "fr": "...", "en": "...", "de": "..."}

-- VTM (Virtual Therapeutic Moiety) - Active substances
CREATE TABLE IF NOT EXISTS vtm (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  sync_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_vtm_validity ON vtm (start_date, end_date);

-- VMP Group
CREATE TABLE IF NOT EXISTS vmp_group (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  no_generic_prescription_reason TEXT,
  no_switch_reason TEXT,
  patient_frailty_indicator INTEGER DEFAULT 0,
  start_date TEXT,
  end_date TEXT,
  sync_id INTEGER
);

-- VMP (Virtual Medicinal Product)
CREATE TABLE IF NOT EXISTS vmp (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  abbreviated_name TEXT,
  vtm_code TEXT REFERENCES vtm(code),
  vmp_group_code TEXT REFERENCES vmp_group(code),
  status TEXT DEFAULT 'AUTHORIZED',
  start_date TEXT,
  end_date TEXT,
  sync_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_vmp_vtm ON vmp (vtm_code);
CREATE INDEX IF NOT EXISTS idx_vmp_group ON vmp (vmp_group_code);
CREATE INDEX IF NOT EXISTS idx_vmp_validity ON vmp (start_date, end_date);

-- Substance — SAM provides no validity period for substances, only code + name
CREATE TABLE IF NOT EXISTS substance (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sync_id INTEGER
);

-- Company
CREATE TABLE IF NOT EXISTS company (
  actor_nr TEXT PRIMARY KEY,
  denomination TEXT NOT NULL,
  legal_form TEXT,
  vat_country_code TEXT,
  vat_number TEXT,
  street_name TEXT,
  street_num TEXT,
  postbox TEXT,
  postcode TEXT,
  city TEXT,
  country_code TEXT,
  phone TEXT,
  language TEXT,
  start_date TEXT,
  end_date TEXT,
  sync_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_company_name ON company (denomination);

-- Pharmaceutical Form
CREATE TABLE IF NOT EXISTS pharmaceutical_form (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sync_id INTEGER
);

-- Route of Administration
CREATE TABLE IF NOT EXISTS route_of_administration (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sync_id INTEGER
);

-- ATC Classification
CREATE TABLE IF NOT EXISTS atc_classification (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  sync_id INTEGER
);

-- AMP (Actual Medicinal Product)
CREATE TABLE IF NOT EXISTS amp (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  abbreviated_name TEXT,
  official_name TEXT,
  vmp_code TEXT REFERENCES vmp(code),
  company_actor_nr TEXT,
  black_triangle INTEGER DEFAULT 0,
  medicine_type TEXT,
  status TEXT DEFAULT 'AUTHORIZED',
  start_date TEXT,
  end_date TEXT,
  sync_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_amp_vmp ON amp (vmp_code);
CREATE INDEX IF NOT EXISTS idx_amp_company ON amp (company_actor_nr);
CREATE INDEX IF NOT EXISTS idx_amp_validity ON amp (start_date, end_date);

-- AMP Component
CREATE TABLE IF NOT EXISTS amp_component (
  amp_code TEXT NOT NULL REFERENCES amp(code) ON DELETE CASCADE,
  sequence_nr INTEGER NOT NULL,
  pharmaceutical_form_code TEXT,
  route_of_administration_code TEXT,
  sync_id INTEGER,
  PRIMARY KEY (amp_code, sequence_nr)
);

-- AMP Ingredient
CREATE TABLE IF NOT EXISTS amp_ingredient (
  amp_code TEXT NOT NULL,
  component_sequence_nr INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  type TEXT DEFAULT 'ACTIVE_SUBSTANCE',
  substance_code TEXT,
  strength_value REAL,
  strength_unit TEXT,
  strength_description TEXT,
  sync_id INTEGER,
  PRIMARY KEY (amp_code, component_sequence_nr, rank),
  FOREIGN KEY (amp_code, component_sequence_nr) REFERENCES amp_component(amp_code, sequence_nr) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_amp_ingredient_substance ON amp_ingredient (substance_code);

-- AMPP (Actual Medicinal Product Package)
CREATE TABLE IF NOT EXISTS ampp (
  cti_extended TEXT PRIMARY KEY,
  amp_code TEXT NOT NULL REFERENCES amp(code) ON DELETE CASCADE,
  prescription_name TEXT,
  authorisation_nr TEXT,
  orphan INTEGER DEFAULT 0,
  leaflet_url TEXT,
  spc_url TEXT,
  pack_display_value TEXT,
  status TEXT,
  ex_factory_price REAL,
  atc_code TEXT,
  start_date TEXT,
  end_date TEXT,
  sync_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ampp_amp ON ampp (amp_code);
CREATE INDEX IF NOT EXISTS idx_ampp_atc ON ampp (atc_code);
CREATE INDEX IF NOT EXISTS idx_ampp_validity ON ampp (start_date, end_date);

-- DMPP - CNK codes with pricing
CREATE TABLE IF NOT EXISTS dmpp (
  code TEXT NOT NULL,
  delivery_environment TEXT NOT NULL DEFAULT 'P',
  ampp_cti_extended TEXT NOT NULL REFERENCES ampp(cti_extended) ON DELETE CASCADE,
  price REAL,
  cheap INTEGER DEFAULT 0,
  cheapest INTEGER DEFAULT 0,
  reimbursable INTEGER DEFAULT 0,
  start_date TEXT,
  end_date TEXT,
  sync_id INTEGER,
  PRIMARY KEY (code, delivery_environment)
);
CREATE INDEX IF NOT EXISTS idx_dmpp_ampp ON dmpp (ampp_cti_extended);
CREATE INDEX IF NOT EXISTS idx_dmpp_code ON dmpp (code);

-- Reimbursement Context
CREATE TABLE IF NOT EXISTS reimbursement_context (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dmpp_code TEXT NOT NULL,
  delivery_environment TEXT NOT NULL DEFAULT 'P',
  legal_reference_path TEXT NOT NULL DEFAULT '',
  reimbursement_criterion_category TEXT,
  reimbursement_criterion_code TEXT,
  flat_rate_system INTEGER DEFAULT 0,
  reference_price INTEGER DEFAULT 0,
  temporary INTEGER DEFAULT 0,
  reference_base_price REAL,
  reimbursement_base_price REAL,
  pricing_unit_quantity REAL,
  pricing_unit_label TEXT,
  start_date TEXT,
  end_date TEXT,
  sync_id INTEGER,
  FOREIGN KEY (dmpp_code, delivery_environment) REFERENCES dmpp(code, delivery_environment) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reimbursement_natural
  ON reimbursement_context (dmpp_code, delivery_environment, legal_reference_path);

-- Chapter IV Paragraph
CREATE TABLE IF NOT EXISTS chapter_iv_paragraph (
  chapter_name TEXT NOT NULL,
  paragraph_name TEXT NOT NULL,
  key_string TEXT,
  process_type TEXT,
  process_type_overrule TEXT,
  paragraph_version INTEGER,
  modification_status TEXT,
  start_date TEXT,
  end_date TEXT,
  sync_id INTEGER,
  PRIMARY KEY (chapter_name, paragraph_name)
);

-- DMPP Chapter IV link
CREATE TABLE IF NOT EXISTS dmpp_chapter_iv (
  dmpp_code TEXT NOT NULL,
  delivery_environment TEXT NOT NULL DEFAULT 'P',
  chapter_name TEXT NOT NULL,
  paragraph_name TEXT NOT NULL,
  sync_id INTEGER,
  PRIMARY KEY (dmpp_code, delivery_environment, chapter_name, paragraph_name),
  FOREIGN KEY (dmpp_code, delivery_environment) REFERENCES dmpp(code, delivery_environment) ON DELETE CASCADE,
  FOREIGN KEY (chapter_name, paragraph_name) REFERENCES chapter_iv_paragraph(chapter_name, paragraph_name) ON DELETE CASCADE
);

-- Legal Basis
CREATE TABLE IF NOT EXISTS legal_basis (
  key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT DEFAULT 'ROYAL_DECREE',
  effective_on TEXT,
  start_date TEXT,
  end_date TEXT,
  sync_id INTEGER
);

-- Legal Reference
CREATE TABLE IF NOT EXISTS legal_reference (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legal_basis_key TEXT NOT NULL,
  parent_path TEXT,
  key TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT,
  type TEXT NOT NULL DEFAULT 'PARAGRAPH',
  first_published_on TEXT,
  last_modified_on TEXT,
  start_date TEXT,
  end_date TEXT,
  sync_id INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_reference_natural ON legal_reference (legal_basis_key, path);

-- Legal Text
CREATE TABLE IF NOT EXISTS legal_text (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legal_basis_key TEXT NOT NULL,
  legal_reference_path TEXT NOT NULL,
  parent_text_key TEXT,
  key TEXT NOT NULL,
  content TEXT,
  type TEXT DEFAULT 'ALINEA',
  sequence_nr INTEGER NOT NULL DEFAULT 0,
  last_modified_on TEXT,
  start_date TEXT,
  end_date TEXT,
  sync_id INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_text_natural ON legal_text (legal_basis_key, legal_reference_path, key);
