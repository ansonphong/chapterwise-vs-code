/**
 * Trash Manager - Project-level trash system
 *
 * Moves files to .chapterwise/trash/ instead of permanent deletion.
 * Supports restore, list, and empty operations.
 */

import * as path from 'path';
import * as fs from 'fs';

const fsPromises = fs.promises;

export interface TrashEntry {
  relativePath: string;
  name: string;
  trashedAt: Date;
  isDirectory: boolean;
}

export class TrashManager {
  readonly trashPath: string;

  constructor(private workspaceRoot: string) {
    this.trashPath = path.join(workspaceRoot, '.chapterwise', 'trash');
  }

  /**
   * Get the destination path in trash for a given relative path
   */
  getTrashDestination(relativePath: string): string {
    return path.join(this.trashPath, relativePath);
  }

  /**
   * Move a file or directory to trash.
   * Always calls ensureGitignore() internally (Fact #55).
   */
  async moveToTrash(relativePath: string): Promise<void> {
    const source = path.join(this.workspaceRoot, relativePath);
    const dest = this.getTrashDestination(relativePath);

    // Create destination directory
    await fsPromises.mkdir(path.dirname(dest), { recursive: true });

    // Move file/directory to trash
    await fsPromises.rename(source, dest);

    // Ensure .chapterwise/trash/ is in .gitignore
    await this.ensureGitignore();
  }

  /**
   * Restore a file from trash to its original location
   */
  async restoreFromTrash(relativePath: string): Promise<void> {
    const source = this.getTrashDestination(relativePath);
    const dest = path.join(this.workspaceRoot, relativePath);

    // Create destination directory if needed
    await fsPromises.mkdir(path.dirname(dest), { recursive: true });

    // Move back
    await fsPromises.rename(source, dest);
  }

  /**
   * List all entries in trash
   */
  async listTrash(): Promise<TrashEntry[]> {
    try {
      await fsPromises.access(this.trashPath);
    } catch {
      return [];
    }

    const entries: TrashEntry[] = [];
    await this.collectTrashEntries(this.trashPath, '', entries);
    return entries;
  }

  private async collectTrashEntries(basePath: string, relativePath: string, entries: TrashEntry[]): Promise<void> {
    const fullPath = relativePath ? path.join(basePath, relativePath) : basePath;
    let dirEntries: fs.Dirent[];
    try {
      dirEntries = await fsPromises.readdir(fullPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of dirEntries) {
      const entryRelPath = relativePath ? path.join(relativePath, entry.name) : entry.name;
      const entryFullPath = path.join(fullPath, entry.name);

      let stat: fs.Stats;
      try {
        stat = await fsPromises.stat(entryFullPath);
      } catch {
        continue;
      }

      entries.push({
        relativePath: entryRelPath,
        name: entry.name,
        trashedAt: stat.mtime,
        isDirectory: entry.isDirectory(),
      });

      if (entry.isDirectory()) {
        await this.collectTrashEntries(basePath, entryRelPath, entries);
      }
    }
  }

  /**
   * Empty the trash (delete everything in .chapterwise/trash/)
   */
  async emptyTrash(): Promise<void> {
    await fsPromises.rm(this.trashPath, { recursive: true, force: true });
  }

  /**
   * Check if trash has any entries
   */
  async hasTrash(): Promise<boolean> {
    try {
      const dirEntries = await fsPromises.readdir(this.trashPath);
      return dirEntries.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Ensure .chapterwise/trash/ is in .gitignore
   */
  async ensureGitignore(): Promise<void> {
    const gitignorePath = path.join(this.workspaceRoot, '.gitignore');
    const trashLine = '.chapterwise/trash/';

    let content = '';
    try {
      content = await fsPromises.readFile(gitignorePath, 'utf-8');
    } catch {
      // .gitignore doesn't exist — will create it
    }

    // Check if line already present
    const lines = content.split('\n');
    if (lines.some(line => line.trim() === trashLine)) {
      return; // Already present
    }

    // Append the line
    const newContent = content.endsWith('\n') || content === ''
      ? content + trashLine + '\n'
      : content + '\n' + trashLine + '\n';

    await fsPromises.writeFile(gitignorePath, newContent, 'utf-8');
  }
}
