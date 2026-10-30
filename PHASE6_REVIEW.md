# Phase 6 review — quality and distribution

Validated on 2026-10-30 against HBEC, Archi's own repo, and a new minimal example workspace. `npm run lint`, `npm test` (29 tests, up from 27), `npm run test:extension` (both against Archi's own repo and HBEC), and `npm run benchmark` all pass.

## Benchmark

`test/benchmark.ts` + `scripts/benchmark.cjs` (new) run the full analysis pipeline (Compose, data, components) twice in the same extension-host process — a "cold" pass and an immediate "warm" pass — and report elapsed time, files read, graph size, and resident memory. Against HBEC:

| Pass | Time | Files | Nodes | Edges | RSS |
| --- | --- | --- | --- | --- | --- |
| Cold | 3.8 s | 164 | 598 | 577 | 232 MB |
| Warm | 1.6 s | 164 | 598 | 577 | 242 MB |

**Release budget set from this measurement**: full analysis of a workspace HBEC's size (6 Django/FastAPI-style services, ~160 source files examined) should complete well under 5 seconds and stay under 300 MB RSS. Nothing here crossed into "needs optimization" — per the plan's "optimize only measured bottlenecks" instruction, no speculative optimization was done. If a future workspace's analysis exceeds roughly 2–3× these numbers, that's the signal to profile, not a guess now.

A real (if minor) bug was found while building this: `componentWorkspace.ts`'s `ComponentAnalysis.files` field was set to `nodes.length` — a copy-paste leftover, not a files-scanned count. It was unused in the shipped UI (dead field) but would have misled anyone relying on it, including this new benchmark. Fixed to track actual `urls.py`/`tasks.py`/`views.py` files read (HBEC: 84, not 423); the subtitle bar now also surfaces the Flows route/task count, which it previously computed but never displayed.

## Accessibility

Reviewed keyboard navigation, ARIA roles, and theme adaptation against the plan's "themes, zoom, accessible labels" requirement. Found and fixed one real defect: the canvas `<svg>` root used `role="img"`, which per ARIA semantics signals a single non-interactive graphic and can cause assistive technology to flatten or skip its descendants — exactly wrong for a diagram whose nodes and edges are individually focusable, `role="button"` elements. Changed to `role="group"`, which doesn't suppress child semantics. Also added `role="status" aria-live="polite"` to the node-budget warning banner, the one piece of diagram-area text that can appear or change without a corresponding focus move (unlike the details panel, already `aria-live="polite"`, or the coverage/diagnostics text, set once per analysis). Everything else checked out already correct by earlier design: every interactive element is a native `<button>`/`<select>`/`<input>` or carries `tabindex="0"` + `role="button"` + an `Enter`/`Space` keydown handler, all colors come from VS Code's own theme CSS variables (so it already adapts to the user's chosen theme and contrast settings), and `:focus-visible` outlines were already defined in Phase 1. A new webview test (`test/webview.test.cjs`) locks in the `role="group"` fix and the node/edge `role="button"`/`tabindex="0"` pattern as a regression guard.

Workspace Trust and virtual-workspace support (`package.json` already declares both `untrustedWorkspaces` and `virtualWorkspaces` as supported) were confirmed accurate rather than just assumed: every file read/write in the extraction and view-persistence code paths goes through `vscode.workspace.fs.*` (virtual-filesystem-safe), and the extension never executes workspace code, shells out, or evaluates workspace content — it only parses it as data with `@lezer/python` and `yaml`, which is exactly what Restricted Mode requires.

## Export

Added **Mermaid, SVG, and PNG export**, driven from a new toolbar control, exporting whatever the current view shows (not a fixed full-graph dump):

- **Mermaid**: a `flowchart TD` built directly from the already-projected `view.nodes`/`view.edges` (the same data the canvas renders), with sanitized node IDs.
- **SVG**: the live canvas SVG is cloned, and every element's *computed* style (resolved VS Code theme colors, since the export must stand alone without `style.css` or CSS custom properties) is baked into literal `fill`/`stroke`/`stroke-width`/`opacity` attributes before serializing — otherwise the exported file would reference undefined `var(--vscode-...)` colors and render as unstyled black-on-white.
- **PNG**: the same standalone SVG is rasterized in the webview itself (a real browser context) via `Image` → `<canvas>` → `toDataURL('image/png')`, base64-encoded, and handed to the extension host to write — no server-side rendering library, no new native dependency. Required one minimal CSP change: `img-src` now also allows `data:`, needed to load the SVG-as-image source; nothing else about the CSP changed, and no remote/network access was introduced.
- The extension host writes whichever format to disk via `vscode.window.showSaveDialog` + `vscode.workspace.fs.writeFile`, with a dedicated, larger message-size cap (`MAX_EXPORT_MESSAGE_BYTES`, 20 MB) separate from the existing `saveView` and generic message caps, following the same validate-before-trust pattern already used for those.

**Secret-safe labels**, the plan's explicit requirement, required no new logic: `compose.ts`'s `SECRET_KEY` regex already excludes any environment variable matching `PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY|CREDENTIAL` from ever becoming a node, edge, or label (a Phase 2 decision) — so nothing secret is ever on screen to begin with, and every export format is built from what's on screen. This was verified, not just assumed: Mermaid and SVG export are covered by a deterministic jsdom test; PNG — the one capability jsdom cannot fake (no `Image`/`canvas` decoding) — was verified with the same headless-Chrome harness used for Phase 5's visual testing, confirming a 123 KB real PNG was produced and, when decoded and viewed, showed the correct hierarchical diagram.

## Example workspace

Added `examples/sample-workspace/`: a deliberately tiny, self-contained Django-shaped project (one `docker-compose.yml`, one `models.py`, one route pair, one Celery task) that exercises all three views without needing HBEC. Building it surfaced one worth-noting non-bug: the generic (non-HBEC) half of `test/extension.test.ts` assumes any `ARCHI_TEST_WORKSPACE` folder has a `package.json` (true for HBEC and for Archi's own repo, the only two workspaces this suite had ever been pointed at) — a smoke-test fixture gap, not an extension bug, fixed by giving the example workspace a `package.json` like any real project would have anyway, rather than weakening the test's assumption.

## Packaging, licensing, and Marketplace — open decision, not resolved here

The plan's fourth Phase 6 item is a decision, not code: whether to add a LICENSE, and whether Archi stays a private, workspace-local tool or moves toward Marketplace publication. `package.json` already says `"publisher": "archi-local"` and `"private": true`, consistent with staying private so far, and nothing in this session's work changed that signal. `vsce` has been warning about the missing LICENSE file since Phase 4; left unresolved pending the user's actual intent, since license choice is theirs to make, not a default to assume.

## Verification

`npm run build`, `npm run lint`, `npm test` (29/29), `ARCHI_TEST_WORKSPACE=/home/shadowe/Projects/HBEC npm run test:extension`, `ARCHI_TEST_WORKSPACE=examples/sample-workspace npm run test:extension`, and `npm run benchmark` all pass. `npm run package` still produces a correctly dependency-pruned VSIX.

## Follow-ups / Deferred

- The LICENSE/Marketplace decision above.
- JS/TS frontend-call tracing (already deferred from Phase 5, still the main remaining feature gap).
- Applying the Phase "v0.2" dagre layout to the Data view (already deferred from that work).
- The MVP release gate's manual VS Code desktop click-through is still the user's to confirm — nothing in Phase 6 substitutes for it, though the headless-Chrome visual testing used throughout this phase covers what can be checked without a real GUI session.
