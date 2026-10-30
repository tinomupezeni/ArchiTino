# Architecture

This document explains how Archi is put together and why, for anyone reading the code for the first time. For *what* Archi does and its product rules, see [`PLAN.md`](../PLAN.md). For the phased build history and what was validated at each step, see [`IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md) and the `PHASE*_REVIEW.md` files.

## The shape of a request

```
"Archi: Analyze Workspace"
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│ extension.ts (command handler, runs in the extension host)  │
│                                                               │
│  analyzeComposeWorkspaces()  →  system graph (services, DBs) │
│           │                                                  │
│           ▼                                                  │
│  analyzeModelWorkspaces(systemGraph) → data graph (tables)   │
│           │                                                  │
│           ▼                                                  │
│  analyzeComponentWorkspaces(systemGraph) → component graph   │
│                                             (routes, tasks)  │
└─────────────────────────────────────────────────────────────┘
        │  postMessage({ type: 'graph', graph, dataGraph,
        │                componentGraph, viewState, ... })
        ▼
┌─────────────────────────────────────────────────────────────┐
│ main.js (the webview — a plain browser context, no React,   │
│          no bundler)                                         │
│                                                               │
│  project()  → scope/filter the active graph for the current │
│               view mode (System / Data / Flows) and          │
│               selection (owner, app, search, relation)       │
│  layout()   → position the projected nodes (dagre for the    │
│               top-level System view; a simple grid           │
│               elsewhere — see "Layout" below)                │
│  render()   → draw SVG, wire up click/drag/keyboard handlers │
└─────────────────────────────────────────────────────────────┘
        │  postMessage({ type: 'openSource' | 'saveView' | 'export', ... })
        ▼
   back to extension.ts (open a file at a line, persist view
   preferences, write an exported file)
```

Three analyses run every time ("Analyze Workspace" always re-derives facts from source — nothing is cached incrementally between files), and they run in a fixed order because later ones depend on earlier ones: the data map needs to know which service owns which file path (from the system graph's Compose `build.context` → `paths`), and so does the component map.

## The evidence graph (`src/graph.ts`)

Every extractor — no matter the language or framework — produces the same shape:

```ts
interface EvidenceGraph {
  version: 1;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
```

A `GraphNode` has a `kind` (`service`, `database`, `table`, `route`, `task`, …), a `label`, and an `evidence: SourceEvidence[]` array — each entry a `{ uri, line, extractor }` pointing at the exact file and line that justifies the node existing. A `GraphEdge` additionally carries a `confidence`: `'declared'` (a direct, unambiguous source statement — a Compose `depends_on`, a Django `ForeignKey`), `'inferred'` (resolved indirectly but still evidence-backed), or `'unresolved'` (the extractor found a reference it could not resolve — reported as a diagnostic, never silently dropped and never upgraded to a fabricated edge).

`validateGraph()` enforces this contract structurally: every edge's endpoints must exist as real nodes, every `declared`/`inferred` edge must have non-empty evidence, and node/edge IDs must be unique (`stableId(...)`, a SHA-256 hash of its identifying parts, so the same real-world entity always gets the same ID across re-analyses — this is what lets saved view preferences like hidden/renamed/pinned nodes survive a re-analysis).

This single shared contract is why three very different extractors (Compose YAML, Django/SQLAlchemy Python, Django URL/Celery Python) can all feed the same webview with no per-extractor rendering code.

## Extractors: pure parser + workspace wrapper

Every extractor is split into two files with one job each:

| Pure parser (no `vscode` import) | Workspace wrapper (calls `vscode.workspace.*`) |
| --- | --- |
| `compose.ts` — parses one Compose YAML string | `composeWorkspace.ts` — finds the right Compose file(s), reads them, merges production/development build contexts |
| `pythonModels.ts` — parses Django/SQLAlchemy model source | `modelWorkspace.ts` — finds `models.py`/`models/**`, reads them, resolves `AUTH_USER_MODEL` |
| `pythonRoutes.ts` — parses one `urls.py`'s `urlpatterns` | `componentWorkspace.ts` — finds the root `urls.py`, follows `include()` across files, reads `tasks.py`/`views.py` |
| `pythonTasks.ts` — parses Celery task defs/call sites | (same `componentWorkspace.ts`) |

The pure half takes a string (or a few strings) and returns a result — testable with plain `node --test`, no VS Code, no file system. The workspace half does the I/O: `vscode.workspace.findFiles`/`vscode.workspace.fs.readFile`, always through the VS Code API (never Node's own `fs`) so the same code works for local, remote, and virtual filesystems. This split was deliberate from Phase 3 onward specifically so a parser bug can be reproduced and fixed with a three-line unit test instead of a full VS Code integration test.

A failed file (a syntax error, a size limit, an unresolved reference) becomes a diagnostic string pushed onto a shared `diagnostics: string[]` array; it never throws and never stops the rest of the workspace from being analyzed. Check `analyzePythonModels`'s per-file `try`/`catch` or `componentWorkspace.ts`'s `resolveRoutes`/`resolveTasks` for the pattern.

## The webview: `project()` → `layout()` → `render()`

`media/main.js` has no framework and no virtual DOM — it's about 500 lines of direct SVG manipulation, deliberately, because the project avoids adding a bundler step (see `CONTRIBUTING.md`'s "keep the webview dependency-light" rule). Three functions do all the work, called fresh on every state change:

- **`project(graph)`** scopes the full graph down to what the current view mode and filters should show: the System view's default mode aggregates services into their declared area groups (`node.group`); Data and Flows scope by `owner` (and `app`). This is also where hidden nodes are filtered out and renamed labels (`displayLabel()`) are applied.
- **`layout(nodes, edges)`** assigns `{x, y}` to each projected node. The top-level (unfocused) System view uses `dagreLayout()` — a real hierarchical graph layout (`@dagrejs/dagre`, vendored as a plain `<script>`, used purely for position math; it never draws anything) that ranks nodes by edge direction, so a service's dependencies visually sit below it instead of in an arbitrary grid position. Every other view (the focused System drill-down, Data, Flows) uses a simple sorted grid — deliberately, not out of laziness: those views' nodes are mostly siblings with few or no edges between them, so a layered layout would just stack everything into one wide row. See `PHASE6_REVIEW.md` and the "dagre hierarchical layout" report in the dev-log linked from it for the reasoning and the before/after comparison.
- **`render(view, positions)`** builds the actual SVG: boxes, curved edges with evidence-backed click targets, and the details panel. Every interactive element is either a native `<button>`/`<select>`/`<input>` or carries `role="button"` + `tabindex="0"` + an `Enter`/`Space` keydown handler — this matters; a previous `role="img"` on the canvas root was a real accessibility bug (see the Frontend_and_UI dev-log entry) because that role tells assistive tech to treat the whole subtree as a flattened, non-interactive picture.

Cross-view navigation (**Explore data** / **Explore flows** / **Open in system map** / **Back**) is a client-side breadcrumb stack — `navigateToOwnerView()`/`navigateToSystem()`/`goBack()` — that saves and restores the relevant view-mode state (focus, owner, app, filters) without the extension host being involved at all.

## View preferences vs. facts

`.archi/views/default.json` in the analyzed workspace stores *only* presentation choices — hidden node IDs, renamed labels, pinned (dragged) positions, and the active filters/view mode (`src/viewState.ts`'s `ViewState` type, sanitized on both read and write). It never stores a node or an edge. Re-running "Analyze Workspace" always regenerates the graph from source and then re-applies whatever is in this file — so a source change updates facts without discarding how you'd arranged the diagram. `src/viewStateStore.ts` is the thin, `vscode.workspace.fs`-based I/O layer; `src/viewState.ts` is the pure sanitizer, tested the same way the parsers are.

## Security/trust posture

- **No code execution.** Every extractor parses source as data (`@lezer/python`, the `yaml` package). Nothing is `import`ed, `eval`'d, or run as a subprocess.
- **No network access, no telemetry.** The CSP in `extension.ts`'s webview HTML has no `connect-src`; the only exceptions are loading the extension's own bundled scripts/styles (`script-src`/`style-src` scoped to the webview's own origin via a per-load `nonce`) and `img-src ... data:`, needed only so the webview can rasterize its own SVG to PNG client-side for export — never a remote image.
- **Workspace-scoped file access.** `src/scanner.ts`'s `isWithinWorkspace()` is checked before any "open source" navigation, so a crafted webview message can't be used to open a file outside the opened workspace folders.
- **Workspace Trust / virtual workspaces.** `package.json` declares both as supported, and it's true by construction: every file read/write goes through `vscode.workspace.fs.*`, which already handles remote/virtual filesystems and respects Workspace Trust restrictions; there's no direct Node `fs` usage anywhere in the extraction or view-persistence code paths.

## Where to look for a specific thing

| If you want to... | Look at |
| --- | --- |
| Add a new node/edge kind | `src/graph.ts` (`NodeKind`, `validateGraph`), then `media/main.js`'s `render()`/`inspectNode()` for how it displays |
| Add support for a new framework/language | [`ADDING_AN_EXTRACTOR.md`](ADDING_AN_EXTRACTOR.md) |
| Change how services are grouped | `src/compose.ts`'s `groupOf`/`logicalServiceName`, or the `archi.serviceAliases`/`archi.serviceGroups` settings |
| Change the System map's layout | `media/main.js`'s `dagreLayout()`/`layout()` |
| Add an export format | `media/main.js`'s `buildExportSvg`/`buildMermaid`/`svgToPngBase64`, and the `export` message handler in `extension.ts` |
| Understand what's already been tried and rejected | The relevant `PHASE*_REVIEW.md` — each one records alternatives considered, not just what shipped |
