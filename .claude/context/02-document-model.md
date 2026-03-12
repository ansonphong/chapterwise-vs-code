# Document Model

## File: `src/codexModel.ts` (1260 lines)

Pure-logic module (no VS Code dependency) that parses and mutates codex documents.

## Core Types

- **`CodexDocument`**: Parsed document with `metadata`, `rootNode`, `allNodes` (flat), `types` (Set), `rawDoc` (YAML AST), `isJson`, `isMarkdown`, `rawText`
- **`CodexNode`**: Tree node with `id`, `type`, `name`, `proseField`/`proseValue`, `availableFields`, `path` (PathSegment[]), `lineNumber`, `children`, `parent`, `attributes`, `contentSections`, `relations`, `tags`, `images`
- **`CodexAttribute`**: `{ key, name?, value, dataType?, id?, type? }`
- **`CodexContentSection`**: `{ key, name, value, id?, type? }`
- **`CodexRelation`**: `{ targetId, type?, kind?, strength?, reciprocal?, description? }`

## Three Format Parsers

| Format | Function | Extensions |
|---|---|---|
| YAML | `parseCodex(text)` | `.codex.yaml`, `.codex` |
| JSON | `parseCodex(text)` (auto-detected) | `.codex.json` |
| Markdown (Codex Lite) | `parseMarkdownAsCodex(text, fileName?)` | `.md` with YAML frontmatter |

## Prose Fields

Priority order: `body`, `summary`, `description`, `content`, `text`. Codex Lite only supports `body` and `summary`.

## AST-Preserving Mutations

YAML mutations use the `yaml` library's AST manipulation (`doc.setIn()`) to preserve formatting, comments, and block scalar style. JSON mutations use parse/modify/re-stringify.

- `setNodeProse()` / `setMarkdownNodeProse()` -- update prose content
- `setNodeName()` / `setNodeType()` -- update name/type fields
- `setNodeAttributes()` / `setNodeContentSections()` -- replace arrays
- `setMarkdownFrontmatterField()` -- update single frontmatter field

Long strings (>60 chars or containing newlines) automatically use YAML block literal (`|`) style via `createBlockScalarIfNeeded()`.

## Validation

`validateCodex()` checks: formatVersion present, UUID v4 format, duplicate IDs, missing type fields, empty documents.

## Utilities

- `generateUuid()` -- crypto.randomUUID()
- `createMinimalCodex(type, name)` -- scaffold a new document
- `isCodexFile()` / `isMarkdownFile()` / `isCodexLikeFile()` -- extension checks
