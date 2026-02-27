import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClipboardManager } from './clipboardManager';
import { Uri } from 'vscode';

describe('ClipboardManager', () => {
  let cm: ClipboardManager;

  const mockEntry = {
    nodeId: 'abc-123',
    nodeType: 'scene',
    nodeName: 'Test Scene',
    sourceUri: Uri.file('/test/file.codex.yaml'),
    sourcePath: ['children', 0] as any[],
    isFileBacked: false,
  };

  beforeEach(() => {
    cm = new ClipboardManager();
  });

  it('cut stores entry', () => {
    cm.cut(mockEntry);
    expect(cm.getCutEntry()).toEqual(mockEntry);
  });

  it('isCut returns true for cut node', () => {
    cm.cut(mockEntry);
    expect(cm.isCut('abc-123')).toBe(true);
  });

  it('isCut returns false for different node', () => {
    cm.cut(mockEntry);
    expect(cm.isCut('xyz-789')).toBe(false);
  });

  it('isCut returns false when nothing is cut', () => {
    expect(cm.isCut('abc-123')).toBe(false);
  });

  it('clear removes cut entry', () => {
    cm.cut(mockEntry);
    cm.clear();
    expect(cm.getCutEntry()).toBeUndefined();
  });

  it('second cut replaces first entry', () => {
    cm.cut(mockEntry);
    const second = { ...mockEntry, nodeId: 'def-456', nodeName: 'Second' };
    cm.cut(second);
    expect(cm.getCutEntry()?.nodeId).toBe('def-456');
    expect(cm.isCut('abc-123')).toBe(false);
  });

  it('onDidChange fires on cut', () => {
    const listener = vi.fn();
    cm.onDidChange(listener);
    cm.cut(mockEntry);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('onDidChange fires on clear', () => {
    const listener = vi.fn();
    cm.onDidChange(listener);
    cm.cut(mockEntry);
    cm.clear();
    expect(listener).toHaveBeenCalledTimes(2); // Once for cut, once for clear
  });

  it('dispose cleans up', () => {
    const listener = vi.fn();
    cm.onDidChange(listener);
    cm.dispose();
    // After dispose, fire should not reach listener
    (cm as any)._onDidChange.fire();
    expect(listener).not.toHaveBeenCalled();
  });
});
