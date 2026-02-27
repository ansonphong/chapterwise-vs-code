/**
 * Structure Editor - Filesystem-first operations
 * 
 * CORE PRINCIPLE: Filesystem is source of truth, index is derived cache
 * 
 * All operations:
 * 1. Perform filesystem operation (move, rename, delete)
 * 2. Update any broken include paths
 * 3. Regenerate .index.codex.json from filesystem
 * 4. Refresh UI
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as YAML from 'yaml';
import { CodexNode, PathSegment } from './codexModel';
import { NavigatorSettings } from './settingsManager';
import { generateIndex, generatePerFolderIndex, cascadeRegenerateIndexes } from './indexGenerator';

const fsPromises = fs.promises;

/** Check if a file/directory exists (async) */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate that a resolved path stays within the workspace root.
 * Prevents path traversal via malicious file paths.
 */
function isPathWithinRoot(resolvedPath: string, rootPath: string): boolean {
  const normalizedResolved = path.resolve(resolvedPath);
  const normalizedRoot = path.resolve(rootPath);
  return normalizedResolved.startsWith(normalizedRoot + path.sep) || normalizedResolved === normalizedRoot;
}

/**
 * Result of a structure operation
 */
export interface StructureOperationResult {
  success: boolean;
  message?: string;
  newPath?: string;
  affectedFiles?: string[];
}

/**
 * Structure Editor - Handles all filesystem operations
 */
export class CodexStructureEditor {
  /**
   * Move a file on disk (INDEX mode)
   * Then regenerates index to reflect new filesystem structure
   * 
   * @param workspaceRoot - Root of the workspace
   * @param sourceFilePath - Current file path (relative to workspace)
   * @param targetParentPath - Target directory path (relative to workspace)
   * @param settings - Navigator settings
   * @returns Result of the operation
   */
  async moveFileInIndex(
    workspaceRoot: string,
    sourceFilePath: string,
    targetParentPath: string,
    settings: NavigatorSettings
  ): Promise<StructureOperationResult> {
    try {
      const sourceFull = path.join(workspaceRoot, sourceFilePath);
      const fileName = path.basename(sourceFilePath);
      const targetFull = path.join(workspaceRoot, targetParentPath, fileName);

      // Validate paths stay within workspace
      if (!isPathWithinRoot(sourceFull, workspaceRoot) || !isPathWithinRoot(targetFull, workspaceRoot)) {
        return {
          success: false,
          message: 'Path traversal detected: paths must stay within workspace'
        };
      }

      // Check if source exists
      if (!await fileExists(sourceFull)) {
        return {
          success: false,
          message: `Source file not found: ${sourceFilePath}`
        };
      }

      // Check if target directory exists
      const targetDir = path.dirname(targetFull);
      if (!await fileExists(targetDir)) {
        // Create target directory
        await fsPromises.mkdir(targetDir, { recursive: true });
      }

      // Check if target already exists
      if (await fileExists(targetFull)) {
        return {
          success: false,
          message: `Target file already exists: ${path.join(targetParentPath, fileName)}`
        };
      }

      // Move the file
      await fsPromises.rename(sourceFull, targetFull);

      // Update include paths (with rollback on failure)
      let affectedFiles: string[] = [];
      try {
        affectedFiles = await this.updateIncludePaths(
          workspaceRoot,
          sourceFilePath,
          path.join(targetParentPath, fileName)
        );
      } catch (includeError) {
        // Attempt rollback - rename back to original
        try {
          await fsPromises.rename(targetFull, sourceFull);
        } catch {
          // Rollback failed - file is at new location but includes are broken
        }
        return {
          success: false,
          message: `Failed to update include paths (file restored): ${includeError}`
        };
      }

      // HYBRID APPROACH: Try surgical update first, fall back to full rescan
      const surgicalSuccess = await this.updateIndexEntrySurgically(
        workspaceRoot,
        sourceFilePath,
        path.join(targetParentPath, fileName)
      );

      if (!surgicalSuccess) {
        await generateIndex({ workspaceRoot });
      }

      return {
        success: true,
        message: `Moved ${fileName} to ${targetParentPath}`,
        newPath: path.join(targetParentPath, fileName),
        affectedFiles
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to move file: ${error}`
      };
    }
  }
  
  /**
   * Rename a file on disk (INDEX mode)
   * Renames file, updates includes, regenerates index
   * 
   * @param workspaceRoot - Root of the workspace
   * @param oldPath - Current file path (relative to workspace)
   * @param newName - New file name (without extension)
   * @param settings - Navigator settings
   * @returns Result with new path
   */
  async renameFileInIndex(
    workspaceRoot: string,
    oldPath: string,
    newName: string,
    settings: NavigatorSettings
  ): Promise<StructureOperationResult> {
    try {
      const oldFull = path.join(workspaceRoot, oldPath);
      const dir = path.dirname(oldPath);
      const ext = path.extname(oldPath);
      
      // Apply naming conventions from settings
      let sanitizedName = newName;
      if (settings.naming.slugify) {
        sanitizedName = this.slugifyName(newName, settings.naming);
      }
      
      const newFileName = `${sanitizedName}${ext}`;
      const newPath = path.join(dir, newFileName);
      const newFull = path.join(workspaceRoot, newPath);

      // Validate paths stay within workspace
      if (!isPathWithinRoot(oldFull, workspaceRoot) || !isPathWithinRoot(newFull, workspaceRoot)) {
        return {
          success: false,
          message: 'Path traversal detected: renamed path must stay within workspace'
        };
      }

      // Check if source exists
      if (!await fileExists(oldFull)) {
        return {
          success: false,
          message: `Source file not found: ${oldPath}`
        };
      }

      // Check if target already exists
      if (oldFull !== newFull && await fileExists(newFull)) {
        return {
          success: false,
          message: `File already exists: ${newFileName}`
        };
      }

      // Rename the file
      if (oldFull !== newFull) {
        await fsPromises.rename(oldFull, newFull);
      }

      // Update include paths (with rollback on failure)
      let affectedFiles: string[] = [];
      try {
        affectedFiles = await this.updateIncludePaths(
          workspaceRoot,
          oldPath,
          newPath
        );
      } catch (includeError) {
        // Attempt rollback - rename back to original
        if (oldFull !== newFull) {
          try {
            await fsPromises.rename(newFull, oldFull);
          } catch {
            // Rollback failed
          }
        }
        return {
          success: false,
          message: `Failed to update include paths (file restored): ${includeError}`
        };
      }

      // HYBRID APPROACH: Try surgical update first, fall back to full rescan
      const surgicalSuccess = await this.updateIndexEntrySurgically(
        workspaceRoot,
        oldPath,
        newPath
      );

      if (!surgicalSuccess) {
        await generateIndex({ workspaceRoot });
      }
      
      return {
        success: true,
        message: `Renamed to ${newFileName}`,
        newPath,
        affectedFiles
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to rename file: ${error}`
      };
    }
  }
  
  /**
   * Delete a file from filesystem (INDEX mode)
   * Moves to trash or permanently deletes, then regenerates index
   * 
   * @param workspaceRoot - Root of the workspace
   * @param filePath - File to delete (relative to workspace)
   * @param permanent - If true, permanently delete; otherwise move to trash
   * @param settings - Navigator settings
   * @returns Result of the operation
   */
  async removeFileFromIndex(
    workspaceRoot: string,
    filePath: string,
    permanent: boolean = false,
    settings: NavigatorSettings
  ): Promise<StructureOperationResult> {
    try {
      const fullPath = path.join(workspaceRoot, filePath);

      // Validate path stays within workspace
      if (!isPathWithinRoot(fullPath, workspaceRoot)) {
        return {
          success: false,
          message: 'Path traversal detected: path must stay within workspace'
        };
      }

      // Check if file exists
      if (!await fileExists(fullPath)) {
        return {
          success: false,
          message: `File not found: ${filePath}`
        };
      }

      // Confirm if configured
      if (settings.safety.confirmDelete) {
        const action = permanent ? 'permanently delete' : 'move to trash';
        const confirmed = await vscode.window.showWarningMessage(
          `Are you sure you want to ${action} ${path.basename(filePath)}?`,
          { modal: true },
          'Yes', 'No'
        );
        
        if (confirmed !== 'Yes') {
          return {
            success: false,
            message: 'Deletion cancelled by user'
          };
        }
      }
      
      // Backup if configured
      if (settings.safety.backupBeforeDestruct && permanent) {
        const backupPath = `${fullPath}.backup`;
        await fsPromises.copyFile(fullPath, backupPath);
      }
      
      // Delete the file
      const fileUri = vscode.Uri.file(fullPath);
      await vscode.workspace.fs.delete(fileUri, {
        recursive: false,
        useTrash: !permanent
      });
      
      // Find files that included this file
      const affectedFiles = await this.findFilesIncluding(workspaceRoot, filePath);
      
      // Warn about broken includes
      if (affectedFiles.length > 0) {
        vscode.window.showWarningMessage(
          `${affectedFiles.length} file(s) have broken include paths. Consider fixing them.`
        );
      }
      
      // HYBRID APPROACH: Try surgical removal first, fall back to full rescan
      const surgicalSuccess = await this.removeIndexEntrySurgically(
        workspaceRoot,
        filePath
      );
      
      if (!surgicalSuccess) {
        // Surgical update failed - fall back to full regeneration
        // Surgical removal failed - fall back to full regeneration
        await generateIndex({ workspaceRoot });
      }
      
      return {
        success: true,
        message: permanent 
          ? `Permanently deleted ${path.basename(filePath)}`
          : `Moved ${path.basename(filePath)} to trash`,
        affectedFiles
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to delete file: ${error}`
      };
    }
  }
  
  /**
   * Move a node within a document (FILES mode)
   * Updates the document's YAML structure only, no filesystem operations
   * 
   * @param document - The document to edit
   * @param sourceNode - Node to move
   * @param targetNode - Target node (null = root)
   * @param position - Where to place relative to target
   * @returns Success/failure
   */
  async moveNodeInDocument(
    document: vscode.TextDocument,
    sourceNode: CodexNode,
    targetNode: CodexNode | null,
    position: 'before' | 'after' | 'inside'
  ): Promise<boolean> {
    try {
      // Parse YAML document
      const text = document.getText();
      const yamlDoc = YAML.parseDocument(text);
      
      // Validate move (prevent circular references)
      if (targetNode && this.wouldCreateCircularReference(sourceNode, targetNode)) {
        vscode.window.showErrorMessage('Cannot nest a parent into its own child');
        return false;
      }
      
      // Find source node in YAML
      const sourcePath = this.buildYamlPath(sourceNode.path);
      const sourceValue = yamlDoc.getIn(sourcePath);
      
      if (!sourceValue) {
        vscode.window.showErrorMessage('Source node not found in document');
        return false;
      }
      
      // Remove from current location
      const sourceParentPath = sourcePath.slice(0, -1);
      const sourceParent = yamlDoc.getIn(sourceParentPath);
      if (Array.isArray(sourceParent)) {
        const index = sourcePath[sourcePath.length - 1] as number;
        sourceParent.splice(index, 1);
      }
      
      // Add to new location
      if (position === 'inside') {
        // Add as child of target
        const targetPath = targetNode ? this.buildYamlPath(targetNode.path) : [];
        const targetChildren = targetPath.length > 0
          ? yamlDoc.getIn([...targetPath, 'children'])
          : yamlDoc.get('children');
        
        if (Array.isArray(targetChildren)) {
          targetChildren.push(sourceValue);
        } else {
          // Create children array if it doesn't exist
          const childrenPath = targetPath.length > 0 
            ? [...targetPath, 'children']
            : ['children'];
          yamlDoc.setIn(childrenPath, [sourceValue]);
        }
      } else {
        // Add as sibling (before/after target)
        const targetPath = targetNode ? this.buildYamlPath(targetNode.path) : [];
        const targetParentPath = targetPath.slice(0, -1);
        const targetParent = targetParentPath.length > 0
          ? yamlDoc.getIn(targetParentPath)
          : yamlDoc.get('children');
        
        if (Array.isArray(targetParent)) {
          const targetIndex = targetPath[targetPath.length - 1] as number;
          const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
          targetParent.splice(insertIndex, 0, sourceValue);
        }
      }
      
      // Apply edit to document
      const newText = yamlDoc.toString();
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        document.uri,
        new vscode.Range(0, 0, document.lineCount, 0),
        newText
      );
      
      await vscode.workspace.applyEdit(edit);
      await document.save();
      
      return true;
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to move node: ${error}`);
      return false;
    }
  }
  
  /**
   * Add a new node within a document (FILES mode)
   * Updates the document's YAML structure
   */
  async addNodeInDocument(
    document: vscode.TextDocument,
    parentNode: CodexNode | null,
    position: 'child' | 'sibling-before' | 'sibling-after',
    nodeData: Partial<CodexNode>,
    settings: NavigatorSettings
  ): Promise<CodexNode | null> {
    try {
      // Parse YAML document
      const text = document.getText();
      const yamlDoc = YAML.parseDocument(text);
      
      // Generate ID if configured
      if (settings.automation.autoGenerateIds && !nodeData.id) {
        nodeData.id = this.generateUuid();
      }
      
      // Create new node object
      const newNode: any = {
        id: nodeData.id,
        type: nodeData.type,
        name: nodeData.name
      };
      
      // Add prose field if specified
      if (nodeData.proseField && nodeData.proseValue !== undefined) {
        newNode[nodeData.proseField] = nodeData.proseValue;
      }
      
      // Determine insertion path
      let insertPath: PathSegment[];
      if (position === 'child') {
        // Add as child of parent
        insertPath = parentNode 
          ? [...this.buildYamlPath(parentNode.path), 'children']
          : ['children'];
      } else {
        // Add as sibling
        insertPath = parentNode
          ? this.buildYamlPath(parentNode.path).slice(0, -1)
          : ['children'];
      }
      
      // Get target array
      let targetArray = yamlDoc.getIn(insertPath);
      
      // Create array if it doesn't exist
      if (!targetArray) {
        yamlDoc.setIn(insertPath, []);
        targetArray = yamlDoc.getIn(insertPath);
      }
      
      if (!Array.isArray(targetArray)) {
        vscode.window.showErrorMessage('Target is not an array');
        return null;
      }
      
      // Insert at correct position
      if (position === 'sibling-before' && parentNode) {
        const parentPath = this.buildYamlPath(parentNode.path);
        const index = parentPath[parentPath.length - 1] as number;
        targetArray.splice(index, 0, newNode);
      } else if (position === 'sibling-after' && parentNode) {
        const parentPath = this.buildYamlPath(parentNode.path);
        const index = parentPath[parentPath.length - 1] as number;
        targetArray.splice(index + 1, 0, newNode);
      } else {
        // Child or at end
        targetArray.push(newNode);
      }
      
      // Apply edit
      const newText = yamlDoc.toString();
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        document.uri,
        new vscode.Range(0, 0, document.lineCount, 0),
        newText
      );
      
      await vscode.workspace.applyEdit(edit);
      
      if (settings.automation.autoSave) {
        await document.save();
      }
      
      // Return created node (simplified version)
      return {
        ...nodeData,
        id: newNode.id,
        type: newNode.type,
        name: newNode.name,
        proseField: nodeData.proseField || 'body',
        proseValue: nodeData.proseValue || '',
        availableFields: ['body', 'summary'],
        path: [...insertPath, targetArray.length - 1],
        children: [],
        hasAttributes: false,
        hasContentSections: false
      } as CodexNode;
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to add node: ${error}`);
      return null;
    }
  }
  
  /**
   * Remove a node from a document (FILES mode)
   * Updates the document's YAML structure
   */
  async removeNodeFromDocument(
    document: vscode.TextDocument,
    node: CodexNode,
    permanent: boolean = false,
    settings: NavigatorSettings
  ): Promise<boolean> {
    try {
      // Confirm if configured
      if (settings.safety.confirmDelete) {
        const action = permanent ? 'permanently delete' : 'remove from tree';
        const confirmed = await vscode.window.showWarningMessage(
          `Are you sure you want to ${action} "${node.name}"?`,
          { modal: true },
          'Yes', 'No'
        );
        
        if (confirmed !== 'Yes') {
          return false;
        }
      }
      
      // Parse YAML document
      const text = document.getText();
      const yamlDoc = YAML.parseDocument(text);
      
      // Find and remove node
      const nodePath = this.buildYamlPath(node.path);
      const parentPath = nodePath.slice(0, -1);
      const parentArray = yamlDoc.getIn(parentPath);
      
      if (!Array.isArray(parentArray)) {
        vscode.window.showErrorMessage('Cannot remove node: parent is not an array');
        return false;
      }
      
      const index = nodePath[nodePath.length - 1] as number;
      parentArray.splice(index, 1);
      
      // Apply edit
      const newText = yamlDoc.toString();
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        document.uri,
        new vscode.Range(0, 0, document.lineCount, 0),
        newText
      );
      
      await vscode.workspace.applyEdit(edit);
      
      if (settings.automation.autoSave) {
        await document.save();
      }
      
      return true;
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to remove node: ${error}`);
      return false;
    }
  }
  
  /**
   * Rename a node within a document (FILES mode)
   * Updates the node's 'name' field in YAML
   */
  async renameNodeInDocument(
    document: vscode.TextDocument,
    node: CodexNode,
    newName: string
  ): Promise<boolean> {
    try {
      const text = document.getText();
      const yamlDoc = YAML.parseDocument(text);

      const nodePath = this.buildYamlPath(node.path);
      const nodeValue = yamlDoc.getIn(nodePath);

      if (!nodeValue || typeof nodeValue !== 'object') {
        vscode.window.showErrorMessage('Node not found in document');
        return false;
      }

      // Update name field
      yamlDoc.setIn([...nodePath, 'name'], newName);

      // Apply edit
      const newText = yamlDoc.toString();
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        document.uri,
        new vscode.Range(0, 0, document.lineCount, 0),
        newText
      );

      await vscode.workspace.applyEdit(edit);
      await document.save();

      return true;
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to rename node: ${error}`);
      return false;
    }
  }

  /**
   * Update reorder children in a document (FILES mode)
   */
  async reorderChildrenInDocument(
    document: vscode.TextDocument,
    parentPath: PathSegment[],
    newOrder: string[]  // Array of child IDs
  ): Promise<boolean> {
    try {
      const text = document.getText();
      const yamlDoc = YAML.parseDocument(text);
      
      // Get children array
      const childrenPath = [...this.buildYamlPath(parentPath), 'children'];
      const children = yamlDoc.getIn(childrenPath);
      
      if (!Array.isArray(children)) {
        return false;
      }
      
      // Reorder based on newOrder
      const reordered = newOrder.map(id => {
        return children.find((child: any) => child.id === id);
      }).filter(Boolean);
      
      // Replace children array
      yamlDoc.setIn(childrenPath, reordered);
      
      // Apply edit
      const newText = yamlDoc.toString();
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        document.uri,
        new vscode.Range(0, 0, document.lineCount, 0),
        newText
      );
      
      await vscode.workspace.applyEdit(edit);
      await document.save();
      
      return true;
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to reorder children: ${error}`);
      return false;
    }
  }
  
  // ============ SURGICAL INDEX UPDATE METHODS (PERFORMANCE OPTIMIZATION) ============
  
  /**
   * Surgically update index entry for a moved file
   * 100x faster than full rescan - only edits the YAML entry
   * 
   * @param workspaceRoot - Root of the workspace
   * @param oldPath - Old file path (relative to workspace)
   * @param newPath - New file path (relative to workspace)
   * @returns True if successful, false if fallback to full rescan needed
   */
  private async updateIndexEntrySurgically(
    workspaceRoot: string,
    oldPath: string,
    newPath: string
  ): Promise<boolean> {
    try {
      const indexPath = path.join(workspaceRoot, '.index.codex.json');

      // Check if index exists
      if (!await fileExists(indexPath)) {
        return false;
      }

      // Parse index JSON
      const indexContent = await fsPromises.readFile(indexPath, 'utf-8');
      const indexData = JSON.parse(indexContent);

      // Get children array
      const children = indexData.children;
      if (!Array.isArray(children)) {
        return false;
      }

      // Find and update the entry
      const updated = this.findAndUpdateFileEntry(
        children,
        oldPath,
        newPath
      );

      if (!updated) {
        return false;
      }

      // Write back to disk
      await fsPromises.writeFile(indexPath, JSON.stringify(indexData, null, 2), 'utf-8');
      return true;
    } catch (error) {
      console.error('Surgical index update failed:', error);
      return false;
    }
  }
  
  /**
   * Surgically remove an entry from the index
   * 
   * @param workspaceRoot - Root of the workspace
   * @param filePath - File path to remove (relative to workspace)
   * @returns True if successful
   */
  private async removeIndexEntrySurgically(
    workspaceRoot: string,
    filePath: string
  ): Promise<boolean> {
    try {
      const indexPath = path.join(workspaceRoot, '.index.codex.json');

      if (!await fileExists(indexPath)) {
        return false;
      }

      const indexContent = await fsPromises.readFile(indexPath, 'utf-8');
      const indexData = JSON.parse(indexContent);

      const children = indexData.children;
      if (!Array.isArray(children)) {
        return false;
      }

      // Find and remove the entry
      const removed = this.findAndRemoveFileEntry(children, filePath);

      if (!removed) {
        return false;
      }

      // Write back
      await fsPromises.writeFile(indexPath, JSON.stringify(indexData, null, 2), 'utf-8');
      return true;
    } catch (error) {
      console.error('Surgical index removal failed:', error);
      return false;
    }
  }
  
  /**
   * Recursively find and update a file entry in the index
   * Updates: _filename, _computed_path, and optionally name
   * 
   * @param children - Array of child nodes
   * @param oldPath - Old file path
   * @param newPath - New file path
   * @returns True if entry was found and updated
   */
  private findAndUpdateFileEntry(
    children: any[],
    oldPath: string,
    newPath: string
  ): boolean {
    if (!Array.isArray(children)) {
      return false;
    }
    
    for (const child of children) {
      // Check if this is the file we moved
      // Match by _computed_path or _filename
      const childPath = child._computed_path || child._filename;
      const oldFileName = path.basename(oldPath);
      
      if (childPath === oldPath || child._filename === oldFileName) {
        // UPDATE the entry fields
        const newFileName = path.basename(newPath);
        
        child._computed_path = newPath;
        child._filename = newFileName;
        
        // Update name if it was derived from filename
        const oldBaseName = path.basename(oldPath, path.extname(oldPath));
        const newBaseName = path.basename(newPath, path.extname(newPath));
        
        // Only update name if it matches the old filename (auto-generated)
        if (child.name === oldBaseName || child.name === oldFileName) {
          child.name = newBaseName;
        }
        
        // Entry updated successfully
        return true;
      }
      
      // Recurse into children
      if (child.children && Array.isArray(child.children)) {
        const found = this.findAndUpdateFileEntry(
          child.children,
          oldPath,
          newPath
        );
        if (found) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  /**
   * Recursively find and remove a file entry from the index
   * 
   * @param children - Array of child nodes
   * @param filePath - File path to remove
   * @returns True if entry was found and removed
   */
  private findAndRemoveFileEntry(
    children: any[],
    filePath: string
  ): boolean {
    if (!Array.isArray(children)) {
      return false;
    }
    
    const fileName = path.basename(filePath);
    
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childPath = child._computed_path || child._filename;
      
      // Check if this is the file to remove
      if (childPath === filePath || child._filename === fileName) {
        // Remove from array
        children.splice(i, 1);
        // Entry removed successfully
        return true;
      }
      
      // Recurse into children
      if (child.children && Array.isArray(child.children)) {
        const found = this.findAndRemoveFileEntry(child.children, filePath);
        if (found) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  // ============ PRIVATE HELPER METHODS ============
  
  /**
   * Update include paths in all files that reference the moved file
   */
  private async updateIncludePaths(
    workspaceRoot: string,
    oldPath: string,
    newPath: string
  ): Promise<string[]> {
    const affectedFiles: string[] = [];
    
    try {
      // Find all .codex.yaml files
      const files = await vscode.workspace.findFiles(
        '**/*.codex.yaml',
        '**/node_modules/**'
      );
      
      for (const fileUri of files) {
        const content = await fsPromises.readFile(fileUri.fsPath, 'utf-8');

        // Check if this file includes the moved file
        if (content.includes(oldPath)) {
          // Update include paths
          const updated = content.replace(
            new RegExp(oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
            newPath
          );

          if (updated !== content) {
            await fsPromises.writeFile(fileUri.fsPath, updated, 'utf-8');
            affectedFiles.push(path.relative(workspaceRoot, fileUri.fsPath));
          }
        }
      }
    } catch (error) {
      console.error('Error updating include paths:', error);
    }
    
    return affectedFiles;
  }
  
  /**
   * Find all files that include the specified file
   */
  private async findFilesIncluding(
    workspaceRoot: string,
    filePath: string
  ): Promise<string[]> {
    const affectedFiles: string[] = [];
    
    try {
      const files = await vscode.workspace.findFiles(
        '**/*.codex.yaml',
        '**/node_modules/**'
      );
      
      for (const fileUri of files) {
        const content = await fsPromises.readFile(fileUri.fsPath, 'utf-8');
        if (content.includes(filePath)) {
          affectedFiles.push(path.relative(workspaceRoot, fileUri.fsPath));
        }
      }
    } catch (error) {
      console.error('Error finding files with includes:', error);
    }
    
    return affectedFiles;
  }
  
  /**
   * Check if moving sourceNode into targetNode would create a circular reference
   */
  private wouldCreateCircularReference(
    sourceNode: CodexNode,
    targetNode: CodexNode
  ): boolean {
    // Walk up from target to see if we hit source
    let current: CodexNode | undefined = targetNode;
    while (current) {
      if (current.id === sourceNode.id) {
        return true;
      }
      // Note: This requires parent references in CodexNode
      current = (current as any).parent;
    }
    return false;
  }
  
  /**
   * Build YAML path from PathSegment array.
   * node.path already contains 'children' segments from codexModel parsing,
   * so this is a simple pass-through.
   */
  private buildYamlPath(pathSegments: PathSegment[]): PathSegment[] {
    return [...pathSegments];
  }
  
  /**
   * Slugify a name based on naming settings
   */
  private slugifyName(name: string, namingSettings: NavigatorSettings['naming']): string {
    let slug = name;
    
    // Convert to lowercase unless preserving case
    if (!namingSettings.preserveCase) {
      slug = slug.toLowerCase();
    }
    
    // Replace spaces and special chars with separator
    slug = slug.replace(/[\s_]+/g, namingSettings.separator);
    slug = slug.replace(/[^a-zA-Z0-9-]/g, '');
    // Remove path traversal sequences
    slug = slug.replace(/\.\./g, '');
    
    // Remove leading/trailing separators
    const separatorPattern = new RegExp(`^${namingSettings.separator}+|${namingSettings.separator}+$`, 'g');
    slug = slug.replace(separatorPattern, '');
    
    // Collapse multiple separators
    const multiSeparatorPattern = new RegExp(`${namingSettings.separator}+`, 'g');
    slug = slug.replace(multiSeparatorPattern, namingSettings.separator);
    
    return slug || 'untitled';
  }
  
  /**
   * Generate a UUID (simplified version)
   */
  private generateUuid(): string {
    return crypto.randomUUID();
  }
  
  /**
   * Reorder a file in INDEX mode by updating per-folder .index.codex.json
   * Then cascades up to regenerate all parent indexes
   * 
   * @param workspaceRoot - Root of the workspace
   * @param filePath - File path (relative to workspace)
   * @param newOrder - New order value (fractional allowed)
   * @returns Result of the operation
   */
  async reorderFileInIndex(
    workspaceRoot: string,
    filePath: string,
    newOrder: number
  ): Promise<StructureOperationResult> {
    try {
      const folderPath = path.dirname(filePath);
      const fileName = path.basename(filePath);
      const perFolderIndexPath = path.join(
        workspaceRoot,
        folderPath,
        '.index.codex.json'
      );
      
      // Check if per-folder index exists
      if (!await fileExists(perFolderIndexPath)) {
        // Generate per-folder index first
        await generatePerFolderIndex(workspaceRoot, folderPath);
      }

      // Read per-folder index
      const indexContent = await fsPromises.readFile(perFolderIndexPath, 'utf-8');
      const indexData = JSON.parse(indexContent);

      // Find the file node in children
      const children = indexData.children;
      if (!children || !Array.isArray(children)) {
        return {
          success: false,
          message: 'Invalid index structure: no children found'
        };
      }

      // Find node by _filename
      let found = false;
      for (const child of children) {
        if (child._filename === fileName) {
          child.order = newOrder;
          found = true;
          break;
        }
      }

      if (!found) {
        return {
          success: false,
          message: `File not found in index: ${fileName}`
        };
      }

      // Write back per-folder index
      await fsPromises.writeFile(perFolderIndexPath, JSON.stringify(indexData, null, 2), 'utf-8');

      // Cascade regenerate all parent indexes
      await cascadeRegenerateIndexes(workspaceRoot, folderPath);
      
      return {
        success: true,
        message: `Reordered ${fileName} to order ${newOrder}`,
        newPath: filePath,
        affectedFiles: [perFolderIndexPath]
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to reorder file: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
  
  /**
   * Move a file up in the order (swap with previous sibling)
   * 
   * @param workspaceRoot - Root of the workspace
   * @param filePath - File path (relative to workspace)
   * @returns Result of the operation
   */
  async moveFileUp(
    workspaceRoot: string,
    filePath: string
  ): Promise<StructureOperationResult> {
    try {
      const folderPath = path.dirname(filePath);
      const fileName = path.basename(filePath);
      const perFolderIndexPath = path.join(
        workspaceRoot,
        folderPath,
        '.index.codex.json'
      );
      
      // Check if per-folder index exists
      if (!await fileExists(perFolderIndexPath)) {
        return {
          success: false,
          message: 'Index file not found. Generate index first.'
        };
      }

      // Read per-folder index
      const indexContent = await fsPromises.readFile(perFolderIndexPath, 'utf-8');
      const indexData = JSON.parse(indexContent);

      // Find the file node in children
      const children = indexData.children;
      if (!children || !Array.isArray(children)) {
        return {
          success: false,
          message: 'Invalid index structure: no children found'
        };
      }

      // Find node by _filename and get siblings
      let currentIndex = -1;
      for (let i = 0; i < children.length; i++) {
        if (children[i]._filename === fileName) {
          currentIndex = i;
          break;
        }
      }

      if (currentIndex === -1) {
        return {
          success: false,
          message: `File not found in index: ${fileName}`
        };
      }

      // Check if already at top
      if (currentIndex === 0) {
        return {
          success: false,
          message: 'Already at the top of the list'
        };
      }

      // Swap order values with previous sibling
      const currentNode = children[currentIndex];
      const previousNode = children[currentIndex - 1];

      const currentOrder = currentNode.order ?? currentIndex;
      const previousOrder = previousNode.order ?? (currentIndex - 1);

      currentNode.order = previousOrder;
      previousNode.order = currentOrder;

      // Write back per-folder index
      await fsPromises.writeFile(perFolderIndexPath, JSON.stringify(indexData, null, 2), 'utf-8');

      // Cascade regenerate all parent indexes
      await cascadeRegenerateIndexes(workspaceRoot, folderPath);
      
      return {
        success: true,
        message: `Moved ${fileName} up`,
        newPath: filePath,
        affectedFiles: [perFolderIndexPath]
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to move file up: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
  
  /**
   * Move a file down in the order (swap with next sibling)
   * 
   * @param workspaceRoot - Root of the workspace
   * @param filePath - File path (relative to workspace)
   * @returns Result of the operation
   */
  async moveFileDown(
    workspaceRoot: string,
    filePath: string
  ): Promise<StructureOperationResult> {
    try {
      const folderPath = path.dirname(filePath);
      const fileName = path.basename(filePath);
      const perFolderIndexPath = path.join(
        workspaceRoot,
        folderPath,
        '.index.codex.json'
      );
      
      // Check if per-folder index exists
      if (!await fileExists(perFolderIndexPath)) {
        return {
          success: false,
          message: 'Index file not found. Generate index first.'
        };
      }

      // Read per-folder index
      const indexContent = await fsPromises.readFile(perFolderIndexPath, 'utf-8');
      const indexData = JSON.parse(indexContent);

      // Find the file node in children
      const children = indexData.children;
      if (!children || !Array.isArray(children)) {
        return {
          success: false,
          message: 'Invalid index structure: no children found'
        };
      }

      // Find node by _filename and get siblings
      let currentIndex = -1;
      for (let i = 0; i < children.length; i++) {
        if (children[i]._filename === fileName) {
          currentIndex = i;
          break;
        }
      }

      if (currentIndex === -1) {
        return {
          success: false,
          message: `File not found in index: ${fileName}`
        };
      }

      // Check if already at bottom
      if (currentIndex === children.length - 1) {
        return {
          success: false,
          message: 'Already at the bottom of the list'
        };
      }

      // Swap order values with next sibling
      const currentNode = children[currentIndex];
      const nextNode = children[currentIndex + 1];

      const currentOrder = currentNode.order ?? currentIndex;
      const nextOrder = nextNode.order ?? (currentIndex + 1);

      currentNode.order = nextOrder;
      nextNode.order = currentOrder;

      // Write back per-folder index
      await fsPromises.writeFile(perFolderIndexPath, JSON.stringify(indexData, null, 2), 'utf-8');

      // Cascade regenerate all parent indexes
      await cascadeRegenerateIndexes(workspaceRoot, folderPath);
      
      return {
        success: true,
        message: `Moved ${fileName} down`,
        newPath: filePath,
        affectedFiles: [perFolderIndexPath]
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to move file down: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
  
  /**
   * Renormalize order values in a folder to sequential integers (0, 1, 2, ...)
   * Preserves the current sort order
   * 
   * @param workspaceRoot - Root of the workspace
   * @param folderPath - Folder path (relative to workspace) - e.g., "E02/chapters"
   * @returns Result of the operation
   */
  async autofixFolderOrder(
    workspaceRoot: string,
    folderPath: string
  ): Promise<StructureOperationResult> {
    try {
      // Find the parent index that contains this folder
      // For "E02/chapters", look in "E02/.index.codex.json"
      // For "E02", look in workspace root ".index.codex.json"
      const folderParts = folderPath.split(path.sep);
      const folderName = folderParts[folderParts.length - 1];
      const parentPath = folderParts.slice(0, -1).join(path.sep);

      // Find the index file that contains this folder
      let indexPath: string;
      if (parentPath) {
        indexPath = path.join(workspaceRoot, parentPath, '.index.codex.json');
      } else {
        indexPath = path.join(workspaceRoot, '.index.codex.json');
      }

      // Check if index exists
      if (!await fileExists(indexPath)) {
        return {
          success: false,
          message: `Index file not found at: ${indexPath}`
        };
      }

      // Read index
      const indexContent = await fsPromises.readFile(indexPath, 'utf-8');
      const indexData = JSON.parse(indexContent);

      // Find the folder node within the index
      const rootChildren = indexData.children;
      if (!rootChildren || !Array.isArray(rootChildren)) {
        return {
          success: false,
          message: 'Invalid index structure: no children found at root'
        };
      }

      // Find the folder node by name or _computed_path
      let folderNode: any = null;
      for (const child of rootChildren) {
        if (child.type === 'folder' &&
            (child.name === folderName || child._computed_path === folderPath)) {
          folderNode = child;
          break;
        }
      }

      if (!folderNode) {
        return {
          success: false,
          message: `Folder "${folderName}" not found in index at ${indexPath}`
        };
      }

      // Get children of the folder
      const folderChildren = folderNode.children;
      if (!folderChildren || !Array.isArray(folderChildren) || folderChildren.length === 0) {
        return {
          success: true,
          message: `Folder "${folderName}" has no children`,
          affectedFiles: []
        };
      }

      // Sort children by current order, then by name
      folderChildren.sort((a: any, b: any) => {
        const orderA = a.order ?? Infinity;
        const orderB = b.order ?? Infinity;
        if (orderA !== orderB) return orderA - orderB;

        const nameA = a.name || '';
        const nameB = b.name || '';
        return nameA.localeCompare(nameB);
      });

      // Renormalize: assign 0, 1, 2, ...
      folderChildren.forEach((child: any, index: number) => {
        child.order = index;
      });

      // Write back to index
      await fsPromises.writeFile(indexPath, JSON.stringify(indexData, null, 2), 'utf-8');
      
      return {
        success: true,
        message: `Renormalized ${folderChildren.length} items in "${folderName}"`,
        affectedFiles: [indexPath]
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to autofix folder order: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
  
  /**
   * Helper: Find a node in .index.codex.json by _computed_path
   * Used for surgical updates
   */
  private findIndexNodeByPath(indexData: any, targetPath: string): any | null {
    const children = indexData.children;
    if (!children || !Array.isArray(children)) return null;

    function search(nodes: any[]): any | null {
      for (const node of nodes) {
        const computedPath = node._computed_path;
        if (computedPath === targetPath) {
          return node;
        }

        // Recursively search children
        const nodeChildren = node.children;
        if (nodeChildren && Array.isArray(nodeChildren)) {
          const found = search(nodeChildren);
          if (found) return found;
        }
      }
      return null;
    }

    return search(children);
  }
}

/**
 * Singleton instance
 */
let editorInstance: CodexStructureEditor | null = null;

/**
 * Get the structure editor instance
 */
export function getStructureEditor(): CodexStructureEditor {
  if (!editorInstance) {
    editorInstance = new CodexStructureEditor();
  }
  return editorInstance;
}

/**
 * Dispose the structure editor
 */
export function disposeStructureEditor(): void {
  editorInstance = null;
}
