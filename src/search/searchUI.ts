/**
 * Search UI - QuickPick interface for search
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { SearchIndex, SearchResult } from './searchIndex';
import { parseQuery, isEmptyQuery } from './queryParser';
import { executeSearch } from './searchEngine';

/**
 * Extended QuickPickItem with search result data
 */
interface SearchResultItem extends vscode.QuickPickItem {
  resultData?: SearchResult;
  isRecent?: boolean;
  recentQuery?: string;
}

// Recent searches storage
const MAX_RECENT_SEARCHES = 10;
let recentSearches: string[] = [];

// Status bar item
let statusBarItem: vscode.StatusBarItem | null = null;

/**
 * Initialize the status bar item
 */
export function initializeStatusBar(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'chapterwise.search';
  context.subscriptions.push(statusBarItem);
  updateStatusBar('idle');
}

/**
 * Update status bar state
 */
export function updateStatusBar(
  state: 'idle' | 'building' | 'ready',
  progress?: number
): void {
  if (!statusBarItem) return;

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
      statusBarItem.tooltip = `Search nodes (${process.platform === 'darwin' ? 'Cmd' : 'Ctrl'}+Alt+F)`;
      statusBarItem.backgroundColor = undefined;
      statusBarItem.show();
      break;
  }
}

/**
 * Open the search UI
 */
export async function openSearchUI(
  index: SearchIndex,
  onNavigate: (result: SearchResult) => Promise<void>
): Promise<void> {
  const quickPick = vscode.window.createQuickPick<SearchResultItem>();

  // Configuration
  quickPick.placeholder = 'Search nodes... (use type: field: "exact" for filters)';
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.keepScrollPosition = true;

  // Show recent searches initially
  quickPick.items = getRecentSearchItems();

  // Debounced search
  let debounceTimer: NodeJS.Timeout | undefined;

  quickPick.onDidChangeValue(value => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    if (!value.trim()) {
      quickPick.items = getRecentSearchItems();
      return;
    }

    debounceTimer = setTimeout(async () => {
      quickPick.busy = true;

      try {
        const query = parseQuery(value);
        const results = await executeSearch(query, index, {
          limit: 50,
          timeout: 2000
        });
        quickPick.items = formatResults(results);
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

  // Handle selection
  quickPick.onDidAccept(async () => {
    const selected = quickPick.selectedItems[0];
    if (!selected) return;

    // Handle recent search selection
    if (selected.isRecent && selected.recentQuery) {
      quickPick.value = selected.recentQuery;
      return;
    }

    // Handle result selection
    if (selected.resultData) {
      saveRecentSearch(quickPick.value);
      quickPick.hide();
      await onNavigate(selected.resultData);
    }
  });

  quickPick.onDidHide(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    quickPick.dispose();
  });

  quickPick.show();
}

/**
 * Get recent searches as QuickPick items
 */
function getRecentSearchItems(): SearchResultItem[] {
  if (recentSearches.length === 0) {
    return [{
      label: '$(info) Start typing to search...',
      description: 'Use type: field: "exact" for filters'
    }];
  }

  const items: SearchResultItem[] = [{
    label: 'Recent Searches',
    kind: vscode.QuickPickItemKind.Separator
  }];

  for (const query of recentSearches) {
    items.push({
      label: `$(history) ${query}`,
      description: 'Recent search',
      isRecent: true,
      recentQuery: query
    });
  }

  return items;
}

/**
 * Save a search to recent history
 */
function saveRecentSearch(query: string): void {
  if (!query.trim()) return;

  recentSearches = recentSearches.filter(s => s !== query);
  recentSearches.unshift(query);

  if (recentSearches.length > MAX_RECENT_SEARCHES) {
    recentSearches = recentSearches.slice(0, MAX_RECENT_SEARCHES);
  }
}

/**
 * Format search results for QuickPick
 */
function formatResults(results: SearchResult[]): SearchResultItem[] {
  const items: SearchResultItem[] = [];

  const titleResults = results.filter(r => r.tier === 1);
  const metaResults = results.filter(r => r.tier === 2);
  const contentResults = results.filter(r => r.tier === 3);

  // Titles
  if (titleResults.length > 0) {
    items.push({
      label: 'Titles',
      kind: vscode.QuickPickItemKind.Separator
    });
    items.push(...titleResults.map(r => formatResultItem(r)));
  }

  // Metadata
  if (metaResults.length > 0) {
    items.push({
      label: 'Tags & Attributes',
      kind: vscode.QuickPickItemKind.Separator
    });
    items.push(...metaResults.map(r => formatResultItem(r)));
  }

  // Content
  if (contentResults.length > 0) {
    items.push({
      label: 'Content',
      kind: vscode.QuickPickItemKind.Separator
    });
    items.push(...contentResults.map(r => formatResultItem(r)));
  }

  // No results
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
function formatResultItem(result: SearchResult): SearchResultItem {
  const icon = getTypeIcon(result.type);
  const highlightedName = result.name;

  const breadcrumb = result.nodePath
    ? result.nodePath.join(' › ')
    : path.basename(result.path, path.extname(result.path));

  let detail = breadcrumb;
  if (result.snippet) {
    detail += ` · ${result.snippet}`;
  }

  return {
    label: `${icon} ${highlightedName}`,
    description: result.type,
    detail,
    resultData: result
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
    module: '$(symbol-module)'
  };
  return icons[type.toLowerCase()] || '$(symbol-misc)';
}

