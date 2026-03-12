# Agent Integration — Future Plan Stub

> **Status:** Not started — stub for future implementation
> **Depends on:** chapterwise-agent being deployed, chapterwise-core being built
> **Full design:** See `/Users/phong/Projects/chapterwise-app/.claude/master.plans/native-app/design/2026-02-21-cross-system-integration-design.md`

## Overview

The VS Code extension will integrate with the ChapterWise agent for AI-powered features: analysis execution, INSERT/NOTE commands, and QUERY. The extension itself stays TypeScript — it calls the agent via HTTP API.

## Agent Discovery

The extension discovers an agent in priority order:

1. **Local sidecar** (if native app is running) — free, fast, BYOK
   - Scan well-known ports 17842-17852 for `GET /health` response
   - Use `http://localhost:{port}/api/agent/*`

2. **Cloud agent** (requires ChapterWise account + credits)
   - Use `https://agent.chapterwise.app/api/agent/*`
   - Auth via stored session token (VS Code SecretStorage API)

3. **No agent** — disable agent features, show info message

## Key API Endpoints

All under `/api/agent/`:
- `POST /api/agent/execute` — run a skill (analysis, insert, note, query)
- `POST /api/agent/commands` — free-text command submission
- `GET /api/agent/sessions/{id}` — poll for async results
- `POST /api/agent/sessions/{id}/reply` — respond to confidence gate prompt

## Files to Create (Future)

```
src/
├── agentClient.ts        # HTTP client with discovery, auth, retry
├── agentPanel.ts         # Webview panel for agent chat/results (optional)
└── agentCommands.ts      # VS Code commands: Run Analysis, Insert, Query
```

## Integration Points

| Feature | How it works |
|---------|-------------|
| **Run Analysis** | Right-click in Codex Navigator → "Run Analysis → Characters" → POST to agent → result appears as `.analysis.json` in workspace |
| **INSERT** | Command palette → "ChapterWise: Insert" → dialog for instruction + content → POST to agent → file updates in workspace |
| **QUERY** | Command palette → "ChapterWise: Query" → input box → POST to agent → result shown in output panel or webview |

## Not in Scope

- The extension does NOT run analysis locally (no Python runtime)
- The extension does NOT implement the skill engine
- The extension does NOT handle channels (Telegram, WhatsApp, etc.)
- All AI work is delegated to the agent (local sidecar or cloud)
