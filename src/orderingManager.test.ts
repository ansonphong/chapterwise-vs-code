import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrderingManager, OrderIndex, OrderEntry } from './orderingManager';

// Mock fs module
vi.mock('fs', () => {
  const mockFs: Record<string, string> = {};
  return {
    default: {
      promises: {
        readFile: vi.fn(async (filePath: string) => {
          if (mockFs[filePath]) return mockFs[filePath];
          throw new Error(`ENOENT: ${filePath}`);
        }),
        writeFile: vi.fn(async (filePath: string, content: string) => {
          mockFs[filePath] = content;
        }),
        readdir: vi.fn(async () => []),
        access: vi.fn(async () => {}),
      },
    },
    promises: {
      readFile: vi.fn(async (filePath: string) => {
        if (mockFs[filePath]) return mockFs[filePath];
        throw new Error(`ENOENT: ${filePath}`);
      }),
      writeFile: vi.fn(async (filePath: string, content: string) => {
        mockFs[filePath] = content;
      }),
      readdir: vi.fn(async () => []),
      access: vi.fn(async () => {}),
    },
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ''),
    writeFileSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    _mockFs: mockFs,
  };
});

const fs = await import('fs');
const mockFs = (fs as any)._mockFs as Record<string, string>;
const YAML = await import('yaml');

describe('OrderingManager', () => {
  let om: OrderingManager;
  const wsRoot = '/test/workspace';
  const indexPath = `${wsRoot}/index.codex.yaml`;

  const sampleIndex: OrderIndex = {
    metadata: { formatVersion: '1.0' },
    children: [
      { name: 'chapter-01.codex.yaml', type: 'file' },
      { name: 'chapter-02.codex.yaml', type: 'file' },
      { name: 'chapter-03.codex.yaml', type: 'file' },
      {
        name: 'Chapters',
        type: 'folder',
        children: [
          { name: 'scene-01.codex.yaml', type: 'file' },
          { name: 'scene-02.codex.yaml', type: 'file' },
        ],
      },
      {
        name: 'Archive',
        type: 'folder',
        children: [],
      },
    ],
  };

  beforeEach(() => {
    // Clear mock fs
    for (const key of Object.keys(mockFs)) {
      delete mockFs[key];
    }
    // Set up default index content
    mockFs[indexPath] = YAML.default.stringify(sampleIndex);
    om = new OrderingManager(wsRoot);
  });

  describe('findFolderChildren', () => {
    it('returns root children for empty path', () => {
      const children = om.findFolderChildren(sampleIndex, '');
      expect(children).toHaveLength(5);
      expect(children[0].name).toBe('chapter-01.codex.yaml');
    });

    it('returns root children for "." path', () => {
      const children = om.findFolderChildren(sampleIndex, '.');
      expect(children).toHaveLength(5);
    });

    it('returns children of nested folder', () => {
      const children = om.findFolderChildren(sampleIndex, 'Chapters');
      expect(children).toHaveLength(2);
      expect(children[0].name).toBe('scene-01.codex.yaml');
    });

    it('returns empty array for nonexistent folder', () => {
      const children = om.findFolderChildren(sampleIndex, 'nonexistent');
      expect(children).toEqual([]);
    });
  });

  describe('moveUp', () => {
    it('swaps with previous sibling', async () => {
      const result = await om.moveUp('', 'chapter-02.codex.yaml');
      expect(result).toBe(true);

      const index = await om.readIndex();
      expect(index!.children[0].name).toBe('chapter-02.codex.yaml');
      expect(index!.children[1].name).toBe('chapter-01.codex.yaml');
    });

    it('returns false for first item', async () => {
      const result = await om.moveUp('', 'chapter-01.codex.yaml');
      expect(result).toBe(false);
    });

    it('returns false for nonexistent item', async () => {
      const result = await om.moveUp('', 'nonexistent.codex.yaml');
      expect(result).toBe(false);
    });
  });

  describe('moveDown', () => {
    it('swaps with next sibling', async () => {
      const result = await om.moveDown('', 'chapter-01.codex.yaml');
      expect(result).toBe(true);

      const index = await om.readIndex();
      expect(index!.children[0].name).toBe('chapter-02.codex.yaml');
      expect(index!.children[1].name).toBe('chapter-01.codex.yaml');
    });

    it('returns false for last item', async () => {
      const result = await om.moveDown('', 'Archive');
      expect(result).toBe(false);
    });
  });

  describe('moveToPosition', () => {
    it('moves item to specific index', async () => {
      const result = await om.moveToPosition('', 'chapter-01.codex.yaml', 2);
      expect(result).toBe(true);

      const index = await om.readIndex();
      expect(index!.children[0].name).toBe('chapter-02.codex.yaml');
      expect(index!.children[1].name).toBe('chapter-03.codex.yaml');
      expect(index!.children[2].name).toBe('chapter-01.codex.yaml');
    });

    it('clamps to valid range', async () => {
      const result = await om.moveToPosition('', 'chapter-01.codex.yaml', 100);
      expect(result).toBe(true);

      const index = await om.readIndex();
      // Should be at the end
      expect(index!.children[index!.children.length - 1].name).toBe('chapter-01.codex.yaml');
    });
  });

  describe('moveToFolder', () => {
    it('moves item from root to subfolder', async () => {
      const result = await om.moveToFolder('chapter-03.codex.yaml', 'Archive');
      expect(result).toBe(true);

      const index = await om.readIndex();
      // Should be removed from root
      expect(index!.children.find(c => c.name === 'chapter-03.codex.yaml')).toBeUndefined();
      // Should be in Archive
      const archive = index!.children.find(c => c.name === 'Archive');
      expect(archive!.children).toHaveLength(1);
      expect(archive!.children![0].name).toBe('chapter-03.codex.yaml');
    });
  });

  describe('addEntry', () => {
    it('adds entry to root', async () => {
      await om.addEntry('', { name: 'new.codex.yaml', type: 'file' });
      const index = await om.readIndex();
      expect(index!.children.find(c => c.name === 'new.codex.yaml')).toBeDefined();
    });

    it('adds entry to subfolder', async () => {
      await om.addEntry('Chapters', { name: 'scene-03.codex.yaml', type: 'file' });
      const index = await om.readIndex();
      const chapters = index!.children.find(c => c.name === 'Chapters');
      expect(chapters!.children).toHaveLength(3);
    });
  });

  describe('removeEntry', () => {
    it('removes entry from root', async () => {
      const result = await om.removeEntry('', 'chapter-03.codex.yaml');
      expect(result).toBe(true);
      const index = await om.readIndex();
      expect(index!.children.find(c => c.name === 'chapter-03.codex.yaml')).toBeUndefined();
    });

    it('returns false for nonexistent entry', async () => {
      const result = await om.removeEntry('', 'nonexistent.codex.yaml');
      expect(result).toBe(false);
    });
  });
});
