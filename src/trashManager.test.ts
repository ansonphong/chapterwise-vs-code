import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TrashManager } from './trashManager';

// Mock fs module
vi.mock('fs', () => {
  const mockFiles: Record<string, string> = {};
  const mockDirs: Set<string> = new Set();

  return {
    default: {
      promises: {
        mkdir: vi.fn(async (dirPath: string) => { mockDirs.add(dirPath); }),
        rename: vi.fn(async (src: string, dest: string) => {
          if (mockFiles[src]) {
            mockFiles[dest] = mockFiles[src];
            delete mockFiles[src];
          }
        }),
        access: vi.fn(async (filePath: string) => {
          if (!mockDirs.has(filePath) && !mockFiles[filePath]) {
            throw new Error('ENOENT');
          }
        }),
        readdir: vi.fn(async () => []),
        rm: vi.fn(async () => {}),
        readFile: vi.fn(async (filePath: string) => {
          if (mockFiles[filePath]) return mockFiles[filePath];
          throw new Error('ENOENT');
        }),
        writeFile: vi.fn(async (filePath: string, content: string) => {
          mockFiles[filePath] = content;
        }),
        stat: vi.fn(async () => ({ mtime: new Date() })),
      },
    },
    promises: {
      mkdir: vi.fn(async (dirPath: string) => { mockDirs.add(dirPath); }),
      rename: vi.fn(async (src: string, dest: string) => {
        if (mockFiles[src]) {
          mockFiles[dest] = mockFiles[src];
          delete mockFiles[src];
        }
      }),
      access: vi.fn(async (filePath: string) => {
        if (!mockDirs.has(filePath) && !mockFiles[filePath]) {
          throw new Error('ENOENT');
        }
      }),
      readdir: vi.fn(async () => []),
      rm: vi.fn(async () => {}),
      readFile: vi.fn(async (filePath: string) => {
        if (mockFiles[filePath]) return mockFiles[filePath];
        throw new Error('ENOENT');
      }),
      writeFile: vi.fn(async (filePath: string, content: string) => {
        mockFiles[filePath] = content;
      }),
      stat: vi.fn(async () => ({ mtime: new Date() })),
    },
    _mockFiles: mockFiles,
    _mockDirs: mockDirs,
  };
});

const fs = await import('fs');
const mockFiles = (fs as any)._mockFiles as Record<string, string>;
const mockDirs = (fs as any)._mockDirs as Set<string>;

describe('TrashManager', () => {
  const wsRoot = '/test/workspace';
  let tm: TrashManager;

  beforeEach(() => {
    for (const key of Object.keys(mockFiles)) delete mockFiles[key];
    mockDirs.clear();
    vi.clearAllMocks();
    tm = new TrashManager(wsRoot);
  });

  it('trashPath returns correct path', () => {
    expect(tm.trashPath).toBe('/test/workspace/.chapterwise/trash');
  });

  it('getTrashDestination preserves relative path', () => {
    expect(tm.getTrashDestination('chapters/ch1.codex.yaml'))
      .toBe('/test/workspace/.chapterwise/trash/chapters/ch1.codex.yaml');
  });

  it('moveToTrash creates dir and renames file', async () => {
    mockFiles['/test/workspace/chapters/ch1.codex.yaml'] = 'content';
    await tm.moveToTrash('chapters/ch1.codex.yaml');

    expect(fs.promises.mkdir).toHaveBeenCalledWith(
      '/test/workspace/.chapterwise/trash/chapters',
      { recursive: true }
    );
    expect(fs.promises.rename).toHaveBeenCalledWith(
      '/test/workspace/chapters/ch1.codex.yaml',
      '/test/workspace/.chapterwise/trash/chapters/ch1.codex.yaml'
    );
  });

  it('moveToTrash calls ensureGitignore', async () => {
    mockFiles['/test/workspace/chapters/ch1.codex.yaml'] = 'content';
    await tm.moveToTrash('chapters/ch1.codex.yaml');

    // Should have written .gitignore with the trash line
    expect(fs.promises.writeFile).toHaveBeenCalled();
    const writeCall = (fs.promises.writeFile as any).mock.calls.find(
      (c: any[]) => c[0] === '/test/workspace/.gitignore'
    );
    expect(writeCall).toBeDefined();
    expect(writeCall[1]).toContain('.chapterwise/trash/');
  });

  it('restoreFromTrash moves file back', async () => {
    await tm.restoreFromTrash('chapters/ch1.codex.yaml');

    expect(fs.promises.mkdir).toHaveBeenCalledWith(
      '/test/workspace/chapters',
      { recursive: true }
    );
    expect(fs.promises.rename).toHaveBeenCalledWith(
      '/test/workspace/.chapterwise/trash/chapters/ch1.codex.yaml',
      '/test/workspace/chapters/ch1.codex.yaml'
    );
  });

  it('listTrash returns empty when trash does not exist', async () => {
    const result = await tm.listTrash();
    expect(result).toEqual([]);
  });

  it('emptyTrash removes directory recursively', async () => {
    await tm.emptyTrash();
    expect(fs.promises.rm).toHaveBeenCalledWith(
      '/test/workspace/.chapterwise/trash',
      { recursive: true, force: true }
    );
  });

  it('hasTrash returns false when dir does not exist', async () => {
    const result = await tm.hasTrash();
    expect(result).toBe(false);
  });

  describe('ensureGitignore', () => {
    it('creates .gitignore if missing', async () => {
      await tm.ensureGitignore();
      expect(mockFiles['/test/workspace/.gitignore']).toContain('.chapterwise/trash/');
    });

    it('appends line if not present', async () => {
      mockFiles['/test/workspace/.gitignore'] = 'node_modules/\n';
      await tm.ensureGitignore();
      expect(mockFiles['/test/workspace/.gitignore']).toContain('.chapterwise/trash/');
      expect(mockFiles['/test/workspace/.gitignore']).toContain('node_modules/');
    });

    it('skips if line already present', async () => {
      mockFiles['/test/workspace/.gitignore'] = '.chapterwise/trash/\n';
      await tm.ensureGitignore();
      // writeFile should not be called since line exists
      // (readFile is called to check, but writeFile skipped)
      const writeCalls = (fs.promises.writeFile as any).mock.calls.filter(
        (c: any[]) => c[0] === '/test/workspace/.gitignore'
      );
      expect(writeCalls).toHaveLength(0);
    });
  });
});
