import { vi } from 'vitest';

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export const window = {
  showQuickPick: vi.fn(),
  showInputBox: vi.fn(),
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  setStatusBarMessage: vi.fn(),
};

export const workspace = {
  applyEdit: vi.fn().mockResolvedValue(true),
  openTextDocument: vi.fn().mockResolvedValue({ getText: () => '', uri: { fsPath: '' } }),
  fs: {
    stat: vi.fn().mockResolvedValue({ type: FileType.File, size: 0, ctime: 0, mtime: 0 }),
    delete: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(new Uint8Array()),
    writeFile: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(undefined),
    createDirectory: vi.fn().mockResolvedValue(undefined),
  },
};

export class WorkspaceEdit {
  private _edits: Array<{ uri: any; range: any; newText: string }> = [];
  replace(uri: any, range: any, newText: string) {
    this._edits.push({ uri, range, newText });
  }
}

export class Range {
  constructor(
    public startLine: number,
    public startChar: number,
    public endLine: number,
    public endChar: number
  ) {}
}

export class ThemeIcon {
  constructor(public id: string, public color?: ThemeColor) {}
}

export class ThemeColor {
  constructor(public id: string) {}
}

export class Uri {
  static file(p: string) { return { fsPath: p, scheme: 'file', path: p }; }
  static parse(s: string) { return { fsPath: s, scheme: 'file', path: s }; }
}

export class Position {
  constructor(public line: number, public character: number) {}
}

export class Selection {
  constructor(public anchor: Position, public active: Position) {}
}

export class EventEmitter<T = void> {
  private listeners: Array<(e: T) => void> = [];
  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
  };
  fire(data?: T) {
    this.listeners.forEach(l => l(data as T));
  }
  dispose() {
    this.listeners = [];
  }
}

export const env = {
  clipboard: {
    writeText: vi.fn(),
    readText: vi.fn().mockResolvedValue(''),
  },
};

export const commands = {
  executeCommand: vi.fn(),
  registerCommand: vi.fn(),
};
