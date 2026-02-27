# Stage 4: Package.json Wiring — Commands, Context Menus, Keybindings

> **Master plan:** `00-master-plan.md` — execute via Ralph Loop
>
> **Shared reference:** See `codebase-facts.md` for all codebase facts.
> **Prerequisite:** Stage 1 (autofixFolder removal modifies package.json; must land first)
> **Review findings addressed:** R1-10, R2-11, R2-13, R3-9, R5-1

**Goal:** Register all new commands in `contributes.commands`, wire context menus for every node type, and add keyboard shortcuts.

**Architecture:** Primarily package.json changes. Three sequential tasks (commands → menus → keybindings) but all in one file, so small commits. The backward-compat alias for the renamed command ID is TypeScript — defer that snippet to Stage 5/6 where `extension.ts` is already being modified.

---

## Task 5: Register New Commands

**Files:**
- Modify: `package.json`

### Step 1: Add command declarations

Add to `contributes.commands`:
```json
{ "command": "chapterwiseCodex.addField", "title": "Add Field" },
{ "command": "chapterwiseCodex.deleteField", "title": "Delete Field" },
{ "command": "chapterwiseCodex.renameField", "title": "Rename Field" },
{ "command": "chapterwiseCodex.changeType", "title": "Change Type" },
{ "command": "chapterwiseCodex.changeIcon", "title": "Change Icon/Emoji" },
{ "command": "chapterwiseCodex.addTags", "title": "Add Tags" },
{ "command": "chapterwiseCodex.addRelation", "title": "Add Relation" },
{ "command": "chapterwiseCodex.duplicateNode", "title": "Duplicate", "icon": "$(copy)" },
{ "command": "chapterwiseCodex.cutNode", "title": "Cut", "icon": "$(cut)" },
{ "command": "chapterwiseCodex.pasteNodeAsChild", "title": "Paste as Child" },
{ "command": "chapterwiseCodex.pasteNodeAsSibling", "title": "Paste as Sibling" },
{ "command": "chapterwiseCodex.extractToFile", "title": "Extract to File" },
{ "command": "chapterwiseCodex.moveToTrash", "title": "Move to Trash", "icon": "$(trash)" },
{ "command": "chapterwiseCodex.restoreFromTrash", "title": "Restore from Trash" },
{ "command": "chapterwiseCodex.emptyTrash", "title": "Empty Trash" },
{ "command": "chapterwiseCodex.openInFinder", "title": "Reveal in File Explorer" },
{ "command": "chapterwiseCodex.copyPath", "title": "Copy Path" },
{ "command": "chapterwiseCodex.addChildFile", "title": "Add File" },
{ "command": "chapterwiseCodex.addChildFolder", "title": "New Subfolder" },
{ "command": "chapterwiseCodex.inlineThisFile", "title": "Inline This File" },
{ "command": "chapterwiseCodex.renameFolder", "title": "Rename Folder" },
{ "command": "chapterwiseCodex.batchMoveToTrash", "title": "Move Selected to Trash", "icon": "$(trash)" },
{ "command": "chapterwiseCodex.batchAddTags", "title": "Add Tags to Selected" }
```

### Step 2: Fix command ID mismatch (R1-10, R3-9)

Find ALL occurrences of `chapterwiseCodex.navigateToNodeInCodeView` in `package.json` (lines ~195, ~421, ~438) and rename to `chapterwiseCodex.navigateToEntityInCodeView` to match extension.ts:1080.

**Backward compatibility (Fact #49):** A deprecation alias must be registered in `extension.ts` so users with custom keybindings for the old ID don't silently lose them. **This TypeScript change is deferred to Stage 5** (where `extension.ts` is already being modified). The alias code:
```typescript
// Backward-compat alias for renamed command (can remove in next major version)
context.subscriptions.push(
  vscode.commands.registerCommand('chapterwiseCodex.navigateToNodeInCodeView',
    (...args: any[]) => vscode.commands.executeCommand('chapterwiseCodex.navigateToEntityInCodeView', ...args)
  )
);
```

### Step 3: Verify build

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`

### Step 4: Commit

```bash
git add package.json
git commit -m "feat: register new tree context menu commands, fix navigateToNode command ID mismatch"
```

---

## Task 6: Wire Context Menus

**Files:**
- Modify: `package.json`

Add `view/item/context` menu entries.

> **IMPORTANT — View Scope (Fact #45):** The default display mode is "stacked" (package.json:694), which uses `chapterwiseCodexIndex0-7` and `chapterwiseCodexMaster` views. Menus scoped to `chapterwiseCodexNavigator` will NOT appear in stacked mode.
>
> **Decision:** Wire menus for ALL views, not just Navigator. Use `viewItem` (node type) as the primary filter — it works across all views. For operations that are truly Navigator-only (like setContextFolder), keep the view filter. For all CRUD operations, use:
> ```
> "when": "viewItem == codexNode"     // works in ANY chapterwise view
> ```
> instead of:
> ```
> "when": "view == chapterwiseCodexNavigator && viewItem == codexNode"  // Navigator only
> ```
>
> **Exception:** Keep `view ==` filter for index-only types (`indexNode`, `indexFile`, `indexFolder`) since those ONLY appear in index-enabled views anyway.

### Step 1: codexNode menus

> **Use `viewItem == codexNode` (no view filter)** so these appear in Navigator, Master, and Index0-7 views.

Keep existing entries **but update their `when` clauses to drop `view == chapterwiseCodexNavigator &&`**. Add new:
- `1_add@3`: addField
- `2_edit@3-6`: changeType, changeIcon, addTags, addRelation
- `3_move@3-5`: cutNode, pasteNodeAsChild, pasteNodeAsSibling
- `4_navigate@3-4`: duplicateNode, extractToFile
- Replace `5_delete` with: moveToTrash, deleteNodePermanently

**Also update ALL existing codexNode entries** (openWriterView, addChildNode, addSiblingNode, renameNode, changeColor, goToYaml, copyId, removeNode/moveToTrash, deleteNodePermanently) to use `"when": "viewItem == codexNode"` — drop `view == chapterwiseCodexNavigator &&` from each.

### Step 1b: Fix moveNodeUp/moveNodeDown for codexNode (Fact #46)

Currently menus show for `codexNode` (package.json:381-388) but handlers reject non-IndexNodeTreeItem (extension.ts:1587). Two options:
- **Option A (recommended):** Remove `moveNodeUp`/`moveNodeDown` from codexNode menus. Inline reorder in FILES mode uses drag-and-drop, not buttons.
- **Option B:** Widen handlers in Stage 5 to support inline reorder in FILES mode via `editor.moveNodeInDocument()`.

**Choose Option A** — remove these two entries for codexNode. Keep them for indexNode/indexFile only.

### Step 2: indexNode menus (entity-in-file)

Full menu: addChildNode, addSiblingNode, addField, renameNode, changeType, changeIcon, addTags, addRelation, moveNodeUp, moveNodeDown, cutNode, pasteNodeAsChild, pasteNodeAsSibling, goToYaml, copyId, duplicateNode, moveToTrash, deleteNodePermanently

### Step 3: indexFile menus (file-backed node)

Full menu: addChildNode, addSiblingNode, addField, renameNode, changeType, changeIcon, addTags, moveNodeUp, moveNodeDown, cutNode, pasteNodeAsChild, pasteNodeAsSibling, openInFinder, copyPath, duplicateNode, moveToTrash, deleteNodePermanently

### Step 4: indexFolder menus

Entries: addChildFile, addChildFolder, renameFolder, openInFinder, moveToTrash

> **autofixFolder REMOVED** per unified ordering migration (Stage 1).

### Step 5: codexField + indexField menus

> **Use `viewItem == codexField` / `viewItem == indexField`** (no view filter) so these appear in all views.

Both: renameField (`2_edit@1`), goToYaml (`4_navigate@1`), deleteField (`5_delete@1`)

### Step 6: Multi-select menus (R2-11)

> **View scope:** Use `listMultiSelection` without a view filter so multi-select works in stacked mode too (consistent with the codexNode decision above).

```json
{ "command": "chapterwiseCodex.batchMoveToTrash", "when": "viewItem == codexNode && listMultiSelection", "group": "5_delete@1" },
{ "command": "chapterwiseCodex.batchAddTags", "when": "viewItem == codexNode && listMultiSelection", "group": "2_edit@1" }
```

> **Note:** Also add equivalent entries for `viewItem == indexNode` and `viewItem == indexFile` if multi-select should span index-mode node types.

### Step 7: Remove old autofixFolder menu entry

### Step 8: Verify build

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`

### Step 9: Commit

```bash
git add package.json
git commit -m "feat: wire context menus for all tree node types with correct node-kind scoping"
```

---

## Task 7: Keybindings

**Files:**
- Modify: `package.json`

### Step 1: Add keybindings

Scoped to all ChapterWise views using regex (Fact #45 — default mode is stacked):

```json
{ "command": "chapterwiseCodex.addSiblingNode", "key": "ctrl+n", "mac": "cmd+n", "when": "focusedView =~ /^chapterwiseCodex/" },
{ "command": "chapterwiseCodex.renameNode", "key": "f2", "when": "focusedView =~ /^chapterwiseCodex/" },
{ "command": "chapterwiseCodex.duplicateNode", "key": "ctrl+d", "mac": "cmd+d", "when": "focusedView =~ /^chapterwiseCodex/" },
{ "command": "chapterwiseCodex.cutNode", "key": "ctrl+x", "mac": "cmd+x", "when": "focusedView =~ /^chapterwiseCodex/" },
{ "command": "chapterwiseCodex.pasteNodeAsChild", "key": "ctrl+v", "mac": "cmd+v", "when": "focusedView =~ /^chapterwiseCodex/" }
```

> **Note:** Using regex `=~ /^chapterwiseCodex/` matches Navigator, Master, and Index0-7 views. This differs from the existing exact-match pattern but is necessary for stacked mode support.

### Step 2: Update existing keybindings

- Change `removeNode` (delete key) → `moveToTrash`
- Keep `deleteNodePermanently` (shift+delete) as permanent delete escape hatch
- **Migrate ALL existing keybindings** from `focusedView == chapterwiseCodexNavigator` to `focusedView =~ /^chapterwiseCodex/` for stacked mode support. This affects: addChildNode (`ctrl+shift+n`), changeColor (`ctrl+shift+c`), moveNodeUp (`ctrl+up`), moveNodeDown (`ctrl+down`), and the search keybinding (`ctrl+alt+f` — currently uses `view.chapterwiseCodexNavigator.visible`, change to `focusedView =~ /^chapterwiseCodex/`).

### Step 3: Commit

```bash
git add package.json
git commit -m "feat: add keybindings for sibling, rename, duplicate, cut/paste"
```

---

## Stage 4 Completion Checklist

- [ ] All 23 new commands declared in `contributes.commands`
- [ ] Command ID mismatch fixed (all 3 occurrences)
- [ ] codexNode menus use `viewItem == codexNode` (no view filter — works in stacked mode)
- [ ] codexNode context menu has all entries (add/edit/move/navigate/delete groups)
- [ ] `moveNodeUp`/`moveNodeDown` REMOVED from codexNode menus (Fact #46 — handlers reject non-index)
- [ ] indexNode context menu has all entries
- [ ] indexFile context menu has all entries
- [ ] indexFolder context menu has entries (addChildFile, addChildFolder, rename, openInFinder, trash)
- [ ] codexField/indexField menus use `viewItem ==` (no view filter)
- [ ] Multi-select menus wired (batchMoveToTrash, batchAddTags)
- [ ] autofixFolder menu entry removed
- [ ] Keybindings use `focusedView =~ /^chapterwiseCodex/` (works in all views)
- [ ] Delete key remapped to moveToTrash
- [ ] ALL existing keybindings migrated from exact `focusedView ==` to regex `focusedView =~`
- [ ] `openInFinder` title is OS-agnostic ("Reveal in File Explorer")
- [ ] `npm run compile` succeeds
- [ ] All changes committed
