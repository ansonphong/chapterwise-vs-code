# Rules: Testing

Applies when creating or modifying files in `src/**/*.test.ts` or `src/test/`.

## Unit Tests (Vitest)

- All unit tests use Vitest — run with `npm test` (includes typecheck) or `npm run test:watch`
- VS Code API is mocked via `src/__mocks__/vscode.ts` — aliased in `vitest.config.ts`
- **Never create inline VS Code mocks** — always use the shared mock file
- Test files live alongside source: `src/codexModel.test.ts`, `src/search/tokenizer.test.ts`
- Coverage: `npm run test:coverage` — v8 provider, reports to `./coverage/`

## Integration Tests (@vscode/test-electron)

- Live in `src/test/suite/` — compiled separately via `tsconfig.test.json` → `out/test/`
- Use Mocha (not Vitest) — the test-electron runner requires it
- Fixture workspace: `src/test/fixtures/workspace/test.codex.yaml`
- Require a display server — use `xvfb-run` on CI
- Test real extension activation, command registration, tree provider context

## TDD Pattern

When adding new features:
1. Write failing test first
2. Run `npm test` to confirm it fails
3. Implement minimal code to pass
4. Run `npm test` to confirm it passes
5. Refactor if needed, re-run tests

## Config Split

- `tsconfig.json` excludes test files (`src/**/*.test.ts`, `src/__mocks__/**`, `src/test/**`)
- `tsconfig.test.json` includes only integration test files
- Vitest handles its own module resolution for unit tests
