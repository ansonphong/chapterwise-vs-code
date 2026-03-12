import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseIndexFile, IndexDocument, IndexChildNode } from './indexParser';

/**
 * Represents a discovered index file
 */
export interface DiscoveredIndex {
  /** Absolute path to the index file */
  path: string;
  /** Relative path from workspace root */
  relativePath: string;
  /** Parsed index document */
  document: IndexDocument;
  /** Display name for the view */
  displayName: string;
  /** Files/folders this index claims ownership of */
  coveredPaths: Set<string>;
  /** Assigned view slot (0-7) */
  viewSlot?: number;
}

/**
 * Manages discovery and display of multiple index.codex.yaml files (human-written)
 */
export class MultiIndexManager {
  private discoveredIndexes: Map<string, DiscoveredIndex> = new Map();
  private masterOrphans: string[] = [];
  private workspaceRoot: string | null = null;

  constructor(private context: vscode.ExtensionContext) {}

  /**
   * Discover all index.codex.yaml files in the workspace
   */
  async discoverIndexes(workspaceRoot: string): Promise<DiscoveredIndex[]> {
    this.workspaceRoot = workspaceRoot;
    this.discoveredIndexes.clear();

    // Find all index.codex.yaml files (human-written, excluding generated .index.codex.json)
    const pattern = new vscode.RelativePattern(
      workspaceRoot,
      '**/index.codex.yaml'
    );

    const indexFiles = await vscode.workspace.findFiles(pattern, '**/node_modules/**');

    for (const uri of indexFiles) {
      await this.loadIndex(uri.fsPath);
    }

    // Calculate orphans for master index
    this.calculateOrphans();

    // Update visibility context
    this.updateViewVisibility();

    return Array.from(this.discoveredIndexes.values());
  }

  /**
   * Load and parse a single index file
   */
  private async loadIndex(indexPath: string): Promise<void> {
    try {
      const content = fs.readFileSync(indexPath, 'utf-8');
      const document = parseIndexFile(content);

      if (!document) {
        console.error(`[MultiIndexManager] Failed to parse index: ${indexPath}`);
        return;
      }

      if (!this.workspaceRoot) return;

      const relativePath = path.relative(this.workspaceRoot, indexPath);
      const indexDir = path.dirname(indexPath);

      // Calculate covered paths (the directory containing this index)
      const coveredPaths = new Set<string>();
      coveredPaths.add(indexDir);

      // Also add any explicitly included paths
      this.collectCoveredPaths(document.children, indexDir, coveredPaths);

      const discovered: DiscoveredIndex = {
        path: indexPath,
        relativePath,
        document,
        displayName: document.name || path.basename(path.dirname(indexPath)),
        coveredPaths
      };

      this.discoveredIndexes.set(indexPath, discovered);
    } catch (error) {
      console.error(`[MultiIndexManager] Failed to load index: ${indexPath}`, error);
    }
  }

  /**
   * Recursively collect paths covered by an index
   */
  private collectCoveredPaths(
    children: IndexChildNode[],
    baseDir: string,
    coveredPaths: Set<string>
  ): void {
    if (!children) return;

    for (const child of children) {
      if (child.include) {
        const includePath = path.resolve(baseDir, child.include);
        const normalized = path.normalize(includePath);

        // Security check: only add paths within workspace
        if (this.workspaceRoot) {
          const relative = path.relative(this.workspaceRoot, normalized);
          if (relative.startsWith('..') || path.isAbsolute(relative)) {
            console.warn(`[MultiIndexManager] Include path escapes workspace: ${child.include}`);
            continue;
          }
        }

        coveredPaths.add(normalized);
      }

      if (child.children) {
        this.collectCoveredPaths(child.children, baseDir, coveredPaths);
      }
    }
  }

  /**
   * Calculate orphan files (not covered by any sub-index)
   */
  private calculateOrphans(): void {
    if (!this.workspaceRoot) return;

    // Find the master index (at workspace root)
    const masterIndexPath = path.join(this.workspaceRoot, 'index.codex.yaml');
    const masterIndex = this.discoveredIndexes.get(masterIndexPath);

    if (!masterIndex) {
      this.masterOrphans = [];
      return;
    }

    // Get all children from master index
    const masterChildren = masterIndex.document.children || [];

    // Filter to only orphans
    this.masterOrphans = masterChildren
      .filter(child => {
        // Skip sub-index includes
        if (child.include?.endsWith('index.codex.yaml')) {
          return false;
        }

        // Check if any sub-index claims this path
        if (!child.include) return true; // Inline children are orphans

        const childPath = path.resolve(this.workspaceRoot!, child.include);
        const normalized = path.normalize(childPath);

        // Security check: skip paths outside workspace
        const relative = path.relative(this.workspaceRoot!, normalized);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          console.warn(`[MultiIndexManager] Orphan path escapes workspace: ${child.include}`);
          return false;
        }

        return !this.isClaimedBySubIndex(normalized);
      })
      .map(child => child.include || child.name);
  }

  /**
   * Check if a path is claimed by any sub-index
   */
  private isClaimedBySubIndex(filePath: string): boolean {
    for (const [indexPath, index] of this.discoveredIndexes) {
      // Skip the master index itself
      if (indexPath === path.join(this.workspaceRoot!, 'index.codex.yaml')) {
        continue;
      }

      for (const coveredPath of index.coveredPaths) {
        // Use path.relative for path-boundary-aware comparison
        // A file is "under" a covered path if relative doesn't start with '..'
        const relative = path.relative(coveredPath, filePath);
        if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Update VS Code context for view visibility
   */
  private updateViewVisibility(): void {
    const indexes = Array.from(this.discoveredIndexes.values());
    const subIndexes = indexes.filter(idx =>
      idx.path !== path.join(this.workspaceRoot!, 'index.codex.yaml')
    );

    // Set hasMultipleIndexes context
    const hasMultiple = subIndexes.length > 0;
    vscode.commands.executeCommand(
      'setContext',
      'chapterwise.hasMultipleIndexes',
      hasMultiple
    );

    // Assign view slots and set visibility
    subIndexes.forEach((index, i) => {
      if (i < 8) {
        index.viewSlot = i;
        vscode.commands.executeCommand(
          'setContext',
          `chapterwise.index${i}Visible`,
          true
        );
      }
    });

    // Hide unused slots
    for (let i = subIndexes.length; i < 8; i++) {
      vscode.commands.executeCommand(
        'setContext',
        `chapterwise.index${i}Visible`,
        false
      );
    }
  }

  /**
   * Get discovered indexes (excluding master)
   */
  getSubIndexes(): DiscoveredIndex[] {
    if (!this.workspaceRoot) return [];

    const masterPath = path.join(this.workspaceRoot, 'index.codex.yaml');
    return Array.from(this.discoveredIndexes.values())
      .filter(idx => idx.path !== masterPath);
  }

  /**
   * Get the master index
   */
  getMasterIndex(): DiscoveredIndex | undefined {
    if (!this.workspaceRoot) return undefined;

    const masterPath = path.join(this.workspaceRoot, 'index.codex.yaml');
    return this.discoveredIndexes.get(masterPath);
  }

  /**
   * Get orphan file paths for master index display
   */
  getOrphanPaths(): string[] {
    return this.masterOrphans;
  }

  /**
   * Check if multi-index mode is active
   */
  isMultiIndexMode(): boolean {
    const config = vscode.workspace.getConfiguration('chapterwise');
    const mode = config.get<string>('indexDisplayMode', 'stacked');
    return mode === 'stacked' && this.getSubIndexes().length > 0;
  }
}
