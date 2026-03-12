import * as vscode from 'vscode';
import type { CodexTreeProvider, CodexTreeItemType } from '../treeProvider';
import type { WriterViewManager } from '../writerView';
import type { CodexNode } from '../codexModel';
import type { IndexNodeTreeItem } from '../treeProvider';
import type { MultiIndexManager } from '../multiIndexManager';
import type { SubIndexTreeProvider } from '../subIndexTreeProvider';
import type { MasterIndexTreeProvider } from '../masterIndexTreeProvider';
import type { SearchIndexManager } from '../search';

export interface CommandDeps {
  treeProvider: CodexTreeProvider;
  treeView: vscode.TreeView<CodexTreeItemType>;
  writerViewManager: WriterViewManager;
  outputChannel: vscode.OutputChannel;

  // Multi-index state
  multiIndexManager: MultiIndexManager | undefined;
  masterTreeProvider: MasterIndexTreeProvider | undefined;
  subIndexProviders: SubIndexTreeProvider[];
  subIndexViews: vscode.TreeView<CodexTreeItemType>[];

  // Search
  getSearchIndexManager: () => SearchIndexManager | null;

  // Helpers
  getWorkspaceRoot: () => string | undefined;
  reloadTreeIndex: () => Promise<void>;
  regenerateAndReload: (wsRoot: string) => Promise<void>;
  resolveIndexNodeForEdit: (
    treeItem: IndexNodeTreeItem,
    wsRoot: string
  ) => Promise<{ doc: vscode.TextDocument; node: CodexNode } | null>;
  showTransientMessage: (message: string, duration?: number) => void;
  findNodeById: (node: CodexNode, targetId: string) => CodexNode | null;
}
