import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ColorManager } from './colorManager';
import type { CodexNode } from './codexModel';
import type { NavigatorSettings } from './settingsManager';

function makeNode(overrides: Partial<CodexNode> = {}): CodexNode {
  return {
    id: 'test-1', type: 'chapter', name: 'Test', proseField: 'body',
    proseValue: '', availableFields: ['body'], path: ['children', 0],
    children: [], hasAttributes: false, hasContentSections: false, hasImages: false,
    ...overrides,
  };
}

describe('getNodeColor', () => {
  let cm: ColorManager;
  beforeEach(() => { cm = new ColorManager(); });

  it('returns valid hex color string', () => {
    const node = makeNode({ attributes: [{ key: 'color', value: '#EF4444' }], hasAttributes: true });
    expect(cm.getNodeColor(node)).toBe('#EF4444');
  });

  it('returns null for non-string value (number)', () => {
    const node = makeNode({ attributes: [{ key: 'color', value: 42 }], hasAttributes: true });
    expect(cm.getNodeColor(node)).toBeNull();
  });

  it('returns null for non-string value (boolean)', () => {
    const node = makeNode({ attributes: [{ key: 'color', value: true }], hasAttributes: true });
    expect(cm.getNodeColor(node)).toBeNull();
  });

  it('returns null for invalid hex (missing hash)', () => {
    const node = makeNode({ attributes: [{ key: 'color', value: 'EF4444' }], hasAttributes: true });
    expect(cm.getNodeColor(node)).toBeNull();
  });

  it('returns null for invalid hex (named color)', () => {
    const node = makeNode({ attributes: [{ key: 'color', value: 'red' }], hasAttributes: true });
    expect(cm.getNodeColor(node)).toBeNull();
  });

  it('returns null when no attributes', () => {
    expect(cm.getNodeColor(makeNode())).toBeNull();
  });

  it('returns null when no color attribute', () => {
    const node = makeNode({ attributes: [{ key: 'genre', value: 'Fantasy' }], hasAttributes: true });
    expect(cm.getNodeColor(node)).toBeNull();
  });
});

describe('updateNodeColor', () => {
  let cm: ColorManager;
  beforeEach(() => { cm = new ColorManager(); vi.clearAllMocks(); });

  it('rejects invalid color string', async () => {
    const node = makeNode({ path: [] });
    const doc = { getText: () => 'id: test\ntype: chapter', uri: { fsPath: '/t.yaml' }, lineCount: 2, save: vi.fn() } as any;
    expect(await cm.updateNodeColor(node, doc, 'not-a-color')).toBe(false);
  });

  it('rejects script injection', async () => {
    const node = makeNode({ path: [] });
    const doc = { getText: () => 'id: test\ntype: chapter', uri: { fsPath: '/t.yaml' }, lineCount: 2, save: vi.fn() } as any;
    expect(await cm.updateNodeColor(node, doc, '<script>alert(1)</script>')).toBe(false);
  });

  it('accepts null (remove color) when no attributes exist', async () => {
    const node = makeNode({ path: [] });
    const yaml = 'id: test\ntype: chapter\nname: Test';
    const doc = { getText: () => yaml, uri: { fsPath: '/t.yaml' }, lineCount: 3, save: vi.fn().mockResolvedValue(true) } as any;
    const vscode = await import('vscode');
    vi.mocked(vscode.workspace.applyEdit).mockResolvedValue(true);
    expect(await cm.updateNodeColor(node, doc, null)).toBe(true);
  });

  it('accepts valid hex color', async () => {
    const node = makeNode({ path: [] });
    const yaml = 'id: test\ntype: chapter\nname: Test';
    const doc = { getText: () => yaml, uri: { fsPath: '/t.yaml' }, lineCount: 3, save: vi.fn().mockResolvedValue(true) } as any;
    const vscode = await import('vscode');
    vi.mocked(vscode.workspace.applyEdit).mockResolvedValue(true);
    expect(await cm.updateNodeColor(node, doc, '#3B82F6')).toBe(true);
  });
});

describe('buildYamlPath', () => {
  let cm: ColorManager;
  beforeEach(() => { cm = new ColorManager(); });

  it('does not double-wrap children segments', () => {
    const result = (cm as any).buildYamlPath(['children', 0, 'children', 1]);
    expect(result).toEqual(['children', 0, 'children', 1]);
  });

  it('handles empty path (root node)', () => {
    expect((cm as any).buildYamlPath([])).toEqual([]);
  });

  it('handles single-level path', () => {
    expect((cm as any).buildYamlPath(['children', 0])).toEqual(['children', 0]);
  });

  it('handles deep path', () => {
    const input = ['children', 0, 'children', 2, 'children', 5];
    expect((cm as any).buildYamlPath(input)).toEqual(input);
  });
});

function makeSettings(colorOverrides: Partial<NavigatorSettings['colors']> = {}): NavigatorSettings {
  return {
    defaultChildMode: 'ask',
    fileOrganization: { strategy: 'organized', dataFolderPath: 'Files/Data', useUuidFilenames: false },
    naming: { slugify: true, preserveCase: false, separator: '-', includeType: false, includeParent: false },
    includes: { preferRelative: true, format: 'string' },
    automation: { autoGenerateIds: true, autoGenerateIndex: true, autoSort: false, autoSave: true },
    safety: { confirmDelete: true, confirmMove: false, validateOnSave: true, backupBeforeDestruct: true },
    colors: { inheritFromParent: false, showInheritedDimmed: true, defaultColors: {}, ...colorOverrides },
  };
}

describe('getEffectiveColor', () => {
  let cm: ColorManager;
  beforeEach(() => { cm = new ColorManager(); });

  it('returns own color', () => {
    const node = makeNode({ attributes: [{ key: 'color', value: '#EF4444' }], hasAttributes: true });
    expect(cm.getEffectiveColor(node, makeSettings())).toEqual({ color: '#EF4444', inherited: false });
  });

  it('inherits from parent', () => {
    const parent = makeNode({ attributes: [{ key: 'color', value: '#10B981' }], hasAttributes: true });
    const child = makeNode({ parent });
    expect(cm.getEffectiveColor(child, makeSettings({ inheritFromParent: true }))).toEqual({ color: '#10B981', inherited: true });
  });

  it('inherits from grandparent', () => {
    const gp = makeNode({ attributes: [{ key: 'color', value: '#3B82F6' }], hasAttributes: true });
    const parent = makeNode({ parent: gp });
    const child = makeNode({ parent });
    expect(cm.getEffectiveColor(child, makeSettings({ inheritFromParent: true }))).toEqual({ color: '#3B82F6', inherited: true });
  });

  it('returns default color for type (when inheritance enabled)', () => {
    const node = makeNode({ type: 'chapter' });
    expect(cm.getEffectiveColor(node, makeSettings({ inheritFromParent: true, defaultColors: { chapter: '#3B82F6' } }))).toEqual({ color: '#3B82F6', inherited: false });
  });

  it('returns null when nothing matches', () => {
    expect(cm.getEffectiveColor(makeNode(), makeSettings())).toEqual({ color: null, inherited: false });
  });
});

describe('updateNodeColor - save failures', () => {
  let cm: ColorManager;
  beforeEach(() => { cm = new ColorManager(); vi.clearAllMocks(); });

  it('returns false when applyEdit fails', async () => {
    const node = makeNode({ path: [] });
    const doc = { getText: () => 'id: test\ntype: chapter\nname: T', uri: { fsPath: '/t.yaml' }, lineCount: 3, save: vi.fn() } as any;
    const vscode = await import('vscode');
    vi.mocked(vscode.workspace.applyEdit).mockResolvedValue(false);
    expect(await cm.updateNodeColor(node, doc, '#EF4444')).toBe(false);
  });

  it('returns false when save throws', async () => {
    const node = makeNode({ path: [] });
    const doc = { getText: () => 'id: test\ntype: chapter\nname: T', uri: { fsPath: '/t.yaml' }, lineCount: 3, save: vi.fn().mockRejectedValue(new Error('read-only')) } as any;
    const vscode = await import('vscode');
    vi.mocked(vscode.workspace.applyEdit).mockResolvedValue(true);
    expect(await cm.updateNodeColor(node, doc, '#EF4444')).toBe(false);
  });
});
