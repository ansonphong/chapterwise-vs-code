import * as vscode from 'vscode';
import type { CommandDeps } from './types';
import { CodexTreeItem, IndexNodeTreeItem } from '../treeProvider';

export function registerBatchCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  const { getWorkspaceRoot, resolveIndexNodeForEdit, reloadTreeIndex } = deps;

  // Batch move to trash (multi-select)
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwise.batchMoveToTrash',
      async (item: CodexTreeItem | IndexNodeTreeItem, selectedItems: (CodexTreeItem | IndexNodeTreeItem)[]) => {
        const items = selectedItems || [item];
        const confirm = await vscode.window.showWarningMessage(
          `Move ${items.length} items to trash?`, { modal: true }, 'Move to Trash'
        );
        if (confirm !== 'Move to Trash') return;
        for (const ti of items) {
          await vscode.commands.executeCommand('chapterwise.moveToTrash', ti);
        }
      }
    )
  );

  // Batch add tags (multi-select)
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwise.batchAddTags',
      async (item: CodexTreeItem | IndexNodeTreeItem, selectedItems: (CodexTreeItem | IndexNodeTreeItem)[]) => {
        const items = selectedItems || [item];
        const input = await vscode.window.showInputBox({ prompt: `Add tags to ${items.length} items (comma-separated)` });
        if (!input) return;
        const tags = input.split(',').map(t => t.trim()).filter(Boolean);
        if (tags.length === 0) return;
        const wsRoot = getWorkspaceRoot();
        const { getStructureEditor } = await import('../structureEditor');
        const editor = getStructureEditor();
        for (const ti of items) {
          if (ti instanceof CodexTreeItem) {
            const doc = await vscode.workspace.openTextDocument(ti.documentUri);
            await editor.addTagsToNode(doc, ti.codexNode, tags);
          } else if (ti instanceof IndexNodeTreeItem) {
            if (!wsRoot) continue;
            const resolved = await resolveIndexNodeForEdit(ti, wsRoot);
            if (resolved) await editor.addTagsToNode(resolved.doc, resolved.node, tags);
          }
        }
        await reloadTreeIndex();
      }
    )
  );
}
