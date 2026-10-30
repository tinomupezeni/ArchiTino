import * as vscode from 'vscode';
import path from 'node:path';
import { EvidenceGraph, GraphEdge, GraphNode, stableId } from './graph';
import { appFromModulePath, joinRoutePath, modulePathToRelativeFile, parseUrlModule, UrlInclude } from './pythonRoutes';
import { parseCeleryFile } from './pythonTasks';
import { appFromPath } from './pythonModels';

const MAX_TASK_FILES = 500;
const MAX_FILE_BYTES = 500_000;
const MAX_INCLUDE_DEPTH = 4;
const ROOT_CANDIDATES = ['config/urls.py', 'urls.py'];
const EXCLUDE = '**/{.git,node_modules,dist,build,out,.venv,venv,__pycache__,migrations,tests,.vscode-test}/**';

export interface ComponentAnalysis {
  graph: EvidenceGraph;
  diagnostics: string[];
  files: number;
}

async function readIfExists(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type !== vscode.FileType.File || stat.size > MAX_FILE_BYTES) return undefined;
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

async function resolveRoutes(
  folder: vscode.WorkspaceFolder,
  serviceRoot: string,
  owner: string,
  serviceNodeId: string,
  diagnostics: string[],
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; files: number }> {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let rootUri: vscode.Uri | undefined;
  let rootRelative = '';
  for (const candidate of ROOT_CANDIDATES) {
    const uri = vscode.Uri.joinPath(folder.uri, serviceRoot, candidate);
    if ((await readIfExists(uri)) !== undefined) { rootUri = uri; rootRelative = path.posix.join(serviceRoot, candidate); break; }
  }
  if (!rootUri) return { nodes, edges, files: 0 };
  const visited = new Set<string>();

  async function walk(moduleUri: vscode.Uri, moduleRelative: string, prefixParts: string[], depth: number): Promise<void> {
    if (depth > MAX_INCLUDE_DEPTH || visited.has(moduleRelative)) return;
    visited.add(moduleRelative);
    const source = await readIfExists(moduleUri);
    if (source === undefined) {
      diagnostics.push(moduleRelative + ': URL module exceeds size limit or is unreadable');
      return;
    }
    const parsed = parseUrlModule(source, moduleRelative);
    diagnostics.push(...parsed.diagnostics);
    for (const leaf of parsed.leaves) {
      const fullPath = joinRoutePath(...prefixParts, leaf.prefix);
      const app = appFromModulePath(moduleRelative.replace(/\//g, '.').replace(/\.py$/, ''));
      const id = stableId('route', owner, fullPath, leaf.view ?? '', leaf.line.toString());
      nodes.push({
        id,
        kind: 'route',
        label: '/' + fullPath,
        owner,
        app,
        view: leaf.view,
        evidence: [{ uri: moduleUri.toString(), line: leaf.line, extractor: 'django-urls' }],
      });
      edges.push({
        id: stableId('serves', serviceNodeId, id),
        from: serviceNodeId,
        to: id,
        kind: 'serves',
        confidence: 'declared',
        label: leaf.name,
        evidence: [{ uri: moduleUri.toString(), line: leaf.line, extractor: 'django-urls' }],
      });
    }
    for (const include of parsed.includes) {
      await followInclude(include, moduleRelative, prefixParts, depth);
    }
  }

  async function followInclude(include: UrlInclude, fromRelative: string, prefixParts: string[], depth: number): Promise<void> {
    const relativeFile = modulePathToRelativeFile(include.modulePath);
    const candidateUri = vscode.Uri.joinPath(folder.uri, serviceRoot, relativeFile);
    const candidateRelative = path.posix.join(serviceRoot, relativeFile);
    if ((await readIfExists(candidateUri)) === undefined) {
      diagnostics.push(fromRelative + ': unresolved include target ' + include.modulePath);
      return;
    }
    await walk(candidateUri, candidateRelative, [...prefixParts, include.prefix], depth + 1);
  }

  await walk(rootUri, rootRelative, [], 0);
  return { nodes, edges, files: visited.size };
}

async function resolveTasks(
  folder: vscode.WorkspaceFolder,
  serviceRoot: string,
  owner: string,
  diagnostics: string[],
): Promise<{ nodes: GraphNode[]; files: number }> {
  const patterns = ['**/tasks.py', '**/views.py'];
  const found = new Map<string, vscode.Uri>();
  for (const pattern of patterns) {
    const matches = await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.joinPath(folder.uri, serviceRoot), pattern), EXCLUDE, MAX_TASK_FILES + 1);
    for (const uri of matches) found.set(uri.toString(), uri);
  }
  if (found.size > MAX_TASK_FILES) diagnostics.push(owner + ': task/view-file limit reached');
  const definitions: { symbol: string; explicitName?: string; uri: vscode.Uri; line: number; app: string }[] = [];
  const calls: { symbol: string; uri: vscode.Uri; line: number }[] = [];
  for (const uri of [...found.values()].slice(0, MAX_TASK_FILES)) {
    const relativePath = path.posix.relative(folder.uri.path, uri.path);
    const source = await readIfExists(uri);
    if (source === undefined) {
      diagnostics.push(relativePath + ': file exceeds size limit or is unreadable');
      continue;
    }
    const parsed = parseCeleryFile(source, relativePath);
    diagnostics.push(...parsed.diagnostics);
    const app = appFromPath(relativePath);
    for (const task of parsed.tasks) definitions.push({ symbol: task.symbol, explicitName: task.explicitName, uri, line: task.line, app });
    for (const call of parsed.calls) calls.push({ symbol: call.symbol, uri, line: call.line });
  }
  const nodes: GraphNode[] = [];
  for (const definition of definitions) {
    const taskName = definition.explicitName ?? definition.symbol;
    const id = stableId('task', owner, taskName);
    const evidence = [{ uri: definition.uri.toString(), line: definition.line, extractor: 'celery-task' }];
    for (const call of calls) {
      if (call.symbol === definition.symbol) evidence.push({ uri: call.uri.toString(), line: call.line, extractor: 'celery-trigger' });
    }
    nodes.push({ id, kind: 'task', label: taskName, owner, app: definition.app, symbol: definition.symbol, evidence });
  }
  const unmatched = calls.filter(call => !definitions.some(definition => definition.symbol === call.symbol));
  for (const call of unmatched) {
    diagnostics.push(path.posix.relative(folder.uri.path, call.uri.path) + ':' + call.line + ' unresolved task trigger for ' + call.symbol);
  }
  return { nodes, files: found.size };
}

export async function analyzeComponentWorkspaces(systemGraph: EvidenceGraph, token: vscode.CancellationToken, onProgress?: (message: string) => void): Promise<ComponentAnalysis> {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const diagnostics: string[] = [];
  let files = 0;
  const services = systemGraph.nodes.filter(node => node.kind === 'service' && node.paths?.length);
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (token.isCancellationRequested) throw new vscode.CancellationError();
    for (const service of services) {
      for (const relative of service.paths ?? []) {
        onProgress?.(service.label);
        const stub: GraphNode = { id: service.id, kind: 'service', label: service.label, group: service.group, evidence: [] };
        if (!nodes.some(item => item.id === stub.id)) nodes.push(stub);
        const routes = await resolveRoutes(folder, relative, service.label, service.id, diagnostics);
        nodes.push(...routes.nodes);
        edges.push(...routes.edges);
        files += routes.files;
        const tasks = await resolveTasks(folder, relative, service.label, diagnostics);
        nodes.push(...tasks.nodes);
        files += tasks.files;
      }
    }
  }
  return { graph: { version: 1, nodes, edges }, diagnostics, files };
}
