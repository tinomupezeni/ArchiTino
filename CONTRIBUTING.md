# Contributing to Archi

Thanks for considering a contribution. Participation here is covered by [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Archi statically analyzes a workspace to build source-backed architecture diagrams — every node and edge must trace back to a real line of code or configuration. That constraint shapes everything below; read it before your first PR, not after.

## Ground rules

1. **Never fabricate a fact.** A naming convention, a shared network, or a similarly-named identifier is not proof of a relationship. If an extractor cannot prove something statically, it reports a diagnostic (an "unresolved" note), not a guessed edge. See `validateGraph` in `src/graph.ts`: a `declared`/`inferred` edge must carry real source evidence; only `unresolved` may have none.
2. **No code execution.** Extractors parse source and configuration as data (`@lezer/python` for Python, the `yaml` package for Compose). They never import, run, or evaluate workspace code, connect to a database, or shell out.
3. **Local-first, no telemetry.** Nothing leaves the machine. Don't add network calls, analytics, or remote config without a clear opt-in and a very good reason — see the `PLAN.md` constraints.
4. **Keep the webview dependency-light.** `media/` has no bundler. A new library must either be usable as a plain `<script>` tag (see `media/vendor/dagre.min.js` and `scripts/copy-vendor.cjs` for the pattern: a devDependency vendored into `media/vendor/` at build time, never shipped in the VSIX's `node_modules`) or be a pure-logic npm package consumed only by the extension host (`src/`), which is a normal Node/CommonJS environment.

## Project layout

- `src/` — the extension host (TypeScript, runs in Node inside VS Code).
  - Parsers are split into **pure** modules (no `vscode` import, e.g. `compose.ts`, `pythonModels.ts`, `pythonRoutes.ts`, `pythonTasks.ts`) and **workspace** modules that call `vscode.workspace.fs`/`findFiles` and hand the pure parsers real file contents (e.g. `composeWorkspace.ts`, `modelWorkspace.ts`, `componentWorkspace.ts`). This split exists so the parsers can be unit-tested with plain `node --test`, no VS Code required. Keep new extractors in this shape.
  - `graph.ts` defines the one shared data model (`GraphNode`, `GraphEdge`, `EvidenceGraph`) every extractor produces and every webview view consumes.
  - `extension.ts` wires commands, the webview panel, and the message protocol between them.
- `media/` — the webview (vanilla JS/CSS, no framework, no bundler). `main.js` renders whichever graph(s) the extension host sends it and posts messages back (`openSource`, `saveView`, `export`).
- `test/` — `node --test` unit tests for pure parsers and the webview (via `jsdom`), plus `extension-host.ts`/`extension.test.ts`, which run inside a real VS Code instance via `@vscode/test-electron`.
- `examples/sample-workspace/` — a tiny, self-contained project for trying Archi or writing a test without needing a real codebase.
- See `docs/ARCHITECTURE.md` for how a request flows from "Analyze Workspace" to a rendered diagram, and `docs/ADDING_AN_EXTRACTOR.md` if you're adding support for a new language, framework, or relationship type.

## Setup

```sh
npm install
npm run build      # tsc + vendors media/vendor/dagre.min.js
npm run lint        # tsc --noEmit
npm test            # pure-parser + webview tests (fast, no VS Code needed)
npm run test:extension   # real VS Code extension-host integration test
```

`test:extension` launches a real VS Code instance (`/usr/share/code/code` by default; override with `ARCHI_VSCODE_PATH`) against this repo's own folder. Point it at a richer workspace with `ARCHI_TEST_WORKSPACE=/path/to/some/project npm run test:extension` — `examples/sample-workspace` is a good quick target; a real multi-service project exercises more of the extractors.

## Before opening a PR

- `npm run lint`, `npm test`, and `npm run test:extension` must pass.
- Add a test for new extraction logic grounded in **real syntax**, not a convenient simplification — if you're adding, say, FastAPI route support, find an actual FastAPI route declaration (your own project, a public repo, or the relevant framework's own docs) and write the test against that shape. Several bugs in this project were only caught because a test used ground-truth syntax instead of an idealized example (see the dev-log entries linked from each `PHASE*_REVIEW.md` for examples).
- If you add a node/edge kind, update `src/graph.ts`'s `NodeKind` union and `validateGraph`'s rules, and make sure `media/main.js` has a sensible rendering/inspection path for it — don't leave a kind that silently falls through to generic styling if it needs its own detail view.
- If your change affects what's extracted or how it's grouped, a quick before/after description (counts, or better, a screenshot) in the PR description helps review a lot more than it costs to produce.
- Keep PRs scoped to one extractor, one view, or one fix — this project's own development history (see `PHASE*_REVIEW.md` in the repo root) deliberately avoided bundling unrelated changes, and review is much faster when a PR does too.

## Reporting a bug or gap

Open an issue with:
- What you ran Archi against (a public repo if possible, or a minimal repro).
- What diagram/view you were looking at.
- What you expected vs. what you saw — for a missing relationship, include the actual source lines that should have produced it.

A relationship Archi *correctly* refuses to draw (because it can't be statically proven) isn't a bug — if you think it should be provable, explain why in the issue, since that's exactly the judgment call extractors have to make.

## Where things are headed

`IMPLEMENTATION_PLAN.md` tracks the phased roadmap and what's done; `PHASE*_REVIEW.md` files record what was validated, what was found, and what was deliberately deferred at each stage, including the reasoning. Read the most recent one before proposing a large change — there's a good chance the trade-off was already considered.
