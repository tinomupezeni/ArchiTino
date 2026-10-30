import * as vscode from 'vscode';
import { analyzeCompose, ComposeOptions } from './compose';
import { EvidenceGraph } from './graph';
import { isWithinWorkspace } from './scanner';

const CANDIDATES = ['docker-compose.yml', 'compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.production.yml'];
const MAX_COMPOSE_BYTES = 2_000_000;

function key(folder: vscode.WorkspaceFolder): string { return `archi.compose.${folder.uri.toString()}`; }

async function exists(uri: vscode.Uri): Promise<boolean> {
  try { return (await vscode.workspace.fs.stat(uri)).type === vscode.FileType.File; }
  catch { return false; }
}

export async function selectComposeFile(context: vscode.ExtensionContext): Promise<void> {
  const choices: { label: string; description: string; uri: vscode.Uri; folder: vscode.WorkspaceFolder }[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const matches = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*compose*.{yml,yaml}'), '**/{node_modules,.git,dist,build}/**', 50);
    for (const uri of matches) choices.push({ label: vscode.workspace.asRelativePath(uri), description: folder.name, uri, folder });
  }
  if (!choices.length) {
    void vscode.window.showInformationMessage('Archi found no Compose files in the open workspace.');
    return;
  }
  const choice = await vscode.window.showQuickPick(choices, { title: 'Choose a Compose file for Archi', placeHolder: 'One file per workspace folder' });
  if (choice) {
    await context.workspaceState.update(key(choice.folder), choice.uri.toString());
    void vscode.window.showInformationMessage(`Archi will analyze ${choice.label}.`);
  }
}

async function chosenCompose(folder: vscode.WorkspaceFolder, context: vscode.ExtensionContext): Promise<vscode.Uri | undefined> {
  const saved = context.workspaceState.get<string>(key(folder));
  if (saved) {
    try {
      const uri = vscode.Uri.parse(saved, true);
      if (isWithinWorkspace(uri) && await exists(uri)) return uri;
    } catch { /* Use a default Compose file. */ }
  }
  for (const name of CANDIDATES) {
    const uri = vscode.Uri.joinPath(folder.uri, name);
    if (await exists(uri)) return uri;
  }
  return undefined;
}

export async function analyzeComposeWorkspaces(context: vscode.ExtensionContext, token: vscode.CancellationToken, onFolder?: (name: string) => void): Promise<{ graph: EvidenceGraph; diagnostics: string[]; files: number }> {
  const graph: EvidenceGraph = { version: 1, nodes: [], edges: [] };
  const diagnostics: string[] = [];
  let files = 0;
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (token.isCancellationRequested) throw new vscode.CancellationError();
    onFolder?.(folder.name);
    const uri = await chosenCompose(folder, context);
    if (!uri) { diagnostics.push(`${folder.name}: no root Compose file found`); continue; }
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > MAX_COMPOSE_BYTES) { diagnostics.push(`${folder.name}: Compose file exceeds 2 MB limit`); continue; }
    const source = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    const configuration = vscode.workspace.getConfiguration('archi', folder.uri);
    const options: ComposeOptions = {
      serviceAliases: configuration.get<Record<string, string>>('serviceAliases', {}),
      serviceGroups: configuration.get<Record<string, string>>('serviceGroups', {}),
    };
    const result = analyzeCompose(source, uri.toString(), options);
    const developmentUri = vscode.Uri.joinPath(folder.uri, 'docker-compose.yml');
    if (uri.toString() !== developmentUri.toString() && await exists(developmentUri)) {
      const developmentStat = await vscode.workspace.fs.stat(developmentUri);
      if (developmentStat.size <= MAX_COMPOSE_BYTES) {
        const developmentSource = new TextDecoder().decode(await vscode.workspace.fs.readFile(developmentUri));
        const development = analyzeCompose(developmentSource, developmentUri.toString(), options);
        const byName = new Map(development.graph.nodes.map(node => [node.label, node]));
        for (const node of result.graph.nodes) {
          const counterpart = byName.get(node.label);
          for (const relative of counterpart?.paths ?? []) {
            if (!node.paths?.includes(relative)) node.paths?.push(relative);
          }
        }
      }
    }
    graph.nodes.push(...result.graph.nodes);
    graph.edges.push(...result.graph.edges);
    diagnostics.push(...result.diagnostics.map(item => `${vscode.workspace.asRelativePath(uri)}: ${item}`));
    files++;
  }
  return { graph, diagnostics, files };
}
