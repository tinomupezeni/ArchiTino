# Phase 4 review — unified navigation and useful abstraction

Validated on 2026-10-30 against a read-only HBEC workspace and the local webview test harness. `npm run lint`, `npm test` (17 tests, including 3 new `sanitizeViewState` unit tests and 3 new webview-navigation tests), and `ARCHI_TEST_WORKSPACE=/home/shadowe/Projects/HBEC npm run test:extension` all pass. The extension-host run reproduces Phase 3's HBEC counts unchanged (79 model files, 138 data nodes, 148 graph edges), confirming Phase 4 changed presentation and navigation only, not extraction.

## What changed

- **Cross-view navigation.** A system-map service node whose label matches a data-map `owner` now shows an **Explore data** action in its details panel; it jumps to the data view pre-scoped to that service, pushing the prior system-view state (focus, selection, filters) onto a breadcrumb stack. A data-map table/model node whose `owner` matches a system-map service label shows **Open in system map**, jumping back and re-focusing the owning area. A **Back** button and a breadcrumb trail (`System › Data`) unwind either hop. This satisfies the exit-gate requirement that a system-to-table journey not require manually matching names across two separate diagrams.
- **View-preference persistence.** `src/viewState.ts` defines and sanitizes a `ViewState` (hidden node IDs, renamed labels, pinned positions, active relation/data-mode/owner/app/zoom/view-mode filters); `src/viewStateStore.ts` reads and writes it as `.archi/views/default.json` under the first workspace folder, created on demand. `extension.ts` loads it before showing a diagram and writes it back on a `saveView` message from the webview (debounced client-side, sanitized again server-side before the write). Facts (nodes/edges) are never read from this file — only presentation. Reanalysis (`archi.analyzeWorkspace`) and `archi.openLastDiagram` both load the same file, so regenerating facts does not discard the user's view.
- **Node interaction.** The details panel can hide a node (with a toolbar "Unhide N node(s)" control to restore), rename it inline, and nodes can be dragged to a pinned position; all three write through to the saved view state.
- **Node budget.** The default (ungrouped, unfocused) system view now carries an explicit 60-node budget. Exceeding it shows a warning banner above the canvas rather than dropping nodes, per the "offer expansion instead of silently hiding facts" requirement. HBEC's grouped default view (6 areas) stays well under this budget; it is reachable when an area or app is unusually large.
- **Coverage/diagnostic summary.** A line above the diagnostics list now reports total nodes/edges plus counts of "unresolved" and "skipped" diagnostic entries, computed from the existing diagnostic strings (`coverage()` in `extension.ts`) rather than a new extraction pass.

## What did not change

- Compose and model extraction, grouping rules, confidence levels, and the HBEC reference relationships from Phase 2/3 are untouched; `scripts/test-extension.cjs` against HBEC reproduces the same relationship assertions.
- Multi-root ownership labelling and a dedicated diagnostics *panel* (as opposed to the existing list plus a coverage summary line) were scoped down: the current diagnostics list format already carries per-folder and per-file context in its strings, and HBEC — the only multi-service validation target available — does not exercise multiple *workspace folders* with colliding service names, so no additional disambiguation UI was added speculatively.

## Known gaps

- Pinned positions and hidden/renamed nodes are keyed by stable node ID; if an underlying Compose service or model is removed, its saved preference becomes an orphaned, harmless entry in `.archi/views/default.json` rather than being pruned.
- The node-budget warning is advisory only; there is no automatic re-grouping once the budget is exceeded. It directs the user to search or scope filters, consistent with "never silently hide facts."
- The "shared views committed to each project vs. user storage" open decision from `PLAN.md` is still open; `.archi/views/` is written into the analyzed workspace as the plan's default, and Archi's own `.gitignore` now excludes `.archi/` so dev-time use of the extension on its own repo does not accidentally stage personal view state.

## Verification

`npm run lint`, `npm test`, and `ARCHI_TEST_WORKSPACE=/home/shadowe/Projects/HBEC npm run test:extension` pass. New webview tests cover: a system service with owned data offering and completing a round trip through **Explore data** / **Open in system map** / **Back**; hiding a node, confirming a `saveView` message is posted, and restoring it via **Unhide**; and a `graph` message carrying a saved `ViewState` correctly restoring view mode, owner, data mode, and the coverage summary text. `sanitizeViewState` has unit tests for well-formed input, malformed/oversized input, and clamped/capped pinned-position maps.
