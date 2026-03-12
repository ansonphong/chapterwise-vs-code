import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { CommandDeps } from './types';
import { CodexTreeItem, CodexFieldTreeItem, IndexNodeTreeItem } from '../treeProvider';
import { isMarkdownFile, parseMarkdownAsCodex, parseCodex, CodexNode } from '../codexModel';

export function registerNavigationCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  const { treeProvider, writerViewManager, outputChannel, getWorkspaceRoot, findNodeById } = deps;

  // Go to YAML command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwise.goToYaml',
      async (treeItem?: CodexTreeItem | IndexNodeTreeItem | CodexFieldTreeItem) => {
        if (!treeItem) return;

        if (treeItem instanceof IndexNodeTreeItem) {
          const wsRoot = getWorkspaceRoot();
          if (!wsRoot) return;
          const resolved = await deps.resolveIndexNodeForEdit(treeItem, wsRoot);
          if (!resolved) return;
          const ed = await vscode.window.showTextDocument(resolved.doc);
          if (resolved.node.lineNumber) {
            const pos = new vscode.Position(resolved.node.lineNumber - 1, 0);
            ed.selection = new vscode.Selection(pos, pos);
            ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
          }
          return;
        }

        if (treeItem instanceof CodexFieldTreeItem) {
          const document = treeProvider.getActiveTextDocument();
          if (document) {
            await vscode.window.showTextDocument(document);
          }
          return;
        }

        const document = treeProvider.getActiveTextDocument();
        if (!document) return;

        const lineNumber = (treeItem as CodexTreeItem).codexNode.lineNumber;
        if (lineNumber !== undefined) {
          const editor = await vscode.window.showTextDocument(document);
          const position = new vscode.Position(lineNumber - 1, 0);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
          );
        } else {
          await vscode.window.showTextDocument(document);
        }
      }
    )
  );

  // Navigate to Entity command (opens Writer View)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwise.navigateToEntity',
      async (treeItem?: IndexNodeTreeItem) => {
        if (!treeItem) {
          vscode.window.showErrorMessage('No node selected');
          return;
        }

        const node = treeItem.indexNode as any;
        const parentFile = node._parent_file;
        const entityId = node.id;

        if (!parentFile || !entityId) {
          vscode.window.showErrorMessage('Cannot navigate: missing file or node ID');
          return;
        }

        const workspaceRoot = treeProvider.getWorkspaceRoot();
        if (!workspaceRoot) {
          vscode.window.showErrorMessage('No workspace root found');
          return;
        }

        const filePath = path.join(workspaceRoot, parentFile);

        if (!fs.existsSync(filePath)) {
          vscode.window.showErrorMessage(`File not found: ${parentFile}`);
          return;
        }

        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const codexDoc = parseCodex(fileContent);

        if (!codexDoc || !codexDoc.rootNode) {
          vscode.window.showErrorMessage('Failed to parse codex file');
          return;
        }

        const entityNode = findNodeById(codexDoc.rootNode, entityId);

        if (!entityNode) {
          vscode.window.showErrorMessage(`Node ${entityId} not found in file`);
          return;
        }

        let initialField = '__overview__';

        const hasSummary = entityNode.availableFields.includes('summary');
        const hasBody = entityNode.availableFields.includes('body');
        const hasChildren = entityNode.children && entityNode.children.length > 0;
        const hasContentSections = entityNode.contentSections && entityNode.contentSections.length > 0;
        const hasAttributes = entityNode.attributes && entityNode.attributes.length > 0;

        const fieldCount = [hasSummary, hasBody, hasContentSections, hasAttributes, hasChildren].filter(Boolean).length;

        if (fieldCount === 1) {
          if (hasSummary) initialField = 'summary';
          else if (hasBody) initialField = 'body';
        }

        const documentUri = vscode.Uri.file(filePath);

        await writerViewManager.openWriterViewForField(entityNode, documentUri, initialField);
      }
    )
  );

  // Navigate to Field command (opens Writer View)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwise.navigateToField',
      async (treeItem?: IndexNodeTreeItem) => {
        if (!treeItem) {
          vscode.window.showErrorMessage('No field selected');
          return;
        }

        const node = treeItem.indexNode as any;
        const parentFile = node._parent_file;
        const parentEntity = node._parent_entity;
        const fieldName = node._field_name;

        if (!parentFile || !fieldName) {
          vscode.window.showErrorMessage('Cannot navigate: missing file or field name');
          return;
        }

        const workspaceRoot = treeProvider.getWorkspaceRoot();
        if (!workspaceRoot) {
          vscode.window.showErrorMessage('No workspace root found');
          return;
        }

        const filePath = path.join(workspaceRoot, parentFile);

        if (!fs.existsSync(filePath)) {
          vscode.window.showErrorMessage(`File not found: ${parentFile}`);
          return;
        }

        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const codexDoc = parseCodex(fileContent);

        if (!codexDoc || !codexDoc.rootNode) {
          vscode.window.showErrorMessage('Failed to parse codex file');
          return;
        }

        let targetNode: CodexNode | null;

        if (parentEntity) {
          targetNode = codexDoc.allNodes.find(n => n.id === parentEntity) || null;
          if (!targetNode) {
            targetNode = findNodeById(codexDoc.rootNode, parentEntity);
          }
          if (!targetNode) {
            outputChannel.appendLine(`[navigateToField] Node ${parentEntity} not found. Available IDs: ${codexDoc.allNodes.map(n => n.id).join(', ')}`);
            vscode.window.showErrorMessage(`Parent node ${parentEntity} not found in file`);
            return;
          }
        } else {
          targetNode = codexDoc.rootNode;
        }

        const documentUri = vscode.Uri.file(filePath);

        let writerViewFieldName = fieldName;
        if (fieldName === 'attributes') {
          writerViewFieldName = '__attributes__';
        } else if (fieldName === 'content') {
          writerViewFieldName = '__content__';
        } else if (fieldName === 'images') {
          writerViewFieldName = '__images__';
        }

        await writerViewManager.openWriterViewForField(targetNode, documentUri, writerViewFieldName);
      }
    )
  );

  // Navigate to Node command (opens Writer View for nested nodes)
  // NOTE: Dual calling convention — called with IndexNodeTreeItem from tree context menus,
  // but also called with a plain string node ID from the search command via executeCommand.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwise.navigateToNode',
      async (arg?: IndexNodeTreeItem | { nodeId: string; parentFile: string }) => {
        let targetNodeId: string | undefined;
        let parentFile: string | undefined;

        if (arg && 'indexNode' in arg) {
          const indexNode = (arg as IndexNodeTreeItem).indexNode as any;
          targetNodeId = indexNode.id;
          parentFile = indexNode._parent_file;
        } else if (arg && 'nodeId' in arg) {
          targetNodeId = arg.nodeId;
          parentFile = arg.parentFile;
        }

        if (!parentFile) {
          return;
        }

        if (!parentFile) {
          vscode.window.showWarningMessage('Cannot navigate: No parent file found');
          return;
        }

        const workspaceRoot = treeProvider.getWorkspaceRoot();
        if (!workspaceRoot) {
          vscode.window.showWarningMessage('Cannot navigate: No workspace root');
          return;
        }

        const fullPath = path.join(workspaceRoot, parentFile);

        const uri = vscode.Uri.file(fullPath);
        try {
          await vscode.workspace.fs.stat(uri);
        } catch {
          vscode.window.showWarningMessage(`File not found: ${parentFile}`);
          return;
        }

        const fileContentBytes = await vscode.workspace.fs.readFile(uri);
        const fileContent = Buffer.from(fileContentBytes).toString('utf-8');

        const codexDoc = isMarkdownFile(fullPath)
          ? parseMarkdownAsCodex(fileContent, fullPath)
          : parseCodex(fileContent);

        if (!codexDoc || !codexDoc.rootNode) {
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc);
          return;
        }

        let targetNode: CodexNode | null = null;

        if (targetNodeId) {
          targetNode = codexDoc.allNodes.find(n => n.id === targetNodeId) || null;
          if (!targetNode) {
            targetNode = findNodeById(codexDoc.rootNode, targetNodeId);
          }
        }

        if (targetNode) {
          await writerViewManager.openWriterViewForField(targetNode, uri, '__overview__');
        } else {
          outputChannel.appendLine(`[navigateToNode] Node ${targetNodeId} not found. Available IDs: ${codexDoc.allNodes.map(n => n.id).join(', ')}`);
          const { CodexTreeItem } = await import('../treeProvider');
          const hasChildren = codexDoc.rootNode.children && codexDoc.rootNode.children.length > 0;
          const tempTreeItem = new CodexTreeItem(
            codexDoc.rootNode,
            uri,
            hasChildren,
            false,
            true
          );
          await writerViewManager.openWriterView(tempTreeItem);
        }
      }
    )
  );

  // Navigate to Entity in Code View
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwise.navigateToEntityInCodeView',
      async (treeItem?: IndexNodeTreeItem) => {
        if (!treeItem) {
          vscode.window.showErrorMessage('No node selected');
          return;
        }

        const node = treeItem.indexNode as any;
        const parentFile = node._parent_file;
        const entityId = node.id;

        if (!parentFile || !entityId) {
          vscode.window.showErrorMessage('Cannot navigate: missing file or node ID');
          return;
        }

        const workspaceRoot = treeProvider.getWorkspaceRoot();
        if (!workspaceRoot) {
          vscode.window.showErrorMessage('No workspace root found');
          return;
        }

        const filePath = path.join(workspaceRoot, parentFile);

        if (!fs.existsSync(filePath)) {
          vscode.window.showErrorMessage(`File not found: ${parentFile}`);
          return;
        }

        const doc = await vscode.workspace.openTextDocument(filePath);
        const editor = await vscode.window.showTextDocument(doc);

        const text = doc.getText();
        const lines = text.split('\n');
        let entityLineStart = -1;

        const escapeRegExp = (str: string): string => {
          return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        };

        const idPatterns = [
          new RegExp(`^\\s*id:\\s*${escapeRegExp(entityId)}\\s*$`, 'i'),
          new RegExp(`^\\s*id:\\s*["']${escapeRegExp(entityId)}["']\\s*$`, 'i'),
          new RegExp(`^\\s*["']id["']:\\s*["']${escapeRegExp(entityId)}["']`, 'i'),
        ];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (idPatterns.some(pattern => pattern.test(line))) {
            entityLineStart = i;
            break;
          }
        }

        if (entityLineStart >= 0) {
          const position = new vscode.Position(entityLineStart, 0);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
          );
        } else {
          vscode.window.showWarningMessage(`Node ${entityId} not found in file`);
        }
      }
    )
  );

  // Backward-compat alias
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwise.navigateToNodeInCodeView',
      (...args: any[]) => vscode.commands.executeCommand('chapterwise.navigateToEntityInCodeView', ...args)
    )
  );

  // Navigate to Field in Code View
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwise.navigateToFieldInCodeView',
      async (treeItem?: IndexNodeTreeItem) => {
        if (!treeItem) {
          vscode.window.showErrorMessage('No field selected');
          return;
        }

        const node = treeItem.indexNode as any;
        const parentFile = node._parent_file;
        const parentEntity = node._parent_entity;
        const fieldName = node._field_name;

        if (!parentFile || !fieldName) {
          vscode.window.showErrorMessage('Cannot navigate: missing file or field name');
          return;
        }

        const workspaceRoot = treeProvider.getWorkspaceRoot();
        if (!workspaceRoot) {
          vscode.window.showErrorMessage('No workspace root found');
          return;
        }

        const filePath = path.join(workspaceRoot, parentFile);

        if (!fs.existsSync(filePath)) {
          vscode.window.showErrorMessage(`File not found: ${parentFile}`);
          return;
        }

        const doc = await vscode.workspace.openTextDocument(filePath);
        const editor = await vscode.window.showTextDocument(doc);

        const text = doc.getText();
        const lines = text.split('\n');
        let fieldLineStart = -1;
        let entityLineStart = -1;

        const escapeRegExp = (str: string): string => {
          return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        };

        if (parentEntity) {
          const idPatterns = [
            new RegExp(`^\\s*id:\\s*${escapeRegExp(parentEntity)}\\s*$`, 'i'),
            new RegExp(`^\\s*id:\\s*["']${escapeRegExp(parentEntity)}["']\\s*$`, 'i'),
            new RegExp(`^\\s*["']id["']:\\s*["']${escapeRegExp(parentEntity)}["']`, 'i'),
          ];

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (idPatterns.some(pattern => pattern.test(line))) {
              entityLineStart = i;
              break;
            }
          }
        }

        const fieldPatterns = [
          new RegExp(`^\\s*${escapeRegExp(fieldName)}:\\s*`, 'i'),
          new RegExp(`^\\s*["']${escapeRegExp(fieldName)}["']:\\s*`, 'i'),
        ];

        const searchStart = entityLineStart >= 0 ? entityLineStart : 0;
        for (let i = searchStart; i < lines.length; i++) {
          const line = lines[i];
          if (fieldPatterns.some(pattern => pattern.test(line))) {
            fieldLineStart = i;
            break;
          }
        }

        if (fieldLineStart >= 0) {
          const position = new vscode.Position(fieldLineStart, 0);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
          );
        } else {
          vscode.window.showWarningMessage(`Field ${fieldName} not found in file`);
        }
      }
    )
  );

  // Show Error command (for missing/error nodes)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwise.showError',
      async (treeItem?: IndexNodeTreeItem) => {
        if (!treeItem) {
          return;
        }

        const node = treeItem.indexNode as any;
        const nodeKind = node._node_kind;

        if (nodeKind === 'error') {
          const errorMsg = node._error_message || 'Unknown error';
          const originalInclude = node._original_include;
          vscode.window.showErrorMessage(
            `Error: ${errorMsg}${originalInclude ? `\nInclude: ${originalInclude}` : ''}`,
            'OK'
          );
        } else if (nodeKind === 'missing') {
          const originalInclude = node._original_include || node._computed_path;
          vscode.window.showWarningMessage(
            `Missing File: ${originalInclude}\n\nThe included file could not be found.`,
            'OK'
          );
        }
      }
    )
  );
}
