import { describe, it, expect } from 'vitest';
import { CodexStructureEditor } from './structureEditor';

describe('CodexStructureEditor', () => {
  describe('buildYamlPath', () => {
    const editor = new CodexStructureEditor();
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
});
