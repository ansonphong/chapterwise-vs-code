/**
 * Drag and Drop Controller for Codex Navigator
 * Handles multi-selection drag & drop with best-effort processing
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CodexTreeItemType, IndexNodeTreeItem, CodexTreeItem, CodexFileHeaderItem, CodexTreeProvider } from './treeProvider';
import { getStructureEditor } from './structureEditor';
import { getSettingsManager } from './settingsManager';

const fsPromises = fs.promises;

/**
 * Serialized drag data
 */
interface DragData {
  type: 'index' | 'node' | 'header';
  id: string;
  name: string;
  filePath?: string;
  documentUri?: string;
}

/**
 * Result of processing a drop operation
 */
interface DropResult {
  succeeded: DragData[];
  failed: Array<{ item: DragData; reason: string }>;
}

/**
 * Drag and Drop Controller for tree view
 */
export class CodexDragAndDropController implements vscode.TreeDragAndDropController<CodexTreeItemType> {
  dropMimeTypes = ['application/vnd.code.tree.chapterwiseCodexNavigator'];
  dragMimeTypes = ['application/vnd.code.tree.chapterwiseCodexNavigator'];

  private outputChannel: vscode.OutputChannel | undefined;

  constructor(
    private treeProvider: CodexTreeProvider
  ) {}

  /**
   * Dispose resources
   */
  dispose(): void {
    this.outputChannel?.dispose();
  }

  /**
   * Get or create the shared output channel
   */
  private getOutputChannel(): vscode.OutputChannel {
    if (!this.outputChannel) {
      this.outputChannel = vscode.window.createOutputChannel('Codex Navigator');
    }
    return this.outputChannel;
  }
  
  /**
   * Validate and parse DragData from untrusted dataTransfer.
   * Returns validated array or null if invalid.
   */
  private validateDragData(raw: unknown): DragData[] | null {
    if (!Array.isArray(raw)) {
      return null;
    }
    const validTypes = new Set(['index', 'node', 'header']);
    const result: DragData[] = [];
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) {
        return null;
      }
      const obj = entry as Record<string, unknown>;
      if (typeof obj.type !== 'string' || !validTypes.has(obj.type)) {
        return null;
      }
      if (typeof obj.id !== 'string' || typeof obj.name !== 'string') {
        return null;
      }
      if (obj.filePath !== undefined && typeof obj.filePath !== 'string') {
        return null;
      }
      if (obj.documentUri !== undefined && typeof obj.documentUri !== 'string') {
        return null;
      }
      result.push({
        type: obj.type as DragData['type'],
        id: obj.id,
        name: obj.name,
        filePath: obj.filePath as string | undefined,
        documentUri: obj.documentUri as string | undefined,
      });
    }
    return result.length > 0 ? result : null;
  }

  /**
   * Handle drag start - serialize dragged items
   */
  async handleDrag(
    source: readonly CodexTreeItemType[],
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    // Serialize dragged items
    const dragData: DragData[] = source.map(item => {
      if (item instanceof IndexNodeTreeItem) {
        return {
          type: 'index' as const,
          id: item.indexNode.id,
          name: item.indexNode.name,
          filePath: item.getFilePath(),
          documentUri: item.documentUri.toString(),
        };
      } else if (item instanceof CodexTreeItem) {
        return {
          type: 'node' as const,
          id: item.codexNode.id || '',
          name: item.codexNode.name,
          documentUri: item.documentUri.toString(),
        };
      } else {
        return {
          type: 'header' as const,
          id: '',
          name: '',
        };
      }
    });
    
    dataTransfer.set(
      'application/vnd.code.tree.chapterwiseCodexNavigator',
      new vscode.DataTransferItem(dragData)
    );
  }
  
  /**
   * Handle drop - process the drop operation
   */
  async handleDrop(
    target: CodexTreeItemType | undefined,
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    const transferItem = dataTransfer.get('application/vnd.code.tree.chapterwiseCodexNavigator');
    if (!transferItem) {
      return;
    }

    const draggedItems = this.validateDragData(transferItem.value);
    if (!draggedItems) {
      return;
    }
    const mode = this.treeProvider.getNavigationMode();

    if (mode === 'index' || this.treeProvider.isInIndexMode()) {
      // INDEX MODE: Move files on disk
      await this.handleIndexDrop(draggedItems, target, token);
    } else {
      // FILES MODE: Move nodes in document
      await this.handleFilesDrop(draggedItems, target, token);
    }
  }
  
  /**
   * Validate drop operation before accepting
   */
  async handleDragOver(
    target: CodexTreeItemType | undefined,
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<boolean | vscode.DocumentDropEdit> {
    const transferItem = dataTransfer.get('application/vnd.code.tree.chapterwiseCodexNavigator');
    if (!transferItem) {
      return false;
    }

    const draggedItems = this.validateDragData(transferItem.value);
    if (!draggedItems) {
      return false;
    }

    // High-level validation
    const isValid = this.validateDrop(draggedItems, target);
    
    // Provide visual feedback in status bar
    if (isValid && target) {
      const dragCount = draggedItems.length;
      const itemText = dragCount === 1 ? draggedItems[0].name : `${dragCount} items`;
      
      if (target instanceof IndexNodeTreeItem) {
        const position = this.getDropPosition(target, draggedItems);
        
        if (position === 'inside') {
          vscode.window.setStatusBarMessage(
            `$(folder) Move ${itemText} into "${target.indexNode.name}"`,
            2000
          );
        } else {
          vscode.window.setStatusBarMessage(
            `$(arrow-swap) Reorder ${itemText} ${position} "${target.indexNode.name}"`,
            2000
          );
        }
      }
    }
    
    return isValid;
  }
  
  /**
   * Handle drop in INDEX mode - move files on disk OR reorder siblings
   * NEW: Supports batch reordering with cascade update
   */
  private async handleIndexDrop(
    draggedItems: DragData[],
    target: CodexTreeItemType | undefined,
    token: vscode.CancellationToken
  ): Promise<void> {
    const editor = getStructureEditor();
    const workspaceRoot = this.getWorkspaceRoot();
    
    if (!workspaceRoot) {
      vscode.window.showErrorMessage('No workspace folder found');
      return;
    }
    
    if (!(target instanceof IndexNodeTreeItem)) {
      vscode.window.showErrorMessage('Invalid drop target');
      return;
    }
    
    // Determine drop position
    const position = this.getDropPosition(target, draggedItems);
    
    // Determine if this is a MOVE or REORDER
    const isReorder = position === 'before' || position === 'after';
    
    // Best-effort processing: track successes and failures
    const results: DropResult = { succeeded: [], failed: [] };
    
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `${isReorder ? 'Reordering' : 'Moving'} ${draggedItems.length} item(s)...`,
      cancellable: false,
    }, async (progress) => {
      if (isReorder) {
        // REORDER: Update order values in per-folder index
        const targetPath = target.getFilePath();
        const folderPath = path.dirname(targetPath);
        const siblings = await this.getSiblingsForTarget(workspaceRoot, target);
        
        // Process each item (update per-folder index)
        for (let i = 0; i < draggedItems.length; i++) {
          if (token.isCancellationRequested) {
            break;
          }
          const item = draggedItems[i];

          progress.report({
            message: `${i + 1}/${draggedItems.length}: ${item.name}`,
            increment: (100 / draggedItems.length),
          });

          try {
            // Validate THIS item
            if (!this.validateSingleDrop(item, target)) {
              results.failed.push({ item, reason: 'Invalid drop target or circular reference' });
              continue;
            }

            // Calculate target array index from target position
            const targetIdx = siblings.findIndex((s: any) => s.id === target.indexNode.id);
            const newPosition = position === 'before' ? Math.max(0, targetIdx) : targetIdx + 1;

            // Reorder file in index (array position, not fractional order)
            const sourceFile = item.filePath || '';
            const result = await editor.reorderFileInIndex(
              workspaceRoot,
              sourceFile,
              newPosition
            );
            
            if (!result.success) {
              results.failed.push({ item, reason: result.message || 'Unknown error' });
            } else {
              results.succeeded.push(item);
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            results.failed.push({ item, reason: errorMsg });
          }
        }
        
        // Cascade regeneration happens inside editor.reorderFileInIndex()
      } else {
        // MOVE: Move files to different folder
        for (let i = 0; i < draggedItems.length; i++) {
          if (token.isCancellationRequested) {
            break;
          }
          const item = draggedItems[i];

          progress.report({
            message: `${i + 1}/${draggedItems.length}: ${item.name}`,
            increment: (100 / draggedItems.length),
          });

          try {
            // Validate THIS item
            if (!this.validateSingleDrop(item, target)) {
              results.failed.push({ item, reason: 'Invalid drop target or circular reference' });
              continue;
            }
            
            // Drop INTO a folder
            const targetPath = path.dirname(target.getFilePath());
            const sourceFile = item.filePath || '';
            
            const settingsMgr = getSettingsManager();
            const docUri = item.documentUri ? vscode.Uri.parse(item.documentUri) : undefined;
            const settings = docUri
              ? await settingsMgr.getSettings(docUri)
              : settingsMgr.getWorkspaceSettings();
            
            const result = await editor.moveFileInIndex(
              workspaceRoot,
              sourceFile,
              targetPath,
              settings
            );
            
            if (!result.success) {
              results.failed.push({ item, reason: result.message || 'Unknown error' });
            } else {
              results.succeeded.push(item);
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            results.failed.push({ item, reason: errorMsg });
          }
        }
      }
    });
    
    // Show summary if any failures
    if (results.failed.length > 0) {
      const choice = await vscode.window.showWarningMessage(
        `${isReorder ? 'Reordered' : 'Moved'} ${results.succeeded.length} item(s). ${results.failed.length} failed.`,
        'Show Details'
      );
      
      if (choice === 'Show Details') {
        const channel = this.getOutputChannel();
        channel.clear();
        channel.appendLine(`=== Drag & Drop Results ===\n`);
        
        if (results.succeeded.length > 0) {
          channel.appendLine(`✓ Successfully ${isReorder ? 'reordered' : 'moved'} ${results.succeeded.length} item(s):`);
          results.succeeded.forEach(item => {
            channel.appendLine(`  - ${item.name}`);
          });
          channel.appendLine('');
        }
        
        if (results.failed.length > 0) {
          channel.appendLine(`✗ Failed to ${isReorder ? 'reorder' : 'move'} ${results.failed.length} item(s):`);
          results.failed.forEach(({ item, reason }) => {
            channel.appendLine(`  - ${item.name}: ${reason}`);
          });
        }
        
        channel.show();
      }
    } else if (results.succeeded.length > 0) {
      vscode.window.setStatusBarMessage(`✓ ${isReorder ? 'Reordered' : 'Moved'} ${results.succeeded.length} item(s)`, 3000);
    }
    
    // Refresh tree view
    this.treeProvider.refresh();
  }
  
  /**
   * Handle drop in FILES mode - move nodes within document
   */
  private async handleFilesDrop(
    draggedItems: DragData[],
    target: CodexTreeItemType | undefined,
    token: vscode.CancellationToken
  ): Promise<void> {
    const editor = getStructureEditor();
    const document = this.treeProvider.getActiveTextDocument();
    
    if (!document) {
      vscode.window.showErrorMessage('No active document');
      return;
    }
    
    // Get codex document for node lookup
    const codexDoc = this.treeProvider.getCodexDocument();
    if (!codexDoc) {
      vscode.window.showErrorMessage('No parsed codex document');
      return;
    }
    
    // Best-effort processing
    const results: DropResult = { succeeded: [], failed: [] };
    
    for (const item of draggedItems) {
      if (token.isCancellationRequested) {
        break;
      }
      try {
        // Validate THIS item
        if (!this.validateSingleDrop(item, target)) {
          results.failed.push({ item, reason: 'Invalid drop target or circular reference' });
          continue;
        }
        
        if (target instanceof CodexTreeItem) {
          // Find source and target nodes
          const sourceNode = codexDoc.allNodes.find(n => n.id === item.id);
          const targetNode = target.codexNode;
          
          if (!sourceNode) {
            results.failed.push({ item, reason: 'Source node not found' });
            continue;
          }
          
          // Move node to new parent
          const success = await editor.moveNodeInDocument(
            document,
            sourceNode,
            targetNode,
            'inside'
          );
          
          if (!success) {
            results.failed.push({ item, reason: 'Failed to move node in document' });
          } else {
            results.succeeded.push(item);
          }
        } else {
          // Reorder at same level - not fully implemented
          results.failed.push({ item, reason: 'Reordering not yet implemented' });
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        results.failed.push({ item, reason: errorMsg });
      }
    }
    
    // Show summary
    if (results.failed.length > 0) {
      vscode.window.showWarningMessage(
        `Moved ${results.succeeded.length} node(s). ${results.failed.length} failed.`
      );
    } else if (results.succeeded.length > 0) {
      vscode.window.showInformationMessage(`Moved ${results.succeeded.length} node(s) successfully`);
    }
    
    // Refresh tree view
    this.treeProvider.refresh();
  }
  
  /**
   * High-level validation - can we even attempt this drop?
   * NEW: Allows dropping on siblings for reordering
   */
  private validateDrop(
    draggedItems: DragData[],
    target: CodexTreeItemType | undefined
  ): boolean {
    // Can't drop on nothing
    if (!target) {
      return false;
    }
    
    // Can't drop file headers
    if (target instanceof CodexFileHeaderItem) {
      return false;
    }
    
    // Check if any dragged items are headers (invalid)
    if (draggedItems.some(item => item.type === 'header')) {
      return false;
    }
    
    // Mode compatibility: can't mix index and node items
    const hasIndexItems = draggedItems.some(item => item.type === 'index');
    const hasNodeItems = draggedItems.some(item => item.type === 'node');
    
    if (hasIndexItems && hasNodeItems) {
      return false;
    }
    
    // Target must be valid
    const mode = this.treeProvider.getNavigationMode();
    if (mode === 'index' || this.treeProvider.isInIndexMode()) {
      // In INDEX mode, can drop on folders OR siblings (for reordering)
      if (target instanceof IndexNodeTreeItem) {
        return true; // Allow all index node targets
      }
      return false;
    } else {
      // In FILES mode, can drop on nodes
      return target instanceof CodexTreeItem;
    }
  }
  
  /**
   * Per-item validation - is THIS specific item valid to drop?
   */
  private validateSingleDrop(
    item: DragData,
    target: CodexTreeItemType | undefined
  ): boolean {
    if (!target) {
      return false;
    }
    
    // Can't drop on self
    if (target instanceof IndexNodeTreeItem && item.id === target.indexNode.id) {
      return false;
    }
    
    if (target instanceof CodexTreeItem && item.id === target.codexNode.id) {
      return false;
    }
    
    // Check for circular references (item can't be ancestor of target)
    if (target instanceof IndexNodeTreeItem && item.type === 'index') {
      const targetPath = target.getFilePath();
      if (item.filePath) {
        const rel = path.relative(item.filePath, targetPath);
        // If relative path doesn't start with '..', target is inside item (circular)
        if (!rel.startsWith('..') && rel !== '') {
          return false;
        }
      }
    }
    
    // Check for duplicate names in target folder
    if (target instanceof IndexNodeTreeItem && item.type === 'index' && item.filePath) {
      const targetPath = target.getFilePath();
      const targetDir = path.dirname(targetPath);
      const sourceFileName = path.basename(item.filePath);
      const potentialTarget = path.join(targetDir, sourceFileName);
      try {
        if (fs.existsSync(potentialTarget) && potentialTarget !== item.filePath) {
          return false; // Would overwrite existing file
        }
      } catch {
        // If check fails, allow the drop - structureEditor will catch it
      }
    }

    return true;
  }
  
  /**
   * Get workspace root directory
   */
  private getWorkspaceRoot(): string | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return null;
    }
    
    // Use first workspace folder
    return workspaceFolders[0].uri.fsPath;
  }
  
  /**
   * Determine drop position based on target
   * Returns 'before', 'after', or 'inside'
   */
  private getDropPosition(
    target: CodexTreeItemType,
    draggedItems: DragData[]
  ): 'before' | 'after' | 'inside' {
    // If dropping on a folder, check if it's from same parent (reorder) or different (move)
    if (target instanceof IndexNodeTreeItem) {
      if (target.indexNode.type === 'folder') {
        // Check if any dragged item is a sibling of target
        // If so, this is likely a reorder operation, not a move into folder
        const targetParentPath = target.indexNode._computed_path
          ? path.dirname(target.indexNode._computed_path)
          : '';

        const hasSibling = draggedItems.some(item => {
          if (item.filePath) {
            return path.dirname(item.filePath) === targetParentPath;
          }
          return false;
        });
        
        // If dragging siblings, reorder instead of moving into folder
        if (hasSibling) {
          return 'after';
        }
        
        // Otherwise, move into folder
        return 'inside';
      }
    }
    
    // For non-folder items, default to 'after' (reorder as sibling)
    return 'after';
  }
  
  // calculateNewOrder removed — ordering now uses array position in index.codex.yaml
  
  /**
   * Get siblings for a target node (for order calculation)
   */
  private async getSiblingsForTarget(
    workspaceRoot: string,
    target: IndexNodeTreeItem
  ): Promise<any[]> {
    try {
      const targetPath = target.getFilePath();
      const folderPath = path.dirname(targetPath);
      const perFolderIndexPath = path.join(workspaceRoot, folderPath, '.index.codex.json');
      
      try {
        await fsPromises.access(perFolderIndexPath);
      } catch {
        return [];
      }

      const indexContent = await fsPromises.readFile(perFolderIndexPath, 'utf-8');
      const indexData = JSON.parse(indexContent);

      return indexData.children || [];
    } catch (error) {
      console.error('Failed to get siblings:', error);
      return [];
    }
  }
}
