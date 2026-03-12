# ChapterWise Codex Search System Design

**Date:** 2026-02-05
**Status:** Approved
**Author:** Claude + User collaborative design session

---

## Table of Contents

1. [Overview](#1-overview)
2. [Requirements](#2-requirements)
3. [Architecture](#3-architecture)
4. [Search Index Structure](#4-search-index-structure)
5. [Query Parser & Search Syntax](#5-query-parser--search-syntax)
6. [Search Execution & Ranking](#6-search-execution--ranking)
7. [QuickPick UI & UX](#7-quickpick-ui--ux)
8. [Index Manager & Background Worker](#8-index-manager--background-worker)
9. [File Structure & Integration](#9-file-structure--integration)
10. [Implementation Plan](#10-implementation-plan)
11. [Best Practices Validation](#11-best-practices-validation)
12. [Success Criteria](#12-success-criteria)
13. [Future Enhancements](#13-future-enhancements)

---

## 1. Overview

### 1.1 Problem Statement

The ChapterWise Codex tree view (`treeProvider.ts`) displays hierarchical content from `.codex.yaml`, `.codex.json`, and `.md` files. Users need a fast, powerful way to search across:

- Node titles and names
- Metadata (tags, attributes, types)
- Full prose content (body, summary, description fields)

### 1.2 Solution Summary

A tiered search system with:

- **QuickPick UI** (VS Code native, keyboard-first)
- **Background indexing** with persistent cache
- **Progressive search** (titles instant, content async)
- **Rich syntax** (fuzzy, exact phrases, type/field filters)

### 1.3 Scale Target

- **100-500 files** (10-50MB total)
- Multiple books, extensive character databases
- Entire fictional universes, multi-series projects

---

## 2. Requirements

### 2.1 Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR1 | Search node titles/names with instant results (<50ms) | P0 |
| FR2 | Search metadata (tags, attributes, types) | P0 |
| FR3 | Search full prose content (body, summary, etc.) | P0 |
| FR4 | Support fuzzy matching for typo tolerance | P1 |
| FR5 | Support exact phrase matching with quotes | P1 |
| FR6 | Support type filters (`type:character`) | P1 |
| FR7 | Support field filters (`body:dragon`) | P1 |
| FR8 | Support exclusion filters (`-type:location`) | P2 |
| FR9 | Show recent searches when opening empty search | P2 |
| FR10 | Highlight matching terms in results | P1 |

### 2.2 Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR1 | Title search response time | < 50ms |
| NFR2 | Full content search time (500 files) | < 2 seconds |
| NFR3 | Index build time (500 files) | < 30 seconds |
| NFR4 | Cache load time | < 100ms |
| NFR5 | File change reflection in search | < 1 second |
| NFR6 | Memory usage for index | < 50MB |

### 2.3 User Experience Requirements

| ID | Requirement |
|----|-------------|
| UX1 | Keyboard-first navigation (no mouse required) |
| UX2 | Results grouped by tier (Titles → Metadata → Content) |
| UX3 | Context-aware result actions (Writer View vs Tree reveal) |
| UX4 | Visual progress indicator during indexing |
| UX5 | Graceful degradation when index is building |

---

## 3. Architecture

### 3.1 System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    User Interface                            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  QuickPick Search (Cmd+Shift+F or toolbar icon)     │    │
│  │  - Live results as you type (150ms debounce)        │    │
│  │  - Grouped by: Titles → Metadata → Content          │    │
│  │  - Type/field filter chips                          │    │
│  │  - Recent searches on empty input                   │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Search Engine                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │  Query Parser   │  │  Tiered Search  │  │  BM25       │  │
│  │  - Tokenize     │  │  - Tier 1: Title│  │  Scoring    │  │
│  │  - Extract      │  │  - Tier 2: Meta │  │  - TF/IDF   │  │
│  │    filters      │  │  - Tier 3: Body │  │  - Length   │  │
│  │  - Fuzzy/exact  │  │  - Early exit   │  │    norm     │  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Search Index                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │  Title Index    │  │  Metadata Index │  │  Content    │  │
│  │  - Node names   │  │  - Tags         │  │  Index      │  │
│  │  - IDs          │  │  - Attributes   │  │  - Prose    │  │
│  │  - Boost scores │  │  - Types        │  │  - Tokens   │  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Inverted Index (termIndex)                          │    │
│  │  term → [{docId, tier, positions[], score}]          │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Index Manager                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │  Background     │  │  Persistent     │  │  File       │  │
│  │  Worker         │  │  Cache          │  │  Watcher    │  │
│  │  - Async build  │  │  - JSON file    │  │  - Debounce │  │
│  │  - Progress     │  │  - Hash valid.  │  │  - Incremental│ │
│  │  - Yield to UI  │  │  - TTL check    │  │  - Batch    │  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow

```
User types query
       │
       ▼
┌──────────────────┐
│ Debounce (150ms) │
└──────────────────┘
       │
       ▼
┌──────────────────┐
│ Parse Query      │──→ ParsedQuery {terms, phrases, filters}
└──────────────────┘
       │
       ▼
┌──────────────────┐
│ Search Tier 1    │──→ Title matches (instant)
│ (Titles)         │
└──────────────────┘
       │
       ▼
┌──────────────────┐
│ Early Exit?      │──→ If enough results + simple query → return
└──────────────────┘
       │ No
       ▼
┌──────────────────┐
│ Search Tier 2    │──→ Metadata matches (fast)
│ (Metadata)       │
└──────────────────┘
       │
       ▼
┌──────────────────┐
│ Search Tier 3    │──→ Content matches (async)
│ (Content)        │
└──────────────────┘
       │
       ▼
┌──────────────────┐
│ Rank & Dedupe    │──→ BM25 scoring, remove duplicates
└──────────────────┘
       │
       ▼
┌──────────────────┐
│ Format Results   │──→ QuickPickItems with icons, highlights
└──────────────────┘
       │
       ▼
┌──────────────────┐
│ Display in       │
│ QuickPick        │
└──────────────────┘
```

### 3.3 Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| `searchIndex.ts` | Type definitions for all index structures |
| `tokenizer.ts` | Text tokenization, fuzzy matching, Levenshtein distance |
| `queryParser.ts` | Parse user input into structured ParsedQuery |
| `searchEngine.ts` | Execute searches across tiers, BM25 scoring |
| `indexManager.ts` | Build index, manage cache, watch files |
| `searchUI.ts` | QuickPick interface, result formatting, user actions |

---

## 4. Search Index Structure

### 4.1 Type Definitions

```typescript
/**
 * Complete search index structure
 * Stored in memory and persisted to .index-search.json
 */
interface SearchIndex {
  // Metadata
  version: string;                          // Index format version (for cache invalidation)
  created: number;                          // Timestamp for staleness checks
  contextFolder: string;                    // Which folder this index covers

  // File tracking for incremental updates
  fileHashes: Record<string, string>;       // path → content hash

  // Tier 1: Titles (instant search)
  titles: TitleEntry[];

  // Tier 2: Metadata (fast search)
  metadata: MetadataEntry[];

  // Tier 3: Content (full-text search)
  content: ContentEntry[];

  // Inverted index for O(1) term lookups
  termIndex: Record<string, PostingList>;

  // BM25 corpus statistics
  avgDocLength: number;                     // Average document length
  totalDocs: number;                        // Total document count
}

/**
 * Title index entry - for instant name/ID searches
 */
interface TitleEntry {
  id: string;                               // Node ID
  name: string;                             // Display name
  type: string;                             // Node type (character, chapter, etc.)
  path: string;                             // File path for navigation
  nodePath?: string[];                      // Path within file (for nested nodes)
  boost: number;                            // Relevance boost (root nodes > nested)
}

/**
 * Metadata index entry - for tag/attribute searches
 */
interface MetadataEntry {
  id: string;                               // Node ID
  tags: string[];                           // All tags on this node
  attributes: Record<string, string>;       // key-value attributes
  type: string;                             // Node type
  path: string;                             // File path
  nodePath?: string[];                      // Path within file
}

/**
 * Content index entry - for full-text prose searches
 */
interface ContentEntry {
  id: string;                               // Node ID
  field: string;                            // Which field (body, summary, description)
  text: string;                             // Raw text for snippet extraction
  tokens: string[];                         // Pre-tokenized for fast matching
  length: number;                           // Document length for BM25 normalization
  path: string;                             // File path
  nodePath?: string[];                      // Path within file
}

/**
 * Inverted index posting list - for O(1) term lookups
 */
interface PostingList {
  term: string;                             // The indexed term
  docs: Array<{
    id: string;                             // Document/node ID
    tier: 1 | 2 | 3;                        // Which tier this match is in
    positions: number[];                    // Token positions for phrase matching
    score: number;                          // Pre-computed BM25 score component
  }>;
}
```

### 4.2 Index Storage

**Memory Index:**
- Loaded on context folder activation
- Updated incrementally on file changes
- Used for all search operations

**Persistent Cache (`.index-search.json`):**
```
project/
├── E02/
│   ├── .index.codex.json        # Existing structure index
│   ├── .index-search.json       # NEW: Search index cache
│   ├── characters/
│   │   ├── aragorn.codex.yaml
│   │   └── gandalf.codex.yaml
│   └── chapters/
│       ├── chapter-01.codex.yaml
│       └── chapter-02.codex.yaml
```

### 4.3 Boost Factors

| Factor | Boost Value | Rationale |
|--------|-------------|-----------|
| Title match | 3.0x | User likely searching for specific node |
| Root-level node | 1.5x | More important than deeply nested |
| Tag match | 1.3x | Tags are intentional categorization |
| Exact phrase | 2.0x | User wants precise match |
| Recent file (< 24h) | 1.1x | Likely more relevant to current work |
| Field: summary | 1.2x | Summaries are high-signal content |
| Field: body | 1.0x | Default weight |
| Nested node (depth 3+) | 0.8x | Less prominent content |

---

## 5. Query Parser & Search Syntax

### 5.1 Search Syntax Reference

| Syntax | Example | Description |
|--------|---------|-------------|
| Basic term | `aragorn` | Fuzzy match in titles, then metadata, then content |
| Multiple terms | `aragorn sword` | All terms must match (AND logic) |
| Exact phrase | `"king of gondor"` | Exact phrase match, no fuzzy |
| Type filter | `type:character` | Only search nodes of this type |
| Field filter | `body:dragon` | Only search in body fields |
| Negation | `-type:location` | Exclude this type from results |
| Term negation | `-unwanted` | Exclude results containing this term |
| Combined | `type:chapter body:"dark forest"` | Chapter nodes with exact phrase in body |

### 5.2 Supported Filters

**Type Filters (`type:`):**
- `type:character`
- `type:chapter`
- `type:location`
- `type:scene`
- `type:item`
- `type:note`
- `type:book`
- `type:folder`

**Field Filters (`field:`):**
- `body:` - Body/prose content
- `summary:` - Summary field
- `description:` - Description field
- `attributes:` - Attribute values
- `tags:` - Tag values

### 5.3 Query Parser Implementation

```typescript
/**
 * Parsed query structure
 */
interface ParsedQuery {
  // Raw terms (fuzzy matched)
  terms: string[];

  // Exact phrases (quoted)
  phrases: string[];

  // Filters
  filters: {
    types: string[];                        // type:character, type:chapter
    fields: string[];                       // body:, summary:, attributes:
    exclude: {
      types: string[];                      // -type:location
      terms: string[];                      // -unwanted
    };
  };

  // Search scope (can be limited by user)
  scope: 'titles' | 'metadata' | 'all';
}

/**
 * Parse user input into structured query
 */
function parseQuery(input: string): ParsedQuery {
  const result: ParsedQuery = {
    terms: [],
    phrases: [],
    filters: {
      types: [],
      fields: [],
      exclude: { types: [], terms: [] }
    },
    scope: 'all'
  };

  // 1. Extract quoted phrases: "exact phrase"
  const phraseRegex = /"([^"]+)"/g;
  let match;
  while ((match = phraseRegex.exec(input)) !== null) {
    result.phrases.push(match[1].toLowerCase());
  }
  const withoutPhrases = input.replace(phraseRegex, ' ');

  // 2. Tokenize remaining input
  const tokens = withoutPhrases.split(/\s+/).filter(Boolean);

  // 3. Classify each token
  for (const token of tokens) {
    const lower = token.toLowerCase();

    if (lower.startsWith('type:')) {
      result.filters.types.push(lower.slice(5));
    } else if (lower.startsWith('-type:')) {
      result.filters.exclude.types.push(lower.slice(6));
    } else if (lower.match(/^(body|summary|description|attributes|tags):/)) {
      result.filters.fields.push(lower);
    } else if (lower.startsWith('-') && lower.length > 1) {
      result.filters.exclude.terms.push(lower.slice(1));
    } else {
      result.terms.push(lower);
    }
  }

  return result;
}
```

### 5.4 Fuzzy Matching Strategy

| Term Length | Max Edit Distance | Example |
|-------------|-------------------|---------|
| 1-3 chars | 0 (exact only) | "the" → exact match only |
| 4-6 chars | 1 typo allowed | "swrod" → "sword" |
| 7+ chars | 2 typos allowed | "chaarcter" → "character" |

**Levenshtein Distance Implementation:**

```typescript
/**
 * Calculate edit distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,  // substitution
          matrix[i][j - 1] + 1,      // insertion
          matrix[i - 1][j] + 1       // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Check if term fuzzy-matches target
 */
function fuzzyMatch(term: string, target: string): boolean {
  // Exact match always passes
  if (target.includes(term)) return true;

  // Determine max edit distance based on term length
  let maxDistance: number;
  if (term.length <= 3) {
    maxDistance = 0;  // Exact only for short terms
  } else if (term.length <= 6) {
    maxDistance = 1;
  } else {
    maxDistance = 2;
  }

  // Check each word in target
  const targetWords = target.toLowerCase().split(/\s+/);
  for (const word of targetWords) {
    if (levenshteinDistance(term, word) <= maxDistance) {
      return true;
    }
  }

  return false;
}
```

---

## 6. Search Execution & Ranking

### 6.1 Search Result Structure

```typescript
/**
 * Individual search result
 */
interface SearchResult {
  id: string;                               // Node ID
  name: string;                             // Display name
  type: string;                             // Node type
  path: string;                             // File path
  nodePath?: string[];                      // Path within file (for nested nodes)
  field?: string;                           // Which field matched (for content hits)
  snippet?: string;                         // Highlighted excerpt (for content hits)
  score: number;                            // BM25 relevance score
  tier: 1 | 2 | 3;                          // Which tier matched
  matchType: 'title' | 'tag' | 'attribute' | 'content';
}
```

### 6.2 Tiered Search Execution

```typescript
/**
 * Execute search across all tiers
 */
async function executeSearch(
  query: ParsedQuery,
  index: SearchIndex,
  options: { limit: number; timeout: number }
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const seen = new Set<string>();  // Dedupe by node ID
  const startTime = Date.now();

  // ═══════════════════════════════════════════════════════════
  // TIER 1: Titles (always instant, < 10ms)
  // ═══════════════════════════════════════════════════════════
  const titleResults = searchTitles(query, index.titles);
  for (const r of titleResults) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      results.push({ ...r, tier: 1 });
    }
  }

  // Early return if we have enough title matches for simple queries
  if (results.length >= options.limit && query.terms.length <= 2) {
    return results.slice(0, options.limit);
  }

  // ═══════════════════════════════════════════════════════════
  // TIER 2: Metadata (fast, < 30ms)
  // ═══════════════════════════════════════════════════════════
  const metaResults = searchMetadata(query, index.metadata);
  for (const r of metaResults) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      results.push({ ...r, tier: 2 });
    }
  }

  // Check timeout
  if (Date.now() - startTime > options.timeout) {
    return rankResults(results).slice(0, options.limit);
  }

  // ═══════════════════════════════════════════════════════════
  // TIER 3: Content (async, may be slow)
  // ═══════════════════════════════════════════════════════════
  if (query.scope === 'all' || query.filters.fields.length > 0) {
    const contentResults = await searchContent(
      query,
      index,
      options.timeout - (Date.now() - startTime)
    );

    for (const r of contentResults) {
      // Allow same node with different fields
      const key = r.id + (r.field || '');
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ ...r, tier: 3 });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Rank and return
  // ═══════════════════════════════════════════════════════════
  return rankResults(results).slice(0, options.limit);
}

/**
 * Rank results by score, then by tier
 */
function rankResults(results: SearchResult[]): SearchResult[] {
  return results.sort((a, b) => {
    // Primary: score descending
    if (b.score !== a.score) return b.score - a.score;
    // Secondary: tier ascending (titles before content)
    return a.tier - b.tier;
  });
}
```

### 6.3 BM25 Scoring Implementation

```typescript
// BM25 parameters (empirically tuned defaults)
const K1 = 1.2;    // Term frequency saturation (1.2-2.0 typical)
const B = 0.75;    // Document length normalization (0.75 typical)

/**
 * Calculate BM25 score for a term in a document
 */
function calculateBM25(
  termFreq: number,           // How often term appears in doc
  docLength: number,          // Document length (token count)
  avgDocLength: number,       // Average doc length in corpus
  docFreq: number,            // How many docs contain term
  totalDocs: number           // Total docs in corpus
): number {
  // IDF component: log((N - df + 0.5) / (df + 0.5) + 1)
  const idf = Math.log(
    (totalDocs - docFreq + 0.5) / (docFreq + 0.5) + 1
  );

  // TF component with length normalization
  const tfNorm = (termFreq * (K1 + 1)) / (
    termFreq + K1 * (1 - B + B * (docLength / avgDocLength))
  );

  return idf * tfNorm;
}

/**
 * Score a document against a query
 */
function scoreDocument(
  query: ParsedQuery,
  docId: string,
  index: SearchIndex
): number {
  let score = 0;

  // Score each query term
  for (const term of query.terms) {
    const posting = index.termIndex[term];
    if (!posting) continue;

    const docPosting = posting.docs.find(d => d.id === docId);
    if (!docPosting) continue;

    const contentEntry = index.content.find(c => c.id === docId);
    const docLength = contentEntry?.length || 100;

    score += calculateBM25(
      docPosting.positions.length,   // term frequency
      docLength,
      index.avgDocLength,
      posting.docs.length,           // document frequency
      index.totalDocs
    );
  }

  // Apply boost factors
  const titleEntry = index.titles.find(t => t.id === docId);
  if (titleEntry) {
    score *= titleEntry.boost;
  }

  // Exact phrase bonus
  if (query.phrases.length > 0) {
    const hasPhrase = checkExactPhrases(query.phrases, docId, index);
    score *= hasPhrase ? 2.0 : 0.5;
  }

  return score;
}

/**
 * Check if document contains exact phrases using position data
 */
function checkExactPhrases(
  phrases: string[],
  docId: string,
  index: SearchIndex
): boolean {
  for (const phrase of phrases) {
    const phraseTokens = phrase.split(/\s+/);
    if (phraseTokens.length < 2) continue;

    // Get positions for first token
    const firstPosting = index.termIndex[phraseTokens[0]];
    if (!firstPosting) return false;

    const firstDoc = firstPosting.docs.find(d => d.id === docId);
    if (!firstDoc) return false;

    // Check if subsequent tokens appear at consecutive positions
    for (const startPos of firstDoc.positions) {
      let matches = true;
      for (let i = 1; i < phraseTokens.length; i++) {
        const tokenPosting = index.termIndex[phraseTokens[i]];
        if (!tokenPosting) { matches = false; break; }

        const tokenDoc = tokenPosting.docs.find(d => d.id === docId);
        if (!tokenDoc) { matches = false; break; }

        if (!tokenDoc.positions.includes(startPos + i)) {
          matches = false;
          break;
        }
      }
      if (matches) return true;
    }
  }

  return false;
}
```

---

## 7. QuickPick UI & UX

### 7.1 QuickPick Configuration

```typescript
/**
 * Open the search UI
 */
async function openSearchUI(
  index: SearchIndex,
  indexManager: SearchIndexManager
): Promise<void> {
  const quickPick = vscode.window.createQuickPick<SearchResultItem>();

  // ═══════════════════════════════════════════════════════════
  // Configuration
  // ═══════════════════════════════════════════════════════════
  quickPick.placeholder = 'Search nodes... (use type: field: "exact" for filters)';
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.keepScrollPosition = true;
  quickPick.busy = false;

  // Show recent searches initially
  quickPick.items = getRecentSearches();

  // ═══════════════════════════════════════════════════════════
  // Debounced search (150ms)
  // ═══════════════════════════════════════════════════════════
  let debounceTimer: NodeJS.Timeout;

  quickPick.onDidChangeValue(value => {
    clearTimeout(debounceTimer);

    if (!value.trim()) {
      quickPick.items = getRecentSearches();
      return;
    }

    debounceTimer = setTimeout(async () => {
      quickPick.busy = true;

      try {
        const results = await executeSearch(
          parseQuery(value),
          index,
          { limit: 50, timeout: 2000 }
        );
        quickPick.items = formatResults(results, value);
      } catch (error) {
        console.error('[Search] Error:', error);
        quickPick.items = [{
          label: '$(error) Search error',
          description: String(error)
        }];
      } finally {
        quickPick.busy = false;
      }
    }, 150);
  });

  // ═══════════════════════════════════════════════════════════
  // Handle selection
  // ═══════════════════════════════════════════════════════════
  quickPick.onDidAccept(() => {
    const selected = quickPick.selectedItems[0];
    if (selected && 'resultData' in selected) {
      saveRecentSearch(quickPick.value);
      handleResultSelection(selected as SearchResultItem);
    }
    quickPick.hide();
  });

  // ═══════════════════════════════════════════════════════════
  // Handle keyboard shortcuts
  // ═══════════════════════════════════════════════════════════
  quickPick.onDidTriggerButton(button => {
    // Handle custom buttons if needed
  });

  quickPick.show();
}
```

### 7.2 Result Formatting

```typescript
/**
 * Extended QuickPickItem with search result data
 */
interface SearchResultItem extends vscode.QuickPickItem {
  resultData?: SearchResult;
}

/**
 * Format search results for QuickPick display
 */
function formatResults(results: SearchResult[], query: string): SearchResultItem[] {
  const items: SearchResultItem[] = [];

  // Group by tier
  const titleResults = results.filter(r => r.tier === 1);
  const metaResults = results.filter(r => r.tier === 2);
  const contentResults = results.filter(r => r.tier === 3);

  // ═══════════════════════════════════════════════════════════
  // Tier 1: Titles
  // ═══════════════════════════════════════════════════════════
  if (titleResults.length > 0) {
    items.push({
      label: 'Titles',
      kind: vscode.QuickPickItemKind.Separator
    });
    items.push(...titleResults.map(r => formatResultItem(r, query)));
  }

  // ═══════════════════════════════════════════════════════════
  // Tier 2: Tags & Attributes
  // ═══════════════════════════════════════════════════════════
  if (metaResults.length > 0) {
    items.push({
      label: 'Tags & Attributes',
      kind: vscode.QuickPickItemKind.Separator
    });
    items.push(...metaResults.map(r => formatResultItem(r, query)));
  }

  // ═══════════════════════════════════════════════════════════
  // Tier 3: Content
  // ═══════════════════════════════════════════════════════════
  if (contentResults.length > 0) {
    items.push({
      label: 'Content',
      kind: vscode.QuickPickItemKind.Separator
    });
    items.push(...contentResults.map(r => formatResultItem(r, query)));
  }

  // ═══════════════════════════════════════════════════════════
  // No results message
  // ═══════════════════════════════════════════════════════════
  if (items.length === 0) {
    items.push({
      label: '$(info) No results found',
      description: 'Try different keywords or remove filters'
    });
  }

  return items;
}

/**
 * Format a single result item
 */
function formatResultItem(result: SearchResult, query: string): SearchResultItem {
  // Icon based on type
  const icon = getTypeIcon(result.type);

  // Highlight matching terms in name
  const highlightedName = highlightMatches(result.name, query);

  // Build path breadcrumb
  const breadcrumb = result.nodePath
    ? result.nodePath.join(' › ')
    : path.basename(result.path, path.extname(result.path));

  // Build detail line
  let detail = breadcrumb;
  if (result.snippet) {
    detail += ` · ${result.snippet}`;
  }

  return {
    label: `${icon} ${highlightedName}`,
    description: result.type,
    detail: detail,
    resultData: result,
    buttons: result.tier === 3 ? [{
      iconPath: new vscode.ThemeIcon('go-to-file'),
      tooltip: 'Reveal in Tree'
    }] : undefined
  };
}

/**
 * Get VS Code icon for node type
 */
function getTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    character: '$(person)',
    chapter: '$(file-text)',
    location: '$(globe)',
    scene: '$(symbol-event)',
    folder: '$(folder)',
    book: '$(book)',
    item: '$(package)',
    note: '$(note)',
    faction: '$(organization)',
    concept: '$(lightbulb)',
    event: '$(calendar)',
    timeline: '$(timeline-open)',
  };
  return icons[type.toLowerCase()] || '$(symbol-misc)';
}

/**
 * Highlight matching terms in text
 */
function highlightMatches(text: string, query: string): string {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(t => !t.includes(':') && !t.startsWith('-'));

  let result = text;
  for (const term of terms) {
    const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
    result = result.replace(regex, '**$1**');
  }

  return result;
}
```

### 7.3 Visual Layout

```
┌─────────────────────────────────────────────────────────────┐
│ 🔍 aragorn                                              [X] │
├─────────────────────────────────────────────────────────────┤
│ Titles ──────────────────────────────────────────────────── │
│ $(person) **Aragorn** II Elessar          character         │
│           characters › main-cast · Heir of Isildur...       │
│                                                             │
│ $(person) **Aragorn**'s Lineage            note             │
│           lore › bloodlines                                 │
│                                                             │
│ Tags & Attributes ───────────────────────────────────────── │
│ $(file-text) The Council of Elrond         chapter          │
│              book-1 › chapters · tag: aragorn-introduction  │
│                                                             │
│ Content ─────────────────────────────────────────────────── │
│ $(symbol-event) The Breaking of...         scene        [⎘] │
│                 book-1 › ch-12 · "...and **Aragorn** drew   │
│                 his sword, the blade gleaming..."           │
└─────────────────────────────────────────────────────────────┘
```

### 7.4 Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate results |
| `Enter` | Open selected (context-aware) |
| `Cmd+Enter` | Force open in Writer View |
| `Cmd+Shift+Enter` | Reveal in tree only |
| `Escape` | Close search |
| `Tab` | Toggle search scope (titles → all → titles) |

### 7.5 Recent Searches

```typescript
const MAX_RECENT_SEARCHES = 10;
let recentSearches: string[] = [];

/**
 * Get recent searches as QuickPick items
 */
function getRecentSearches(): SearchResultItem[] {
  if (recentSearches.length === 0) {
    return [{
      label: '$(info) Start typing to search...',
      description: 'Use type: field: "exact" for advanced filters'
    }];
  }

  const items: SearchResultItem[] = [{
    label: 'Recent Searches',
    kind: vscode.QuickPickItemKind.Separator
  }];

  for (const search of recentSearches) {
    items.push({
      label: `$(history) ${search}`,
      description: 'Recent search'
    });
  }

  return items;
}

/**
 * Save a search to recent history
 */
function saveRecentSearch(query: string): void {
  if (!query.trim()) return;

  // Remove if already exists
  recentSearches = recentSearches.filter(s => s !== query);

  // Add to front
  recentSearches.unshift(query);

  // Trim to max
  if (recentSearches.length > MAX_RECENT_SEARCHES) {
    recentSearches = recentSearches.slice(0, MAX_RECENT_SEARCHES);
  }

  // Persist to workspace state (optional)
  // context.workspaceState.update('recentSearches', recentSearches);
}
```

### 7.6 Context-Aware Result Handling

```typescript
/**
 * Handle user selecting a search result
 */
async function handleResultSelection(result: SearchResultItem): Promise<void> {
  const data = result.resultData;
  if (!data) return;

  // Determine action based on node type and match tier
  const isStructural = ['folder', 'book', 'index'].includes(data.type.toLowerCase());
  const isContentMatch = data.tier === 3;

  if (isStructural) {
    // ═══════════════════════════════════════════════════════════
    // Structural nodes: Reveal in tree
    // ═══════════════════════════════════════════════════════════
    await revealInTree(data);

  } else if (isContentMatch && data.field) {
    // ═══════════════════════════════════════════════════════════
    // Content match: Open Writer View focused on matching field
    // ═══════════════════════════════════════════════════════════
    await openWriterViewForField(data.path, data.nodePath, data.field);

  } else {
    // ═══════════════════════════════════════════════════════════
    // Default: Open Writer View for the node
    // ═══════════════════════════════════════════════════════════
    await openWriterView(data.path, data.nodePath);
  }
}

/**
 * Reveal node in tree view
 */
async function revealInTree(data: SearchResult): Promise<void> {
  const treeView = getTreeView();
  const treeProvider = getTreeProvider();

  const item = await treeProvider.findTreeItemByPath(data.path, data.nodePath);
  if (item) {
    await treeView.reveal(item, { select: true, focus: true, expand: true });
  }
}

/**
 * Open Writer View for a specific field
 */
async function openWriterViewForField(
  filePath: string,
  nodePath: string[] | undefined,
  field: string
): Promise<void> {
  await vscode.commands.executeCommand(
    'chapterwiseCodex.openWriterViewForField',
    { filePath, nodePath, field }
  );
}

/**
 * Open Writer View for a node
 */
async function openWriterView(
  filePath: string,
  nodePath: string[] | undefined
): Promise<void> {
  await vscode.commands.executeCommand(
    'chapterwiseCodex.openWriterView',
    { filePath, nodePath }
  );
}
```

---

## 8. Index Manager & Background Worker

### 8.1 Index Manager Class

```typescript
/**
 * Manages search index lifecycle: building, caching, updating
 */
class SearchIndexManager {
  private index: SearchIndex | null = null;
  private indexPath: string | null = null;
  private buildProgress: number = 0;
  private isBuilding: boolean = false;
  private fileWatcher: vscode.FileSystemWatcher | null = null;
  private pendingUpdates: Set<string> = new Set();
  private updateDebounceTimer: NodeJS.Timeout | null = null;
  private buildMutex: Promise<void> = Promise.resolve();

  // Event emitters for UI updates
  private _onIndexReady = new vscode.EventEmitter<SearchIndex>();
  private _onBuildProgress = new vscode.EventEmitter<number>();
  readonly onIndexReady = this._onIndexReady.event;
  readonly onBuildProgress = this._onBuildProgress.event;

  /**
   * Initialize index for a context folder
   */
  async initializeForContext(
    contextFolder: string,
    workspaceRoot: string
  ): Promise<void> {
    const cacheFile = path.join(workspaceRoot, contextFolder, '.index-search.json');
    this.indexPath = cacheFile;

    // Try loading from cache first
    const cached = await this.loadFromCache(cacheFile);

    if (cached && await this.validateCache(cached, workspaceRoot, contextFolder)) {
      // Cache is valid - use it
      this.index = cached;
      this._onIndexReady.fire(this.index);

      // Background refresh for any stale entries
      this.refreshStaleEntries(workspaceRoot, contextFolder);
    } else {
      // Build fresh index in background
      this.buildIndexAsync(workspaceRoot, contextFolder);
    }

    // Set up file watcher for incremental updates
    this.setupFileWatcher(workspaceRoot, contextFolder);
  }

  /**
   * Get current index (may be partial during build)
   */
  getIndex(): SearchIndex | null {
    return this.index;
  }

  /**
   * Check if index is fully built
   */
  isReady(): boolean {
    return this.index !== null && !this.isBuilding;
  }

  /**
   * Get build progress (0-100)
   */
  getBuildProgress(): number {
    return this.buildProgress;
  }

  /**
   * Force rebuild index from scratch
   */
  async forceRebuild(workspaceRoot: string, contextFolder: string): Promise<void> {
    // Delete cache file
    if (this.indexPath && fs.existsSync(this.indexPath)) {
      await fs.promises.unlink(this.indexPath);
    }

    // Rebuild from scratch
    await this.buildIndexAsync(workspaceRoot, contextFolder);
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.fileWatcher?.dispose();
    if (this.updateDebounceTimer) {
      clearTimeout(this.updateDebounceTimer);
    }
  }
}
```

### 8.2 Background Index Building

```typescript
/**
 * Build index asynchronously in background
 */
private async buildIndexAsync(
  workspaceRoot: string,
  contextFolder: string
): Promise<void> {
  // Use mutex to prevent concurrent builds
  this.buildMutex = this.buildMutex.then(async () => {
    this.isBuilding = true;
    this.buildProgress = 0;

    // Initialize empty index structure
    this.index = {
      version: '1.0',
      created: Date.now(),
      contextFolder,
      fileHashes: {},
      titles: [],
      metadata: [],
      content: [],
      termIndex: {},
      avgDocLength: 0,
      totalDocs: 0
    };

    // Fire early so searches can start with partial results
    this._onIndexReady.fire(this.index);

    try {
      // ═══════════════════════════════════════════════════════════
      // Phase 1: Scan files (0-10%)
      // ═══════════════════════════════════════════════════════════
      const files = await this.scanCodexFiles(workspaceRoot, contextFolder);
      this.buildProgress = 10;
      this._onBuildProgress.fire(this.buildProgress);

      // ═══════════════════════════════════════════════════════════
      // Phase 2: Index titles (10-20%)
      // ═══════════════════════════════════════════════════════════
      for (let i = 0; i < files.length; i++) {
        await this.indexTitles(files[i], workspaceRoot);
        this.buildProgress = 10 + Math.floor((i / files.length) * 10);
      }
      this._onBuildProgress.fire(20);
      this._onIndexReady.fire(this.index);  // Titles now searchable

      // ═══════════════════════════════════════════════════════════
      // Phase 3: Index metadata (20-30%)
      // ═══════════════════════════════════════════════════════════
      for (let i = 0; i < files.length; i++) {
        await this.indexMetadata(files[i], workspaceRoot);
        this.buildProgress = 20 + Math.floor((i / files.length) * 10);
      }
      this._onBuildProgress.fire(30);
      this._onIndexReady.fire(this.index);  // Metadata now searchable

      // ═══════════════════════════════════════════════════════════
      // Phase 4: Index content (30-90%)
      // ═══════════════════════════════════════════════════════════
      for (let i = 0; i < files.length; i++) {
        // Skip large files for content indexing
        const stats = await fs.promises.stat(files[i]);
        if (stats.size <= 1024 * 1024) {  // 1MB limit
          await this.indexContent(files[i], workspaceRoot);
        } else {
          console.warn(`[Search] Skipping large file: ${files[i]}`);
        }

        this.buildProgress = 30 + Math.floor((i / files.length) * 60);

        // Yield to UI every 10 files
        if (i % 10 === 0) {
          this._onBuildProgress.fire(this.buildProgress);
          await this.yieldToUI();
        }
      }

      // ═══════════════════════════════════════════════════════════
      // Phase 5: Build inverted index & stats (90-100%)
      // ═══════════════════════════════════════════════════════════
      this._onBuildProgress.fire(90);
      this.buildInvertedIndex();
      this.computeCorpusStats();
      this.buildProgress = 100;
      this._onBuildProgress.fire(100);

      // Save to cache
      await this.saveToCache();

    } catch (error) {
      console.error('[Search] Index build error:', error);
    } finally {
      this.isBuilding = false;
      this._onIndexReady.fire(this.index!);
    }
  });

  return this.buildMutex;
}

/**
 * Yield control to UI to prevent blocking
 */
private async yieldToUI(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Scan for codex files in context folder
 */
private async scanCodexFiles(
  workspaceRoot: string,
  contextFolder: string
): Promise<string[]> {
  const folderPath = path.join(workspaceRoot, contextFolder);
  const files: string[] = [];

  const glob = new vscode.RelativePattern(folderPath, '**/*.{codex.yaml,codex.json,md}');
  const uris = await vscode.workspace.findFiles(glob, '**/node_modules/**');

  for (const uri of uris) {
    // Skip index files
    if (!uri.fsPath.includes('.index.')) {
      files.push(uri.fsPath);
    }
  }

  return files;
}
```

### 8.3 Indexing Methods

```typescript
/**
 * Index titles from a file
 */
private async indexTitles(filePath: string, workspaceRoot: string): Promise<void> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const relativePath = path.relative(workspaceRoot, filePath);

    // Parse the file
    const nodes = this.parseFileNodes(content, filePath);

    for (const node of nodes) {
      // Calculate boost based on depth
      const depth = node.nodePath?.length || 0;
      const boost = depth === 0 ? 1.5 : depth <= 2 ? 1.0 : 0.8;

      this.index!.titles.push({
        id: node.id,
        name: node.name,
        type: node.type,
        path: relativePath,
        nodePath: node.nodePath,
        boost
      });
    }

    // Store file hash for cache validation
    this.index!.fileHashes[relativePath] = this.hashContent(content);

  } catch (error) {
    console.error(`[Search] Error indexing titles for ${filePath}:`, error);
  }
}

/**
 * Index metadata from a file
 */
private async indexMetadata(filePath: string, workspaceRoot: string): Promise<void> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const relativePath = path.relative(workspaceRoot, filePath);
    const nodes = this.parseFileNodes(content, filePath);

    for (const node of nodes) {
      this.index!.metadata.push({
        id: node.id,
        tags: node.tags || [],
        attributes: node.attributes || {},
        type: node.type,
        path: relativePath,
        nodePath: node.nodePath
      });
    }
  } catch (error) {
    console.error(`[Search] Error indexing metadata for ${filePath}:`, error);
  }
}

/**
 * Index content from a file
 */
private async indexContent(filePath: string, workspaceRoot: string): Promise<void> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const relativePath = path.relative(workspaceRoot, filePath);
    const nodes = this.parseFileNodes(content, filePath);

    for (const node of nodes) {
      // Index each prose field
      for (const field of ['body', 'summary', 'description']) {
        const text = node[field];
        if (text && typeof text === 'string' && text.trim()) {
          const tokens = tokenize(text);

          this.index!.content.push({
            id: node.id,
            field,
            text,
            tokens,
            length: tokens.length,
            path: relativePath,
            nodePath: node.nodePath
          });
        }
      }
    }
  } catch (error) {
    console.error(`[Search] Error indexing content for ${filePath}:`, error);
  }
}

/**
 * Build inverted index from content entries
 */
private buildInvertedIndex(): void {
  this.index!.termIndex = {};

  // Index title terms
  for (const entry of this.index!.titles) {
    const tokens = tokenize(entry.name);
    for (let pos = 0; pos < tokens.length; pos++) {
      const term = tokens[pos];
      this.addToPostingList(term, entry.id, 1, pos, entry.boost);
    }
  }

  // Index metadata terms
  for (const entry of this.index!.metadata) {
    // Tags
    for (const tag of entry.tags) {
      const tokens = tokenize(tag);
      for (let pos = 0; pos < tokens.length; pos++) {
        this.addToPostingList(tokens[pos], entry.id, 2, pos, 1.3);
      }
    }

    // Attributes
    for (const [key, value] of Object.entries(entry.attributes)) {
      const tokens = tokenize(`${key} ${value}`);
      for (let pos = 0; pos < tokens.length; pos++) {
        this.addToPostingList(tokens[pos], entry.id, 2, pos, 1.0);
      }
    }
  }

  // Index content terms
  for (const entry of this.index!.content) {
    for (let pos = 0; pos < entry.tokens.length; pos++) {
      const boost = entry.field === 'summary' ? 1.2 : 1.0;
      this.addToPostingList(entry.tokens[pos], entry.id, 3, pos, boost);
    }
  }
}

/**
 * Add term to posting list
 */
private addToPostingList(
  term: string,
  docId: string,
  tier: 1 | 2 | 3,
  position: number,
  boost: number
): void {
  if (!this.index!.termIndex[term]) {
    this.index!.termIndex[term] = { term, docs: [] };
  }

  const posting = this.index!.termIndex[term];
  let docEntry = posting.docs.find(d => d.id === docId && d.tier === tier);

  if (!docEntry) {
    docEntry = { id: docId, tier, positions: [], score: boost };
    posting.docs.push(docEntry);
  }

  docEntry.positions.push(position);
}

/**
 * Compute corpus statistics for BM25
 */
private computeCorpusStats(): void {
  const lengths = this.index!.content.map(c => c.length);
  this.index!.totalDocs = lengths.length || 1;
  this.index!.avgDocLength = lengths.length > 0
    ? lengths.reduce((a, b) => a + b, 0) / lengths.length
    : 100;
}
```

### 8.4 Cache Management

```typescript
/**
 * Load index from cache file
 */
private async loadFromCache(cachePath: string): Promise<SearchIndex | null> {
  try {
    if (!fs.existsSync(cachePath)) return null;

    const content = await fs.promises.readFile(cachePath, 'utf-8');
    const cached = JSON.parse(content) as SearchIndex;

    // Version check
    if (cached.version !== '1.0') return null;

    // Age check (rebuild if older than 7 days)
    const age = Date.now() - cached.created;
    if (age > 7 * 24 * 60 * 60 * 1000) return null;

    return cached;
  } catch (error) {
    console.error('[Search] Error loading cache:', error);
    return null;
  }
}

/**
 * Validate cache by checking sample of file hashes
 */
private async validateCache(
  cached: SearchIndex,
  workspaceRoot: string,
  contextFolder: string
): Promise<boolean> {
  try {
    const sampleSize = Math.min(10, Object.keys(cached.fileHashes).length);
    const files = Object.keys(cached.fileHashes).slice(0, sampleSize);

    for (const file of files) {
      const fullPath = path.join(workspaceRoot, file);

      if (!fs.existsSync(fullPath)) return false;

      const content = await fs.promises.readFile(fullPath, 'utf-8');
      const currentHash = this.hashContent(content);

      if (currentHash !== cached.fileHashes[file]) return false;
    }

    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Save index to cache file
 */
private async saveToCache(): Promise<void> {
  if (!this.index || !this.indexPath) return;

  try {
    const content = JSON.stringify(this.index, null, 2);
    await fs.promises.writeFile(this.indexPath, content, 'utf-8');
    console.log('[Search] Cache saved to', this.indexPath);
  } catch (error) {
    console.error('[Search] Failed to save cache:', error);
  }
}

/**
 * Hash file content for change detection
 */
private hashContent(content: string): string {
  const crypto = require('crypto');
  return crypto.createHash('md5').update(content).digest('hex');
}
```

### 8.5 File Watcher & Incremental Updates

```typescript
/**
 * Set up file watcher for incremental updates
 */
private setupFileWatcher(workspaceRoot: string, contextFolder: string): void {
  // Clean up existing watcher
  this.fileWatcher?.dispose();

  const pattern = new vscode.RelativePattern(
    path.join(workspaceRoot, contextFolder),
    '**/*.{codex.yaml,codex.json,md}'
  );

  this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

  // Debounced update handler
  const queueUpdate = (uri: vscode.Uri) => {
    // Skip index files
    if (uri.fsPath.includes('.index.')) return;

    this.pendingUpdates.add(uri.fsPath);

    if (this.updateDebounceTimer) {
      clearTimeout(this.updateDebounceTimer);
    }

    this.updateDebounceTimer = setTimeout(() => {
      this.processUpdates(workspaceRoot);
    }, 500);  // 500ms debounce for batch updates
  };

  this.fileWatcher.onDidChange(queueUpdate);
  this.fileWatcher.onDidCreate(queueUpdate);

  this.fileWatcher.onDidDelete(uri => {
    if (uri.fsPath.includes('.index.')) return;
    this.removeFromIndex(uri.fsPath, workspaceRoot);
    this.saveToCache();
  });

  // Error handling for watcher issues
  // Note: VS Code FileSystemWatcher doesn't expose error event,
  // but we can add fallback polling for robustness
  this.setupFallbackPolling(workspaceRoot, contextFolder);
}

/**
 * Process queued file updates
 */
private async processUpdates(workspaceRoot: string): Promise<void> {
  if (!this.index || this.pendingUpdates.size === 0) return;

  const files = Array.from(this.pendingUpdates);
  this.pendingUpdates.clear();

  console.log(`[Search] Processing ${files.length} file updates`);

  for (const file of files) {
    // Remove old entries
    this.removeFromIndex(file, workspaceRoot);

    // Re-index the file
    await this.indexTitles(file, workspaceRoot);
    await this.indexMetadata(file, workspaceRoot);
    await this.indexContent(file, workspaceRoot);
  }

  // Rebuild inverted index
  this.buildInvertedIndex();
  this.computeCorpusStats();

  // Save updated cache
  await this.saveToCache();

  this._onIndexReady.fire(this.index);
}

/**
 * Remove entries for a file from index
 */
private removeFromIndex(filePath: string, workspaceRoot: string): void {
  if (!this.index) return;

  const relativePath = path.relative(workspaceRoot, filePath);

  this.index.titles = this.index.titles.filter(t => t.path !== relativePath);
  this.index.metadata = this.index.metadata.filter(m => m.path !== relativePath);
  this.index.content = this.index.content.filter(c => c.path !== relativePath);
  delete this.index.fileHashes[relativePath];
}

/**
 * Fallback periodic check for file watcher reliability
 */
private setupFallbackPolling(workspaceRoot: string, contextFolder: string): void {
  // Check for changes every 60 seconds as fallback
  setInterval(async () => {
    if (!this.isBuilding && this.index) {
      await this.refreshStaleEntries(workspaceRoot, contextFolder);
    }
  }, 60000);
}

/**
 * Check for and refresh stale entries
 */
private async refreshStaleEntries(
  workspaceRoot: string,
  contextFolder: string
): Promise<void> {
  if (!this.index) return;

  const staleFiles: string[] = [];

  for (const [relativePath, storedHash] of Object.entries(this.index.fileHashes)) {
    const fullPath = path.join(workspaceRoot, relativePath);

    try {
      if (!fs.existsSync(fullPath)) {
        this.removeFromIndex(fullPath, workspaceRoot);
        continue;
      }

      const content = await fs.promises.readFile(fullPath, 'utf-8');
      const currentHash = this.hashContent(content);

      if (currentHash !== storedHash) {
        staleFiles.push(fullPath);
      }
    } catch (error) {
      // File may have been deleted or inaccessible
      this.removeFromIndex(fullPath, workspaceRoot);
    }
  }

  if (staleFiles.length > 0) {
    console.log(`[Search] Found ${staleFiles.length} stale files, refreshing...`);
    for (const file of staleFiles) {
      this.pendingUpdates.add(file);
    }
    await this.processUpdates(workspaceRoot);
  }
}
```

---

## 9. File Structure & Integration

### 9.1 New Files

```
src/
├── search/
│   ├── index.ts              # Main exports
│   ├── searchIndex.ts        # SearchIndex interface & types
│   ├── indexManager.ts       # Background indexing, cache, file watcher
│   ├── queryParser.ts        # Parse search syntax into ParsedQuery
│   ├── searchEngine.ts       # Execute searches, BM25 scoring
│   ├── searchUI.ts           # QuickPick interface & result formatting
│   └── tokenizer.ts          # Text tokenization & fuzzy matching
```

### 9.2 Module Exports (`src/search/index.ts`)

```typescript
// Types
export { SearchIndex, TitleEntry, MetadataEntry, ContentEntry, PostingList } from './searchIndex';
export { ParsedQuery } from './queryParser';
export { SearchResult } from './searchEngine';

// Classes
export { SearchIndexManager } from './indexManager';

// Functions
export { parseQuery } from './queryParser';
export { executeSearch } from './searchEngine';
export { openSearchUI, initializeStatusBar, updateStatusBar } from './searchUI';
export { tokenize, fuzzyMatch, levenshteinDistance } from './tokenizer';
```

### 9.3 Extension Integration (`src/extension.ts`)

```typescript
import {
  SearchIndexManager,
  openSearchUI,
  initializeStatusBar,
  updateStatusBar
} from './search';

let searchIndexManager: SearchIndexManager;

export function activate(context: vscode.ExtensionContext) {
  // ═══════════════════════════════════════════════════════════
  // Initialize search system
  // ═══════════════════════════════════════════════════════════
  searchIndexManager = new SearchIndexManager();

  // Initialize status bar
  initializeStatusBar(context);

  // Listen for index events
  searchIndexManager.onBuildProgress(progress => {
    updateStatusBar('building', progress);
  });

  searchIndexManager.onIndexReady(() => {
    updateStatusBar('ready');
  });

  // ═══════════════════════════════════════════════════════════
  // Register search command
  // ═══════════════════════════════════════════════════════════
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.search', async () => {
      const index = searchIndexManager.getIndex();
      if (index) {
        await openSearchUI(index, searchIndexManager);
      } else {
        vscode.window.showWarningMessage(
          'Search index not ready. Set a context folder first.'
        );
      }
    })
  );

  // ═══════════════════════════════════════════════════════════
  // Register rebuild command
  // ═══════════════════════════════════════════════════════════
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.rebuildSearchIndex', async () => {
      const treeProvider = getTreeProvider();
      const contextFolder = treeProvider.getContextFolder();
      const workspaceRoot = treeProvider.getWorkspaceRoot();

      if (contextFolder && workspaceRoot) {
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: 'Rebuilding search index...',
          cancellable: false
        }, async (progress) => {
          searchIndexManager.onBuildProgress(pct => {
            progress.report({ increment: pct - (progress as any).lastPct || 0 });
            (progress as any).lastPct = pct;
          });
          await searchIndexManager.forceRebuild(workspaceRoot, contextFolder);
        });
        vscode.window.showInformationMessage('Search index rebuilt.');
      } else {
        vscode.window.showWarningMessage('No context folder set.');
      }
    })
  );

  // ... existing activation code ...
}

// Export for other modules
export function getSearchIndexManager(): SearchIndexManager {
  return searchIndexManager;
}
```

### 9.4 TreeProvider Integration (`src/treeProvider.ts`)

```typescript
import { getSearchIndexManager } from './extension';

// In setContextFolder method:
async setContextFolder(folderPath: string | null, workspaceRoot: string): Promise<void> {
  // ... existing context folder logic ...

  // Initialize search index for the new context
  if (folderPath) {
    const searchManager = getSearchIndexManager();
    if (searchManager) {
      // Fire and forget - indexing happens in background
      searchManager.initializeForContext(folderPath, workspaceRoot);
    }
  }
}
```

### 9.5 Package.json Additions

```json
{
  "contributes": {
    "commands": [
      {
        "command": "chapterwiseCodex.search",
        "title": "ChapterWise Codex: Search",
        "icon": "$(search)"
      },
      {
        "command": "chapterwiseCodex.rebuildSearchIndex",
        "title": "ChapterWise Codex: Rebuild Search Index",
        "icon": "$(refresh)"
      }
    ],
    "keybindings": [
      {
        "command": "chapterwiseCodex.search",
        "key": "cmd+shift+f",
        "mac": "cmd+shift+f",
        "win": "ctrl+shift+f",
        "linux": "ctrl+shift+f",
        "when": "view.chapterwiseCodexNavigator.visible"
      }
    ],
    "menus": {
      "view/title": [
        {
          "command": "chapterwiseCodex.search",
          "when": "view == chapterwiseCodexNavigator",
          "group": "navigation@1"
        }
      ],
      "commandPalette": [
        {
          "command": "chapterwiseCodex.search",
          "when": "chapterwiseCodex.hasContext"
        },
        {
          "command": "chapterwiseCodex.rebuildSearchIndex",
          "when": "chapterwiseCodex.hasContext"
        }
      ]
    }
  }
}
```

### 9.6 Status Bar Integration

```typescript
// src/search/searchUI.ts

let statusBarItem: vscode.StatusBarItem;

export function initializeStatusBar(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'chapterwiseCodex.search';
  context.subscriptions.push(statusBarItem);

  updateStatusBar('idle');
}

export function updateStatusBar(
  state: 'idle' | 'building' | 'ready',
  progress?: number
): void {
  switch (state) {
    case 'idle':
      statusBarItem.text = '$(search) Search';
      statusBarItem.tooltip = 'Set a context folder to enable search';
      statusBarItem.backgroundColor = undefined;
      statusBarItem.hide();
      break;

    case 'building':
      statusBarItem.text = `$(sync~spin) Indexing ${progress || 0}%`;
      statusBarItem.tooltip = 'Building search index...';
      statusBarItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground'
      );
      statusBarItem.show();
      break;

    case 'ready':
      statusBarItem.text = '$(search) Search';
      statusBarItem.tooltip = 'Search nodes (Cmd+Shift+F)';
      statusBarItem.backgroundColor = undefined;
      statusBarItem.show();
      break;
  }
}
```

---

## 10. Implementation Plan

### 10.1 Phase Overview

```
Phase 1: Core Foundation (MVP)                    [~400 lines]
├── 1.1 searchIndex.ts      - Type definitions
├── 1.2 tokenizer.ts        - Basic tokenization
├── 1.3 queryParser.ts      - Parse search syntax
└── 1.4 searchEngine.ts     - Title search only (no BM25 yet)

Phase 2: Basic UI                                 [~250 lines]
├── 2.1 searchUI.ts         - QuickPick with title results
├── 2.2 extension.ts        - Register search command
└── 2.3 package.json        - Add keybinding (Cmd+Shift+F)

   ──────── MVP Complete: Title search working ────────

Phase 3: Full Indexing                            [~350 lines]
├── 3.1 indexManager.ts     - Background indexing
├── 3.2 searchEngine.ts     - Add metadata + content search
├── 3.3 searchEngine.ts     - Implement BM25 scoring
└── 3.4 indexManager.ts     - Persistent cache

Phase 4: Polish & Robustness                      [~200 lines]
├── 4.1 indexManager.ts     - File watcher for incremental updates
├── 4.2 searchUI.ts         - Recent searches
├── 4.3 searchUI.ts         - Result highlighting & snippets
├── 4.4 treeProvider.ts     - Integration with context changes
└── 4.5 searchUI.ts         - Status bar indicator

Phase 5: Advanced Features                        [~150 lines]
├── 5.1 tokenizer.ts        - Fuzzy matching with Levenshtein
├── 5.2 searchEngine.ts     - Phrase matching with positions
├── 5.3 searchUI.ts         - Keyboard shortcuts
└── 5.4 extension.ts        - Rebuild index command

   ──────── Full Feature Complete ────────
```

### 10.2 Detailed Task Breakdown

#### Phase 1: Core Foundation

| Task | File | Description | Est. Lines |
|------|------|-------------|------------|
| 1.1.1 | `searchIndex.ts` | Define SearchIndex interface | 40 |
| 1.1.2 | `searchIndex.ts` | Define TitleEntry, MetadataEntry, ContentEntry | 30 |
| 1.1.3 | `searchIndex.ts` | Define PostingList interface | 15 |
| 1.2.1 | `tokenizer.ts` | Implement tokenize() function | 40 |
| 1.2.2 | `tokenizer.ts` | Implement basic string normalization | 20 |
| 1.3.1 | `queryParser.ts` | Define ParsedQuery interface | 25 |
| 1.3.2 | `queryParser.ts` | Implement parseQuery() function | 60 |
| 1.3.3 | `queryParser.ts` | Handle quoted phrases | 20 |
| 1.3.4 | `queryParser.ts` | Handle type: and field: filters | 30 |
| 1.4.1 | `searchEngine.ts` | Define SearchResult interface | 20 |
| 1.4.2 | `searchEngine.ts` | Implement searchTitles() | 50 |
| 1.4.3 | `searchEngine.ts` | Implement basic executeSearch() | 40 |

#### Phase 2: Basic UI

| Task | File | Description | Est. Lines |
|------|------|-------------|------------|
| 2.1.1 | `searchUI.ts` | Create QuickPick setup | 50 |
| 2.1.2 | `searchUI.ts` | Implement debounced search | 30 |
| 2.1.3 | `searchUI.ts` | Implement formatResults() | 60 |
| 2.1.4 | `searchUI.ts` | Implement formatResultItem() | 40 |
| 2.1.5 | `searchUI.ts` | Implement getTypeIcon() | 25 |
| 2.2.1 | `extension.ts` | Register search command | 20 |
| 2.2.2 | `extension.ts` | Initialize SearchIndexManager | 15 |
| 2.3.1 | `package.json` | Add search command | 5 |
| 2.3.2 | `package.json` | Add keybinding | 10 |

#### Phase 3: Full Indexing

| Task | File | Description | Est. Lines |
|------|------|-------------|------------|
| 3.1.1 | `indexManager.ts` | Create SearchIndexManager class | 50 |
| 3.1.2 | `indexManager.ts` | Implement buildIndexAsync() | 80 |
| 3.1.3 | `indexManager.ts` | Implement indexTitles() | 40 |
| 3.1.4 | `indexManager.ts` | Implement indexMetadata() | 30 |
| 3.1.5 | `indexManager.ts` | Implement indexContent() | 40 |
| 3.2.1 | `searchEngine.ts` | Implement searchMetadata() | 50 |
| 3.2.2 | `searchEngine.ts` | Implement searchContent() | 60 |
| 3.3.1 | `searchEngine.ts` | Implement calculateBM25() | 25 |
| 3.3.2 | `searchEngine.ts` | Implement scoreDocument() | 40 |
| 3.4.1 | `indexManager.ts` | Implement loadFromCache() | 30 |
| 3.4.2 | `indexManager.ts` | Implement validateCache() | 25 |
| 3.4.3 | `indexManager.ts` | Implement saveToCache() | 15 |

#### Phase 4: Polish & Robustness

| Task | File | Description | Est. Lines |
|------|------|-------------|------------|
| 4.1.1 | `indexManager.ts` | Implement setupFileWatcher() | 40 |
| 4.1.2 | `indexManager.ts` | Implement processUpdates() | 35 |
| 4.1.3 | `indexManager.ts` | Implement removeFromIndex() | 15 |
| 4.2.1 | `searchUI.ts` | Implement getRecentSearches() | 25 |
| 4.2.2 | `searchUI.ts` | Implement saveRecentSearch() | 15 |
| 4.3.1 | `searchUI.ts` | Implement highlightMatches() | 20 |
| 4.3.2 | `searchUI.ts` | Implement snippet extraction | 30 |
| 4.4.1 | `treeProvider.ts` | Add search initialization | 10 |
| 4.5.1 | `searchUI.ts` | Implement initializeStatusBar() | 15 |
| 4.5.2 | `searchUI.ts` | Implement updateStatusBar() | 25 |

#### Phase 5: Advanced Features

| Task | File | Description | Est. Lines |
|------|------|-------------|------------|
| 5.1.1 | `tokenizer.ts` | Implement levenshteinDistance() | 30 |
| 5.1.2 | `tokenizer.ts` | Implement fuzzyMatch() | 25 |
| 5.2.1 | `searchEngine.ts` | Implement checkExactPhrases() | 40 |
| 5.2.2 | `indexManager.ts` | Store positions in inverted index | 20 |
| 5.3.1 | `searchUI.ts` | Add keyboard shortcut handlers | 25 |
| 5.4.1 | `extension.ts` | Register rebuild command | 25 |
| 5.4.2 | `package.json` | Add rebuild command | 5 |

### 10.3 Estimated Totals

| Phase | Lines | Cumulative |
|-------|-------|------------|
| Phase 1 | ~390 | 390 |
| Phase 2 | ~255 | 645 |
| Phase 3 | ~485 | 1,130 |
| Phase 4 | ~230 | 1,360 |
| Phase 5 | ~170 | 1,530 |
| **Total** | **~1,530 lines** | |

---

## 11. Best Practices Validation

### 11.1 Search UX Best Practices

| Best Practice | Implementation | Source |
|--------------|----------------|--------|
| Instant results (< 100ms) | Tiered search - titles instant | [DesignMonks](https://www.designmonks.co/blog/search-ux-best-practices) |
| Fuzzy matching | Levenshtein with length-based thresholds | [Meilisearch](https://www.meilisearch.com/blog/fuzzy-search) |
| Keyboard-first | QuickPick fully keyboard navigable | [VS Code UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/quick-picks) |
| Progressive disclosure | Simple search works, power syntax available | [LogRocket](https://blog.logrocket.com/ux-design/design-search-bar-intuitive-autocomplete/) |
| Search-as-you-type | 150ms debounce | [LogRocket](https://blog.logrocket.com/ux-design/design-search-bar-intuitive-autocomplete/) |
| Highlighted matches | Bold matching terms in results | [Blueniaga](https://blueniaga.com/essential-search-ux-best-practices-to-implement-in-2025/) |
| Recent searches | Show last 10 on empty input | [DesignMonks](https://www.designmonks.co/blog/search-ux-best-practices) |
| Result grouping | Separators between tiers | VS Code QuickPick API |

### 11.2 Search Index Best Practices

| Best Practice | Implementation | Source |
|--------------|----------------|--------|
| Inverted index | termIndex with posting lists | [GeeksforGeeks](https://www.geeksforgeeks.org/nlp/what-is-bm25-best-matching-25-algorithm/) |
| BM25 scoring | TF-IDF with length normalization | [Microsoft Azure](https://learn.microsoft.com/en-us/azure/search/index-similarity-and-scoring) |
| Pre-tokenization | tokens[] in ContentEntry | [BTrees & Inverted Indices](https://ohadravid.github.io/posts/2025-04-08-btrees-and-mental-models/) |
| Position storage | For phrase matching | Standard IR practice |
| Document length norm | avgDocLength, totalDocs | BM25 standard |

### 11.3 Background Worker Best Practices

| Best Practice | Implementation | Source |
|--------------|----------------|--------|
| Debounce file events | 500ms debounce | [GitHub Local-first](https://gist.github.com/tuandinh0801/7a6c6e81ab41576e11dc4d41a6676602) |
| Incremental updates | Only re-index changed files | Best practice |
| Hash-based validation | fileHashes for cache | [DesignGurus](https://www.designgurus.io/blog/cache-invalidation-strategies) |
| TTL expiration | 7-day age check | [DesignGurus](https://www.designgurus.io/blog/cache-invalidation-strategies) |
| Yield to UI | yieldToUI() every 10 files | Async best practice |
| Build mutex | Prevent concurrent builds | Concurrency pattern |
| Large file protection | Skip files > 1MB | Memory protection |
| Manual reindex | forceRebuild() command | [VS Code Wiki](https://github.com/microsoft/vscode/wiki/File-Watcher-Issues) |
| Fallback polling | 60-second check | Reliability pattern |

---

## 12. Success Criteria

### 12.1 Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| Title search response | < 50ms | Time from keystroke to results |
| Full content search | < 2 seconds | Time for 500 files |
| Index build time | < 30 seconds | Time for 500 files |
| Cache load time | < 100ms | Time to load .index-search.json |
| File change reflection | < 1 second | Time from save to searchable |
| Memory usage | < 50MB | Index size in memory |

### 12.2 Functional Checklist

- [ ] Title search returns results instantly
- [ ] Metadata search finds tags and attributes
- [ ] Content search finds text in body/summary fields
- [ ] Fuzzy matching handles typos
- [ ] Exact phrases work with quotes
- [ ] Type filters narrow results
- [ ] Field filters search specific fields
- [ ] Exclusion filters remove unwanted results
- [ ] Recent searches appear on empty input
- [ ] Results are grouped by tier
- [ ] Matching terms are highlighted
- [ ] Context-aware actions work correctly
- [ ] Status bar shows indexing progress
- [ ] File changes trigger re-indexing
- [ ] Cache persists between sessions
- [ ] Manual rebuild command works

### 12.3 UX Checklist

- [ ] QuickPick opens with Cmd+Shift+F
- [ ] Typing feels responsive (no lag)
- [ ] Results update as you type
- [ ] Keyboard navigation works fully
- [ ] Icons clearly indicate node types
- [ ] Snippets show context for content matches
- [ ] Opening results feels instant
- [ ] Error states are handled gracefully

---

## 13. Future Enhancements

### 13.1 Potential Future Features

| Feature | Description | Priority |
|---------|-------------|----------|
| Semantic search | Use embeddings for meaning-based search | P3 |
| Search history | Persist recent searches across sessions | P2 |
| Saved searches | Let users save frequent searches | P3 |
| Search scopes | Search within specific folders only | P2 |
| Regex support | Advanced pattern matching | P3 |
| Search replace | Find and replace across files | P2 |
| Export results | Export search results to file | P3 |
| Search analytics | Track popular searches | P3 |

### 13.2 Performance Optimizations

| Optimization | Description | When to Implement |
|--------------|-------------|-------------------|
| Web Worker | Move search to background thread | If UI lag occurs |
| Streaming results | Show results as they're found | If search > 2s |
| Index sharding | Split large indexes | If > 1000 files |
| Bloom filters | Fast negative lookups | If many misses |
| Compressed cache | Reduce disk usage | If cache > 10MB |

### 13.3 Integration Opportunities

| Integration | Description |
|-------------|-------------|
| VS Code Search | Contribute to workspace search |
| Outline view | Show search results in outline |
| Breadcrumbs | Navigate via search in breadcrumbs |
| Code Lens | Show related nodes via search |

---

## Appendix A: Tokenizer Implementation

```typescript
// src/search/tokenizer.ts

/**
 * Tokenize text into searchable terms
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    // Replace non-alphanumeric with spaces
    .replace(/[^a-z0-9\s]/g, ' ')
    // Split on whitespace
    .split(/\s+/)
    // Remove empty strings
    .filter(token => token.length > 0)
    // Remove very short tokens (optional)
    .filter(token => token.length >= 2);
}

/**
 * Calculate Levenshtein edit distance
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Check if term fuzzy-matches target
 */
export function fuzzyMatch(term: string, target: string): boolean {
  const termLower = term.toLowerCase();
  const targetLower = target.toLowerCase();

  // Exact substring match always passes
  if (targetLower.includes(termLower)) return true;

  // Determine max edit distance based on term length
  let maxDistance: number;
  if (term.length <= 3) {
    maxDistance = 0;
  } else if (term.length <= 6) {
    maxDistance = 1;
  } else {
    maxDistance = 2;
  }

  // If no fuzzy allowed, we're done
  if (maxDistance === 0) return false;

  // Check each word in target
  const targetWords = targetLower.split(/\s+/);
  for (const word of targetWords) {
    if (levenshteinDistance(termLower, word) <= maxDistance) {
      return true;
    }
  }

  return false;
}

/**
 * Escape special regex characters
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

---

## Appendix B: Test Cases

### B.1 Query Parser Tests

```typescript
describe('parseQuery', () => {
  it('parses basic terms', () => {
    const result = parseQuery('aragorn sword');
    expect(result.terms).toEqual(['aragorn', 'sword']);
  });

  it('extracts quoted phrases', () => {
    const result = parseQuery('"king of gondor"');
    expect(result.phrases).toEqual(['king of gondor']);
  });

  it('handles type filters', () => {
    const result = parseQuery('type:character aragorn');
    expect(result.filters.types).toEqual(['character']);
    expect(result.terms).toEqual(['aragorn']);
  });

  it('handles exclusions', () => {
    const result = parseQuery('aragorn -type:location');
    expect(result.filters.exclude.types).toEqual(['location']);
  });

  it('handles combined syntax', () => {
    const result = parseQuery('type:chapter body:"dark forest" -goblin');
    expect(result.filters.types).toEqual(['chapter']);
    expect(result.filters.fields).toEqual(['body:"dark forest"']);
    expect(result.filters.exclude.terms).toEqual(['goblin']);
  });
});
```

### B.2 Fuzzy Matching Tests

```typescript
describe('fuzzyMatch', () => {
  it('matches exact substrings', () => {
    expect(fuzzyMatch('ara', 'Aragorn')).toBe(true);
  });

  it('allows 1 typo for 4-6 char terms', () => {
    expect(fuzzyMatch('swrod', 'sword')).toBe(true);
    expect(fuzzyMatch('sward', 'sword')).toBe(true);
  });

  it('allows 2 typos for 7+ char terms', () => {
    expect(fuzzyMatch('chaarcter', 'character')).toBe(true);
  });

  it('rejects too many typos', () => {
    expect(fuzzyMatch('swrd', 'sword')).toBe(false); // 4 chars, 2 typos
  });

  it('requires exact match for short terms', () => {
    expect(fuzzyMatch('the', 'teh')).toBe(false);
  });
});
```

### B.3 BM25 Scoring Tests

```typescript
describe('calculateBM25', () => {
  it('scores higher for more frequent terms', () => {
    const score1 = calculateBM25(1, 100, 100, 10, 1000);
    const score2 = calculateBM25(5, 100, 100, 10, 1000);
    expect(score2).toBeGreaterThan(score1);
  });

  it('scores higher for rare terms (higher IDF)', () => {
    const common = calculateBM25(1, 100, 100, 500, 1000);
    const rare = calculateBM25(1, 100, 100, 10, 1000);
    expect(rare).toBeGreaterThan(common);
  });

  it('normalizes for document length', () => {
    const short = calculateBM25(2, 50, 100, 10, 1000);
    const long = calculateBM25(2, 200, 100, 10, 1000);
    expect(short).toBeGreaterThan(long);
  });
});
```

---

## Appendix C: Error Handling

### C.1 Error Types

```typescript
enum SearchErrorCode {
  INDEX_NOT_READY = 'INDEX_NOT_READY',
  INDEX_BUILD_FAILED = 'INDEX_BUILD_FAILED',
  CACHE_LOAD_FAILED = 'CACHE_LOAD_FAILED',
  FILE_READ_ERROR = 'FILE_READ_ERROR',
  PARSE_ERROR = 'PARSE_ERROR',
  SEARCH_TIMEOUT = 'SEARCH_TIMEOUT',
}

class SearchError extends Error {
  constructor(
    public code: SearchErrorCode,
    message: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'SearchError';
  }
}
```

### C.2 Error Recovery Strategies

| Error | Recovery Strategy |
|-------|-------------------|
| Index not ready | Show message, allow partial search |
| Build failed | Log error, offer manual rebuild |
| Cache corrupt | Delete cache, rebuild from scratch |
| File read error | Skip file, continue indexing |
| Parse error | Skip file, log warning |
| Search timeout | Return partial results with warning |

---

*End of Design Document*
