# Adding a new extractor

This walks through the shape every extractor follows, using the real ones in this repo as reference rather than inventing a hypothetical example. Read [`ARCHITECTURE.md`](ARCHITECTURE.md) first if you haven't — this assumes you know what the evidence graph is and why extractors are split into a pure parser and a workspace wrapper.

The biggest named gap in the project right now is **JS/TS frontend-call resolution** (matching a `fetch`/`axios` call in a React/Vite client to the specific backend route it hits — see `PHASE5_REVIEW.md`'s "Scope decisions" for why it was deferred, not because it's uninteresting). If you want a concrete first contribution, that's a well-scoped one. The steps below apply whether you're tackling that or something else (a new backend framework, a new ORM, a new message-queue library, …).

## 1. Find real syntax first, before writing a parser

Don't design against an idealized example. Pick a real open-source project (or your own) using the framework/library you're targeting, and find:
- 2–3 concrete examples of the pattern you're extracting, with exact file:line references.
- At least one edge case: a multi-module include, an aliased import, a dynamically-constructed value your parser *can't* resolve (you need this to know what an honest "unresolved" diagnostic should look like).

This isn't a formality — multiple real bugs in this project's history were caught specifically because a test was written against real syntax instead of a simplified version of it. See the "trailing slash dropped" and "Flows view unscoped route flood" entries linked from `PHASE5_REVIEW.md` for examples of what gets missed otherwise.

## 2. Check the parse-tree shape before writing the real parser

If you're parsing a language Archi doesn't already parse (anything other than Python or Compose YAML), you'll need a parser library with the same properties `@lezer/python` already has here: pure JS, no native bindings (VSIX portability), tolerant of syntax errors (so one broken file doesn't block the rest of the workspace), and ideally from the same family (`@lezer/javascript` exists and fits this project's established pattern, if you're tackling JS/TS).

Before writing real extraction logic, write a throwaway script that parses a small real snippet and dumps the tree (`node.name`, `node.from`/`node.to`, children) so you know the actual node names and shape you're matching against — don't guess from another language's grammar. This is exactly how `pythonRoutes.ts` and `pythonTasks.ts` were built: two small probe scripts against real Django/Celery snippets, before any real parsing code, which caught that a decorator's own call arguments (`@shared_task(name=...)`) sit directly on the `Decorator` node rather than nested in a `CallExpression` the way a normal function call's arguments would.

## 3. Write the pure parser

A pure parser:
- Takes a source string (and a `relativePath` for diagnostics) — never a `vscode.Uri`, never calls `vscode.workspace.*`.
- Returns a plain result object plus a `diagnostics: string[]` array — never throws on a parse error; catch it and push a diagnostic instead (see `parseCeleryFile`'s `try { parser.parse(source) } catch`).
- Never fabricates a result for something it can't resolve. A dynamic/unresolvable reference becomes a diagnostic (`"... unresolved ..."` by convention — the extension's `coverage()` helper in `extension.ts` regex-matches on that word to build the coverage summary), not a best-guess edge.
- Reuses the shared AST helpers in `pythonModels.ts` (`slice`, `children`, `callName`, `literal`, `firstArgument`, `keyword`, `findCalls`, `appFromPath`, `lineOf`) if you're extending Python support — they're exported specifically for this. Don't re-implement tree-walking primitives that already exist.

Write this file's unit tests (`test/<name>.test.ts`, plain `node --test`, no VS Code) *as you write the parser*, not after — grounded in the real snippets from step 1.

## 4. Write the workspace wrapper

The workspace wrapper:
- Finds the right files via `vscode.workspace.findFiles` with an exclude glob (copy the pattern from `componentWorkspace.ts`'s `EXCLUDE` constant — `.git`, `node_modules`, `dist`, build output, caches, migrations, tests).
- Reads each file via `vscode.workspace.fs.readFile`, enforcing a size cap (see `MAX_FILE_BYTES` / `MAX_MODEL_BYTES` patterns — a 500 KB–2 MB cap depending on file type) and pushing a diagnostic, not throwing, if a file is too big or unreadable.
- Calls your pure parser per file and assembles the results into `GraphNode[]`/`GraphEdge[]` using `stableId(...)` for every ID — the same real-world entity must get the same ID across re-analyses, or saved view preferences (hidden/renamed/pinned nodes) will silently stop applying to it.
- Determines **ownership** (which service a file belongs to) the same way existing extractors do: match the file's relative path against a system-graph service node's `paths` (Compose build contexts) — see `modelWorkspace.ts`'s `ownerFor()` for the exact longest-prefix-match logic, and reuse it rather than reinventing it if your extractor also needs service ownership.
- Never throws except for `vscode.CancellationError` when the passed `token.isCancellationRequested` — check this before any expensive loop, matching every existing extractor's `if (token.isCancellationRequested) throw new vscode.CancellationError();` pattern.

## 5. Wire it into `extension.ts`

Add your `analyzeXWorkspaces()` call into the `archi.analyzeWorkspace` command handler, after the system graph exists (your extractor almost certainly needs it for ownership resolution — see the call order in `ARCHITECTURE.md`). Decide whether your output belongs in an existing graph (`dataGraph`, `componentGraph`) or needs its own — a new graph needs its own `archi.last<X>Graph` workspace-state key (for `archi.openLastDiagram`), its own slot in the `graph` postMessage payload, and its own entry in `coverage()`'s node/edge totals.

## 6. Wire it into the webview

If you're extending an existing view (e.g. adding a new route-source language to the Flows view), make sure your new nodes carry the same `kind`/`owner`/`app` fields the existing `project()` branch filters on — if they do, you may need no webview changes at all. If you're adding a genuinely new relationship type or node kind, check `media/main.js`'s `render()` (the `node.kind === 'table' ? ... : node.kind === 'route' ? ...` chain for subtitle text) and `inspectNode()` (for detail-panel content) — add a branch, don't let it silently fall through to generic styling if it needs its own explanation.

## 7. Test end-to-end

- Unit tests for the pure parser (step 3) — these should already exist.
- If you touched `extension.ts` or a workspace wrapper, add or extend an assertion in `test/extension.test.ts` against a real workspace. `examples/sample-workspace` is the fast option; for something closer to production scale, point `ARCHI_TEST_WORKSPACE` at any real multi-service project you have access to and confirm the counts/relationships look right by hand first, then assert the specific ones you've verified (see how the existing Django/Celery assertions each cite the exact source line they're checking).
- If you added a webview-visible feature, add a `test/webview.test.cjs` test using the existing `mount()` harness pattern.
- Run `npm run lint && npm test && npm run test:extension` before opening a PR.

## A worked example to study

The Flows view (routes + Celery tasks, Phase 5) is the most recent complete example of this whole process end-to-end: `src/pythonRoutes.ts` + `src/pythonTasks.ts` (pure parsers, with `test/pythonRoutes.test.ts`/`test/pythonTasks.test.ts`), `src/componentWorkspace.ts` (the workspace wrapper), the `components` branch in `media/main.js`'s `project()`/`layout()`, and `PHASE5_REVIEW.md`'s "Method" section, which narrates the actual research-first approach rather than presenting the result as if it were obvious from the start.
