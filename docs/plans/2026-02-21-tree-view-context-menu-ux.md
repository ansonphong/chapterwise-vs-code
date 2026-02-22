# Tree View Context Menu & Node Management UX

**Date:** 2026-02-21
**Status:** Approved
**Goal:** Make the tree view a first-class outliner with full CRUD operations via context menus, keyboard shortcuts, and type-aware labels — comparable to Scrivener but with more power and elegance.

## Problem

The tree view has mechanical operations implemented in `structureEditor.ts` but they're not fully wired to the UI:

- Context menus only work for `codexNode` in FILES mode; `indexNode`, `indexFile`, `indexFolder` have minimal or no menus
- Missing operations: Add Field, Change Type, Change Icon, Add Tags, Add Relation, Duplicate, Cut/Paste, Extract to File
- No project-level trash system (currently uses OS trash, losing context)
- No type-aware labels in menus

## Design Decisions

1. **Type-aware labels** — "Add Chapter" not "Add Child" (derived from current node's type via simple capitalization)
2. **Auto-detect creation mode** — if parent's children use `include` directives, create new file; if inline, add inline child. Detection: check if any existing child has `isInclude: true`
3. **Project-level `.trash/` folder** with restore capability, added to `.gitignore`
4. **Common fields list** for Add Field (body, summary, description, notes, content, text)
5. **KISS principle** — no complex type hierarchies, no "smart" suggestions beyond local context

## Context Menus by Node Type

### codexNode (single-file mode)

| Group | Items |
|-------|-------|
| 1_add | Add Child [Type], Add Sibling [Type], Add Field |
| 2_edit | Rename, Change Type, Change Icon/Emoji, Add Tags, Add Relation |
| 3_move | Move Up, Move Down, Cut, Paste Here, Paste After |
| 4_navigate | Go to YAML, Copy ID, Duplicate [Type] |
| 5_delete | Delete (moves to .trash/) |

### indexNode (multi-file, node within file)

| Group | Items |
|-------|-------|
| 1_add | Add Child [Type], Add Sibling [Type], Add Field |
| 2_edit | Rename, Change Type, Change Icon/Emoji, Add Tags, Add Relation |
| 3_move | Move Up, Move Down |
| 4_navigate | Go to YAML, Copy ID, Duplicate [Type] |
| 5_delete | Delete (moves to .trash/) |

### indexFile (multi-file, file-level)

| Group | Items |
|-------|-------|
| 1_add | Add Child [Type], Add Sibling [Type], Add Field |
| 2_edit | Rename, Change Type, Change Icon/Emoji, Add Tags |
| 3_move | Move Up, Move Down |
| 4_navigate | Open File, Copy Path, Duplicate [Type] |
| 5_delete | Delete (moves to .trash/) |

### indexFolder

| Group | Items |
|-------|-------|
| 1_add | Add Child File |
| 2_edit | Rename Folder, Autofix Order |
| 4_navigate | Open in Finder |
| 5_delete | Delete (moves to .trash/) |

### codexField / indexField

| Group | Items |
|-------|-------|
| 2_edit | Rename Field |
| 4_navigate | Go to YAML |
| 5_delete | Delete Field |

## New Operations

### Add Field
- QuickPick with common fields: body, summary, description, notes, content, text
- Fields already on the node are grayed out / disabled
- Adds empty string value to YAML, refreshes tree

### Change Type
- QuickPick with common types: book, chapter, scene, character, location, item, event, note, world, faction, lore
- Current type pre-selected
- Updates `type` field in YAML, refreshes tree icon

### Change Icon/Emoji
- QuickPick with common emojis grouped by category
- Stores in node attributes or `typeStyles` in index
- Falls back to default type-based icon if none set

### Add Tags
- InputBox for comma-separated tags
- Appends to existing `tags` array (deduplicates)

### Add Relation
- Step 1: QuickPick listing all project nodes (searchable by name)
- Step 2: QuickPick for relation type (ally_of, located_in, member_of, or custom)
- Adds to `relations` array

### Duplicate Node
- Deep-copies with new UUIDs for all nodes
- File-backed: creates `filename-copy.codex.yaml`
- Inline: inserts as next sibling
- Name gets " (copy)" suffix

### Cut / Paste
- Cut: stores node reference in extension state (not system clipboard)
- Visual: cut node renders dimmed/italic with strikethrough
- Paste: "Paste [Type] Here" (as child) or "Paste [Type] After" (as sibling)
- Handles same-file and cross-file moves
- Clears cut state after paste

### Extract to File
- Available on inline nodes only
- Creates new `.codex.yaml` file from inline node
- Replaces inline node with `include` directive
- Preserves all children, fields, attributes

### Delete Field
- Removes field from node's YAML
- Confirmation if field has content

### Rename Field
- InputBox with current field name
- Updates field key in YAML

## Trash System

- **Location:** `.trash/` in workspace root
- **File-backed nodes:** moved to `.trash/` preserving relative path (e.g., `chapters/intro.codex.yaml` → `.trash/chapters/intro.codex.yaml`)
- **Inline nodes:** serialized to `.trash/_inline-deletions.codex.yaml` with timestamp for restore
- **Restore:** right-click in Trash tree section, or command palette "Restore from Trash"
- **Purge:** "Empty Trash" command permanently deletes `.trash/` contents
- **`.gitignore`:** automatically adds `.trash/` if not present
- **Confirmation dialog:** "Move [name] and its N children to trash?"

## Tree View Enhancements

- **Trash section:** collapsible "Trash" section at bottom of tree when `.trash/` has contents
- **Cut indicator:** cut nodes render with strikethrough description and dimmed icon
- **Empty state:** welcome message with "Create your first node" button when project is empty

## Keyboard Shortcuts

| Operation | Shortcut | Notes |
|-----------|----------|-------|
| Add Child | Cmd+Shift+N | Existing |
| Add Sibling | Cmd+N | New |
| Delete (trash) | Delete / Backspace | Existing (remap to trash) |
| Rename | F2 | VS Code standard |
| Move Up | Cmd+Up | Existing |
| Move Down | Cmd+Down | Existing |
| Duplicate | Cmd+D | New |
| Cut | Cmd+X | New, tree focus only |
| Paste | Cmd+V | New, tree focus only |

All shortcuts scoped to `when: "focusedView == chapterwiseCodexNavigator"`.

## No Changes Needed

- **Ordering system:** Fractional ordering in `.index.codex.json` already works well
- **Drag-and-drop:** Already fully implemented with circular reference prevention
- **Index generation:** Pipeline is solid with phase-based enhancement
- **Inline node ordering:** YAML `children` array position is authoritative

## Files to Modify

- `package.json` — add menu contributions, commands, keybindings, when clauses
- `src/extension.ts` — register new command handlers
- `src/structureEditor.ts` — add new operations (duplicate, extract, field ops, trash)
- `src/treeProvider.ts` — type-aware labels, cut indicator styling, trash section
- New: `src/trashManager.ts` — trash folder management, restore, purge
- New: `src/clipboardManager.ts` — cut/paste state management for tree nodes
