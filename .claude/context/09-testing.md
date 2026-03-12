# Testing

## Three-Layer Architecture

| Layer | Framework | Command | What |
|---|---|---|---|
| Unit | Vitest | `npm test` | Pure logic with mocked VS Code API |
| Integration | @vscode/test-electron + Mocha | `npm run test:integration` | Real VS Code instance |
| Typecheck | tsc --noEmit | `npm run typecheck` | Type correctness (auto-runs with `npm test`) |

## Unit Tests -- 262 tests, 11 suites

| Suite | File | Count | Focus |
|---|---|---|---|
| codexModel | `src/codexModel.test.ts` | 81 | Parsing, validation, markdown, UUID, Codex Lite |
| search/tokenizer | `src/search/tokenizer.test.ts` | 31 | Tokenization, Levenshtein, fuzzy match |
| search/queryParser | `src/search/queryParser.test.ts` | 23 | Terms, phrases, filters, exclusions |
| search/scoring | `src/search/scoring.test.ts` | 23 | BM25 calculation, boosts |
| colorManager | `src/colorManager.test.ts` | 23 | Color parsing, inheritance |
| structureEditor | `src/structureEditor.test.ts` | 22 | Node CRUD, path validation |
| writerView/helpers | `src/writerView/utils/helpers.test.ts` | 22 | escapeHtml, path validation, nonce |
| orderingManager | `src/orderingManager.test.ts` | 16 | Ordering state sync |
| trashManager | `src/trashManager.test.ts` | 11 | Soft delete, restore |
| clipboardManager | `src/clipboardManager.test.ts` | 9 | Cut/paste state |
| writerView/script | `src/writerView/script.test.ts` | 1 | Webview script |

## VS Code Mock

`src/__mocks__/vscode.ts` provides a shared VS Code API mock, aliased via `vitest.config.ts`. No inline mocks needed.

## Integration Tests

- Fixture workspace: `src/test/fixtures/workspace/test.codex.yaml`
- Compiled separately: `tsconfig.test.json` -> `out/test/`
- Smoke tests in `src/test/suite/extension.test.ts` (activation, commands) and `treeProvider.test.ts` (context setting)
- Requires display server: use `xvfb-run` on CI

## CI Pipeline

GitHub Actions (`.github/workflows/ci.yml`):
1. Typecheck (`tsc --noEmit`)
2. Lint (ESLint, `continue-on-error: true` -- 18 pre-existing errors)
3. Unit tests + coverage (v8 provider, text + lcov to `./coverage/`)
4. Integration tests (downloads VS Code, runs with xvfb)

## Config Split

`tsconfig.json` excludes test files (`src/**/*.test.ts`, `src/__mocks__/**`, `src/test/**`). Vitest handles its own module resolution. `tsconfig.test.json` includes everything for integration test compilation.

## Running

```bash
npm test              # typecheck + vitest run
npm run test:watch    # vitest watch mode
npm run test:coverage # vitest with v8 coverage
npm run test:integration  # @vscode/test-electron
```
