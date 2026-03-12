/**
 * Index Generator - Fractal Cascade Architecture
 *
 * Scans workspace and generates .index.codex.json with full project hierarchy
 *
 * NEW: Per-folder indexes
 * - Each folder can have its own .index.codex.json
 * - Per-folder indexes define order for immediate children
 * - Parent indexes merge child indexes (cascade up)
 * - Top-level index is complete workspace tree
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import YAML from 'yaml';
import { minimatch } from 'minimatch';

/**
 * Helper to log to the ChapterWise Codex output channel
 */
function log(message: string): void {
  // Import dynamically to avoid circular dependency
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ext = require('./extension');
  const channel = ext.getOutputChannel();
  if (channel) {
    channel.appendLine(message);
  } else {
    console.log(message);
  }
}

export interface GenerateIndexOptions {
  workspaceRoot: string;
  indexFilePath?: string;
  progressReporter?: IndexGenerationProgress;
}

export interface IndexPatterns {
  include: string[];
  exclude: string[];
}

export interface TypeDefinition {
  type: string;
  emoji?: string;
  color?: string;
  description?: string;
}

/**
 * Progress reporting interface for index generation
 */
export interface IndexGenerationProgress {
  report: (message: string, increment?: number) => void;
  token?: vscode.CancellationToken;
}

// ============================================================================
// PHASE 1: Include Resolution - Constants & State
// ============================================================================

/**
 * Maximum depth for recursive include resolution and node extraction
 * Prevents infinite loops and stack overflow
 */
const MAX_DEPTH = 8;

/**
 * Marker text for missing files in the index
 */
const MISSING_FILE_MARKER = '⚠️ Not Available';

/**
 * Auto-fixer preference for current session
 * Persists across multiple files during one index generation
 */
let autoFixerPreference: 'yes' | 'no' | 'always' | 'never' | null = null;

function getAutoFixerPreference(): typeof autoFixerPreference {
  return autoFixerPreference;
}

function setAutoFixerPreference(pref: typeof autoFixerPreference): void {
  autoFixerPreference = pref;
}

function resetAutoFixerPreference(): void {
  autoFixerPreference = null;
}

/**
 * Scan all codex files and collect those needing auto-fixing
 * Returns list of file paths with missing IDs
 */
async function scanForMissingIds(
  workspaceRoot: string,
  files: string[]
): Promise<string[]> {
  const filesNeedingFix: string[] = [];

  for (const file of files) {
    if (!file.endsWith('.codex.yaml') && !file.endsWith('.codex.json')) {
      continue;
    }

    try {
      const content = fs.readFileSync(file, 'utf-8');
      const data = YAML.parse(content);

      if (hasMissingIds(data)) {
        filesNeedingFix.push(file);
      }
    } catch (error) {
      // Skip files that can't be parsed
    }
  }

  return filesNeedingFix;
}

/**
 * Generate complete index from workspace scan
 */
export async function generateIndex(
  options: GenerateIndexOptions
): Promise<string> {
  const { workspaceRoot, indexFilePath, progressReporter } = options;

  // Reset auto-fixer preference for new generation
  resetAutoFixerPreference();

  // Step 1: Load index.codex.yaml if exists
  let indexDef: any = null;
  if (indexFilePath && fs.existsSync(indexFilePath)) {
    const content = fs.readFileSync(indexFilePath, 'utf-8');
    indexDef = YAML.parse(content);
  }

  progressReporter?.report('Loading patterns...', 10);

  // Step 2: Get patterns
  const patterns = indexDef?.patterns || getDefaultPatterns();

  // Step 3: Scan workspace
  progressReporter?.report('Scanning workspace...', 20);
  const files = await scanWorkspace(workspaceRoot, patterns);

  progressReporter?.report(`Found ${files.length} files...`, 15);

  // Step 3.5: Pre-scan for files needing auto-fixing
  progressReporter?.report(`Checking for missing IDs...`, 5);
  const filesNeedingFix = await scanForMissingIds(workspaceRoot, files);

  if (filesNeedingFix.length > 0) {
    log(`Found ${filesNeedingFix.length} files with missing IDs`);

    // Show ONE prompt with total count
    const choice = await vscode.window.showWarningMessage(
      `Found ${filesNeedingFix.length} files with missing IDs. Run auto-fixer on all?`,
      'Yes, Fix All',
      'No, Skip',
      'Always (remember for session)',
      'Never (remember for session)'
    );

    if (choice === 'Always (remember for session)') {
      setAutoFixerPreference('always');
      log(`Auto-fixer set to: always`);
    } else if (choice === 'Never (remember for session)') {
      setAutoFixerPreference('never');
      log(`Auto-fixer set to: never`);
    } else if (choice === 'Yes, Fix All') {
      setAutoFixerPreference('always'); // Just for this run
      log(`Auto-fixer set to: always (this run only)`);
    } else {
      setAutoFixerPreference('never'); // Skip for this run
      log(`Auto-fixer set to: never (this run only)`);
    }
  } else {
    log(`No files need auto-fixing`);
  }

  // Step 4: Build hierarchy
  progressReporter?.report('Building hierarchy...', 20);
  const { children, detectedTypes } = await buildHierarchy(files, workspaceRoot);

  // Step 5: Merge detected types with existing types from index
  const existingTypes = indexDef?.types || [];
  const mergedTypes = mergeTypes(existingTypes, Array.from(detectedTypes), indexDef?.typeStyles);

  // Step 6: Apply type styles
  if (indexDef?.typeStyles) {
    applyTypeStyles(children, indexDef.typeStyles);
  }

  progressReporter?.report('Writing index file...', 15);

  // Step 7: Build complete index
  const indexData = {
      metadata: {
        formatVersion: '3.0', // Phase 2: Bumped for node + field extraction
        documentVersion: '1.0.0',
        created: new Date().toISOString(),
        generated: true,
      },
    id: indexDef?.id || 'index-root',
      type: 'index',
    name: indexDef?.name || path.basename(workspaceRoot),
    title: indexDef?.title,
    summary: indexDef?.summary,
    attributes: indexDef?.attributes,
      patterns,
    typeStyles: indexDef?.typeStyles,
    types: mergedTypes,  // NEW: Add types array
    status: indexDef?.status || 'private',
      children,
    };

  // Step 8: Write .index.codex.json
  const outputPath = path.join(workspaceRoot, '.index.codex.json');
  fs.writeFileSync(outputPath, JSON.stringify(indexData, null, 2), 'utf-8');

  progressReporter?.report('Complete!', 5);

  return outputPath;
  }

  /**
 * Scan workspace for files matching patterns
   */
async function scanWorkspace(
  root: string,
    patterns: IndexPatterns
  ): Promise<string[]> {
    const files: string[] = [];

  function walkDir(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
      // Skip symlinks to prevent scanning outside workspace
      if (entry.isSymbolicLink()) {
        log(`[scanWorkspace] Skipping symlink: ${entry.name}`);
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(root, fullPath);

      // Check exclude patterns first
      if (shouldExclude(relativePath, patterns.exclude)) {
            continue;
          }

          if (entry.isDirectory()) {
        walkDir(fullPath);
          } else if (entry.isFile()) {
        // Check include patterns
        if (shouldInclude(entry.name, patterns.include)) {
              files.push(fullPath);
            }
          }
        }
  }

  try {
    walkDir(root);
      } catch (error) {
    log(`Error scanning workspace: ${error}`);
      }

  return files;
  }

  /**
 * Check if file should be excluded
   */
function shouldExclude(relativePath: string, excludePatterns: string[]): boolean {
  return excludePatterns.some((pattern) => minimatch(relativePath, pattern));
}

/**
 * Check if file should be included
 */
function shouldInclude(fileName: string, includePatterns: string[]): boolean {
  return includePatterns.some((pattern) => minimatch(fileName, pattern));
  }

/**
 * Build hierarchical children structure from file list
 * NEW: Supports per-folder .index.codex.json merging
 * Returns children array and detected types
 */
async function buildHierarchy(
  files: string[],
  root: string
): Promise<{ children: any[], detectedTypes: Set<string> }> {
  const tree = new Map<string, any>();
  const detectedTypes = new Set<string>();

  for (const file of files) {
    const relative = path.relative(root, file);
    const parts = relative.split(path.sep);

    // Build folder structure
    let currentPath = '';
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
      const folderPath = currentPath ? `${currentPath}/${part}` : part;

      if (!tree.has(folderPath)) {
        tree.set(folderPath, {
          id: `folder-${folderPath.replace(/\//g, '-')}`,
          type: 'folder',
            name: part,
          _computed_path: folderPath,
          children: [],
        });
      }

      currentPath = folderPath;
          }

    // Add file
    const fileName = parts[parts.length - 1];
    const fileNode = await createFileNode(file, fileName, root);

    // Collect types from file
    collectTypes(fileNode, detectedTypes);

    if (currentPath) {
      const folder = tree.get(currentPath);
      if (folder) {
        folder.children.push(fileNode);
      }
    } else {
      // Root level file
      if (!tree.has('__root__')) {
        tree.set('__root__', []);
      }
      (tree.get('__root__') as any[]).push(fileNode);
    }
  }

  // Build hierarchical structure
  const result: any[] = [];
  const rootFiles = tree.get('__root__') || [];
  result.push(...rootFiles);

  // Add folders
  const sortedFolders = Array.from(tree.entries())
    .filter(([key]) => key !== '__root__')
    .sort((a, b) => a[0].localeCompare(b[0]));

  for (const [folderPath, folder] of sortedFolders) {
    if (folderPath.includes('/')) {
      // Nested folder - add to parent
      const parentPath = path.dirname(folderPath).replace(/\\/g, '/');
      const parent = tree.get(parentPath);
      if (parent) {
        parent.children.push(folder);
      }
    } else {
      // Root level folder
      result.push(folder);
    }
  }

  // NEW: Merge per-folder indexes (cascade up)
  await mergePerFolderIndexes(result, root, tree);

  // Sort children by order then name (after merging)
  sortChildrenRecursive(result);

  return { children: result, detectedTypes };
}

/**
 * Recursively collect all node types from a node tree
 */
function collectTypes(node: any, types: Set<string>): void {
  if (node.type && node.type !== 'folder' && node.type !== 'document' && node.type !== 'index') {
    types.add(node.type);
  }

  if (node.children && Array.isArray(node.children)) {
    node.children.forEach((child: any) => collectTypes(child, types));
  }
}

/**
 * Merge detected types with existing types from index, applying typeStyles
 */
function mergeTypes(
  existingTypes: TypeDefinition[],
  detectedTypes: string[],
  typeStyles: any[]
): TypeDefinition[] {
  const typeMap = new Map<string, TypeDefinition>();

  // Add existing types (preserve manually defined ones)
  existingTypes.forEach(t => {
    typeMap.set(t.type, t);
  });

  // Add detected types (only if not already defined)
  detectedTypes.forEach(type => {
    if (!typeMap.has(type)) {
      // Check if there's a typeStyle for this type
      const style = typeStyles?.find(s => s.type === type);

      typeMap.set(type, {
        type,
        emoji: style?.emoji,
        color: style?.color,
        description: `Auto-detected ${type}`,
      });
    }
  });

  // Sort: manually defined first, then detected alphabetically
  const manual = existingTypes.filter(t => typeMap.has(t.type));
  const detected = detectedTypes
    .filter(t => !existingTypes.some(e => e.type === t))
    .sort()
    .map(t => typeMap.get(t)!);

  return [...manual, ...detected];
}

/**
 * Merge per-folder .index.codex.json files into the hierarchy
 * Processes from deepest folders UP to preserve order values
 */
async function mergePerFolderIndexes(
  rootChildren: any[],
  workspaceRoot: string,
  tree: Map<string, any>
): Promise<void> {
  // Get all folder paths, sorted by depth (deepest first)
  const folderPaths = Array.from(tree.keys())
    .filter(key => key !== '__root__')
    .sort((a, b) => {
      const depthA = a.split('/').length;
      const depthB = b.split('/').length;
      return depthB - depthA; // Deepest first
    });

  // Process each folder from deepest to shallowest
  for (const folderPath of folderPaths) {
    const folder = tree.get(folderPath);
    if (!folder) continue;

    // Check if this folder has a per-folder .index.codex.json
    const perFolderIndexPath = path.join(workspaceRoot, folderPath, '.index.codex.json');

    if (fs.existsSync(perFolderIndexPath)) {
      try {
        const indexContent = fs.readFileSync(perFolderIndexPath, 'utf-8');
        const indexData = JSON.parse(indexContent);

        if (indexData.children && Array.isArray(indexData.children)) {
          // Reorder children to match per-folder index array position
          applyYamlOrder(folder.children, indexData.children);
        }
      } catch (error) {
        log(`Failed to read per-folder index at ${folderPath}: ${error}`);
      }
    }
  }

  // Also check for root-level index.codex.yaml (human-written, not hidden)
  const rootIndexPath = path.join(workspaceRoot, 'index.codex.yaml');
  if (fs.existsSync(rootIndexPath)) {
    try {
      const indexContent = fs.readFileSync(rootIndexPath, 'utf-8');
      const indexData = YAML.parse(indexContent);

      if (indexData.children && Array.isArray(indexData.children)) {
        applyYamlOrder(rootChildren, indexData.children);
      }
    } catch (error) {
      log(`Failed to read root index.codex.yaml: ${error}`);
    }
  }
}

/**
 * Reorder generated children to match the order defined in an index (YAML or JSON).
 * Items found in the index come first (in index order), followed by any unmatched items.
 */
function applyYamlOrder(
  generatedChildren: any[],
  indexChildren: any[]
): void {
  // Build lookup map: name → index position
  const orderMap = new Map<string, number>();
  for (let i = 0; i < indexChildren.length; i++) {
    const key = indexChildren[i]._filename || indexChildren[i].name;
    if (key) {
      orderMap.set(key, i);
    }
  }

  // Stable sort: items in index come first (by index position), then unmatched items preserve original order
  generatedChildren.sort((a, b) => {
    const keyA = a._filename || a.name;
    const keyB = b._filename || b.name;
    const posA = orderMap.has(keyA) ? orderMap.get(keyA)! : Number.MAX_SAFE_INTEGER;
    const posB = orderMap.has(keyB) ? orderMap.get(keyB)! : Number.MAX_SAFE_INTEGER;
    return posA - posB;
  });
}

// ============================================================================
// PHASE 1: Include Resolution - Core Functions
// ============================================================================

/**
 * Resolve include path relative to parent file
 * Supports:
 * - Absolute paths: /path/to/file.codex.yaml
 * - Relative paths: ./sibling.codex.yaml
 * - Parent paths: ../parent/file.codex.yaml
 * - Multi-level: ../../grandparent/file.codex.yaml
 */
function resolveIncludePath(
  includePath: string,
  parentFilePath: string,
  workspaceRoot: string
): string {
  let resolved: string;

  if (includePath.startsWith('/')) {
    // Absolute path: resolve from workspace root
    resolved = path.join(workspaceRoot, includePath.substring(1));
  } else {
    // Relative path: resolve from parent file's directory
    const parentDir = path.dirname(parentFilePath);
    resolved = path.resolve(parentDir, includePath);
  }

  // Normalize to remove .. and . segments
  const normalized = path.normalize(resolved);

  // Security check: ensure resolved path is within workspace (covers BOTH branches)
  const relative = path.relative(workspaceRoot, normalized);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Include path escapes workspace root: ${includePath}`);
  }

  return normalized;
}

/**
 * Check if codex data has missing IDs (recursively)
 * Skip include directives (they don't need IDs)
 */
function hasMissingIds(data: any): boolean {
  if (!data || typeof data !== 'object') {
    return false;
  }

  // Check children array
  if (Array.isArray(data.children)) {
    for (const child of data.children) {
      // Skip include directives
      if (child.include) {
        continue;
      }

      // Check if this node is missing an ID
      if (child.type && !child.id) {
        return true;
      }

      // Recursively check nested children
      if (hasMissingIds(child)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Load and parse codex file with auto-fixer integration
 * Uses preference set by batch prompt (no individual prompts)
 */
async function loadAndParseCodexFile(
  filePath: string,
  workspaceRoot: string
): Promise<any> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const data = YAML.parse(content);

  // Check if file needs auto-fixing
  if (hasMissingIds(data)) {
    const currentPref = getAutoFixerPreference();

    // If preference is set to "always", auto-fix silently
    if (currentPref === 'always') {
      const relativePath = path.relative(workspaceRoot, filePath);
      log(`  Auto-fixing: ${relativePath}`);

      const { CodexAutoFixer } = await import('./autoFixer');
      const fixer = new CodexAutoFixer();
      const fixed = fixer.autoFixCodex(data);

      // Save fixed file
      fs.writeFileSync(filePath, YAML.stringify(fixed), 'utf-8');
      return fixed;
    }

    // Otherwise skip (user said "never" or "no" in batch prompt)
  }

  return data;
}

/**
 * Resolve includes recursively within codex data
 * Returns modified children array with includes replaced by actual content
 *
 * @param children - Children array from codex file
 * @param parentFilePath - Absolute path to parent codex file
 * @param workspaceRoot - Workspace root path
 * @param depth - Current recursion depth
 * @param visitedPaths - Set of visited file paths (for circular detection)
 */
async function resolveIncludes(
  children: any[] | undefined,
  parentFilePath: string,
  workspaceRoot: string,
  depth: number = 0,
  visitedPaths: Set<string> = new Set()
): Promise<any[]> {
  if (!children || !Array.isArray(children)) {
    return [];
  }

  // Check depth limit
  if (depth >= MAX_DEPTH) {
    log(`[resolveIncludes] Max depth ${MAX_DEPTH} reached at ${parentFilePath}`);
    return children;
  }

  const resolved: any[] = [];

  for (const child of children) {
    // Handle include directives
    if (child.include) {
      try {
        const includePath = child.include;
        const resolvedPath = resolveIncludePath(includePath, parentFilePath, workspaceRoot);

        // Check for circular includes
        if (visitedPaths.has(resolvedPath)) {
          const chain = Array.from(visitedPaths).join(' → ');
          resolved.push({
            _node_kind: 'error',
            name: `Circular include: ${path.basename(includePath)}`,
            _error_message: `Circular include detected:\n${chain} → ${resolvedPath}`,
            _original_include: includePath,
          });
          continue;
        }

        // Check if file exists
        if (!fs.existsSync(resolvedPath)) {
          resolved.push({
            _node_kind: 'missing',
            name: `${MISSING_FILE_MARKER} ${path.basename(includePath)}`,
            _computed_path: path.relative(workspaceRoot, resolvedPath),
            _original_include: includePath,
          });
          continue;
        }

        // Load and parse included file
        try {
          const includedData = await loadAndParseCodexFile(resolvedPath, workspaceRoot);

          // Add to visited set for circular detection
          const newVisited = new Set(visitedPaths);
          newVisited.add(resolvedPath);

          // Recursively resolve includes in the included file
          const includedChildren = await resolveIncludes(
            includedData.children,
            resolvedPath,
            workspaceRoot,
            depth + 1,
            newVisited
          );

          // Merge included node - ONLY navigation metadata, NOT content
          const includedNode: any = {
            id: includedData.id || `included-${Date.now()}`,
            type: includedData.type || 'unknown',
            name: includedData.name || includedData.title || path.basename(resolvedPath, path.extname(resolvedPath)),
            children: includedChildren,
            _subindex_path: resolvedPath,
            _node_kind: 'node', // Included files become nodes in the tree
          };

          // Optional small metadata
          if (includedData.title) includedNode.title = includedData.title;
          if (includedData.tags && Array.isArray(includedData.tags)) includedNode.tags = includedData.tags;
          if (includedData.order !== undefined) includedNode.order = includedData.order;

          resolved.push(includedNode);
        } catch (parseError: any) {
          resolved.push({
            _node_kind: 'error',
            name: `🔧 Parse Error: ${path.basename(includePath)}`,
            _error_message: parseError.message,
            _original_include: includePath,
          });
        }
      } catch (error: any) {
        resolved.push({
          _node_kind: 'error',
          name: `Error: ${child.include}`,
          _error_message: error.message,
          _original_include: child.include,
        });
      }
    } else {
      // Regular child (not an include) - recursively process its children
      const resolvedChild = {
        ...child,
        children: await resolveIncludes(
          child.children,
          parentFilePath,
          workspaceRoot,
          depth,
          visitedPaths
        ),
      };
      resolved.push(resolvedChild);
    }
  }

  return resolved;
}

// ============================================================================
// PHASE 2: Node & Field Extraction
// ============================================================================

/**
 * Extract node and field children from codex data (recursive)
 * Creates nodes for nodes (type: module/character/etc) and their fields (summary, body, etc)
 *
 * @param children - Children array from codex file
 * @param parentFilePath - Relative path to parent file (for _parent_file)
 * @param workspaceRoot - Workspace root path
 * @param depth - Current depth (1 = first-level nodes)
 * @param parentEntityId - Parent node ID (for nested nodes)
 */
async function extractNodeChildren(
  children: any[] | undefined,
  parentFilePath: string,
  workspaceRoot: string,
  depth: number = 1,
  parentEntityId?: string
): Promise<any[]> {
  if (!children || !Array.isArray(children)) {
    return [];
  }

  // Check depth limit
  if (depth > MAX_DEPTH) {
    log(`[extractNodeChildren] Max depth ${MAX_DEPTH} reached`);
    return [];
  }

  const extracted: any[] = [];

  for (const child of children) {
    // Skip if this is not a node (e.g., it's an include directive or malformed)
    if (!child.type) {
      continue;
    }

    // Generate defensive node ID
    const entityId = child.id || `node-${child.type}-${depth}-${extracted.length}`;

    // Determine the correct parent file path:
    // If this child has _subindex_path (from an included file), use that
    // Otherwise use the passed parentFilePath
    let effectiveParentFile = parentFilePath;
    if (child._subindex_path) {
      // Convert absolute path to relative path from workspace root
      effectiveParentFile = path.relative(workspaceRoot, child._subindex_path);
    }

    // Create node - ONLY include navigation metadata, NOT content
    const entityNode: any = {
      id: entityId,
      type: child.type,
      name: child.name || child.title || 'Untitled',
      _node_kind: 'node',
      _parent_file: effectiveParentFile,
      _depth: depth,
      children: [], // Will be populated with fields + nested nodes
    };

    // Optional small metadata (useful for navigation/filtering)
    if (child.title) entityNode.title = child.title;
    if (child.tags && Array.isArray(child.tags)) entityNode.tags = child.tags;
    if (child.order !== undefined) entityNode.order = child.order;

    if (parentEntityId) {
      entityNode._parent_entity = parentEntityId;
    }

    // Extract field children (summary, body, attributes, content)
    const fieldChildren: any[] = [];
    const fieldNames = ['summary', 'body', 'attributes', 'content'];

    for (const fieldName of fieldNames) {
      if (child[fieldName] !== undefined) {
        const fieldValue = child[fieldName];

        // Skip empty arrays for attributes and content
        if (fieldName === 'attributes' && Array.isArray(fieldValue) && fieldValue.length === 0) {
          continue;
        }
        if (fieldName === 'content' && Array.isArray(fieldValue) && fieldValue.length === 0) {
          continue;
        }

        const fieldType = typeof fieldValue === 'string' ? 'string' :
                         Array.isArray(fieldValue) ? 'array' : 'object';

        fieldChildren.push({
          id: `${entityId}-${fieldName}`,
          type: 'field',
          name: fieldName,
          _node_kind: 'field',
          _field_name: fieldName,
          _field_type: fieldType,
          _parent_file: effectiveParentFile,
          _parent_entity: entityId,
          _depth: depth + 1,
        });
      }
    }

    // Extract images field if present
    if (child.images && Array.isArray(child.images) && child.images.length > 0) {
      fieldChildren.push({
        id: `${entityId}-images`,
        type: 'field',
        name: 'images',
        _node_kind: 'field',
        _field_name: 'images',
        _field_type: 'array',
        _images_count: child.images.length,
        _parent_file: effectiveParentFile,
        _parent_entity: entityId,
        _depth: depth + 1,
      });
    }

    // Extract nested node children (recursively)
    // Pass effectiveParentFile so nested children inherit the correct source file
    const entityChildren = child.children
      ? await extractNodeChildren(
          child.children,
          effectiveParentFile,
          workspaceRoot,
          depth + 1,
          entityId
        )
      : [];

    // Combine field children + node children
    entityNode.children = [...fieldChildren, ...entityChildren];

    extracted.push(entityNode);
  }

  return extracted;
}

/**
 * Create file node with type detection + Phase 1 & 2 integration
 */
async function createFileNode(
  filePath: string,
  fileName: string,
  root: string
): Promise<any> {
  const relative = path.relative(root, filePath);
  const ext = path.extname(fileName).toLowerCase();

  let type = 'document';
  let name = fileName;
  let format = 'unknown';

  // Detect format
  if (fileName.endsWith('.codex.yaml')) {
    format = 'yaml';
    type = 'codex';
    name = fileName.replace('.codex.yaml', '');
  } else if (fileName.endsWith('.codex.json')) {
    format = 'json';
    type = 'codex';
    name = fileName.replace('.codex.json', '');
  } else if (ext === '.md') {
    format = 'markdown';
    type = 'markdown';
    name = fileName.replace('.md', '');
  }

  // Base file node structure with Phase 2 discriminator
  const baseNode: any = {
    id: `file-${relative.replace(/[\\/.]/g, '-')}`,
    type,
    name, // Will be updated from file content
    _node_kind: 'file', // Phase 2: Discriminator
    _filename: fileName,
    _computed_path: relative,
    _format: format,
    _default_status: 'private',
    order: 1,
    children: [], // Will be populated with nodes/fields
  };

  // Process Full Codex files (YAML/JSON) - Phase 1 & 2 integration
  if (format === 'yaml' || format === 'json') {
    try {
      // Phase 1: Load file with auto-fixer
      const data = await loadAndParseCodexFile(filePath, root);

      if (data.type) {baseNode.type = data.type;}
      if (data.name) {baseNode.name = data.name;}

      // Phase 1: Resolve includes
      const resolvedChildren = await resolveIncludes(
        data.children,
        filePath,
        root,
        0, // Start at depth 0 for includes
        new Set([filePath]) // Mark this file as visited
      );

      // Phase 2: Extract nodes and fields from resolved children
      const entityChildren = await extractNodeChildren(
        resolvedChildren,
        relative, // Pass relative path for _parent_file
        root,
        1 // First-level nodes start at depth 1
      );

      baseNode.children = entityChildren;
    } catch (error) {
      log(`[createFileNode] Error processing ${fileName}: ${error}`);
      // Return base node without children on error
    }
  }

  // Process Codex Lite (Markdown) files
  else if (format === 'markdown') {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const { type: fmType, name: fmName } = parseFrontmatter(content);

      if (fmType) {baseNode.type = fmType;}
      if (fmName) {
        baseNode.name = fmName;
      } else {
        // Extract from first H1
        const h1Match = content.match(/^#\s+(.+)$/m);
        if (h1Match) {baseNode.name = h1Match[1].trim();}
      }

      // Markdown files are treated as flat nodes (no children extraction)
    } catch (error) {
      // Use defaults if parsing fails
    }
  }

  return baseNode;
}

/**
 * Parse YAML frontmatter from markdown
 */
function parseFrontmatter(content: string): { type?: string; name?: string } {
  const match = content.match(/^---\n([\s\S]+?)\n---/);
  if (!match) {return {};}

  try {
    const fm = YAML.parse(match[1]);
    return {
      type: fm.type,
      name: fm.name || fm.title,
    };
  } catch {
    return {};
  }
  }

  /**
 * Apply type styles to children recursively
   */
function applyTypeStyles(children: any[], typeStyles: any[]): void {
  const styleMap = new Map(typeStyles.map((s) => [s.type, s]));

  function apply(nodes: any[]): void {
    for (const node of nodes) {
      const style = styleMap.get(node.type);
      if (style) {
        if (!node.emoji && style.emoji) {node._type_emoji = style.emoji;}
        if (!node.color && style.color) {node._type_color = style.color;}
      }
      if (node.children) {apply(node.children);}
    }
  }

  apply(children);
          }

/**
 * No-op: array position in index.codex.yaml is the source of truth for ordering.
 * Ordering is applied by applyYamlOrder() during mergePerFolderIndexes().
 */
function sortChildrenRecursive(_children: any[]): void {
  // No-op — ordering is now handled by applyYamlOrder() in mergePerFolderIndexes
}

  /**
 * Get default patterns
 */
function getDefaultPatterns(): IndexPatterns {
  return {
    include: ['*.codex.yaml', '*.codex.json', '*.md'],
    exclude: [
      '**/node_modules/**',
      '**/.git/**',
      '**/__pycache__/**',
      '**/venv/**',
      '**/dist/**',
      '**/.DS_Store',
      '**/.*',
      '**/*.jpg',
      '**/*.png',
    ],
  };
}

/**
 * Count files in children tree
 */
function countFiles(children: any[]): number {
  let count = 0;
  for (const child of children) {
    if (child.type !== 'folder') {count++;}
    if (child.children) {count += countFiles(child.children);}
  }
  return count;
}

/**
 * Command handler: Generate Index
 */
export async function runGenerateIndex(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder open');
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  const indexPath = path.join(workspaceRoot, 'index.codex.yaml');

  // Generate with progress
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Generating Index',
      cancellable: true,
    },
    async (progress, token) => {
      try {
        const progressReporter: IndexGenerationProgress = {
          report: (message: string, increment?: number) => {
            progress.report({ message, increment });
          },
          token
        };

        const outputPath = await generateIndex({
          workspaceRoot,
          indexFilePath: fs.existsSync(indexPath) ? indexPath : undefined,
          progressReporter,
        });

        // Count files
        const content = fs.readFileSync(outputPath, 'utf-8');
        const data = JSON.parse(content);
        const fileCount = countFiles(data.children);

      const action = await vscode.window.showInformationMessage(
          `✅ Generated .index.codex.json\nFound ${fileCount} files`,
        'Open Index',
          'Show in Explorer'
      );

      if (action === 'Open Index') {
          const doc = await vscode.workspace.openTextDocument(outputPath);
        await vscode.window.showTextDocument(doc);
        } else if (action === 'Show in Explorer') {
          vscode.commands.executeCommand(
            'revealFileInOS',
            vscode.Uri.file(outputPath)
          );
        }
      } catch (error: any) {
        if (error.message?.includes('cancelled')) {
          vscode.window.showInformationMessage('Index generation cancelled');
          return;
        }
        vscode.window.showErrorMessage(
          `Failed to generate index: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}

/**
 * Command handler: Regenerate Index
 */
export async function runRegenerateIndex(basePath?: string): Promise<void> {
  return runGenerateIndex();
}

/**
 * Generate per-folder .index.codex.json for a specific folder
 * This creates a complete index for just the immediate children
 */
export async function generatePerFolderIndex(
  workspaceRoot: string,
  folderPath: string,
  progress?: IndexGenerationProgress
): Promise<string> {
  const fullFolderPath = path.join(workspaceRoot, folderPath);

  if (!fs.existsSync(fullFolderPath)) {
    throw new Error(`Folder not found: ${folderPath}`);
  }

  // Scan immediate children only (no recursion)
  const entries = fs.readdirSync(fullFolderPath, { withFileTypes: true });
  const children: any[] = [];

  // Count total files for progress reporting
  const totalFiles = entries.filter(e =>
    !e.name.startsWith('.') &&
    e.name !== '.index.codex.json'
  ).length;
  let processedFiles = 0;

  for (const entry of entries) {
    if (entry.name === '.index.codex.json' || entry.name.startsWith('.')) {
      continue; // Skip hidden files and the index itself
    }

    // Skip symlinks to prevent traversal outside workspace
    if (entry.isSymbolicLink()) {
      log(`[IndexGenerator] Skipping symlink in folder index: ${entry.name}`);
      continue;
    }

    // Check cancellation before processing each file
    if (progress?.token?.isCancellationRequested) {
      throw new Error('Index generation cancelled by user');
    }

    processedFiles++;

    // Report progress for this file with count
    const folderName = path.basename(folderPath || 'root');
    progress?.report(`[${folderName}] ${entry.name} (${processedFiles}/${totalFiles})`, 0);

    const childPath = path.join(fullFolderPath, entry.name);

    if (entry.isFile()) {
      // Check if it's a codex file
      if (entry.name.endsWith('.codex.yaml') ||
          entry.name.endsWith('.codex.json') ||
          entry.name.endsWith('.md')) {
        const fileNode = await createFileNode(childPath, entry.name, workspaceRoot);
        // Fix _computed_path to be relative to workspace root, not folder
        fileNode._computed_path = folderPath ? path.join(folderPath, entry.name) : entry.name;
        children.push(fileNode);
      }
    } else if (entry.isDirectory()) {
      // Create folder node
      const folderNode: any = {
        id: `folder-${entry.name}`,
        type: 'folder',
        name: entry.name,
        _computed_path: folderPath ? path.join(folderPath, entry.name) : entry.name,
        children: [] // Initialize empty children array
      };

      // Check if folder has a per-folder .index.codex.json
      const subIndexPath = path.join(childPath, '.index.codex.json');
      if (fs.existsSync(subIndexPath)) {
        try {
          const subIndexContent = fs.readFileSync(subIndexPath, 'utf-8');
          const subIndexData = JSON.parse(subIndexContent);

          if (subIndexData.children && Array.isArray(subIndexData.children)) {
            // Merge children from per-folder index
            folderNode.children = subIndexData.children;
          }
        } catch (error) {
          log(`Failed to merge per-folder index for ${entry.name}: ${error}`);
        }
      }

      children.push(folderNode);
    }
  }

  // Apply ordering from index.codex.yaml if it exists, otherwise sort by name
  // Legacy compat: if order fields exist (pre-migration), sort by them
  const hasExplicitOrder = children.some(c => c.order !== undefined);
  if (hasExplicitOrder) {
    children.sort((a, b) => {
      const orderA = a.order ?? 999;
      const orderB = b.order ?? 999;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });
  }
  // No longer assigning sequential order values — array position IS the order

  // Build index data
  const indexData = {
    metadata: {
      formatVersion: '3.0', // Phase 2: Bumped for node + field extraction
      documentVersion: '1.0.0',
      created: new Date().toISOString(),
      generated: true,
      type: 'index', // Complete index (not fragment)
    },
    id: `index-${folderPath.replace(/[\\/]/g, '-')}`,
    type: 'index',
    name: path.basename(folderPath),
    children,
  };

  // Write per-folder .index.codex.json
  const outputPath = path.join(fullFolderPath, '.index.codex.json');
  fs.writeFileSync(outputPath, JSON.stringify(indexData, null, 2), 'utf-8');

  return outputPath;
      }

/**
 * Cascade regenerate: update folder index and all parent indexes up to root
 * This is called after reordering files in a folder
 */
export async function cascadeRegenerateIndexes(
  workspaceRoot: string,
  changedFolderPath: string
): Promise<void> {
  // 1. Regenerate the immediate folder index
  await generatePerFolderIndex(workspaceRoot, changedFolderPath);

  // 2. Regenerate all parent folder indexes up to root
  let currentPath = changedFolderPath;

  while (currentPath) {
    const parentPath = path.dirname(currentPath);

    if (parentPath === '.' || parentPath === currentPath) {
      // Reached root
      break;
    }

    // Regenerate parent folder index
    await generatePerFolderIndex(workspaceRoot, parentPath);
    currentPath = parentPath;
  }

  // 3. Finally, regenerate top-level .index.codex.json
  await generateIndex({ workspaceRoot });
}

/**
 * Recursively generate per-folder indexes for a folder and all its subfolders
 * This implements the fractal cascade architecture by processing from deepest to shallowest
 *
 * @param workspaceRoot - Workspace root path
 * @param startFolder - Starting folder path (relative to workspace root)
 * @param progress - Optional progress reporter with cancellation support
 */
export async function generateFolderHierarchy(
  workspaceRoot: string,
  startFolder: string,
  progress?: IndexGenerationProgress
): Promise<void> {
  log(`[IndexGenerator] Generating folder hierarchy for: ${startFolder}`);

  const fullStartPath = path.join(workspaceRoot, startFolder);

  if (!fs.existsSync(fullStartPath)) {
    throw new Error(`Folder not found: ${startFolder}`);
  }

  // 1. Recursively collect all subfolders (depth-first)
  const allFolders: string[] = [];

  function collectSubfolders(folderPath: string) {
    const relativePath = path.relative(workspaceRoot, folderPath);
    allFolders.push(relativePath || '.');

    try {
      const entries = fs.readdirSync(folderPath, { withFileTypes: true });

      for (const entry of entries) {
        // Skip symlinks to prevent traversal outside workspace
        if (entry.isSymbolicLink()) {
          log(`[IndexGenerator] Skipping symlink during folder collection: ${entry.name}`);
          continue;
        }
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const subfolder = path.join(folderPath, entry.name);
          collectSubfolders(subfolder);
      }
    }
    } catch (error) {
      log(`[IndexGenerator] Error reading folder ${folderPath}: ${error}`);
    }
  }

  collectSubfolders(fullStartPath);

  const totalFolders = allFolders.length;
  log(`[IndexGenerator] Found ${totalFolders} folders to process`);
  progress?.report(`Scanning ${totalFolders} folders...`, 0);

  // 2. Sort by depth (deepest first)
  allFolders.sort((a, b) => {
    const depthA = a === '.' ? 0 : a.split(path.sep).length;
    const depthB = b === '.' ? 0 : b.split(path.sep).length;
    return depthB - depthA; // Deepest first
  });

  // 3. Generate per-folder index for each (deepest first)
  for (let i = 0; i < allFolders.length; i++) {
    const folderPath = allFolders[i];

    // Check cancellation
    if (progress?.token?.isCancellationRequested) {
      throw new Error('Index generation cancelled by user');
    }

    try {
      const folderName = folderPath === '.' ? 'root' : path.basename(folderPath);
      progress?.report(
        `Processing folder ${i + 1}/${totalFolders}: ${folderName}`,
        (100 / totalFolders)
      );
      log(`[IndexGenerator] Generating index for: ${folderPath}`);

      await generatePerFolderIndex(
        workspaceRoot,
        folderPath === '.' ? '' : folderPath,
        progress  // Pass progress through
      );
    } catch (error) {
      log(`[IndexGenerator] Error generating index for ${folderPath}: ${error}`);
      // Continue with other folders even if one fails
    }
  }

  // 4. Finally, regenerate top-level .index.codex.json to merge everything
  progress?.report('Finalizing index...', 0);
  log(`[IndexGenerator] Regenerating top-level index`);
  await generateIndex({ workspaceRoot });

  log(`[IndexGenerator] Folder hierarchy generation complete`);
}
