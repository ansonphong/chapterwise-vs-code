import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { CommandDeps } from './types';
import { CodexTreeItem, CodexFieldTreeItem, IndexNodeTreeItem } from '../treeProvider';
import { isCodexFile, isMarkdownFile, parseMarkdownAsCodex, parseCodex } from '../codexModel';

export function registerWriterViewCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  const { writerViewManager, outputChannel } = deps;

  // Open Writer View command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwise.openWriterView',
      async (treeItem?: CodexTreeItem) => {
        if (treeItem) {
          await writerViewManager.openWriterView(treeItem);
        } else {
          vscode.window.showInformationMessage(
            'Select a node in the ChapterWise Navigator to open Writer View'
          );
        }
      }
    )
  );

  // Open Writer View for a specific field
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwise.openWriterViewForField',
      async (fieldItem?: CodexFieldTreeItem) => {
        if (!fieldItem) {
          return;
        }

        let targetField: string;
        if (fieldItem.fieldType === 'attributes') {
          targetField = '__attributes__';
        } else if (fieldItem.fieldType === 'content') {
          targetField = '__content__';
        } else {
          targetField = fieldItem.fieldName.split(' ')[0].toLowerCase();
        }

        await writerViewManager.openWriterViewForField(fieldItem.parentNode, fieldItem.documentUri, targetField);
      }
    )
  );

  // Open Index File in Writer View command (for .md Codex Lite files)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwise.openIndexFileInWriterView',
      async (treeItem?: IndexNodeTreeItem) => {
        if (!treeItem) {
          outputChannel.appendLine('openIndexFileInWriterView: No treeItem provided');
          return;
        }

        outputChannel.appendLine('='.repeat(80));
        outputChannel.appendLine(`openIndexFileInWriterView called for: ${treeItem.indexNode.name}`);
        outputChannel.appendLine(`Call stack: ${new Error().stack}`);
        outputChannel.appendLine(`TreeItem workspaceRoot: ${treeItem.workspaceRoot}`);
        outputChannel.appendLine(`TreeItem _computed_path: ${treeItem.indexNode._computed_path}`);
        outputChannel.appendLine(`TreeItem _filename: ${treeItem.indexNode._filename}`);

        const filePath = treeItem.getFilePath();
        outputChannel.appendLine(`File path: ${filePath}`);

        try {
          if (!fs.existsSync(filePath)) {
            const errorMsg = `File not found: ${filePath}`;
            outputChannel.appendLine(`ERROR: ${errorMsg}`);
            vscode.window.showErrorMessage(errorMsg);
            return;
          }

          outputChannel.appendLine(`File exists, reading file...`);
          const uri = vscode.Uri.file(filePath);
          const text = fs.readFileSync(filePath, 'utf-8');
          outputChannel.appendLine(`File read successfully, length: ${text.length}`);

          const fileName = path.basename(filePath);
          const isMarkdown = fileName.endsWith('.md');
          const isCodexYaml = fileName.endsWith('.codex.yaml');

          let codexDoc;
          if (isMarkdown) {
            outputChannel.appendLine(`Parsing as Codex Lite (markdown), text length: ${text.length}`);
            codexDoc = parseMarkdownAsCodex(text, filePath);
          } else if (isCodexYaml) {
            outputChannel.appendLine(`Parsing as Codex YAML, text length: ${text.length}`);
            codexDoc = parseCodex(text);
          } else {
            outputChannel.appendLine(`ERROR: Unsupported file type: ${fileName}`);
            vscode.window.showErrorMessage(`Unsupported file type: ${fileName}`);
            return;
          }

          if (!codexDoc || !codexDoc.rootNode) {
            outputChannel.appendLine(`Failed to parse as Codex, falling back to text editor`);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
            return;
          }

          outputChannel.appendLine(`Parsed successfully, root node:`);
          outputChannel.appendLine(`  name: ${codexDoc.rootNode.name}`);
          outputChannel.appendLine(`  type: ${codexDoc.rootNode.type}`);
          outputChannel.appendLine(`  proseField: ${codexDoc.rootNode.proseField}`);
          outputChannel.appendLine(`  proseValue length: ${codexDoc.rootNode.proseValue?.length || 0}`);
          outputChannel.appendLine(`  proseValue preview: ${codexDoc.rootNode.proseValue?.substring(0, 100) || 'EMPTY'}`);
          outputChannel.appendLine(`  availableFields: ${codexDoc.rootNode.availableFields.join(', ')}`);

          const hasChildren = codexDoc.rootNode.children && codexDoc.rootNode.children.length > 0;
          const tempTreeItem = new CodexTreeItem(
            codexDoc.rootNode,
            uri,
            hasChildren,
            false,
            true
          );

          outputChannel.appendLine(`Created temp tree item, opening writer view...`);

          await writerViewManager.openWriterView(tempTreeItem);

          outputChannel.appendLine(`Writer view opened successfully`);
        } catch (error) {
          const errorMsg = `Failed to open file in Codex Editor: ${path.basename(filePath)}`;
          outputChannel.appendLine(`ERROR: ${errorMsg}`);
          outputChannel.appendLine(`Error details: ${error}`);
          outputChannel.appendLine(`Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
          vscode.window.showErrorMessage(errorMsg);
        }
      }
    )
  );
}
