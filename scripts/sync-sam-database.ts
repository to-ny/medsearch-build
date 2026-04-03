#!/usr/bin/env bun
/**
 * Sync SAM Database
 *
 * Downloads and imports SAM XML exports into PostgreSQL database.
 * Uses upsert + mark-and-sweep pattern for efficient incremental updates
 * without the storage overhead of staging tables.
 *
 * Data source: https://www.vas.ehealth.fgov.be/websamcivics/samcivics/
 *
 * Usage:
 *   bun run scripts/sync-sam-database.ts [options]
 *
 * Options:
 *   --dry-run         Validate without writing to database
 *   --resume          Resume interrupted sync
 *   --verbose         Detailed logging
 *   --skip-download   Use existing XML files (for testing)
 *
 * Required environment:
 *   DATABASE_URL      PostgreSQL connection string
 */

import { createReadStream, existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { createInterface } from 'readline';
import { spawn } from 'child_process';
import { join, dirname } from 'path';

/**
 * Execute a command safely using spawn (no shell interpolation)
 * This prevents command injection attacks
 */
function execCommand(command: string, args: string[], options?: { maxBuffer?: number }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let totalSize = 0;
    const maxBuffer = options?.maxBuffer ?? 10 * 1024 * 1024; // 10MB default

    proc.stdout.on('data', (data: Buffer) => {
      totalSize += data.length;
      if (totalSize > maxBuffer) {
        proc.kill();
        reject(new Error('Max buffer exceeded'));
        return;
      }
      chunks.push(data);
    });

    proc.stderr.on('data', (data: Buffer) => {
      errChunks.push(data);
    });

    proc.on('close', (code) => {
      const stdout = Buffer.concat(chunks).toString();
      const stderr = Buffer.concat(errChunks).toString();
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  // SAM Export URLs
  samPortal: 'https://www.vas.ehealth.fgov.be/websamcivics/samcivics/',

  // XSD version (5 = current SAM v2 schema used by SOAP API)
  xsdVersion: 5,

  // Local paths
  exportDir: 'data/sam-export',
  progressFile: 'data/sam-sync-progress.json',

  // Processing settings
  batchSize: parseInt(process.env.SAM_SYNC_BATCH_SIZE || '1000'),
  saveInterval: 60000, // Save progress every minute

  // File prefixes in SAM export (mapped to our internal names)
  fileMapping: {
    'AMP-': 'AMP',      // Actual Medicinal Products
    'VMP-': 'VMP',      // Virtual Medicinal Products (contains VTM, VmpGroup, Vmp)
    'RMB-': 'RMB',      // Reimbursement contexts
    'CHAPTERIV-': 'CHAPTERIV', // Chapter IV paragraphs
    'REF-': 'REF',      // Reference data (Substance, ATC, PharmaceuticalForm, RouteOfAdministration)
    'RML-': 'RML',      // Legal texts (LegalBasis, LegalReference, LegalText)
    'CPN-': 'CPN',      // Companies/manufacturers
  } as Record<string, string>,
};

// ============================================================================
// Types
// ============================================================================

interface ProgressState {
  phase: 'download' | 'migrate' | 'import' | 'sweep' | 'search' | 'done';
  startedAt: string;
  lastUpdated: string;
  filesDownloaded: string[];
  tablesParsed: string[];
  tablesImported: string[];
  recordCounts: Record<string, number>;
  errors: string[];
  syncId?: number;
}

interface ParsedRecord {
  table: string;
  data: Record<string, unknown>;
}

// Track valid DMPP codes for filtering orphaned reimbursement contexts
// Populated during AMP file processing, used by reimbursement context processing
const validDmppCodes = new Set<string>();

// Database connection (lazy loaded)
import { Pool, type PoolClient } from 'pg';
let dbClient: PoolClient | null = null;
let dbPool: Pool | null = null;

// Current sync ID for mark-and-sweep
let currentSyncId: number;

// ============================================================================
// Database helpers
// ============================================================================

function getPool(): Pool {
  if (!dbPool) {
    dbPool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return dbPool;
}

async function getDbClient(): Promise<PoolClient> {
  if (!dbClient) {
    dbClient = await getPool().connect();
  }
  return dbClient;
}

async function reconnectDbClient(): Promise<PoolClient> {
  // Release old connection if it exists
  if (dbClient) {
    try {
      dbClient.release();
    } catch {
      // Connection might already be broken
    }
    dbClient = null;
  }
  // Get a fresh connection
  dbClient = await getPool().connect();
  return dbClient;
}

async function query(text: string, params?: unknown[]) {
  const client = await getDbClient();
  return client.query(text, params);
}

async function queryWithRetry(text: string, params?: unknown[], maxRetries = 3) {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const client = await getDbClient();
      return await client.query(text, params);
    } catch (error) {
      lastError = error as Error;
      const errorMessage = String(error);

      // Check if this is a connection error that we should retry
      if (errorMessage.includes('connection error') ||
          errorMessage.includes('not queryable') ||
          errorMessage.includes('ECONNRESET') ||
          errorMessage.includes('ETIMEDOUT')) {
        console.log(`   [WARN] Connection error, reconnecting (attempt ${attempt + 1}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // Exponential backoff
        await reconnectDbClient();
        continue;
      }

      // Non-connection error, don't retry
      throw error;
    }
  }
  throw lastError;
}

// ============================================================================
// Progress tracking
// ============================================================================

function loadProgress(): ProgressState | null {
  if (!existsSync(CONFIG.progressFile)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(CONFIG.progressFile, 'utf-8'));
  } catch {
    return null;
  }
}

function saveProgress(state: ProgressState): void {
  state.lastUpdated = new Date().toISOString();
  const dir = dirname(CONFIG.progressFile);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(CONFIG.progressFile, JSON.stringify(state, null, 2));
}

function initProgress(): ProgressState {
  return {
    phase: 'download',
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    filesDownloaded: [],
    tablesParsed: [],
    tablesImported: [],
    recordCounts: {},
    errors: [],
    syncId: Math.floor(Date.now() / 1000), // Unix timestamp
  };
}

// ============================================================================
// Download helpers
// ============================================================================

/**
 * Fetch the latest SAM export version number from the API
 */
async function getLatestVersion(xsd: number, verbose: boolean): Promise<string | null> {
  try {
    const url = `${CONFIG.samPortal}download/samv2-full-getLastVersion?xsd=${xsd}`;
    if (verbose) console.log(`   Fetching latest version from: ${url}`);

    // Use spawn with array args to prevent command injection
    const { stdout } = await execCommand(
      'curl',
      ['-sL', url, '--max-time', '15'],
      { maxBuffer: 1024 * 1024 }
    );

    const version = stdout.trim();
    if (/^\d+$/.test(version)) {
      return version;
    }

    console.error(`   Unexpected version response: ${version}`);
    return null;
  } catch (error) {
    console.error(`   Failed to fetch latest version: ${error}`);
    return null;
  }
}

/**
 * Download a file with progress indication
 */
async function downloadFile(url: string, destPath: string, verbose: boolean): Promise<boolean> {
  try {
    const dir = dirname(destPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (verbose) {
      console.log(`   Downloading: ${url}`);
    }

    // Use spawn with array args to prevent command injection
    const curlArgs = verbose
      ? ['-#', '-L', '-o', destPath, url, '--max-time', '600', '--retry', '3', '--retry-delay', '5']
      : ['-s', '-L', '-o', destPath, url, '--max-time', '600', '--retry', '3', '--retry-delay', '5'];

    await execCommand('curl', curlArgs, { maxBuffer: 10 * 1024 * 1024 });

    // Check if file was downloaded
    if (!existsSync(destPath)) {
      return false;
    }

    // If it's a zip file, extract it using spawn
    if (destPath.endsWith('.zip')) {
      if (verbose) console.log(`   Extracting: ${destPath}`);
      await execCommand('unzip', ['-o', destPath, '-d', dir], { maxBuffer: 10 * 1024 * 1024 });
      // Remove zip after extraction
      unlinkSync(destPath);
    }

    return true;
  } catch (error) {
    console.error(`   Failed to download ${url}: ${error}`);
    return false;
  }
}

async function downloadExports(progress: ProgressState, verbose: boolean): Promise<boolean> {
  console.log('\n1. Downloading SAM XML exports...\n');

  // Create export directory
  if (!existsSync(CONFIG.exportDir)) {
    mkdirSync(CONFIG.exportDir, { recursive: true });
  }

  // Files we need - based on actual SAM export file prefixes
  const requiredExports = Object.values(CONFIG.fileMapping);

  // First check for existing files using the actual file prefixes
  for (const [prefix, expName] of Object.entries(CONFIG.fileMapping)) {
    if (progress.filesDownloaded.includes(expName)) {
      if (verbose) console.log(`   [SKIP] ${expName} already downloaded`);
      continue;
    }

    // Check for existing files matching the prefix
    const files = existsSync(CONFIG.exportDir)
      ? readdirSync(CONFIG.exportDir).filter(f =>
          f.startsWith(prefix) && f.toLowerCase().endsWith('.xml')
        )
      : [];

    if (files.length > 0) {
      console.log(`   [OK] ${expName}: using existing file ${files[0]}`);
      progress.filesDownloaded.push(expName);
      saveProgress(progress);
    }
  }

  // Check if we need to download anything
  const missing = requiredExports.filter(e => !progress.filesDownloaded.includes(e));

  if (missing.length === 0) {
    console.log('   All required exports already available.');
    return true;
  }

  console.log(`   Missing exports: ${missing.join(', ')}`);
  console.log('   Fetching latest SAM export version...\n');

  // Get the latest version number from SAM API
  const version = await getLatestVersion(CONFIG.xsdVersion, verbose);

  if (!version) {
    console.log('\n   Could not determine latest SAM version automatically.');
    console.log('   Please download manually from: ' + CONFIG.samPortal);
    console.log('   Place XML files in: ' + CONFIG.exportDir);
    return progress.filesDownloaded.length > 0;
  }

  console.log(`   Latest SAM version: ${version}`);

  // Construct download URL for full export
  const downloadUrl = `${CONFIG.samPortal}download/samv2-download?type=FULL&xsd=${CONFIG.xsdVersion}&version=${version}`;
  const zipPath = join(CONFIG.exportDir, `sam-full-v${version}.zip`);

  console.log(`   Downloading full SAM export (this may take several minutes)...`);
  if (verbose) console.log(`   URL: ${downloadUrl}`);

  const success = await downloadFile(downloadUrl, zipPath, verbose);

  if (!success) {
    console.log('\n   [FAIL] Download failed.');
    console.log('   Please download manually from: ' + CONFIG.samPortal);
    console.log('   Place XML files in: ' + CONFIG.exportDir);
    progress.errors.push('Failed to download SAM export');
    return progress.filesDownloaded.length > 0;
  }

  console.log('   [OK] Download complete. Checking extracted files...\n');

  // Re-check for files after extraction using actual prefixes
  for (const [prefix, expName] of Object.entries(CONFIG.fileMapping)) {
    if (progress.filesDownloaded.includes(expName)) continue;

    const files = readdirSync(CONFIG.exportDir).filter(f =>
      f.startsWith(prefix) && f.toLowerCase().endsWith('.xml')
    );

    if (files.length > 0) {
      console.log(`   [OK] ${expName}: found ${files[0]}`);
      progress.filesDownloaded.push(expName);
      saveProgress(progress);
    } else {
      console.log(`   [WARN] ${expName}: not found in export`);
    }
  }

  return progress.filesDownloaded.length > 0;
}

// ============================================================================
// XML Parsing helpers
// ============================================================================

interface XmlElement {
  name: string;           // Local name without namespace prefix
  fullName: string;       // Full name with namespace prefix if present
  attributes: Record<string, string>;
  text: string;           // Direct text content
  children: XmlElement[];
}

/**
 * Simple streaming XML parser for SAM exports
 * Uses line-by-line reading to avoid loading entire file into memory
 */
async function* parseXmlFile(
  filePath: string,
  rootElementName: string,
  verbose: boolean
): AsyncGenerator<XmlElement> {
  const fileStream = createReadStream(filePath);
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  let currentElement: string | null = null;
  let buffer: string[] = [];
  let elementCount = 0;
  let depth = 0;

  // Match element with optional namespace prefix (ns2:, ns3:, etc.)
  const startRegex = new RegExp(`<((?:ns\\d+:)?${rootElementName})(?:\\s|>)`);
  const endRegex = new RegExp(`</((?:ns\\d+:)?${rootElementName})>`);

  for await (const line of rl) {
    // Check for start of element
    const startMatch = line.match(startRegex);
    if (startMatch && !currentElement) {
      currentElement = startMatch[1];
      buffer = [line];
      depth = 1;

      // Check if this line also closes the element (self-closing or single line)
      if (line.includes(`</${currentElement}>`)) {
        elementCount++;
        const xmlContent = buffer.join('\n');
        const parsed = parseXmlElement(xmlContent);
        if (parsed) {
          yield parsed;
        }
        currentElement = null;
        buffer = [];
        depth = 0;
      }
      continue;
    }

    // Accumulate content
    if (currentElement) {
      buffer.push(line);

      // Track nested elements of same name
      const nestedStart = line.match(startRegex);
      const nestedEnd = line.match(endRegex);

      if (nestedStart) depth++;
      if (nestedEnd) depth--;

      // Check for end of our element
      if (depth === 0) {
        elementCount++;
        const xmlContent = buffer.join('\n');
        const parsed = parseXmlElement(xmlContent);
        if (parsed) {
          yield parsed;
        }
        currentElement = null;
        buffer = [];

        if (verbose && elementCount % 10000 === 0) {
          process.stdout.write(`\r   Parsed ${elementCount} ${rootElementName} elements...`);
        }
      }
    }
  }

  if (verbose) {
    console.log(`\r   Parsed ${elementCount} ${rootElementName} elements.          `);
  }
}

/**
 * Parse a single XML element from string
 * Handles namespace prefixes like ns2:, ns3:, etc.
 */
function parseXmlElement(xml: string): XmlElement | null {
  try {
    // Match opening tag with optional namespace
    const openMatch = xml.match(/^[\s\S]*?<((?:ns\d+:)?(\w+))([^>]*)>/);
    if (!openMatch) return null;

    const [, fullName, localName, attrStr] = openMatch;
    const attributes = parseAttributes(attrStr);

    // Parse children and text
    const { children, text } = parseContent(xml, fullName);

    return {
      name: localName,
      fullName,
      attributes,
      text,
      children,
    };
  } catch {
    return null;
  }
}

/**
 * Parse XML attributes from a string like: attr1="val1" attr2="val2"
 */
function parseAttributes(attrStr: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  // Match both regular and namespaced attributes (xml:lang, etc.)
  const attrRegex = /([\w:]+)="([^"]*)"/g;
  let match;
  while ((match = attrRegex.exec(attrStr)) !== null) {
    attributes[match[1]] = match[2];
  }
  return attributes;
}

/**
 * Parse content inside an XML element, extracting children and direct text
 * Handles nested elements of the same name correctly by tracking depth
 */
function parseContent(xml: string, tagName: string): { children: XmlElement[]; text: string } {
  const children: XmlElement[] = [];

  // Extract inner content between opening and closing tags
  // Use a function to find the correct closing tag by tracking depth
  const openTagMatch = xml.match(new RegExp(`^[\\s\\S]*?<${tagName}[^>]*>`));
  if (!openTagMatch) {
    return { children: [], text: '' };
  }

  const afterOpenTag = xml.slice(openTagMatch[0].length);
  const closeTagPattern = `</${tagName}>`;
  const openTagPattern = new RegExp(`<${tagName}(?:\\s|>)`);

  // Find matching close tag by tracking depth
  let depth = 1;
  let pos = 0;
  let innerEnd = -1;

  while (pos < afterOpenTag.length && depth > 0) {
    const closeIdx = afterOpenTag.indexOf(closeTagPattern, pos);
    if (closeIdx === -1) break;

    // Count any opening tags between pos and closeIdx
    const segment = afterOpenTag.slice(pos, closeIdx);
    const openMatches = segment.match(new RegExp(openTagPattern, 'g'));
    if (openMatches) {
      depth += openMatches.length;
    }

    depth--; // For the closing tag we found
    pos = closeIdx + closeTagPattern.length;

    if (depth === 0) {
      innerEnd = closeIdx;
    }
  }

  if (innerEnd === -1) {
    return { children: [], text: '' };
  }

  const inner = afterOpenTag.slice(0, innerEnd);

  // Find all child elements using depth-aware parsing
  const childOpenRegex = /<((?:ns\d+:)?(\w+))([^>]*?)(\/?)>/g;
  let childMatch;
  let lastIndex = 0;
  let directText = '';

  while ((childMatch = childOpenRegex.exec(inner)) !== null) {
    const [fullOpenTag, fullName, localName, attrStr, selfClose] = childMatch;
    const startIdx = childMatch.index;

    // Collect text before this child
    directText += inner.slice(lastIndex, startIdx);

    const attributes = parseAttributes(attrStr);

    if (selfClose === '/') {
      // Self-closing tag
      children.push({
        name: localName,
        fullName,
        attributes,
        text: '',
        children: [],
      });
      lastIndex = startIdx + fullOpenTag.length;
    } else {
      // Find matching closing tag by tracking depth
      const childCloseTag = `</${fullName}>`;
      const childOpenPattern = new RegExp(`<${fullName}(?:\\s|>)`);

      let childDepth = 1;
      let childPos = startIdx + fullOpenTag.length;
      let childEndIdx = -1;

      while (childPos < inner.length && childDepth > 0) {
        const childCloseIdx = inner.indexOf(childCloseTag, childPos);
        if (childCloseIdx === -1) break;

        // Count opening tags between childPos and childCloseIdx
        const childSegment = inner.slice(childPos, childCloseIdx);
        const childOpenMatches = childSegment.match(new RegExp(childOpenPattern, 'g'));
        if (childOpenMatches) {
          childDepth += childOpenMatches.length;
        }

        childDepth--;
        childPos = childCloseIdx + childCloseTag.length;

        if (childDepth === 0) {
          childEndIdx = childCloseIdx + childCloseTag.length;
        }
      }

      if (childEndIdx === -1) {
        // Malformed XML, skip this element
        lastIndex = startIdx + fullOpenTag.length;
        continue;
      }

      const fullMatch = inner.slice(startIdx, childEndIdx);
      const content = inner.slice(startIdx + fullOpenTag.length, childEndIdx - childCloseTag.length);

      // Parse children recursively
      const { children: subChildren, text: subText } = parseContent(fullMatch, fullName);
      children.push({
        name: localName,
        fullName,
        attributes,
        text: subText || (content ? content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''),
        children: subChildren,
      });

      lastIndex = childEndIdx;
      // Reset regex position to continue after this element
      childOpenRegex.lastIndex = childEndIdx;
    }
  }

  // Collect remaining text after last child
  directText += inner.slice(lastIndex);

  // Clean up the direct text
  const text = directText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  return { children, text };
}

/**
 * Get child element by local name (ignores namespace prefix)
 */
function getChild(element: XmlElement, name: string): XmlElement | undefined {
  return element.children.find(c => c.name === name);
}

/**
 * Get all children with local name (ignores namespace prefix)
 */
function getChildren(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter(c => c.name === name);
}

/**
 * Get the current/most recent Data element
 * SAM uses <Data from="date" to="date"> elements for versioning
 * We want the one without 'to' date, or the one with the latest 'to' date
 */
function getCurrentData(element: XmlElement): XmlElement | undefined {
  const dataElements = getChildren(element, 'Data');

  if (dataElements.length === 0) {
    return undefined;
  }

  // First, try to find a Data element without 'to' date (current)
  const current = dataElements.find(d => !d.attributes.to);
  if (current) return current;

  // Otherwise, find the one with the latest 'to' date
  return dataElements.reduce((latest, d) => {
    const latestTo = latest?.attributes.to || '';
    const currentTo = d.attributes.to || '';
    return currentTo > latestTo ? d : latest;
  }, dataElements[0]);
}

/**
 * Extract multilingual text from element (returns JSONB format)
 * Handles multiple formats:
 * - <Fr>text</Fr>, <Nl>text</Nl> (no namespace)
 * - <ns2:Fr>text</ns2:Fr>, <ns2:Nl>text</ns2:Nl> (with namespace)
 * - Child with xml:lang attribute
 */
function extractMultilingualText(element: XmlElement | undefined): Record<string, string> | null {
  if (!element) return null;

  const result: Record<string, string> = {};

  for (const child of element.children) {
    // Handle <Fr>, <Nl>, <De>, <En> elements (with or without namespace)
    const langMatch = child.name.match(/^(Fr|Nl|De|En)$/i);
    if (langMatch) {
      const lang = langMatch[1].toLowerCase();
      if (child.text) {
        result[lang] = child.text;
      }
      continue;
    }

    // Handle xml:lang attribute (e.g., <Synonym xml:lang="fr">text</Synonym>)
    const xmlLang = child.attributes['xml:lang'];
    if (xmlLang) {
      const lang = xmlLang.toLowerCase();
      if (child.text) {
        result[lang] = child.text;
      }
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Extract multilingual text from KeyString fields in Chapter IV
 * These use KeyStringNl, KeyStringFr format
 */
function extractKeyStrings(element: XmlElement): Record<string, string> | null {
  const result: Record<string, string> = {};

  const keyStringNl = getChild(element, 'KeyStringNl');
  const keyStringFr = getChild(element, 'KeyStringFr');

  if (keyStringNl?.text) result.nl = keyStringNl.text;
  if (keyStringFr?.text) result.fr = keyStringFr.text;

  return Object.keys(result).length > 0 ? result : null;
}

// ============================================================================
// Data transformers
// ============================================================================

// Note: Company data is embedded in AMP elements but not currently synced
// as a separate table. Company names are joined from the company table
// which can be populated separately if needed.

/**
 * Transform a VTM (Virtual Therapeutic Moiety) element
 */
function transformVtm(element: XmlElement): ParsedRecord | null {
  const code = element.attributes.code || element.attributes.Code;
  if (!code) return null;

  // Get current data wrapper
  const data = getCurrentData(element);
  if (!data) return null;

  const name = extractMultilingualText(getChild(data, 'Name'));
  if (!name) return null;

  return {
    table: 'vtm',
    data: {
      code,
      name: JSON.stringify(name),
      start_date: data.attributes.from || null,
      end_date: data.attributes.to || null,
      sync_id: currentSyncId,
    },
  };
}

/**
 * Transform a VmpGroup element
 */
function transformVmpGroup(element: XmlElement): ParsedRecord | null {
  const code = element.attributes.code || element.attributes.Code;
  if (!code) return null;

  // Get current data wrapper
  const data = getCurrentData(element);
  if (!data) return null;

  const name = extractMultilingualText(getChild(data, 'Name'));
  if (!name) return null;

  return {
    table: 'vmp_group',
    data: {
      code,
      name: JSON.stringify(name),
      no_generic_prescription_reason: getChild(data, 'NoGenericPrescriptionReason')?.text || null,
      no_switch_reason: getChild(data, 'NoSwitchReason')?.text || null,
      patient_frailty_indicator: getChild(data, 'PatientFrailtyIndicator')?.text === 'true',
      sync_id: currentSyncId,
    },
  };
}

/**
 * Transform a VMP (Virtual Medicinal Product) element
 */
function transformVmp(element: XmlElement): ParsedRecord | null {
  const code = element.attributes.code || element.attributes.Code;
  if (!code) return null;

  // Get current data wrapper
  const data = getCurrentData(element);
  if (!data) return null;

  const name = extractMultilingualText(getChild(data, 'Name'));
  if (!name) return null;

  // VTM and VmpGroup references might be at element level or in data
  const vtm = getChild(data, 'Vtm') || getChild(element, 'Vtm');
  const vmpGroup = getChild(data, 'VmpGroup') || getChild(element, 'VmpGroup');

  return {
    table: 'vmp',
    data: {
      code,
      name: JSON.stringify(name),
      abbreviated_name: JSON.stringify(extractMultilingualText(getChild(data, 'AbbreviatedName'))),
      vtm_code: vtm?.attributes.code || vtm?.attributes.Code || null,
      vmp_group_code: vmpGroup?.attributes.code || vmpGroup?.attributes.Code || null,
      status: getChild(data, 'Status')?.text || 'AUTHORIZED',
      sync_id: currentSyncId,
    },
  };
}

/**
 * Transform an AMP (Actual Medicinal Product) element
 * Returns multiple records: AMP, AmpComponent, AmpIngredient, AMPP, DMPP
 */
function transformAmp(element: XmlElement): ParsedRecord[] {
  const records: ParsedRecord[] = [];
  const code = element.attributes.code || element.attributes.Code;
  if (!code) return records;

  // Get current data wrapper
  const data = getCurrentData(element);
  if (!data) return records;

  const name = extractMultilingualText(getChild(data, 'Name'));
  if (!name) return records;

  // Get company reference (actor number only, not full company data)
  const companyElement = getChild(data, 'Company');
  const companyActorNr = companyElement?.attributes.actorNr || companyElement?.attributes.ActorNr;
  records.push({
    table: 'amp',
    data: {
      code,
      name: JSON.stringify(name),
      abbreviated_name: JSON.stringify(extractMultilingualText(getChild(data, 'AbbreviatedName'))),
      official_name: getChild(data, 'OfficialName')?.text || null,
      vmp_code: element.attributes.vmpCode || element.attributes.VmpCode || null,
      company_actor_nr: companyActorNr?.padStart(5, '0') || null,
      black_triangle: getChild(data, 'BlackTriangle')?.text === 'true',
      medicine_type: getChild(data, 'MedicineType')?.text || null,
      status: getChild(data, 'Status')?.text || 'AUTHORIZED',
      sync_id: currentSyncId,
    },
  });

  // AMP Components
  const components = getChildren(element, 'AmpComponent');
  for (const comp of components) {
    const seqNr = comp.attributes.sequenceNr || comp.attributes.SequenceNr || '1';
    const compData = getCurrentData(comp);
    if (!compData) continue;

    const pharmForm = getChild(compData, 'PharmaceuticalForm');
    const route = getChild(compData, 'RouteOfAdministration');

    records.push({
      table: 'amp_component',
      data: {
        amp_code: code,
        sequence_nr: parseInt(seqNr),
        pharmaceutical_form_code: pharmForm?.attributes.code || pharmForm?.attributes.Code || null,
        route_of_administration_code: route?.attributes.code || route?.attributes.Code || null,
        sync_id: currentSyncId,
      },
    });

    // Ingredients
    const ingredients = getChildren(comp, 'RealActualIngredient');
    for (const ing of ingredients) {
      const rank = ing.attributes.rank || ing.attributes.Rank || '1';
      const ingData = getCurrentData(ing);
      if (!ingData) continue;

      const substance = getChild(ingData, 'Substance');
      const strengthElement = getChild(ingData, 'Strength');
      records.push({
        table: 'amp_ingredient',
        data: {
          amp_code: code,
          component_sequence_nr: parseInt(seqNr),
          rank: parseInt(rank),
          type: getChild(ingData, 'Type')?.text || 'ACTIVE_SUBSTANCE',
          substance_code: substance?.attributes.code || substance?.attributes.Code || null,
          strength_value: strengthElement?.text ? parseFloat(strengthElement.text) : null,
          strength_unit: strengthElement?.attributes.unit || strengthElement?.attributes.Unit || null,
          strength_description: getChild(ingData, 'StrengthDescription')?.text || null,
          sync_id: currentSyncId,
        },
      });
    }
  }

  // AMPPs (packages)
  const ampps = getChildren(element, 'Ampp');
  for (const ampp of ampps) {
    const ctiExtended = ampp.attributes.ctiExtended || ampp.attributes.CtiExtended;
    if (!ctiExtended) continue;

    const amppData = getCurrentData(ampp);
    if (!amppData) continue;

    records.push({
      table: 'ampp',
      data: {
        cti_extended: ctiExtended,
        amp_code: code,
        prescription_name: JSON.stringify(extractMultilingualText(getChild(amppData, 'PrescriptionNameFamhp'))),
        authorisation_nr: getChild(amppData, 'AuthorisationNr')?.text || null,
        orphan: getChild(amppData, 'Orphan')?.text === 'true',
        leaflet_url: JSON.stringify(extractMultilingualText(getChild(amppData, 'LeafletLink'))),
        spc_url: JSON.stringify(extractMultilingualText(getChild(amppData, 'SpcLink'))),
        pack_display_value: getChild(amppData, 'PackDisplayValue')?.text || null,
        status: getChild(amppData, 'Status')?.text || 'AUTHORIZED',
        ex_factory_price: getChild(amppData, 'OfficialExFactoryPrice')?.text
          ? parseFloat(getChild(amppData, 'OfficialExFactoryPrice')!.text)
          : getChild(amppData, 'ExFactoryPrice')?.text
            ? parseFloat(getChild(amppData, 'ExFactoryPrice')!.text)
            : null,
        atc_code: getChild(amppData, 'Atc')?.attributes.code || getChild(amppData, 'Atc')?.attributes.Code || null,
        sync_id: currentSyncId,
      },
    });

    // DMPPs (CNK codes)
    const dmpps = getChildren(ampp, 'Dmpp');
    for (const dmpp of dmpps) {
      const dmppCode = dmpp.attributes.code || dmpp.attributes.Code;
      if (!dmppCode) continue;

      const dmppData = getCurrentData(dmpp);
      if (!dmppData) continue;

      const deliveryEnv = dmpp.attributes.deliveryEnvironment || dmpp.attributes.DeliveryEnvironment || 'P';

      // Track valid DMPP codes for reimbursement context FK validation
      validDmppCodes.add(`${dmppCode}:${deliveryEnv}`);

      records.push({
        table: 'dmpp',
        data: {
          code: dmppCode,
          ampp_cti_extended: ctiExtended,
          delivery_environment: deliveryEnv,
          price: getChild(dmppData, 'Price')?.text ? parseFloat(getChild(dmppData, 'Price')!.text) : null,
          cheap: getChild(dmppData, 'Cheap')?.text === 'true',
          cheapest: getChild(dmppData, 'Cheapest')?.text === 'true',
          reimbursable: getChild(dmppData, 'Reimbursable')?.text === 'true',
          sync_id: currentSyncId,
        },
      });
    }
  }

  return records;
}

/**
 * Transform a Chapter IV Paragraph element
 */
function transformChapterIVParagraph(element: XmlElement): ParsedRecord | null {
  const chapterName = element.attributes.ChapterName;
  const paragraphName = element.attributes.ParagraphName;
  if (!chapterName || !paragraphName) return null;

  // Get current data wrapper
  const data = getCurrentData(element);
  if (!data) return null;

  const keyStrings = extractKeyStrings(data);

  return {
    table: 'chapter_iv_paragraph',
    data: {
      chapter_name: chapterName,
      paragraph_name: paragraphName,
      key_string: keyStrings ? JSON.stringify(keyStrings) : null,
      process_type: getChild(data, 'ProcessType')?.text || null,
      process_type_overrule: getChild(data, 'ProcessTypeOverrule')?.text || null,
      paragraph_version: getChild(data, 'ParagraphVersion')?.text
        ? parseInt(getChild(data, 'ParagraphVersion')!.text)
        : null,
      modification_status: getChild(data, 'ModificationStatus')?.text || null,
      start_date: data.attributes.from || null,
      end_date: data.attributes.to || null,
      sync_id: currentSyncId,
    },
  };
}

/**
 * Transform a Reimbursement Context element
 * Note: This uses dmpp_code + delivery_environment to reference DMPP (denormalized)
 */
function transformReimbursementContext(element: XmlElement): ParsedRecord[] {
  const records: ParsedRecord[] = [];

  // The 'code' in RMB file is the CNK/DMPP code
  const dmppCode = element.attributes.code;
  const codeType = element.attributes.codeType;
  const deliveryEnv = element.attributes.deliveryEnvironment || 'P';
  const legalRefPath = element.attributes.legalReferencePath;

  // Only process CNK code types (codeType="CNK")
  if (!dmppCode || codeType !== 'CNK') return records;

  // Skip orphaned reimbursement contexts (DMPP no longer exists, e.g., discontinued products)
  const dmppKey = `${dmppCode}:${deliveryEnv}`;
  if (!validDmppCodes.has(dmppKey)) {
    return records;
  }

  // Get current data wrapper
  const data = getCurrentData(element);
  if (!data) return records;

  // Get reimbursement criterion
  const criterion = getChild(data, 'ReimbursementCriterion');
  const category = criterion?.attributes.category;
  const criterionCode = criterion?.attributes.code;

  // Get pricing unit
  const pricingUnit = getChild(data, 'PricingUnit');
  const pricingLabel = pricingUnit ? extractMultilingualText(getChild(pricingUnit, 'Label')) : null;

  records.push({
    table: 'reimbursement_context',
    data: {
      dmpp_code: dmppCode,
      delivery_environment: deliveryEnv,
      legal_reference_path: legalRefPath || null,
      reimbursement_criterion_category: category || null,
      reimbursement_criterion_code: criterionCode || null,
      temporary: getChild(data, 'Temporary')?.text === 'true',
      reference_price: getChild(data, 'Reference')?.text === 'true',
      flat_rate_system: getChild(data, 'FlatRateSystem')?.text === 'true',
      reimbursement_base_price: getChild(data, 'ReimbursementBasePrice')?.text
        ? parseFloat(getChild(data, 'ReimbursementBasePrice')!.text)
        : null,
      reference_base_price: getChild(data, 'ReferenceBasePrice')?.text
        ? parseFloat(getChild(data, 'ReferenceBasePrice')!.text)
        : null,
      pricing_unit_quantity: pricingUnit && getChild(pricingUnit, 'Quantity')?.text
        ? parseFloat(getChild(pricingUnit, 'Quantity')!.text)
        : null,
      pricing_unit_label: pricingLabel ? JSON.stringify(pricingLabel) : null,
      start_date: data.attributes.from || null,
      end_date: data.attributes.to || null,
      sync_id: currentSyncId,
    },
  });

  return records;
}

/**
 * Transform an ATC Classification element
 */
function transformAtcClassification(element: XmlElement): ParsedRecord | null {
  const code = element.attributes.code || element.attributes.Code;
  if (!code) return null;

  // ATC has Description directly as child (not multilingual, just English text)
  const description = getChild(element, 'Description')?.text;
  if (!description) return null;

  return {
    table: 'atc_classification',
    data: {
      code,
      description,
      sync_id: currentSyncId,
    },
  };
}

/**
 * Transform a Substance element
 */
function transformSubstance(element: XmlElement): ParsedRecord | null {
  const code = element.attributes.code || element.attributes.Code;
  if (!code) return null;

  const name = extractMultilingualText(getChild(element, 'Name'));
  if (!name) return null;

  return {
    table: 'substance',
    data: {
      code,
      name: JSON.stringify(name),
      start_date: null,
      end_date: null,
      sync_id: currentSyncId,
    },
  };
}

/**
 * Transform a PharmaceuticalForm element
 */
function transformPharmaceuticalForm(element: XmlElement): ParsedRecord | null {
  const code = element.attributes.code || element.attributes.Code;
  if (!code) return null;

  const name = extractMultilingualText(getChild(element, 'Name'));
  if (!name) return null;

  return {
    table: 'pharmaceutical_form',
    data: {
      code,
      name: JSON.stringify(name),
      sync_id: currentSyncId,
    },
  };
}

/**
 * Transform a RouteOfAdministration element
 */
function transformRouteOfAdministration(element: XmlElement): ParsedRecord | null {
  const code = element.attributes.code || element.attributes.Code;
  if (!code) return null;

  const name = extractMultilingualText(getChild(element, 'Name'));
  if (!name) return null;

  return {
    table: 'route_of_administration',
    data: {
      code,
      name: JSON.stringify(name),
      sync_id: currentSyncId,
    },
  };
}

/**
 * Transform a Company element
 */
function transformCompany(element: XmlElement): ParsedRecord | null {
  const actorNr = element.attributes.actorNr || element.attributes.ActorNr;
  if (!actorNr) return null;

  // Get current data wrapper (most recent version)
  const data = getCurrentData(element);
  if (!data) return null;

  const denomination = getChild(data, 'Denomination')?.text;
  if (!denomination) return null;

  const vatNrElement = getChild(data, 'VatNr');

  return {
    table: 'company',
    data: {
      actor_nr: actorNr.padStart(5, '0'),
      denomination,
      legal_form: getChild(data, 'LegalForm')?.text || null,
      vat_country_code: vatNrElement?.attributes.countryCode || null,
      vat_number: vatNrElement?.text || null,
      street_name: getChild(data, 'StreetName')?.text || null,
      street_num: getChild(data, 'StreetNum')?.text || null,
      postbox: getChild(data, 'Postbox')?.text || null,
      postcode: getChild(data, 'Postcode')?.text || null,
      city: getChild(data, 'City')?.text || null,
      country_code: getChild(data, 'CountryCode')?.text || null,
      phone: getChild(data, 'Phone')?.text || null,
      language: getChild(data, 'Language')?.text || null,
      start_date: data.attributes.from || null,
      end_date: data.attributes.to || null,
      sync_id: currentSyncId,
    },
  };
}

/**
 * Transform a LegalBasis element and all its nested LegalReferences and LegalTexts
 * Returns multiple records for the hierarchical structure
 */
function transformLegalBasis(element: XmlElement): ParsedRecord[] {
  const records: ParsedRecord[] = [];
  const key = element.attributes.key || element.attributes.Key;
  if (!key) return records;

  // Get current data wrapper
  const data = getCurrentData(element);
  if (!data) return records;

  const title = extractMultilingualText(getChild(data, 'Title'));
  if (!title) return records;

  records.push({
    table: 'legal_basis',
    data: {
      key,
      title: JSON.stringify(title),
      type: getChild(data, 'Type')?.text || 'ROYAL_DECREE',
      effective_on: getChild(data, 'EffectiveOn')?.text || null,
      start_date: data.attributes.from || null,
      end_date: data.attributes.to || null,
      sync_id: currentSyncId,
    },
  });

  // Process nested LegalReferences
  const legalRefs = getChildren(element, 'LegalReference');
  for (const ref of legalRefs) {
    processLegalReference(ref, key, null, records);
  }

  return records;
}

/**
 * Recursively process LegalReference elements
 * parent_key is used to build a path-based identifier since we can't use auto-generated IDs
 */
function processLegalReference(
  element: XmlElement,
  legalBasisKey: string,
  parentPath: string | null,
  records: ParsedRecord[]
): void {
  const refKey = element.attributes.key || element.attributes.Key;
  if (!refKey) return;

  // Get current data wrapper
  const refData = getCurrentData(element);
  if (!refData) return;

  const title = extractMultilingualText(getChild(refData, 'Title'));

  // Build a path-based key for this reference
  const currentPath = parentPath ? `${parentPath}/${refKey}` : refKey;

  records.push({
    table: 'legal_reference',
    data: {
      legal_basis_key: legalBasisKey,
      parent_path: parentPath,
      key: refKey,
      path: currentPath,
      title: title ? JSON.stringify(title) : null,
      type: getChild(refData, 'Type')?.text || 'PARAGRAPH',
      first_published_on: getChild(refData, 'FirstPublishedOn')?.text || null,
      last_modified_on: getChild(refData, 'LastModifiedOn')?.text || null,
      start_date: refData.attributes.from || null,
      end_date: refData.attributes.to || null,
      sync_id: currentSyncId,
    },
  });

  // Process nested LegalTexts
  const legalTexts = getChildren(element, 'LegalText');
  for (const text of legalTexts) {
    processLegalText(text, legalBasisKey, currentPath, null, records);
  }

  // Process nested LegalReferences (recursive)
  const childRefs = getChildren(element, 'LegalReference');
  for (const childRef of childRefs) {
    processLegalReference(childRef, legalBasisKey, currentPath, records);
  }
}

/**
 * Recursively process LegalText elements
 */
function processLegalText(
  element: XmlElement,
  legalBasisKey: string,
  legalRefPath: string,
  parentTextKey: string | null,
  records: ParsedRecord[]
): void {
  const textKey = element.attributes.key || element.attributes.Key;
  if (!textKey) return;

  // Get current data wrapper
  const textData = getCurrentData(element);
  if (!textData) return;

  const content = extractMultilingualText(getChild(textData, 'Content'));

  records.push({
    table: 'legal_text',
    data: {
      legal_basis_key: legalBasisKey,
      legal_reference_path: legalRefPath,
      parent_text_key: parentTextKey,
      key: textKey,
      content: content ? JSON.stringify(content) : null,
      type: getChild(textData, 'Type')?.text || 'ALINEA',
      sequence_nr: getChild(textData, 'SequenceNr')?.text
        ? parseInt(getChild(textData, 'SequenceNr')!.text)
        : 0,
      last_modified_on: getChild(textData, 'LastModifiedOn')?.text || null,
      start_date: textData.attributes.from || null,
      end_date: textData.attributes.to || null,
      sync_id: currentSyncId,
    },
  });

  // Process nested LegalTexts (recursive)
  const childTexts = getChildren(element, 'LegalText');
  for (const childText of childTexts) {
    processLegalText(childText, legalBasisKey, legalRefPath, textKey, records);
  }
}

// ============================================================================
// Database import (upsert pattern)
// ============================================================================

// Tables that each file type populates
const FILE_TABLE_MAPPING: Record<string, string[]> = {
  AMP: ['amp', 'amp_component', 'amp_ingredient', 'ampp', 'dmpp'],
  VMP: ['vtm', 'vmp_group', 'vmp'],
  RMB: ['reimbursement_context'],
  CHAPTERIV: ['chapter_iv_paragraph'],
  REF: ['substance', 'atc_classification', 'pharmaceutical_form', 'route_of_administration'],
  RML: ['legal_basis', 'legal_reference', 'legal_text'],
  CPN: ['company'],
};

// All required file types - sync will fail if any are missing
const REQUIRED_FILE_TYPES = ['AMP', 'VMP', 'RMB', 'CHAPTERIV', 'REF', 'RML', 'CPN'];

// Track which tables have data during this sync
const tablesWithData = new Set<string>();

// Upsert conflict targets for each table
const UPSERT_CONFLICT_TARGETS: Record<string, string> = {
  substance: 'code',
  atc_classification: 'code',
  pharmaceutical_form: 'code',
  route_of_administration: 'code',
  company: 'actor_nr',
  vtm: 'code',
  vmp_group: 'code',
  vmp: 'code',
  amp: 'code',
  amp_component: 'amp_code, sequence_nr',
  amp_ingredient: 'amp_code, component_sequence_nr, rank',
  ampp: 'cti_extended',
  dmpp: 'code, delivery_environment',
  chapter_iv_paragraph: 'chapter_name, paragraph_name',
  dmpp_chapter_iv: 'dmpp_code, delivery_environment, chapter_name, paragraph_name',
  legal_basis: 'key',
  // For tables with SERIAL PKs, use the unique index for conflict target
  reimbursement_context: 'dmpp_code, delivery_environment, COALESCE(legal_reference_path, \'\')',
  legal_reference: 'legal_basis_key, path',
  legal_text: 'legal_basis_key, legal_reference_path, key',
};

/**
 * Get all tables that should have data based on required files
 */
function getExpectedTables(): Set<string> {
  const expected = new Set<string>();
  for (const fileType of REQUIRED_FILE_TYPES) {
    const tables = FILE_TABLE_MAPPING[fileType] || [];
    tables.forEach(t => expected.add(t));
  }
  return expected;
}

/**
 * Validate that all expected tables have data
 * Returns list of missing tables, or empty array if all present
 */
function validateAllTablesHaveData(): string[] {
  const expected = getExpectedTables();
  const missing: string[] = [];
  for (const table of expected) {
    if (!tablesWithData.has(table)) {
      missing.push(table);
    }
  }
  return missing;
}

async function ensureExtensions(dryRun: boolean): Promise<void> {
  if (dryRun) {
    console.log('   [DRY RUN] Would ensure pg_trgm extension exists');
    return;
  }

  try {
    await queryWithRetry('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    console.log('   [OK] pg_trgm extension ready');
  } catch (error) {
    console.log(`   [WARN] Could not create pg_trgm extension: ${error}`);
  }
}

/**
 * Ensure sync_id columns exist on all data tables (idempotent migration)
 */
async function ensureSyncIdColumns(dryRun: boolean): Promise<void> {
  console.log('\n2. Ensuring sync_id columns exist...\n');

  // Ensure required extensions exist
  await ensureExtensions(dryRun);

  const tables = [
    'substance', 'atc_classification', 'pharmaceutical_form', 'route_of_administration',
    'company', 'vtm', 'vmp_group', 'vmp', 'amp', 'amp_component', 'amp_ingredient',
    'ampp', 'dmpp', 'reimbursement_context', 'chapter_iv_paragraph', 'dmpp_chapter_iv',
    'legal_basis', 'legal_reference', 'legal_text'
  ];

  if (dryRun) {
    console.log('   [DRY RUN] Would ensure sync_id columns for:', tables.join(', '));
    return;
  }

  for (const table of tables) {
    try {
      await query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS sync_id INTEGER`);
    } catch (error) {
      // Table might not exist yet, that's okay - schema.sql will create it
      console.log(`   [WARN] Could not add sync_id to ${table}: ${error}`);
    }
  }

  // Also ensure unique constraints exist for upsert conflict targets
  try {
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_reimbursement_natural
      ON reimbursement_context (dmpp_code, delivery_environment, COALESCE(legal_reference_path, ''))
    `);
  } catch { /* Index might already exist */ }

  try {
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_reference_natural
      ON legal_reference (legal_basis_key, path)
    `);
  } catch { /* Index might already exist */ }

  try {
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_text_natural
      ON legal_text (legal_basis_key, legal_reference_path, key)
    `);
  } catch { /* Index might already exist */ }

  console.log('   [OK] sync_id columns and unique constraints ready');
}

/**
 * Build a batched upsert SQL statement for a table with multiple rows
 */
function buildBatchedUpsertQuery(table: string, columns: string[], rowCount: number): string {
  const conflictTarget = UPSERT_CONFLICT_TARGETS[table];
  if (!conflictTarget) {
    throw new Error(`No conflict target defined for table: ${table}`);
  }

  // Build VALUE placeholders for multiple rows: ($1, $2, $3), ($4, $5, $6), ...
  const colCount = columns.length;
  const valueClauses: string[] = [];
  for (let row = 0; row < rowCount; row++) {
    const rowPlaceholders = columns.map((_, col) => `$${row * colCount + col + 1}`).join(', ');
    valueClauses.push(`(${rowPlaceholders})`);
  }

  const updateCols = columns
    .filter(c => !conflictTarget.includes(c)) // Don't update PK columns
    .map(c => `${c} = EXCLUDED.${c}`)
    .join(', ');

  // If no columns to update (all columns are part of PK), use DO NOTHING
  if (!updateCols) {
    return `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${valueClauses.join(', ')} ON CONFLICT (${conflictTarget}) DO NOTHING`;
  }

  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${valueClauses.join(', ')} ON CONFLICT (${conflictTarget}) DO UPDATE SET ${updateCols}`;
}

// Batch size for upserts - keep smaller than overall batch to avoid query size limits
const UPSERT_BATCH_SIZE = 100;

// Tables where expired records should be excluded to save storage
// Expired = end_date is set and is in the past
const TABLES_TO_FILTER_EXPIRED = new Set([
  'legal_text',
  'legal_reference',
  'reimbursement_context',
  'vtm',
]);

/**
 * Check if a record is expired based on its end_date field
 */
function isExpired(record: ParsedRecord): boolean {
  const endDate = record.data.end_date;
  if (!endDate) return false; // No end_date means still active

  // Parse the date and compare to today
  const endDateObj = new Date(endDate as string);
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Compare dates only, not times

  return endDateObj <= today;
}

/**
 * Filter out expired records from tables that support it
 */
function filterExpiredRecords(records: ParsedRecord[], table: string): ParsedRecord[] {
  if (!TABLES_TO_FILTER_EXPIRED.has(table)) {
    return records; // Don't filter tables not in the list
  }

  return records.filter(record => !isExpired(record));
}

/**
 * Get the key columns for deduplication based on the conflict target
 */
function getConflictKeyColumns(table: string): string[] {
  const conflictTarget = UPSERT_CONFLICT_TARGETS[table];
  if (!conflictTarget) return [];

  // Parse the conflict target to extract column names
  // Handle cases like: 'code', 'code, delivery_environment', 'COALESCE(legal_reference_path, '')'
  return conflictTarget
    .split(',')
    .map(part => {
      const trimmed = part.trim();
      // Extract column name from COALESCE(col, '') patterns
      const coalesceMatch = trimmed.match(/COALESCE\((\w+),/);
      if (coalesceMatch) return coalesceMatch[1];
      // Otherwise it's just a column name
      return trimmed;
    });
}

/**
 * Build a unique key for a record based on its conflict target columns
 */
function buildRecordKey(record: ParsedRecord, keyColumns: string[]): string {
  return keyColumns
    .map(col => {
      const val = record.data[col];
      // Normalize null/undefined to empty string for key comparison
      return val === null || val === undefined ? '' : String(val);
    })
    .join('|||');
}

/**
 * Deduplicate records within a batch based on the conflict target.
 * Keeps the last occurrence of each duplicate (most recent).
 */
function deduplicateBatch(records: ParsedRecord[], table: string): ParsedRecord[] {
  const keyColumns = getConflictKeyColumns(table);
  if (keyColumns.length === 0) return records;

  // Use a Map to keep only the last occurrence of each key
  const seen = new Map<string, ParsedRecord>();
  for (const record of records) {
    const key = buildRecordKey(record, keyColumns);
    seen.set(key, record); // Overwrites duplicates, keeping the last one
  }

  return Array.from(seen.values());
}

async function importRecords(
  records: ParsedRecord[],
  dryRun: boolean,
  verbose: boolean
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  // Group records by table
  const byTable = new Map<string, ParsedRecord[]>();
  for (const record of records) {
    const existing = byTable.get(record.table) || [];
    existing.push(record);
    byTable.set(record.table, existing);
  }

  for (const [table, tableRecords] of byTable) {
    // Filter out expired records for applicable tables
    const activeRecords = filterExpiredRecords(tableRecords, table);
    const expiredCount = tableRecords.length - activeRecords.length;

    if (dryRun) {
      // In dry run, count records and mark table as having data
      counts[table] = (counts[table] || 0) + activeRecords.length;
      if (expiredCount > 0) {
        console.log(`   [DRY RUN] ${table}: ${expiredCount} expired records would be skipped`);
      }
      tablesWithData.add(table);
      continue;
    }

    // Deduplicate all records for this table first
    const deduplicatedRecords = deduplicateBatch(activeRecords, table);

    // Track successful upserts for this table
    let successfulUpserts = 0;

    // Group records by their column structure (they should all be the same, but just in case)
    const byColumns = new Map<string, ParsedRecord[]>();
    for (const record of deduplicatedRecords) {
      const colKey = Object.keys(record.data).sort().join(',');
      const existing = byColumns.get(colKey) || [];
      existing.push(record);
      byColumns.set(colKey, existing);
    }

    // Process each column group in batches
    for (const [, sameColRecords] of byColumns) {
      const columns = Object.keys(sameColRecords[0].data);

      // Process in batches of UPSERT_BATCH_SIZE
      for (let i = 0; i < sameColRecords.length; i += UPSERT_BATCH_SIZE) {
        const batch = sameColRecords.slice(i, i + UPSERT_BATCH_SIZE);

        // Flatten all values into a single array
        const allValues: unknown[] = [];
        for (const record of batch) {
          for (const col of columns) {
            allValues.push(record.data[col]);
          }
        }

        try {
          const upsertSql = buildBatchedUpsertQuery(table, columns, batch.length);
          await queryWithRetry(upsertSql, allValues);
          successfulUpserts += batch.length;
        } catch (error) {
          // If batch fails, fall back to individual inserts to identify problematic records
          if (verbose) {
            console.error(`   [WARN] Batch upsert failed for ${table}, falling back to individual: ${error}`);
          }
          for (const record of batch) {
            const values = columns.map(c => record.data[c]);
            try {
              const singleSql = buildBatchedUpsertQuery(table, columns, 1);
              await queryWithRetry(singleSql, values);
              successfulUpserts++;
            } catch (innerError) {
              if (verbose) {
                console.error(`   [ERROR] Failed to upsert into ${table}: ${innerError}`);
              }
            }
          }
        }
      }
    }

    // Only count successful upserts and mark table if any succeeded
    counts[table] = (counts[table] || 0) + successfulUpserts;
    if (successfulUpserts > 0) {
      tablesWithData.add(table);
    }
  }

  return counts;
}

/**
 * Populate dmpp_chapter_iv from reimbursement_context
 * This is a derived table - Chapter IV links are extracted from legal_reference_path
 */
async function populateDmppChapterIV(dryRun: boolean): Promise<void> {
  console.log('\n3b. Populating dmpp_chapter_iv...\n');

  if (dryRun) {
    console.log('   [DRY RUN] Would populate dmpp_chapter_iv');
    tablesWithData.add('dmpp_chapter_iv');
    return;
  }

  const result = await queryWithRetry(`
    INSERT INTO dmpp_chapter_iv (dmpp_code, delivery_environment, chapter_name, paragraph_name, sync_id)
    SELECT DISTINCT
      rc.dmpp_code,
      rc.delivery_environment,
      'IV',
      (regexp_match(rc.legal_reference_path, '-IV-(\\d+)$'))[1],
      $1::INTEGER
    FROM reimbursement_context rc
    WHERE rc.legal_reference_path ~ '-IV-\\d+$'
      AND (regexp_match(rc.legal_reference_path, '-IV-(\\d+)$'))[1] IS NOT NULL
    ON CONFLICT (dmpp_code, delivery_environment, chapter_name, paragraph_name)
    DO UPDATE SET sync_id = EXCLUDED.sync_id
  `, [currentSyncId]);

  const rowCount = result.rowCount || 0;
  tablesWithData.add('dmpp_chapter_iv');
  console.log(`   [OK] Populated dmpp_chapter_iv (${rowCount} rows)`);
}

/**
 * Delete records where sync_id != current sync_id (stale records)
 * Must delete children before parents to respect FK constraints
 */
async function sweepStaleRecords(dryRun: boolean): Promise<void> {
  console.log('\n4. Sweeping stale records...\n');

  // Order matters for foreign key constraints - children first, then parents
  const sweepOrder = [
    // Children first (reverse FK dependency order)
    'dmpp_chapter_iv', 'reimbursement_context', 'dmpp', 'ampp',
    'amp_ingredient', 'amp_component', 'amp', 'vmp',
    'legal_text', 'legal_reference', 'legal_basis',
    'chapter_iv_paragraph', 'company', 'vmp_group', 'vtm',
    'route_of_administration', 'pharmaceutical_form',
    'atc_classification', 'substance'
  ];

  if (dryRun) {
    console.log('   [DRY RUN] Would sweep stale records from:', sweepOrder.join(', '));
    return;
  }

  for (const table of sweepOrder) {
    if (!tablesWithData.has(table)) {
      continue; // Skip tables that weren't updated
    }

    try {
      const result = await queryWithRetry(
        `DELETE FROM ${table} WHERE sync_id IS NULL OR sync_id != $1`,
        [currentSyncId]
      );
      const deleted = result.rowCount || 0;
      if (deleted > 0) {
        console.log(`   [OK] ${table}: deleted ${deleted} stale records`);
      }
    } catch (error) {
      console.error(`   [ERROR] Failed to sweep ${table}: ${error}`);
    }
  }

  console.log('\n   [OK] Sweep complete');
}

/**
 * Populate search indexes using TRUNCATE + INSERT
 * Search indexes are derived tables, not synced from XML
 */
async function populateSearchIndexes(dryRun: boolean): Promise<void> {
  console.log('\n5. Populating search indexes...\n');

  if (dryRun) {
    console.log('   [DRY RUN] Would populate search_index and search_index_extended');
    return;
  }

  // Truncate and repopulate search_index
  console.log('   Populating search_index...');
  await queryWithRetry('TRUNCATE TABLE search_index RESTART IDENTITY');
  await queryWithRetry(`
    INSERT INTO search_index (
      entity_type, code, search_text, name, parent_code, parent_name,
      company_name, pack_info, price, reimbursable, cnk_code,
      product_count, black_triangle,
      vtm_code, vmp_code, amp_code, atc_code, company_actor_nr, vmp_group_code,
      end_date
    )

    -- VTM
    SELECT * FROM (
      SELECT DISTINCT ON (code)
        'vtm'::text as entity_type, code,
        LOWER(COALESCE(name->>'en','') || ' ' || COALESCE(name->>'nl','') || ' ' ||
              COALESCE(name->>'fr','') || ' ' || COALESCE(name->>'de','')) as search_text,
        name, NULL::text as parent_code, NULL::jsonb as parent_name,
        NULL::text as company_name, NULL::text as pack_info, NULL::numeric as price, NULL::boolean as reimbursable, NULL::text as cnk_code,
        NULL::int as product_count, NULL::boolean as black_triangle,
        NULL::text as vtm_code, NULL::text as vmp_code, NULL::text as amp_code, NULL::text as atc_code, NULL::text as company_actor_nr, NULL::text as vmp_group_code,
        end_date
      FROM vtm
      ORDER BY code
    ) vtm_sub

    UNION ALL

    -- VMP
    SELECT * FROM (
      SELECT DISTINCT ON (v.code)
        'vmp'::text, v.code,
        LOWER(COALESCE(v.name->>'en','') || ' ' || COALESCE(v.name->>'nl','') || ' ' ||
              COALESCE(v.name->>'fr','') || ' ' || COALESCE(v.name->>'de','') || ' ' ||
              COALESCE(v.abbreviated_name->>'en','') || ' ' || COALESCE(v.abbreviated_name->>'nl','')),
        v.name, v.vtm_code, vtm.name,
        NULL::text, NULL::text, NULL::numeric, NULL::boolean, NULL::text,
        NULL::int, NULL::boolean,
        v.vtm_code, NULL::text, NULL::text, NULL::text, NULL::text, v.vmp_group_code,
        v.end_date
      FROM vmp v
      LEFT JOIN vtm ON vtm.code = v.vtm_code
      ORDER BY v.code
    ) vmp_sub

    UNION ALL

    -- AMP
    SELECT * FROM (
      SELECT DISTINCT ON (a.code)
        'amp'::text, a.code,
        LOWER(COALESCE(a.name->>'en','') || ' ' || COALESCE(a.name->>'nl','') || ' ' ||
              COALESCE(a.name->>'fr','') || ' ' || COALESCE(a.name->>'de','') || ' ' ||
              COALESCE(a.abbreviated_name->>'en','') || ' ' || COALESCE(a.official_name,'')),
        a.name, a.vmp_code, v.name,
        c.denomination, NULL::text, NULL::numeric, NULL::boolean, NULL::text,
        NULL::int, a.black_triangle,
        v.vtm_code, a.vmp_code, NULL::text, NULL::text, a.company_actor_nr, NULL::text,
        a.end_date
      FROM amp a
      LEFT JOIN vmp v ON v.code = a.vmp_code
      LEFT JOIN company c ON c.actor_nr = a.company_actor_nr
      ORDER BY a.code
    ) amp_sub

    UNION ALL

    -- AMPP
    SELECT * FROM (
      SELECT DISTINCT ON (ampp.cti_extended)
        'ampp'::text, ampp.cti_extended,
        LOWER(COALESCE(ampp.prescription_name->>'en','') || ' ' ||
              COALESCE(ampp.prescription_name->>'nl','') || ' ' ||
              COALESCE(ampp.prescription_name->>'fr','') || ' ' ||
              COALESCE(amp.name->>'en','')),
        COALESCE(ampp.prescription_name, amp.name), ampp.amp_code, amp.name,
        NULL::text, ampp.pack_display_value, ampp.ex_factory_price,
        (SELECT EXISTS(
          SELECT 1 FROM dmpp d
          WHERE d.ampp_cti_extended = ampp.cti_extended
          AND d.reimbursable = true
          AND (d.end_date IS NULL OR d.end_date > CURRENT_DATE)
        ))::boolean,
        (SELECT d.code FROM dmpp d
         WHERE d.ampp_cti_extended = ampp.cti_extended
         AND d.delivery_environment = 'P'
         AND (d.end_date IS NULL OR d.end_date > CURRENT_DATE)
         LIMIT 1),
        NULL::int, NULL::boolean,
        v.vtm_code, amp.vmp_code, ampp.amp_code, ampp.atc_code, NULL::text, NULL::text,
        ampp.end_date
      FROM ampp
      JOIN amp ON amp.code = ampp.amp_code
      LEFT JOIN vmp v ON v.code = amp.vmp_code
      ORDER BY ampp.cti_extended
    ) ampp_sub

    UNION ALL

    -- Company
    SELECT * FROM (
      SELECT DISTINCT ON (c.actor_nr)
        'company'::text, c.actor_nr,
        LOWER(COALESCE(c.denomination,'')),
        jsonb_build_object('en', c.denomination, 'nl', c.denomination, 'fr', c.denomination, 'de', c.denomination),
        NULL::text, NULL::jsonb,
        NULL::text, NULL::text, NULL::numeric, NULL::boolean, NULL::text,
        (SELECT COUNT(*)::int FROM amp WHERE company_actor_nr = c.actor_nr), NULL::boolean,
        NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
        c.end_date
      FROM company c
      ORDER BY c.actor_nr
    ) company_sub

    UNION ALL

    -- VMP Group
    SELECT * FROM (
      SELECT DISTINCT ON (code)
        'vmp_group'::text, code,
        LOWER(COALESCE(name->>'en','') || ' ' || COALESCE(name->>'nl','') || ' ' || COALESCE(name->>'fr','')),
        name, NULL::text, NULL::jsonb,
        NULL::text, NULL::text, NULL::numeric, NULL::boolean, NULL::text,
        NULL::int, NULL::boolean,
        NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
        end_date
      FROM vmp_group
      ORDER BY code
    ) vmp_group_sub

    UNION ALL

    -- Substance
    SELECT * FROM (
      SELECT DISTINCT ON (code)
        'substance'::text, code,
        LOWER(COALESCE(name->>'en','') || ' ' || COALESCE(name->>'nl','') || ' ' || COALESCE(name->>'fr','')),
        name, NULL::text, NULL::jsonb,
        NULL::text, NULL::text, NULL::numeric, NULL::boolean, NULL::text,
        NULL::int, NULL::boolean,
        NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
        end_date
      FROM substance
      ORDER BY code
    ) substance_sub

    UNION ALL

    -- ATC
    SELECT * FROM (
      SELECT DISTINCT ON (code)
        'atc'::text, code,
        LOWER(COALESCE(description,'')),
        jsonb_build_object('en', description, 'nl', description, 'fr', description, 'de', description),
        NULL::text, NULL::jsonb,
        NULL::text, NULL::text, NULL::numeric, NULL::boolean, NULL::text,
        NULL::int, NULL::boolean,
        NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
        NULL::date
      FROM atc_classification
      ORDER BY code
    ) atc_sub
  `);
  console.log('   [OK] Populated search_index');

  // Truncate and repopulate search_index_extended
  console.log('   Populating search_index_extended...');
  await queryWithRetry('TRUNCATE TABLE search_index_extended RESTART IDENTITY');
  await queryWithRetry(`
    INSERT INTO search_index_extended (
      entity_type, code, search_text, name, parent_code, parent_name,
      company_name, pack_info, price, reimbursable, cnk_code,
      product_count, black_triangle,
      vtm_code, vmp_code, amp_code, atc_code, company_actor_nr, vmp_group_code,
      end_date,
      pharmaceutical_form_code, pharmaceutical_form_name,
      route_of_administration_code, route_of_administration_name,
      reimbursement_category, chapter_iv_exists, delivery_environment, medicine_type
    )

    -- VTM (no extended fields)
    SELECT * FROM (
      SELECT DISTINCT ON (code)
        'vtm'::text as entity_type, code,
        LOWER(COALESCE(name->>'en','') || ' ' || COALESCE(name->>'nl','') || ' ' ||
              COALESCE(name->>'fr','') || ' ' || COALESCE(name->>'de','')) as search_text,
        name, NULL::text as parent_code, NULL::jsonb as parent_name,
        NULL::text as company_name, NULL::text as pack_info, NULL::numeric as price, NULL::boolean as reimbursable, NULL::text as cnk_code,
        NULL::int as product_count, NULL::boolean as black_triangle,
        NULL::text as vtm_code, NULL::text as vmp_code, NULL::text as amp_code, NULL::text as atc_code, NULL::text as company_actor_nr, NULL::text as vmp_group_code,
        end_date,
        NULL::varchar(20) as pharmaceutical_form_code, NULL::jsonb as pharmaceutical_form_name,
        NULL::varchar(20) as route_of_administration_code, NULL::jsonb as route_of_administration_name,
        NULL::varchar(10) as reimbursement_category, FALSE as chapter_iv_exists, NULL::char(1) as delivery_environment, NULL::varchar(50) as medicine_type
      FROM vtm
      ORDER BY code
    ) vtm_sub

    UNION ALL

    -- VMP (no extended fields)
    SELECT * FROM (
      SELECT DISTINCT ON (v.code)
        'vmp'::text, v.code,
        LOWER(COALESCE(v.name->>'en','') || ' ' || COALESCE(v.name->>'nl','') || ' ' ||
              COALESCE(v.name->>'fr','') || ' ' || COALESCE(v.name->>'de','') || ' ' ||
              COALESCE(v.abbreviated_name->>'en','') || ' ' || COALESCE(v.abbreviated_name->>'nl','')),
        v.name, v.vtm_code, vtm.name,
        NULL::text, NULL::text, NULL::numeric, NULL::boolean, NULL::text,
        NULL::int, NULL::boolean,
        v.vtm_code, NULL::text, NULL::text, NULL::text, NULL::text, v.vmp_group_code,
        v.end_date,
        NULL::varchar(20), NULL::jsonb,
        NULL::varchar(20), NULL::jsonb,
        NULL::varchar(10), FALSE, NULL::char(1), NULL::varchar(50)
      FROM vmp v
      LEFT JOIN vtm ON vtm.code = v.vtm_code
      ORDER BY v.code
    ) vmp_sub

    UNION ALL

    -- AMP (with pharmaceutical_form, route_of_administration, medicine_type)
    SELECT * FROM (
      SELECT DISTINCT ON (a.code)
        'amp'::text, a.code,
        LOWER(COALESCE(a.name->>'en','') || ' ' || COALESCE(a.name->>'nl','') || ' ' ||
              COALESCE(a.name->>'fr','') || ' ' || COALESCE(a.name->>'de','') || ' ' ||
              COALESCE(a.abbreviated_name->>'en','') || ' ' || COALESCE(a.official_name,'')),
        a.name, a.vmp_code, v.name,
        c.denomination, NULL::text, NULL::numeric, NULL::boolean, NULL::text,
        NULL::int, a.black_triangle,
        v.vtm_code, a.vmp_code, NULL::text, NULL::text, a.company_actor_nr, NULL::text,
        a.end_date,
        comp.pharmaceutical_form_code, pf.name,
        comp.route_of_administration_code, roa.name,
        NULL::varchar(10), FALSE, NULL::char(1), a.medicine_type
      FROM amp a
      LEFT JOIN vmp v ON v.code = a.vmp_code
      LEFT JOIN company c ON c.actor_nr = a.company_actor_nr
      LEFT JOIN amp_component comp ON comp.amp_code = a.code AND comp.sequence_nr = 1
      LEFT JOIN pharmaceutical_form pf ON pf.code = comp.pharmaceutical_form_code
      LEFT JOIN route_of_administration roa ON roa.code = comp.route_of_administration_code
      ORDER BY a.code
    ) amp_sub

    UNION ALL

    -- AMPP (with reimbursement_category, chapter_iv_exists, delivery_environment)
    SELECT * FROM (
      SELECT DISTINCT ON (ampp.cti_extended)
        'ampp'::text, ampp.cti_extended,
        LOWER(COALESCE(ampp.prescription_name->>'en','') || ' ' ||
              COALESCE(ampp.prescription_name->>'nl','') || ' ' ||
              COALESCE(ampp.prescription_name->>'fr','') || ' ' ||
              COALESCE(amp.name->>'en','')),
        COALESCE(ampp.prescription_name, amp.name), ampp.amp_code, amp.name,
        NULL::text, ampp.pack_display_value, ampp.ex_factory_price,
        (SELECT EXISTS(
          SELECT 1 FROM dmpp d
          WHERE d.ampp_cti_extended = ampp.cti_extended
          AND d.reimbursable = true
          AND (d.end_date IS NULL OR d.end_date > CURRENT_DATE)
        ))::boolean,
        (SELECT d.code FROM dmpp d
         WHERE d.ampp_cti_extended = ampp.cti_extended
         AND d.delivery_environment = 'P'
         AND (d.end_date IS NULL OR d.end_date > CURRENT_DATE)
         LIMIT 1),
        NULL::int, NULL::boolean,
        v.vtm_code, amp.vmp_code, ampp.amp_code, ampp.atc_code, NULL::text, NULL::text,
        ampp.end_date,
        comp.pharmaceutical_form_code, pf.name,
        comp.route_of_administration_code, roa.name,
        (SELECT rc.reimbursement_criterion_category FROM reimbursement_context rc
         JOIN dmpp d ON d.code = rc.dmpp_code AND d.delivery_environment = rc.delivery_environment
         WHERE d.ampp_cti_extended = ampp.cti_extended
         AND (rc.end_date IS NULL OR rc.end_date > CURRENT_DATE)
         LIMIT 1),
        (SELECT EXISTS(
          SELECT 1 FROM dmpp d
          JOIN dmpp_chapter_iv dc ON dc.dmpp_code = d.code AND dc.delivery_environment = d.delivery_environment
          WHERE d.ampp_cti_extended = ampp.cti_extended
        ))::boolean,
        (SELECT d.delivery_environment FROM dmpp d
         WHERE d.ampp_cti_extended = ampp.cti_extended
         AND (d.end_date IS NULL OR d.end_date > CURRENT_DATE)
         LIMIT 1),
        amp.medicine_type
      FROM ampp
      JOIN amp ON amp.code = ampp.amp_code
      LEFT JOIN vmp v ON v.code = amp.vmp_code
      LEFT JOIN amp_component comp ON comp.amp_code = amp.code AND comp.sequence_nr = 1
      LEFT JOIN pharmaceutical_form pf ON pf.code = comp.pharmaceutical_form_code
      LEFT JOIN route_of_administration roa ON roa.code = comp.route_of_administration_code
      ORDER BY ampp.cti_extended
    ) ampp_sub

    UNION ALL

    -- Company (no extended fields)
    SELECT * FROM (
      SELECT DISTINCT ON (c.actor_nr)
        'company'::text, c.actor_nr,
        LOWER(COALESCE(c.denomination,'')),
        jsonb_build_object('en', c.denomination, 'nl', c.denomination, 'fr', c.denomination, 'de', c.denomination),
        NULL::text, NULL::jsonb,
        NULL::text, NULL::text, NULL::numeric, NULL::boolean, NULL::text,
        (SELECT COUNT(*)::int FROM amp WHERE company_actor_nr = c.actor_nr), NULL::boolean,
        NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
        c.end_date,
        NULL::varchar(20), NULL::jsonb,
        NULL::varchar(20), NULL::jsonb,
        NULL::varchar(10), FALSE, NULL::char(1), NULL::varchar(50)
      FROM company c
      ORDER BY c.actor_nr
    ) company_sub

    UNION ALL

    -- VMP Group (no extended fields)
    SELECT * FROM (
      SELECT DISTINCT ON (code)
        'vmp_group'::text, code,
        LOWER(COALESCE(name->>'en','') || ' ' || COALESCE(name->>'nl','') || ' ' || COALESCE(name->>'fr','')),
        name, NULL::text, NULL::jsonb,
        NULL::text, NULL::text, NULL::numeric, NULL::boolean, NULL::text,
        NULL::int, NULL::boolean,
        NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
        end_date,
        NULL::varchar(20), NULL::jsonb,
        NULL::varchar(20), NULL::jsonb,
        NULL::varchar(10), FALSE, NULL::char(1), NULL::varchar(50)
      FROM vmp_group
      ORDER BY code
    ) vmp_group_sub

    UNION ALL

    -- Substance (no extended fields)
    SELECT * FROM (
      SELECT DISTINCT ON (code)
        'substance'::text, code,
        LOWER(COALESCE(name->>'en','') || ' ' || COALESCE(name->>'nl','') || ' ' || COALESCE(name->>'fr','')),
        name, NULL::text, NULL::jsonb,
        NULL::text, NULL::text, NULL::numeric, NULL::boolean, NULL::text,
        NULL::int, NULL::boolean,
        NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
        end_date,
        NULL::varchar(20), NULL::jsonb,
        NULL::varchar(20), NULL::jsonb,
        NULL::varchar(10), FALSE, NULL::char(1), NULL::varchar(50)
      FROM substance
      ORDER BY code
    ) substance_sub

    UNION ALL

    -- ATC (no extended fields)
    SELECT * FROM (
      SELECT DISTINCT ON (code)
        'atc'::text, code,
        LOWER(COALESCE(description,'')),
        jsonb_build_object('en', description, 'nl', description, 'fr', description, 'de', description),
        NULL::text, NULL::jsonb,
        NULL::text, NULL::text, NULL::numeric, NULL::boolean, NULL::text,
        NULL::int, NULL::boolean,
        NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
        NULL::date,
        NULL::varchar(20), NULL::jsonb,
        NULL::varchar(20), NULL::jsonb,
        NULL::varchar(10), FALSE, NULL::char(1), NULL::varchar(50)
      FROM atc_classification
      ORDER BY code
    ) atc_sub
  `);
  console.log('   [OK] Populated search_index_extended');

  // Recreate indexes
  console.log('   Recreating search indexes...');

  // search_index indexes
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_text_trgm ON search_index USING GIN (search_text gin_trgm_ops)`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_code ON search_index (code)`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_cnk ON search_index (cnk_code) WHERE cnk_code IS NOT NULL`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_vtm ON search_index (vtm_code) WHERE vtm_code IS NOT NULL`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_vmp ON search_index (vmp_code) WHERE vmp_code IS NOT NULL`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_amp ON search_index (amp_code) WHERE amp_code IS NOT NULL`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_atc ON search_index (atc_code) WHERE atc_code IS NOT NULL`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_company ON search_index (company_actor_nr) WHERE company_actor_nr IS NOT NULL`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_vmp_group ON search_index (vmp_group_code) WHERE vmp_group_code IS NOT NULL`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_entity_type ON search_index (entity_type)`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_end_date ON search_index (end_date) WHERE end_date IS NOT NULL`);

  // search_index_extended indexes
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_ext_text_trgm ON search_index_extended USING GIN (search_text gin_trgm_ops)`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_ext_code ON search_index_extended (code)`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_ext_cnk ON search_index_extended (cnk_code) WHERE cnk_code IS NOT NULL`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_ext_vtm ON search_index_extended (vtm_code) WHERE vtm_code IS NOT NULL`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_ext_vmp ON search_index_extended (vmp_code) WHERE vmp_code IS NOT NULL`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_ext_amp ON search_index_extended (amp_code) WHERE amp_code IS NOT NULL`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_ext_atc ON search_index_extended (atc_code) WHERE atc_code IS NOT NULL`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_ext_company ON search_index_extended (company_actor_nr) WHERE company_actor_nr IS NOT NULL`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_ext_vmp_group ON search_index_extended (vmp_group_code) WHERE vmp_group_code IS NOT NULL`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_ext_entity_type ON search_index_extended (entity_type)`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_ext_end_date ON search_index_extended (end_date) WHERE end_date IS NOT NULL`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_ext_form ON search_index_extended (pharmaceutical_form_code) WHERE pharmaceutical_form_code IS NOT NULL`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_ext_route ON search_index_extended (route_of_administration_code) WHERE route_of_administration_code IS NOT NULL`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_ext_reimb_cat ON search_index_extended (reimbursement_category) WHERE reimbursement_category IS NOT NULL`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_ext_medicine_type ON search_index_extended (medicine_type) WHERE medicine_type IS NOT NULL`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_ext_delivery_env ON search_index_extended (delivery_environment) WHERE delivery_environment IS NOT NULL`);
  await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_search_ext_chapter_iv ON search_index_extended (chapter_iv_exists) WHERE chapter_iv_exists = TRUE`);

  console.log('   [OK] Search indexes ready');
}

// ============================================================================
// Main processing
// ============================================================================

async function processXmlFile(
  filePath: string,
  elementName: string,
  transformer: (element: XmlElement) => ParsedRecord | ParsedRecord[] | null,
  progress: ProgressState,
  dryRun: boolean,
  verbose: boolean
): Promise<void> {
  console.log(`   Processing ${filePath}...`);

  let processedCount = 0;
  const batchRecords: ParsedRecord[] = [];
  const startTime = Date.now();
  let lastSave = startTime;

  for await (const element of parseXmlFile(filePath, elementName, verbose)) {
    const result = transformer(element);

    if (result) {
      if (Array.isArray(result)) {
        batchRecords.push(...result);
      } else {
        batchRecords.push(result);
      }
    }

    processedCount++;

    // Import in batches
    if (batchRecords.length >= CONFIG.batchSize) {
      const counts = await importRecords(batchRecords, dryRun, verbose);
      for (const [table, count] of Object.entries(counts)) {
        progress.recordCounts[table] = (progress.recordCounts[table] || 0) + count;
      }
      batchRecords.length = 0;

      // Progress update
      if (Date.now() - lastSave > CONFIG.saveInterval) {
        saveProgress(progress);
        lastSave = Date.now();
      }

      if (verbose) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = processedCount / elapsed;
        process.stdout.write(`\r   Processed ${processedCount} elements (${rate.toFixed(0)}/s)...`);
      }
    }
  }

  // Import remaining records
  if (batchRecords.length > 0) {
    const counts = await importRecords(batchRecords, dryRun, verbose);
    for (const [table, count] of Object.entries(counts)) {
      progress.recordCounts[table] = (progress.recordCounts[table] || 0) + count;
    }
  }

  if (verbose) {
    console.log(`\r   Processed ${processedCount} ${elementName} elements.          `);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const hasFlag = (name: string): boolean => args.includes(`--${name}`);

  const dryRun = hasFlag('dry-run');
  const resume = hasFlag('resume');
  const verbose = hasFlag('verbose');
  const skipDownload = hasFlag('skip-download');

  console.log('\n======================================');
  console.log('   SAM Database Sync Tool');
  console.log('======================================\n');

  if (dryRun) console.log('   Mode: DRY RUN (no database changes)');
  if (resume) console.log('   Mode: RESUME (continuing previous sync)');
  if (verbose) console.log('   Mode: VERBOSE');
  if (skipDownload) console.log('   Mode: SKIP DOWNLOAD (using existing files)');

  // Check DATABASE_URL
  if (!process.env.DATABASE_URL && !dryRun) {
    console.error('\n   ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  // Initialize or load progress
  let progress = resume ? loadProgress() : null;
  if (!progress) {
    progress = initProgress();
  }

  // Set the current sync ID
  currentSyncId = progress.syncId || Math.floor(Date.now() / 1000);
  progress.syncId = currentSyncId;

  const startTime = Date.now();

  try {
    // Phase 1: Download (or check existing files if skip-download)
    if (progress.phase === 'download') {
      if (skipDownload) {
        // Check for existing files without downloading
        console.log('\n1. Checking existing XML exports...\n');
        for (const [prefix, expName] of Object.entries(CONFIG.fileMapping)) {
          const files = existsSync(CONFIG.exportDir)
            ? readdirSync(CONFIG.exportDir).filter(f =>
                f.startsWith(prefix) && f.toLowerCase().endsWith('.xml')
              )
            : [];
          if (files.length > 0) {
            console.log(`   [OK] ${expName}: using existing file ${files[0]}`);
            if (!progress.filesDownloaded.includes(expName)) {
              progress.filesDownloaded.push(expName);
            }
          } else {
            console.log(`   [MISSING] ${expName}: not found`);
          }
        }
      } else {
        const hasFiles = await downloadExports(progress, verbose);
        if (!hasFiles) {
          console.log('\n   No XML export files found.');
          console.log('   Download SAM exports from: ' + CONFIG.samPortal);
          console.log('   Place them in: ' + CONFIG.exportDir);
          process.exit(1);
        }
      }

      // ALL-OR-NOTHING: Require ALL file types to be present
      const missingFiles = REQUIRED_FILE_TYPES.filter(
        ft => !progress!.filesDownloaded.includes(ft)
      );

      if (missingFiles.length > 0) {
        console.error('\n   [ERROR] ALL-OR-NOTHING VALIDATION FAILED');
        console.error('   Missing required files:', missingFiles.join(', '));
        console.error('   All SAM export files must be present to prevent partial/stale data.');
        console.error('   Download from: ' + CONFIG.samPortal);
        console.error('   Place in: ' + CONFIG.exportDir);
        process.exit(1);
      }

      console.log('\n   [OK] All required files present');
      progress.phase = 'migrate';
      saveProgress(progress);
    }

    // Phase 2: Ensure sync_id columns exist (idempotent migration)
    if (progress.phase === 'migrate') {
      await ensureSyncIdColumns(dryRun);
      progress.phase = 'import';
      saveProgress(progress);
    }

    // Phase 3: Parse and import (upsert)
    if (progress.phase === 'import') {
      console.log('\n3. Parsing and importing XML data...\n');

      // Find XML files and organize by type
      const xmlFiles = existsSync(CONFIG.exportDir)
        ? readdirSync(CONFIG.exportDir).filter(f => f.endsWith('.xml'))
        : [];

      const filesByType: Record<string, string> = {};
      for (const file of xmlFiles) {
        for (const prefix of Object.keys(CONFIG.fileMapping)) {
          if (file.startsWith(prefix)) {
            filesByType[CONFIG.fileMapping[prefix]] = join(CONFIG.exportDir, file);
            break;
          }
        }
      }

      // Process files in dependency order:
      // 1. Reference data (REF) - substances, ATC, forms, routes
      // 2. Companies (CPN)
      // 3. Legal texts (RML)
      // 4. VMP hierarchy (VMP) - VTM, VmpGroup, Vmp
      // 5. AMP hierarchy (AMP) - AMP, components, ingredients, AMPP, DMPP
      // 6. Reimbursement (RMB) - must come after AMP to validate DMPP references
      // 7. Chapter IV (CHAPTERIV)

      if (filesByType.REF) {
        await processXmlFile(filesByType.REF, 'Substance', transformSubstance, progress, dryRun, verbose);
        await processXmlFile(filesByType.REF, 'AtcClassification', transformAtcClassification, progress, dryRun, verbose);
        await processXmlFile(filesByType.REF, 'PharmaceuticalForm', transformPharmaceuticalForm, progress, dryRun, verbose);
        await processXmlFile(filesByType.REF, 'RouteOfAdministration', transformRouteOfAdministration, progress, dryRun, verbose);
      }

      if (filesByType.CPN) {
        await processXmlFile(filesByType.CPN, 'Company', transformCompany, progress, dryRun, verbose);
      }

      if (filesByType.RML) {
        await processXmlFile(filesByType.RML, 'LegalBasis', transformLegalBasis, progress, dryRun, verbose);
      }

      if (filesByType.VMP) {
        await processXmlFile(filesByType.VMP, 'Vtm', transformVtm, progress, dryRun, verbose);
        await processXmlFile(filesByType.VMP, 'VmpGroup', transformVmpGroup, progress, dryRun, verbose);
        await processXmlFile(filesByType.VMP, 'Vmp', transformVmp, progress, dryRun, verbose);
      }

      if (filesByType.AMP) {
        // AMP file contains AMP, Components, Ingredients, AMPP, DMPP
        // This also populates validDmppCodes for reimbursement context validation
        await processXmlFile(filesByType.AMP, 'Amp', transformAmp, progress, dryRun, verbose);
      }

      if (filesByType.RMB) {
        // Reimbursement contexts - must be processed after AMP to filter orphaned DMPP references
        await processXmlFile(filesByType.RMB, 'ReimbursementContext', transformReimbursementContext, progress, dryRun, verbose);
      }

      if (filesByType.CHAPTERIV) {
        await processXmlFile(filesByType.CHAPTERIV, 'Paragraph', transformChapterIVParagraph, progress, dryRun, verbose);
      }

      // Populate derived table from imported data
      await populateDmppChapterIV(dryRun);

      progress.phase = 'sweep';
      saveProgress(progress);
    }

    // Phase 4: Sweep stale records
    if (progress.phase === 'sweep') {
      // CRITICAL: Validate ALL expected tables have data before sweeping ANY
      const missingTables = validateAllTablesHaveData();

      if (missingTables.length > 0) {
        console.error('\n   [ERROR] ALL-OR-NOTHING VALIDATION FAILED');
        console.error('   The following expected tables have no data:', missingTables.join(', '));
        console.error('   Aborting sync to prevent partial/stale data.');
        console.error('   No records have been deleted from the database.');
        throw new Error(`Missing data for tables: ${missingTables.join(', ')}`);
      }

      await sweepStaleRecords(dryRun);
      progress.phase = 'search';
      saveProgress(progress);
    }

    // Phase 5: Populate search indexes
    if (progress.phase === 'search') {
      await populateSearchIndexes(dryRun);
      progress.phase = 'done';
      saveProgress(progress);
    }

    // Summary
    const elapsed = (Date.now() - startTime) / 1000;
    console.log('\n======================================');
    console.log('   Sync Complete!');
    console.log('======================================\n');
    console.log(`   Duration: ${formatTime(elapsed)}`);
    console.log(`   Sync ID: ${currentSyncId}`);

    const recordEntries = Object.entries(progress.recordCounts).sort();
    if (recordEntries.length > 0) {
      console.log('\n   Record counts:');
      for (const [table, count] of recordEntries) {
        console.log(`      ${table}: ${count.toLocaleString()}`);
      }
    } else {
      console.log('\n   [WARN] No records were processed.');
      console.log('   Check that XML files exist and contain valid data.');
    }

    // Show tables that were updated
    if (tablesWithData.size > 0) {
      console.log('\n   Tables with data:', Array.from(tablesWithData).sort().join(', '));
    }

    // Cleanup progress file
    if (!dryRun && existsSync(CONFIG.progressFile)) {
      unlinkSync(CONFIG.progressFile);
    }
  } catch (error) {
    console.error('\n   ERROR:', error);
    progress.errors.push(String(error));
    saveProgress(progress);
    process.exit(1);
  } finally {
    if (dbClient) {
      dbClient.release();
    }
  }
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

main().catch(err => {
  console.error('\n   Fatal error:', err.message);
  process.exit(1);
});
