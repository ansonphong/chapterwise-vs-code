# Rename: "ChapterWise Codex" → "ChapterWise"

## Summary

Rename the extension from "ChapterWise Codex" to just "ChapterWise" everywhere. The Codex **file format** (`.codex.yaml`, `.codex.json`, codex snippets, etc.) stays unchanged — only the product/extension name changes.

This is a **breaking change** for existing users (settings keys, command IDs, keybindings all change).

## Naming Map

| Context | Before | After |
|---------|--------|-------|
| Display name | `ChapterWise Codex` | `ChapterWise` |
| Package name (npm/marketplace) | `chapterwise-codex` | `chapterwise` |
| Marketplace ID | `StudioPhong.chapterwise-codex` | `StudioPhong.chapterwise` |
| Command prefix | `chapterwiseCodex.*` | `chapterwise.*` |
| Settings prefix | `chapterwiseCodex.*` | `chapterwise.*` |
| View container ID | `chapterwiseCodex` | `chapterwise` |
| View IDs | `chapterwiseCodexNavigator`, `chapterwiseCodexMaster`, `chapterwiseCodexIndex0-7` | `chapterwiseNavigator`, `chapterwiseMaster`, `chapterwiseIndex0-7` |
| View label (package.json:369) | `ChapterWise Codex Navigator` | `ChapterWise Navigator` |
| Webview type | `chapterwiseCodexWriter` | `chapterwiseWriter` |
| Drag/drop MIME | `application/vnd.code.tree.chapterwiseCodexNavigator` | `application/vnd.code.tree.chapterwiseNavigator` |
| Focus command (navigator.ts:19) | `chapterwiseCodexNavigator.focus` | `chapterwiseNavigator.focus` |
| Keybinding target (package.json:887) | `workbench.view.extension.chapterwiseCodex` | `workbench.view.extension.chapterwise` |
| `when` clause view match (package.json:426+) | `view == chapterwiseCodexNavigator` | `view == chapterwiseNavigator` |
| `when` clause focus match (package.json:878+) | `focusedView =~ /^chapterwiseCodex/` | `focusedView =~ /^chapterwise/` |
| Diagnostic source | `ChapterWise Codex` / `ChapterWise Codex Lite` | `ChapterWise` / `ChapterWise Lite` |
| Diagnostic collection | `chapterwiseCodex` | `chapterwise` |
| Workspace state keys | `chapterwiseCodex.lastContextPath` etc. | `chapterwise.lastContextPath` etc. |
| Root folder | `/chapterwise-codex` | `/chapterwise-vs-code` |
| Repo URL (`package.json.repository.url`) | `https://github.com/chapterwise/chapterwise-codex` | `https://github.com/ansonphong/chapterwise-vs-code` |
| CLAUDE.md title | `Chapterwise Codex` | `ChapterWise` |

### Output Channels (all rename `Codex` out of display name)

| File | Before | After |
|------|--------|-------|
| extension.ts:33 | `ChapterWise Codex` | `ChapterWise` |
| autoFixer.ts:994 | `ChapterWise Codex Auto-Fixer` | `ChapterWise Auto-Fixer` |
| wordCount.ts:538 | `ChapterWise Codex Word Count` | `ChapterWise Word Count` |
| explodeCodex.ts:552 | `ChapterWise Codex Exploder` | `ChapterWise Exploder` |
| implodeCodex.ts:514 | `ChapterWise Codex Imploder` | `ChapterWise Imploder` |
| tagGenerator.ts:659 | `ChapterWise Codex Tag Generator` | `ChapterWise Tag Generator` |
| convertFormat.ts:307 | `ChapterWise Format Converter` | no change (already clean) |
| gitSetup.ts:18 | `ChapterWise Git` | no change (already clean) |
| dragDropController.ts:59 | `Codex Navigator` | no change (refers to format, not product) |

### Console/log strings (rename for consistency)

These are `console.log`/`console.error` prefixes in brackets. All `[ChapterWise Codex]` → `[ChapterWise]`:
- extensionState.ts: lines 307, 316, 323, 326, 342
- treeProvider.ts: lines 696, 729, 897, 930, 1398, 1406, 1415, 1419, 1442, 1446, 1449
- extension.ts: lines 36, 144, 146

Lines already using `[ChapterWise]` (no change needed): treeProvider.ts:667, 673, 681, 710

### User-visible UI text

| File:Line | Before | After |
|-----------|--------|-------|
| extensionState.ts:367 | `ChapterWise Codex\n${nodeCount} nodes...` | `ChapterWise\n${nodeCount} nodes...` |
| context.ts:156 | `treeView.title = 'ChapterWise Codex'` | `treeView.title = 'ChapterWise'` |
| extension.ts:147 | `ChapterWise Codex failed to activate` | `ChapterWise failed to activate` |

### What does NOT change
- File extensions: `.codex.yaml`, `.codex.json`, `.codex`
- Snippet prefixes: `codex-meta`, `codex-chapter`, etc.
- Internal model names: `codexModel.ts`, `CodexNode`, etc.
- Format references: "ChapterWise Codex Format", "Codex Lite", "Codex Navigator" (as format terms)
- Any code that refers to the codex file format itself
- `.claude/settings.json` plugin identifier (`chapterwise-codex@chapterwise-plugins`) — separate concern

---

## Steps

### Step 1: `package.json` — Identity, Commands, Views, Menus, Settings
**File:** `package.json`
**~253 changes**

1. `"name"`: `"chapterwise-codex"` → `"chapterwise"`
2. `"displayName"`: `"ChapterWise Codex"` → `"ChapterWise"`
3. `"repository.url"`: `https://github.com/chapterwise/chapterwise-codex` → `https://github.com/ansonphong/chapterwise-vs-code`
4. All `"command"` IDs: `chapterwiseCodex.` → `chapterwise.` (~60 commands)
5. All `"title"` strings: `"ChapterWise Codex: ..."` → `"ChapterWise: ..."` (~25 titles)
6. `viewsContainers.activitybar[0].id`: `"chapterwiseCodex"` → `"chapterwise"`
7. `viewsContainers.activitybar[0].title`: `"ChapterWise Codex"` → `"ChapterWise"`
8. All view IDs in `views` key: `chapterwiseCodexMaster` → `chapterwiseMaster`, `chapterwiseCodexIndex0-7` → `chapterwiseIndex0-7`, `chapterwiseCodexNavigator` → `chapterwiseNavigator`
9. View name at line 369: `"ChapterWise Codex Navigator"` → `"ChapterWise Navigator"`
10. All `"when"` clauses:
   - `chapterwiseCodex.hasMultipleIndexes` → `chapterwise.hasMultipleIndexes`
   - `chapterwiseCodex.index0Visible` (through index7) → `chapterwise.index0Visible`
   - `chapterwiseCodex.hasContext` → `chapterwise.hasContext`
   - `view == chapterwiseCodexNavigator` → `view == chapterwiseNavigator`
   - `focusedView =~ /^chapterwiseCodex/` → `focusedView =~ /^chapterwise/`
11. All `viewsWelcome` view references: `chapterwiseCodexMaster`, `chapterwiseCodexNavigator`
12. All `menus` command references
13. All `keybindings`:
    - command refs: `chapterwiseCodex.` → `chapterwise.`
    - `workbench.view.extension.chapterwiseCodex` → `workbench.view.extension.chapterwise`
    - `when` clauses (focusedView regex)
14. `configuration.title`: `"ChapterWise Codex"` → `"ChapterWise"`
15. All `configuration.properties` keys: `chapterwiseCodex.` → `chapterwise.`
16. `commandPalette` entries

### Step 2: Source — Extension Core
**Files:** `src/extension.ts`, `src/extensionState.ts`, `src/commands/register.ts`

1. `extension.ts`:
   - File header comment (line 2): `ChapterWise Codex Extension` → `ChapterWise Extension`
   - Output channel name (line 33): `'ChapterWise Codex'` → `'ChapterWise'`
   - Activation log (line 36): `'ChapterWise Codex extension activating...'`
   - Success log (line 144): `'ChapterWise Codex extension activated successfully!'`
   - Error log (line 146): `'ChapterWise Codex activation failed:'`
   - Error message (line 147): `'ChapterWise Codex failed to activate:'`
   - View IDs: `chapterwiseCodexMaster` (line 74), `chapterwiseCodexIndex${i}` (lines 82, 84)
   - Command ref: `chapterwiseCodex.openNavigator` (line 115)
2. `extensionState.ts`:
   - Workspace state keys (lines 248-260): `chapterwiseCodex.lastContextPath`, `chapterwiseCodex.lastContextType`
   - Command executions (lines 274, 281): `chapterwiseCodex.setContextFolder`, `chapterwiseCodex.setContextFile`
   - Console log prefixes (lines 307, 316, 323, 326, 342): `[ChapterWise Codex]` → `[ChapterWise]`
   - Status bar tooltip (line 367): `ChapterWise Codex\n${nodeCount}...` → `ChapterWise\n${nodeCount}...`

### Step 3: Source — Command Handlers (`src/commands/*.ts`)
**Files:** All files in `src/commands/`
**~80 changes**

Every `chapterwiseCodex.` command ID literal:
- `context.ts` (~10): command registrations, workspace state keys, config reads, treeView.title (`'ChapterWise Codex'` at line 156)
- `structure.ts` (~16)
- `navigation.ts` (~9)
- `tools.ts` (~7)
- `navigator.ts` (~6): includes `chapterwiseCodexNavigator.focus` → `chapterwiseNavigator.focus` (line 19)
- `fileOps.ts` (~6)
- `clipboard.ts` (~5)
- `git.ts` (~4)
- `index.ts` (~4)
- `writerView.ts` (~3)
- `trash.ts` (~3)
- `batch.ts` (~3)
- `search.ts` (~3)
- `convert.ts` (~2)

### Step 4: Source — Tree & Views
**Files:** `src/treeProvider.ts`, `src/subIndexTreeProvider.ts`, `src/masterIndexTreeProvider.ts`, `src/multiIndexManager.ts`, `src/dragDropController.ts`

1. `treeProvider.ts` (~22 changes):
   - View ID: `chapterwiseCodexNavigator` (line 1471)
   - Command refs in tree item definitions (lines 141, 266, 273, 280, 287, 296, 526)
   - Config reads: `getConfiguration('chapterwiseCodex')` (lines 1015, 1023, 1038)
   - Console log prefixes: `[ChapterWise Codex]` → `[ChapterWise]` (lines 696, 729, 897, 930, 1398, 1406, 1415, 1419, 1442, 1446, 1449)
2. `multiIndexManager.ts` (~4): Context keys `chapterwiseCodex.hasMultipleIndexes`, `chapterwiseCodex.index${i}Visible`, config read
3. `dragDropController.ts` (~5): MIME type `application/vnd.code.tree.chapterwiseCodexNavigator` → `...chapterwiseNavigator`, view ID references

### Step 5: Source — Writer View
**File:** `src/writerView/manager.ts`

(`src/writerView/styles.ts` is clean — no matches.)

1. Webview type: `chapterwiseCodexWriter` → `chapterwiseWriter` (lines 343, 685)
2. Config read: `getConfiguration('chapterwiseCodex.writerView')` → `getConfiguration('chapterwise.writerView')` (line 224)
3. Config read: `getConfiguration('chapterwiseCodex')` → `getConfiguration('chapterwise')` (line 1849 — images.organization setting)
4. Config change listeners: `affectsConfiguration('chapterwiseCodex.writerView.theme')` (lines 568, 895)

### Step 6: Source — Utilities & Features
**Files and specific changes:**

| File | Changes |
|------|---------|
| `validation.ts` | Diagnostic source `'ChapterWise Codex'` → `'ChapterWise'` (line 109), `'ChapterWise Codex Lite'` → `'ChapterWise Lite'` (line 163), source comparisons (lines 183, 381), diagnostic collection `'chapterwiseCodex'` (line 18), command ref (line 223) |
| `autoFixer.ts` | Output channel `'ChapterWise Codex Auto-Fixer'` → `'ChapterWise Auto-Fixer'` (line 994) |
| `wordCount.ts` | Output channel `'ChapterWise Codex Word Count'` → `'ChapterWise Word Count'` (line 538) |
| `explodeCodex.ts` | Output channel `'ChapterWise Codex Exploder'` → `'ChapterWise Exploder'` (line 552) |
| `implodeCodex.ts` | Output channel `'ChapterWise Codex Imploder'` → `'ChapterWise Imploder'` (line 514) |
| `tagGenerator.ts` | Output channel `'ChapterWise Codex Tag Generator'` → `'ChapterWise Tag Generator'` (line 659) |
| `settingsManager.ts` | Config section name `'chapterwiseCodex.navigator'` (line 252) |
| `scrivenerImport.ts` | Command ref `'chapterwiseCodex.importScrivener'` (line 447) |
| `indexGenerator.ts` | Comment update at line 20: `ChapterWise Codex output channel` → `ChapterWise output channel`; any command refs |
| `search/searchUI.ts` | Command ref |
| `search/searchIndex.ts` | Comment update at line 3: `used by ChapterWise Codex` → `used by ChapterWise` |
| `gitSetup.ts` | File header comment at line 2: `Git Setup Utilities for ChapterWise Codex` → `... for ChapterWise` |
| `gitSetup/templates.ts` | Comment at line 3: `Optimized for writing projects using ChapterWise Codex` → `... using ChapterWise` |
| `gitSetup/wizard.ts` | File header comment at line 2: `Git Setup Wizard for ChapterWise Codex` → `... for ChapterWise` |
| `codexModel.ts` | No rename needed if keeping formal format branding `ChapterWise Codex Format` unchanged |

### Step 7: Source — Tests
**Files:** `src/test/suite/extension.test.ts`, `src/test/suite/treeProvider.test.ts`, unit test files

**Integration tests (rename-sensitive assertions):**
- `extension.test.ts:6,11`: `StudioPhong.chapterwise-codex` → `StudioPhong.chapterwise`
- `extension.test.ts:28`: `c.startsWith('chapterwiseCodex.')` → `c.startsWith('chapterwise.')`
- `extension.test.ts:30-33`: `chapterwiseCodex.refresh` → `chapterwise.refresh`, etc.
- `treeProvider.test.ts:22,26,31,34`: `chapterwiseCodex.refresh` → `chapterwise.refresh`, `chapterwiseCodex.setContextFile` → `chapterwise.setContextFile`

**Unit tests (`src/*.test.ts`):** Grep for any `chapterwiseCodex` in assertions — likely none, but verify.

### Step 8: Documentation
**Files:** `CLAUDE.md`, `README.md`, `.claude/plans/`, `dev/`, `docs/plans/`

1. `CLAUDE.md`: Title `# CLAUDE.md — Chapterwise Codex` → `# CLAUDE.md — ChapterWise`
2. `README.md`:
   - Title: `# ChapterWise Codex Extension` → `# ChapterWise Extension`
   - Command examples: `ChapterWise Codex: ...` → `ChapterWise: ...`
   - `.vsix` filename references (lines 242, 245): `chapterwise-codex-0.1.0.vsix` → `chapterwise-0.1.0.vsix`
   - Leave the formal format link text `ChapterWise Codex Format V1.1` unchanged if format branding stays as-is
3. `.claude/plans/`, `dev/`, and `docs/plans/` files: batch-replace old product/package references (`ChapterWise Codex`, `chapterwiseCodex`, `chapterwise-codex`) where it appears, if you want repo-wide doc consistency. This is non-critical and can be done opportunistically.

**Explicitly excluded:** `.claude/settings.json` — the `chapterwise-codex@chapterwise-plugins` plugin identifier is a separate Claude plugin concern, not part of the VS Code extension rename.

### Step 9: Delete Stale Files
- `src/writerView.ts.backup` — contains 5 `chapterwiseCodex` references, is a stale backup file. Delete rather than update.

### Step 10: Build & Infrastructure
1. `package-lock.json`: Delete and regenerate via `npm install`
2. `scripts/sync-scrivener-scripts.sh`: Update path references (`chapterwise-codex` → `chapterwise-vs-code`)
3. Rename root folder: `/chapterwise-codex` → `/chapterwise-vs-code` (must be done outside editor session)
4. Optional local cleanup: remove old `chapterwise-codex-*.vsix` artifacts before packaging to avoid ambiguous install targets

### Step 11: Verify
1. Clean build artifacts first: `rm -rf out/ coverage/`
2. `npm run compile` — clean build
3. `npm run typecheck` — no type errors
4. `npm run lint` — no new errors
5. `npm test` — all unit tests pass
6. `npm run test:integration` — integration tests pass
7. `npx vsce package` — successful .vsix named `chapterwise-<package.json version>.vsix` (currently `chapterwise-0.3.2.vsix`)
8. Product-surface grep for old structural identifiers (exclude generated artifacts and out-of-scope archival docs):
   ```bash
   grep -rE "chapterwiseCodex|chapterwise-codex|StudioPhong\.chapterwise-codex" \
     src package.json package-lock.json README.md CLAUDE.md scripts .github \
     --include='*.ts' --include='*.json' --include='*.md' --include='*.sh' --include='*.yml'
   ```
   Expected: zero hits.
9. Product-surface grep for old display-name text:
   ```bash
   grep -r "ChapterWise Codex" src package.json README.md CLAUDE.md \
     --include='*.ts' --include='*.json' --include='*.md'
   ```
   Expected: zero hits except intentionally preserved formal format-brand references like `ChapterWise Codex Format`.
10. Optional docs grep: `.claude/plans/`, `dev/`, and `docs/plans/` may still contain historical references if you chose not to batch-clean them in this pass.

---

## Execution Order

Steps 1-9 can be done in a single pass using find-and-replace with these ordered substitutions:

| Order | Find | Replace | Scope |
|-------|------|---------|-------|
| 1 | `ChapterWise Codex Lite` | `ChapterWise Lite` | all src |
| 2 | `ChapterWise Codex` | `ChapterWise` | user-facing product strings in src + package.json + CLAUDE.md + README.md, excluding formal format-brand references like `ChapterWise Codex Format` |
| 3 | `chapterwiseCodexWriter` | `chapterwiseWriter` | src + package.json |
| 4 | `chapterwiseCodexNavigator` | `chapterwiseNavigator` | src + package.json |
| 5 | `chapterwiseCodexMaster` | `chapterwiseMaster` | src + package.json |
| 6 | `chapterwiseCodexIndex` | `chapterwiseIndex` | src + package.json |
| 7 | `chapterwiseCodex` | `chapterwise` | src + package.json (catch-all for commands, settings, context keys, workspace state) |
| 8 | `chapterwise-codex` | `chapterwise` | package.json `name` field and marketplace/package IDs |
| 9 | `chapterwise-codex` | `chapterwise-vs-code` | scripts/sync-scrivener-scripts.sh, docs |
| 10 | `chapterwise-codex-` (vsix refs) | `chapterwise-` | README.md |

**Critical:** Order matters — do specific compound names (steps 1-6) before the catch-all (step 7) to avoid double-replacement. Step 2 is not a blind global replace if you are preserving formal format-brand text. Step 8 is package/package-ID scope only (not the folder references which go to step 9). The optional broader docs cleanup in Step 8 can be done after the core code/manifest pass.

**Note on step 7 regex scope:** The `focusedView =~ /^chapterwiseCodex/` pattern in package.json will naturally become `focusedView =~ /^chapterwise/` via the catch-all. This is correct — the new view IDs all start with `chapterwise`.

## Rollout & Migration Notes

### Breaking change — no auto-upgrade
This rename creates a **new marketplace listing** (`StudioPhong.chapterwise`). The old listing (`StudioPhong.chapterwise-codex`) will not auto-upgrade. Users must:
1. Uninstall the old extension
2. Install the new extension
3. Re-configure any custom settings (keys changed from `chapterwiseCodex.*` → `chapterwise.*`)
4. Update any custom keybindings referencing old command IDs

### Recommended: add migration notice
Consider adding a one-time notification in the new extension that detects if the old extension is still installed and guides the user to uninstall it. This is optional and can be a follow-up task.

### No backward-compat shims
Per user decision, no temporary aliases or workspace-state migration code. Clean break.

## Risk Assessment

- **Breaking change**: All user settings and keybindings using old IDs will stop working
- **Marketplace**: New listing; old listing becomes orphaned
- **Folder rename**: Must be done outside the editor session (close VS Code first)
- **CI**: Workflow uses relative paths, so no direct path edits are expected in `.github/workflows/ci.yml`, but rerun CI after the rename to confirm packaging and integration tests still pass
