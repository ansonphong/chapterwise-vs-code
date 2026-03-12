/**
 * Codex Model - Parsing and manipulation of YAML/JSON codex files
 * Supports ChapterWise Codex Format V1.0, V1.1, and Codex Lite (Markdown)
 * 
 * Codex Lite: Markdown files with YAML frontmatter are treated as flat
 * codex documents with a single root node.
 */

import * as YAML from 'yaml';
import * as path from 'path';
import { randomUUID } from 'crypto';

/**
 * Represents a path segment to navigate to a node in the document
 */
export type PathSegment = string | number;

/**
 * Represents a single node in the Codex hierarchy
 */
export interface CodexNode {
  id: string;
  type: string;
  name: string;
  proseField: string;           // Which field contains prose: 'body', 'summary', etc.
  proseValue: string;           // The actual prose content
  availableFields: string[];    // All prose fields available on this node
  path: PathSegment[];          // Path to this node in the document
  lineNumber?: number;          // Line number in source file (for navigation)
  children: CodexNode[];        // Child nodes
  parent?: CodexNode;           // Parent node reference (for navigation and circular ref detection)
  attributes?: CodexAttribute[];
  contentSections?: CodexContentSection[];  // Content array sections
  relations?: CodexRelation[];
  tags?: string[];
  image?: string;
  images?: CodexImage[];
  hasImages: boolean;
  hasAttributes: boolean;       // Whether node has attributes array
  hasContentSections: boolean;  // Whether node has content array
  isInclude?: boolean;          // Whether this is an include directive (not a real node)
  includePath?: string;         // Path to included file
}

/**
 * Represents an attribute on a node
 */
export interface CodexAttribute {
  key: string;
  name?: string;
  value: unknown;
  dataType?: string;
  id?: string;
  type?: string;
}

/**
 * Represents a content section on a node
 */
export interface CodexContentSection {
  key: string;
  name: string;
  value: string;
  id?: string;
  type?: string;
}

/**
 * Represents a relation between nodes
 */
export interface CodexRelation {
  targetId: string;          // Changed from 'target' to match schema
  type?: string;             // Relation type (ally, enemy, parent, etc.)
  kind?: string;             // Alternative to type
  strength?: number;         // 0-1 confidence
  reciprocal?: boolean;      // Bidirectional flag
  description?: string;
}

/**
 * Represents an image attached to a node
 */
export interface CodexImage {
  url: string;
  caption?: string;
  alt?: string;
  featured?: boolean;
}

/**
 * Represents a parsed Codex document
 */
export interface CodexDocument {
  metadata: CodexMetadata;
  rootNode: CodexNode | null;
  allNodes: CodexNode[];        // Flattened list of all nodes
  types: Set<string>;           // All unique node types
  rawDoc: YAML.Document.Parsed | null;
  isJson: boolean;
  isMarkdown: boolean;          // True for Codex Lite (.md) files
  rawText: string;
  frontmatter?: Record<string, unknown>;  // Original frontmatter (for markdown)
}

/**
 * Codex metadata object
 */
export interface CodexMetadata {
  formatVersion: string;
  documentVersion?: string;
  created?: string;
  updated?: string;
  author?: string;
  license?: string;
}

/**
 * Validation error/warning
 */
export interface CodexValidationIssue {
  message: string;
  severity: 'error' | 'warning' | 'info';
  line?: number;
  column?: number;
  path?: PathSegment[];
}

/**
 * Determines if a file is a Codex file based on extension
 */
export function isCodexFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.codex.yaml') || 
         lower.endsWith('.codex.json') || 
         lower.endsWith('.codex');
}

/**
 * Determines if a file is a Markdown file (Codex Lite)
 */
export function isMarkdownFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.md');
}

/**
 * Determines if a file is Codex-like (full Codex OR Markdown/Codex Lite)
 */
export function isCodexLikeFile(fileName: string): boolean {
  return isCodexFile(fileName) || isMarkdownFile(fileName);
}

/**
 * Determines if the content is JSON
 */
export function isJsonContent(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

/**
 * Threshold for when to use block scalar style (pipe |)
 */
const BLOCK_SCALAR_THRESHOLD = 60;

/**
 * Creates a YAML block scalar for long strings, or returns the string as-is for short ones.
 * Used to ensure consistent pipe (|) syntax for long content in YAML output.
 */
function createBlockScalarIfNeeded(doc: YAML.Document, value: string): YAML.Scalar | string {
  if (typeof value === 'string' && (value.includes('\n') || value.length > BLOCK_SCALAR_THRESHOLD)) {
    const scalar = new YAML.Scalar(value);
    scalar.type = YAML.Scalar.BLOCK_LITERAL;
    return scalar;
  }
  return value;
}

/**
 * All possible prose fields in priority order
 */
export const PROSE_FIELDS = ['body', 'summary', 'description', 'content', 'text'];

/**
 * Prose fields allowed for Codex Lite (Markdown) files
 * Only body and summary are supported in markdown format
 */
const CODEX_LITE_PROSE_FIELDS = ['body', 'summary'];

/**
 * Gets all available prose fields from a node object
 */
function getAvailableProseFields(nodeObj: Record<string, unknown>): string[] {
  return PROSE_FIELDS.filter(field => field in nodeObj && typeof nodeObj[field] === 'string');
}

/**
 * Gets available prose fields, respecting Codex Lite limitations for markdown files
 */
function getAvailableProseFieldsForFormat(
  nodeObj: Record<string, unknown>,
  isMarkdown: boolean
): string[] {
  if (isMarkdown) {
    // For Codex Lite (markdown), only support body and summary
    return CODEX_LITE_PROSE_FIELDS.filter(field => field in nodeObj && typeof nodeObj[field] === 'string');
  } else {
    // For full Codex, support all prose fields
    return getAvailableProseFields(nodeObj);
  }
}

/**
 * Gets the primary prose field from a node object
 */
function getProseField(nodeObj: Record<string, unknown>): { field: string; value: string; availableFields: string[] } {
  const availableFields = getAvailableProseFields(nodeObj);
  
  for (const field of PROSE_FIELDS) {
    if (field in nodeObj && typeof nodeObj[field] === 'string') {
      return { field, value: nodeObj[field] as string, availableFields };
    }
  }
  
  return { field: 'body', value: '', availableFields };
}

/**
 * Walk the YAML document to find line numbers for paths
 */
function findLineNumber(doc: YAML.Document.Parsed, path: PathSegment[]): number | undefined {
  try {
    let current: unknown = doc.contents;
    
    for (const segment of path) {
      if (current === null || current === undefined) {
        return undefined;
      }
      
      if (YAML.isMap(current)) {
        const pair = current.items.find(item => {
          const key = YAML.isScalar(item.key) ? item.key.value : item.key;
          return key === segment;
        });
        if (pair) {
          current = pair.value;
        } else {
          return undefined;
        }
      } else if (YAML.isSeq(current)) {
        const idx = typeof segment === 'number' ? segment : parseInt(segment as string, 10);
        current = current.items[idx];
      } else {
        return undefined;
      }
    }
    
    if (current && typeof current === 'object' && 'range' in current) {
      const range = (current as { range?: [number, number, number] }).range;
      if (range && doc.contents) {
        // Convert character offset to line number
        const text = doc.toString();
        const offset = range[0];
        const beforeOffset = text.substring(0, offset);
        return beforeOffset.split('\n').length;
      }
    }
  } catch {
    return undefined;
  }
  
  return undefined;
}

/**
 * Parse a single node object into a CodexNode
 */
function parseNode(
  nodeObj: Record<string, unknown>,
  path: PathSegment[],
  doc: YAML.Document.Parsed | null,
  isMarkdown: boolean = false
): CodexNode {
  // Check if this is an include directive
  const isInclude = 'include' in nodeObj && typeof nodeObj.include === 'string';
  const includePath = isInclude ? (nodeObj.include as string) : undefined;
  
  const id = (nodeObj.id as string) ?? '';
  const type = isInclude ? 'include' : ((nodeObj.type as string) ?? 'unknown');
  const name = isInclude 
    ? includePath!.split('/').pop()?.replace('.codex.yaml', '').replace('.codex.json', '') ?? '(include)'
    : ((nodeObj.name as string) ?? (nodeObj.title as string) ?? id ?? '(untitled)');
  
  const baseAvailableFields = getAvailableProseFieldsForFormat(nodeObj, isMarkdown);
  const proseField = baseAvailableFields.length > 0 ? baseAvailableFields[0] : 'body';
  const proseValue = (nodeObj[proseField] as string) ?? '';
  
  const hasAttributes = Array.isArray(nodeObj.attributes) && nodeObj.attributes.length > 0;
  const hasContentSections = Array.isArray(nodeObj.content) && nodeObj.content.length > 0;

  // Extract images
  const rawImages = nodeObj.images;
  let images: CodexImage[] | undefined;
  let hasImages = false;

  if (Array.isArray(rawImages) && rawImages.length > 0) {
    hasImages = true;
    images = rawImages.map((img: unknown) => ({
      url: typeof img === 'string' ? img : ((img as Record<string, unknown>).url as string || ''),
      caption: (img as Record<string, unknown>).caption as string | undefined,
      alt: (img as Record<string, unknown>).alt as string | undefined,
      featured: (img as Record<string, unknown>).featured as boolean | undefined,
    })).filter(img => img.url);
  }
  
  // availableFields should only contain actual prose field names
  const availableFields = [...baseAvailableFields];
  
  const node: CodexNode = {
    id,
    type,
    name,
    proseField,
    proseValue,
    availableFields,
    path: [...path],
    lineNumber: doc ? findLineNumber(doc, path) : undefined,
    children: [],
    hasAttributes,
    hasContentSections,
    hasImages,
    images,
    isInclude,
    includePath,
  };
  
  // Parse attributes
  if (Array.isArray(nodeObj.attributes)) {
    node.attributes = nodeObj.attributes.map((attr: unknown) => {
      const a = attr as Record<string, unknown>;
      return {
        key: (a.key as string) ?? '',
        name: a.name as string | undefined,
        value: a.value,
        dataType: a.dataType as string | undefined,
        id: a.id as string | undefined,
        type: a.type as string | undefined,
      };
    });
  }
  
  // Parse content sections
  if (Array.isArray(nodeObj.content)) {
    node.contentSections = nodeObj.content.map((item: unknown) => {
      const c = item as Record<string, unknown>;
      return {
        key: (c.key as string) ?? '',
        name: (c.name as string) ?? '',
        value: (c.value as string) ?? '',
        id: c.id as string | undefined,
        type: c.type as string | undefined,
      };
    });
  }
  
  // Parse relations
  if (Array.isArray(nodeObj.relations)) {
    node.relations = nodeObj.relations.map((rel: unknown) => {
      const r = rel as Record<string, unknown>;
      return {
        targetId: (r.targetId as string) ?? '',
        type: r.type as string | undefined,
        kind: r.kind as string | undefined,
        strength: r.strength as number | undefined,
        reciprocal: r.reciprocal as boolean | undefined,
        description: r.description as string | undefined,
      };
    });
  }
  
  // Parse tags
  if (Array.isArray(nodeObj.tags)) {
    node.tags = nodeObj.tags.filter((t): t is string => typeof t === 'string');
  }
  
  // Parse image
  if (typeof nodeObj.image === 'string') {
    node.image = nodeObj.image;
  }
  
  // Recursively parse children
  if (Array.isArray(nodeObj.children)) {
    nodeObj.children.forEach((child: unknown, idx: number) => {
      if (child && typeof child === 'object') {
        const childPath = [...path, 'children', idx];
        const childNode = parseNode(child as Record<string, unknown>, childPath, doc, isMarkdown);
        childNode.parent = node;  // Set parent reference
        node.children.push(childNode);
      }
    });
  }
  
  return node;
}

/**
 * Flatten the node tree into a list
 */
function flattenNodes(node: CodexNode): CodexNode[] {
  const result: CodexNode[] = [node];
  for (const child of node.children) {
    result.push(...flattenNodes(child));
  }
  return result;
}

/**
 * Parse a Codex document from text (YAML or JSON)
 */
export function parseCodex(text: string): CodexDocument | null {
  try {
    const isJson = isJsonContent(text);
    let rawDoc: YAML.Document.Parsed | null = null;
    let root: Record<string, unknown>;
    
    if (isJson) {
      root = JSON.parse(text);
    } else {
      rawDoc = YAML.parseDocument(text);
      root = rawDoc.toJS() as Record<string, unknown>;
    }
    
    if (!root || typeof root !== 'object') {
      return null;
    }
    
    // Check for legacy format with 'data' wrapper (should be rejected)
    if ('data' in root && !('metadata' in root)) {
      return null;
    }
    
    // Parse metadata
    const metadataObj = root.metadata as Record<string, unknown> | undefined;
    const metadata: CodexMetadata = {
      formatVersion: (metadataObj?.formatVersion as string) ?? '',
      documentVersion: metadataObj?.documentVersion as string | undefined,
      created: metadataObj?.created as string | undefined,
      updated: metadataObj?.updated as string | undefined,
      author: metadataObj?.author as string | undefined,
      license: metadataObj?.license as string | undefined,
    };
    
    // Parse the root node (the document itself is the root node in V1.0+)
    // isMarkdown=false for full Codex files (YAML/JSON)
    const rootNode = parseNode(root, [], rawDoc, false);
    
    // Collect all nodes and types
    const allNodes = flattenNodes(rootNode);
    const types = new Set<string>();
    for (const node of allNodes) {
      if (node.type && node.type !== 'unknown') {
        types.add(node.type);
      }
    }
    
    return {
      metadata,
      rootNode,
      allNodes,
      types,
      rawDoc,
      isJson,
      isMarkdown: false,
      rawText: text,
    };
  } catch {
    return null;
  }
}

/**
 * Codex Lite field mappings - fields that map directly to codex root
 */
const CODEX_LITE_ROOT_FIELDS = new Set([
  'type', 'name', 'title', 'summary', 'id',
  'status', 'featured', 'image', 'images', 'tags', 'body'
]);

const CODEX_LITE_METADATA_FIELDS: Record<string, string> = {
  'author': 'author',
  'updated': 'updated',
  'last_updated': 'updated',
  'created': 'created',
  'description': 'description',
  'license': 'license',
};

/**
 * Extract YAML frontmatter and body from markdown text
 */
function extractFrontmatter(text: string): { frontmatter: Record<string, unknown> | null; body: string } {
  const trimmed = text.trimStart();
  
  // Check for frontmatter delimiter
  if (!trimmed.startsWith('---')) {
    return { frontmatter: null, body: text };
  }
  
  // Find the closing delimiter
  const afterFirst = trimmed.slice(3);
  const endIndex = afterFirst.indexOf('\n---');
  
  if (endIndex === -1) {
    return { frontmatter: null, body: text };
  }
  
  const frontmatterText = afterFirst.slice(0, endIndex);
  const bodyStart = 3 + endIndex + 4; // "---" + content + "\n---"
  const body = trimmed.slice(bodyStart).trim();
  
  try {
    const frontmatter = YAML.parse(frontmatterText) as Record<string, unknown>;
    return { frontmatter, body };
  } catch {
    return { frontmatter: null, body: text };
  }
}

/**
 * Extract the first H1 heading from markdown text
 */
function extractH1FromMarkdown(text: string): string | null {
  const match = text.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * Generate a slug ID from text (for TOC entries)
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

/**
 * Extract TOC entries from markdown headings (H2-H6)
 */
function extractTocEntries(body: string): Array<{ id: string; name: string; level: number }> {
  const entries: Array<{ id: string; name: string; level: number }> = [];
  const headingRegex = /^(#{2,6})\s+(.+)$/gm;
  
  let match;
  while ((match = headingRegex.exec(body)) !== null) {
    const level = match[1].length;
    const name = match[2].trim();
    const id = slugify(name);
    entries.push({ id, name, level });
  }
  
  return entries;
}

/**
 * Parse a Markdown file as a Codex Lite document
 * Creates a flat CodexDocument with a single root node
 */
export function parseMarkdownAsCodex(text: string, fileName?: string): CodexDocument | null {
  try {
    const { frontmatter, body } = extractFrontmatter(text);
    
    // Determine name: frontmatter > H1 > filename
    let name = '';
    if (frontmatter?.name) {
      name = String(frontmatter.name);
    } else if (frontmatter?.title) {
      name = String(frontmatter.title);
    } else {
      const h1 = extractH1FromMarkdown(body);
      if (h1) {
        name = h1;
      } else if (fileName) {
        name = path.basename(fileName, '.md');
      } else {
        name = 'Untitled';
      }
    }
    
    // Build metadata from frontmatter
    const metadata: CodexMetadata = {
      formatVersion: 'lite',  // Special marker for Codex Lite
    };
    
    if (frontmatter) {
      for (const [fmKey, codexKey] of Object.entries(CODEX_LITE_METADATA_FIELDS)) {
        if (frontmatter[fmKey]) {
          // Map frontmatter fields to metadata
          if (codexKey === 'author') metadata.author = String(frontmatter[fmKey]);
          else if (codexKey === 'updated') metadata.updated = String(frontmatter[fmKey]);
          else if (codexKey === 'created') metadata.created = String(frontmatter[fmKey]);
          else if (codexKey === 'license') metadata.license = String(frontmatter[fmKey]);
        }
      }
    }
    
    // Parse tags - support both array and comma-delimited string
    let tags: string[] = [];
    if (frontmatter?.tags) {
      if (Array.isArray(frontmatter.tags)) {
        tags = frontmatter.tags.filter((t): t is string => typeof t === 'string');
      } else if (typeof frontmatter.tags === 'string') {
        tags = frontmatter.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
      }
    }
    
    // Extract TOC entries for navigation
    const tocEntries = extractTocEntries(body);
    
    // Build availableFields first
    const availableFields: string[] = ['body'];
    if (frontmatter?.summary) {
      availableFields.push('summary');
    }
    
    // Determine proseField: use summary if available, otherwise body
    // But proseValue is ALWAYS the body text (semantic meaning)
    const proseField = availableFields.includes('summary') ? 'summary' : 'body';
    
    // Build the root node
    const rootNode: CodexNode = {
      id: (frontmatter?.id as string) ?? generateUuid(),
      type: (frontmatter?.type as string) ?? 'document',
      name,
      proseField,
      proseValue: body,  // Always body, regardless of proseField
      availableFields,
      path: [],
      children: [],
      hasAttributes: false,
      hasContentSections: false,
      hasImages: false,
      tags: tags.length > 0 ? tags : undefined,
      image: frontmatter?.image as string | undefined,
    };
    
    const types = new Set<string>();
    if (rootNode.type && rootNode.type !== 'unknown') {
      types.add(rootNode.type);
    }
    
    return {
      metadata,
      rootNode,
      allNodes: [rootNode],
      types,
      rawDoc: null,
      isJson: false,
      isMarkdown: true,
      rawText: text,
      frontmatter: frontmatter ?? undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Set prose value in a markdown file and return the new text
 * Preserves frontmatter structure
 */
export function setMarkdownNodeProse(
  originalText: string,
  newBody: string,
  updatedFrontmatter?: Record<string, unknown>
): string {
  const { frontmatter } = extractFrontmatter(originalText);
  
  // Use updated frontmatter if provided, otherwise keep original
  const fm = updatedFrontmatter ?? frontmatter;
  
  if (fm && Object.keys(fm).length > 0) {
    // Rebuild with frontmatter
    const fmYaml = YAML.stringify(fm, { lineWidth: 0 }).trim();
    return `---\n${fmYaml}\n---\n\n${newBody}`;
  } else {
    // No frontmatter - just return the body
    return newBody;
  }
}

/**
 * Update a specific frontmatter field in a markdown file
 */
export function setMarkdownFrontmatterField(
  originalText: string,
  field: string,
  value: unknown
): string {
  const { frontmatter, body } = extractFrontmatter(originalText);
  
  const fm = frontmatter ?? {};
  fm[field] = value;
  
  const fmYaml = YAML.stringify(fm, { lineWidth: 0 }).trim();
  return `---\n${fmYaml}\n---\n\n${body}`;
}

/**
 * Get the prose value for a specific node from the document
 */
export function getNodeProse(codexDoc: CodexDocument, node: CodexNode, field?: string): string {
  try {
    let current: unknown;
    
    if (codexDoc.isJson) {
      current = JSON.parse(codexDoc.rawText);
    } else if (codexDoc.rawDoc) {
      current = codexDoc.rawDoc.toJS();
    } else {
      return '';
    }
    
    // Navigate to the node
    for (const segment of node.path) {
      if (current === null || current === undefined) {
        return '';
      }
      current = (current as Record<string, unknown>)[segment as string];
    }
    
    if (!current || typeof current !== 'object') {
      return '';
    }
    
    const fieldToGet = field ?? node.proseField;
    const value = (current as Record<string, unknown>)[fieldToGet];
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

/**
 * Update the prose value for a specific node and return the new document text
 * Preserves YAML formatting (block style, comments, etc.) when possible
 */
export function setNodeProse(
  codexDoc: CodexDocument,
  node: CodexNode,
  newValue: string,
  field?: string
): string {
  const fieldToSet = field ?? node.proseField;
  
  try {
    if (codexDoc.isJson) {
      // For JSON, we parse, modify, and re-stringify
      const obj = JSON.parse(codexDoc.rawText);
      let current = obj;
      
      // Navigate to the parent of the target field
      for (const segment of node.path) {
        current = current[segment];
      }
      
      if (current && typeof current === 'object') {
        current[fieldToSet] = newValue;
      }
      
      return JSON.stringify(obj, null, 2);
    } else {
      // For YAML, use the library's AST manipulation to preserve formatting
      const doc = YAML.parseDocument(codexDoc.rawText);
      
      // Build the full path including the prose field
      const fullPath = [...node.path, fieldToSet];
      
      // Get or create the scalar node
      const pathKeys = fullPath.map(p => typeof p === 'number' ? p : String(p));
      
      // Use block scalar for long strings (consistent threshold across all fields)
      const valueToSet = createBlockScalarIfNeeded(doc, newValue);
      doc.setIn(pathKeys, valueToSet);
      
      return doc.toString();
    }
  } catch {
    // If something goes wrong, return original text
    return codexDoc.rawText;
  }
}

/**
 * Update the name for a specific node and return the new document text
 */
export function setNodeName(
  codexDoc: CodexDocument,
  node: CodexNode,
  newName: string
): string {
  const trimmedName = newName.trim();
  if (!trimmedName) {
    return codexDoc.rawText;
  }
  
  try {
    if (codexDoc.isJson) {
      const obj = JSON.parse(codexDoc.rawText);
      let current = obj;
      
      for (const segment of node.path) {
        current = current[segment];
      }
      
      if (current && typeof current === 'object') {
        current['name'] = trimmedName;
      }
      
      return JSON.stringify(obj, null, 2);
    } else {
      const doc = YAML.parseDocument(codexDoc.rawText);
      const pathKeys = [...node.path.map(p => typeof p === 'number' ? p : String(p)), 'name'];
      doc.setIn(pathKeys, trimmedName);
      return doc.toString();
    }
  } catch {
    return codexDoc.rawText;
  }
}

/**
 * Set the type field for a specific node
 */
export function setNodeType(
  codexDoc: CodexDocument,
  node: CodexNode,
  newType: string
): string {
  const trimmedType = newType.trim();
  if (!trimmedType) {
    return codexDoc.rawText;
  }
  
  try {
    if (codexDoc.isJson) {
      const obj = JSON.parse(codexDoc.rawText);
      let current = obj;
      
      for (const segment of node.path) {
        current = current[segment];
      }
      
      if (current && typeof current === 'object') {
        current['type'] = trimmedType;
      }
      
      return JSON.stringify(obj, null, 2);
    } else {
      const doc = YAML.parseDocument(codexDoc.rawText);
      const pathKeys = [...node.path.map(p => typeof p === 'number' ? p : String(p)), 'type'];
      doc.setIn(pathKeys, trimmedType);
      return doc.toString();
    }
  } catch {
    return codexDoc.rawText;
  }
}

/**
 * Get the attributes array for a specific node
 */
export function getNodeAttributes(codexDoc: CodexDocument, node: CodexNode): CodexAttribute[] {
  try {
    let current: unknown;
    
    if (codexDoc.isJson) {
      current = JSON.parse(codexDoc.rawText);
    } else if (codexDoc.rawDoc) {
      current = codexDoc.rawDoc.toJS();
    } else {
      return [];
    }
    
    // Navigate to the node
    for (const segment of node.path) {
      if (current === null || current === undefined) {
        return [];
      }
      current = (current as Record<string, unknown>)[segment as string];
    }
    
    if (!current || typeof current !== 'object') {
      return [];
    }
    
    const attrs = (current as Record<string, unknown>).attributes;
    if (!Array.isArray(attrs)) {
      return [];
    }
    
    return attrs.map((a: unknown) => {
      const attr = a as Record<string, unknown>;
      return {
        key: (attr.key as string) ?? '',
        name: attr.name as string | undefined,
        value: attr.value,
        dataType: attr.dataType as string | undefined,
        id: attr.id as string | undefined,
        type: attr.type as string | undefined,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Set the attributes array for a specific node
 */
export function setNodeAttributes(
  codexDoc: CodexDocument,
  node: CodexNode,
  attributes: CodexAttribute[]
): string {
  try {
    if (codexDoc.isJson) {
      const obj = JSON.parse(codexDoc.rawText);
      let current = obj;
      
      for (const segment of node.path) {
        current = current[segment];
      }
      
      if (current && typeof current === 'object') {
        current.attributes = attributes.map(attr => ({
          key: attr.key,
          name: attr.name,
          value: attr.dataType === 'int' ? Number(attr.value) : attr.value,
          dataType: attr.dataType,
          id: attr.id,
          type: attr.type,
        }));
      }
      
      return JSON.stringify(obj, null, 2);
    } else {
      const doc = YAML.parseDocument(codexDoc.rawText);
      const fullPath = [...node.path, 'attributes'];
      const pathKeys = fullPath.map(p => typeof p === 'number' ? p : String(p));
      
      // Convert attributes to YAML nodes with block scalars for long string values
      const yamlAttrs = attributes.map(attr => {
        const attrNode = doc.createNode({
          key: attr.key,
        }) as YAML.YAMLMap;
        
        // Add name if present
        if (attr.name) {
          const nameValue = createBlockScalarIfNeeded(doc, attr.name);
          attrNode.set('name', nameValue);
        }
        
        // Add value with block scalar for long strings
        const rawValue = attr.dataType === 'int' ? Number(attr.value) : attr.value;
        if (typeof rawValue === 'string') {
          const valueScalar = createBlockScalarIfNeeded(doc, rawValue);
          attrNode.set('value', valueScalar);
        } else {
          attrNode.set('value', rawValue);
        }
        
        // Add optional fields
        if (attr.dataType) attrNode.set('dataType', attr.dataType);
        if (attr.id) attrNode.set('id', attr.id);
        if (attr.type) attrNode.set('type', attr.type);
        
        return attrNode;
      });
      
      const seq = doc.createNode(yamlAttrs);
      doc.setIn(pathKeys, seq);
      return doc.toString();
    }
  } catch {
    return codexDoc.rawText;
  }
}

/**
 * Get the content sections array for a specific node
 */
export function getNodeContentSections(codexDoc: CodexDocument, node: CodexNode): CodexContentSection[] {
  try {
    let current: unknown;
    
    if (codexDoc.isJson) {
      current = JSON.parse(codexDoc.rawText);
    } else if (codexDoc.rawDoc) {
      current = codexDoc.rawDoc.toJS();
    } else {
      return [];
    }
    
    // Navigate to the node
    for (const segment of node.path) {
      if (current === null || current === undefined) {
        return [];
      }
      current = (current as Record<string, unknown>)[segment as string];
    }
    
    if (!current || typeof current !== 'object') {
      return [];
    }
    
    const content = (current as Record<string, unknown>).content;
    if (!Array.isArray(content)) {
      return [];
    }
    
    return content.map((c: unknown) => {
      const section = c as Record<string, unknown>;
      return {
        key: (section.key as string) ?? '',
        name: (section.name as string) ?? '',
        value: (section.value as string) ?? '',
        id: section.id as string | undefined,
        type: section.type as string | undefined,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Set the content sections array for a specific node
 */
export function setNodeContentSections(
  codexDoc: CodexDocument,
  node: CodexNode,
  contentSections: CodexContentSection[]
): string {
  try {
    if (codexDoc.isJson) {
      const obj = JSON.parse(codexDoc.rawText);
      let current = obj;
      
      for (const segment of node.path) {
        current = current[segment];
      }
      
      if (current && typeof current === 'object') {
        current.content = contentSections.map(section => ({
          key: section.key,
          name: section.name,
          value: section.value,
          id: section.id,
          type: section.type,
        }));
      }
      
      return JSON.stringify(obj, null, 2);
    } else {
      const doc = YAML.parseDocument(codexDoc.rawText);
      const fullPath = [...node.path, 'content'];
      const pathKeys = fullPath.map(p => typeof p === 'number' ? p : String(p));
      
      // Convert content sections to YAML nodes with block scalars for long strings
      const yamlContent = contentSections.map(section => {
        const sectionNode = doc.createNode({
          key: section.key,
        }) as YAML.YAMLMap;
        
        // Add name with block scalar if needed
        if (section.name) {
          const nameValue = createBlockScalarIfNeeded(doc, section.name);
          sectionNode.set('name', nameValue);
        }
        
        // Add value with block scalar for long strings
        if (section.value) {
          const valueScalar = createBlockScalarIfNeeded(doc, section.value);
          sectionNode.set('value', valueScalar);
        }
        
        // Add optional fields
        if (section.id) sectionNode.set('id', section.id);
        if (section.type) sectionNode.set('type', section.type);
        
        return sectionNode;
      });
      
      const seq = doc.createNode(yamlContent);
      doc.setIn(pathKeys, seq);
      return doc.toString();
    }
  } catch {
    return codexDoc.rawText;
  }
}

/**
 * Validate a Codex document and return any issues
 */
export function validateCodex(codexDoc: CodexDocument | null, text: string): CodexValidationIssue[] {
  const issues: CodexValidationIssue[] = [];
  
  // Check if document could be parsed at all
  if (!codexDoc) {
    // Try to determine if it's a legacy format
    try {
      const isJson = isJsonContent(text);
      const obj = isJson ? JSON.parse(text) : YAML.parse(text);
      
      if (obj && typeof obj === 'object') {
        if ('data' in obj && !('metadata' in obj)) {
          issues.push({
            message: "Legacy format detected: Files with 'data' wrapper are not supported. Please migrate using scripts/migrate_codex_to_v1.py",
            severity: 'error',
            line: 1,
          });
          return issues;
        }
        
        if (!('metadata' in obj)) {
          issues.push({
            message: "Invalid format: V1.0+ codex files must have a 'metadata' section.",
            severity: 'error',
            line: 1,
          });
          return issues;
        }
      }
    } catch {
      issues.push({
        message: 'Invalid YAML/JSON syntax',
        severity: 'error',
        line: 1,
      });
      return issues;
    }
    
    issues.push({
      message: 'Unable to parse Codex document',
      severity: 'error',
      line: 1,
    });
    return issues;
  }
  
  // Check metadata exists and has formatVersion
  if (!codexDoc.metadata.formatVersion) {
    issues.push({
      message: "Missing required field: metadata.formatVersion",
      severity: 'error',
      line: 1,
    });
  }
  // Note: We accept any format version for forward/backward compatibility
  
  // UUID v4 validation pattern
  const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  // Check for nodes without IDs (skip include directives - they don't need IDs)
  const seenIds = new Set<string>();
  let hasInvalidUuids = false;

  for (const node of codexDoc.allNodes) {
    if (!node.id && node.type !== 'unknown' && !node.isInclude) {
      issues.push({
        message: `Node of type '${node.type}' is missing an 'id' field`,
        severity: 'warning',
        line: node.lineNumber,
        path: node.path,
      });
    }

    // Check for invalid UUID format
    if (node.id && !uuidV4Pattern.test(node.id)) {
      hasInvalidUuids = true;
      issues.push({
        message: `Node '${node.name || node.type}' has invalid UUID format: '${node.id}'. Run Auto-Fix to correct.`,
        severity: 'warning',
        line: node.lineNumber,
        path: node.path,
      });
    }

    // Check for duplicate IDs
    if (node.id) {
      if (seenIds.has(node.id)) {
        issues.push({
          message: `Duplicate ID found: '${node.id}'`,
          severity: 'warning',
          line: node.lineNumber,
          path: node.path,
        });
      }
      seenIds.add(node.id);
    }
    
    // Check for nodes without type (skip include directives)
    if (node.type === 'unknown' && node.path.length > 0 && !node.isInclude) {
      issues.push({
        message: `Node '${node.name}' is missing a 'type' field`,
        severity: 'info',
        line: node.lineNumber,
        path: node.path,
      });
    }
  }
  
  // Warn if document has no meaningful content
  if (codexDoc.allNodes.length <= 1 && !codexDoc.rootNode?.id) {
    issues.push({
      message: 'Codex appears to be empty or missing content nodes',
      severity: 'info',
      line: 1,
    });
  }
  
  return issues;
}

/**
 * Generate a cryptographically secure UUID v4
 */
export function generateUuid(): string {
  return randomUUID();
}

/**
 * Create a minimal valid Codex document
 */
export function createMinimalCodex(type: string = 'book', name: string = 'Untitled'): string {
  return `metadata:
  formatVersion: "1.1"
  documentVersion: "1.0.0"
  created: "${new Date().toISOString()}"

id: "${generateUuid()}"
type: ${type}
name: "${name}"
summary: |
  Add your summary here.

children: []
`;
}









