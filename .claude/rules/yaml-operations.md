# Rules: YAML & Codex Operations

Applies when creating or modifying code that reads or writes `.codex.yaml`, `.codex.json`, or `.codex.md` files.

## Mutation Safety

- **Use `withFileLock()` for all YAML writes** — Concurrent writes corrupt YAML. The file lock prevents race conditions when multiple operations (auto-save, structure editing, drag-drop) target the same file.
- **Preserve YAML comments and formatting** — `codexModel.ts` uses the `yaml` library's AST-preserving mode. Don't replace it with naive parse/stringify.
- **Validate after mutation** — After any structural change (add/remove/move nodes), run validation to catch broken references.

## Format Support

The extension handles three formats transparently:

| Format | Extension | Parser Path |
|--------|-----------|-------------|
| Codex YAML | `.codex.yaml` | `codexModel.ts` → `yaml` library |
| Codex JSON | `.codex.json` | `codexModel.ts` → `JSON.parse` |
| Codex Lite | `.md` with frontmatter | `codexModel.ts` → frontmatter extraction |

## Auto-Fixer

- `autoFixer.ts` repairs missing UUIDs, metadata, legacy fields, timecodes
- Auto-fixer is aggressive — it can recover severely corrupted files
- Always offer auto-fix via VS Code Quick Fix code actions, not silent mutation
