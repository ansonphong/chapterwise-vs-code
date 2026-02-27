/**
 * Index Parser
 *
 * Parses and validates index.codex.yaml files
 * V2: Supports nested index resolution (include: ./sub/index.codex.yaml)
 */

import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';

/**
 * Include directive (V2 nested indexes)
 */
export interface IncludeDirective {
  include: string; // Relative path to included file (e.g., "./book-1/index.codex.yaml")
}

/**
 * Index child node structure (matches backend format)
 */
export interface IndexChildNode {
  id: string;
  type: string;
  name: string; // Display name (read from file content or derived)
  title?: string; // Optional alternative title
  /** @deprecated Use index.codex.yaml array position instead. */
  order?: number;
  expanded?: boolean; // Default expansion state
  emoji?: string; // Custom emoji (overrides typeStyles)
  color?: string; // Custom color (overrides typeStyles)
  attributes?: Array<{ key: string; value: string }>;
  children?: IndexChildNode[]; // Nested children (folders only)
  include?: string; // V2: Include directive for nested index or content file

  // Auto-computed fields (added by generator/parser)
  _filename?: string; // Actual filename on disk (REQUIRED for files)
  _computed_path?: string; // Full path from repo root (REQUIRED, computed during parsing)
  _format?: string; // File format: 'yaml' | 'json' | 'markdown'
  _type_emoji?: string; // Emoji from typeStyles (auto-applied)
  _type_color?: string; // Color from typeStyles (auto-applied)
  _default_status?: string; // Default status if not explicitly set
  _subindex_path?: string; // V2: Absolute path to the sub-index file this node was expanded from

  // For tree navigation (runtime only)
  parent?: IndexChildNode; // Parent node reference (not serialized)
}

/**
 * Type style definition
 */
export interface TypeStyle {
  type: string;
  emoji?: string;
  color?: string;
}

/**
 * Index document structure (V2.1)
 */
export interface IndexDocument {
  metadata: {
    formatVersion: string;
    documentVersion?: string;
    created?: string;
    generated?: boolean;
    author?: string | string[];
  };
  id: string;
  type: 'index';
  name: string;
  title?: string;
  summary?: string;
  attributes?: Array<{ key: string; value: string }>;
  patterns?: {
    include?: string[];
    exclude?: string[];
  };
  typeStyles?: TypeStyle[];
  status?: 'published' | 'private' | 'draft';
  children: IndexChildNode[];
}

/**
 * Parse index.codex.yaml file
 */
export function parseIndexFile(content: string): IndexDocument | null {
  try {
    const data = YAML.parse(content);

    // Validate basic structure
    if (!data || typeof data !== 'object') {
      return null;
    }

    if (data.type !== 'index') {
      return null;
    }

    // Apply type styles to children
    if (data.typeStyles && data.children) {
      applyTypeStyles(data.children, data.typeStyles);
    }

    // Trust that generator already set correct _computed_path values
    // No need to compute paths - generator does this correctly

    // Apply default status
    if (data.children) {
      applyDefaultStatus(data.children);
    }

    return data as IndexDocument;
  } catch (error) {
    console.error('[IndexParser] Failed to parse index file:', error);
    return null;
  }
}

/**
 * Parse generated .index.codex.json file (fast path)
 */
export function parseIndexFileJSON(content: string): IndexDocument | null {
  try {
    const data = JSON.parse(content);

    if (!data || typeof data !== 'object' || data.type !== 'index') {
      return null;
    }

    // Apply type styles and default status (same as YAML path)
    if (data.typeStyles && data.children) {
      applyTypeStyles(data.children, data.typeStyles);
    }
    if (data.children) {
      applyDefaultStatus(data.children);
    }

    return data as IndexDocument;
  } catch (error) {
    console.error('[IndexParser] Failed to parse JSON index:', error);
    return null;
  }
}

/**
 * Apply type styles to children recursively
 */
function applyTypeStyles(children: IndexChildNode[], typeStyles: TypeStyle[]): void {
  // Build lookup map
  const styleMap = new Map<string, TypeStyle>();
  for (const style of typeStyles) {
    styleMap.set(style.type, style);
  }

  function apply(nodes: IndexChildNode[]): void {
    for (const node of nodes) {
      const style = styleMap.get(node.type);
      if (style) {
        if (!node.emoji && style.emoji) {
          node._type_emoji = style.emoji;
        }
        if (!node.color && style.color) {
          node._type_color = style.color;
        }
      }

      if (node.children) {
        apply(node.children);
      }
    }
  }

  apply(children);
}

/**
 * Apply default status to children without explicit status
 */
function applyDefaultStatus(children: IndexChildNode[]): void {
  for (const child of children) {
    if (!child._default_status) {
      child._default_status = 'private';
    }

    if (child.children) {
      applyDefaultStatus(child.children);
    }
  }
}

/**
 * Check if file is an index file
 */
export function isIndexFile(fileName: string): boolean {
  const base = path.basename(fileName);
  return (
    base === 'index.codex.yaml' ||
    base === 'index.codex.json' ||
    base === '.index.codex.json'
  );
}

/**
 * Get effective emoji for a node (explicit or from type style)
 */
export function getEffectiveEmoji(node: IndexChildNode): string | undefined {
  // Check explicit attributes first
  if (node.attributes) {
    const emojiAttr = node.attributes.find((a) => a.key === 'emoji');
    if (emojiAttr) {
      return emojiAttr.value;
    }
  }

  // Then check direct emoji field
  if (node.emoji) {
    return node.emoji;
  }

  // Finally check type style emoji
  return node._type_emoji;
}

/**
 * Get effective color for a node (explicit or from type style)
 */
export function getEffectiveColor(node: IndexChildNode): string | undefined {
  // Check explicit attributes first
  if (node.attributes) {
    const colorAttr = node.attributes.find((a) => a.key === 'color');
    if (colorAttr) {
      return colorAttr.value;
    }
  }

  // Then check direct color field
  if (node.color) {
    return node.color;
  }

  // Finally check type style color
  return node._type_color;
}

/**
 * Count files in children tree
 */
export function countFilesInIndex(children: IndexChildNode[]): number {
  let count = 0;
  for (const child of children) {
    if (child.type !== 'folder') {
      count++;
    }
    if (child.children) {
      count += countFilesInIndex(child.children);
    }
  }
  return count;
}

// ========== V2: NESTED INDEX RESOLUTION ==========

/**
 * Check if a child entry is an include directive
 */
export function isIncludeDirective(child: any): child is IncludeDirective {
  return child && typeof child === 'object' && typeof child.include === 'string';
}

/**
 * Check if an include points to a sub-index file.
 * Supports both visible and hidden variants:
 * - index.codex.yaml (committed YAML - human-written)
 * - index.codex.json (committed JSON - human-written)
 * - .index.codex.json (hidden cache JSON - generated)
 */
export function isSubIndexInclude(includePath: string): boolean {
  if (!includePath || typeof includePath !== 'string') {
    return false;
  }
  const fileName = path.basename(includePath);
  return (
    fileName === 'index.codex.yaml' ||
    fileName === 'index.codex.json' ||
    fileName === '.index.codex.json'
  );
}

/** Maximum nesting depth for sub-index resolution (matches indexGenerator) */
const MAX_SUB_INDEX_DEPTH = 8;

/**
 * Resolve sub-index includes recursively.
 * Loads nested index.codex.yaml files and merges them into the tree.
 *
 * @param children - Array of child nodes (may contain include directives)
 * @param parentDir - Absolute path to the directory containing the parent index
 * @param workspaceRoot - Workspace root for boundary validation
 * @param parsedIndexes - Set of already-parsed index paths (circular reference detection)
 * @param depth - Current recursion depth (enforces MAX_SUB_INDEX_DEPTH)
 * @returns Resolved children array with includes expanded
 */
export function resolveSubIndexIncludes(
  children: any[],
  parentDir: string,
  workspaceRoot: string,
  parsedIndexes: Set<string> = new Set(),
  depth: number = 0
): IndexChildNode[] {
  // Depth limit to prevent stack overflow from deep non-circular chains
  if (depth >= MAX_SUB_INDEX_DEPTH) {
    console.warn(`[IndexParser] Max sub-index depth ${MAX_SUB_INDEX_DEPTH} reached, stopping resolution`);
    return [];
  }

  const resolved: IndexChildNode[] = [];

  for (const child of children) {
    if (isIncludeDirective(child)) {
      const includePath = child.include;

      if (isSubIndexInclude(includePath)) {
        // Load and merge sub-index
        const subIndexPath = path.resolve(parentDir, includePath);
        const normalizedPath = path.normalize(subIndexPath);

        // Security check: ensure resolved path is within workspace
        const relative = path.relative(workspaceRoot, normalizedPath);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          console.warn(`[IndexParser] Sub-index path escapes workspace: ${includePath}`);
          continue;
        }

        // Circular reference check
        if (parsedIndexes.has(normalizedPath)) {
          console.warn(`[IndexParser] Circular sub-index reference detected: ${subIndexPath}`);
          continue;
        }

        // Symlink check: skip symlinks to prevent reading outside workspace
        try {
          const stat = fs.lstatSync(subIndexPath);
          if (stat.isSymbolicLink()) {
            console.warn(`[IndexParser] Skipping symlink sub-index: ${subIndexPath}`);
            continue;
          }
        } catch {
          // File doesn't exist - fall through to existsSync check below
        }

        if (fs.existsSync(subIndexPath)) {
          // Add to parsed set before parsing (prevent infinite recursion)
          parsedIndexes.add(normalizedPath);
          try {
            const subContent = fs.readFileSync(subIndexPath, 'utf-8');
            let subData: any;

            if (subIndexPath.endsWith('.json')) {
              subData = JSON.parse(subContent);
            } else {
              subData = YAML.parse(subContent);
            }

            if (subData && typeof subData === 'object') {
              // Get directory name for correct path computation
              const dirName = path.basename(path.dirname(subIndexPath));

              // Merge sub-index as a node
              const subNode: IndexChildNode = {
                id: subData.id || dirName,
                type: subData.type || 'folder',
                name: subData.name || dirName,
                // IMPORTANT: Set _filename to directory name for correct path computation
                // This ensures paths like "book-1/chapters/..." instead of "Book One/chapters/..."
                _filename: dirName,
                _subindex_path: subIndexPath, // Renamed from _included_from for web app parity
              };

              // Copy optional fields
              if (subData.summary) {subNode.title = subData.summary;}
              if (subData.emoji) {subNode.emoji = subData.emoji;}
              if (subData.scrivener_label) {
                subNode.attributes = [{ key: 'scrivener_label', value: subData.scrivener_label }];
              }

              // Recursively resolve sub-index children
              if (subData.children && Array.isArray(subData.children)) {
                subNode.children = resolveSubIndexIncludes(
                  subData.children,
                  path.dirname(subIndexPath),
                  workspaceRoot,
                  parsedIndexes,
                  depth + 1
                );
              }

              resolved.push(subNode);
            }
          } catch (error) {
            console.error(`[IndexParser] Failed to load sub-index ${subIndexPath}:`, error);
          }
        } else {
          console.warn(`[IndexParser] Sub-index not found: ${subIndexPath}`);
        }
      } else {
        // Regular file include (e.g., ./chapter-01.md)
        const resolvedIncludePath = path.resolve(parentDir, includePath);
        const normalizedIncludePath = path.normalize(resolvedIncludePath);

        // Security check: ensure resolved path is within workspace
        const relative = path.relative(workspaceRoot, normalizedIncludePath);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          console.warn(`[IndexParser] Include path escapes workspace: ${includePath}`);
          continue;
        }

        // Convert to a basic node with include path as filename
        const fileName = path.basename(includePath);
        const ext = path.extname(fileName);
        const baseName = path.basename(fileName, ext);

        resolved.push({
          id: `file-${baseName}`,
          type: 'document', // Will be refined by content parsing
          name: baseName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          _filename: fileName,
          _subindex_path: normalizedIncludePath,
          _format: ext === '.md' ? 'markdown' : ext === '.yaml' ? 'yaml' : 'json',
        });
      }
    } else if (child && typeof child === 'object') {
      // Regular node - copy and recurse if has children
      const node: IndexChildNode = { ...child };

      if (child.children && Array.isArray(child.children)) {
        // Determine directory for nested children
        const childDir = child._filename
          ? path.join(parentDir, path.dirname(child._filename))
          : parentDir;
        node.children = resolveSubIndexIncludes(child.children, childDir, workspaceRoot, parsedIndexes, depth + 1);
      }

      resolved.push(node);
    }
  }

  return resolved;
}

/**
 * Parse index file with sub-index resolution.
 * Use this for V2 nested index structures.
 *
 * @param content - YAML content of the index file
 * @param indexDir - Absolute path to the directory containing the index file
 * @param workspaceRoot - Workspace root for boundary validation
 * @param indexPath - Absolute path to the index file itself (for circular detection)
 * @returns Parsed and resolved IndexDocument
 */
export function parseIndexFileWithIncludes(
  content: string,
  indexDir: string,
  workspaceRoot: string,
  indexPath?: string
): IndexDocument | null {
  const doc = parseIndexFile(content);
  if (!doc) {return null;}

  // Initialize parsed indexes set with current index
  const parsedIndexes = new Set<string>();
  if (indexPath) {
    parsedIndexes.add(path.normalize(indexPath));
  }

  // Resolve any include directives in children
  if (doc.children && Array.isArray(doc.children)) {
    doc.children = resolveSubIndexIncludes(doc.children, indexDir, workspaceRoot, parsedIndexes);
  }

  return doc;
}
