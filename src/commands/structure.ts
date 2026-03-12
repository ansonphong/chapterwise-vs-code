import * as vscode from 'vscode';
import * as path from 'path';
import type { CommandDeps } from './types';
import { CodexTreeItem, IndexNodeTreeItem } from '../treeProvider';

export function registerStructureCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  const { treeProvider, outputChannel, getWorkspaceRoot, resolveIndexNodeForEdit, reloadTreeIndex, regenerateAndReload, showTransientMessage } = deps;

  // Add child node command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.addChildNode',
      async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
        if (!treeItem) {
          vscode.window.showInformationMessage('Select a node to add a child to');
          return;
        }

        if (treeItem instanceof IndexNodeTreeItem) {
          const wsRoot = getWorkspaceRoot();
          if (!wsRoot) return;
          const nodeKind = (treeItem.indexNode as any)._node_kind;
          if (nodeKind === 'folder') {
            vscode.window.showInformationMessage('Use "Add File" for folders');
            return;
          }
          const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
          if (!resolved) return;
          const name = await vscode.window.showInputBox({ prompt: 'Enter node name' });
          if (!name) return;
          const type = await vscode.window.showInputBox({ prompt: 'Enter node type', value: 'scene' });
          if (!type) return;
          const { getStructureEditor } = await import('../structureEditor');
          const { getSettingsManager } = await import('../settingsManager');
          const editor = getStructureEditor();
          const settings = await getSettingsManager().getSettings(resolved.doc.uri);
          await editor.addNodeInDocument(resolved.doc, resolved.node, 'child', { name, type, proseField: 'body', proseValue: '' }, settings);
          await reloadTreeIndex();
          return;
        }

        const document = treeProvider.getActiveTextDocument();
        if (!document) {
          vscode.window.showErrorMessage('No active document');
          return;
        }

        const { getStructureEditor } = await import('../structureEditor');
        const { getSettingsManager } = await import('../settingsManager');
        const { getFileOrganizer } = await import('../fileOrganizer');

        const editor = getStructureEditor();
        const settings = await getSettingsManager().getSettings(document.uri);

        const name = await vscode.window.showInputBox({
          prompt: 'Enter node name',
          placeHolder: 'e.g., Scene 1, Chapter 2'
        });

        if (!name) return;

        const type = await vscode.window.showInputBox({
          prompt: 'Enter node type',
          placeHolder: 'e.g., scene, chapter, character'
        });

        if (!type) return;

        let mode = settings.defaultChildMode;
        if (mode === 'ask') {
          const choice = await vscode.window.showQuickPick(
            [
              { label: 'Inline', value: 'inline' as const },
              { label: 'Separate File', value: 'separate-file' as const }
            ],
            { placeHolder: 'How should the child be created?' }
          );
          mode = choice?.value || 'inline';
        }

        if (mode === 'separate-file') {
          const organizer = getFileOrganizer();
          const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
          if (!workspaceFolder) return;

          const result = await organizer.createNodeFile(
            workspaceFolder.uri.fsPath,
            '',
            { name, type, proseField: 'body', proseValue: '' },
            settings
          );

          if (result.success && result.fileUri) {
            const { generateIndex } = await import('../indexGenerator');
            await generateIndex({ workspaceRoot: workspaceFolder.uri.fsPath });

            await vscode.window.showTextDocument(result.fileUri);
            treeProvider.refresh();
          }
        } else {
          const success = await editor.addNodeInDocument(
            document,
            treeItem.codexNode,
            'child',
            { name, type, proseField: 'body', proseValue: '' },
            settings
          );

          if (success) {
            treeProvider.setActiveDocument(document);
            showTransientMessage(`✓ Added child: ${name}`, 3000);
          }
        }
      }
    )
  );

  // Add sibling node command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.addSiblingNode',
      async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
        if (!treeItem) {
          vscode.window.showInformationMessage('Select a node to add a sibling to');
          return;
        }

        if (treeItem instanceof IndexNodeTreeItem) {
          const wsRoot = getWorkspaceRoot();
          if (!wsRoot) return;
          const nodeKind = (treeItem.indexNode as any)._node_kind;

          if (nodeKind === 'file') {
            const name = await vscode.window.showInputBox({ prompt: 'Enter node name' });
            if (!name) return;
            if (/[/\\]/.test(name) || name === '..' || name === '.') {
              vscode.window.showErrorMessage('Invalid node name');
              return;
            }
            const type = await vscode.window.showInputBox({ prompt: 'Enter node type', value: treeItem.indexNode.type || 'chapter' });
            if (!type) return;
            const filePath = treeItem.indexNode._computed_path;
            if (!filePath) return;
            const dir = path.dirname(filePath);

            const { getStructureEditor } = await import('../structureEditor');
            const { getSettingsManager } = await import('../settingsManager');
            const ed = getStructureEditor();
            const settings = await getSettingsManager().getSettings(vscode.Uri.file(path.join(wsRoot, filePath)));
            const slugName = ed.slugifyName(name, settings.naming);
            const newFilePath = path.join(dir, `${slugName}.codex.yaml`);
            const newFullPath = path.join(wsRoot, newFilePath);

            const { isPathWithinWorkspace } = await import('../writerView/utils/helpers');
            if (!isPathWithinWorkspace(newFullPath, wsRoot)) {
              vscode.window.showErrorMessage('File path resolves outside workspace');
              return;
            }

            const { randomUUID } = await import('crypto');
            const content = `metadata:\n  formatVersion: "1.2"\nid: "${randomUUID()}"\ntype: ${type}\nname: "${name}"\nbody: ""\n`;
            await vscode.workspace.fs.writeFile(vscode.Uri.file(newFullPath), Buffer.from(content, 'utf-8'));
            await regenerateAndReload(wsRoot);
          } else if (nodeKind === 'node') {
            const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
            if (!resolved) return;
            const name = await vscode.window.showInputBox({ prompt: 'Enter node name' });
            if (!name) return;
            const type = await vscode.window.showInputBox({ prompt: 'Enter node type', value: treeItem.indexNode.type || 'scene' });
            if (!type) return;
            const { getStructureEditor } = await import('../structureEditor');
            const { getSettingsManager } = await import('../settingsManager');
            const ed = getStructureEditor();
            const settings = await getSettingsManager().getSettings(resolved.doc.uri);
            await ed.addNodeInDocument(resolved.doc, resolved.node, 'sibling-after', { name, type, proseField: 'body', proseValue: '' }, settings);
            await reloadTreeIndex();
          }
          return;
        }

        const document = treeProvider.getActiveTextDocument();
        if (!document) {
          vscode.window.showErrorMessage('No active document');
          return;
        }

        const { getStructureEditor } = await import('../structureEditor');
        const { getSettingsManager } = await import('../settingsManager');

        const editor = getStructureEditor();
        const settings = await getSettingsManager().getSettings(document.uri);

        const name = await vscode.window.showInputBox({
          prompt: 'Enter node name',
          placeHolder: 'e.g., Scene 2, Chapter 3'
        });

        if (!name) return;

        const type = await vscode.window.showInputBox({
          prompt: 'Enter node type',
          value: (treeItem as CodexTreeItem).codexNode.type,
          placeHolder: 'e.g., scene, chapter'
        });

        if (!type) return;

        const success = await editor.addNodeInDocument(
          document,
          (treeItem as CodexTreeItem).codexNode,
          'sibling-after',
          { name, type, proseField: 'body', proseValue: '' },
          settings
        );

        if (success) {
          treeProvider.setActiveDocument(document);
          showTransientMessage(`✓ Added sibling: ${name}`, 3000);
        }
      }
    )
  );

  // Remove node command (move to trash)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.removeNode',
      async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
        if (!treeItem) return;

        if (treeItem instanceof IndexNodeTreeItem) {
          const wsRoot = getWorkspaceRoot();
          if (!wsRoot) return;
          const nodeKind = (treeItem.indexNode as any)._node_kind;
          if (nodeKind === 'file' || nodeKind === 'folder') {
            const filePath = treeItem.indexNode._computed_path;
            if (!filePath) return;
            const { getStructureEditor } = await import('../structureEditor');
            const { getSettingsManager } = await import('../settingsManager');
            const editor = getStructureEditor();
            const settings = await getSettingsManager().getSettings(vscode.Uri.file(path.join(wsRoot, filePath)));
            await editor.removeFileFromIndex(wsRoot, filePath, false, settings);
            await regenerateAndReload(wsRoot);
          } else if (nodeKind === 'node') {
            const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
            if (!resolved) return;
            const { getStructureEditor } = await import('../structureEditor');
            const { getSettingsManager } = await import('../settingsManager');
            const editor = getStructureEditor();
            const settings = await getSettingsManager().getSettings(resolved.doc.uri);
            await editor.removeNodeFromDocument(resolved.doc, resolved.node, false, settings);
            await reloadTreeIndex();
          }
          return;
        }

        const document = treeProvider.getActiveTextDocument();
        if (!document) return;

        const { getStructureEditor } = await import('../structureEditor');
        const { getSettingsManager } = await import('../settingsManager');

        const editor = getStructureEditor();
        const settings = await getSettingsManager().getSettings(document.uri);

        const success = await editor.removeNodeFromDocument(
          document,
          (treeItem as CodexTreeItem).codexNode,
          false,
          settings
        );

        if (success) {
          treeProvider.setActiveDocument(document);
          showTransientMessage(`✓ Removed: ${(treeItem as CodexTreeItem).codexNode.name}`, 3000);
        }
      }
    )
  );

  // Delete node permanently command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.deleteNodePermanently',
      async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
        if (!treeItem) return;

        if (treeItem instanceof IndexNodeTreeItem) {
          const wsRoot = getWorkspaceRoot();
          if (!wsRoot) return;
          const nodeKind = (treeItem.indexNode as any)._node_kind;
          if (nodeKind === 'file' || nodeKind === 'folder') {
            const filePath = treeItem.indexNode._computed_path;
            if (!filePath) return;
            const { getStructureEditor } = await import('../structureEditor');
            const { getSettingsManager } = await import('../settingsManager');
            const editor = getStructureEditor();
            const settings = await getSettingsManager().getSettings(vscode.Uri.file(path.join(wsRoot, filePath)));
            await editor.removeFileFromIndex(wsRoot, filePath, true, settings);
            await regenerateAndReload(wsRoot);
          } else if (nodeKind === 'node') {
            const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
            if (!resolved) return;
            const { getStructureEditor } = await import('../structureEditor');
            const { getSettingsManager } = await import('../settingsManager');
            const editor = getStructureEditor();
            const settings = await getSettingsManager().getSettings(resolved.doc.uri);
            await editor.removeNodeFromDocument(resolved.doc, resolved.node, true, settings);
            await reloadTreeIndex();
          }
          return;
        }

        const document = treeProvider.getActiveTextDocument();
        if (!document) return;

        const { getStructureEditor } = await import('../structureEditor');
        const { getSettingsManager } = await import('../settingsManager');

        const editor = getStructureEditor();
        const settings = await getSettingsManager().getSettings(document.uri);

        const success = await editor.removeNodeFromDocument(
          document,
          (treeItem as CodexTreeItem).codexNode,
          true,
          settings
        );

        if (success) {
          treeProvider.setActiveDocument(document);
          showTransientMessage(`✓ Deleted: ${(treeItem as CodexTreeItem).codexNode.name}`, 3000);
        }
      }
    )
  );

  // Rename node command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.renameNode',
      async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
        if (!treeItem) return;

        if (treeItem instanceof IndexNodeTreeItem) {
          const wsRoot = getWorkspaceRoot();
          if (!wsRoot) return;
          const nodeKind = (treeItem.indexNode as any)._node_kind;
          const currentName = treeItem.indexNode.name || treeItem.indexNode.title || '';
          const newName = await vscode.window.showInputBox({ prompt: 'Enter new name', value: currentName });
          if (!newName || newName === currentName) return;

          if (nodeKind === 'file') {
            const filePath = treeItem.indexNode._computed_path;
            if (!filePath) return;
            const { getStructureEditor } = await import('../structureEditor');
            const { getSettingsManager } = await import('../settingsManager');
            const editor = getStructureEditor();
            const settings = await getSettingsManager().getSettings(vscode.Uri.file(path.join(wsRoot, filePath)));
            await editor.renameFileInIndex(wsRoot, filePath, newName, settings);
            await regenerateAndReload(wsRoot);
          } else if (nodeKind === 'node') {
            const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
            if (!resolved) return;
            const { getStructureEditor } = await import('../structureEditor');
            const editor = getStructureEditor();
            await editor.renameNodeInDocument(resolved.doc, resolved.node, newName);
            await reloadTreeIndex();
          }
          return;
        }

        const newName = await vscode.window.showInputBox({
          prompt: 'Enter new name',
          value: (treeItem as CodexTreeItem).codexNode.name,
          placeHolder: 'New node name'
        });

        if (!newName || newName === (treeItem as CodexTreeItem).codexNode.name) return;

        const document = treeProvider.getActiveTextDocument();
        if (!document) {
          vscode.window.showErrorMessage('No active document');
          return;
        }

        const { getStructureEditor } = await import('../structureEditor');
        const editor = getStructureEditor();

        const success = await editor.renameNodeInDocument(
          document,
          (treeItem as CodexTreeItem).codexNode,
          newName
        );

        if (success) {
          treeProvider.setActiveDocument(document);
          showTransientMessage(`✓ Renamed to: ${newName}`, 3000);
        }
      }
    )
  );

  // Duplicate node
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.duplicateNode', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
      if (!treeItem) return;
      const { getStructureEditor } = await import('../structureEditor');
      const editor = getStructureEditor();
      if (treeItem instanceof CodexTreeItem) {
        const doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
        await editor.duplicateNodeInDocument(doc, treeItem.codexNode);
        treeProvider.setActiveDocument(doc);
      } else if (treeItem instanceof IndexNodeTreeItem) {
        const wsRoot = getWorkspaceRoot();
        if (!wsRoot) return;
        const nodeKind = (treeItem.indexNode as any)._node_kind;
        if (nodeKind === 'file') {
          const filePath = treeItem.indexNode._computed_path;
          if (!filePath) return;
          const fullPath = path.join(wsRoot, filePath);
          const ext = path.extname(filePath);
          const base = filePath.slice(0, -ext.length);
          const newPath = `${base}-copy${ext}`;
          const newFullPath = path.join(wsRoot, newPath);
          const { isPathWithinWorkspace } = await import('../writerView/utils/helpers');
          if (!isPathWithinWorkspace(newFullPath, wsRoot)) {
            vscode.window.showErrorMessage('Duplicate path resolves outside workspace');
            return;
          }
          const fsPromises = (await import('fs/promises'));
          await fsPromises.copyFile(fullPath, newFullPath);
          await regenerateAndReload(wsRoot);
        } else if (nodeKind === 'node') {
          const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
          if (!resolved) return;
          await editor.duplicateNodeInDocument(resolved.doc, resolved.node);
          await reloadTreeIndex();
        }
      }
    })
  );

  // Move node up command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.moveNodeUp',
      async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
        if (!treeItem) return;

        if (!(treeItem instanceof IndexNodeTreeItem)) {
          vscode.window.showInformationMessage('Move up/down only works in Index mode');
          return;
        }

        const nodeKind = (treeItem.indexNode as any)._node_kind;
        if (nodeKind === 'node') {
          vscode.window.showInformationMessage('Inline node reorder is not yet supported. Use drag-and-drop instead.');
          return;
        }

        const wsRoot = getWorkspaceRoot();
        if (!wsRoot) return;

        const filePath = treeItem.getFilePath();
        const relativePath = path.relative(wsRoot, filePath);

        const { getStructureEditor } = await import('../structureEditor');
        const editor = getStructureEditor();

        const result = await editor.moveFileUp(wsRoot, relativePath);

        if (result.success) {
          showTransientMessage(result.message || '✓ Moved up', 3000);
          await reloadTreeIndex();
        } else {
          vscode.window.showWarningMessage(result.message || 'Failed to move up');
        }
      }
    )
  );

  // Move node down command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.moveNodeDown',
      async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
        if (!treeItem) return;

        if (!(treeItem instanceof IndexNodeTreeItem)) {
          vscode.window.showInformationMessage('Move up/down only works in Index mode');
          return;
        }

        const nodeKind = (treeItem.indexNode as any)._node_kind;
        if (nodeKind === 'node') {
          vscode.window.showInformationMessage('Inline node reorder is not yet supported. Use drag-and-drop instead.');
          return;
        }

        const wsRoot = getWorkspaceRoot();
        if (!wsRoot) return;

        const filePath = treeItem.getFilePath();
        const relativePath = path.relative(wsRoot, filePath);

        const { getStructureEditor } = await import('../structureEditor');
        const editor = getStructureEditor();

        const result = await editor.moveFileDown(wsRoot, relativePath);

        if (result.success) {
          showTransientMessage(result.message || '✓ Moved down', 3000);
          await reloadTreeIndex();
        } else {
          vscode.window.showWarningMessage(result.message || 'Failed to move down');
        }
      }
    )
  );

  // Change color command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.changeColor',
      async (treeItem?: CodexTreeItem) => {
        if (!treeItem) return;

        const document = treeProvider.getActiveTextDocument();
        if (!document) return;

        const { getColorManager } = await import('../colorManager');
        const colorManager = getColorManager();

        const success = await colorManager.changeColor(treeItem.codexNode, document);

        if (success) {
          treeProvider.setActiveDocument(document);
        }
      }
    )
  );

  // Change node type
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.changeType', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
      if (!treeItem) return;
      const types = ['book', 'chapter', 'scene', 'character', 'location', 'item', 'event', 'note', 'world', 'faction', 'lore'];
      const picked = await vscode.window.showQuickPick(types, { placeHolder: 'Select node type' });
      if (!picked) return;
      const { getStructureEditor } = await import('../structureEditor');
      const editor = getStructureEditor();
      if (treeItem instanceof CodexTreeItem) {
        const doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
        await editor.changeNodeType(doc, treeItem.codexNode, picked);
      } else if (treeItem instanceof IndexNodeTreeItem) {
        const wsRoot = getWorkspaceRoot();
        if (!wsRoot) return;
        const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
        if (resolved) await editor.changeNodeType(resolved.doc, resolved.node, picked);
      }
      await reloadTreeIndex();
    })
  );

  // Change icon/emoji
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.changeIcon', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
      if (!treeItem) return;
      const emoji = await vscode.window.showInputBox({ prompt: 'Enter emoji', placeHolder: 'e.g., 📖 🗡️ 🏰' });
      if (!emoji) return;
      const { getStructureEditor } = await import('../structureEditor');
      const editor = getStructureEditor();
      if (treeItem instanceof CodexTreeItem) {
        const doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
        await editor.setEmojiOnNode(doc, treeItem.codexNode, emoji);
      } else if (treeItem instanceof IndexNodeTreeItem) {
        const wsRoot = getWorkspaceRoot();
        if (!wsRoot) return;
        const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
        if (resolved) await editor.setEmojiOnNode(resolved.doc, resolved.node, emoji);
      }
      await reloadTreeIndex();
    })
  );

  // Add field to node
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.addField', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
      if (!treeItem) return;
      const { PROSE_FIELDS } = await import('../codexModel');
      const COMMON_FIELDS = [...PROSE_FIELDS, 'notes', 'synopsis'];
      let existingFields: string[] = [];
      if (treeItem instanceof CodexTreeItem) {
        existingFields = treeItem.codexNode.availableFields || [];
      }
      const items = COMMON_FIELDS
        .filter(f => !existingFields.includes(f))
        .map(f => ({ label: f.charAt(0).toUpperCase() + f.slice(1), field: f }));
      items.push({ label: 'Custom...', field: '__custom__' });
      const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select a field to add' });
      if (!picked) return;
      let fieldName = picked.field;
      if (fieldName === '__custom__') {
        const custom = await vscode.window.showInputBox({ prompt: 'Enter custom field name' });
        if (!custom) return;
        fieldName = custom;
      }
      const { getStructureEditor } = await import('../structureEditor');
      const editor = getStructureEditor();
      if (treeItem instanceof CodexTreeItem) {
        const doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
        await editor.addFieldToNode(doc, treeItem.codexNode, fieldName);
      } else if (treeItem instanceof IndexNodeTreeItem) {
        const wsRoot = getWorkspaceRoot();
        if (!wsRoot) return;
        const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
        if (resolved) await editor.addFieldToNode(resolved.doc, resolved.node, fieldName);
      }
      await reloadTreeIndex();
    })
  );

  // Delete field from node
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.deleteField', async (treeItem?: any) => {
      if (!treeItem) return;
      const { getStructureEditor } = await import('../structureEditor');
      const editor = getStructureEditor();
      const { CodexFieldTreeItem: CFT } = await import('../treeProvider');
      if (treeItem instanceof CFT) {
        const doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
        await editor.removeFieldFromNode(doc, treeItem.parentNode, treeItem.fieldName);
      } else if (treeItem instanceof IndexNodeTreeItem) {
        const fieldName = (treeItem.indexNode as any)._field_name;
        if (!fieldName) return;
        const wsRoot = getWorkspaceRoot();
        if (!wsRoot) return;
        const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
        if (resolved) await editor.removeFieldFromNode(resolved.doc, resolved.node, fieldName);
      }
      await reloadTreeIndex();
    })
  );

  // Rename field on node
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.renameField', async (treeItem?: any) => {
      if (!treeItem) return;
      const { CodexFieldTreeItem: CFT } = await import('../treeProvider');
      let oldName: string | undefined;
      if (treeItem instanceof CFT) {
        oldName = treeItem.fieldName;
      } else if (treeItem instanceof IndexNodeTreeItem) {
        oldName = (treeItem.indexNode as any)._field_name;
      }
      if (!oldName) return;
      const newName = await vscode.window.showInputBox({ prompt: 'Enter new field name', value: oldName });
      if (!newName || newName === oldName) return;
      const { getStructureEditor } = await import('../structureEditor');
      const editor = getStructureEditor();
      if (treeItem instanceof CFT) {
        const doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
        await editor.renameFieldOnNode(doc, treeItem.parentNode, oldName, newName);
      } else if (treeItem instanceof IndexNodeTreeItem) {
        const wsRoot = getWorkspaceRoot();
        if (!wsRoot) return;
        const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
        if (resolved) await editor.renameFieldOnNode(resolved.doc, resolved.node, oldName, newName);
      }
      await reloadTreeIndex();
    })
  );

  // Add tags to node
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.addTags', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
      if (!treeItem) return;
      const input = await vscode.window.showInputBox({ prompt: 'Enter tags (comma-separated)', placeHolder: 'e.g., action, drama, mystery' });
      if (!input) return;
      const tags = input.split(',').map(t => t.trim()).filter(Boolean);
      if (tags.length === 0) return;
      const { getStructureEditor } = await import('../structureEditor');
      const editor = getStructureEditor();
      if (treeItem instanceof CodexTreeItem) {
        const doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
        await editor.addTagsToNode(doc, treeItem.codexNode, tags);
      } else if (treeItem instanceof IndexNodeTreeItem) {
        const wsRoot = getWorkspaceRoot();
        if (!wsRoot) return;
        const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
        if (resolved) await editor.addTagsToNode(resolved.doc, resolved.node, tags);
      }
      await reloadTreeIndex();
    })
  );

  // Add relation to node
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.addRelation', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
      if (!treeItem) return;
      const wsRoot = getWorkspaceRoot();
      if (!wsRoot) return;
      const { generateIndex } = await import('../indexGenerator');
      const indexData = await generateIndex(wsRoot);
      const nodeItems: Array<{ label: string; description: string; id: string }> = [];
      const collectNodes = (nodes: any[]) => {
        for (const n of nodes) {
          if (n.id && n.type !== 'folder') {
            nodeItems.push({ label: n.name || n.id, description: n.type || '', id: n.id });
          }
          if (n.children) collectNodes(n.children);
        }
      };
      if (indexData?.children) collectNodes(indexData.children);
      const targetPick = await vscode.window.showQuickPick(nodeItems, { placeHolder: 'Select target node for relation' });
      if (!targetPick) return;
      const relTypes = ['follows', 'precedes', 'references', 'parent-of', 'child-of', 'related-to'];
      const relType = await vscode.window.showQuickPick(relTypes, { placeHolder: 'Select relation type' });
      if (!relType) return;
      const { getStructureEditor } = await import('../structureEditor');
      const editor = getStructureEditor();
      if (treeItem instanceof CodexTreeItem) {
        const doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
        await editor.addRelationToNode(doc, treeItem.codexNode, targetPick.id, relType);
      } else if (treeItem instanceof IndexNodeTreeItem) {
        const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
        if (resolved) await editor.addRelationToNode(resolved.doc, resolved.node, targetPick.id, relType);
      }
      await reloadTreeIndex();
    })
  );
}
