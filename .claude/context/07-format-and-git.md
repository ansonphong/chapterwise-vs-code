# Format Conversion and Git Setup

## convertFormat.ts -- Codex <-> Markdown

`CodexMarkdownConverter` provides bidirectional conversion:

- **Codex to Markdown**: Extracts frontmatter fields (type, name, summary, tags, etc.) and body. Children are NOT included (warning shown). Tags converted to comma-delimited strings. Metadata fields mapped: author, updated, description, license.
- **Markdown to Codex**: Parses YAML frontmatter + body. Title from frontmatter > H1 > filename. Generates UUID if missing. Unknown frontmatter fields become attributes. Both YAML and JSON output supported.

Both directions offer keep-original or delete-original options via QuickPick flow.

## explodeCodex.ts -- Extract Children to Files

`CodexExploder.explode()` extracts inline children from a codex file:

1. User selects which types to extract (or all)
2. User provides output pattern with `{type}`, `{name}`, `{id}`, `{index}` placeholders
3. Each extracted child becomes a standalone V1.1 codex file inheriting parent metadata
4. Parent file's children array gets `include` directives replacing extracted nodes
5. Optional: dry run preview, backup, auto-fix extracted files

Security: filename sanitization (path traversal, hidden files, directory patterns), symlink rejection, output path boundary validation.

## implodeCodex.ts -- Merge Included Files Back

`CodexImploder.implode()` resolves include directives and merges content back:

1. Reads each included file, extracts entity data (strips standalone metadata)
2. Replaces include directive with merged content
3. Optional: recursive resolution, delete source files, delete empty folders
4. Circular include detection via `visitedPaths` Set

Security: path boundary validation, symlink rejection, re-validation before deletion.

## gitSetup.ts + gitSetup/wizard.ts -- Git Integration

**Individual commands**: `initializeGitRepository()`, `ensureGitIgnore()`, `setupGitLFS()`, `createInitialCommit()`

**Setup wizard** (`gitSetup/wizard.ts`): 6-step interactive flow:
1. Welcome + requirements check (Git installed? LFS? Already a repo?)
2. Repository initialization
3. .gitignore creation (writing-specific patterns from templates)
4. Git LFS setup (.gitattributes for images/audio/video/documents)
5. Initial commit
6. Completion summary with next steps

**Templates** (`gitSetup/templates.ts`): Predefined `.gitignore` and `.gitattributes` content. `appendUniqueLines()` merges new patterns into existing files section-by-section, skipping duplicates.

**Security**: All git commands use `execFile` (no shell), arguments validated against shell metacharacters, cwd validated against workspace boundary, 30s timeout.
