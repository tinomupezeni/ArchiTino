# Archi

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Archi is a VS Code extension in development for source-backed architecture diagrams. [PLAN.md](PLAN.md) defines the product; [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) defines the phases; [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) explains how the code is put together.

Archi is open source (MIT) and open to contributions — see [CONTRIBUTING.md](CONTRIBUTING.md) to get started, and [`docs/ADDING_AN_EXTRACTOR.md`](docs/ADDING_AN_EXTRACTOR.md) if you want to add support for a new language or framework.

## Current status

Phase 6 adds diagram export, an accessibility pass, and a performance baseline, on top of Phase 5's **Flows** view, source-backed component and request-flow tracing, alongside the Phase 4 unified system/data navigation. The system map reads one Compose file per open workspace folder, resolves YAML anchors and merged environment blocks, groups blue/green variants and worker/beat processes, and draws HTTP, Redis, database, database-host, and startup-dependency links. Its default (unfocused) view lays services out with a real hierarchical graph layout ([`@dagrejs/dagre`](https://www.npmjs.com/package/@dagrejs/dagre), vendored into `media/vendor/` as a position-only engine — it never draws anything itself), ranking areas by dependency direction so dependents sit above what they depend on, instead of a fixed alphabetical grid; drilling into one area (**Explore area**) keeps the simpler per-row grid, since siblings inside one area are rarely connected to each other. Click an area to see its services, then click a connection to inspect its source locations.

The data map statically reads Django and SQLAlchemy model files. Choose **Data** above the diagram, then select a service and optionally an app. **Domain** mode shows models and direct relationships; **Physical** mode shows table names and join tables. Clicking a node shows its model, table, database when known, and selected columns. Clicking a relationship shows its type, source line, and any declared join table. An app-scoped view includes directly related models from other apps in the same service. Search and zoom work in both views.

A service node that owns model data offers **Explore data**, jumping straight to that service's data scope; a table or model with a matching Compose service offers **Open in system map** to jump back. A **Back** button and breadcrumb trail unwind either hop, so a system-to-table journey never requires manually matching a service name to an owner column. From the details panel you can **Hide** a node, rename it, or drag it to a pinned position; those choices, plus the active filters and view mode, are saved to `.archi/views/default.json` in the first workspace folder and restored on the next analysis. Facts are always regenerated from source; only presentation choices are read back from that file. A warning banner, not a silent drop, appears if the default system view exceeds 60 components, and a coverage line above the diagram reports node/edge totals plus unresolved-relationship and skipped-file counts.

Choose **Flows** above the diagram, then select a service and optionally an app (a single service can own well over a hundred routes, so this scoping matters), to see its declared Django routes (full path, resolved by composing the service's root `urls.py` with each `include()`d app module, including dotted sub-module includes like `apps.accounts.parent_urls`) and Celery tasks (`@shared_task`/`@app.task`, matched to their `.delay()`/`.apply_async()` call sites by symbol or by an explicit `name=`). A service with owned routes or tasks offers **Explore flows** from the system map; a route or task offers **Open in system map** back, with the same **Back**/breadcrumb support as the data map. See [PHASE5_REVIEW.md](PHASE5_REVIEW.md) for the HBEC validation and known gaps, including why frontend-to-backend HTTP call resolution (a JS/TS client calling a specific backend path) was scoped out of this phase.

The system map is based on Compose declarations. The data map recognizes Django model fields and common SQLAlchemy declarative patterns without executing project code. Route and task tracing is Django/Celery-only and static (no dynamic router-generated routes, no runtime task names). It does not yet trace JS/TS client calls, infer gateway routes from configuration outside Compose, or prove the schema of a running database.

## Run locally

```sh
npm install
npm run build
npm run lint
npm test
npm run test:extension
```

Open this folder in VS Code, press **F5** from the extension-host launch configuration or launch with `code --extensionDevelopmentPath=/path/to/Archi /path/to/workspace`, then run **Archi: Analyze Workspace** from the Command Palette. Archi selects a root `docker-compose.yml` or `compose.yml` by default. Use **Archi: Select Compose File** to choose another file, such as HBEC's `docker-compose.production.yml`, then analyze again. **Archi: Open Last Diagram** reopens the cached graph. **Archi: Show Fixture Diagram** opens a folder-only view.

Don't have a real project handy? Open [`examples/sample-workspace`](examples/sample-workspace) instead — it's small enough to read in full and exercises all three views (System, Data, Flows) plus the blue/green-style worker-merge behavior.

Use the **Export** control above the diagram to save the current view as SVG, PNG, or a Mermaid flowchart (`.mmd`). Export reflects only what's already on screen — the same labels the Compose secret-value filter (see below) already keeps out of the graph, so nothing export-only needs redacting.

The scanner reads only open workspace folders. When there is no Compose file, the system view shows the Phase 1 file fixture; the data view can still analyze model files. It excludes `.git`, dependency directories, virtual environments, build output, caches, migrations, and tests from model discovery. Model analysis reads up to 500 Python model files per workspace folder and skips files over 500 KB. `archi.maxFiles` limits the general file enumeration; Compose files have a 2 MB limit. Analysis can be canceled from the progress notification. Source links are restricted to open workspace folders.

You can correct grouping through VS Code settings: `archi.serviceAliases` maps a Compose service name to a logical name; `archi.serviceGroups` maps a logical name to an area label. For example, `"archi.serviceGroups": { "harness-embeddings": "AI Infrastructure" }`.

The extension does not execute workspace code, connect to databases, or send source to an external service.

## Data-map coverage

- Django: `models.py` and split `models/` packages, `ForeignKey`, `OneToOneField`, `ManyToManyField`, `Meta.db_table`, string and `self` targets, and static `AUTH_USER_MODEL` settings.
- SQLAlchemy: literal `__tablename__`, `Column` and `mapped_column` with explicit `ForeignKey`, association `Table(...)`, and `relationship(..., secondary=...)` where the target is statically resolvable.
- Service ownership comes from Compose build contexts. Database ownership is shown when a service has one explicit Compose database edge. A production Compose file can reuse build contexts from a root development Compose file.

Dynamic model and table names or relationships constructed at runtime may be omitted. References whose target definition is outside the workspace remain unlinked and produce diagnostics. Cross-service identifier fields are not treated as foreign keys without an ORM declaration. See [PHASE3_REVIEW.md](PHASE3_REVIEW.md) for the HBEC validation and known gaps.
