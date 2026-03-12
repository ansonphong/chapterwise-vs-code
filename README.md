# ChapterWise Extension

**A VS Code Extension (also works with Cursor)**

ChapterWise turns your code editor into a writing app with tree navigation, distraction-free prose editing, transformation commands, and format validation. Supports `.codex.yaml`, `.codex.json`, and Markdown files as Codex Lite format.

**ChapterWise is the IDE for Writers.** Debug your plot, version-control your drafts, and compile your book like code.

## Features

### 📚 ChapterWise Navigator (Tree View)

A sidebar tree view showing all nodes in your Codex file:

- **Hierarchical view** of your document structure
- **Filter by type** (chapters, characters, locations, etc.)
- **Click to navigate** directly to any node in the file
- **Include directive support** — shows referenced file paths
- **Context menu** with Go to YAML and Copy ID
- **Auto-refresh** when files are saved

### ✍️ Writer View

Distraction-free prose editing:

- **Serif typography** for comfortable reading
- **Dark theme** matching Cursor/VS Code
- **Auto-save** on blur or after 2 seconds of inactivity
- **Word count** and character count
- **Keyboard shortcuts** (Ctrl+S to save)

### ✅ Validation & Diagnostics

Real-time format checking:

- Schema validation for Codex V1.0 and V1.1
- Problems panel integration
- Inline squiggly underlines for errors
- **Quick fixes** for common issues:
  - Add missing metadata
  - Add formatVersion
  - Generate UUIDs for missing IDs
  - Convert from legacy format

### 💥 Explode Codex

Extract child nodes into separate files for modular organization:

- **Filter by type** — only extract specific node types (characters, locations, etc.)
- **Custom output folder** — choose where extracted files are saved
- **Dry run mode** — preview changes before executing
- **Include directives** — automatically replaces extracted nodes with `include:` references
- **Git-friendly** — perfect for version control and collaboration

**Command:** `ChapterWise: Explode Codex`

### 🔄 Implode Codex

Merge included files back into the parent document:

- **Recursive processing** — follows includes within included files
- **Backup creation** — optionally save a backup before modifying
- **Source file cleanup** — delete original files after merging
- **Empty folder removal** — cleans up folders that become empty
- **Dry run mode** — preview what will be merged

**Command:** `ChapterWise: Implode Codex (Merge Included Files)`

### 📊 Update Word Count

Track word counts across your manuscript:

- **Counts body fields** — tallies words in all `body` content
- **Updates attributes** — adds/updates `word_count` attribute on each node
- **Recursive counting** — processes all children
- **Include support** — optionally count words in included files

**Command:** `ChapterWise: Update Word Count`

### 🏷️ Generate Tags

AI-powered tag extraction from your content:

- **NLP-based analysis** — extracts meaningful terms and phrases
- **Unigrams and bigrams** — captures both single words and two-word phrases
- **Heading boost** — terms in markdown headings get extra weight
- **Stopword filtering** — removes common words automatically
- **Two output formats:**
  - **Simple** — array of tag strings
  - **Detailed** — objects with `name` and `count` fields
- **Configurable options:**
  - Max tags (1-100)
  - Min occurrences threshold
  - Follow includes

**Command:** `ChapterWise: Generate Tags`

### 📝 Snippets

Quick templates for common node types:

| Prefix | Description |
|--------|-------------|
| `codex-meta` | New Codex file with metadata |
| `codex-character` | Character node |
| `codex-chapter` | Chapter node |
| `codex-scene` | Scene node |
| `codex-location` | Location node |
| `codex-attr` | Attribute entry |
| `codex-rel` | Relation entry |

## Getting Started

1. **Install the extension** in VS Code or Cursor (from VSIX or marketplace)
2. **Open a `.codex.yaml` file** (or create one using snippets)
3. **Click the ChapterWise icon** in the activity bar to open the Navigator
4. **Click any node** to navigate to it in the editor
5. **Use commands** via the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)

## Commands

Access all commands via the Command Palette:

| Command | Description |
|---------|-------------|
| `ChapterWise: Explode Codex` | Extract children to separate files |
| `ChapterWise: Implode Codex` | Merge included files back |
| `ChapterWise: Update Word Count` | Count words in body fields |
| `ChapterWise: Generate Tags` | Extract tags from content |
| `ChapterWise: Open Writer's View` | Focused writing mode |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+Shift+P` | Open Command Palette |
| `Cmd/Ctrl+Shift+W` | Open Writer View for current node |
| `Cmd/Ctrl+Shift+E` | Focus Explorer (ChapterWise Tree) |
| `Cmd/Ctrl+S` (in Writer) | Save changes |
| `Cmd/Ctrl+.` | Quick fix suggestions |

## Codex Format

This extension supports the [ChapterWise Codex Format V1.1](https://chapterwise.app/docs/codex/format/codex-format).

### Minimal Example

```yaml
metadata:
  formatVersion: "1.1"

id: "my-book"
type: book
name: "My Novel"
summary: |
  A brief description of my book.

children:
  - id: "ch-1"
    type: chapter
    name: "Chapter 1"
    body: |
      The story begins...
```

### Include Directives

Modularize your codex with includes:

```yaml
children:
  - include: "./characters/protagonist.codex.yaml"
  - include: "./chapters/chapter-01.codex.yaml"
  - include: "./locations/castle.codex.yaml"
```

### Tags (Simple Format)

```yaml
tags:
  - protagonist
  - roman-era
  - awakened
```

### Tags (Detailed Format)

```yaml
tags:
  - name: Roman
    count: 15
  - name: Awakening
    count: 8
  - name: Senate
    count: 5
```

## File Support

| Extension | Format |
|-----------|--------|
| `.codex.yaml` | YAML format (recommended) - [Full Codex Format](https://chapterwise.app/docs/codex/format/codex-format) |
| `.codex.json` | JSON format - [Full Codex Format](https://chapterwise.app/docs/codex/format/codex-format) |
| `.md` | Markdown (Codex Lite) - [Codex Lite Format](https://chapterwise.app/docs/codex/format/codex-lite) |

## Compatibility

This extension works with both:

- **Visual Studio Code** — Version 1.80.0 or later
- **Cursor** — All versions (Cursor is built on VS Code, so all features work seamlessly)

## Development

### Setup

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes
npm run watch
```

### Testing in Cursor/VS Code

1. Run `npm run watch` in terminal
2. Press F5 or run "Developer: Reload Window" to test changes
3. Open Developer Tools to see console logs

### Building VSIX

```bash
# Full build and package
npm run compile
npm run package

# Install in VS Code
code --install-extension chapterwise-0.3.2.vsix --force

# Install in Cursor
cursor --install-extension chapterwise-0.3.2.vsix --force
```

## Documentation

Full documentation available at:
- [VS Code Extension Guide](https://chapterwise.app/docs/vscode-extension/)
- [Installation Instructions](https://chapterwise.app/docs/vscode-extension/installation)
- [Feature Reference](https://chapterwise.app/docs/vscode-extension/features)
- [Codex Format Specification](https://chapterwise.app/docs/codex/format/codex-format)

## License

MIT

---

Made with ❤️ for storytellers
