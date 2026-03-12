import * as vscode from 'vscode';
import type { CommandDeps } from './types';
import { runConvertToMarkdown, runConvertToCodex } from '../convertFormat';

export function registerConvertCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  // Convert to Markdown command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.convertToMarkdown', async () => {
      await runConvertToMarkdown();
    })
  );

  // Convert Markdown to Codex command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.convertToCodex', async () => {
      await runConvertToCodex();
    })
  );
}
