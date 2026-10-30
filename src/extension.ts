import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { EvidenceGraph, validateGraph } from './graph';
import { makeFixture } from './fixture';
import { scanWorkspace } from './scanner';
import { openEvidenceSource } from './navigation';
import { analyzeComposeWorkspaces, selectComposeFile } from './composeWorkspace';
import { analyzeModelWorkspaces } from './modelWorkspace';
import { analyzeComponentWorkspaces } from './componentWorkspace';
import { ViewState } from './viewState';
import { loadViewState, saveViewState } from './viewStateStore';

const MAX_MESSAGE_BYTES = 1024;
const MAX_VIEW_MESSAGE_BYTES = 262144;
const MAX_EXPORT_MESSAGE_BYTES = 20_000_000;
const EXPORT_EXTENSIONS: Record<string, { ext: string; filterName: string }> = {
  svg: { ext: 'svg', filterName: 'SVG image' },
  png: { ext: 'png', filterName: 'PNG image' },
  mermaid: { ext: 'mmd', filterName: 'Mermaid diagram' },
};

function coverage(diagnostics: string[], ...graphs: (EvidenceGraph | undefined)[]): { unresolved: number; skipped: number; nodes: number; edges: number } {
  const unresolved = diagnostics.filter(item => /unresolved/i.test(item)).length;
  const skipped = diagnostics.filter(item => /(skipped|limit reached|exceeds|read failed)/i.test(item)).length;
  const nodes = graphs.reduce((total, item) => total + (item?.nodes.length ?? 0), 0);
  const edges = graphs.reduce((total, item) => total + (item?.edges.length ?? 0), 0);
  return { unresolved, skipped, nodes, edges };
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand('archi.analyzeWorkspace', async () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      void vscode.window.showInformationMessage('Archi needs an open workspace folder.');
      return;
    }
    const configured = vscode.workspace.getConfiguration('archi').get<number>('maxFiles', 10000);
    const maxFiles = Math.min(100000, Math.max(1, Math.floor(configured)));
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Archi: analyzing workspace', cancellable: true }, async (progress, token) => {
        const compose = await analyzeComposeWorkspaces(context, token, name => progress.report({ message: `Parsing Compose in ${name}` }));
        if (token.isCancellationRequested) return;
        let graph = compose.graph;
        let subtitle = `${compose.files} Compose file${compose.files === 1 ? '' : 's'} · ${graph.nodes.length} nodes · ${graph.edges.length} links`;
        if (!compose.files) {
          const result = await scanWorkspace(maxFiles, token, (name, current, total) => {
            progress.report({ message: `${name} (${current}/${total})` });
          });
          if (token.isCancellationRequested) return;
          graph = makeFixture(result.files, folders);
          subtitle = `No Compose file · fixture of ${result.files.length} files` + (result.truncated ? ' · scan limit reached' : '');
        }
        const models = await analyzeModelWorkspaces(graph, token, name => progress.report({ message: `Reading models: ${name}` }));
        if (token.isCancellationRequested) return;
        const components = await analyzeComponentWorkspaces(graph, token, name => progress.report({ message: `Tracing routes and tasks: ${name}` }));
        if (token.isCancellationRequested) return;
        await context.workspaceState.update('archi.lastGraph', graph);
        await context.workspaceState.update('archi.lastDataGraph', models.graph);
        await context.workspaceState.update('archi.lastComponentGraph', components.graph);
        const viewState = await loadViewState(folders[0]);
        const diagnostics = [...compose.diagnostics, ...models.diagnostics, ...components.diagnostics];
        showGraph(context, graph, subtitle + ` · ${models.graph.nodes.length} tables · ${components.graph.nodes.length} routes/tasks`, diagnostics, models.graph, components.graph, viewState);
      });
    } catch (error) {
      if (error instanceof vscode.CancellationError) return;
      void vscode.window.showErrorMessage(`Archi scan failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('archi.showFixture', () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const graph = makeFixture([], folders);
    showGraph(context, graph, 'Phase 1 fixture');
  }));

  context.subscriptions.push(vscode.commands.registerCommand('archi.openLastDiagram', async () => {
    const graph = context.workspaceState.get<EvidenceGraph>('archi.lastGraph');
    if (!graph) {
      void vscode.window.showInformationMessage('Archi has no cached diagram. Run Analyze Workspace first.');
      return;
    }
    const dataGraph = context.workspaceState.get<EvidenceGraph>('archi.lastDataGraph');
    const componentGraph = context.workspaceState.get<EvidenceGraph>('archi.lastComponentGraph');
    const viewState = await loadViewState((vscode.workspace.workspaceFolders ?? [])[0]);
    showGraph(context, graph, 'Last analyzed diagram', [], dataGraph, componentGraph, viewState);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('archi.selectComposeFile', () => selectComposeFile(context)));
}

function showGraph(context: vscode.ExtensionContext, graph: EvidenceGraph, subtitle: string, diagnostics: string[] = [], dataGraph?: EvidenceGraph, componentGraph?: EvidenceGraph, viewState?: ViewState): void {
  const problems = [...validateGraph(graph), ...(dataGraph ? validateGraph(dataGraph) : []), ...(componentGraph ? validateGraph(componentGraph) : [])];
  if (problems.length) {
    void vscode.window.showErrorMessage(`Archi graph invalid: ${problems[0]}`);
    return;
  }
  const panel = vscode.window.createWebviewPanel('archi.diagram', 'Archi Diagram', vscode.ViewColumn.Active, {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
  });
  const nonce = randomBytes(16).toString('hex');
  const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'main.js'));
  const style = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'style.css'));
  const dagreScript = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'vendor', 'dagre.min.js'));
  panel.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource} data:; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${style}"></head><body><header><h1>Archi</h1><p id="subtitle"></p><p id="coverage" hidden></p></header><ul id="diagnostics" hidden></ul><div class="toolbar"><button id="back" hidden>&larr; Back</button><nav id="breadcrumbs" aria-label="Navigation trail"></nav><label for="view-mode">View</label><select id="view-mode"><option value="system">System</option><option value="data">Data</option><option value="components">Flows</option></select><select id="owner" aria-label="Data service" hidden></select><select id="app" aria-label="Data app" hidden></select><select id="data-mode" aria-label="Data detail" hidden><option value="domain">Domain models</option><option value="physical">Physical tables</option></select><button id="overview" hidden>Overview</button><input id="search" type="search" placeholder="Search components" aria-label="Search components"><label for="relation">Links</label><select id="relation"><option value="all">Main links</option><option value="http">HTTP</option><option value="database">Database</option><option value="database_host">Database host</option><option value="redis">Redis</option><option value="depends_on">Startup dependencies</option></select><label for="zoom">Zoom</label><input id="zoom" type="range" min="50" max="180" value="100"><button id="unhide" hidden></button><label for="export-format">Export</label><select id="export-format" aria-label="Export format"><option value="svg">SVG</option><option value="png">PNG</option><option value="mermaid">Mermaid</option></select><button id="export">Save</button></div><p id="budget-warning" hidden role="status" aria-live="polite"></p><main><div id="canvas" aria-label="Architecture map"></div><aside id="details" aria-live="polite">Select a node or connection.</aside></main><script nonce="${nonce}" src="${dagreScript}"></script><script nonce="${nonce}" src="${script}"></script></body></html>`;
  const byId = new Map([...graph.nodes, ...graph.edges, ...(dataGraph?.nodes ?? []), ...(dataGraph?.edges ?? []), ...(componentGraph?.nodes ?? []), ...(componentGraph?.edges ?? [])].map(item => [item.id, item]));
  const folder = (vscode.workspace.workspaceFolders ?? [])[0];
  panel.webview.onDidReceiveMessage(async (message: unknown) => {
    if (!message || typeof message !== 'object') return;
    const candidate = message as Record<string, unknown>;
    if (candidate.type === 'saveView') {
      if (JSON.stringify(message).length > MAX_VIEW_MESSAGE_BYTES) return;
      await saveViewState(folder, candidate.viewState);
      return;
    }
    if (candidate.type === 'export') {
      if (JSON.stringify(message).length > MAX_EXPORT_MESSAGE_BYTES) return;
      const format = typeof candidate.format === 'string' ? candidate.format : '';
      const config = EXPORT_EXTENSIONS[format];
      const content = candidate.content;
      if (!config || typeof content !== 'string') return;
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`archi-diagram.${config.ext}`),
        filters: { [config.filterName]: [config.ext] },
      });
      if (!target) return;
      const bytes = candidate.encoding === 'base64' ? Buffer.from(content, 'base64') : new TextEncoder().encode(content);
      try {
        await vscode.workspace.fs.writeFile(target, bytes);
        void vscode.window.showInformationMessage(`Archi exported ${vscode.workspace.asRelativePath(target)}.`);
      } catch (error) {
        void vscode.window.showErrorMessage(`Archi export failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    if (JSON.stringify(message).length > MAX_MESSAGE_BYTES) return;
    if (candidate.type === 'ready') {
      void panel.webview.postMessage({ type: 'graph', graph, dataGraph, componentGraph, subtitle, diagnostics, viewState, coverage: coverage(diagnostics, graph, dataGraph, componentGraph) });
      return;
    }
    if (candidate.type !== 'openSource' || typeof candidate.id !== 'string' || !/^[a-f0-9]{20}$/.test(candidate.id)) return;
    const item = byId.get(candidate.id);
    const index = candidate.evidenceIndex;
    if (index !== undefined && (!Number.isInteger(index) || (index as number) < 0 || (index as number) > 1000)) return;
    const evidence = item?.evidence[(index as number | undefined) ?? 0];
    if (!evidence) return;
    if (!(await openEvidenceSource(evidence))) {
      void vscode.window.showWarningMessage('Archi could not open this source location.');
    }
  }, undefined, context.subscriptions);
}

export function deactivate(): void {}
