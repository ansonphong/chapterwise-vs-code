# CLAUDE.md — ChapterWise

VS Code extension for managing structured writing projects in YAML-based "Codex" format.

## Build & Run

```bash
npm run compile          # esbuild production build → out/extension.js
npm run watch            # esbuild watch mode (dev)
npm run compile:tsc      # TypeScript-only compilation (type-checking)
npm run typecheck        # tsc --noEmit (shippable source only, excludes test files)
npm run lint             # ESLint (flat config, typescript-eslint)
npm test                 # Full pipeline: esbuild → typecheck → vitest
npm run test:watch       # Vitest watch mode
npm run test:coverage    # Vitest with v8 coverage → ./coverage/
npm run test:integration # @vscode/test-electron (downloads VS Code, runs smoke tests)
npx vsce package         # Package → .vsix
```

Install locally:
```bash
code --install-extension *.vsix --force
```

## Architecture

### Entry Point
- `src/extension.ts` — Activation (`onStartupFinished`), creates providers/views, calls `registerAllCommands()`
- `src/extensionState.ts` — Module-level state (treeProvider, writerViewManager, etc.), `getDeps()`, helper functions
- `src/commands/register.ts` — Routes to per-domain command modules (`commands/structure.ts`, `commands/navigation.ts`, etc.)

### Core Subsystems

| Subsystem | Key Files | Purpose |
|-----------|-----------|---------|
| **Tree Navigation** | `treeProvider.ts`, `indexParser.ts`, `multiIndexManager.ts`, `subIndexTreeProvider.ts`, `masterIndexTreeProvider.ts` | ChapterWise Explorer sidebar, index caching, multi-file discovery |
| **Document Model** | `codexModel.ts` | Parse/mutate YAML (.codex.yaml), JSON (.codex.json), Markdown (.md w/ frontmatter) |
| **Writer View** | `writerView/manager.ts`, `writerView/script.ts`, `writerView/html/builder.ts` | Distraction-free webview editor, image handling, prose editing |
| **Structure Editing** | `structureEditor.ts`, `fileOrganizer.ts`, `dragDropController.ts`, `clipboardManager.ts`, `trashManager.ts`, `orderingManager.ts` | Node CRUD, drag/drop, cut/paste, trash/restore |
| **Search** | `search/indexManager.ts`, `search/searchEngine.ts`, `search/searchUI.ts`, `search/queryParser.ts` | Full-text search with TF-IDF scoring |
| **Format Conversion** | `convertFormat.ts`, `explodeCodex.ts`, `implodeCodex.ts` | Codex ↔ Markdown, extract/merge inline children |
| **Git** | `gitSetup.ts`, `gitSetup/wizard.ts` | Repo init, .gitignore, LFS setup wizard |
| **Utilities** | `autoFixer.ts`, `tagGenerator.ts`, `wordCount.ts`, `indexGenerator.ts`, `validation.ts`, `settingsManager.ts`, `colorManager.ts` | Auto-fix, tags, word count, index cache, validation, settings, colors |
| **Import** | `scrivenerImport.ts` | Scrivener .scrivx → Codex |

### Writer View Internals
- `writerView/html/` — Renderers: `contentRenderer.ts`, `attributesRenderer.ts`, `imagesRenderer.ts`, `imageBrowserRenderer.ts`
- `writerView/toolbar/` — Contextual toolbar
- `writerView/utils/helpers.ts` — `escapeHtml()`, `isPathWithinWorkspace()`, `safePostMessage()`

## Brand Voice

> **Canonical reference:** `../../.claude/references/brand-voice.md` — read before writing ANY user-facing text.

A confident technical mentor who treats writing as engineering. Philosophy first, features second. Developer metaphors are the identity ("IDE for Writers," "debug your plot"), not decoration. Honest capability, zero hype. Chaos → Clarity. Ownership always (open formats, no lock-in). Never theatrical, never condescending, never vague. Writer-facing text says "manuscript" not "file," "chapter" not "node," "project" not "repo." Analysis reads like editorial feedback. Errors: "[What went wrong] — [What to do about it]." Progress: specific data, no filler.

This extension is the primary writer interface — tree labels, status bar text, error notifications, context menu items, and Writer View copy all carry the voice directly.

## Testing

### Three-Layer Test Architecture

| Layer | Framework | Command | What it tests |
|-------|-----------|---------|---------------|
| **Unit tests** | Vitest | `npm test` | Pure logic modules with mocked VS Code API |
| **Integration tests** | @vscode/test-electron + Mocha | `npm run test:integration` | Extension activation, command registration, tree provider in real VS Code |
| **Typecheck gate** | tsc --noEmit | `npm run typecheck` | Type correctness of shippable source (auto-runs as part of `npm test`) |

### Unit Tests (Vitest)
- **262 tests across 11 suites** — `npm test` runs typecheck first, then vitest
- **Mock**: `src/__mocks__/vscode.ts` — shared mock aliased via `vitest.config.ts`, no inline mocks
- **Coverage**: `npm run test:coverage` — v8 provider, reports text + lcov to `./coverage/`
- **Config split**: `tsconfig.json` excludes `src/**/*.test.ts`, `src/__mocks__/**`, `src/test/**` — Vitest handles its own module resolution

| Suite | File | Tests |
|-------|------|-------|
| codexModel | `src/codexModel.test.ts` | 81 (parsing, validation, markdown, UUID, Codex Lite) |
| search/tokenizer | `src/search/tokenizer.test.ts` | 31 (tokenization, levenshtein, fuzzy match) |
| search/queryParser | `src/search/queryParser.test.ts` | 23 (terms, phrases, filters, exclusions) |
| search/scoring | `src/search/scoring.test.ts` | 23 (BM25, document scoring, boosts) |
| colorManager | `src/colorManager.test.ts` | 23 |
| structureEditor | `src/structureEditor.test.ts` | 22 |
| writerView/helpers | `src/writerView/utils/helpers.test.ts` | 22 (escapeHtml, path validation, nonce) |
| orderingManager | `src/orderingManager.test.ts` | 16 |
| trashManager | `src/trashManager.test.ts` | 11 |
| clipboardManager | `src/clipboardManager.test.ts` | 9 |
| writerView/script | `src/writerView/script.test.ts` | 1 |

### Integration Tests (@vscode/test-electron)
- **Fixture workspace**: `src/test/fixtures/workspace/test.codex.yaml`
- **Compiled separately**: `tsconfig.test.json` → `out/test/`, fixture copied via `compile:tests` script
- **Smoke tests**: `src/test/suite/extension.test.ts` (activation, commands), `src/test/suite/treeProvider.test.ts` (context setting)
- **Requires display server**: Use `xvfb-run` on CI (handled in `.github/workflows/ci.yml`)

### CI
- **GitHub Actions**: `.github/workflows/ci.yml` — typecheck, lint, unit tests + coverage, integration tests
- **Lint**: ESLint with `continue-on-error: true` (18 pre-existing errors to clean up)

## Modular Rules

See `.claude/rules/` for convention-specific rules that load contextually:
- `typescript.md` — async FS, no `as any`, path validation, typing patterns
- `webview.md` — HTML escaping, CSP headers, image handling, webview communication
- `yaml-operations.md` — file locking, format support, mutation safety, auto-fixer
- `testing.md` — Vitest patterns, integration tests, TDD, config split

### Tech Stack
- **Language**: TypeScript (ES2022, strict, CommonJS)
- **Bundler**: esbuild (entry: `src/extension.ts` → `out/extension.js`)
- **Testing**: Vitest (unit), @vscode/test-electron + Mocha (integration), @vitest/coverage-v8
- **Linting**: ESLint 10 + typescript-eslint (flat config: `eslint.config.mjs`)
- **Runtime deps**: `yaml`, `minimatch`
- **External**: `vscode` (not bundled)

## Context

- `.claude/context/` — internal architecture docs for this repo
- `../../.claude/context/chapterwise-codex.md` — cross-repo summary in parent
- `../../.claude/references/chapterwise-codex.md` — exhaustive reference in parent

## Plans

Plans are centralized in the parent workspace, NOT in this repo:
- Active plans: `../../.claude/plans/vs-code/`
- Archives: `../../.claude/plans/vs-code/_archive/`

## Post-Plan Workflow

After implementing any plan:
1. Update `.claude/context/` files to reflect new reality
2. Add dated one-liner to Recent Changes below
3. Update parent context: `../../.claude/context/chapterwise-codex.md`
4. Archive the plan in `../../.claude/plans/vs-code/_archive/`
5. Update `../../.claude/STATUS.md` and `../../.claude/exec-order.md`

## Recent Changes

- 2026-03-12: Extension hardening — refactored extension.ts, tree provider context state fixes
- 2026-03-11: Testing suite overhaul — 262 tests across 11 suites
