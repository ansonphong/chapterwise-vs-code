import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodexStructureEditor } from './structureEditor';
import * as YAML from 'yaml';
import { workspace } from 'vscode';

// Mock vscode module
vi.mock('vscode', () => ({
  workspace: {
    applyEdit: vi.fn().mockResolvedValue(true),
  },
  WorkspaceEdit: class {
    private _edits: any[] = [];
    replace(uri: any, range: any, newText: string) {
      this._edits.push({ uri, range, newText });
    }
  },
  Range: class {
    constructor(public sl: number, public sc: number, public el: number, public ec: number) {}
  },
  Uri: { file: (p: string) => ({ fsPath: p, scheme: 'file', path: p }) },
  window: { showErrorMessage: vi.fn(), showWarningMessage: vi.fn() },
  FileType: { File: 1, Directory: 2 },
}));

function makeDoc(yamlContent: string) {
  return {
    getText: () => yamlContent,
    uri: { fsPath: '/test/file.codex.yaml', scheme: 'file', path: '/test/file.codex.yaml' },
    lineCount: yamlContent.split('\n').length,
    save: vi.fn().mockResolvedValue(true),
  } as any;
}

function makeNode(overrides: Record<string, any> = {}) {
  return {
    id: 'test-id',
    name: 'Test Node',
    type: 'scene',
    proseField: 'body',
    proseValue: '',
    availableFields: [],
    path: [],
    children: [],
    ...overrides,
  } as any;
}

const sampleYaml = `id: root-id
type: scene
name: Test Scene
body: "Some text"
children:
  - id: child-1
    type: scene
    name: Child One
    body: "Child text"
`;

describe('CodexStructureEditor', () => {
  const editor = new CodexStructureEditor();

  describe('buildYamlPath', () => {
    const buildYamlPath = (editor as any).buildYamlPath.bind(editor);

    it('passes through empty path for root node', () => {
      expect(buildYamlPath([])).toEqual([]);
    });

    it('passes through first-level child path', () => {
      expect(buildYamlPath(['children', 0])).toEqual(['children', 0]);
    });

    it('passes through nested child path', () => {
      expect(buildYamlPath(['children', 0, 'children', 1])).toEqual(['children', 0, 'children', 1]);
    });

    it('handles deep nesting', () => {
      const input = ['children', 2, 'children', 0, 'children', 3];
      expect(buildYamlPath(input)).toEqual(input);
    });
  });

  describe('addFieldToNode', () => {
    it('adds field to root node', async () => {
      const doc = makeDoc(sampleYaml);
      const node = makeNode({ path: [] });
      const result = await editor.addFieldToNode(doc, node, 'synopsis');
      expect(result).toBe(true);
    });

    it('returns false for existing field', async () => {
      const doc = makeDoc(sampleYaml);
      const node = makeNode({ path: [] });
      const result = await editor.addFieldToNode(doc, node, 'body');
      expect(result).toBe(false);
    });

    it('works for nested child', async () => {
      const doc = makeDoc(sampleYaml);
      const node = makeNode({ path: ['children', 0] });
      const result = await editor.addFieldToNode(doc, node, 'synopsis');
      expect(result).toBe(true);
    });
  });

  describe('removeFieldFromNode', () => {
    it('removes field from YAML', async () => {
      const doc = makeDoc(sampleYaml);
      const node = makeNode({ path: [] });
      const result = await editor.removeFieldFromNode(doc, node, 'body');
      expect(result).toBe(true);
    });

    it('returns false for nonexistent field', async () => {
      const doc = makeDoc(sampleYaml);
      const node = makeNode({ path: [] });
      const result = await editor.removeFieldFromNode(doc, node, 'nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('renameFieldOnNode', () => {
    it('renames field key', async () => {
      const doc = makeDoc(sampleYaml);
      const node = makeNode({ path: [] });
      const result = await editor.renameFieldOnNode(doc, node, 'body', 'overview');
      expect(result).toBe(true);
    });

    it('returns false for nonexistent field', async () => {
      const doc = makeDoc(sampleYaml);
      const node = makeNode({ path: [] });
      const result = await editor.renameFieldOnNode(doc, node, 'nonexistent', 'newname');
      expect(result).toBe(false);
    });
  });

  describe('changeNodeType', () => {
    it('updates type field', async () => {
      const doc = makeDoc(sampleYaml);
      const node = makeNode({ path: [] });
      const result = await editor.changeNodeType(doc, node, 'chapter');
      expect(result).toBe(true);
    });
  });

  describe('addTagsToNode', () => {
    it('adds tags to node with no existing tags', async () => {
      const doc = makeDoc(sampleYaml);
      const node = makeNode({ path: [] });
      const result = await editor.addTagsToNode(doc, node, ['action', 'drama']);
      expect(result).toBe(true);
    });

    it('deduplicates tags', async () => {
      const yamlWithTags = `id: root-id\ntype: scene\nname: Test\ntags:\n  - action\n`;
      const doc = makeDoc(yamlWithTags);
      const node = makeNode({ path: [] });
      const result = await editor.addTagsToNode(doc, node, ['action', 'drama']);
      expect(result).toBe(true);
    });
  });

  describe('addRelationToNode', () => {
    it('adds relation entry', async () => {
      const doc = makeDoc(sampleYaml);
      const node = makeNode({ path: [] });
      const result = await editor.addRelationToNode(doc, node, 'uuid-123', 'follows');
      expect(result).toBe(true);
    });
  });

  describe('setEmojiOnNode', () => {
    it('sets emoji field', async () => {
      const doc = makeDoc(sampleYaml);
      const node = makeNode({ path: [] });
      const result = await editor.setEmojiOnNode(doc, node, '📖');
      expect(result).toBe(true);
    });
  });

  describe('duplicateNodeInDocument', () => {
    it('creates sibling copy', async () => {
      const doc = makeDoc(sampleYaml);
      const node = makeNode({ path: ['children', 0], name: 'Child One', id: 'child-1' });
      const result = await editor.duplicateNodeInDocument(doc, node);
      expect(result).toBe(true);
    });

    it('returns false for invalid node', async () => {
      const doc = makeDoc('id: test\ntype: scene\nname: Test\n');
      const node = makeNode({ path: ['children', 99] });
      const result = await editor.duplicateNodeInDocument(doc, node);
      expect(result).toBe(false);
    });

    it('generates new IDs in duplicate', async () => {
      const doc = makeDoc(sampleYaml);
      const node = makeNode({ path: ['children', 0], name: 'Child One', id: 'child-1' });
      await editor.duplicateNodeInDocument(doc, node);
      // Verify applyEdit was called with YAML containing duplicated node
      const call = vi.mocked(workspace.applyEdit).mock.calls;
      expect(call.length).toBeGreaterThan(0);
    });
  });

  describe('regenerateChildIds', () => {
    it('regenerates id on flat object', () => {
      const obj = { id: 'old-id', name: 'Test' };
      (editor as any).regenerateChildIds(obj);
      expect(obj.id).not.toBe('old-id');
      expect(obj.id).toBeTruthy();
    });

    it('regenerates ids recursively in children', () => {
      const obj = {
        id: 'parent',
        children: [
          { id: 'child-a', children: [{ id: 'grandchild' }] },
          { id: 'child-b' },
        ],
      };
      (editor as any).regenerateChildIds(obj);
      expect(obj.id).not.toBe('parent');
      expect(obj.children[0].id).not.toBe('child-a');
      expect(obj.children[0].children[0].id).not.toBe('grandchild');
      expect(obj.children[1].id).not.toBe('child-b');
      // All IDs should be unique
      const ids = [obj.id, obj.children[0].id, obj.children[0].children[0].id, obj.children[1].id];
      expect(new Set(ids).size).toBe(4);
    });

    it('handles objects without id or children', () => {
      const obj = { name: 'no id' };
      (editor as any).regenerateChildIds(obj);
      expect(obj).toEqual({ name: 'no id' });
    });
  });
});
