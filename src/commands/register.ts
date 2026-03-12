import * as vscode from 'vscode';
import type { CommandDeps } from './types';
import { registerNavigatorCommands } from './navigator';
import { registerWriterViewCommands } from './writerView';
import { registerNavigationCommands } from './navigation';
import { registerStructureCommands } from './structure';
import { registerFileOpsCommands } from './fileOps';
import { registerClipboardCommands } from './clipboard';
import { registerTrashCommands } from './trash';
import { registerBatchCommands } from './batch';
import { registerToolsCommands } from './tools';
import { registerIndexCommands } from './index';
import { registerContextCommands } from './context';
import { registerConvertCommands } from './convert';
import { registerSearchCommands } from './search';
import { registerGitCommands } from './git';

export function registerAllCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  registerNavigatorCommands(context, deps);
  registerWriterViewCommands(context, deps);
  registerNavigationCommands(context, deps);
  registerStructureCommands(context, deps);
  registerFileOpsCommands(context, deps);
  registerClipboardCommands(context, deps);
  registerTrashCommands(context, deps);
  registerBatchCommands(context, deps);
  registerToolsCommands(context, deps);
  registerIndexCommands(context, deps);
  registerContextCommands(context, deps);
  registerConvertCommands(context, deps);
  registerSearchCommands(context, deps);
  registerGitCommands(context, deps);
}
