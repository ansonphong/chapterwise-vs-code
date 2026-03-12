# Search System

Seven files implement full-text search across codex projects.

## Architecture

```
searchUI.ts (QuickPick UI)
  -> queryParser.ts (parse input)
  -> searchEngine.ts (execute across tiers)
     -> scoring.ts (BM25 ranking)
     -> tokenizer.ts (text processing + fuzzy match)
  <- searchIndex.ts (data types)
  <- indexManager.ts (build, cache, watch)
```

## searchIndex.ts -- Data Types

`SearchIndex` contains three tiers:
- `titles: TitleEntry[]` -- node ID, name, type, path, boost
- `metadata: MetadataEntry[]` -- tags, attributes
- `content: ContentEntry[]` -- tokenized prose text
- `termIndex: Record<string, PostingList>` -- inverted index for BM25
- Corpus stats: `totalDocs`, `avgDocLength`

## indexManager.ts -- SearchIndexManager

- **Build**: 4 phases -- scan files (0-10%), index nodes (10-90%), build inverted index (90-95%), compute stats (95-100%). Yields to UI every 10 files.
- **Cache**: Saved as `.index-search.json` per context folder. Validated by sampling 10 file hashes. Expires after 7 days.
- **Incremental**: FileSystemWatcher queues changes, debounces 500ms, then re-indexes changed files and rebuilds inverted index.
- **Mutex**: `buildMutex` serializes concurrent build requests.

## queryParser.ts -- Query Syntax

- Basic terms: `aragorn sword` (fuzzy AND)
- Exact phrases: `"king of gondor"`
- Type filter: `type:character`
- Field filter: `body:dragon`, `summary:quest`
- Exclusions: `-type:location`, `-unwanted`
- Minimum term length: 2 characters

## searchEngine.ts -- 3-Tier Execution

1. **Tier 1 (Titles)**: Instant fuzzy match on names/IDs. Early return if enough results.
2. **Tier 2 (Metadata)**: Search tags and attributes.
3. **Tier 3 (Content)**: Tokenized prose search with BM25 scoring, snippet extraction.
Results ranked by score descending, tier ascending. Timeout at 2 seconds, limit 50 results.

## scoring.ts -- BM25 Ranking

Standard BM25 with K1=1.2, B=0.75. Boost factors: title match 3.0x, exact phrase 2.0x, root node 1.5x, tag match 1.3x, summary field 1.2x, deep nesting 0.8x.

## tokenizer.ts -- Text Processing

`tokenize()`: lowercase, strip non-alphanumeric (Unicode-aware), split on whitespace, min length 2. `fuzzyMatch()`: substring match always passes; Levenshtein distance thresholds: 0 for 1-3 chars, 1 for 4-6, 2 for 7+.

## searchUI.ts -- QuickPick Interface

VS Code QuickPick with debounced input (150ms), recent search history (10 entries), results grouped by tier with separators. Keybinding: Cmd+Alt+F.
