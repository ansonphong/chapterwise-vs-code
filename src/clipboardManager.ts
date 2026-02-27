/**
 * Clipboard Manager - Cut/paste state for tree operations
 *
 * Manages a single cut entry for node operations.
 * Fires onDidChange event when state changes (for tree refresh).
 */

import * as vscode from 'vscode';
import { PathSegment } from './codexModel';

export interface ClipboardEntry {
  nodeId: string;
  nodeType: string;
  nodeName: string;
  sourceUri: vscode.Uri;
  sourcePath: PathSegment[];
  isFileBacked: boolean;
  filePath?: string;
}

export class ClipboardManager implements vscode.Disposable {
  private _cutEntry: ClipboardEntry | undefined;
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  cut(entry: ClipboardEntry): void {
    this._cutEntry = entry;
    this._onDidChange.fire();
  }

  getCutEntry(): ClipboardEntry | undefined {
    return this._cutEntry;
  }

  isCut(nodeId: string): boolean {
    return this._cutEntry?.nodeId === nodeId;
  }

  clear(): void {
    this._cutEntry = undefined;
    this._onDidChange.fire();
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
