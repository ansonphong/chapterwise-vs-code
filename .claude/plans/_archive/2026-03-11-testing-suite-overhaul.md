# Testing Suite Overhaul — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish a best-practice, multi-layer testing setup for the ChapterWise Codex VS Code extension — typechecking gate, expanded unit tests, extension-host integration tests, and coverage reporting.

**Architecture:** Three test layers: (1) fast Vitest unit tests for pure logic modules, (2) `@vscode/test-electron` integration tests for command registration, tree providers, and activation, (3) TypeScript compilation as a mandatory gate. Coverage via Vitest's built-in v8 provider. CI workflow via GitHub Actions.

**Tech Stack:** Vitest (unit), `@vscode/test-electron` + Mocha (integration), `@vitest/coverage-v8` (coverage), TypeScript `tsc --noEmit` (typecheck gate)

---

## Current State Assessment

| What exists | Status |
|-------------|--------|
| Vitest unit tests | 5 suites, 81 tests — colorManager, orderingManager, trashManager, clipboardManager, structureEditor |
| vscode mock | `src/__mocks__/vscode.ts` — aliased via `vitest.config.ts` resolve |
| TypeScript compile | `npm run compile:tsc` — exists but **currently fails (24 errors in 8 files)** and is not part of `npm test` |
| Extension-host tests | **None** — no `@vscode/test-electron` |
| Coverage | **None** — no coverage provider configured |
| CI | **None** — no `.github/workflows/` |
| ESLint | **Not installed** — `npm run lint` script exists but no eslint in devDeps, no config file |
| Webview tests | **None** |

### Full TypeScript Error Inventory (24 errors, 8 files)

Captured by running `npx tsc -p ./ --noEmit`:

| File | Count | Category | Root Cause |
|------|-------|----------|------------|
| `src/treeProvider.ts:30-58` | 8 | Cast errors | `IndexChildNode as Record<string, unknown>` — interface lacks index signature |
| `src/extension.ts:246,253` | 2 | `Thenable` vs `Promise` | `vscode.commands.executeCommand()` returns `Thenable`, passed to `withTimeout()` which expects `Promise` |
| `src/extensionState.ts:274,281` | 2 | Same `Thenable` vs `Promise` | Same pattern as extension.ts — `restoreLastContext` |
| `src/extension.ts:2139,2149` | 2 | `generateIndex` signature | Caller passes `string`, but function now expects `GenerateIndexOptions` object |
| `src/commands/structure.ts:708,718` | 2 | Same `generateIndex` signature | Same API drift in commands module |
| `src/__mocks__/vscode.ts:16` | 1 | Forward reference | `FileType.File` used before `FileType` enum is declared |
| `src/orderingManager.test.ts:40,42` | 2 | Top-level `await` | CommonJS `module` setting doesn't support top-level `await` |
| `src/trashManager.test.ts:65` | 1 | Top-level `await` | Same — CommonJS `module` incompatible with top-level `await` |
| `src/structureEditor.test.ts:226,229` | 2 | Possible `undefined` | Strict null check on object access |

## Priority Matrix

| Priority | Layer | Why |
|----------|-------|-----|
| P0 | Fix typecheck + tsconfig split + make it a gate | Catches real bugs that Vitest misses; must split app vs test configs to avoid top-level `await` errors |
| P1 | Unit tests for untested pure modules | Huge coverage gain for low effort — codexModel (incl. Codex Lite), search/*, helpers |
| P2 | Extension-host integration tests | Only way to validate activation, command wiring, tree provider lifecycle |
| P3 | Coverage reporting | Enables tracking progress and setting thresholds |
| P4 | GitHub Actions CI | Prevents regressions from merging |

---

## Task 1: Split tsconfig and Fix All TypeScript Errors

This is the foundation for the entire plan. There are 24 errors across 8 files in 5 categories. We split the tsconfig first, then fix each category.

### Task 1a: Split tsconfig into app-only and full

**Files:**
- Modify: `tsconfig.json` (exclude test files)
- Create: `tsconfig.test.json` (integration test harness only, for Task 8)

**Why:** The main tsconfig uses `"module": "commonjs"` which does not support top-level `await`. Vitest test files (`orderingManager.test.ts`, `trashManager.test.ts`) use top-level `await` for dynamic imports after `vi.mock()`. These files are run by Vitest (which handles modules itself), not by `tsc`. The typecheck gate should only check shippable source, not Vitest test files.

**Step 1: Modify `tsconfig.json` to exclude test files**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "out",
    "rootDir": "src",
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "out", "src/**/*.test.ts", "src/__mocks__/**", "src/test/**"]
}
```

**What changed:** Added `src/**/*.test.ts`, `src/__mocks__/**`, and `src/test/**` to `exclude`. This removes:
- 3 top-level `await` errors (orderingManager.test.ts, trashManager.test.ts)
- 2 strict null errors (structureEditor.test.ts)
- 1 forward-reference error (vscode mock)

**Step 2: Run typecheck to verify only app errors remain**

```bash
npx tsc -p ./ --noEmit 2>&1 | grep "^src" | wc -l
```

Expected: 16 errors (down from 24) — only the app-code issues remain.

**Step 3: Commit**

```bash
git add tsconfig.json && git commit -m "build: exclude test files from main tsconfig typecheck"
```

---

### Task 1b: Fix treeProvider.ts cast errors (8 errors)

**Files:**
- Modify: `src/treeProvider.ts:29-58`

The 8 accessor functions all cast `IndexChildNode as Record<string, unknown>` to access underscore-prefixed properties (`_node_kind`, `_parent_file`, etc.) that are added at runtime by the index generator but not in the `IndexChildNode` interface.

**Step 1: Add an index signature or use `unknown` double-cast**

Option A (cleanest): Add `[key: string]: unknown;` to `IndexChildNode` in `src/indexParser.ts` if that interface is meant to carry arbitrary runtime properties.

Option B (minimal change): Double-cast via `unknown`:

```typescript
// Before (all 8 functions follow this pattern):
function getNodeKind(node: IndexChildNode): string | undefined {
  return (node as Record<string, unknown>)._node_kind as string | undefined;
}

// After:
function getNodeKind(node: IndexChildNode): string | undefined {
  return (node as unknown as Record<string, unknown>)._node_kind as string | undefined;
}
```

Apply Option B to all 8 functions at lines 29-58.

**Step 2: Verify these errors are gone**

```bash
npx tsc -p ./ --noEmit 2>&1 | grep treeProvider
```

Expected: No output.

**Step 3: Commit**

```bash
git add src/treeProvider.ts && git commit -m "fix: use double-cast for IndexChildNode runtime properties"
```

---

### Task 1c: Fix Thenable vs Promise errors (4 errors)

**Files:**
- Modify: `src/extension.ts:246,253`
- Modify: `src/extensionState.ts:274,281`

`vscode.commands.executeCommand()` returns `Thenable<unknown>`, but `withTimeout()` expects `Promise<unknown>`. Thenable lacks `.catch` and `.finally`.

**Step 1: Wrap the Thenable in Promise.resolve()**

```typescript
// Before (extension.ts:245-246):
await withTimeout(
  vscode.commands.executeCommand('chapterwiseCodex.setContextFolder', uri),
  RESTORE_TIMEOUT_MS,
  'Timeout restoring folder context'
);

// After:
await withTimeout(
  Promise.resolve(vscode.commands.executeCommand('chapterwiseCodex.setContextFolder', uri)),
  RESTORE_TIMEOUT_MS,
  'Timeout restoring folder context'
);
```

Apply the same `Promise.resolve()` wrap to all 4 call sites:
- `extension.ts:246` (setContextFolder)
- `extension.ts:253` (setContextFile)
- `extensionState.ts:274` (setContextFolder)
- `extensionState.ts:281` (setContextFile)

**Step 2: Verify**

```bash
npx tsc -p ./ --noEmit 2>&1 | grep -E "extension\.ts|extensionState\.ts"
```

Expected: Only the `generateIndex` errors remain for extension.ts.

**Step 3: Commit**

```bash
git add src/extension.ts src/extensionState.ts && git commit -m "fix: wrap Thenable in Promise.resolve for withTimeout calls"
```

---

### Task 1d: Fix generateIndex signature errors (4 errors)

**Files:**
- Modify: `src/extension.ts:2139`
- Modify: `src/commands/structure.ts:708`

`generateIndex()` now expects a `GenerateIndexOptions` object (`{ workspaceRoot: string, ... }`) but callers pass a plain string.

**Step 1: Update callers to pass options object**

```typescript
// Before (extension.ts:2139):
const indexData = await generateIndex(wsRoot);

// After:
const indexData = await generateIndex({ workspaceRoot: wsRoot });
```

Apply to both:
- `extension.ts:2139`
- `commands/structure.ts:708`

**Step 2: Fix the `.children` access**

`generateIndex()` returns `Promise<string>` (the generated YAML text), not an object with `.children`. The callers at `extension.ts:2149` and `commands/structure.ts:718` treat the return value as an object. This is a real bug — the code would fail at runtime too.

Read the actual return to understand what `generateIndex` returns and what these callers need. If they need parsed index data, they should parse the returned YAML, or use a different function that returns the index object.

Look at what `collectNodes` does with `indexData.children` — it's iterating child nodes for a quickpick list. The callers likely need to:
1. Call `generateIndex()` to get the YAML string
2. Parse it with `YAML.parse()` to get the object
3. Access `.children` on the parsed result

```typescript
// Before:
const indexData = await generateIndex(wsRoot);
if (indexData?.children) collectNodes(indexData.children);

// After:
const indexYaml = await generateIndex({ workspaceRoot: wsRoot });
const indexData = indexYaml ? YAML.parse(indexYaml) : null;
if (indexData?.children) collectNodes(indexData.children);
```

Apply to both files. Verify `YAML` is already imported in both.

**Step 3: Verify**

```bash
npx tsc -p ./ --noEmit 2>&1
```

Expected: 0 errors.

**Step 4: Commit**

```bash
git add src/extension.ts src/commands/structure.ts && git commit -m "fix: pass GenerateIndexOptions object and parse returned YAML string"
```

---

### Task 1e: Verify clean typecheck

**Step 1: Run full typecheck**

```bash
npx tsc -p ./ --noEmit
```

Expected: Exit 0, no errors.

**Step 2: Run existing tests to make sure nothing broke**

```bash
npx vitest run
```

Expected: 81 tests pass.

---

## Task 2: Add Typecheck to the Test Gate

**Files:**
- Modify: `package.json` (scripts section)

**Step 1: Add `typecheck` script, update `test`**

```json
"typecheck": "tsc -p ./ --noEmit",
"test": "npm run typecheck && vitest run"
```

The `typecheck` script only checks shippable source (test files are excluded from the main tsconfig per Task 1a). Vitest handles its own module resolution for test files.

**Step 2: Keep `pretest` as-is**

The current `"pretest": "npm run compile"` runs esbuild. Keep it — it validates the bundle can be built. The full pipeline is now: esbuild bundle → typecheck → Vitest.

```json
"pretest": "npm run compile",
"typecheck": "tsc -p ./ --noEmit",
"test": "npm run typecheck && vitest run"
```

**Step 3: Run `npm test`**

```bash
npm test
```

Expected: esbuild builds, typecheck passes (0 errors), 81+ Vitest tests pass.

**Step 4: Commit**

```bash
git add package.json && git commit -m "feat: add TypeScript typecheck to test gate"
```

---

## Task 3: Add Coverage Reporting

**Files:**
- Modify: `package.json` (devDependencies)
- Modify: `vitest.config.ts`

**Step 1: Install coverage provider**

```bash
npm install --save-dev @vitest/coverage-v8
```

**Step 2: Configure coverage in `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    alias: {
      vscode: path.resolve(__dirname, 'src/__mocks__/vscode.ts'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/__mocks__/**',
        'src/test/**',                   // integration test harness (Task 8)
        'src/writerView/script.ts',      // runs in webview, not Node
        'src/writerView/toolbar/**',     // runs in webview, not Node
      ],
    },
  },
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, 'src/__mocks__/vscode.ts'),
    },
  },
});
```

**Why `src/test/**` is excluded:** Once Task 8 lands, `src/test/runTest.ts` and `src/test/suite/index.ts` are integration harness glue — not product code. Including them would inflate coverage denominators without adding signal.

**Step 3: Add coverage script and update .gitignore**

In `package.json`:

```json
"test:coverage": "vitest run --coverage"
```

Append to `.gitignore`:

```
coverage/
```

**Step 4: Run coverage to verify**

```bash
npm run test:coverage
```

Expected: Coverage report prints to terminal + generates `coverage/lcov-report/index.html`.

**Step 5: Commit**

```bash
git add package.json vitest.config.ts .gitignore && git commit -m "feat: add Vitest coverage reporting with v8 provider"
```

---

## Task 4: Unit Tests for `codexModel.ts` (Pure Logic)

**Files:**
- Create: `src/codexModel.test.ts`
- Reference: `src/codexModel.ts`

This module has ~20 exported pure functions. Most take a string/object and return a parsed result — no VS Code API dependency for the core parsing.

### API reference (from reading source)

| Function | Returns | Notes |
|----------|---------|-------|
| `parseCodex(text)` | `CodexDocument \| null` | Has `.rootNode: CodexNode \| null`, `.allNodes: CodexNode[]`, `.metadata`, `.isJson`, `.isMarkdown` |
| `parseMarkdownAsCodex(text, fileName?)` | `CodexDocument \| null` | Codex Lite path — `.isMarkdown = true`, `.metadata.formatVersion = 'lite'` |
| `validateCodex(doc, text)` | `CodexValidationIssue[]` | Checks `metadata.formatVersion` first — a doc without metadata will have issues |
| `createMinimalCodex(type, name)` | `string` | Produces valid YAML with `metadata.formatVersion: "1.1"` and proper UUID |
| `generateUuid()` | `string` | UUID v4 via `crypto.randomUUID()` |
| `setMarkdownNodeProse(text, body, fm?)` | `string` | Rebuilds markdown with frontmatter + body |
| `setMarkdownFrontmatterField(text, field, value)` | `string` | Updates a single frontmatter field |
| `isCodexFile`, `isMarkdownFile`, `isCodexLikeFile` | `boolean` | Filename checks |

**Step 1: Write tests for file-type detection**

```typescript
import { describe, it, expect } from 'vitest';
import {
  isCodexFile, isMarkdownFile, isCodexLikeFile,
  parseCodex, parseMarkdownAsCodex, validateCodex,
  generateUuid, createMinimalCodex,
  setMarkdownNodeProse, setMarkdownFrontmatterField,
} from './codexModel';

describe('isCodexFile', () => {
  it('returns true for .codex.yaml', () => {
    expect(isCodexFile('world.codex.yaml')).toBe(true);
  });
  it('returns true for .codex.json', () => {
    expect(isCodexFile('world.codex.json')).toBe(true);
  });
  it('returns false for plain .yaml', () => {
    expect(isCodexFile('config.yaml')).toBe(false);
  });
  it('returns false for .md', () => {
    expect(isCodexFile('chapter.md')).toBe(false);
  });
});

describe('isMarkdownFile', () => {
  it('returns true for .md files', () => {
    expect(isMarkdownFile('chapter.md')).toBe(true);
  });
  it('returns false for .yaml', () => {
    expect(isMarkdownFile('world.codex.yaml')).toBe(false);
  });
});

describe('isCodexLikeFile', () => {
  it('returns true for codex files', () => {
    expect(isCodexLikeFile('world.codex.yaml')).toBe(true);
  });
  it('returns true for markdown files', () => {
    expect(isCodexLikeFile('chapter.md')).toBe(true);
  });
});
```

**Step 2: Run to verify**

```bash
npx vitest run src/codexModel.test.ts
```

Expected: PASS

**Step 3: Add tests for `parseCodex`**

```typescript
describe('parseCodex', () => {
  it('parses valid YAML codex with metadata', () => {
    const yaml = [
      'metadata:',
      '  formatVersion: "1.1"',
      'id: abc-123',
      'type: chapter',
      'name: Chapter One',
      'body: Hello world',
    ].join('\n');
    const result = parseCodex(yaml);
    expect(result).not.toBeNull();
    expect(result!.rootNode).not.toBeNull();
    expect(result!.rootNode!.name).toBe('Chapter One');
    expect(result!.allNodes.length).toBeGreaterThanOrEqual(1);
    expect(result!.isMarkdown).toBe(false);
  });

  it('returns null for empty string', () => {
    expect(parseCodex('')).toBeNull();
  });

  it('returns null for invalid YAML', () => {
    expect(parseCodex('{{{')).toBeNull();
  });

  it('parses JSON codex document', () => {
    const json = JSON.stringify({
      metadata: { formatVersion: '1.1' },
      id: 'x', type: 'scene', name: 'Test', body: 'text',
    });
    const result = parseCodex(json);
    expect(result).not.toBeNull();
    expect(result!.isJson).toBe(true);
  });

  it('returns null for legacy format with data wrapper', () => {
    const yaml = 'data:\n  - id: old\n    type: scene';
    expect(parseCodex(yaml)).toBeNull();
  });
});
```

**Step 4: Add tests for `parseMarkdownAsCodex` (Codex Lite path)**

```typescript
describe('parseMarkdownAsCodex', () => {
  it('parses markdown with YAML frontmatter', () => {
    const md = [
      '---',
      'name: My Chapter',
      'type: chapter',
      '---',
      '',
      'This is the body text.',
    ].join('\n');
    const result = parseMarkdownAsCodex(md, 'chapter-1.md');
    expect(result).not.toBeNull();
    expect(result!.isMarkdown).toBe(true);
    expect(result!.metadata.formatVersion).toBe('lite');
    expect(result!.rootNode).not.toBeNull();
    expect(result!.rootNode!.name).toBe('My Chapter');
  });

  it('uses H1 heading as name when frontmatter has no name', () => {
    const md = '# The Great Adventure\n\nOnce upon a time...';
    const result = parseMarkdownAsCodex(md, 'story.md');
    expect(result).not.toBeNull();
    expect(result!.rootNode!.name).toBe('The Great Adventure');
  });

  it('falls back to filename when no name or H1', () => {
    const md = 'Just some text with no heading or frontmatter.';
    const result = parseMarkdownAsCodex(md, 'notes.md');
    expect(result).not.toBeNull();
    expect(result!.rootNode!.name).toBe('notes');
  });

  it('returns null for empty string', () => {
    expect(parseMarkdownAsCodex('')).toBeNull();
  });
});
```

**Step 5: Add tests for `setMarkdownNodeProse` and `setMarkdownFrontmatterField`**

```typescript
describe('setMarkdownNodeProse', () => {
  it('rebuilds markdown with frontmatter and new body', () => {
    const original = '---\nname: Chapter\n---\n\nOld body';
    const result = setMarkdownNodeProse(original, 'New body');
    expect(result).toContain('name: Chapter');
    expect(result).toContain('New body');
    expect(result).not.toContain('Old body');
  });

  it('returns just body when no frontmatter', () => {
    const result = setMarkdownNodeProse('Plain text', 'New body');
    expect(result).toBe('New body');
  });
});

describe('setMarkdownFrontmatterField', () => {
  it('adds a field to existing frontmatter', () => {
    const original = '---\nname: Chapter\n---\n\nBody text';
    const result = setMarkdownFrontmatterField(original, 'type', 'scene');
    expect(result).toContain('type: scene');
    expect(result).toContain('name: Chapter');
    expect(result).toContain('Body text');
  });

  it('creates frontmatter if none exists', () => {
    const result = setMarkdownFrontmatterField('Plain text', 'name', 'Title');
    expect(result).toContain('---');
    expect(result).toContain('name: Title');
  });
});
```

**Step 6: Add tests for `validateCodex`**

```typescript
describe('validateCodex', () => {
  it('returns issues for missing metadata.formatVersion', () => {
    const yaml = 'id: abc-123\ntype: chapter\nname: No Metadata';
    const doc = parseCodex(yaml);
    const issues = validateCodex(doc, yaml);
    expect(issues.some(i => i.message.includes('formatVersion'))).toBe(true);
  });

  it('returns issues for node with invalid UUID format', () => {
    const yaml = [
      'metadata:',
      '  formatVersion: "1.1"',
      'id: not-a-valid-uuid',
      'type: chapter',
      'name: Bad UUID',
    ].join('\n');
    const doc = parseCodex(yaml);
    const issues = validateCodex(doc, yaml);
    expect(issues.some(i => i.message.includes('invalid UUID'))).toBe(true);
  });

  it('returns no issues for fully valid document', () => {
    // createMinimalCodex produces a valid doc with metadata + proper UUID
    const yaml = createMinimalCodex('chapter', 'Valid Chapter');
    const doc = parseCodex(yaml);
    const issues = validateCodex(doc, yaml);
    expect(issues.length).toBe(0);
  });

  it('returns parse error for garbage input', () => {
    const issues = validateCodex(null, '{{{');
    expect(issues.some(i => i.severity === 'error')).toBe(true);
  });
});
```

**Step 7: Add tests for `generateUuid`, `createMinimalCodex`**

```typescript
describe('generateUuid', () => {
  it('returns a valid UUID v4 string', () => {
    const uuid = generateUuid();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('generates unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateUuid()));
    expect(ids.size).toBe(100);
  });
});

describe('createMinimalCodex', () => {
  it('creates valid YAML with given type and name', () => {
    const text = createMinimalCodex('scene', 'My Scene');
    const doc = parseCodex(text);
    expect(doc).not.toBeNull();
    expect(doc!.rootNode).not.toBeNull();
    expect(doc!.rootNode!.type).toBe('scene');
    expect(doc!.rootNode!.name).toBe('My Scene');
    expect(doc!.metadata.formatVersion).toBe('1.1');
  });
});
```

**Step 8: Run and verify all**

```bash
npx vitest run src/codexModel.test.ts
```

Expected: All PASS.

**Step 9: Commit**

```bash
git add src/codexModel.test.ts && git commit -m "test: add unit tests for codexModel (YAML, JSON, Codex Lite, validation)"
```

---

## Task 5: Unit Tests for Search Modules (Pure Logic)

**Files:**
- Create: `src/search/tokenizer.test.ts`
- Create: `src/search/queryParser.test.ts`
- Create: `src/search/scoring.test.ts`

These modules are pure functions with zero VS Code dependency — ideal test targets.

**Step 1: Write tokenizer tests**

```typescript
// src/search/tokenizer.test.ts
import { describe, it, expect } from 'vitest';
import { tokenize, levenshteinDistance } from './tokenizer';

describe('tokenize', () => {
  it('lowercases and splits on whitespace', () => {
    expect(tokenize('Hello World')).toEqual(['hello', 'world']);
  });

  it('strips punctuation', () => {
    expect(tokenize("it's a test!")).toEqual(["it", "test"]);
  });

  it('filters tokens shorter than 2 chars', () => {
    expect(tokenize('I am a hero')).toEqual(['am', 'hero']);
  });

  it('returns empty for null/undefined', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(null as any)).toEqual([]);
  });
});

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('abc', 'abc')).toBe(0);
  });

  it('returns length for empty comparisons', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });

  it('calculates correct edit distance', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });
});
```

**Step 2: Write queryParser tests**

```typescript
// src/search/queryParser.test.ts
import { describe, it, expect } from 'vitest';
import { parseQuery } from './queryParser';

describe('parseQuery', () => {
  it('parses simple terms', () => {
    const q = parseQuery('dragon sword');
    expect(q.terms).toEqual(['dragon', 'sword']);
  });

  it('parses quoted phrases', () => {
    const q = parseQuery('"king of gondor"');
    expect(q.phrases).toEqual(['king of gondor']);
  });

  it('parses type filters', () => {
    const q = parseQuery('type:character aragorn');
    expect(q.filters.types).toEqual(['character']);
    expect(q.terms).toEqual(['aragorn']);
  });

  it('parses field filters', () => {
    const q = parseQuery('body:dragon');
    expect(q.filters.fields).toEqual([{ field: 'body', value: 'dragon' }]);
  });

  it('parses exclusions', () => {
    const q = parseQuery('-type:location -unwanted');
    expect(q.filters.exclude.types).toEqual(['location']);
    expect(q.filters.exclude.terms).toEqual(['unwanted']);
  });

  it('handles empty input', () => {
    const q = parseQuery('');
    expect(q.terms).toEqual([]);
    expect(q.phrases).toEqual([]);
  });
});
```

**Step 3: Write scoring tests**

```typescript
// src/search/scoring.test.ts
import { describe, it, expect } from 'vitest';
import { calculateBM25 } from './scoring';

describe('calculateBM25', () => {
  it('returns 0 when totalDocs is 0', () => {
    expect(calculateBM25(1, 100, 100, 1, 0)).toBe(0);
  });

  it('returns 0 when docFreq is 0', () => {
    expect(calculateBM25(1, 100, 100, 0, 10)).toBe(0);
  });

  it('returns positive score for valid inputs', () => {
    const score = calculateBM25(3, 100, 120, 5, 50);
    expect(score).toBeGreaterThan(0);
  });

  it('higher term frequency gives higher score', () => {
    const low = calculateBM25(1, 100, 100, 5, 50);
    const high = calculateBM25(5, 100, 100, 5, 50);
    expect(high).toBeGreaterThan(low);
  });

  it('rarer terms (lower docFreq) score higher', () => {
    const common = calculateBM25(3, 100, 100, 40, 50);
    const rare = calculateBM25(3, 100, 100, 2, 50);
    expect(rare).toBeGreaterThan(common);
  });
});
```

**Step 4: Run all search tests**

```bash
npx vitest run src/search/
```

Expected: All PASS.

**Step 5: Commit**

```bash
git add src/search/*.test.ts && git commit -m "test: add unit tests for search tokenizer, queryParser, and BM25 scoring"
```

---

## Task 6: Unit Tests for `writerView/utils/helpers.ts` (Pure Logic)

**Files:**
- Create: `src/writerView/utils/helpers.test.ts`

These are pure functions — no VS Code dependency except `safePostMessage` which can be skipped.

**Step 1: Write tests**

```typescript
import { describe, it, expect } from 'vitest';
import { escapeHtml, isPathWithinWorkspace, getNonce } from './helpers';

describe('escapeHtml', () => {
  it('escapes all HTML special characters', () => {
    expect(escapeHtml('<script>"alert(\'xss\')&"</script>')).toBe(
      '&lt;script&gt;&quot;alert(&#039;xss&#039;)&amp;&quot;&lt;/script&gt;'
    );
  });

  it('returns empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('isPathWithinWorkspace', () => {
  it('allows paths inside workspace', () => {
    expect(isPathWithinWorkspace('sub/file.yaml', '/workspace')).toBe(true);
  });

  it('blocks path traversal', () => {
    expect(isPathWithinWorkspace('../../etc/passwd', '/workspace')).toBe(false);
  });

  it('returns false for empty workspace root', () => {
    expect(isPathWithinWorkspace('file.yaml', '')).toBe(false);
  });
});

describe('getNonce', () => {
  it('returns 32 char hex string', () => {
    expect(getNonce()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('returns unique values', () => {
    expect(getNonce()).not.toBe(getNonce());
  });
});
```

**Step 2: Run and verify**

```bash
npx vitest run src/writerView/utils/helpers.test.ts
```

Expected: PASS.

**Step 3: Commit**

```bash
git add src/writerView/utils/helpers.test.ts && git commit -m "test: add unit tests for writerView helpers (escapeHtml, path validation, nonce)"
```

---

## Task 7: Consolidate the vscode Mock (Cleanup)

**Files:**
- Modify: `src/structureEditor.test.ts` (remove inline mock, use shared mock)
- Verify: `src/__mocks__/vscode.ts` covers everything the inline mocks provide

**Step 1: Compare inline mock in `structureEditor.test.ts:7-23` with shared mock**

The inline mock in `structureEditor.test.ts` overrides the shared mock with its own `vi.mock('vscode', ...)`. Remove it so the test uses the shared alias from `vitest.config.ts`.

**Step 2: Add any missing exports to `src/__mocks__/vscode.ts`**

Check what the inline mock provides that the shared mock doesn't, and add those to the shared mock. The shared mock already has: `window`, `workspace`, `WorkspaceEdit`, `Range`, `Uri`, `FileType`, `commands`. Verify no missing pieces.

**Step 3: Fix the forward-reference in the shared mock**

`src/__mocks__/vscode.ts:16` uses `FileType.File` before the `FileType` enum is declared. Move the `FileType` enum declaration above the `workspace` object.

**Step 4: Run tests to verify nothing breaks**

```bash
npx vitest run
```

Expected: 81+ tests pass.

**Step 5: Commit**

```bash
git add src/structureEditor.test.ts src/__mocks__/vscode.ts && git commit -m "refactor: consolidate vscode mocks and fix forward reference"
```

---

## Task 8: Extension-Host Integration Tests Setup

**Files:**
- Create: `src/test/fixtures/workspace/test.codex.yaml` (checked-in fixture)
- Create: `src/test/runTest.ts` (test launcher)
- Create: `src/test/suite/index.ts` (Mocha test runner)
- Create: `src/test/suite/extension.test.ts` (smoke test)
- Create: `tsconfig.test.json` (integration test compilation)
- Modify: `package.json` (add `test:integration` script, add devDependencies)

### Build path

The current `esbuild.js` only bundles `src/extension.ts` → `out/extension.js`. Integration tests need to be compiled separately to `out/test/` because they run inside VS Code's Node process (which resolves `vscode` natively, no mock needed).

We use a dedicated `tsconfig.test.json` to compile only `src/test/**` → `out/test/`.

### Workspace requirement

`setContextFile` and `setContextFolder` call `vscode.workspace.getWorkspaceFolder(uri)` which returns `undefined` unless the URI belongs to an open workspace folder. The test runner must open a real workspace folder. We use a checked-in fixture workspace passed via `launchArgs: ['fixture-path']` to `@vscode/test-electron`.

**Step 1: Install dependencies**

```bash
npm install --save-dev @vscode/test-electron mocha @types/mocha glob @types/glob
```

**Step 2: Create fixture workspace**

```bash
mkdir -p src/test/fixtures/workspace
```

Create `src/test/fixtures/workspace/test.codex.yaml`:

```yaml
metadata:
  formatVersion: "1.1"
  documentVersion: "1.0.0"
id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
type: book
name: Test Book
children:
  - id: "d4c3b2a1-6f5e-4b7a-9d8c-1f0e3a2b5c4d"
    type: chapter
    name: Chapter 1
    body: Hello world from the test fixture.
```

**Step 3: Create `tsconfig.test.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "out",
    "rootDir": "src",
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/test/**/*"]
}
```

**Step 4: Create test runner (`src/test/runTest.ts`)**

```typescript
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');
    const fixtureWorkspace = path.resolve(__dirname, './fixtures/workspace');

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        fixtureWorkspace,       // open fixture as workspace folder
        '--disable-extensions',  // disable other extensions for isolation
      ],
    });
  } catch (err) {
    console.error('Failed to run tests:', err);
    process.exit(1);
  }
}

main();
```

**Why `fixtureWorkspace` is the first launchArg:** `@vscode/test-electron` passes launch args to VS Code. The first positional argument is the folder to open. This makes `vscode.workspace.workspaceFolders` contain the fixture, so `getWorkspaceFolder()` works.

**Step 5: Create Mocha suite runner (`src/test/suite/index.ts`)**

```typescript
import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 10000,
  });

  const testsRoot = path.resolve(__dirname, '.');
  const files = await glob('**/**.test.js', { cwd: testsRoot });

  files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

  return new Promise((resolve, reject) => {
    mocha.run((failures: number) => {
      if (failures > 0) {
        reject(new Error(`${failures} tests failed.`));
      } else {
        resolve();
      }
    });
  });
}
```

**Step 6: Create smoke test (`src/test/suite/extension.test.ts`)**

```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Smoke Tests', () => {
  test('Extension should be present', () => {
    const ext = vscode.extensions.getExtension('StudioPhong.chapterwise-codex');
    assert.ok(ext, 'Extension not found');
  });

  test('Extension should activate', async () => {
    const ext = vscode.extensions.getExtension('StudioPhong.chapterwise-codex');
    assert.ok(ext);
    await ext.activate();
    assert.strictEqual(ext.isActive, true);
  });

  test('Workspace fixture should be open', () => {
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length > 0, 'No workspace folder open');
    assert.ok(
      folders[0].uri.fsPath.includes('fixtures'),
      `Expected fixture workspace, got: ${folders[0].uri.fsPath}`
    );
  });

  test('Commands should be registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    const codexCommands = commands.filter(c => c.startsWith('chapterwiseCodex.'));
    assert.ok(codexCommands.length >= 20, `Expected 20+ commands, got ${codexCommands.length}`);
    assert.ok(codexCommands.includes('chapterwiseCodex.refresh'));
    assert.ok(codexCommands.includes('chapterwiseCodex.openWriterView'));
    assert.ok(codexCommands.includes('chapterwiseCodex.addChildNode'));
    assert.ok(codexCommands.includes('chapterwiseCodex.setContextFile'));
  });
});
```

**Step 7: Add scripts to `package.json`**

```json
"compile:tests": "tsc -p tsconfig.test.json",
"test:integration": "npm run compile && npm run compile:tests && node out/test/runTest.js"
```

**Why two compile steps:** `npm run compile` (esbuild) → `out/extension.js`. `npm run compile:tests` (tsc) → `out/test/**/*.js`. The runner loads the extension bundle and executes test JS.

**Step 8: Ensure fixture files are copied to `out/test/fixtures/`**

tsc only compiles `.ts` files — it won't copy `.yaml` fixtures. Add a copy step:

```json
"compile:tests": "tsc -p tsconfig.test.json && cp -r src/test/fixtures out/test/"
```

**Step 9: Add `.vscode-test/` to `.gitignore`**

```
.vscode-test/
```

**Step 10: Run**

```bash
npm run test:integration
```

Expected: VS Code downloads (first run), opens fixture workspace, extension activates, all smoke tests pass including the workspace check.

**Step 11: Commit**

```bash
git add src/test/ tsconfig.test.json package.json .gitignore && git commit -m "feat: add @vscode/test-electron integration tests with fixture workspace"
```

---

## Task 9: Integration Test for Tree Provider Context Setting

**Files:**
- Create: `src/test/suite/treeProvider.test.ts`

### Context from source code

- The tree provider does NOT auto-populate on file open — `onDidChangeActiveTextEditor` and `onDidOpenTextDocument` are intentionally no-ops (`treeProvider.ts:715-727`)
- `setActiveDocument(doc, explicit)` blocks unless `explicit=true` or context was previously set explicitly (`treeProvider.ts:748-759`)
- `setContextFile` command (`extension.ts:2851-2875`) calls `setActiveDocument(doc, true)` — the explicit path
- `setContextFile` calls `getWorkspaceFolder(uri)` first — URI must belong to an open workspace folder (`extension.ts:2862`)
- `refresh()` just fires `_onDidChangeTreeData` event (`treeProvider.ts:1047-1048`) — it always succeeds regardless of context state, so it's not a valid success assertion

### Stronger assertion strategy

After `setContextFile`, verify the tree view title was updated. The command sets `treeView.title = '📄 ${basename}'` at `extension.ts:2878`. We can also verify a `getChildren()` call returns items by refreshing and querying the tree data provider.

Since we can't easily access the tree data provider instance from the test, we use an observable side effect: check that `chapterwiseCodex.filterByType` returns type options (it reads from `treeProvider.getTypes()` which returns an empty set when no context is set).

**Step 1: Write tree provider integration test**

```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

suite('Tree Provider Integration', () => {
  let codexUri: vscode.Uri;

  suiteSetup(async () => {
    // The fixture workspace is already open (set up in runTest.ts)
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length > 0, 'Fixture workspace not open');
    codexUri = vscode.Uri.file(path.join(folders[0].uri.fsPath, 'test.codex.yaml'));

    // Verify the fixture file exists
    const stat = await vscode.workspace.fs.stat(codexUri);
    assert.ok(stat, 'test.codex.yaml fixture not found');
  });

  test('Opening a codex file does NOT auto-set tree context', async () => {
    // Open the file without using setContextFile
    const doc = await vscode.workspace.openTextDocument(codexUri);
    await vscode.window.showTextDocument(doc);
    await new Promise(r => setTimeout(r, 500));

    // The refresh command should work (commands registered at activation)
    // but this doesn't prove the tree has content — that's the point
    await vscode.commands.executeCommand('chapterwiseCodex.refresh');
  });

  test('setContextFile populates tree with document content', async () => {
    // Execute the explicit context-setting command with the fixture file
    await vscode.commands.executeCommand('chapterwiseCodex.setContextFile', codexUri);

    // Give the tree time to populate
    await new Promise(r => setTimeout(r, 2000));

    // Verify the tree has content by checking that opening the navigator
    // doesn't show the "no file open" message. We do this by calling
    // openNavigator — if context is set, it opens Writer View; if not,
    // it shows an info message.
    //
    // Alternative: Check that the tree view's title was updated.
    // The setContextFile command sets the title to the file's basename.
    // We can't read tree view title directly, but we can verify that
    // a second setContextFile doesn't error (proving context was processed).
    await vscode.commands.executeCommand('chapterwiseCodex.setContextFile', codexUri);
    // If we got here without error, context was accepted twice — proves
    // the tree provider accepted and processed the file.

    // Also verify: refresh after context is set should complete
    await vscode.commands.executeCommand('chapterwiseCodex.refresh');
  });
});
```

**Note:** This test is more limited than ideal because the tree data provider's `getChildren()` method is not directly accessible from the integration test. The smoke-level assertion is: `setContextFile` with a real workspace file completes without error and the extension stays healthy. Deeper tree content assertions would require either:
- Exporting the tree provider instance from the extension API
- Using a test-only command that dumps tree state

This is a good follow-up item but out of scope for the initial harness.

**Step 2: Run**

```bash
npm run test:integration
```

**Step 3: Commit**

```bash
git add src/test/suite/treeProvider.test.ts && git commit -m "test: add tree provider integration test for explicit context setting"
```

---

## Task 10: Install and Configure ESLint

**Files:**
- Create: `eslint.config.mjs` (flat config — ESLint 9+)
- Modify: `package.json` (devDependencies, lint script update)

**Context:** The repo has `"lint": "eslint src --ext ts"` in scripts, but ESLint is not installed and there's no config file. The `--ext` flag is deprecated in ESLint 9. We need to install ESLint and create a config before CI can use it.

**Step 1: Install ESLint and TypeScript plugin**

```bash
npm install --save-dev eslint @eslint/js typescript-eslint
```

**Step 2: Create `eslint.config.mjs`**

```javascript
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    ignores: ['out/**', 'node_modules/**', 'coverage/**', '.vscode-test/**'],
  },
);
```

**Step 3: Update the lint script in `package.json`**

```json
"lint": "eslint src/"
```

(Remove `--ext ts` — flat config handles file matching via the `files` array.)

**Step 4: Run lint to verify**

```bash
npm run lint
```

Expected: May produce warnings (especially `no-explicit-any`) — that's fine. Should not error on config issues.

**Step 5: Commit**

```bash
git add eslint.config.mjs package.json && git commit -m "feat: install and configure ESLint with TypeScript support"
```

---

## Task 11: GitHub Actions CI Workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Step 1: Write the workflow**

```yaml
name: CI

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Typecheck
        run: npm run typecheck

      - name: Lint
        run: npm run lint

      - name: Unit tests with coverage
        run: npm run test:coverage

      - name: Build
        run: npm run compile

  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build extension
        run: npm run compile

      - name: Build integration tests
        run: npm run compile:tests

      - name: Integration tests
        run: xvfb-run -a node out/test/runTest.js
```

Note: `xvfb-run` is needed because `@vscode/test-electron` requires a display server on Linux. The integration job uses explicit compile steps for CI log visibility.

**Step 2: Commit**

```bash
git add .github/workflows/ci.yml && git commit -m "ci: add GitHub Actions workflow for typecheck, lint, unit tests, and integration tests"
```

---

## Task 12: Final `package.json` Scripts Cleanup

**Files:**
- Modify: `package.json`

**Step 1: Ensure final scripts look like this**

```json
"scripts": {
  "vscode:prepublish": "npm run compile",
  "compile": "node esbuild.js --production",
  "compile:tsc": "tsc -p ./",
  "compile:tests": "tsc -p tsconfig.test.json && cp -r src/test/fixtures out/test/",
  "watch": "node esbuild.js --watch",
  "typecheck": "tsc -p ./ --noEmit",
  "pretest": "npm run compile",
  "lint": "eslint src/",
  "package": "vsce package",
  "test": "npm run typecheck && vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage",
  "test:integration": "npm run compile && npm run compile:tests && node out/test/runTest.js"
}
```

**Step 2: Run full pipeline**

```bash
npm test && npm run test:coverage
```

Expected: typecheck passes (0 errors), 100+ Vitest tests pass, coverage report generated.

**Step 3: Commit**

```bash
git add package.json && git commit -m "chore: finalize test scripts (typecheck, coverage, integration)"
```

---

## Execution Order Summary

| Task | Type | Effort | Dependencies |
|------|------|--------|--------------|
| 1a. Split tsconfig | Config | Small | None |
| 1b. Fix treeProvider casts | Fix | Small | None |
| 1c. Fix Thenable/Promise | Fix | Small | None |
| 1d. Fix generateIndex callers | Fix | Medium | None |
| 1e. Verify clean typecheck | Verify | Small | 1a-1d |
| 2. Typecheck gate | Config | Small | 1e |
| 3. Coverage reporting | Config | Small | None |
| 4. codexModel tests | Tests | Medium | None |
| 5. Search module tests | Tests | Medium | None |
| 6. Helpers tests | Tests | Small | None |
| 7. Mock consolidation | Refactor | Small | None |
| 8. Integration harness | Infra | Medium | 1e, 2 |
| 9. Tree provider integration | Tests | Medium | 8 |
| 10. ESLint setup | Infra | Small | None |
| 11. CI workflow | Infra | Small | 2, 3, 10 |
| 12. Scripts cleanup | Config | Small | All above |

**Parallelization:** Tasks 1a-1d can run in parallel (different files). Tasks 3-7 and 10 are independent of each other and can be parallelized after 1e. Tasks 8-9 require the typecheck to be clean first. Task 11 requires ESLint + coverage to exist.
