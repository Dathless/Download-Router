# Download Router — Implementation Plan

## 1. Project Overview

**Project Name:** Download Router  
**Project Type:** Personal Chrome Extension  
**Target Platform:** Google Chrome / Chromium-based browsers  
**Initial Release:** v1.0.0

Download Router is a local-first Chrome extension that automatically routes downloaded files to predefined subdirectories based on configurable URL rules.

Example:

```text
https://github.com/*
    -> Downloads/Development/GitHub/

https://drive.google.com/*
    -> Downloads/Documents/Drive/

https://*.university.edu/*.pdf
    -> Downloads/University/Documents/

https://other-site.com/*
    -> Chrome default download behavior
```

The core routing principle is:

```text
Download
   |
   v
Does an enabled rule match?
   |
   +------------------+
   |                  |
  YES                 NO
   |                  |
   v                  v
Route file        Do not intervene
   |                  |
   v                  v
Configured        Chrome default
subdirectory      behavior
```

### Key Constraint

Version 1 is an extension-only implementation. Chrome's Downloads API allows an extension to suggest a path relative to Chrome's configured Downloads directory, but it does not provide arbitrary filesystem access.

Therefore, v1 supports destinations such as:

```text
Development/GitHub
University/Documents
Books/PDF
```

which resolve to:

```text
<Chrome Downloads Directory>/Development/GitHub/
<Chrome Downloads Directory>/University/Documents/
<Chrome Downloads Directory>/Books/PDF/
```

Arbitrary destinations such as `D:\Projects`, `E:\Books`, or another filesystem root are explicitly deferred to a future Native Messaging architecture.

---

## 2. Goals

### 2.1 Functional Goals

The extension shall:

- Create, edit, delete, duplicate, enable, and disable routing rules.
- Match downloads based on source URL.
- Support domain, prefix, glob, and regular-expression matching.
- Optionally filter rules by file extension and MIME type.
- Route matched downloads to configured subdirectories.
- Preserve normal Chrome behavior for unmatched downloads.
- Resolve overlapping rules by priority, then persisted rule-list order.
- Support configurable filename conflict behavior.
- Persist configuration across browser restarts.
- Provide a global routing enable/disable switch.
- Validate rules before storing them.
- Operate entirely on the local machine.
- Fail safely when an internal extension error occurs.

### 2.2 Non-Functional Goals

The system should:

- Require no backend service.
- Require no database server.
- Require no cloud account.
- Avoid telemetry and analytics.
- Avoid collecting browsing history or page content.
- Request the minimum Chrome permissions required.
- Introduce negligible download-routing latency.
- Remain maintainable as rule capabilities expand.
- Produce deterministic routing decisions.
- Support configuration backup and restoration.
- Keep core business logic independent from Chrome UI code where practical.

---

## 3. Non-Goals for v1

Version 1 will not implement:

- Arbitrary absolute filesystem destinations.
- Native Messaging.
- A custom download manager.
- Download retry or resume functionality.
- Antivirus or malware scanning.
- Cloud synchronization.
- User accounts.
- Remote configuration management.
- AI-based file classification.
- Automatic semantic content classification.
- Firefox or Safari support.
- Server-side processing.
- Cross-device synchronization.

---

## 4. Technology Stack

| Layer | Technology |
|---|---|
| Extension Platform | Chrome Extension |
| Extension Standard | Manifest V3 |
| Language | TypeScript |
| Build Tool | Vite |
| UI | HTML + CSS + TypeScript |
| Background Runtime | Manifest V3 Service Worker |
| Download Integration | `chrome.downloads` |
| Persistence | `chrome.storage.local` |
| Unit Testing | Vitest |
| Linting | ESLint |
| Formatting | Prettier |
| Package Manager | pnpm |
| Version Control | Git |

### Rationale

React, Vue, and other UI frameworks are intentionally excluded from v1. The extension has a small options page and popup with limited state complexity. Vanilla TypeScript keeps the bundle small and reduces maintenance overhead.

---

## 5. High-Level Architecture

```text
               Options UI / Popup
                        |
                 Mutation messages
                        |
                        v
Chrome Download ---> Background Service Worker
 onDeterminingFilename  |
                        +--> ConfigRepository <--> chrome.storage.local
                        |    Read snapshot / serialize mutations
                        v
                   Rule Engine
             Normalize / Filter / Match
             Priority / Stored list order
                        |
                +-------+-------+
                |               |
              MATCH          NO MATCH / ERROR
                |               |
                v               v
        Build relative path   suggest()
                |
                v
        Validate complete path
                |
                v
     suggest({ filename, conflictAction })
```

### Architectural Principles

1. **Core logic is isolated from UI logic.**
2. **Rule matching is deterministic.**
3. **Invalid configuration must never block normal downloads.**
4. **Unmatched downloads remain untouched.**
5. **One configuration repository owns validation and serialized writes.**
6. **Chrome-specific integration remains concentrated in the background layer.**
7. **Security-sensitive path processing is centralized.**

---

## 6. Proposed Project Structure

```text
download-router/
|
+-- src/
|   +-- background/
|   |   +-- index.ts
|   |   +-- download-handler.ts
|   |
|   +-- core/
|   |   +-- rule-engine.ts
|   |   +-- rule-matcher.ts
|   |   +-- path-builder.ts
|   |   +-- path-validator.ts
|   |   +-- url-normalizer.ts
|   |
|   +-- storage/
|   |   +-- config-repository.ts
|   |
|   +-- models/
|   |   +-- config.ts
|   |   +-- download-input.ts
|   |   +-- download-rule.ts
|   |   +-- settings.ts
|   |   +-- match-result.ts
|   |
|   +-- options/
|   |   +-- index.html
|   |   +-- index.ts
|   |   +-- style.css
|   |   +-- components/
|   |
|   +-- popup/
|   |   +-- index.html
|   |   +-- index.ts
|   |   +-- style.css
|   |
|   +-- utils/
|       +-- glob.ts
|       +-- regex.ts
|       +-- id.ts
|
+-- tests/
|   +-- unit/
|   |   +-- download-handler.test.ts
|   |   +-- config-repository.test.ts
|   |   +-- import-export.test.ts
|   |   +-- rule-engine.test.ts
|   |   +-- rule-matcher.test.ts
|   |   +-- path-builder.test.ts
|   |   +-- path-validator.test.ts
|   |   +-- url-normalizer.test.ts
|   |
|   +-- fixtures/
|       +-- rules.ts
|
+-- public/
|   +-- manifest.json
|   +-- icons/
|
+-- docs/
|   +-- ARCHITECTURE.md
|   +-- RULES.md
|   +-- TESTING.md
|
+-- .gitignore
+-- eslint.config.js
+-- prettier.config.js
+-- package.json
+-- tsconfig.json
+-- vite.config.ts
+-- README.md
```

---

## 7. Domain Model

### 7.1 Download Rule

```typescript
type MatchType =
  | "domain"
  | "prefix"
  | "glob"
  | "regex";

type ConflictAction =
  | "uniquify"
  | "overwrite"
  | "prompt";

interface DownloadRule {
  id: string;
  name: string;
  enabled: boolean;

  match: {
    type: MatchType;
    pattern: string;
    extensions?: string[];
    mimeTypes?: string[];
  };

  destination: string;

  priority: number;
  conflictAction?: ConflictAction;

  createdAt: number;
  updatedAt: number;
}
```

### 7.2 Global Settings

```typescript
interface ExtensionSettings {
  enabled: boolean;
  matchRedirectedUrl: boolean;
  defaultConflictAction: ConflictAction;
}
```

An omitted rule `conflictAction` inherits `settings.defaultConflictAction`; an explicit rule value overrides it.

### 7.3 Configuration and Download Input

```typescript
interface ExtensionConfig {
  configVersion: 1;
  settings: ExtensionSettings;
  rules: DownloadRule[];
}

interface DownloadInput {
  url: string;
  finalUrl?: string;
  filename: string; // Basename extracted from Chrome's tentative filename.
  mime: string;
}
```

`configVersion` exists only at the configuration root. The `rules` array order is persisted and preserved by export/import. Background routing and the rule tester use the same `DownloadInput` and matching pipeline.

### 7.4 Match Result

```typescript
interface MatchResult {
  matched: boolean;
  rule?: DownloadRule;
  matchedUrl?: string;
}
```

---

## 8. Rule Matching Specification

### 8.1 Domain Matching

Configuration:

```text
github.com
```

Matches:

```text
https://github.com/user/repository
https://github.com/user/repository/releases/file.zip
```

Must not accidentally match:

```text
https://notgithub.com/
```

Domain comparison uses exact parsed hostnames, normalized to lowercase. A `github.com` domain rule does not include `api.github.com`; subdomain patterns use glob matching.

### 8.2 Prefix Matching

Configuration:

```text
https://example.com/releases/
```

Matches:

```text
https://example.com/releases/application.zip
```

Does not match:

```text
https://example.com/assets/application.zip
```

### 8.3 Glob Matching

Configuration:

```text
https://*.example.com/files/*.pdf
```

Example match:

```text
https://cdn.example.com/files/report.pdf
```

Glob patterns specify a scheme, hostname, and path. Host matching must not consume path characters: a wildcard hostname such as `*.example.com` matches subdomains, not the apex domain or a hostname embedded in another site's path. In the path, `*` matches zero or more characters, including `/`; all other characters are literal. Query strings and fragments are excluded from glob matching. Unsupported glob syntax is rejected rather than interpreted as regex.

### 8.4 Regular Expression Matching

Example:

```regex
^https://.+\.example\.com/releases/.+\.(zip|tar\.gz)$
```

Regex rules are considered an advanced feature.

Requirements:

- Use a locally bundled, non-backtracking engine with bounded matching cost, such as an RE2-compatible implementation. Prove MV3/CSP compatibility in Phase 0 before selecting the dependency.
- Validate and compile expressions with that same engine on save, import, and storage load. Reject unsupported constructs, including backreferences and lookarounds; v1 does not expose regex flags.
- Limit regex patterns to 256 characters. Skip regex evaluation for a candidate URL longer than 8,192 characters, report that reason in the tester, and continue evaluating other candidates and rules.
- Never execute user-supplied regex with native JavaScript `RegExp` as a fallback. Catching exceptions, limiting pattern length alone, and a timer on the same JavaScript thread do not prevent catastrophic backtracking.
- Test syntactically valid adversarial expressions, including nested quantifiers, as well as invalid syntax. A bad rule must not hold the download listener open.

Regex remains a v1 requirement. Do not ship regex support until this execution contract is verified; changing the release scope requires an explicit plan update.

---

## 9. Matching Pipeline

For every download:

```text
DownloadItem
    |
    v
Extract URL information
    |
    +-- url
    +-- finalUrl
    |
    v
Normalize URLs
    |
    v
Load enabled rules
    |
    v
Apply extension and MIME filters for each enabled rule
    |
    v
Match original URL and enabled finalUrl for that rule
    |
    v
Keep the matching rule with greatest priority
    |
    v
On equal priority, keep the earlier rule in the stored list
```

### Priority Example

```text
Rule A
Pattern: github.com
Priority: 10

Rule B
Pattern: https://github.com/company/*
Priority: 100
```

For:

```text
https://github.com/company/project/releases/application.zip
```

Rule B wins.

### Equal Priorities and URL Candidates

Rules are evaluated in persisted array order. A later rule replaces the current winner only when its priority is strictly greater. Priorities must be finite safe integers.

The original URL and an enabled, distinct `finalUrl` are candidates for each rule; neither URL source outranks rule priority or list order. If one rule matches both URLs, return the original URL as `matchedUrl`. Editing a rule preserves its position; a new or duplicated rule is appended. Import preserves the exported order.

For two matching rules with priority 100, the earlier stored rule wins even when it matches `finalUrl` and the later rule matches the original URL.

### Complexity

For `R` configured rules:

```text
Rule selection: O(R) matcher evaluations, with at most two URL candidates per rule
Selection space: O(1), excluding input and compiled matchers
```

Matcher cost also depends on pattern and URL length. Keep only the current winner instead of collecting and sorting all matches. For a personal extension with tens or hundreds of rules, no index is needed.

---

## 10. URL Normalization

URL normalization should be centralized.

The normalizer should:

- Parse URLs using the standard `URL` API.
- Normalize hostname casing.
- Preserve path semantics.
- Preserve query parameter order and values for prefix and regex matching; do not sort queries.
- Remove fragments from matching input.
- Preserve encoded path separators and do not decode the full URL before matching.
- Reject malformed URLs without crashing.
- Expose both original and redirected URL information when available.

Redirect handling must be configurable because a download may originate from:

```text
https://example.com/download/123
```

and eventually resolve to:

```text
https://cdn.example.net/files/application.zip
```

Recommended default:

```text
matchRedirectedUrl = true
```

Candidate policy:

1. Parse and normalize the original URL.
2. Include a valid, distinct `finalUrl` when redirect matching is enabled; a malformed candidate does not discard another valid candidate.
3. Evaluate every enabled rule against the candidates, then apply the priority and list-order policy in Section 9. Never return early just because the original URL matched a lower-priority rule.

All v1 matchers operate on HTTP(S) download URLs. Unsupported schemes fail without interrupting the download. A download URL is not necessarily the page the user clicked: referrer/page-origin routing is outside v1.

---

## 11. Download Processing

The background service worker registers a listener around:

```typescript
chrome.downloads.onDeterminingFilename.addListener(...)
```

### Listener and Startup Contract

Register exactly one listener synchronously at module top level, before asynchronous initialization. Use a regular callback that starts asynchronous processing and returns literal `true`; do not register an `async` listener returning a Promise.

Each invocation calls `suggest` exactly once. Match results supply a validated relative filename; disabled routing, no match, invalid data, and storage/internal failures call `suggest()` without arguments. Guard completion so late work cannot call it twice.

Read the current configuration for each download in v1, avoiding an in-memory cache that can become stale. Use a 1,000 ms watchdog to call `suggest()` if asynchronous work stalls, clear it on completion, and ignore late results. This timer is an I/O fallback, not a way to interrupt synchronous matching; Section 8.4 is still mandatory.

### Processing Flow

```text
onDeterminingFilename
        |
        v
Read and validate current configuration
        |
        v
Check enabled state and build DownloadInput
        |
        v
RuleEngine.match()
        |
     +--+---+
     |      |
   MATCH   NONE
     |      |
     v      v
 Build    suggest()
 path     without arguments
     |
     v
Validate destination and complete relative filename
     |
     v
destination/basename(downloadItem.filename)
     |
     v
suggest({
  filename,
  conflictAction
})
```

For unmatched downloads, the extension should avoid modifying the destination.

### Worker Lifecycle Acceptance

Before building the remaining matchers or UI, verify one domain rule with real Chrome downloads. Close service-worker DevTools, stop the worker, and start another download so it must wake on the event. The first download must route correctly. Also verify disabled/no-match behavior, a storage rejection, and the watchdog with controlled stalled storage in handler tests.

### Fail-Safe Requirement

If any unexpected internal exception occurs:

```text
Extension error
      |
      v
Complete with suggest() without arguments
      |
      v
Log a redacted error without delaying completion
      |
      v
Allow Chrome default behavior
```

Routing functionality must be considered optional enhancement behavior, never a dependency for normal downloading.

---

## 12. Destination Handling

Valid destinations:

```text
Development/GitHub
University/Documents
Books/PDF
Temporary
```

Example final path:

```text
Downloads/
+-- Development/
    +-- GitHub/
        +-- project.zip
```

Invalid destinations include:

```text
../Documents
../../
C:\Users\...
D:\Downloads
/root/
~/Documents
```

### Validation Rules

The path validator must:

- Reject absolute paths.
- Reject parent-directory traversal.
- Normalize path separators.
- Remove or reject empty path segments where appropriate.
- Reject invalid path components.
- Prevent unexpected control characters.
- Respect platform and Chrome filename restrictions.
- Avoid silently transforming dangerous paths into unrelated destinations.

---

## 13. Filename Strategy

Version 1 preserves the basename of Chrome's tentative `DownloadItem.filename`, not the entire absolute local path and not the URL's last segment. Split on both `/` and `\` so Windows and POSIX-style inputs behave consistently.

Use that same basename for extension filtering. Trim leading dots from configured extension filters, compare case-insensitively, and match complete suffixes (`.tar.gz` as well as `.pdf`). An empty extension/MIME list means no restriction; a missing MIME cannot satisfy a non-empty MIME filter. MIME matching is case-insensitive and exact in v1. Any entry may satisfy its list, but every configured filter category must pass.

Validate the destination, basename, and complete `destination/basename` before calling `suggest`. Reject an empty basename, `.` or `..`, control characters, or invalid filename components and fall back to `suggest()` without rewriting the name. Preserve Unicode, spaces, and valid punctuation; do not URL-decode the filename.

Example:

```text
Source filename:
project-v1.2.zip

Destination:
Development/GitHub

Result:
Development/GitHub/project-v1.2.zip
```

Filename templating is deferred to a later release.

Potential future syntax:

```text
{filename}
{domain}
{date}
{extension}
```

Example:

```text
{domain}/{date}/{filename}
```

could produce:

```text
github.com/2026-10-15/project.zip
```

---

## 14. Filename Conflict Strategy

Supported strategies:

### Uniquify

Recommended default.

```text
report.pdf
report (1).pdf
report (2).pdf
```

### Overwrite

Replace an existing file when Chrome permits the configured behavior.

This should never be the default because accidental data loss is possible.

### Prompt

Allow Chrome to request user interaction when appropriate.

Recommended default:

```text
uniquify
```

---

## 15. Options Page

The options page is the primary management interface.

Conceptual layout:

```text
Download Router
------------------------------------------------

Extension                                [ ON ]

Routing Rules

+---+------------+--------------------------+--------------------+-----+
|   | Name       | Pattern                  | Destination        | Pri |
+---+------------+--------------------------+--------------------+-----+
| x | GitHub     | github.com               | Dev/GitHub         | 100 |
| x | University | https://*.uni.edu/*.pdf   | University/PDF     | 80  |
|   | Drive      | drive.google.com         | Documents/Drive    | 50  |
+---+------------+--------------------------+--------------------+-----+

                                         [ + Add Rule ]
```

Supported operations:

- Create.
- Edit.
- Delete.
- Duplicate.
- Enable.
- Disable.
- Search/filter rules if the rule count grows.

---

## 16. Rule Editor

Conceptual interface:

```text
Edit Rule
------------------------------------------------

Name
[ GitHub Releases              ]

Match Type
[ Glob v ]

Pattern
[ https://github.com/*         ]

Extensions
[ zip, tar.gz                  ]

MIME Types
[                              ]

Destination
[ Development/GitHub           ]

Priority
[ 100                          ]

Conflict Action
[ Use global default v ]

[x] Enabled

[Test Rule]

URL
[ https://github.com/...       ]

Final URL (optional)
[ https://cdn.example.com/...  ]

Filename (basename)
[ project.zip                 ]

MIME Type (optional)
[ application/zip             ]

Result
MATCH


                         [Cancel] [Save]
```

### Rule Testing

A rule-testing utility should be provided because glob and regex rules are easy to configure incorrectly.

The test operation should:

- Validate the rule.
- Accept original URL, optional final URL, filename, and optional MIME type as the shared `DownloadInput`. Missing MIME is represented as an empty string.
- Apply the same URL normalization, redirect setting, URL/extension/MIME filters, and path validation used by the background handler.
- Show whether the edited rule matches, the matched URL, the relative target path, or the failed filter/validation reason.
- If an active extension or MIME filter lacks its test input, show an incomplete-input message rather than a successful match. Do not guess a filename or MIME from the URL.

The testing feature must not use a separate matching implementation. Test parity with background routing using the same fixtures, including a URL `/download/123` whose tentative filename is `report.pdf` and MIME is `application/pdf`. The editor tests the selected rule; whole-list priority resolution is verified by rule-engine tests.

---

## 17. Popup

The popup should remain intentionally small.

Example:

```text
Download Router

Routing                         [ ON ]

Rules
8 enabled / 10 total

Last routed:
project.zip
-> Development/GitHub/

[ Manage Rules ]
```

Primary purposes:

- Toggle routing globally.
- Show basic status.
- Show the latest routing event.
- Open the options page.

Full rule editing should remain on the options page.

---

## 18. Persistence

Use:

```typescript
chrome.storage.local
```

The canonical `ExtensionConfig` object is stored under one `config` key. Its value is:

```json
{
  "configVersion": 1,
  "settings": {
    "enabled": true,
    "matchRedirectedUrl": true,
    "defaultConflictAction": "uniquify"
  },
  "rules": []
}
```

Do not use browser `localStorage` for extension configuration.

Create defaults only when `config` is absent on a fresh installation. Do not replace existing configuration with defaults on worker startup, Chrome update, parse failure, or unsupported version. Runtime validation skips invalid individual rules without rewriting their stored data; an invalid configuration envelope disables routing safely and reports a recoverable error.

### Repository Layer

Use one configuration module:

```text
ConfigRepository
```

It reads and validates `config`, and writes the complete validated configuration with one awaited `chrome.storage.local.set({ config })` call. UI mutations go through background messages and are serialized there. Apply each edit/toggle to the latest stored snapshot inside that queue; callers send mutation intent rather than stale whole-configuration copies. Confirmed import is the explicit whole-configuration replacement. UI reads may use storage and `storage.onChanged` to reflect completed writes.

Never clear storage before a replacement write. Report success only after the write succeeds, surface write errors to the caller, and do not reset or retry by writing defaults on failure. Keep background routing based on a single configuration snapshot per download.

---

## 19. Configuration Versioning and Migration

Configuration versioning exists from the first release at the root of `ExtensionConfig`. Storage, export, and import share this schema and validator; extension package version and schema version are separate concepts.

```json
{
  "configVersion": 1
}
```

V1 accepts only `configVersion: 1`. Missing, older, or newer versions are rejected without modifying stored data. There is no older released schema to migrate yet; add a migration module and its tests when the first actual schema change is introduced.

Future schema changes use explicit migration:

```text
Config v1
    |
    v
Migration
    |
    v
Config v2
```

Example future field:

```text
filenameTemplate
```

Requirements when a migration becomes necessary:

- Never silently discard existing rules.
- Keep migrations deterministic.
- Test migration functions independently.
- Back up or retain the original object until migration succeeds.
- Fall back safely if a configuration cannot be migrated.

---

## 20. Import and Export

Configuration export/import is required for v1. Export the canonical configuration directly; no separate export version or metadata envelope is needed.

Example export:

```json
{
  "configVersion": 1,
  "settings": {
    "enabled": true,
    "matchRedirectedUrl": true,
    "defaultConflictAction": "uniquify"
  },
  "rules": []
}
```

Import flow:

```text
Select JSON
    |
    v
Parse
    |
    v
Schema validation
    |
    v
Rule validation
    |
    v
Preview
    |
    v
User confirmation
    |
    v
Persist
```

Never write imported configuration to storage before validation succeeds.

### V1 Import Contract

- Import replaces the entire settings/rules configuration after preview and explicit user confirmation; merging is deferred to v1.1.
- Validate the envelope, supported `configVersion`, settings, every rule, unique non-empty rule IDs, patterns, destinations, and finite integer priorities. Reject the entire import if any entry is invalid; do not silently drop rules.
- Preserve rule IDs, timestamps, and array order so exporting and importing reproduces routing decisions, including equal-priority results.
- Preview the replacement rule count and changed settings. If the current configuration changed after preview, require a refreshed preview before replacement.
- Check that preview snapshot inside the mutation queue immediately before committing the import.
- Commit through the serialized configuration writer in Section 18 with one awaited write. Cancellation, parsing/validation/version errors, and a rejected storage write must not trigger a clear or default reset.
- Test export/import equivalence, duplicate IDs, unsupported versions, cancellation, stale preview, and write failure. A failed import must leave the previous configuration usable.

---

## 21. Security Requirements

The extension follows the principle of least privilege. V1 declares `downloads` and `storage` only; core routing does not require host, tabs, scripting, or browsing-history permissions.

### Data Collection

The extension must not intentionally collect:

- Browsing history.
- Cookies.
- Passwords.
- Authentication tokens.
- Page contents.
- Form data.
- Personal analytics.

### Network Behavior

The extension should not require network requests for its core functionality.

### Code Security

Requirements:

- No `eval()`.
- No remotely hosted executable scripts.
- Validate imported configuration.
- Validate regular expressions with the selected bounded engine; never evaluate imported patterns using native `RegExp`.
- Validate all destination paths.
- Sanitize data rendered into the UI.
- Avoid unnecessary host permissions.
- Keep extension permissions minimal.

### Path Security

The path layer must defend against:

- Directory traversal.
- Absolute path injection.
- Invalid path segments.
- Reserved names where applicable.
- Unexpected separators.
- Control-character injection.

---

## 22. Error Handling

Recommended domain-specific errors:

```typescript
class RuleValidationError extends Error {}
class InvalidPatternError extends Error {}
class InvalidDestinationError extends Error {}
class StorageError extends Error {}
```

A malformed rule must be isolated.

Example:

```text
Rule A -> invalid
Rule B -> valid
Rule C -> valid
```

Rule A should be skipped or disabled while B and C remain operational.

### Core Failure Policy

```text
Internal extension failure
          |
          v
Do not intentionally block the download
          |
          v
Use Chrome's normal behavior
```

This is a release-critical requirement.

---

## 23. Logging

A lightweight internal logger is sufficient.

Development levels:

```text
DEBUG
INFO
WARN
ERROR
```

Production levels:

```text
WARN
ERROR
```

An optional in-memory or locally persisted ring buffer may retain approximately 50–100 recent events.

Example:

```text
09:30:12 ROUTED
Rule: GitHub
Target: Development/GitHub/project.zip
```

Avoid retaining full sensitive URLs longer than necessary. Query parameters may contain tokens or other private information.

---

## 24. Testing Strategy

### 24.1 Unit Tests

Highest-priority modules:

- `RuleMatcher`
- `RuleEngine`
- `URLNormalizer`
- `PathBuilder`
- `PathValidator`
- Download handler and configuration repository
- Import validation

Required cases include:

```text
Exact domain
Subdomain behavior
Prefix
Glob
Regex

Query strings
Fragments
URL encoding
Redirected URLs

Multiple matching rules
Priority resolution
Equal-priority rules preserve persisted list order
Original URL and finalUrl compete by rule priority, not URL source
Disabled rules

.pdf filtering
.tar.gz filtering
MIME filtering

Invalid regex
Valid nested-quantifier regex does not cause unbounded matching
Unsupported regex constructs and pattern/URL length limits
Invalid destination
../ traversal
Absolute paths
Windows and POSIX absolute filenames reduce to the same basename
Empty/invalid basenames fall back without URL-derived filenames

Filename conflict policy
Malformed stored configuration
Exactly one suggest call on match, no match, disabled state, and errors
Async listener returns true synchronously
Stalled storage completes at 1,000 ms; late results never call suggest again
Concurrent options/popup changes do not lose unrelated edits
Config schema is identical in storage and export/import
Export/import preserves settings, rule IDs, timestamps, order, and decisions
Import rejects invalid rules, duplicate IDs, and unsupported versions
Cancelled/stale-preview/failed imports preserve existing configuration
Rule tester and background agree on filename/MIME/redirect fixtures
```

### Coverage Target

Core modules:

```text
>= 90% unit-test coverage
```

UI code does not need the same coverage target.

Coverage is a supporting metric, not a substitute for the cases above. Use controlled promises and fake timers for handler failure/watchdog tests; verify worker wake-up and actual filesystem destinations in Chrome. Add migration tests only when a real migration exists.

---

## 25. Integration and Manual Tests

The unpacked extension should be tested directly in Chrome.

### Integration Matrix

| Scenario | Expected Result |
|---|---|
| Matching domain | Routed |
| Matching glob | Routed |
| Matching regex | Routed |
| No matching rule | Chrome default behavior |
| Disabled rule | Chrome default behavior |
| Multiple matches | Highest priority wins; equal priorities use stored list order |
| Duplicate filename | Configured conflict strategy |
| Redirect | Matches according to redirect policy |
| Invalid rule | Other downloads remain unaffected |
| Global extension disabled | All downloads use default behavior |
| Chrome restart | Configuration remains available |
| First download after worker termination, DevTools closed | Worker wakes and routes using persisted configuration |
| Storage failure | Download continues with default behavior |
| Valid adversarial regex | Bounded engine completes without holding the handler open |
| URL without filename, Content-Disposition supplies report.pdf | Extension filter uses report.pdf and tester agrees |
| Windows/POSIX path in tentative filename | Only its basename appears under the configured destination |
| Import replacement | Exact settings and rule order restored after confirmation |
| Failed import/write or unsupported version | Previous configuration remains usable |

### Manual Acceptance Setup

Use a small local HTTP fixture server with direct downloads, a redirect, and a `/download/123` response carrying `Content-Disposition: attachment; filename="report.pdf"`. It is a development/test fixture only; the installed extension still needs no backend. Record Chrome version, OS, and actual saved relative paths. Check Save As enabled/disabled and a conflicting filename extension separately; document Chrome/user overrides rather than promising control of the final save location.

Example test rules:

```text
GitHub
-> DownloadRouterTest/GitHub

PDF
-> DownloadRouterTest/PDF
```

Expected:

```text
GitHub ZIP
    |
    v
DownloadRouterTest/GitHub/*.zip

Matching PDF
    |
    v
DownloadRouterTest/PDF/*.pdf

Unmatched download
    |
    v
Normal Chrome behavior
```

---

## 26. Development Phases

### Phase 0 — Foundation and Chrome Feasibility

Tasks:

- Initialize Git repository.
- Initialize pnpm project.
- Configure TypeScript.
- Configure Vite.
- Configure ESLint.
- Configure Prettier.
- Configure Vitest.
- Create Manifest V3 skeleton.
- Configure development and production builds.
- Add basic extension icons.
- Document local installation procedure.
- Declare only `downloads` and `storage`; make build output paths agree with the manifest's worker, options, and popup entries. Bundle executable code locally under MV3 CSP.
- Prove one stored domain rule with basename extraction, path validation, and a top-level download listener using the completion contract in Section 11. Reuse this implementation in later phases.
- Verify a real routed download after worker termination with DevTools closed, plus unmatched/disabled behavior and injected storage failures.
- Select and record the bounded regex engine after verifying its MV3/CSP build, unsupported-syntax rejection, and adversarial-input behavior. Do not implement user regex with native `RegExp` while this is unresolved.

Deliverables:

```text
Git repository
TypeScript build
Vite build
ESLint
Prettier
Vitest
Manifest V3
dist/
```

Acceptance Criteria:

- Extension builds without TypeScript errors.
- `dist/` can be loaded through `chrome://extensions`.
- Service worker starts without runtime errors.
- Lint and unit-test commands execute successfully.
- The domain-rule download experiment passes, including worker wake-up and default fallback; handler tests cover the watchdog and late completion.
- The regex engine decision and its proof are recorded before implementing the remaining matchers. Stop at this gate if a safe engine cannot run in MV3.

---

### Phase 1 — Core Domain and Rule Engine

Extend and reuse the Phase 0 domain-rule implementation rather than maintaining a separate prototype.

Implement:

- Canonical configuration and shared download-input models, with validators.
- URL normalizer.
- Domain matcher.
- Prefix matcher.
- Glob matcher.
- Regex matcher using the bounded engine proven in Phase 0, with explicit syntax and input limits.
- Extension filtering.
- MIME filtering.
- Rule priority resolution with persisted list-order ties and original/final URL candidates.
- Path builder.
- Path validator.

Acceptance Criteria:

- Core functionality is independent from UI.
- Core unit tests pass.
- Core test coverage reaches at least 90%.
- Invalid rules do not crash the rule engine.
- Tests cover equal priorities across URL candidates, basename-based compound extensions, missing MIME, bounded regex execution, and complete path validation.

---

### Phase 2 — Full Chrome Integration and Reliability

Implement:

- Extend the Phase 0 handler to use the complete rule engine; retain its top-level listener, exactly-once completion, watchdog, and fallback behavior.
- Canonical `ConfigRepository`, runtime validation, fresh-install defaults, and supported-version checks.
- Serialized background mutation messages used by later options, popup, and import flows.
- Global enabled state.
- Redirect policy.
- Fail-safe error handling.

Acceptance Criteria:

```text
Matching URL
    -> routed

Non-matching URL
    -> untouched
```

This phase produces the first functional MVP.

Before UI work, rerun the real Chrome experiment with the full engine, stopped worker, storage failures, and malformed configuration. Required handler tests must show one completion on all branches and no second suggestion from a late result. Verify concurrent mutation requests preserve unrelated settings/rules, and rejected writes do not reset configuration. These are MVP gates, not work deferred to Phase 5.

---

### Phase 3 — Rule Management UI

Implement:

- Rule list.
- Create rule.
- Edit rule.
- Delete rule.
- Duplicate rule.
- Enable/disable rule.
- Priority editing.
- Conflict strategy.
- Input validation.
- Rule testing utility.

Acceptance Criteria:

- All normal rule-management operations can be completed through the UI.
- Manual JSON editing is not required.
- Invalid rules cannot be saved without a clear validation error.
- The tester accepts filename/MIME/finalUrl, identifies missing filter inputs, and agrees with background fixtures.
- Editing preserves list position; creation/duplication appends; users can see that list order breaks priority ties.

---

### Phase 4 — Popup and User Experience

Implement:

- Global ON/OFF toggle.
- Enabled-rule count.
- Last routing event.
- Shortcut to options page.
- Basic status indicators.

Acceptance Criteria:

- Common status and toggle operations do not require manually opening the options page.
- Popup state remains synchronized with stored settings.

---

### Phase 5 — Reliability Regression and Hardening

Recheck the reliability already required by Phases 0–2 and verify the remaining edge cases:

- Storage error handling.
- Corrupted configuration handling.
- Unsupported-version recovery without rewriting stored data; no speculative migration framework.
- Redirect edge cases.
- Filename edge cases.
- Path security.
- Invalid and valid adversarial regex handling using the bounded engine.
- Background worker wake-up regression with DevTools closed.
- Error logging.
- Recovery behavior.

Acceptance Criteria:

- Extension failures do not intentionally prevent normal Chrome downloads.
- Corrupted individual rules do not disable unrelated valid rules.
- Security-related path tests pass.
- Earlier completion, lifecycle, and configuration-preservation gates still pass after UI integration.

---

### Phase 6 — Configuration Portability

Implement:

- Export configuration.
- Import configuration.
- Schema validation.
- Import preview.
- Replacement confirmation with a stale-preview check.
- Reject unsupported versions and duplicate rule IDs; preserve exported list order.
- Failed-write handling without clearing the existing configuration.

Acceptance Criteria:

```text
Export configuration
        |
        v
Reset/remove local configuration
        |
        v
Import configuration
        |
        v
Equivalent settings and rules restored
```

Use a disposable test profile for the reset step. Also verify an import over an existing configuration without clearing it first, exact routing equivalence for equal-priority rules, and unchanged existing data on invalid input, cancellation, stale preview, or a rejected write. V1 does not implement schema migration or configuration merging.

---

### Phase 7 — Release Preparation

Prepare:

- Production build.
- `README.md`.
- `ARCHITECTURE.md`.
- `RULES.md`.
- `TESTING.md`.
- `CHANGELOG.md`.
- Installation instructions.
- Known limitations.
- Release checklist.

Target release:

```text
v1.0.0
```

For personal use, publishing to the Chrome Web Store is not required.

Installation:

```text
chrome://extensions
    |
    v
Enable Developer Mode
    |
    v
Load unpacked
    |
    v
Select dist/
```

---

## 27. Git Workflow

A lightweight feature-branch workflow is sufficient.

```text
main
 |
 +-- feat/rule-engine
 +-- feat/download-handler
 +-- feat/options-ui
 +-- feat/import-export
 +-- fix/redirect-matching
```

Use Conventional Commits:

```text
feat: add glob rule matching

fix: preserve filename after redirect

test: add path traversal cases

refactor: extract storage repository

docs: document rule priority
```

For a personal project, GitFlow would add unnecessary process overhead.

---

## 28. Definition of Done

A feature is considered complete only when:

- Implementation is complete.
- TypeScript compilation passes.
- ESLint passes.
- Relevant unit tests pass.
- Important edge cases are covered.
- No unnecessary Chrome permission is added.
- Unmatched downloads retain normal Chrome behavior.
- Manual testing passes where Chrome API integration is involved.
- Download handlers complete exactly once, including storage errors and watchdog expiry.
- Configuration changes do not silently erase existing data or reset an unsupported schema.
- Documentation is updated when behavior or configuration changes.

### v1.0.0 Release Definition

The initial release is complete when the following are verified:

```text
[ ] URL routing
[ ] Domain matching
[ ] Prefix matching
[ ] Glob matching
[ ] Bounded regex engine, unsupported syntax rejection, and adversarial tests
[ ] Extension filtering
[ ] MIME filtering
[ ] Rule priority and persisted-order ties across original/final URLs
[ ] Conflict handling
[ ] Rule CRUD
[ ] Rule duplication
[ ] Rule enable/disable
[ ] Global enable/disable
[ ] Persistent configuration
[ ] Shared configuration schema and serialized writes
[ ] Rule validation
[ ] Path traversal protection
[ ] Basename extraction and complete relative-path validation
[ ] Redirect handling
[ ] Replace-only import/export, failed-write preservation, and round-trip equivalence
[ ] Rule tester parity for filename, MIME, and redirect inputs
[ ] Exactly-once suggest completion, watchdog, and late-result handling
[ ] First download after worker termination with DevTools closed
[ ] Core automated tests
[ ] Manual Chrome integration tests
[ ] User documentation
[ ] Architecture documentation
```

---

## 29. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Chrome API cannot target arbitrary absolute paths | High | Restrict v1 to Downloads subdirectories; use Native Messaging in v2 |
| Overlapping rules produce unexpected routing | Medium | Priority then stored list order across both URL candidates |
| Valid regex causes catastrophic backtracking | High | Proven non-backtracking engine, bounded inputs, no native RegExp fallback, adversarial tests |
| Invalid regex breaks matching | Medium | Validate with the same engine on save/import/load; isolate invalid rules |
| Async listener never completes or completes twice | High | Synchronous registration/return true, guarded suggest completion, watchdog, late-result tests |
| Directory traversal through destination input | High | Centralized strict path validation |
| Absolute tentative filename leaks into suggestion | High | Extract basename, validate complete relative path, default fallback on invalid input |
| Corrupted stored configuration | Medium | One versioned schema, runtime validation, preserve original data, safe fallback |
| Import or concurrent UI writes lose configuration | High | Serialized mutations, one awaited replacement write, stale-preview check, no clear/reset on failure |
| Service worker lifecycle misses the first download | High | Top-level listener, read configuration per download, cold-worker test before UI work |
| Redirect changes source domain | Medium | Explicit original/final URL matching policy |
| Another extension also changes download filenames | Low/Medium | Document compatibility limitation and fail safely |
| Sensitive URL parameters appear in logs | Medium | Avoid or redact full URL logging |
| Excessive architecture for a personal tool | Medium | Keep v1 local, framework-light, and backend-free |

---

## 30. Future Roadmap

### v1.1 — Quality of Life

Potential additions:

- Better rule search and filtering.
- Drag-and-drop rule ordering.
- Improved activity log.
- Enhanced rule test tool.
- Configuration merge during import.
- Additional validation feedback.

### v1.2 — Filename Templates

Possible variables:

```text
{filename}
{domain}
{date}
{extension}
```

Example:

```text
{domain}/{date}/{filename}
```

Result:

```text
github.com/2026-10-15/project.zip
```

### v2.0 — Arbitrary Filesystem Destinations

If absolute directories become a hard requirement, introduce a Native Messaging host.

Target behavior:

```text
github.com
-> D:\Development\GitHub

university.edu
-> E:\University

example.com
-> F:\Archive
```

Proposed architecture:

```text
              Chrome
                |
                v
       +-----------------+
       |    Extension    |
       | TypeScript/MV3  |
       +--------+--------+
                |
        Native Messaging
                |
                v
       +-----------------+
       |   Native Host   |
       |     .NET        |
       +--------+--------+
                |
        +-------+-------+
        |       |       |
        v       v       v
       C:\     D:\     E:\
```

For a Windows-focused personal tool, C#/.NET is the recommended native-host stack because it provides strong filesystem APIs, straightforward JSON/stdin/stdout IPC, and convenient executable packaging.

The native host must be treated as a separate security boundary and should only accept narrowly defined, validated operations from the extension.

---

## 31. Delivery Roadmap

```text
                 Download Router
                        |
                        v
            Phase 0 Chrome Feasibility
                        |
                        v
                 Phase 1 Core
                        |
                        v
            Phase 2 Full Integration
                        |
                        v
                     MVP
                        |
                        v
               Phase 3 Options UI
                        |
                        v
                Phase 4 Popup
                        |
                        v
            Phase 5 Reliability Regression
                        |
                        v
           Phase 6 Import / Export
                        |
                        v
               Phase 7 Release
                        |
                        v
                     v1.0
                        |
               +--------+---------+
               |                  |
        Requirements met     Need arbitrary
                             filesystem paths?
                                  |
                                 YES
                                  |
                                  v
                          Native Messaging
                                  |
                                  v
                                v2.0
```

---

## 32. Final Architecture Decision

The recommended v1 architecture is:

```text
Manifest V3
+ TypeScript
+ Vite
+ Vanilla HTML/CSS
+ chrome.downloads
+ chrome.storage.local
+ Vitest
```

No backend, database, Docker environment, UI framework, or native process is required for the initial version.

Engineering effort should primarily focus on:

1. A reliable and deterministic rule engine.
2. Correct Chrome download interception.
3. Strict path validation.
4. Fail-safe behavior.
5. One versioned configuration schema, safe persistence, and replacement import/export.
6. Comprehensive testing of matching and path edge cases.

This provides a small but production-quality architecture appropriate for a personal tool while preserving a clear upgrade path to Native Messaging if arbitrary filesystem routing becomes necessary.

### Platform References

- [Chrome downloads API: filename suggestions and listener completion](https://developer.chrome.com/docs/extensions/reference/api/downloads#event-onDeterminingFilename)
- [Register extension service-worker listeners synchronously](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/events)
- [Service-worker lifecycle and persistent state](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [V8: catastrophic backtracking and non-backtracking matching](https://v8.dev/blog/non-backtracking-regexp)
