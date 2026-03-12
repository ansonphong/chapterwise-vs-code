# Settings Manager Hardening Plan (Essential)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent path traversal attacks via `dataFolderPath` and `separator` settings, and validate enum values from YAML.

**Architecture:** Add validation helper functions and use them wherever settings are loaded from VS Code config or YAML.

**Tech Stack:** TypeScript, VS Code Extension API

---

## Summary of Changes

| Category | Changes |
|----------|---------|
| Security - Path Traversal | Validate `dataFolderPath` rejects `..`, absolute paths |
| Security - Path Traversal | Validate `separator` only allows safe single characters |
| Data Integrity | Validate `defaultChildMode`, `strategy`, `format` match enum values |

---

### Task 1: Add Validation Helper Functions

**Files:**
- Modify: `src/settingsManager.ts:14-16`

**Step 1: Add validation constants and functions after imports**

Find lines 14-16 (after imports, before interface):

```typescript
import { CodexDocument } from './codexModel';

/**
```

Add validation helpers between them:

```typescript
import { CodexDocument } from './codexModel';

// Valid enum values for settings
const VALID_CHILD_MODES = ['inline', 'separate-file', 'ask'] as const;
const VALID_STRATEGIES = ['organized', 'data-folder', 'flat'] as const;
const VALID_FORMATS = ['string', 'object'] as const;
const VALID_SEPARATORS = ['-', '_', ' ', '.'] as const;

/**
 * Validate dataFolderPath - prevent path traversal
 * Rejects: "..", absolute paths, backslashes
 */
function validateDataFolderPath(path: string | undefined): string {
  const defaultPath = 'Files/Data';
  if (!path || typeof path !== 'string') {
    return defaultPath;
  }

  // Reject path traversal attempts
  if (path.includes('..')) {
    console.warn(`[Settings] Invalid dataFolderPath contains "..": ${path}, using default`);
    return defaultPath;
  }

  // Reject absolute paths (Unix or Windows)
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    console.warn(`[Settings] Invalid dataFolderPath is absolute: ${path}, using default`);
    return defaultPath;
  }

  // Reject backslashes (normalize to forward slashes)
  if (path.includes('\\')) {
    console.warn(`[Settings] dataFolderPath contains backslashes, normalizing: ${path}`);
    path = path.replace(/\\/g, '/');
  }

  return path;
}

/**
 * Validate separator - only allow safe single characters
 */
function validateSeparator(sep: string | undefined): string {
  const defaultSep = '-';
  if (!sep || typeof sep !== 'string') {
    return defaultSep;
  }

  // Only allow single safe characters
  if (!VALID_SEPARATORS.includes(sep as any)) {
    console.warn(`[Settings] Invalid separator "${sep}", using default "-"`);
    return defaultSep;
  }

  return sep;
}

/**
 * Validate defaultChildMode enum
 */
function validateChildMode(mode: string | undefined): 'inline' | 'separate-file' | 'ask' {
  if (mode && VALID_CHILD_MODES.includes(mode as any)) {
    return mode as 'inline' | 'separate-file' | 'ask';
  }
  return 'ask';
}

/**
 * Validate strategy enum
 */
function validateStrategy(strategy: string | undefined): 'organized' | 'data-folder' | 'flat' {
  if (strategy && VALID_STRATEGIES.includes(strategy as any)) {
    return strategy as 'organized' | 'data-folder' | 'flat';
  }
  return 'organized';
}

/**
 * Validate format enum
 */
function validateFormat(format: string | undefined): 'string' | 'object' {
  if (format && VALID_FORMATS.includes(format as any)) {
    return format as 'string' | 'object';
  }
  return 'string';
}

/**
```

**Step 2: Verify syntax**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`

**Step 3: Commit**

```bash
git add src/settingsManager.ts
git commit -m "security(settings): add validation helper functions

Add validators for:
- dataFolderPath: reject '..', absolute paths, backslashes
- separator: only allow '-', '_', ' ', '.'
- defaultChildMode: validate enum values
- strategy: validate enum values
- format: validate enum values

Prevents path traversal attacks via malicious settings."
```

---

### Task 2: Apply Validation to VS Code Settings Loading

**Files:**
- Modify: `src/settingsManager.ts:172-215`

**Step 1: Update defaultChildMode validation**

Find lines 172-175:

```typescript
    const defaultChildMode = config.get<string>('defaultChildMode');
    if (defaultChildMode) {
      settings.defaultChildMode = defaultChildMode as any;
    }
```

Replace with:

```typescript
    const defaultChildMode = config.get<string>('defaultChildMode');
    if (defaultChildMode) {
      settings.defaultChildMode = validateChildMode(defaultChildMode);
    }
```

**Step 2: Update fileOrganization validation**

Find lines 182-188:

```typescript
    if (strategy || dataFolderPath !== undefined || useUuidFilenames !== undefined) {
      settings.fileOrganization = {
        strategy: (strategy as any) || 'organized',
        dataFolderPath: dataFolderPath || 'Files/Data',
        useUuidFilenames: useUuidFilenames !== undefined ? useUuidFilenames : false
      };
    }
```

Replace with:

```typescript
    if (strategy || dataFolderPath !== undefined || useUuidFilenames !== undefined) {
      settings.fileOrganization = {
        strategy: validateStrategy(strategy),
        dataFolderPath: validateDataFolderPath(dataFolderPath),
        useUuidFilenames: useUuidFilenames !== undefined ? useUuidFilenames : false
      };
    }
```

**Step 3: Update separator validation**

Find lines 199-206:

```typescript
      settings.naming = {
        slugify: slugify !== undefined ? slugify : true,
        preserveCase: preserveCase !== undefined ? preserveCase : false,
        separator: separator || '-',
        includeType: includeType !== undefined ? includeType : false,
        includeParent: includeParent !== undefined ? includeParent : false
      };
```

Replace with:

```typescript
      settings.naming = {
        slugify: slugify !== undefined ? slugify : true,
        preserveCase: preserveCase !== undefined ? preserveCase : false,
        separator: validateSeparator(separator),
        includeType: includeType !== undefined ? includeType : false,
        includeParent: includeParent !== undefined ? includeParent : false
      };
```

**Step 4: Update format validation**

Find lines 213-216:

```typescript
      settings.includes = {
        preferRelative: preferRelative !== undefined ? preferRelative : true,
        format: (format as any) || 'string'
      };
```

Replace with:

```typescript
      settings.includes = {
        preferRelative: preferRelative !== undefined ? preferRelative : true,
        format: validateFormat(format)
      };
```

**Step 5: Verify syntax**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`

**Step 6: Commit**

```bash
git add src/settingsManager.ts
git commit -m "security(settings): apply validation to VS Code settings loading

Use validation helpers when loading settings from VS Code config.
Ensures malicious VS Code settings are sanitized."
```

---

### Task 3: Apply Validation to YAML Settings Extraction

**Files:**
- Modify: `src/settingsManager.ts:296-325`

**Step 1: Update defaultChildMode from YAML**

Find lines 297-299:

```typescript
    if (raw.defaultChildMode) {
      settings.defaultChildMode = raw.defaultChildMode;
    }
```

Replace with:

```typescript
    if (raw.defaultChildMode) {
      settings.defaultChildMode = validateChildMode(raw.defaultChildMode);
    }
```

**Step 2: Update fileOrganization from YAML**

Find lines 301-309:

```typescript
    if (raw.fileOrganization) {
      settings.fileOrganization = {
        strategy: raw.fileOrganization.strategy || 'organized',
        dataFolderPath: raw.fileOrganization.dataFolderPath || 'Files/Data',
        useUuidFilenames: raw.fileOrganization.useUuidFilenames !== undefined
          ? raw.fileOrganization.useUuidFilenames
          : false
      };
    }
```

Replace with:

```typescript
    if (raw.fileOrganization) {
      settings.fileOrganization = {
        strategy: validateStrategy(raw.fileOrganization.strategy),
        dataFolderPath: validateDataFolderPath(raw.fileOrganization.dataFolderPath),
        useUuidFilenames: raw.fileOrganization.useUuidFilenames !== undefined
          ? raw.fileOrganization.useUuidFilenames
          : false
      };
    }
```

**Step 3: Update naming.separator from YAML**

Find lines 311-319:

```typescript
    if (raw.naming) {
      settings.naming = {
        slugify: raw.naming.slugify !== undefined ? raw.naming.slugify : true,
        preserveCase: raw.naming.preserveCase !== undefined ? raw.naming.preserveCase : false,
        separator: raw.naming.separator || '-',
        includeType: raw.naming.includeType !== undefined ? raw.naming.includeType : false,
        includeParent: raw.naming.includeParent !== undefined ? raw.naming.includeParent : false
      };
    }
```

Replace with:

```typescript
    if (raw.naming) {
      settings.naming = {
        slugify: raw.naming.slugify !== undefined ? raw.naming.slugify : true,
        preserveCase: raw.naming.preserveCase !== undefined ? raw.naming.preserveCase : false,
        separator: validateSeparator(raw.naming.separator),
        includeType: raw.naming.includeType !== undefined ? raw.naming.includeType : false,
        includeParent: raw.naming.includeParent !== undefined ? raw.naming.includeParent : false
      };
    }
```

**Step 4: Update format from YAML**

Find lines 321-326:

```typescript
    if (raw.includes) {
      settings.includes = {
        preferRelative: raw.includes.preferRelative !== undefined ? raw.includes.preferRelative : true,
        format: raw.includes.format || 'string'
      };
    }
```

Replace with:

```typescript
    if (raw.includes) {
      settings.includes = {
        preferRelative: raw.includes.preferRelative !== undefined ? raw.includes.preferRelative : true,
        format: validateFormat(raw.includes.format)
      };
    }
```

**Step 5: Verify syntax**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`

**Step 6: Commit**

```bash
git add src/settingsManager.ts
git commit -m "security(settings): apply validation to YAML settings extraction

Use validation helpers when extracting navigatorSettings from YAML.
This is the critical path - .codex.yaml files could contain malicious settings."
```

---

### Task 4: Update META-DEV-PROMPT

**Files:**
- Modify: `/Users/phong/Projects/chapterwise-app/dev/META-DEV-PROMPT.md`

**Step 1: Mark Settings Manager as complete**

Find line with Settings Manager and change:

```
| 29 | Settings Manager | ⬜ | 1 | | | Cascading config, defaults |
```

To:

```
| 29 | Settings Manager | ✅ | 1 | 2026-02-05 | | Path traversal prevention, enum validation |
```

**Step 2: Add decision log entry**

Add to NOTES & DECISIONS LOG section:

```markdown
### 2026-02-05 - Settings Manager Hardening (#29) [chapterwise-codex]
Decision: Essential security hardening for VS Code extension settings
Changes:
- dataFolderPath validation: reject '..', absolute paths, backslashes
- separator validation: whitelist only '-', '_', ' ', '.'
- Enum validation: defaultChildMode, strategy, format must match allowed values
- Validation applied to both VS Code settings and YAML extraction
Deferred (Medium priority):
- Color format validation (hex/rgb/named)
- File size limits on settings files
- User notification for invalid settings
```

**Step 3: Commit**

```bash
git add /Users/phong/Projects/chapterwise-app/dev/META-DEV-PROMPT.md
git commit -m "docs: mark Settings Manager as hardened"
```

---

## Verification Checklist

Before marking complete:

- [ ] Validation constants added (VALID_CHILD_MODES, etc.)
- [ ] validateDataFolderPath() function added
- [ ] validateSeparator() function added
- [ ] validateChildMode() function added
- [ ] validateStrategy() function added
- [ ] validateFormat() function added
- [ ] VS Code settings loading uses validators
- [ ] YAML extraction uses validators
- [ ] Extension compiles without errors
- [ ] META-DEV-PROMPT updated
