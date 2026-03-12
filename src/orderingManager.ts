/**
 * Ordering Manager - Unified ordering via index.codex.yaml
 *
 * Source of truth for file ordering is the array position in index.codex.yaml.
 * Replaces numeric `order` fields in .index.codex.json.
 */

import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';

const fsPromises = fs.promises;

export interface OrderEntry {
  name: string;
  type: 'file' | 'folder';
  children?: OrderEntry[];
}

export interface OrderIndex {
  metadata?: { formatVersion: string };
  children: OrderEntry[];
}

/**
 * OrderingManager - manages file ordering via index.codex.yaml
 */
export class OrderingManager {
  private indexPath: string;
  readonly wsRoot: string;

  constructor(private workspaceRoot: string) {
    this.wsRoot = workspaceRoot;
    this.indexPath = path.join(workspaceRoot, 'index.codex.yaml');
  }

  /**
   * Read and parse index.codex.yaml
   */
  async readIndex(): Promise<OrderIndex | null> {
    try {
      const content = await fsPromises.readFile(this.indexPath, 'utf-8');
      const data = YAML.parse(content);
      if (!data || typeof data !== 'object') return null;
      return data as OrderIndex;
    } catch {
      return null;
    }
  }

  /**
   * Write index.codex.yaml
   */
  async writeIndex(data: OrderIndex): Promise<void> {
    const content = YAML.stringify(data, { lineWidth: 0 });
    await fsPromises.writeFile(this.indexPath, content, 'utf-8');
  }

  /**
   * Generate index.codex.yaml from filesystem scan
   */
  async generateFromFilesystem(): Promise<OrderIndex> {
    const children = await this.scanDirectory(this.workspaceRoot);
    const index: OrderIndex = {
      metadata: { formatVersion: '1.0' },
      children,
    };
    await this.writeIndex(index);
    return index;
  }

  /**
   * Sync existing index.codex.yaml with filesystem.
   * Adds new files not in index, removes entries for deleted files.
   */
  async syncWithFilesystem(): Promise<void> {
    const index = await this.readIndex();
    if (!index) {
      await this.generateFromFilesystem();
      return;
    }

    await this.syncFolder(this.workspaceRoot, '', index.children);
    await this.writeIndex(index);
  }

  /**
   * Recursively sync a folder's children with disk
   */
  private async syncFolder(basePath: string, relativePath: string, children: OrderEntry[]): Promise<void> {
    const fullPath = relativePath ? path.join(basePath, relativePath) : basePath;

    let entries: fs.Dirent[];
    try {
      entries = await fsPromises.readdir(fullPath, { withFileTypes: true });
    } catch {
      return;
    }

    // Build set of actual disk entries (files + folders)
    const diskEntries = new Map<string, 'file' | 'folder'>();
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        diskEntries.set(entry.name, 'folder');
      } else if (
        entry.name.endsWith('.codex.yaml') ||
        entry.name.endsWith('.codex.json') ||
        entry.name.endsWith('.md')
      ) {
        // Skip index files themselves
        if (entry.name === 'index.codex.yaml' || entry.name === 'index.codex.json' || entry.name === '.index.codex.json') continue;
        diskEntries.set(entry.name, 'file');
      }
    }

    // Remove entries that no longer exist on disk
    for (let i = children.length - 1; i >= 0; i--) {
      if (!diskEntries.has(children[i].name)) {
        children.splice(i, 1);
      }
    }

    // Add new entries that aren't in index
    const existingNames = new Set(children.map(c => c.name));
    for (const [name, type] of diskEntries) {
      if (!existingNames.has(name)) {
        const entry: OrderEntry = { name, type };
        if (type === 'folder') {
          entry.children = [];
        }
        children.push(entry);
      }
    }

    // Recurse into folders
    for (const child of children) {
      if (child.type === 'folder' && child.children) {
        const childRelPath = relativePath ? path.join(relativePath, child.name) : child.name;
        await this.syncFolder(basePath, childRelPath, child.children);
      }
    }
  }

  /**
   * Scan a directory and return OrderEntry[] for its contents
   */
  private async scanDirectory(dirPath: string): Promise<OrderEntry[]> {
    const entries: OrderEntry[] = [];

    let dirEntries: fs.Dirent[];
    try {
      dirEntries = await fsPromises.readdir(dirPath, { withFileTypes: true });
    } catch {
      return entries;
    }

    for (const entry of dirEntries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        const children = await this.scanDirectory(path.join(dirPath, entry.name));
        entries.push({ name: entry.name, type: 'folder', children });
      } else if (
        entry.name.endsWith('.codex.yaml') ||
        entry.name.endsWith('.codex.json') ||
        entry.name.endsWith('.md')
      ) {
        if (entry.name === 'index.codex.yaml' || entry.name === 'index.codex.json' || entry.name === '.index.codex.json') continue;
        entries.push({ name: entry.name, type: 'file' });
      }
    }

    return entries;
  }

  /**
   * Find children array for a given folder path.
   * Empty string means root level.
   */
  findFolderChildren(index: OrderIndex, folderPath: string): OrderEntry[] {
    if (!folderPath || folderPath === '' || folderPath === '.') {
      return index.children;
    }

    const segments = folderPath.split(/[/\\]/).filter(Boolean);
    let current = index.children;

    for (const segment of segments) {
      const folder = current.find(c => c.name === segment && c.type === 'folder');
      if (!folder || !folder.children) return [];
      current = folder.children;
    }

    return current;
  }

  /**
   * Move an entry up (swap with previous sibling)
   */
  async moveUp(folderPath: string, name: string): Promise<boolean> {
    const index = await this.readIndex();
    if (!index) return false;

    const children = this.findFolderChildren(index, folderPath);
    const idx = children.findIndex(c => c.name === name);
    if (idx <= 0) return false;

    // Swap with previous
    [children[idx - 1], children[idx]] = [children[idx], children[idx - 1]];
    await this.writeIndex(index);
    return true;
  }

  /**
   * Move an entry down (swap with next sibling)
   */
  async moveDown(folderPath: string, name: string): Promise<boolean> {
    const index = await this.readIndex();
    if (!index) return false;

    const children = this.findFolderChildren(index, folderPath);
    const idx = children.findIndex(c => c.name === name);
    if (idx === -1 || idx >= children.length - 1) return false;

    // Swap with next
    [children[idx], children[idx + 1]] = [children[idx + 1], children[idx]];
    await this.writeIndex(index);
    return true;
  }

  /**
   * Move an entry to a specific position (for drag-and-drop)
   */
  async moveToPosition(folderPath: string, name: string, newIndex: number): Promise<boolean> {
    const index = await this.readIndex();
    if (!index) return false;

    const children = this.findFolderChildren(index, folderPath);
    const idx = children.findIndex(c => c.name === name);
    if (idx === -1) return false;

    const [entry] = children.splice(idx, 1);
    const clampedIndex = Math.max(0, Math.min(newIndex, children.length));
    children.splice(clampedIndex, 0, entry);
    await this.writeIndex(index);
    return true;
  }

  /**
   * Move an entry from one folder to another
   */
  async moveToFolder(sourcePath: string, destFolder: string): Promise<boolean> {
    const index = await this.readIndex();
    if (!index) return false;

    const sourceDir = path.dirname(sourcePath);
    const sourceName = path.basename(sourcePath);
    const sourceFolder = sourceDir === '.' ? '' : sourceDir;

    const sourceChildren = this.findFolderChildren(index, sourceFolder);
    const idx = sourceChildren.findIndex(c => c.name === sourceName);
    if (idx === -1) return false;

    const [entry] = sourceChildren.splice(idx, 1);
    const destChildren = this.findFolderChildren(index, destFolder);
    destChildren.push(entry);

    await this.writeIndex(index);
    return true;
  }

  /**
   * Add an entry to a folder
   */
  async addEntry(folderPath: string, entry: OrderEntry): Promise<void> {
    const index = await this.readIndex();
    if (!index) return;

    const children = this.findFolderChildren(index, folderPath);
    children.push(entry);
    await this.writeIndex(index);
  }

  /**
   * Remove an entry from a folder
   */
  async removeEntry(folderPath: string, name: string): Promise<boolean> {
    const index = await this.readIndex();
    if (!index) return false;

    const children = this.findFolderChildren(index, folderPath);
    const idx = children.findIndex(c => c.name === name);
    if (idx === -1) return false;

    children.splice(idx, 1);
    await this.writeIndex(index);
    return true;
  }
}

// Singleton management
let instance: OrderingManager | null = null;

export function getOrderingManager(workspaceRoot: string): OrderingManager {
  if (!instance || instance.wsRoot !== workspaceRoot) {
    instance = new OrderingManager(workspaceRoot);
  }
  return instance;
}

export function disposeOrderingManager(): void {
  instance = null;
}
