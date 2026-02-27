# Stage 3: StructureEditor Extensions — Field/Type/Tag/Duplicate/Extract Operations

> **Master plan:** `00-master-plan.md` — execute via Ralph Loop
>
> **Shared reference:** See `codebase-facts.md` for all codebase facts.
> **Prerequisite:** Stage 1 (buildYamlPath fix) must be complete.

**Goal:** Add methods to `CodexStructureEditor` for field operations (add/remove/rename), type changes, tags, relations, emoji, node duplication, and extraction to file.

**Architecture:** All methods follow the same YAML-edit pattern: parse → buildYamlPath → getIn/setIn/deleteIn → WorkspaceEdit → save. Two tasks: field/metadata ops (Task 3), then duplicate/extract (Task 4).

---

## Task 3: Field Operations + Metadata

**Files:**
- Modify: `src/structureEditor.ts`
- Modify: `src/structureEditor.test.ts`

### Step 1: Write failing tests

Add to `src/structureEditor.test.ts`:

Tests for:
- `addFieldToNode` — adds field to root node, returns false for existing field, works for nested children
- `removeFieldFromNode` — removes field from YAML
- `renameFieldOnNode` — renames field key
- `changeNodeType` — updates type field
- `addTagsToNode` — appends to tags array, deduplicates
- `addRelationToNode` — adds relation entry
- `setEmojiOnNode` — sets emoji field

Full test code: see original plan (lines 1467-1553).

### Step 2: Run tests — verify FAIL

Run: `cd /Users/phong/Projects/chapterwise-codex && npx vitest run src/structureEditor.test.ts`

### Step 3: Implement methods on CodexStructureEditor

All follow the pattern:
```typescript
async methodName(doc: vscode.TextDocument, node: CodexNode, ...args): Promise<boolean> {
  const yamlDoc = YAML.parseDocument(doc.getText());
  const yamlPath = this.buildYamlPath(node.path);
  // ... modify yamlDoc via setIn/deleteIn
  const newText = yamlDoc.toString();
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), newText);
  await vscode.workspace.applyEdit(edit);
  await doc.save();
  return true;
}
```

Methods to implement:
1. `addFieldToNode(doc, node, fieldName)` — check existence first, add empty string value
2. `removeFieldFromNode(doc, node, fieldName)` — deleteIn
3. `renameFieldOnNode(doc, node, oldName, newName)` — get value, delete old, set new
4. `changeNodeType(doc, node, newType)` — setIn `[...path, 'type']`
5. `addTagsToNode(doc, node, tags: string[])` — merge with existing, deduplicate
6. `addRelationToNode(doc, node, targetId, relationType)` — append to relations array
7. `setEmojiOnNode(doc, node, emoji)` — setIn `[...path, 'emoji']`

**IMPORTANT:** Use `this.buildYamlPath(node.path)` (now fixed in Task 0). For field access, append field name: `[...yamlPath, 'fieldName']`.

### Step 4: Run tests — verify PASS

### Step 5: Commit

```bash
git add src/structureEditor.ts src/structureEditor.test.ts
git commit -m "feat: add field operations to structureEditor (add/remove/rename field, change type, tags, relations, emoji)"
```

---

## Task 4: Duplicate Node + Extract to File

**Files:**
- Modify: `src/structureEditor.ts`
- Modify: `src/structureEditor.test.ts`

### Step 1: Write failing tests

Tests for:
- `duplicateNodeInDocument` — creates sibling copy with new ID, "(copy)" suffix
- `extractNodeToFile` — creates new file, replaces inline with include directive

### Step 2: Implement methods

**`duplicateNodeInDocument(doc, node)`:**
1. Parse YAML, get node via `buildYamlPath`
2. Deep clone the JS value
3. `regenerateChildIds(clone)` — recursively replace all `id` fields with `crypto.randomUUID()`
4. Set name to `"${originalName} (copy)"`
5. Insert after current node in parent's children array
6. Apply WorkspaceEdit

**`extractNodeToFile(doc, node, workspaceRoot)`:**
1. Parse YAML, get node content via `buildYamlPath`
2. Create new `.codex.yaml` file with node content (slugified name)
3. Replace node in parent with `includePath` directive: `includePath: ./relative/path.codex.yaml` (Fact #34: use `includePath`, NOT `include`)
4. Apply edits to both files

### Step 3: Run tests — verify PASS

### Step 4: Commit

```bash
git add src/structureEditor.ts src/structureEditor.test.ts
git commit -m "feat: add duplicateNodeInDocument and extractNodeToFile to structureEditor"
```

---

## Stage 3 Completion Checklist

- [ ] `addFieldToNode` — adds field, rejects duplicates, works on nested nodes
- [ ] `removeFieldFromNode` — removes field from YAML
- [ ] `renameFieldOnNode` — renames field key in YAML
- [ ] `changeNodeType` — updates type field
- [ ] `addTagsToNode` — appends and deduplicates
- [ ] `addRelationToNode` — adds to relations array
- [ ] `setEmojiOnNode` — sets emoji field
- [ ] `duplicateNodeInDocument` — deep copy with new UUIDs
- [ ] `extractNodeToFile` — creates file, replaces with `includePath` directive (Fact #34)
- [ ] All new methods have test coverage
- [ ] `npm test` passes
- [ ] `npm run compile` succeeds
- [ ] All changes committed
