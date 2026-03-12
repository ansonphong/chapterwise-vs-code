import * as fs from 'fs';
import * as path from 'path';
import type { IndexNodeTreeItem } from './treeProvider';
import type { CodexTreeProvider } from './treeProvider';
import { isValidUuid, isValidIndexStructure, getOutputChannel } from './extensionState';

// ============================================================================
// Phase 5: Tree State Management - Debounce state for expansion updates
// ============================================================================

const expandedUpdateQueue = new Map<string, { indexPath: string; nodeId: string; expanded: boolean }>();
let expandedUpdateTimeout: NodeJS.Timeout | null = null;

/**
 * Update the expansion state of a node (debounced)
 */
export async function updateNodeExpandedState(
  item: IndexNodeTreeItem,
  expanded: boolean,
  treeProvider: CodexTreeProvider
): Promise<void> {
  const workspaceRoot = treeProvider.getWorkspaceRoot();
  if (!workspaceRoot) return;

  const indexPath = determineIndexFileForNode(item, workspaceRoot);
  if (!fs.existsSync(indexPath)) return;

  const nodeId = item.indexNode.id;
  if (!nodeId) return;

  // Queue the update
  const updateKey = `${indexPath}::${nodeId}`;
  expandedUpdateQueue.set(updateKey, { indexPath, nodeId, expanded });

  // Debounce: wait 500ms for more updates before writing
  if (expandedUpdateTimeout) {
    clearTimeout(expandedUpdateTimeout);
  }

  expandedUpdateTimeout = setTimeout(async () => {
    await flushExpandedUpdates();
    expandedUpdateQueue.clear();
    expandedUpdateTimeout = null;
  }, 500);
}

/**
 * Flush all queued expansion state updates to disk (batched by file)
 */
async function flushExpandedUpdates(): Promise<void> {
  const outputChannel = getOutputChannel();
  // Group updates by index file
  const fileUpdates = new Map<string, Array<{ nodeId: string; expanded: boolean }>>();

  for (const [_key, update] of expandedUpdateQueue) {
    if (!fileUpdates.has(update.indexPath)) {
      fileUpdates.set(update.indexPath, []);
    }
    fileUpdates.get(update.indexPath)!.push({
      nodeId: update.nodeId,
      expanded: update.expanded
    });
  }

  // Apply updates to each index file
  for (const [indexPath, updates] of fileUpdates) {
    try {
      await updateIndexFileExpansionState(indexPath, updates);
      outputChannel?.appendLine(`[TreeState] Updated ${updates.length} nodes in ${path.basename(indexPath)}`);
    } catch (error) {
      outputChannel?.appendLine(`[TreeState] Failed to update ${indexPath}: ${error}`);
    }
  }
}

/**
 * Update the expansion state in an index file
 */
async function updateIndexFileExpansionState(
  indexPath: string,
  updates: Array<{ nodeId: string; expanded: boolean }>
): Promise<void> {
  const outputChannel = getOutputChannel();
  let content: string;
  let indexData: unknown;

  try {
    content = fs.readFileSync(indexPath, 'utf-8');
  } catch (error) {
    outputChannel?.appendLine(`[updateIndexFileExpansionState] Failed to read index file: ${indexPath}`);
    return;
  }

  try {
    indexData = JSON.parse(content);
  } catch (error) {
    outputChannel?.appendLine(`[updateIndexFileExpansionState] Invalid JSON in index file: ${indexPath}`);
    return;
  }

  if (!isValidIndexStructure(indexData)) {
    outputChannel?.appendLine(`[updateIndexFileExpansionState] Invalid index structure in: ${indexPath}`);
    return;
  }

  const validUpdates = updates.filter(update => {
    if (!isValidUuid(update.nodeId)) {
      outputChannel?.appendLine(`[updateIndexFileExpansionState] Skipping invalid nodeId: ${update.nodeId}`);
      return false;
    }
    return true;
  });

  if (validUpdates.length === 0) {
    return;
  }

  let changesApplied = 0;
  for (const update of validUpdates) {
    if (updateExpandedInTree(indexData.children as unknown[], update.nodeId, update.expanded)) {
      changesApplied++;
    }
  }

  if (changesApplied > 0) {
    try {
      fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf-8');
    } catch (error) {
      outputChannel?.appendLine(`[updateIndexFileExpansionState] Failed to write index file: ${indexPath}`);
    }
  }
}

/**
 * Recursively search tree and update expanded property
 */
function updateExpandedInTree(
  children: unknown[],
  targetId: string,
  expanded: boolean
): boolean {
  if (!Array.isArray(children)) {
    return false;
  }

  for (const child of children) {
    if (!child || typeof child !== 'object') {
      continue;
    }

    const node = child as Record<string, unknown>;

    if (typeof node.id === 'string' && node.id === targetId) {
      node.expanded = expanded;
      return true;
    }

    if (Array.isArray(node.children)) {
      if (updateExpandedInTree(node.children, targetId, expanded)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Determine which index file contains a given node
 */
function determineIndexFileForNode(
  item: IndexNodeTreeItem,
  workspaceRoot: string
): string {
  const node = item.indexNode as any;

  if (node._parent_file) {
    const parentFilePath = node._parent_file;
    const folderPath = path.dirname(parentFilePath);
    const perFolderIndex = path.join(workspaceRoot, folderPath, '.index.codex.json');

    if (fs.existsSync(perFolderIndex)) {
      return perFolderIndex;
    }
  }

  if (node._computed_path) {
    const folderPath = path.dirname(node._computed_path);
    const perFolderIndex = path.join(workspaceRoot, folderPath, '.index.codex.json');

    if (fs.existsSync(perFolderIndex)) {
      return perFolderIndex;
    }
  }

  return path.join(workspaceRoot, '.index.codex.json');
}

/**
 * Dispose tree state — clears debounce timer and queue.
 * Called from deactivate().
 */
export function disposeTreeState(): void {
  if (expandedUpdateTimeout) {
    clearTimeout(expandedUpdateTimeout);
    expandedUpdateTimeout = null;
  }
  expandedUpdateQueue.clear();
}
