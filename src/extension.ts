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
import { resolveAvailableAgent } from './agentBridge';
import { synthesizeArchitectureFromPrd } from './prdArchitecture';
import { evaluateArchitectureRules, addGraphNode, removeGraphNode, addGraphEdge, removeGraphEdge } from './graphSandbox';
import { requestDeepAgentCritique } from './deepCritique';
import { generateDockerComposeFromGraph, generateAdrFromGraph } from './scaffoldGenerator';
import { compareSpecVsCodeArchitecture } from './driftEngine';

const MAX_MESSAGE_BYTES = 1024;
const MAX_VIEW_MESSAGE_BYTES = 262144;
const MAX_EXPORT_MESSAGE_BYTES = 20_000_000;
const EXPORT_EXTENSIONS: Record<string, { ext: string; filterName: string }> = {
  svg: { ext: 'svg', filterName: 'SVG image' },
  png: { ext: 'png', filterName: 'PNG image' },
  mermaid: { ext: 'mmd', filterName: 'Mermaid diagram' },
  compose: { ext: 'yml', filterName: 'Docker Compose' },
  adr: { ext: 'md', filterName: 'ADR Markdown' },
};

function coverage(diagnostics: string[], ...graphs: (EvidenceGraph | undefined)[]): { unresolved: number; skipped: number; nodes: number; edges: number } {
  const unresolved = diagnostics.filter(item => /unresolved/i.test(item)).length;
  const skipped = diagnostics.filter(item => /(skipped|limit reached|exceeds|read failed)/i.test(item)).length;
  const nodes = graphs.reduce((total, item) => total + (item?.nodes.length ?? 0), 0);
  const edges = graphs.reduce((total, item) => total + (item?.edges.length ?? 0), 0);
  return { unresolved, skipped, nodes, edges };
}

export function activate(context: vscode.ExtensionContext): void {
  const quickStartView: vscode.TreeDataProvider<vscode.TreeItem> = {
    getTreeItem: element => element,
    getChildren: () => [],
  };
  context.subscriptions.push(vscode.window.registerTreeDataProvider('archi.quickstart', quickStartView));

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
        await context.workspaceState.update('archi.lastCodeGraph', graph);
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

  context.subscriptions.push(vscode.commands.registerCommand('archi.designFromPrd', async (fileUri?: vscode.Uri) => {
    let targetUri = fileUri;
    if (!targetUri) {
      const picks = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: 'Select PRD Document',
        filters: {
          'Markdown & Text': ['md', 'txt', 'markdown', 'json'],
        },
      });
      if (!picks || picks.length === 0) return;
      targetUri = picks[0];
    }

    try {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Archi: Designing architecture from PRD...',
        cancellable: false,
      }, async progress => {
        progress.report({ message: 'Finding available coding agent...' });
        const agent = await resolveAvailableAgent();

        progress.report({ message: `Analyzing PRD with ${agent.name}...` });
        const contentBytes = await vscode.workspace.fs.readFile(targetUri!);
        const contentStr = new TextDecoder().decode(contentBytes);
        const filename = vscode.workspace.asRelativePath(targetUri!);

        const { result, graph } = await synthesizeArchitectureFromPrd(contentStr, filename, targetUri!.toString(), agent);

        await context.workspaceState.update('archi.lastCodeGraph', graph);
        await context.workspaceState.update('archi.lastGraph', graph);
        await context.workspaceState.update('archi.lastDataGraph', undefined);
        await context.workspaceState.update('archi.lastComponentGraph', undefined);

        const diagnostics: string[] = [];
        if (result.strengths.length) {
          diagnostics.push(`[Strength] ${result.strengths.join('; ')}`);
        }
        if (result.weaknesses.length) {
          diagnostics.push(`[Weakness] ${result.weaknesses.join('; ')}`);
        }
        if (result.securityRisks.length) {
          diagnostics.push(`[Security Risk] ${result.securityRisks.join('; ')}`);
        }

        const subtitle = `${result.title} · ${graph.nodes.length} nodes · ${graph.edges.length} links (Agent: ${agent.name})`;
        showGraph(context, graph, subtitle, diagnostics);
      });
    } catch (error) {
      void vscode.window.showErrorMessage(`Archi PRD design failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }));
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
  let currentGraph = graph;
  let critiqueReport = evaluateArchitectureRules(currentGraph);
  panel.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource} data:; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${style}"></head><body><header><h1>Archi</h1><p id="subtitle"></p><p id="coverage" hidden></p></header><ul id="diagnostics" hidden></ul><div class="toolbar"><button id="back" hidden>&larr; Back</button><nav id="breadcrumbs" aria-label="Navigation trail"></nav><label for="view-mode">View</label><select id="view-mode"><option value="system">System</option><option value="data">Data</option><option value="components">Flows</option></select><select id="owner" aria-label="Data service" hidden></select><select id="app" aria-label="Data app" hidden></select><select id="data-mode" aria-label="Data detail" hidden><option value="domain">Domain models</option><option value="physical">Physical tables</option></select><button id="overview" hidden>Overview</button><input id="search" type="search" placeholder="Search components" aria-label="Search components"><label for="relation">Links</label><select id="relation"><option value="all">Main links</option><option value="http">HTTP</option><option value="database">Database</option><option value="database_host">Database host</option><option value="redis">Redis</option><option value="depends_on">Startup dependencies</option></select><label for="zoom">Zoom</label><input id="zoom" type="range" min="50" max="180" value="100"><button id="unhide" hidden></button><label for="export-format">Export</label><select id="export-format" aria-label="Export format"><option value="svg">SVG</option><option value="png">PNG</option><option value="mermaid">Mermaid</option><option value="compose">Docker Compose</option><option value="adr">ADR Markdown</option></select><button id="export">Save</button><button id="add-component">+ Component</button><button id="connect-nodes">&harr; Connect</button><button id="deep-critique">&#x1F916; Deep AI Critique</button><button id="check-drift">&#x1F504; Spec Drift</button><button id="toggle-fullscreen" class="secondary" title="Expand Diagram Fullscreen">&#x26F6; Full View</button></div><div id="critique-banner" role="region" aria-label="Architecture critique"></div><p id="budget-warning" hidden role="status" aria-live="polite"></p><main><div id="canvas" aria-label="Architecture map"></div><aside id="details" aria-live="polite">Select a node or connection.</aside></main><script nonce="${nonce}" src="${dagreScript}"></script><script nonce="${nonce}" src="${script}"></script></body></html>`;
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
      let content = candidate.content;
      if (!config) return;

      if (format === 'compose') {
        const scaffold = generateDockerComposeFromGraph(currentGraph);
        content = scaffold.yaml;
      } else if (format === 'adr') {
        const adr = generateAdrFromGraph(currentGraph);
        content = adr.markdown;
      }

      if (typeof content !== 'string') return;
      const defaultFilename = format === 'compose' ? 'docker-compose.archi.yml' : format === 'adr' ? 'ADR-architecture-decision.md' : `archi-diagram.${config.ext}`;
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(defaultFilename),
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
      void panel.webview.postMessage({ type: 'graph', graph: currentGraph, dataGraph, componentGraph, subtitle, diagnostics, viewState, coverage: coverage(diagnostics, currentGraph, dataGraph, componentGraph), critique: critiqueReport });
      return;
    }
    if (candidate.type === 'mutateAddNode') {
      const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
      const kind = typeof candidate.kind === 'string' ? candidate.kind : 'service';
      if (!label) return;
      const mutated = addGraphNode(currentGraph, label, kind as any);
      currentGraph = mutated.graph;
      critiqueReport = evaluateArchitectureRules(currentGraph);
      byId.set(mutated.node.id, mutated.node);
      void panel.webview.postMessage({ type: 'graph', graph: currentGraph, dataGraph, componentGraph, subtitle, diagnostics, viewState, coverage: coverage(diagnostics, currentGraph, dataGraph, componentGraph), critique: critiqueReport });
      return;
    }
    if (candidate.type === 'mutateDeleteNode') {
      const nodeId = typeof candidate.nodeId === 'string' ? candidate.nodeId : '';
      if (!nodeId) return;
      currentGraph = removeGraphNode(currentGraph, nodeId);
      critiqueReport = evaluateArchitectureRules(currentGraph);
      byId.delete(nodeId);
      void panel.webview.postMessage({ type: 'graph', graph: currentGraph, dataGraph, componentGraph, subtitle, diagnostics, viewState, coverage: coverage(diagnostics, currentGraph, dataGraph, componentGraph), critique: critiqueReport });
      return;
    }
    if (candidate.type === 'mutateAddEdge') {
      const fromId = typeof candidate.fromId === 'string' ? candidate.fromId : '';
      const toId = typeof candidate.toId === 'string' ? candidate.toId : '';
      const kind = typeof candidate.kind === 'string' ? candidate.kind : 'calls';
      const label = typeof candidate.label === 'string' ? candidate.label : undefined;
      if (!fromId || !toId || fromId === toId) return;
      const mutated = addGraphEdge(currentGraph, fromId, toId, kind, label);
      currentGraph = mutated.graph;
      critiqueReport = evaluateArchitectureRules(currentGraph);
      byId.set(mutated.edge.id, mutated.edge);
      void panel.webview.postMessage({ type: 'graph', graph: currentGraph, dataGraph, componentGraph, subtitle, diagnostics, viewState, coverage: coverage(diagnostics, currentGraph, dataGraph, componentGraph), critique: critiqueReport });
      return;
    }
    if (candidate.type === 'mutateDeleteEdge') {
      const edgeId = typeof candidate.edgeId === 'string' ? candidate.edgeId : '';
      if (!edgeId) return;
      currentGraph = removeGraphEdge(currentGraph, edgeId);
      critiqueReport = evaluateArchitectureRules(currentGraph);
      byId.delete(edgeId);
      void panel.webview.postMessage({ type: 'graph', graph: currentGraph, dataGraph, componentGraph, subtitle, diagnostics, viewState, coverage: coverage(diagnostics, currentGraph, dataGraph, componentGraph), critique: critiqueReport });
      return;
    }
    if (candidate.type === 'checkDrift') {
      const codeGraph = context.workspaceState.get<EvidenceGraph>('archi.lastCodeGraph') || context.workspaceState.get<EvidenceGraph>('archi.lastGraph');
      if (!codeGraph) {
        void vscode.window.showInformationMessage('No extracted codebase graph found. Please run "Archi: Analyze Workspace" first.');
        return;
      }
      const report = compareSpecVsCodeArchitecture(currentGraph, codeGraph);
      void panel.webview.postMessage({ type: 'driftReport', report });
      return;
    }
    if (candidate.type === 'requestDeepCritique') {
      try {
        const agent = await resolveAvailableAgent();
        void vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Archi: Running deep architecture critique with ${agent.name}...`,
          cancellable: false,
        }, async () => {
          const report = await requestDeepAgentCritique(currentGraph, agent);
          void panel.webview.postMessage({ type: 'deepCritiqueReport', report, agentName: agent.name });
        });
      } catch (err) {
        void vscode.window.showErrorMessage(`Deep critique failed: ${err instanceof Error ? err.message : String(err)}`);
      }
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
